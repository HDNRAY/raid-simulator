import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff, aggregateFlags } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import {
  GREED_BEHAVIORS,
  GREED_HOARD,
  GREED_WEAK_POINT,
  GREED_WEAK_POINT_PASSIVE,
} from '../../src/data/greedBoss';
import type { BuffDef, Combatant, SkillDef, StatKey } from '../../src/core/types';
import { makeCombatant, makeSkillDef } from './helpers';

/**
 * **「贪婪」的机制** + 这一轮新加的两个**公共机制**：
 *
 *   1. `haste` —— 读条 / 冷却的公共缩放（"减读条时间、减 CD"都走它）
 *   2. `onTick` + `cooldownRangeMs` —— **按时间、随机间隔**的触发器
 *      （「弱点」是"每 3–5 秒"）
 *
 * ⚠️ 这里**不钉具体数值**（AGENTS.md §4 的判据：数值会经常调、且黄金
 * 基线已经覆盖）：层数上限、每层 +10% 这些一律**从内容里取**
 * （`GREED_HOARD.maxStacks` / `damageMultBoost`），所以调平衡不会让这些
 * 用例变红。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

function engineWith(args: {
  readonly player: Partial<Combatant>;
  readonly boss: Partial<Combatant>;
  readonly skills: readonly SkillDef[];
  readonly buffs?: readonly BuffDef[];
}): BattleEngine {
  const registry = createRegistry(
    {
      entities: [],
      skills: [...ALL_SKILLS, ...args.skills],
      buffs: [...ALL_BUFFS, ...(args.buffs ?? [])],
    },
    { localeKeys: i18nKeys },
  );
  return new BattleEngine({
    combatants: [
      makeCombatant({ id: 'player', side: 'ally', ...args.player }),
      makeCombatant({ id: 'boss', side: 'enemy', ...args.boss }),
    ],
    seed: 987,
    bossId: 'boss',
    timeLimitMs: 60_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', {}],
      ['boss', {}],
    ]),
    passiveModifiers: new Map(),
  });
}

/** 把一个 buff 挂到某个单位的初始状态上（走 `applyBuff`，不手写实例）。 */
function withBuff(partial: Partial<Combatant>, def: BuffDef, stacks?: number): Partial<Combatant> {
  const bare = makeCombatant({ id: 'player', side: 'ally', ...partial });
  let combatant = bare;
  const layers = stacks ?? 1;
  for (let i = 0; i < layers; i += 1) {
    combatant = { ...combatant, buffs: applyBuff(combatant, def, combatant.id, 0).buffs };
  }
  return { ...partial, buffs: combatant.buffs };
}

const statsOf = (e: BattleEngine, id: string): Readonly<Record<StatKey, number>> => e.statsOf(id);

/* ================================================================== *
 * 1. 「敛财」：每层都**全面**变强（伤害 / 回血 / 读条）
 * ================================================================== */

