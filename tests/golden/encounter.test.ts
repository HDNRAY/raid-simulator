import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import {
  OUTPUT_PRIORITY,
  PLAYER_CAPS,
  makeGoldenEngineOptions,
  planPriority,
} from './fixtures';
import { roughlyUsable } from '../../src/core/run';
import { registry } from './fixtures';

/**
 * 真实内容的集成测试。
 *
 * 与 `replay.test.ts` 的分工：前者是**一整场**的黄金常量（防静默变化），
 * 本文件逐个机制验证"真的接线了"（Boss 会施法/读条/造成伤害、玩家能打死它、
 * 超时判负、阶段触发）。它不跑完整场，而是让失败**指向具体机制** ——
 * "Boss 不施法"和"这一场输了"是两类完全不同的诊断。
 */

function makeEngine(): BattleEngine {
  return new BattleEngine(makeGoldenEngineOptions());
}

/**
 * 施放一个技能并**推进到读条结算完**，返回这期间的事件。
 *
 * 为什么需要它：早期「斩」「轰」是瞬发（伤害在施放那一 tick 就打出去），
 * 后来改成读条（0.5s / 0.9s），于是所有"施放后立刻检查伤害"的断言
 * 都会失败 —— 但失败原因是**测试的假设过期了**，不是功能坏了。
 *
 * 用这个 helper 就不必在几十个测试里各补一遍 `for (t...)` 魔法数字。
 */
function castAndResolve(
  engine: BattleEngine,
  skillId: string,
  maxTicks = 120,
): ReturnType<BattleEngine['drainEvents']>[number][] {
  const events: ReturnType<BattleEngine['drainEvents']>[number][] = [];
  engine.tick([{ type: 'useSkill', skillId, atTick: engine.snapshot.tick }]);
  events.push(...engine.drainEvents());
  for (let i = 0; i < maxTicks; i += 1) {
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally');
    if (!player || player.casts.length === 0) break;
    engine.tick();
    events.push(...engine.drainEvents());
  }
  return events;
}

/** 跑 n 个 tick，收集事件。`playerSkill` 每 `everyTicks` 施放一次。 */
function run(
  engine: BattleEngine,
  ticks: number,
  playerSkill?: { readonly skillId: string; readonly everyTicks: number },
) {
  const events: ReturnType<BattleEngine['drainEvents']>[number][] = [];
  for (let t = 0; t < ticks; t += 1) {
    const tick = engine.snapshot.tick;
    const actions =
      playerSkill && tick % playerSkill.everyTicks === 0
        ? [{ type: 'useSkill' as const, skillId: playerSkill.skillId, atTick: tick }]
        : [];
    engine.tick(actions);
    events.push(...engine.drainEvents());
  }
  return events;
}

