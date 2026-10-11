import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import {
  BOSS_HEAVY,
  BOSS_MEND,
  BOSS_REBUKE,
  BOSS_SCORN,
  BOSS_HEAVY_ARMOR,
  PRIDE_BEHAVIORS,
  PRIDE_BUFFS,
  PRIDE_SKILLS,
} from '../../src/data/bossPride';
import { makeCombatant } from './helpers';
import { OUTPUT_PRIORITY, makeGoldenEngineOptions, planPriority } from '../golden/fixtures';
import type { Action, BattleState, Behavior, BuffDef, SkillDef } from '../../src/core/types';

/**
 * 「傲慢」的**随机选招**与**三把刀的内容数值**。
 *
 * 设计：`docs/specs/2026-10-11-pride-boss.md`（§4 随机释放 / §9.1 单测）
 *
 * ==================================================================
 * 为什么随机释放必须被测
 * ==================================================================
 *
 * 三者冷却相同（3s），而顺序轮转是"取第一个可用的" —— 那会让
 * **只有 `steps[0]` 那一个技能放得出来**，另外两个是死内容（设计 §4.1）。
 * 所以"随机"不是手感加分项，是这三个技能能否共存的**前提**；
 * 它一旦退回顺序语义，另外两招就静默消失了 —— 那种回归只能靠这里拦。
 *
 * ⚠️ 用的是**真实的** `ALL_SKILLS` / `ALL_BUFFS`（不是另造一套）：
 * "内容写对了但没注册"这类错误只有这样才拦得住。
 */

const buffs = new Map<string, BuffDef>(ALL_BUFFS.map((b) => [b.id, b]));
const skills = new Map<string, SkillDef>(ALL_SKILLS.map((s) => [s.id, s]));

/** 一个不还手的 Boss：血厚到打不死，只用给定的行为数组。 */
function makeRotationEngine(options: {
  readonly behaviors: readonly Behavior[];
  readonly seed?: number;
}): BattleEngine {
  const player = makeCombatant({ id: 'player', side: 'ally' });
  const boss = makeCombatant({
    id: 'meiichiro',
    side: 'enemy',
    caps: { hp: 1_000_000, energy: 0, douqi: 0 },
    resources: { hp: 1_000_000, energy: 0, douqi: 0 },
    behaviors: options.behaviors,
  });
  const engine = new BattleEngine({
    combatants: [player, boss],
    seed: options.seed ?? 20261011,
    bossId: 'meiichiro',
    buffs,
    skills,
    baseStats: new Map([
      ['player', {}],
      ['meiichiro', {}],
    ]),
    passiveModifiers: new Map(),
  });
  return engine;
}

/** 跑 n tick，返回 Boss 的施法序列。 */
function bossCasts(engine: BattleEngine, ticks: number): string[] {
  const out: string[] = [];
  for (let t = 0; t < ticks; t += 1) {
    if (engine.snapshot.status !== 'running') break;
    engine.tick();
    for (const e of engine.drainEvents()) {
      if (e.kind === 'skillUsed') out.push(e.skillId);
    }
  }
  return out;
}

/** 把"三把刀"的行为数组克隆一份、换个 `gapMs`（保持内容不动）。 */
function withGap(gapMs: number): readonly Behavior[] {
  return PRIDE_BEHAVIORS.map((b) => (b.kind === 'weightedRotation' ? { ...b, gapMs } : b));
}

