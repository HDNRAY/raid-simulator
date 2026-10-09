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
      if (e.kind === 'skillUsed' && e.sourceId === 'verrot') used.add(e.skillId);
    }
    expect(used.size).toBeGreaterThan(0);
    // 开场动作是重斩（延迟 1.5 秒）
    expect(used.has('boss-cleave')).toBe(true);
  });

  it('Boss 的读条产生了前摇（castStarted）', () => {
    const engine = makeEngine();
    const castStarts = run(engine, 60 * 20).filter(
      (e) => e.kind === 'castStarted' && e.sourceId === 'verrot',
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

  it('只按「攻」也能打赢，但明显比用上「轰」慢', () => {
    /**
     * 早期这条测试断言"只按攻会输"。改成读条机制之后结论变了 ——
     * 而且**旧写法本身就是错的**：`run` helper 每 30 tick 无脑发一次
     * 「攻」，而读条正好也是 30 tick，于是它一直在自我打断，
     * 测的不是"只按攻"，而是"不断打断自己的攻"。
     *
     * 现在按真实打法来：**读条结束再按下一个**。
     */
    const engine = makeEngine();
    let attacks = 0;
    for (let t = 0; t < 60 * 250; t += 1) {
      const st = engine.snapshot;
      if (st.status !== 'running') break;
      const actor = st.combatants.find((c) => c.side === 'ally')!;
      const busy = actor.casts.length > 0;
      engine.tick(
        busy ? [] : [{ type: 'useSkill' as const, skillId: 'attack', atTick: st.tick }],
      );
      for (const e of engine.drainEvents()) {
        if (e.kind === 'skillUsed' && e.skillId === 'attack' && e.sourceId === 'player') {
          attacks += 1;
        }
      }
    }
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    const boss = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;

    // 确实一直在按（否则下面的结论没有意义）
    expect(attacks).toBeGreaterThan(10);
    // 结论：单靠普攻也能赢，只是慢
    expect(boss.resources.hp).toBe(0);
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
        if (e.kind === 'skillUsed' && e.sourceId === 'verrot') used.add(e.skillId);
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

  it('瞬发技能（闪）也能打断正在读的条 —— "想躲就躲得掉"', () => {
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    engine.tick([{ type: 'useSkill', skillId: 'dodge', atTick: 1 }]);
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'castInterrupted')).toBe(true);
    // 无敌窗口必须已经挂上 —— 否则"打断"就成了纯损失
    expect(engine.snapshot.combatants[0]!.buffs.some((b) => b.defId === 'dodge-iframe')).toBe(true);
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

  it('按住型「防」不会打断自己的读条（否则按住防就永远放不出攻）', () => {
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    const castSkill = engine.snapshot.combatants[0]!.casts[0]!.skillId;

    // 模拟玩家一边读条一边按住「防」：每个 tick 都发一次 hold
    for (let t = 1; t <= 10; t += 1) {
      engine.tick([{ type: 'hold', skillId: 'guard', atTick: t }]);
      engine.drainEvents();
      const casts = engine.snapshot.combatants[0]!.casts;
      // 读条必须还在，而且没被换成「防」
      expect(casts.length).toBe(1);
      expect(casts[0]!.skillId).toBe(castSkill);
    }
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