describe('真实内容：Boss 的机制都接线了', () => {
  it('Boss 会按行为数组施放技能', () => {
    const engine = makeEngine();
    const used = new Set<string>();
    for (const e of run(engine, 60 * 30)) {
      if (e.kind === 'skillUsed' && e.sourceId === 'meiichiro') used.add(e.skillId);
    }
    expect(used.size).toBeGreaterThan(0);
    /**
     * 开场动作是**慢刀**「碾压」（延迟 1.2 秒）—— 设计 §Q4 的推荐：
     * 第一眼就立住"青蓝长条 = 不能破 = 要闪"。
     */
    expect(used.has('boss-heavy')).toBe(true);
  });

  it('Boss 的读条产生了前摇（castStarted）', () => {
    const engine = makeEngine();
    const castStarts = run(engine, 60 * 20).filter(
      (e) => e.kind === 'castStarted' && e.sourceId === 'meiichiro',
    );
    expect(castStarts.length).toBeGreaterThan(0);
  });

  it('Boss 会对玩家造成伤害（不还手就不叫 Boss）', () => {
    const engine = makeEngine();
    let dealt = 0;
    for (const e of run(engine, 60 * 60)) {
      if (e.kind === 'damage' && e.targetId === 'player') dealt += e.amount;
    }
    expect(dealt).toBeGreaterThan(0);
  });

  it('玩家能打死 Boss（战斗是双向可行的）', () => {
    /**
     * 用"贪心优先级"而不是单个技能：只按「斩」在当前平衡下打不过 Boss。
     * 必须用上「劈」（缠的出口）才能赢 —— 夹具的玩家现在是**林晚风**，
     * 见 `tests/golden/fixtures.ts` 的文件头。
     */
    const engine = makeEngine();
    const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
    let sawEnd: string | undefined;
    for (let t = 0; t < 60 * 250; t += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick(plan(engine.snapshot.tick, engine.snapshot));
      for (const e of engine.drainEvents()) {
        if (e.kind === 'encounterEnd') sawEnd = `${e.result}/${String(e.reason)}`;
      }
    }
    expect(sawEnd).toBeDefined();
  });

  it('【需求】只按「斩」打不过 Boss —— 不用防御就是输', () => {
    /**
     * 需求目标："不闪避或防御的话，就算完美进攻循环也打不过，
     * 但加一点容错。"
     *
     * 实测：纯「斩」（读条一结束就按下一个，最理想的输出手法）**败**；
     * 用上闪避/卸力才能赢（见黄金重放）。
     */
    const engine = makeEngine();
    let attacks = 0;
    for (let t = 0; t < 60 * 250; t += 1) {
      const st = engine.snapshot;
      if (st.status !== 'running') break;
      const actor = st.combatants.find((c) => c.side === 'ally')!;
      engine.tick(
        actor.casts.length > 0
          ? []
          : [{ type: 'useSkill' as const, skillId: 'attack', atTick: st.tick }],
      );
      for (const e of engine.drainEvents()) {
        if (e.kind === 'skillUsed' && e.skillId === 'attack' && e.sourceId === 'player') attacks += 1;
      }
    }
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    const boss = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    expect(attacks).toBeGreaterThan(5);
    expect(engine.snapshot.status).toBe('defeat');
    expect(player.alive).toBe(false);
    /**
     * ⚠️ 阈值 35 → **130**（「傲慢」改造后重新标定）。
     *
     * 实测：**403 tick 就败、Boss 剩 120**。为什么会比旧 Boss 差这么多
     * （旧记录是"剩 30"）：纯进攻派**按不出防御**，而「傲慢」的开场是
     * `opener`「碾压」（2.0s 前摇 / 60 伤 / 霸体）紧跟「呵斥」（40 伤）
     * —— 两刀合计 100 伤正好等于满血，玩家只来得及打出 9 次「斩」。
     *
     * ⚠️ 这条**没有**弱化"纯进攻必须输"这个核心判据（`status` /
     * `player.alive` 两条断言原样保留，`attacks > 5` 也保留），
     * 放宽的只是"输得多接近"。设计 §9.3 期望的"Boss 剩 20–40"
     * 在当前内容下**做不到** —— 那是设计对玩家有效输出的估算
     * （13.6 DPS）与实际策略（~9 DPS）的落差，不是引擎问题。
     * 详见 `src/data/bossPride.ts` 的 `gapMs` 注释。
     *
     * ⚠️ **2026-10-11 再标定：上界 130 → 340。**
     *
     * 那一次的改动是"傲慢血量 210 → 420" + "「斩」「避」的炁耗都改成 15"。
     * 新实测：**Boss 剩 330**。
     *
     * ⚠️ 相对位置其实**变差了**（130/210 = 62% → 330/420 = **79%**）：
     * 斩从 10 炁涨到 15，「纯进攻」能打出的次数更少 —— 这正是"抬高输出税"
     * 想要的效果，所以"相对更差"是**预期**，不是回归。
     *
     * ⚠️ 上界 340 = 实测 330 + 10 点余量。核心判据（`status` /
     * `player.alive` / `attacks > 5`）一条没动，放宽的只是"输得多接近"。
     *
     * ⚠️ **2026-10-12 第三次标定：上界 340 → 270。**
     * 夹具换成林晚风（150 血）之后纯进攻能多扛一会儿：新实测
     * **883 tick / Boss 剩 260**。数字来历见 `fixtures.ts` 的 `GOLDEN_OUTCOME`。
     */
    expect(boss.resources.hp).toBeGreaterThan(0);
    expect(boss.resources.hp).toBeLessThanOrEqual(270);
  });

  it('3 分钟超时判负', () => {
    const engine = makeEngine();
    // 玩家不动手，只挨打 → 一定会以某种方式结束
    const events = run(engine, 60 * 185);
    const end = events.find((e) => e.kind === 'encounterEnd');
    expect(end?.kind).toBe('encounterEnd');
  });

  it('血量降到 60% 时授予阶段 buff（阶段是用能力实现的，不是引擎机制）', () => {
    /**
     * ⚠️ 这条守卫的**不再是「傲慢」**（设计 §8.3 明确不做二阶段：
     * "傲慢的辨识点是随机，不是阶段"）。它守的是**引擎的能力**：
     * `onHpBelow` 仍然能把一个阶段 buff 授出来。
     *
     * 所以这里的 Boss 是一个**自定义的两阶段 Boss**（`boss-frenzy` 这层
     * buff 由测试自己声明），而不是 `PRIDE_BEHAVIORS` —— 后者已经
     * 没有 `onHpBelow` 了。
     */
    const engine = makeEngine();
    const boss = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    engine.replaceCombatantForTest({
      ...boss,
      behaviors: [
        {
          kind: 'onHpBelow',
          ratio: 0.6,
          then: [
            {
              kind: 'grant',
              target: { mode: 'self' },
              buff: {
                id: 'test-phase2',
                nameKey: 'buffShort.enrage',
                icon: 'enrage',
                polarity: 'buff',
                duration: Number.POSITIVE_INFINITY,
                maxStacks: 1,
                stacking: { mode: 'refresh' },
              },
            },
          ],
        },
      ],
    });
    let granted = false;
    let bossBuffed = false;
    for (const e of run(engine, 60 * 200, { skillId: 'attack', everyTicks: 30 })) {
      if (e.kind === 'behaviorTriggered') granted = true;
      if (e.kind === 'buffApplied' && e.buffId === 'test-phase2') bossBuffed = true;
    }
    expect(granted).toBe(true);
    expect(bossBuffed).toBe(true);
  });

  it('换个 Boss 可以完全没有阶段 —— 引擎不需要它', () => {
    // 一个只有轮转、没有任何 onHpBelow 的 Boss 应当完全正常工作
    const options = makeGoldenEngineOptions();
    const boss = options.combatants[1]!;
    const engine = new BattleEngine({
      ...options,
      combatants: [
        options.combatants[0]!,
        {
          ...boss,
          behaviors: [{ kind: 'rotation', steps: [{ skillId: 'boss-heavy', gapMs: 2000 }] }],
        },
      ],
    });
    const used = new Set<string>();
    for (let t = 0; t < 60 * 20; t += 1) {
      engine.tick();
      for (const e of engine.drainEvents()) {
        if (e.kind === 'skillUsed' && e.sourceId === 'meiichiro') used.add(e.skillId);
        // 绝不该出现任何"阶段"类事件
        expect(e.kind).not.toBe('phaseChanged' as never);
      }
    }
    expect(used.has('boss-heavy')).toBe(true);
  });
});

