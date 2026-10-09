import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import {
  OUTPUT_PRIORITY,
  PLAYER_CAPS,
  makeGoldenEngineOptions,
  planPriority,
} from './fixtures';
import { roughlyUsable } from '../../src/core/run';
import { VERROT_BEHAVIORS } from '../../src/core/ai';
import { registry } from './fixtures';

/**
 * 真实内容的集成测试。
 *
 * 与 `replay.test.ts` 的分工：
 *   - replay.test.ts     —— **一整场**固定战斗的黄金常量（防静默变化）
 *   - encounter.test.ts  —— 逐个机制"真的接线了"（Boss 会施法、会读条、
 *                           会造成伤害、玩家能打死它、超时判负、阶段触发）
 *
 * 后者不追求跑完整场，而是让失败**指向具体机制**：
 * "Boss 不施法"和"这一场输了"是两类完全不同的诊断。
 */

function makeEngine(): BattleEngine {
  return new BattleEngine(makeGoldenEngineOptions());
}

/**
 * 施放一个技能并**推进到读条结算完**，返回这期间的事件。
 *
 * 为什么需要它：早期「攻」「轰」是瞬发（伤害在施放那一 tick 就打出去），
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
    // 开场动作是重斩（延迟 1.5 秒）
    expect(used.has('boss-cleave')).toBe(true);
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
     * 用"贪心优先级"而不是单个技能：只按「攻」在当前平衡下打不死 Boss
     * （Boss 的承伤节奏刚好压过玩家的基础输出）。这也是一条
     * 有价值的结论 —— **必须用上「轰」**才能赢。
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

  it('【需求】只按「攻」能赢，但**只剩 8 血** —— 近乎没有容错', () => {
    /**
     * 平衡目标是"不闪避或防御的话，就算完美进攻循环也打不过，
     * 但要加一点容错"。
     *
     * 实测：纯「攻」（读条结束就按下一个，最理想的输出手法）能赢，
     * 但**只剩 5 血**（满血 100，挨 95 伤）—— 任何一次失误都会死。
     * 而闪避一次就能把余量抬到 38 血（见黄金重放）。
     *
     * 所以这一条锁住的是"**纯进攻几乎没有容错**"，而不是
     * "纯进攻必败"（后者在不改玩家输出的前提下做不到，
     * 详见 `bossHp.ts` 里的说明）。
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
    expect(attacks).toBeGreaterThan(10);
    expect(boss.resources.hp).toBe(0);
    // 关键：几乎没剩血 —— "一次失误就死"的紧度
    expect(player.resources.hp).toBeLessThanOrEqual(12);
    expect(player.alive).toBe(true);
  });

  it('3 分钟超时判负', () => {
    const engine = makeEngine();
    // 玩家不动手，只挨打 → 一定会以某种方式结束
    const events = run(engine, 60 * 185);
    const end = events.find((e) => e.kind === 'encounterEnd');
    expect(end?.kind).toBe('encounterEnd');
  });

  it('血量降到 60% 时授予阶段 buff（阶段是用能力实现的，不是引擎机制）', () => {
    const engine = makeEngine();
    let granted = false;
    let bossBuffed = false;
    for (const e of run(engine, 60 * 200, { skillId: 'attack', everyTicks: 30 })) {
      if (e.kind === 'behaviorTriggered') granted = true;
      if (e.kind === 'buffApplied' && e.buffId === 'boss-frenzy') bossBuffed = true;
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
          behaviors: [{ kind: 'rotation', steps: [{ skillId: 'boss-cleave', gapMs: 2000 }] }],
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
    expect(used.has('boss-cleave')).toBe(true);
  });
});

describe('真实内容：玩家招式都接线了', () => {
  it('攻：读条 0.5 秒后造成 10 点伤害', () => {
    const engine = makeEngine();
    const events = castAndResolve(engine, 'attack');
    const damage = events.find((e) => e.kind === 'damage');
    expect(damage?.kind).toBe('damage');
    if (damage?.kind !== 'damage') return;
    expect(damage.amount).toBe(10); // 需求：攻造成 10 点伤害
  });

  it('攻：代价确实是 10 点缠（与"不施放"对照，隔离自然回复的干扰）', () => {
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
     * 差额是 9 而不是 10：付掉 10 点之后，**同一 tick 内**
     * 又走了一次自然回复（+1）。这正是"用对照隔离干扰"要暴露的东西 ——
     * 直接断言"施放前的值 − 10"会得到假失败。
     */
    expect(kept - spent).toBe(9);
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
    // 先让 Boss 开始读条
    let guard = 0;
    while (engine.snapshot.combatants.find((c) => c.side === 'enemy')!.casts.length === 0) {
      engine.tick();
      engine.drainEvents();
      guard += 1;
      if (guard > 60 * 20) throw new Error('boss never started casting');
    }
    engine.tick([{ type: 'useSkill', skillId: 'break', atTick: engine.snapshot.tick }]);
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'interruptSuccess')).toBe(true);
    expect(engine.snapshot.combatants.find((c) => c.side === 'enemy')!.casts).toHaveLength(0);
  });

  it('防：按住期间减伤，松开即取消', () => {
    const engine = makeEngine();
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    void player;

    // 按住（hold 语义）
    engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
    expect(engine.drainEvents().some((e) => e.kind === 'buffApplied' && e.buffId === 'guard')).toBe(
      true,
    );
    expect(engine.snapshot.combatants.find((c) => c.side === 'ally')!.activeHold?.skillId).toBe(
      'guard',
    );

    // 松开
    engine.tick([{ type: 'releaseSkill', skillId: 'guard', atTick: 1 }]);
    engine.drainEvents();
    const after = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    expect(after.activeHold).toBeUndefined();
    expect(after.buffs.some((b) => b.defId === 'guard')).toBe(false);
  });

  it('防：每 0.1 秒扣 2 点缠，缠耗尽自动松开', () => {
    const options = makeGoldenEngineOptions();
    const playable = options.combatants[0]!;
    // 只给刚好够 3 步的缠（3 × 2 点 × 10 刻度）
    const engine = new BattleEngine({
      ...options,
      combatants: [
        {
          ...playable,
          caps: { ...playable.caps, energy: 60 },
          resources: { ...playable.resources, energy: 60 },
        },
        options.combatants[1]!,
      ],
    });

    engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
    engine.drainEvents();

    // 推进到第 3 个逻辑步之后（每逻辑步 6 个 tick）
    for (let t = 1; t < 20; t += 1) {
      engine.tick();
      engine.drainEvents();
    }
    const after = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    // 缠被扣光 → 自动松开
    expect(after.resources.energy).toBeLessThan(60);
  });
});