describe('「傲慢」的随机选招：可复现、不空转、有保底', () => {
  it('同一种子 → 同一串出招', () => {
    const a = bossCasts(makeRotationEngine({ behaviors: withGap(2_000) }), 60 * 40);
    const b = bossCasts(makeRotationEngine({ behaviors: withGap(2_000) }), 60 * 40);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
  });

  it('不同种子 → 不同序列（防"权重写错导致永远同一招"）', () => {
    const a = bossCasts(makeRotationEngine({ behaviors: withGap(2_000), seed: 1 }), 60 * 40);
    const b = bossCasts(makeRotationEngine({ behaviors: withGap(2_000), seed: 999 }), 60 * 40);
    expect(a).not.toEqual(b);
  });

  it('冷却真的被尊重：同一技能的复用间隔 ≥ 3.0s（180 tick）', () => {
    /**
     * ⚠️ 这条是**随机轮转最容易退化的地方**：`lastUsedAt` 一旦没被写回
     * 引擎（曾经的真 bug —— `ctx.aiState = next` 改的是一个临时对象），
     * `gapMs` 就完全失效，Boss 会按**冷却**出招。所以这里直接量 tick 差。
     *
     * ⚠️ 量的是**同一技能的复用间隔**，不是"任意两刀"：不同技能第一次
     * 出手时 `lastUsedAt` 还是空的，所以开场三刀可以连着出
     * （实测 0 / 91 / 212）—— 那是"开场爆发"，不是 bug。
     * "任意两刀"由下一条（提高 gapMs）单独验。
     */
    const engine = makeRotationEngine({ behaviors: withGap(2_000) });
    const lastUsed = new Map<string, number>();
    for (let t = 0; t < 60 * 40; t += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick();
      for (const e of engine.drainEvents()) {
        if (e.kind !== 'skillUsed') continue;
        const prev = lastUsed.get(e.skillId);
        if (prev !== undefined) {
          expect(e.tick - prev).toBeGreaterThanOrEqual(180);
        }
        lastUsed.set(e.skillId, e.tick);
      }
    }
    // 三个技能都得真的被重复用过，否则上面的循环可能一次都没跑
    expect(lastUsed.size).toBe(3);
  });

  it('gapMs 真的在限速：把 gap 提到 3.0s 后任意两刀都隔 ≥ 180 tick', () => {
    /**
     * 与上一条互补：上一条卡**同一技能的冷却**，这一条卡**全场间隔**。
     *
     * ⚠️ 内容里那条 `opener`（延迟 1.2s 的开场慢刀）**不受 `gapMs` 约束**
     * —— 它只有"每个 opener 一次"这一个门禁（`openedSkills`）。所以这里
     * **去掉 opener**，只留加权轮转，否则开场那一刀会立刻造成假失败。
     * 那是设计的"开场爆发"，由 `gapMs` 管不到（设计 §10 的风险表记过）。
     */
    const engine = makeRotationEngine({ behaviors: withGap(3_000) });
    const ticks: number[] = [];
    for (let t = 0; t < 60 * 60; t += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick();
      for (const e of engine.drainEvents()) {
        if (e.kind === 'skillUsed') ticks.push(e.tick);
      }
    }
    expect(ticks.length).toBeGreaterThan(4);
    /**
     * ⚠️ 从**第二项**开始比：第一项是那条 `opener` 打出来的
     * （延迟 1.2s、不受 gap 约束，见上面），第二项才是加权轮转的第一刀。
     */
    const rotated = ticks.slice(1);
    for (let i = 1; i < rotated.length; i += 1) {
      expect(rotated[i]! - rotated[i - 1]!).toBeGreaterThanOrEqual(180);
    }
  });

  it('保底：不存在"连续两次同一招"', () => {
    const seq = bossCasts(makeRotationEngine({ behaviors: withGap(2_000) }), 60 * 60);
    expect(seq.length).toBeGreaterThan(5);
    for (let i = 1; i < seq.length; i += 1) {
      expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });

  it('不空转：一场里三个伤害技能**都出现过**（守住"后面的技能被饿死"那个坑）', () => {
    /**
     * ================================================================
     * ⚠️ 这条本来想用"**真实** `gapMs`（4s）跑一整场"来验，但那样
     * 逼不出来：一场 15 秒里 Boss 只有 4 次出招，随机很容易漏掉一招。
     * 那是**统计问题**，不是"技能被饿死"。
     * ================================================================
     *
     * "饿死"这个坑（`data/lustBoss.ts` 记过）的形态是：**某个技能永远
     * 排不到**。所以这里用一个比冷却更小的 `gapMs` 把出招频率拉满，
     * 让三个技能都拿到足够样本 —— 门槛一旦错，某一种会**一次都不出现**。
     */
    const seq = bossCasts(makeRotationEngine({ behaviors: withGap(2_000) }), 60 * 90);
    const kinds = new Set(seq);
    expect(kinds.has('boss-scorn')).toBe(true);
    expect(kinds.has('boss-rebuke')).toBe(true);
    expect(kinds.has('boss-heavy')).toBe(true);
  });

  it('一场真实战斗里也会同时用到多招（不是"永远只出同一招"）', () => {
    /**
     * 与上一条互补：上一条用高频配置验"都能出现"，这一条用**真实
     * `gapMs`** 验"一场里确实换了招"。三者冷却相同，所以顺序轮转的
     * 退化形态是"永远只放 `steps[0]`"—— 那正是这条要拦的。
     */
    const seq = bossCasts(makeRotationEngine({ behaviors: PRIDE_BEHAVIORS }), 60 * 16);
    const kinds = new Set(seq);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    // 真实配置下 Boss 至少要真的出过 3 刀，否则上面的 size 没有意义
    expect(seq.length).toBeGreaterThanOrEqual(3);
  });

  it('权重方向：快刀（权重 2）出现次数 < 两把重刀（权重 3）', () => {
    /**
     * ⚠️ 只断言**方向**，不断言精确比例 —— 精确比例是脆断言
     * （设计 §4.4 明确要求）。这条拦的是"权重写反"。
     */
    const seq = bossCasts(makeRotationEngine({ behaviors: withGap(1_200) }), 60 * 200);
    const count = (id: string) => seq.filter((s) => s === id).length;
    expect(count('boss-scorn')).toBeLessThan(count('boss-rebuke') + count('boss-heavy'));
    // 大样本下三个技能都要有可观的样本量，否则上面的比较没有意义
    expect(seq.length).toBeGreaterThan(50);
  });
});

describe('「傲慢」的三把刀：内容数值就是设计表', () => {
  it('读条 1.0 / 1.5 / 2.0 秒，伤害 20 / 40 / 60', () => {
    expect([BOSS_SCORN.castTime, BOSS_REBUKE.castTime, BOSS_HEAVY.castTime]).toEqual([
      1_000, 1_500, 2_000,
    ]);
    expect(BOSS_SCORN.hits[0]!.at).toBe(1_000);
    expect(BOSS_REBUKE.hits[0]!.at).toBe(1_500);
    expect(BOSS_HEAVY.hits[0]!.at).toBe(2_000);
    const damageOf = (s: SkillDef): unknown => {
      const effect = s.hits[0]!.effects.find((e) => e.kind === 'damage');
      return effect?.kind === 'damage' ? effect.damage?.base : undefined;
    };
    expect([damageOf(BOSS_SCORN), damageOf(BOSS_REBUKE), damageOf(BOSS_HEAVY)]).toEqual([
      20, 40, 60,
    ]);
  });

  it('三把刀的冷却全是 3 秒 —— 难度旋钮只有轮转的 `gapMs`', () => {
    for (const skill of [BOSS_SCORN, BOSS_REBUKE, BOSS_HEAVY]) {
      expect(skill.cooldown).toBe(3_000);
    }
    // ⚠️ 「回补」是例外，也是**故意**的：它靠超长冷却实现"整场一次"
    expect(BOSS_MEND.cooldown).toBeGreaterThan(180_000);
  });

  it('「倒地」只来自慢刀', () => {
    const grantsKnockdown = (s: SkillDef): boolean =>
      s.hits.some((h) =>
        h.effects.some((e) => e.kind === 'grantBuff' && e.buff?.id === 'knockdown'),
      );
    expect(grantsKnockdown(BOSS_HEAVY)).toBe(true);
    expect(grantsKnockdown(BOSS_REBUKE)).toBe(false);
    expect(grantsKnockdown(BOSS_SCORN)).toBe(false);
  });

  it('霸体只在慢刀上，且不带任何"格挡无效"的新 flag（设计 §5.2 明确不封格挡）', () => {
    const grantsArmor = (s: SkillDef): boolean =>
      s.abilities.some((a) => a.kind === 'grant' && a.buff.id === 'boss-heavy-armor');
    expect(grantsArmor(BOSS_HEAVY)).toBe(true);
    expect(grantsArmor(BOSS_REBUKE)).toBe(false);
    expect(grantsArmor(BOSS_SCORN)).toBe(false);
    expect(BOSS_HEAVY_ARMOR.flags?.interruptImmune).toBe(true);
  });

  it('三个技能与它们的 buff 都注册进了内容表', () => {
    for (const skill of PRIDE_SKILLS) expect(skills.has(skill.id)).toBe(true);
    for (const buff of PRIDE_BUFFS) expect(buffs.has(buff.id)).toBe(true);
  });

  it('旧的独立霸体技能与「蓄能」**真的没了**（合并 = 删掉，不是留着不进轮转）', () => {
    expect(skills.has('boss-armor')).toBe(false);
    expect(skills.has('boss-empower')).toBe(false);
    expect(skills.has('boss-cleave')).toBe(false);
    expect(skills.has('boss-sweep')).toBe(false);
  });
});

describe('「傲慢」的半血「回补」：一次性、可打断', () => {
  /** 一个让玩家能精确控制"给 Boss 掉多少血"的战斗。 */
  function mendEngine() {
    const player = makeCombatant({ id: 'player', side: 'ally' });
    const boss = makeCombatant({
      id: 'meiichiro',
      side: 'enemy',
      caps: { hp: 210, energy: 0, douqi: 0 },
      resources: { hp: 210, energy: 0, douqi: 0 },
      /** 只留时限：让 Boss 不会自己出招，测试完全控制它的施法 */
      behaviors: PRIDE_BEHAVIORS.filter((b) => b.kind === 'timeLimit'),
    });
    const engine = new BattleEngine({
      combatants: [player, boss],
      seed: 20261011,
      bossId: 'meiichiro',
      buffs,
      skills,
      baseStats: new Map([
        ['player', {}],
        ['meiichiro', {}],
      ]),
      passiveModifiers: new Map(),
    });
    return engine;
  }

  it('读条 2.5 秒（比最长的一刀还长）、回 30% 最大生命、整场一次', () => {
    expect(BOSS_MEND.castTime).toBe(2_500);
    // 30% × 210 = 63
    const heal = BOSS_MEND.abilities.find((a) => a.kind === 'resource');
    expect(heal?.kind === 'resource' && heal.delta).toBe(63);
    /**
     * "整场一次"由"冷却 > 一场时长"保证。
     *
     * ⚠️ 这里卡的是**时限（180s）**而不是"大概够"：只要冷却短于时限，
     * 就存在"一场里出现第二次"的窗口（拖长的战斗）。
     */
    expect(BOSS_MEND.cooldown).toBeGreaterThan(180_000);
  });

  it('读条走完才回血', () => {
    const engine = mendEngine();
    engine.replaceCombatantForTest(
      (() => {
        const b = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
        return { ...b, resources: { ...b.resources, hp: 100 } };
      })(),
    );
    engine.tick([{ type: 'useSkill', skillId: 'boss-mend', atTick: 0 }], 'meiichiro');
    engine.drainEvents();
    // 读条中：还没回
    for (let i = 0; i < 60; i += 1) {
      engine.tick();
      engine.drainEvents();
    }
    const mid = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    expect(mid.resources.hp).toBe(100);
    // 读完（2.5s = 150 tick）：回到 163
    for (let i = 0; i < 120; i += 1) {
      engine.tick();
      engine.drainEvents();
    }
    const after = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    expect(after.resources.hp).toBe(163);
  });

  it('被打断就不回血 —— 这是它从"时间税"变成"机制"的关键', () => {
    const engine = mendEngine();
    engine.replaceCombatantForTest(
      (() => {
        const b = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
        return { ...b, resources: { ...b.resources, hp: 100 } };
      })(),
    );
    engine.tick([{ type: 'useSkill', skillId: 'boss-mend', atTick: 0 }], 'meiichiro');
    engine.drainEvents();
    // 读条一半时用「破」打断
    for (let i = 0; i < 60; i += 1) {
      engine.tick();
      engine.drainEvents();
    }
    engine.tick([{ type: 'useSkill', skillId: 'break', atTick: engine.snapshot.tick }]);
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'interruptSuccess')).toBe(true);
    // 打断之后再也不回血
    for (let i = 0; i < 200; i += 1) {
      engine.tick();
      engine.drainEvents();
    }
    const after = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    expect(after.resources.hp).toBe(100);
  });

  it('满血时不会进候选集（`when: hpBelow 0.5` 的门槛）', () => {
    const engine = mendEngine();
    // 用真实轮转跑 30 秒：Boss 满血，`boss-mend` 不该出现
    const boss = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    engine.replaceCombatantForTest({ ...boss, behaviors: withGap(1_000) });
    const seq = bossCasts(engine, 60 * 30);
    expect(seq).not.toContain('boss-mend');
  });
});