describe('真实内容：玩家招式都接线了', () => {
  it('斩：读条 0.5 秒后造成 10 点伤害', () => {
    const engine = makeEngine();
    const events = castAndResolve(engine, 'attack');
    const damage = events.find((e) => e.kind === 'damage');
    expect(damage?.kind).toBe('damage');
    if (damage?.kind !== 'damage') return;
    expect(damage.amount).toBe(10); // 需求：攻造成 10 点伤害
  });

  it('斩：代价确实是 15 点炁（与"不施放"对照，隔离自然回复的干扰）', () => {
    /**
     * 为什么要做对照：缠每个逻辑步都会自然回复，
     * 直接断言"施放前的值 − 100"会被回复量污染（实测差 10 点）。
     * 用同一 tick 数的两次运行相减，才能把"代价"单独量出来。
     */
    const spend = makeEngine();
    spend.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    spend.drainEvents();

    const idle = makeEngine();
    idle.tick();
    idle.drainEvents();

    const spent = spend.snapshot.combatants.find((c) => c.side === 'ally')!.resources.energy;
    const kept = idle.snapshot.combatants.find((c) => c.side === 'ally')!.resources.energy;
    /**
     * 差额是 14 而不是 15：付掉 15 点之后，**同一 tick 内**
     * 又走了一次自然回复（+1）。这正是"用对照隔离干扰"要暴露的东西 ——
     * 直接断言"施放前的值 − 15"会得到假失败。
     *
     * ⚠️ 这条断言会**跟着技能价格一起改**，这正是它存在的意义：
     * 它是"价格真的被扣了、而且只扣了这些"的机器检查。
     */
    expect(kept - spent).toBe(14);
  });

  it('闪：进入无敌窗口，期间完全免伤', () => {
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'dodge', atTick: 0 }]);
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'buffApplied' && e.buffId === 'dodge-iframe')).toBe(true);
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    expect(player.buffs.some((b) => b.defId === 'dodge-iframe')).toBe(true);
  });

  it('轰：读条 0.9 秒后造成 30 点伤害', () => {
    const options = makeGoldenEngineOptions();
    const p0 = options.combatants[0]!;
    // 给足缠 —— 自然积攒要几十秒，那不是这条测试要验的东西
    const rich = {
      ...p0,
      resources: { ...p0.resources, douqi: 100 },
    };
    const engine = new BattleEngine({
      ...options,
      combatants: [rich, options.combatants[1]!],
    });
    const events = castAndResolve(engine, 'blast');
    const damage = events.filter((e) => e.kind === 'damage').pop();
    expect(damage?.kind).toBe('damage');
    if (damage?.kind !== 'damage') return;
    expect(damage.amount).toBe(30);
  });

  it('凝：给自己挂上增伤 buff', () => {
    const options = makeGoldenEngineOptions();
    const player = options.combatants[0]!;
    const engine = new BattleEngine({
      ...options,
      combatants: [
        { ...player, resources: { ...player.resources, douqi: PLAYER_CAPS.douqi } },
        options.combatants[1]!,
      ],
    });
    engine.tick([{ type: 'useSkill', skillId: 'focus', atTick: 0 }]);
    expect(engine.drainEvents().some((e) => e.kind === 'buffApplied' && e.buffId === 'focus')).toBe(
      true,
    );
    expect(engine.statsOf('player').damageBoost).toBeCloseTo(20, 5);
  });

  it('破：打断 Boss 的任何读条（不看可打断性）', () => {
    const engine = makeEngine();
    const boss = () => engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    // 先让 Boss 开始读条
    let guard = 0;
    while (boss().casts.length === 0) {
      engine.tick();
      engine.drainEvents();
      guard += 1;
      if (guard > 60 * 20) throw new Error('boss never started casting');
    }
    // ⚠️ 断言"那一次读条被取消"，不是"Boss 此后不再出招"（AI 同一 tick 可再决策）
    const interrupted = boss().casts[0]!.skillId;
    engine.tick([{ type: 'useSkill', skillId: 'break', atTick: engine.snapshot.tick }]);
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'interruptSuccess')).toBe(true);
    expect(events.some((e) => e.kind === 'castInterrupted' && e.skillId === interrupted)).toBe(true);
    expect(boss().casts.map((c) => c.skillId)).not.toContain(interrupted);
  });

  /**
   * ⚠️ 「卸」的**按住机制**（欠账累加器 / 一秒 = 3 炁 / 资源耗尽松开 /
   * 显示口径同源）搬到了 `tests/unit/holdDrain.test.ts`。
   *
   * 理由：那是"一个机制 + 它的显示口径"，本文件是"整场遭遇战"的集成
   * 测试，混在一起两边都读不清；而且本文件已贴到 700 行上限
   * （AGENTS.md §3）—— 拆出去比压注释正确。
   */
});

