import { describe, expect, it } from 'vitest';

import { computeDamage } from '../../src/core/combat/damage';
import { skipEnergyRegenStep } from '../../src/core/combat/energyRhythm';
import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { STAT_RULES } from '../../src/core/stats/aggregate';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { applyBuff } from '../../src/core/buffs';
import { S } from '../../src/data/scale';
import { makeBuffDef, makeCombatant, makeSkillDef } from './helpers';
import type { BuffDef, Combatant, StatKey } from '../../src/core/types';

/**
 * 「恶魔低语」的三条**引擎机制**（2026-10-16）。
 *
 * 另外三条（狂暴按档 / 回血读条 / 二阶段）不在这里 —— 它们不需要新引擎
 * 能力（行为裁剪与内容），见 `docs/plans/2026-10-16-difficulty-curve.md`。
 *
 * ⚠️ 这些用例**只钉机制**（谁读谁 / 门槛 / 保底 / 节奏），数值一律从
 * 内容或参数取 —— 难度会反复调（`AGENTS.md` §4 的判据）。
 */

/**
 * 攻方属性**全零**表 —— `computeDamage` 只读 `scaling` 里点名的属性，
 * 这里测的是"基底 ± 门槛/平减"，所以全零最干净。
 *
 * ⚠️ 不写真字面量对象：`StatKey` 有 20 多个键，写一半会被类型检查拦下
 * （那是对的），于是从 `STAT_RULES` 反查键名 —— 加新属性时这里自动跟上。
 */
function emptyStats(): Readonly<Record<StatKey, number>> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(STAT_RULES)) out[key] = 0;
  return asAllStatsZero(out);
}

/**
 * **有名字的解析器**（`AGENTS.md` §1 允许的那种 `as`）：键名从
 * `STAT_RULES` 反查 ⇒ 运行期确实是全表，类型上只差这一句签字。
 * 只此一处，而且名字把"这里确实是全零表"说清楚了。
 */
function asAllStatsZero(value: Record<string, number>): Readonly<Record<StatKey, number>> {
  return value as Readonly<Record<StatKey, number>>;
}

/* ================================================================== *
 * 1. 所有伤害 −5（**保底 3**）—— 只平减，不整击作废
 * ================================================================== */

describe('「恶魔低语」· 所有伤害 −5（保底 3）', () => {
  const spill = { amount: 5, floor: 3 };

  const dmg = (base: number, flags?: Parameters<typeof computeDamage>[2]): number =>
    computeDamage(
      { base: S(base), canCrit: false, countsAsHit: true },
      emptyStats(),
      flags ?? {},
      { crit: false, multiplier: 1 },
    ).amount;

  it('平减 `amount` 点（30 → 25）', () => {
    expect(dmg(30, { flatDamageReduce: spill })).toBe(30 - spill.amount);
  });

  it('**保底**：本来只有 5 点的一击不会被削成 0/负数', () => {
    expect(dmg(5, { flatDamageReduce: spill })).toBe(spill.floor);
  });

  it('⚠️ 保底**不是加伤**：本来 2 点的一击还是 2 点', () => {
    expect(dmg(2, { flatDamageReduce: spill })).toBe(2);
  });

  it('⚠️ 它**不做"整击作废"**（那是「卸」的 `damageThreshold`）', () => {
    /**
     * 用户 2026-10-16 点名的就是这条：「击」5 点被"≤N 整击作废"吃掉之后
     * 一点伤害都没有，而且小伤害段上的打断/眩晕会被"连效果一起免"顺带免掉。
     * 所以两者必须能**同时存在**且互不干扰。
     */
    const both = { damageThreshold: 15, flatDamageReduce: spill };
    expect(dmg(30, both), '阈值先平减 15，再按低语 −5').toBe(30 - 15 - spill.amount);
    expect(dmg(5, both), '阈值把它压到 0 ⇒ 保底按**阈值之后**的 0 算 ⇒ 仍是 0').toBe(0);
  });

  it('没有这条 flag 时一切照旧（回归）', () => {
    expect(dmg(30)).toBe(30);
    expect(dmg(5)).toBe(5);
  });
});

/* ================================================================== *
 * 2. 回炁变慢 —— **整数节奏**（不是乘 0.8）
 * ================================================================== */