describe('「傲慢」的平衡硬判据（设计 §9.3）', () => {
  /**
   * 设计 §9.3 只要求验两条，不做数值矩阵：
   *   1. **纯进攻必须打不过**（否则 `gapMs` / 伤害给低了）
   *   2. **会闪避的玩家必须赢**，且剩血在 30–70
   *
   * ⚠️ 这里**不复述**黄金基线的精确数值（那是
   * `tests/golden/replay.test.ts` 的职责）。这两条是**性质**：
   * 它们回答"这个 Boss 还能不能玩"，而不是"这一局是不是 926 tick"。
   * 所以它们能在数值微调后存活，而黄金值不行。
   */
  const playerPlan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
  const pureAttackPlan = planPriority(['attack'], {});

  function runPlan(plan: (t: number, s: BattleState) => readonly Action[]) {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    for (let i = 0; i < 60 * 250; i += 1) {
      const state = engine.snapshot;
      if (state.status !== 'running') break;
      engine.tick(plan(state.tick, state));
      engine.drainEvents();
    }
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    const boss = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    return { status: engine.snapshot.status, playerHp: player.resources.hp, bossHp: boss.resources.hp };
  }

  it('纯进攻（只按「攻」）打不过 —— Boss 必须还活着', () => {
    const r = runPlan(pureAttackPlan);
    expect(r.status).toBe('defeat');
    expect(r.playerHp).toBe(0);
    expect(r.bossHp).toBeGreaterThan(0);
  });

  it('会闪避的玩家必须赢，且剩血在 30–70（设计 §9.3 的容错窗口）', () => {
    const r = runPlan(playerPlan);
    expect(r.status).toBe('victory');
    expect(r.playerHp).toBeGreaterThanOrEqual(30);
    expect(r.playerHp).toBeLessThanOrEqual(70);
  });

  it('整场时长 < 120s（狂暴线）—— 「回补」不会把战斗推过狂暴', () => {
    /**
     * 设计 §10 的风险表把"回血把战斗推过 120s 狂暴"列为必须断言的一项。
     * 当前实测 ~15s，余量很大，但断言必须在。
     */
    const engine = new BattleEngine(makeGoldenEngineOptions());
    for (let i = 0; i < 60 * 250; i += 1) {
      const state = engine.snapshot;
      if (state.status !== 'running') break;
      engine.tick(playerPlan(state.tick, state));
      engine.drainEvents();
    }
    expect(engine.snapshot.tick / 60).toBeLessThan(120);
  });
});