describe('炁按伤害换算', () => {
  it('造成伤害会给自己攒炁', () => {
    const engine = makeEngine();
    const before = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.douqi;
    // 「斩」现在是读条技能，要等它结算完才会造成伤害、才谈得上攒炁
    castAndResolve(engine, 'attack');
    const after = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.douqi;
    expect(after).toBeGreaterThan(before);
  });

  it('受到伤害也会攒炁（挨打不是纯粹吃亏）', () => {
    const options = makeGoldenEngineOptions();
    const engine = new BattleEngine(options);
    // 等到玩家挨第一下
    let guard = 0;
    let douqiBefore = -1;
    while (guard < 60 * 60) {
      const p = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
      if (p.buffs.some((b) => b.defId === 'guard')) douqiBefore = p.resources.douqi;
      engine.tick();
      const events = engine.drainEvents();
      if (events.some((e) => e.kind === 'damage' && e.targetId === 'player')) {
        const after = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.douqi;
        expect(after).toBeGreaterThan(0);
        return;
      }
      guard += 1;
    }
    throw new Error('player never took damage');
    void douqiBefore;
  });

  it('炁不会超过上限', () => {
    const engine = makeEngine();
    run(engine, 60 * 120, { skillId: 'attack', everyTicks: 30 });
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    expect(player.resources.douqi).toBeLessThanOrEqual(PLAYER_CAPS.douqi);
  });
});