describe('「恶魔低语」· 回炁变慢（整数节奏）', () => {
  it('`scale = 1` 一步都不跳', () => {
    for (let step = 0; step < 50; step += 1) {
      expect(skipEnergyRegenStep({ step, scale: 1 })).toBe(false);
    }
  });

  it('`scale = 0.8` ⇒ 每 5 个逻辑步跳 1 步（= 8/秒）', () => {
    const skipped = Array.from({ length: 50 }, (_, step) =>
      skipEnergyRegenStep({ step, scale: 0.8 }),
    ).filter(Boolean).length;
    expect(skipped, '50 步里跳 10 步').toBe(10);
  });

  it('`scale = 0` ⇒ 一步都不回', () => {
    expect(skipEnergyRegenStep({ step: 3, scale: 0 })).toBe(true);
  });

  it('⚠️ 实测量：10 秒里回的炁 = 80（对照基线 100）', () => {
    /**
     * ⚠️ 这条断言**故意写"实测量"**（不是"buff 挂上了"）——
     * 直接乘 0.8 会被 `Math.round` 吃掉（每步照样 +1 ⇒ 100），
     * 走 `energyRegen` 属性又会被 `floor` 吃掉（⇒ 0）。两种坏法都
     * "不报错"，只有量出来的数才认得出它们。
     */
    const slow: BuffDef = makeBuffDef({
      id: 'test-breath',
      duration: Number.POSITIVE_INFINITY,
      modifiers: [{ stat: 'energyRegenScale', op: 'mult', value: 0.8, sourceKey: 'stat.haste' }],
    });
    const measure = (buff: boolean): number => {
      let player: Combatant = makeCombatant({
        id: 'player',
        side: 'ally',
        resources: { hp: 1000, energy: 0, douqi: 0 },
      });
      if (buff) player = { ...player, buffs: applyBuff(player, slow, 'player', 0).buffs };
      const engine = new BattleEngine({
        combatants: [player, makeCombatant({ id: 'boss', side: 'enemy' })],
        seed: 1,
        bossId: 'boss',
        timeLimitMs: 60_000,
        buffs: new Map([[slow.id, slow]]),
        skills: new Map(),
        baseStats: new Map(),
        passiveModifiers: new Map(),
      });
      /** 10 秒 = 100 个逻辑步。 */
      for (let t = 0; t < 600; t += 1) {
        engine.tick([]);
        engine.drainEvents();
      }
      return engine.snapshot.combatants.find((c) => c.id === 'player')?.resources.energy ?? -1;
    };
    expect(measure(false)).toBe(100);
    expect(measure(true)).toBe(80);
  });
});

/* ================================================================== *
 * 3. 挨打不回缠
 * ================================================================== */

describe('「恶魔低语」· 挨打不回缠', () => {
  const i18nKeys = new Set([
    ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
    ...ALL_BUFFS.map((b) => b.nameKey),
    /** 测试自己造的那两个 def 用的是 `makeSkillDef` / `makeBuffDef` 的占位 key。 */
    'stat.strength',
    'stat.haste',
  ]);

  /** 让 Boss 打玩家一下，返回玩家最终拿到了多少缠。 */
  function douqiAfterOneHit(withFlag: boolean): number {
    const hitter = makeSkillDef({
      id: 'test-hit',
      hits: [
        {
          at: 0,
          effects: [{ kind: 'damage', damage: { base: S(30), canCrit: false, countsAsHit: true } }],
        },
      ],
    });
    const mute = makeBuffDef({
      id: 'test-mute-douqi',
      duration: Number.POSITIVE_INFINITY,
      flags: { noDouqiOnHitTaken: true },
    });
    const registry = createRegistry(
      { entities: [], skills: [...ALL_SKILLS, hitter], buffs: [...ALL_BUFFS, mute] },
      { localeKeys: i18nKeys },
    );
    let player: Combatant = makeCombatant({
      id: 'player',
      side: 'ally',
      resources: { hp: 1000, energy: 0, douqi: 0 },
    });
    if (withFlag) player = { ...player, buffs: applyBuff(player, mute, 'player', 0).buffs };
    /**
     * ⚠️ 让 **Boss** 打玩家（不是玩家打 Boss）—— 这一条测的是
     * **挨打**的那一方。第一版我写成玩家 `useSkill`，于是拿到缠的是
     * **施放者**（"施放者那一半"由另一条规则管），用例测错了对象。
     */
    const boss = makeCombatant({
      id: 'boss',
      side: 'enemy',
      behaviors: [{ kind: 'onCooldown', skillId: 'test-hit' }],
    });
    const engine = new BattleEngine({
      combatants: [player, boss],
      seed: 7,
      bossId: 'boss',
      timeLimitMs: 60_000,
      buffs: registry.buffs,
      skills: registry.skills,
      baseStats: new Map(),
      passiveModifiers: new Map(),
    });
    for (let t = 0; t < 60; t += 1) {
      engine.tick([]);
      engine.drainEvents();
    }
    return engine.snapshot.combatants.find((c) => c.id === 'player')?.resources.douqi ?? -1;
  }

  it('默认：挨打照旧攒缠（对照）', () => {
    expect(douqiAfterOneHit(false)).toBeGreaterThan(0);
  });

  it('挂了这条 flag：挨打**一点缠都不给**', () => {
    expect(douqiAfterOneHit(true)).toBe(0);
  });
});