describe('「敛财」：每层伤害 / 回血 / 读条一起变强，且卡在 9 层', () => {
  it(`叠满 ${GREED_HOARD.maxStacks} 层：伤害按**加算**提升（每层 +10%）`, () => {
    const max = GREED_HOARD.maxStacks;
    const e = engineWith({
      player: {},
      boss: withBuff({}, GREED_HOARD, max),
      skills: [],
    });
    /**
     * ⚠️ 2026-10-22：`damageMultBoost`（逐层相乘）删掉了，统一走
     * `damageBoost`（`perStackAdd`，**加算**）⇒ 9 层 = +90%，即 ×1.9
     * （旧的乘算是 ×2.36）。数值从**内容**读，不写死。
     */
    const perStack = GREED_HOARD.modifiers?.find((m) => m.stat === 'damageBoost');
    expect(perStack?.op, '「敛财」的增伤应当是加算').toBe('add');
    const percent = typeof perStack?.value === 'number' ? perStack.value : 0;
    /**
     * ⚠️ 断言的是 **`damageBoost`** 这个统计项（伤害计算里真正的消费者），
     * 不是 `damageMult` —— 后者是"整体输出倍率"的另一条路（`damageMultBoost`
     * 删掉之后它不再被这条 buff 影响）。
     */
    expect(statsOf(e, 'boss').damageBoost).toBeCloseTo(percent * max, 6);
  });

  it('层数**封顶**：叠第 10 次不会再涨', () => {
    const e = engineWith({
      player: {},
      boss: withBuff({}, GREED_HOARD, GREED_HOARD.maxStacks + 1),
      skills: [],
    });
    const stacks = e.snapshot.combatants
      .find((c) => c.id === 'boss')
      ?.buffs.filter((b) => b.defId === GREED_HOARD.id)
      .reduce((sum, b) => sum + b.stacks, 0);
    expect(stacks).toBe(GREED_HOARD.maxStacks);
  });

  it('每层都带**读条**与**回血**（"全面"三个字的两半）', () => {
    const e = engineWith({
      player: {},
      boss: withBuff({}, GREED_HOARD, 3),
      skills: [],
    });
    const stats = statsOf(e, 'boss');
    expect(stats.haste, '读条 / 冷却的公共缩放').toBeGreaterThan(0);
    expect(stats.hpRegen, '每秒回血').toBeGreaterThan(0);
  });

  /**
   * ⚠️ `haste` 是**读条与冷却的唯一来源**（`castPipeline` 里
   * `hastedCastTime` / `hastedCooldown` 都读它）—— 所以"减读条时间、减 CD"
   * 是**公共机制**，任何内容都能用，不是贪婪专属。这条钉住那个契约。
   */
  /**
   * ⚠️ **2026-10-15 补的一条**（它抓的是一个真实的坑）。
   *
   * 「敛财」的层数上限一直是 9，但**实战里永远到不了** —— `stacking.mode`
   * 当时是 `'stack'`（**不刷新时长**），于是 12 秒是从**第 1 层**起算的：
   * 真引擎实测（玩家不还手）`2.0s→1 层 / 7.8s→2 层 / 13.0s→3 层`，
   * 然后整条过期、从头再来。用户原话："3. 修复9层"。
   *
   * ⚠️ 这条断言**不钉时间**（叠满要几秒是平衡，会变），只钉"**这个上限
   * 是能到达的**"：一只"写了 9 层却永远到不了"的 Boss，与"没有这一招"
   * 在玩家眼里是一样的（而这里正是"越拖越难"的全部内容）。
   */
  it('只要不打断，层数真的会叠到上限（`stackRefresh`：时长随施放刷新）', () => {
    const engine = engineWith({
      player: {
        caps: { hp: 99_999, energy: 120, douqi: 0 },
        resources: { hp: 99_999, energy: 120, douqi: 0 },
      },
      boss: { behaviors: GREED_BEHAVIORS },
      skills: [],
    });
    const stacksNow = (): number =>
      engine.snapshot.combatants
        .find((c) => c.id === 'boss')
        ?.buffs.filter((b) => b.defId === GREED_HOARD.id)
        .reduce((sum, b) => sum + b.stacks, 0) ?? 0;

    let max = 0;
    /** 上限只是"别跑太久"：真值远小于它（叠满约 20 秒）。 */
    for (let t = 0; t < 60 * 90; t += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick();
      engine.drainEvents();
      max = Math.max(max, stacksNow());
    }
    expect(max, '这一招的上限必须**到得了**（否则 9 层只是装饰）').toBe(
      GREED_HOARD.maxStacks,
    );
  });

  it('`haste` 的钳制生效（[0, 0.5]）：9 层的读条收益被封顶，但伤害照涨', () => {
    const e = engineWith({
      player: {},
      boss: withBuff({}, GREED_HOARD, GREED_HOARD.maxStacks),
      skills: [],
    });
    const stats = statsOf(e, 'boss');
    expect(stats.haste).toBeLessThanOrEqual(0.5);
    /** ⚠️ 同上：看 `damageBoost`（每层 +10% × 9 层 = +90）。 */
    expect(stats.damageBoost).toBeGreaterThan(50);
  });
});

/* ================================================================== *
 * 2. 「弱点」：双方各挂一层、受伤翻倍
 * ================================================================== */

describe('「弱点」：挂着的人受到的伤害翻倍', () => {
  const WEAK = makeSkillDef({
    id: 'test-hit',
    nameKey: 'skill.attack.name',
    castTime: 0,
    hits: [
      { at: 0, effects: [{ kind: 'damage', damage: { base: 40, canCrit: false, countsAsHit: true } }] },
    ],
  });

  function hitWithWeakPoint(onPlayer: boolean, onBoss: boolean): number {
    const e = engineWith({
      player: onPlayer
        ? withBuff(
            { caps: { hp: 1000, energy: 0, douqi: 0 }, resources: { hp: 1000, energy: 0, douqi: 0 } },
            GREED_WEAK_POINT,
          )
        : { caps: { hp: 1000, energy: 0, douqi: 0 }, resources: { hp: 1000, energy: 0, douqi: 0 } },
      boss: onBoss
        ? withBuff(
            { caps: { hp: 1000, energy: 0, douqi: 0 }, resources: { hp: 1000, energy: 0, douqi: 0 } },
            GREED_WEAK_POINT,
          )
        : { caps: { hp: 1000, energy: 0, douqi: 0 }, resources: { hp: 1000, energy: 0, douqi: 0 } },
      skills: [WEAK],
    });
    e.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: 0 }], 'player');
    e.drainEvents();
    return 1000 - (e.snapshot.combatants.find((c) => c.id === 'boss')?.resources.hp ?? 0);
  }

  it('没有弱点 → 正常伤害（40）', () => {
    expect(hitWithWeakPoint(false, false)).toBe(40);
  });

  it('**挨打的那一方**带弱点 → 伤害翻倍（80）', () => {
    expect(hitWithWeakPoint(false, true)).toBe(80);
  });

  it('⚠️ 弱点挂在**攻击者**身上**不**放大伤害（判据是"挨打方的"）', () => {
    /**
     * ⚠️ 这条是"双方各挂一层"那个设计的**关键半句**：若实现读错了一侧
     * （读到攻击者身上），"双方都翻倍"会变成"打得越快越痛"——
     * 而它在画面上看不出区别（伤害数字同样变大）。
     */
    expect(hitWithWeakPoint(true, false)).toBe(40);
  });

  it('`aggregateFlags` 不算它 —— 它是修正，不是判定旗标', () => {
    const e = engineWith({
      player: {},
      boss: withBuff({}, GREED_WEAK_POINT),
      skills: [],
    });
    const boss = e.snapshot.combatants.find((c) => c.id === 'boss');
    expect(boss === undefined ? undefined : aggregateFlags(boss)).toEqual({});
  });
});