describe('公共冷却不应产生误报（用户报过的 bug）', () => {
  /**
   * 症状：按住「斩」时会周期性地看到「攻 · 公共冷却中」，
   * 而技能其实马上就要放出来了。
   *
   * 根因：输入层的"预测可用性"与引擎门禁**各写了一份 GCD 判据**，
   * 输入层那份多了 1 个 tick 的"余量"，于是每个公共冷却周期
   * 都漏出 1–2 次误报。
   *
   * 修法：两侧共用 `isOnGcd`。这条测试锁住"共用"这个事实 ——
   * 如果以后有人再复制一份判据，它会失败。
   */
  it('预测门禁与引擎判据一致：按住「斩」不会产生被拒', () => {
    const options = makeGoldenEngineOptions();
    const engine = new BattleEngine(options);
    const attack = options.skills.get('attack')!;
    let attacks = 0;
    let rejects = 0;

    for (let t = 0; t < 200; t += 1) {
      const st = engine.snapshot;
      const actor = st.combatants.find((c) => c.side === 'ally')!;
      // 模拟"玩家按住不放"：只在预测可用时入队
      const usable = roughlyUsable('attack', st, attack, actor.id);
      engine.tick(
        usable ? [{ type: 'useSkill' as const, skillId: 'attack', atTick: st.tick }] : [],
      );
      for (const e of engine.drainEvents()) {
        if (e.kind === 'skillUsed' && e.skillId === 'attack') attacks += 1;
        if (e.kind === 'skillRejected' && e.skillId === 'attack') rejects += 1;
      }
    }

    expect(attacks).toBeGreaterThan(0);
    expect(rejects).toBe(0);
  });

  it('不做预测地硬按会被大量拒绝 —— 说明预测门禁确实在起作用', () => {
    const options = makeGoldenEngineOptions();
    const engine = new BattleEngine(options);
    let rejects = 0;
    for (let t = 0; t < 200; t += 1) {
      // 每个 tick 都硬按，违反公共冷却
      engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: engine.snapshot.tick }]);
      for (const e of engine.drainEvents()) {
        if (e.kind === 'skillRejected' && e.skillId === 'attack') rejects += 1;
      }
    }
    expect(rejects).toBeGreaterThan(100);
  });
});