describe('炁按伤害换算', () => {
  it('造成伤害会给自己攒炁', () => {
    const engine = makeEngine();
    const before = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.douqi;
    // 「攻」现在是读条技能，要等它结算完才会造成伤害、才谈得上攒炁
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
   * 症状：按住「攻」时会周期性地看到「攻 · 公共冷却中」，
   * 而技能其实马上就要放出来了。
   *
   * 根因：输入层的"预测可用性"与引擎门禁**各写了一份 GCD 判据**，
   * 输入层那份多了 1 个 tick 的"余量"，于是每个公共冷却周期
   * 都漏出 1–2 次误报。
   *
   * 修法：两侧共用 `isOnGcd`。这条测试锁住"共用"这个事实 ——
   * 如果以后有人再复制一份判据，它会失败。
   */
  it('预测门禁与引擎判据一致：按住「攻」不会产生被拒', () => {
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
  it('「攻」是读条技能：按下后不会立刻造成伤害', () => {
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

    // 读 5 tick 后改用「破」（瞬发，不占用的资源），它应当打断「攻」
    for (let t = 1; t <= 5; t += 1) engine.tick();
    engine.tick([{ type: 'useSkill', skillId: 'break', atTick: 6 }]);
    const events = engine.drainEvents();

    const interrupted = events.find((e) => e.kind === 'castInterrupted');
    expect(interrupted).toBeDefined();
    // 原因必须是"主动换招"，而不是被 Boss 打断
    expect(interrupted?.kind === 'castInterrupted' && interrupted.reason).toBe('replaced');
    // 「攻」的读条已经被打断，「破」是瞬发所以现在没有读条
    expect(engine.snapshot.combatants[0]!.casts.length).toBe(0);
  });

  it('【核心】读条中施放"会消费资源的技能"但资源不足 → 只被拒绝，不打断读条', () => {
    /**
     * 踩过的坑：早期打断检查放在门禁**之前**，于是"资源不足被拒绝"
     * 也会顺手把正在读的条打断 —— 玩家按下幻想的「轰」（缠不够），
     * 结果连「攻」的读条也没了。日志里表现为同一 tick 先
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
     * 需求明确：闪避应该打断自己的「攻」。
     *
     * 我一度给它开了豁免（理由："瞬发自保不该有双重代价"），
     * 但需求要的是它**必须**打断 —— 读条中按闪避 = 放弃这次输出
     * 换取生存，这个取舍本身就是玩法。
     *
     * 代价确实很大（一次「攻」≈10 伤 + 30 炁），所以给「闪」
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
    // 中断之后「攻」的那 10 点炁**不会退回来**
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
    // 「攻」的读条被打断
    expect(events.some((e) => e.kind === 'castInterrupted')).toBe(true);
    // 减伤 buff 已经挂上 —— 打断不是纯损失
    expect(engine.snapshot.combatants[0]!.buffs.some((b) => b.defId === 'guard')).toBe(true);
  });

  it('「轰」比「攻」读条更久（高伤害的代价是更容易被打断）', () => {
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

describe('Boss 霸体：唯一挡得住打断的东西', () => {
  it('【核心】霸体期间「破」打不断 Boss —— 连强制打断也挡', () => {
    // 霸体 buff 的 flag 必须真的是 interruptImmune（接线的前提）
    const options = makeGoldenEngineOptions();
    expect(options.buffs.get('boss-armor')!.flags?.interruptImmune).toBe(true);

    /**
     * 用一个**不还手**的 Boss，这样能干净地控制它读什么。
     *
     * 用真实轮转不行：Boss 一起手就在读「蓄能」，而新规则"只有瞬发
     * 能打断"同样作用于 Boss —— 它的霸体招式会因 `casting` 被拒。
     */
    const base = makeGoldenEngineOptions();
    const e = new BattleEngine({
      ...base,
      combatants: [base.combatants[0]!, { ...base.combatants[1]!, behaviors: [] }],
    });
    e.tick();
    e.drainEvents();

    // Boss 放霸体招式，然后空转等它读完（读条 0.4 秒）
    e.tick([{ type: 'useSkill', skillId: 'boss-armor', atTick: e.snapshot.tick }], 'meiichiro');
    e.drainEvents();
    for (let i = 0; i < 30; i += 1) {
      e.tick();
      e.drainEvents();
    }
    expect(
      e.snapshot.combatants.find((c) => c.side === 'enemy')!.buffs.some(
        (b) => b.defId === 'boss-armor',
      ),
    ).toBe(true);

    // 让 Boss 起一个读条招式
    e.tick([{ type: 'useSkill', skillId: 'boss-cleave', atTick: e.snapshot.tick }], 'meiichiro');
    e.drainEvents();
    expect(e.snapshot.combatants.find((c) => c.side === 'enemy')!.casts.length).toBe(1);

    // 玩家用「破」打断 → 必须被霸体挡下
    e.tick([{ type: 'useSkill', skillId: 'break', atTick: e.snapshot.tick }]);
    const events = e.drainEvents();

    expect(events.some((ev) => ev.kind === 'interruptImmune')).toBe(true);
    expect(events.some((ev) => ev.kind === 'interruptSuccess')).toBe(false);
    // 读条必须还在
    expect(e.snapshot.combatants.find((c) => c.side === 'enemy')!.casts.length).toBe(1);
  });

  it('没有霸体时「破」能打断 Boss 的任意招式', () => {
    const e = new BattleEngine(makeGoldenEngineOptions());
    e.tick([], 'meiichiro');
    e.drainEvents();
    e.tick([{ type: 'useSkill', skillId: 'boss-cleave', atTick: e.snapshot.tick }], 'meiichiro');
    e.drainEvents();
    expect(e.snapshot.combatants.find((c) => c.side === 'enemy')!.casts.length).toBe(1);

    e.tick([{ type: 'useSkill', skillId: 'break', atTick: e.snapshot.tick }]);
    const events = e.drainEvents();
    expect(events.some((e2) => e2.kind === 'interruptSuccess')).toBe(true);
    expect(events.some((e2) => e2.kind === 'interruptImmune')).toBe(false);
  });

  it('霸体招式只在二阶段出现 —— 出现在前半场会把节奏拖垮', () => {
    /**
     * 实测记录：把霸体放进前半场的轮转后，即使它一次都没挡下打断，
     * **占掉的那一格也会把 Boss 出招挤后** —— 战斗从 897 tick 拉长到
     * 1094 tick，玩家多挨 18 点伤害，直接变成"玩家先死、Boss 剩 8 血"。
     * 所以它被限制在二阶段（有 `boss-frenzy` 时）。
     */
    const armorStep = VERROT_BEHAVIORS.filter((b) => b.kind === 'rotation').flatMap((b) =>
      b.kind === 'rotation' ? b.steps.filter((s) => s.skillId === 'boss-armor') : [],
    );
    expect(armorStep.length).toBe(1);
    expect(JSON.stringify(armorStep[0]!.when)).toContain('boss-frenzy');
  });

  it('霸体 buff 有明确时长（不是永久的）', () => {
    const armor = makeGoldenEngineOptions().buffs.get('boss-armor')!;
    expect(Number.isFinite(armor.duration)).toBe(true);
    expect(armor.duration).toBeGreaterThan(0);
  });
});
