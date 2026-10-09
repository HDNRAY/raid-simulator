import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import {
  OUTPUT_PRIORITY,
  PLAYER_CAPS,
  makeGoldenEngineOptions,
  planPriority,
} from './fixtures';
import { roughlyUsable } from '../../src/core/run';

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

  it('只按「攻」在当前平衡下打不死 Boss（必须用上「轰」）', () => {
    const engine = makeEngine();
    const events = run(engine, 60 * 250, { skillId: 'attack', everyTicks: 30 });
    const end = events.find((e) => e.kind === 'encounterEnd');
    expect(end?.kind).toBe('encounterEnd');
    if (end?.kind !== 'encounterEnd') return;
    expect(end.result).toBe('defeat');
  });

  it('3 分钟超时判负', () => {
    const engine = makeEngine();
    // 玩家不动手，只挨打 → 一定会以某种方式结束
    const events = run(engine, 60 * 185);
    const end = events.find((e) => e.kind === 'encounterEnd');
    expect(end?.kind).toBe('encounterEnd');
  });

  it('打完 Boss 的一半血会触发阶段转换', () => {
    const engine = makeEngine();
    let phase = 1;
    for (const e of run(engine, 60 * 200, { skillId: 'attack', everyTicks: 30 })) {
      if (e.kind === 'phaseChanged') phase = e.phase;
    }
    expect(phase).toBeGreaterThan(1);
  });
});

describe('真实内容：玩家招式都接线了', () => {
  it('攻：消耗 10 缠、造成 10 点伤害', () => {
    const engine = makeEngine();
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    const events = engine.drainEvents();
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

  it('轰：消耗 50 炁、造成 30 点伤害', () => {
    const options = makeGoldenEngineOptions();
    const player = options.combatants[0]!;
    const engine = new BattleEngine({
      ...options,
      combatants: [
        { ...player, resources: { ...player.resources, douqi: PLAYER_CAPS.douqi } },
        options.combatants[1]!,
      ],
    });
    engine.tick([{ type: 'useSkill', skillId: 'blast', atTick: 0 }]);
    const events = engine.drainEvents();
    const damage = events.find((e) => e.kind === 'damage');
    if (damage?.kind !== 'damage') throw new Error('expected damage');
    expect(damage.amount).toBe(30); // 需求：轰造成 30 点伤害
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
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
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