describe('读条与打断（公共冷却已删除，节奏改由读条表达）', () => {
  it('「斩」是读条技能：按下后不会立刻造成伤害', () => {
    const engine = makeEngine();
    const bossBefore = engine.snapshot.combatants[1]!.resources.hp;
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    // 刚开始读条，伤害还没结算
    expect(engine.snapshot.combatants[1]!.resources.hp).toBe(bossBefore);
    expect(engine.snapshot.combatants[0]!.casts.length).toBe(1);
  });

  it('【核心】读条中施放其它技能会打断当前读条', () => {
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    expect(engine.snapshot.combatants[0]!.casts.length).toBe(1);

    // 读 5 tick 后改用「破」（瞬发，不占用的资源），它应当打断「斩」
    for (let t = 1; t <= 5; t += 1) engine.tick();
    engine.tick([{ type: 'useSkill', skillId: 'break', atTick: 6 }]);
    const events = engine.drainEvents();

    const interrupted = events.find((e) => e.kind === 'castInterrupted');
    expect(interrupted).toBeDefined();
    // 原因必须是"主动换招"，而不是被 Boss 打断
    expect(interrupted?.kind === 'castInterrupted' && interrupted.reason).toBe('replaced');
    // 「斩」的读条已经被打断，「破」是瞬发所以现在没有读条
    expect(engine.snapshot.combatants[0]!.casts.length).toBe(0);
  });

  it('【核心】读条中施放"会消费资源的技能"但资源不足 → 只被拒绝，不打断读条', () => {
    /**
     * 踩过的坑：早期打断检查放在门禁**之前**，于是"资源不足被拒绝"
     * 也会顺手把正在读的条打断 —— 玩家按下幻想的「轰」（缠不够），
     * 结果连「斩」的读条也没了。日志里表现为同一 tick 先
     * `castInterrupted` 再 `skillRejected`。
     */
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();

    // 缠很少（刚开局 0 点），「轰」必然因代价被拒
    expect(engine.snapshot.combatants[0]!.resources.douqi).toBeLessThan(50);
    engine.tick([{ type: 'useSkill', skillId: 'blast', atTick: 1 }]);
    const events = engine.drainEvents();

    expect(events.some((e) => e.kind === 'skillRejected' && e.skillId === 'blast')).toBe(true);
    // 关键：读条必须还在
    expect(events.some((e) => e.kind === 'castInterrupted')).toBe(false);
    expect(engine.snapshot.combatants[0]!.casts[0]?.skillId).toBe('attack');
  });

  it('【核心】只有瞬发能打断：读条技能之间互不打断', () => {
    /**
     * 这是需求的核心：读条技能（攻 / 轰）在读条中会被 `casting` 拒绝，
     * 所以**不会**打断自己 —— 否则"读条"永远读不完，失去意义。
     */
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    for (let t = 1; t <= 3; t += 1) engine.tick();

    // 缠给足，排除"代价不足"这个无关因素
    const withDouqi = makeEngine();
    void withDouqi;
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 4 }]);
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'skillRejected' && e.reason === 'casting')).toBe(true);
    expect(events.some((e) => e.kind === 'castInterrupted')).toBe(false);
    // 原来的读条还在
    expect(engine.snapshot.combatants[0]!.casts[0]!.skillId).toBe('attack');
  });

  it('「闪」**会**打断自己的读条 —— 这是"放弃一次输出换生存"的取舍', () => {
    /**
     * 需求明确：闪避应该打断自己的「斩」。
     *
     * 我一度给它开了豁免（理由："瞬发自保不该有双重代价"），
     * 但需求要的是它**必须**打断 —— 读条中按闪避 = 放弃这次输出
     * 换取生存，这个取舍本身就是玩法。
     *
     * 代价确实很大（一次「斩」≈10 伤 + 30 炁），所以给「闪」
     * 加了 1 秒冷却，避免连按把炁浪费掉。
     */
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    expect(engine.snapshot.combatants[0]!.casts.length).toBe(1);

    engine.tick([{ type: 'useSkill', skillId: 'dodge', atTick: 1 }]);
    const events = engine.drainEvents();

    // 读条被打断
    expect(events.some((e) => e.kind === 'castInterrupted')).toBe(true);
    expect(engine.snapshot.combatants[0]!.casts.length).toBe(0);
    // 无敌仍然挂上了 —— 打断换来的是生存
    expect(events.some((e) => e.kind === 'buffApplied' && e.buffId === 'dodge-iframe')).toBe(true);
  });

  it('「闪」有 1 秒冷却（保留取舍，但不让连按浪费炁）', () => {
    const dodge = registry.skills.get('dodge')!;
    expect(dodge.cooldown).toBe(1000);
  });

  it('「破」仍然会打断自己的读条 —— 它的意义就是打断', () => {
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    expect(engine.snapshot.combatants[0]!.casts.length).toBe(1);

    engine.tick([{ type: 'useSkill', skillId: 'break', atTick: 1 }]);
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'castInterrupted')).toBe(true);
    expect(engine.snapshot.combatants[0]!.casts.length).toBe(0);
  });

  it('打断不退代价 —— 酝酿大招被打断是有真实损失的', () => {
    const engine = makeEngine();
    const energyBefore = engine.snapshot.combatants[0]!.resources.energy;
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    // 代价在读条开始时已扣
    const afterStart = engine.snapshot.combatants[0]!.resources.energy;
    expect(afterStart).toBeLessThan(energyBefore);

    for (let t = 1; t <= 3; t += 1) engine.tick();
    engine.tick([{ type: 'useSkill', skillId: 'blast', atTick: 4 }]);
    engine.drainEvents();
    // 中断之后「斩」的那 10 点炁**不会退回来**
    expect(engine.snapshot.combatants[0]!.resources.energy).toBeLessThanOrEqual(afterStart);
  });

  it('「防」是瞬发，「按下」就打断读条 —— 与其它瞬发技能一致', () => {
    /**
     * 规则（需求）：**只有瞬发技能能打断读条**，包括「防」这种按住型。
     * 读条技能（攻 / 轰）之间不会互相打断。
     */
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    expect(engine.snapshot.combatants[0]!.casts[0]!.skillId).toBe('attack');

    engine.tick([{ type: 'hold', skillId: 'guard', atTick: 1 }]);
    const events = engine.drainEvents();
    // 「斩」的读条被打断
    expect(events.some((e) => e.kind === 'castInterrupted')).toBe(true);
    // 减伤 buff 已经挂上 —— 打断不是纯损失
    expect(engine.snapshot.combatants[0]!.buffs.some((b) => b.defId === 'guard')).toBe(true);
  });

  it('「轰」比「斩」读条更久（高伤害的代价是更容易被打断）', () => {
    const a = registry.skills.get('attack')!;
    const b = registry.skills.get('blast')!;
    expect(b.castTime).toBeGreaterThan(a.castTime);
    expect(a.castTime).toBeGreaterThan(0);
  });

  it('「闪」「破」是瞬发 —— 它们必须能随时按出来', () => {
    // 闪避的意义就是"看到前摇随时能按"；破要能打断 Boss 的读条。
    // 如果它们也读条，这两个核心玩法就废了。
    expect(registry.skills.get('dodge')!.castTime).toBe(0);
    expect(registry.skills.get('break')!.castTime).toBe(0);
  });
});
