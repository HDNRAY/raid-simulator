import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { applyBuff } from '../../src/core/buffs';
import { ENTROPY_CLOCK } from '../../src/data/entities/entropyClock';
import { ALL_BUFFS, ALL_SKILLS, HASTE_BUFF } from '../../src/data/content';
import type { BuffDef, Combatant, StatModifier } from '../../src/core/types';

/**
 * 属性溯源（数据模型规范 §5.4）。
 *
 * 这条规范是"**必须**有"而不是"最好有"：数值问题一旦出现，
 * "为什么是 3.2 而不是 2.5"是最高频的问题。没有溯源就只能靠猜。
 *
 * 而且溯源必须与真实计算**出自同一次求值** —— 所以这里同时断言
 * `statsOf` 与 `statsBreakdownOf` 的一致性。
 */

const localeKeysUnused = ALL_BUFFS;

function player(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'player',
    nameKey: 'hud.you',
    side: 'ally',
    caps: { hp: 10_000, energy: 120, douqi: 100 },
    resources: { hp: 10_000, energy: 120, douqi: 0 },
    counters: {},
    basePrimary: { strength: 100, agility: 100, intelligence: 100, spirit: 100 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
    ...overrides,
  };
}

/**
 * ⚠️ 基础属性只来自 `baseStats`，**不是** `Combatant.basePrimary`。
 *
 * `basePrimary` 是"角色的天生资质"（内容侧数据），而结算读的是引擎
 * 参数里的 `baseStats`。早期我误以为改 `basePrimary` 会影响结算，
 * 于是写出了一条永远通过的测试 —— 这类"断言了一个不参与计算的字段"
 * 的测试比没有测试更糟，因为它会让人以为覆盖到了。
 */
function makeEngine(
  passive: readonly StatModifier[] = [],
  baseStats: Partial<Record<keyof typeof EMPTY, number>> = { strength: 100, intelligence: 100 },
): BattleEngine {
  return new BattleEngine({
    combatants: [player(), player({ id: 'dummy', side: 'enemy' })],
    seed: 1,
    buffs: new Map(ALL_BUFFS.map((b) => [b.id, b])),
    skills: new Map(ALL_SKILLS.map((s) => [s.id, s])),
    baseStats: new Map([['player', baseStats], ['dummy', {}]]),
    passiveModifiers: new Map([['player', passive]]),
  });
}

/** 仅用于给上面的 baseStats 参数一个键类型。 */
const EMPTY = { strength: 0, intelligence: 0 };

/** 熵之钟的被动修正（modifier + derived）。 */
function clockModifiers(): StatModifier[] {
  const out: StatModifier[] = [];
  for (const ability of ENTROPY_CLOCK.abilities) {
    if (ability.kind === 'modifier') out.push(ability.modifier);
    else if (ability.kind === 'derived') out.push({ ...ability.modifier, value: ability.value });
  }
  return out;
}

describe('属性溯源', () => {
  it('基础值单独列出（不是混进加法层）', () => {
    const engine = makeEngine();
    const bd = engine.statsBreakdownOf('player')!;
    expect(bd.strength?.base).toBe(100);
    expect(bd.strength?.add).toBe(0);
  });

  it('装备的加法修正记在 add 层，并带上来源 key', () => {
    const engine = makeEngine(clockModifiers());
    const bd = engine.statsBreakdownOf('player')!;
    expect(bd.intelligence?.base).toBe(100);
    expect(bd.intelligence?.add).toBe(2); // 熵之钟 +2 智力
    expect(bd.intelligence?.flat.some((f) => f.sourceKey === 'entity.entropyClock.name')).toBe(true);
    expect(bd.intelligence?.final).toBe(102);
  });

  it('派生修正进 derived 层，且注明是派生来源', () => {
    const engine = makeEngine(clockModifiers());
    const bd = engine.statsBreakdownOf('player')!;
    // 势能 = 0.1 × 智力 = 0.1 × 102 = 10.2
    const derived = bd.damageBoost?.derived ?? [];
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.some((d) => d.sourceKey === 'entity.entropyClock.name')).toBe(true);
    expect(bd.damageBoost?.percentSum).toBeCloseTo(10.2, 5);
  });

  it('溯源与真实计算一致（同一次求值）', () => {
    const engine = makeEngine(clockModifiers());
    const values = engine.statsOf('player');
    const bd = engine.statsBreakdownOf('player')!;
    for (const key of Object.keys(values) as Array<keyof typeof values>) {
      const entry = bd[key];
      if (!entry) continue;
      const fromBreakdown =
        entry.base +
        entry.add +
        entry.derived.reduce((sum, d) => sum + d.value, 0) +
        entry.percentSum;
      // 只对 accumulator 语义的 stat 做这个线性校验
      if (key === 'intelligence' || key === 'strength' || key === 'spirit') {
        expect(values[key]).toBeCloseTo(fromBreakdown, 6);
      }
    }
  });

  it('buff 的修正在溯源里带 buffId 命名空间', () => {
    const engine = makeEngine();
    const combatant = engine.snapshot.combatants[0]!;
    const haste: BuffDef = HASTE_BUFF;
    const applied = applyBuff(combatant, haste, combatant.id, 0);
    engine.replaceCombatantForTest({ ...combatant, buffs: applied.buffs });

    const bd = engine.statsBreakdownOf('player')!;
    // HASTE_BUFF 用的是 `op: 'add'`，所以进 add 层；值是 0.2（不是 20）
    expect(bd.haste?.add).toBeCloseTo(0.2, 5);
    expect(bd.haste?.final).toBeCloseTo(0.2, 5);
    expect(bd.haste?.flat.some((f) => f.namespace === 'haste-buff')).toBe(true);
  });

  it('buff 消失后溯源里不再有它的贡献（动态重算）', () => {
    const engine = makeEngine();
    const combatant = engine.snapshot.combatants[0]!;
    const applied = applyBuff(combatant, HASTE_BUFF, combatant.id, 0);
    engine.replaceCombatantForTest({ ...combatant, buffs: applied.buffs });
    expect(engine.statsBreakdownOf('player')!.haste?.add).toBeCloseTo(0.2, 5);

    // 摘掉 buff（模拟过期）
    engine.replaceCombatantForTest({ ...combatant, buffs: [] });
    expect(engine.statsBreakdownOf('player')!.haste?.add ?? 0).toBe(0);
    // 派生值也要跟着回落：增伤回到 0（没有装备时）
    expect(engine.statsOf('player').haste).toBe(0);
  });

  it('没有装备时派生增伤为 0（说明它真的来自装备）', () => {
    const engine = makeEngine();
    expect(engine.statsBreakdownOf('player')!.damageBoost?.percentSum ?? 0).toBe(0);
    expect(engine.statsOf('player').damageBoost).toBe(0);
  });

  it('基础智力更高时，派生的增伤也更高（动态重算的连锁）', () => {
    // 势能 = 0.1 × (智力 + 2)
    const low = makeEngine(clockModifiers(), { intelligence: 50 });
    const high = makeEngine(clockModifiers(), { intelligence: 150 });
    expect(low.statsOf('player').damageBoost).toBeCloseTo(5.2, 5);
    expect(high.statsOf('player').damageBoost).toBeCloseTo(15.2, 5);
    expect(high.statsOf('player').damageBoost).toBeGreaterThan(low.statsOf('player').damageBoost);
  });

  void localeKeysUnused;
});