/* ================================================================== *
 * 3. `onTick` + `cooldownRangeMs`：按时间、随机间隔
 * ================================================================== */

describe('`onTick` + `cooldownRangeMs`：按时间来的触发器（「弱点」被动）', () => {
  function tickEngine(): BattleEngine {
    return engineWith({
      player: { caps: { hp: 1000, energy: 0, douqi: 0 }, resources: { hp: 1000, energy: 0, douqi: 0 } },
      boss: withBuff(
        { caps: { hp: 1000, energy: 0, douqi: 0 }, resources: { hp: 1000, energy: 0, douqi: 0 } },
        GREED_WEAK_POINT_PASSIVE,
      ),
      skills: [],
    });
  }

  const weakCount = (e: BattleEngine, id: string): number =>
    e.snapshot.combatants
      .find((c) => c.id === id)
      ?.buffs.filter((b) => b.defId === GREED_WEAK_POINT.id).length ?? 0;

  it('静置足够久 → **双方**都拿到弱点（不需要任何人挨打）', () => {
    const e = tickEngine();
    /** 上限 5 秒 ⇒ 跑 6 秒必定跨过一次间隔（`[3000, 5000]`）。 */
    for (let i = 0; i < 6 * 60; i += 1) e.tick([]);

    expect(weakCount(e, 'boss'), '贪婪自己也会露弱点').toBeGreaterThan(0);
    expect(weakCount(e, 'player'), '玩家那边同时出现').toBeGreaterThan(0);
  });

  it('⚠️ 随机间隔走**种子化 RNG**：同一个 seed 跑两次，出现时刻完全相同', () => {
    const run = (): number => {
      const e = tickEngine();
      for (let i = 0; i < 6 * 60; i += 1) {
        e.tick([]);
        if (weakCount(e, 'player') > 0) return i;
      }
      return -1;
    };
    expect(run()).toBe(run());
  });

  it('出现 → 过期 → 再过 1–3 秒（= CD 3–5 秒减去 2 秒弱点）又出现', () => {
    /**
     * ⚠️ 测的是**两次出现之间**的间隔，不是"从过期算起"。
     *
     * 因为 CD 是**从上一次触发**算的：弱点持续 2 秒，所以
     * "出现 → 下一次出现" = `max(CD, buff 时长)`。
     * 用户的 `cooldownRangeMs = [3000, 5000]` ⇒ 期望落在
     * `[2s + 3s, 2s + 5s] = [300, 420] tick`。
     *
     * ⚠️ 触发器第一次没有历史 CD，所以第一个 tick 就会出现（既有语义：
     * "挂上就生效"）。
     */
    const e = tickEngine();
    const appears = (): boolean => weakCount(e, 'player') > 0;

    e.tick([]);
    expect(appears(), '第一次立刻触发（没有历史 CD）').toBe(true);

    /** 记录"从消失到再次出现"的间隔（= 下一次 trigger 的真实间隔）。 */
    let sawAndLost = false;
    let lostAt = 0;
    let gap = -1;
    for (let i = 1; i < 15 * 60; i += 1) {
      e.tick([]);
      if (!sawAndLost && !appears()) {
        sawAndLost = true;
        lostAt = i;
      } else if (sawAndLost && appears()) {
        gap = i - lostAt;
        break;
      }
    }

    /**
     * ⚠️ `gap` 是"**从弱点过期**到它再次出现"的间隔。
     *
     * 因为 CD 是**从上一次触发**算的（3–5 秒），而弱点持续 2 秒 ——
     * 所以过期之后还剩 `CD − 2s`，也就是 **1–3 秒**。
     * 断言写这个区间（含 ±2 tick 的边界余量）。
     */
    expect(gap, '必须等到下一次触发').toBeGreaterThan(0);
    expect(gap).toBeGreaterThanOrEqual(1 * 60 - 2);
    expect(gap).toBeLessThanOrEqual(3 * 60 + 2);
  });
});
