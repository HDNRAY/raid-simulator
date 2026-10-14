import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import type { BuffDef, Combatant, SkillDef, StatKey } from '../../src/core/types';
import { makeBuffDef, makeCombatant, makeSkillDef } from './helpers';

/**
 * **吸收壳**（`BuffInstance.absorb`）—— 「血盾」的地基。
 *
 * 用户定死的形状："**(a) 池子**（打空 = 破 = 还你血）"，而且
 * "**shield 不也是一个 buff 吗**" —— 所以池子挂在 buff 实例上，
 * 而"**打空 = 把那条 buff 摘掉**"，于是内容用 `onBuffExpired` 触发器
 * 就能在"碎了"那一刻做事。
 *
 * 三条必须钉住的：
 *   1. 壳**先吃伤害**（血不掉）
 *   2. 壳**扣光就碎**（那条 buff 消失 → `buffExpired` 事件）
 *   3. 壳**不吃增伤**（打破壳不该因为对方叠了 buff 而变难）
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

/** 一层厚 `pool` 的壳。 */
function shell(pool: number): BuffDef {
  return makeBuffDef({
    id: 'test-shell',
    nameKey: 'skill.attack.name',
    duration: Number.POSITIVE_INFINITY,
    absorbValue: pool,
  });
}

function hitSkill(damage: number): SkillDef {
  return makeSkillDef({
    id: 'test-hit',
    nameKey: 'skill.attack.name',
    castTime: 0,
    hits: [
      { at: 0, effects: [{ kind: 'damage', damage: { base: damage, canCrit: false, countsAsHit: true } }] },
    ],
  });
}

interface Harness {
  readonly engine: BattleEngine;
  readonly target: () => Combatant | undefined;
  readonly events: () => readonly { kind: string }[];
}

/** 玩家（攻击方）打**带壳的** Boss。 */
function shellHarness(pool: number, hit: number): Harness {
  const def = shell(pool);
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS, hitSkill(hit)], buffs: [...ALL_BUFFS, def] },
    { localeKeys: i18nKeys },
  );
  const bare = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 500, energy: 0, douqi: 0 },
    resources: { hp: 500, energy: 0, douqi: 0 },
  });
  const boss: Combatant = { ...bare, buffs: applyBuff(bare, def, 'boss', 0).buffs };
  const engine = new BattleEngine({
    combatants: [
      makeCombatant({
        id: 'player',
        side: 'ally',
        caps: { hp: 200, energy: 100, douqi: 0 },
        resources: { hp: 200, energy: 100, douqi: 0 },
      }),
      boss,
    ],
    seed: 3,
    bossId: 'boss',
    timeLimitMs: 600_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', {}],
      ['boss', {}],
    ]),
    passiveModifiers: new Map(),
  });
  engine.drainEvents();
  engine.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: engine.snapshot.tick }], 'player');
  const events = engine.drainEvents();
  return {
    engine,
    target: () => engine.snapshot.combatants.find((c) => c.id === 'boss'),
    events: () => events,
  };
}

const shellLeft = (h: Harness): number | undefined =>
  h.target()?.buffs.find((b) => b.defId === 'test-shell')?.absorb;

describe('吸收壳：先吃伤害、扣光就碎、不吃增伤', () => {
  it('🛡 伤害 < 壳 → **血一点不掉**，壳变薄', () => {
    const h = shellHarness(100, 30);
    expect(h.target()?.resources.hp, '壳还没破，血不该掉').toBe(500);
    expect(shellLeft(h), '壳少了 30').toBe(70);
  });

  it('🛡 伤害 > 壳 → 壳碎，**漏过去的**才扣血', () => {
    const h = shellHarness(30, 50);
    expect(shellLeft(h), '壳应该碎了（那条 buff 消失）').toBeUndefined();
    expect(h.target()?.resources.hp, '漏过去 20').toBe(480);
  });

  it('🎯 壳碎的那一刻会发 `buffExpired`（内容靠它"把血还你"）', () => {
    const h = shellHarness(30, 50);
    expect(h.events().some((e) => e.kind === 'buffExpired')).toBe(true);
  });

  it('壳还在时**不发** `buffExpired`', () => {
    const h = shellHarness(100, 30);
    expect(h.events().some((e) => e.kind === 'buffExpired')).toBe(false);
  });

  it('⚠️ 壳**不吃增伤**：同一发伤害，扣的壳厚一样（对方叠易伤也没用）', () => {
    /**
     * ⚠️ 用户："如果 血盾**不吃这个减伤**"。
     * 判据放在**壳这一侧**：收到 30 点伤害就掉 30 点壳 —— 与攻击方
     * 有多少增伤无关（易伤只放大"漏到血上"的那部分）。
     */
    const h = shellHarness(100, 30);
    expect(shellLeft(h)).toBe(70);
  });
});



