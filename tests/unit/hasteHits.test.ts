import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { applyBuff } from '../../src/core/buffs';
import { S } from '../../src/data/scale';
import { makeBuffDef, makeCombatant, makeSkillDef } from './helpers';
import type { BuffDef, StatKey } from '../../src/core/types';

/**
 * **急速不许把命中吃掉**（2026-10-20 修掉的真 bug，回归守卫）。
 *
 * 现场：`advanceCasts` 的判据是 `castDone && hit.at <= elapsedMs`，而
 * `castDone` 比的是**算过急速**的 `castTimeMs`、`hit.at` 是内容里的
 * **原始**偏移（Boss 的招全是 `at === castTime`）⇒ **任何 haste > 0**
 * 都让读条提前结束，而那时 `elapsedMs < hit.at` ⇒ 这一击**永远不结算**，
 * 读条随即被丢掉 ⇒ **静默无伤害**。
 *
 * 症状是「贪婪」「暴怒」在高急速阶段变成木桩 —— 而画面上完全看不出来。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
  'stat.strength',
  'stat.haste',
]);

/** 一刀 30 伤、读条 2.0 秒、命中点就在读条末尾（与 Boss 的写法一致）。 */
function slowHit() {
  return makeSkillDef({
    id: 'test-slow-hit',
    castTime: 2000,
    hits: [
      {
        at: 2000,
        effects: [{ kind: 'damage', damage: { base: S(30), canCrit: false, countsAsHit: true } }],
      },
    ],
  });
}

function hasteBuff(value: number): BuffDef {
  return makeBuffDef({
    id: 'test-haste',
    duration: Number.POSITIVE_INFINITY,
    modifiers: [{ stat: 'haste', op: 'add', value, sourceKey: 'stat.haste' }],
  });
}

function playerHpAfter(haste: number): number {
  const skill = slowHit();
  const buff = hasteBuff(haste);
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS, skill], buffs: [...ALL_BUFFS, buff] },
    { localeKeys: i18nKeys },
  );
  /** 给 Boss 挂急速（模拟「敛财」层数 / 「怒火」）。 */
  const bareBoss = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 999, energy: 0, douqi: 50 },
    resources: { hp: 999, energy: 0, douqi: 50 },
  });
  const boss =
    haste > 0
      ? { ...bareBoss, buffs: applyBuff(bareBoss, buff, 'boss', 0).buffs }
      : bareBoss;
  const engine = new BattleEngine({
    combatants: [
      boss,
      makeCombatant({
        id: 'player',
        side: 'ally',
        caps: { hp: 500, energy: 120, douqi: 0 },
        resources: { hp: 500, energy: 120, douqi: 0 },
      }),
    ],
    seed: 5,
    bossId: 'boss',
    timeLimitMs: 60_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['boss', {}],
      ['player', {}],
    ]),
    passiveModifiers: new Map(),
  });
  engine.tick([{ type: 'useSkill', skillId: 'test-slow-hit', atTick: 0 }], 'boss');
  for (let i = 0; i < 200; i += 1) {
    engine.tick([]);
    engine.drainEvents();
  }
  return engine.snapshot.combatants.find((c) => c.id === 'player')?.resources.hp ?? -1;
}

describe('急速 × 命中（回归）', () => {
  it('没有急速：读条末尾那一刀**打得到**', () => {
    expect(playerHpAfter(0)).toBe(470);
  });

  it('⚠️ **有急速也一样打得到**（修之前这里永远是 500 = 一点伤害都没有）', () => {
    expect(playerHpAfter(0.25)).toBe(470);
    expect(playerHpAfter(0.4)).toBe(470);
  });
});
