import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import {
  GLUTTONY_COUNT,
  GLUTTONY_COUNT_PASSIVE,
  GLUTTONY_SATED,
  GLUTTONY_SHIELD,
} from '../../src/data/gluttonyBoss';
import type { BuffDef, Combatant, SkillDef, StatKey } from '../../src/core/types';
import { makeCombatant, makeSkillDef } from './helpers';

/**
 * **「暴食」**：三条啃噬 + 血盾 + 饕餮计数。
 *
 * 三条各自都会"静默坏掉"，所以每条都钉：
 *   1. **打穿壳 → 把当初偷的血还给你**（新接的 `onBreak` + `payload.custom`）
 *   2. **没打穿（到期）→ 不还**（这正是 `onBreak` 与 `onBuffExpired` 分开的理由）
 *   3. **不致死**：偷的量最多把你打到剩 1 点
 *   4. **计数**：3 次成功的啃噬 → 「饱食」+ 计数清零（`buff` 层数就是计数器）
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

function hitSkill(damage: number, id = 'test-hit'): SkillDef {
  return makeSkillDef({
    id,
    nameKey: 'skill.attack.name',
    castTime: 0,
    hits: [
      { at: 0, effects: [{ kind: 'damage', damage: { base: damage, canCrit: false, countsAsHit: true } }] },
    ],
  });
}

interface Harness {
  readonly engine: BattleEngine;
  readonly player: () => Combatant | undefined;
  readonly boss: () => Combatant | undefined;
}

function harness(args: {
  readonly playerHp?: number;
  readonly bossBuffs?: readonly BuffDef[];
  readonly skills?: readonly SkillDef[];
}): Harness {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS, ...(args.skills ?? [])], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const playerHp = args.playerHp ?? 100;
  const playerBare = makeCombatant({
    id: 'player',
    side: 'ally',
    caps: { hp: 100, energy: 100, douqi: 100 },
    resources: { hp: playerHp, energy: 100, douqi: 100 },
  });
  const bossBare = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 420, energy: 100, douqi: 100 },
    resources: { hp: 420, energy: 0, douqi: 0 },
  });
  const boss: Combatant = {
    ...bossBare,
    buffs: (args.bossBuffs ?? []).reduce(
      (c, def) => ({ ...c, buffs: applyBuff(c, def, 'boss', 0).buffs }),
      bossBare,
    ).buffs,
  };
  const engine = new BattleEngine({
    combatants: [playerBare, boss],
    seed: 99,
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
  return {
    engine,
    player: () => engine.snapshot.combatants.find((c) => c.id === 'player'),
    boss: () => engine.snapshot.combatants.find((c) => c.id === 'boss'),
  };
}

const attack = (h: Harness, skillId = 'test-hit'): void => {
  h.engine.tick([{ type: 'useSkill', skillId, atTick: h.engine.snapshot.tick }], 'player');
  h.engine.drainEvents();
};

const shellOf = (h: Harness) =>
  h.boss()?.buffs.find((b) => b.defId === GLUTTONY_SHIELD.id);

/* ================================================================== *
 * 1. 血盾：打穿还钱 / 没打穿不还
 * ================================================================== */

describe('「血盾」：打穿就把当初偷的血还给你（`onBreak`）', () => {
  /** 一层壳：耐久 30、当初偷了 25（两者**故意不同** —— 还的必须是"偷的"）。 */
  const shellDef: BuffDef = { ...GLUTTONY_SHIELD, absorbValue: 30, custom: 25 };

  it('🎯 打穿 → 玩家**拿回当初偷的 25**（不是壳的耐久 30）', () => {
    const h = harness({ playerHp: 60, bossBuffs: [shellDef], skills: [hitSkill(40)] });
    expect(shellOf(h), '先确认壳在').toBeDefined();

    attack(h);

    expect(shellOf(h), '壳应该被打穿（摘掉）').toBeUndefined();
    /**
     * ⚠️ 玩家这一下**没有对壳造成伤害**（壳替它挡了），所以血只应该
     * **+25**（还钱），不该再扣 40。
     */
    expect(h.player()?.resources.hp, '拿回 25').toBe(60 + 25);
  });

  it('⚠️ 没打穿（壳还有剩）→ **不还钱**', () => {
    const h = harness({ playerHp: 60, bossBuffs: [shellDef], skills: [hitSkill(10)] });
    attack(h);

    expect(shellOf(h), '壳还在').toBeDefined();
    expect(shellOf(h)?.absorb, '壳变薄').toBe(20);
    expect(h.player()?.resources.hp, '没打穿就不还').toBe(60);
  });

  it('⚠️ **壳不吃减伤**：它挡下的是**全额**伤害（不因「饱食」打折）', () => {
    /**
     * 用户："如果 血盾**不吃这个减伤**"。壳在 `computeDamage` **之前**先吃，
     * 所以 30 点的壳吃 40 点的一击 → 直接碎，而不是"×0.7 之后还差 2 点"。
     */
    const h = harness({
      playerHp: 60,
      bossBuffs: [shellDef, GLUTTONY_SATED],
      skills: [hitSkill(40)],
    });
    attack(h);
    expect(shellOf(h), '壳该被打穿（30 < 40，没打折）').toBeUndefined();
  });
});

/* ================================================================== *
 * 2. 饕餮计数：3 次成功 → 饱食 + 清零
 * ================================================================== */

describe('「饕餮」：**buff 层数就是计数器**（3 次成功 → 饱食 → 清零）', () => {
  it('🎯 挨 3 次打 → 拿到「饱食」，且计数被**清掉**（可再触发）', () => {
    const h = harness({ bossBuffs: [GLUTTONY_COUNT_PASSIVE], skills: [hitSkill(5)] });
    const stacks = (): number =>
      h.boss()?.buffs.filter((b) => b.defId === GLUTTONY_COUNT.id).reduce((s, b) => s + b.stacks, 0) ?? 0;

    attack(h);
    expect(stacks(), '第 1 次').toBe(1);
    attack(h);
    expect(stacks(), '第 2 次').toBe(2);

    attack(h);

    expect(h.boss()?.buffs.some((b) => b.defId === GLUTTONY_SATED.id), '3 次该给饱食').toBe(true);
    expect(stacks(), '计数清零').toBe(0);
  });

  it('⚠️ 只挨 2 次 → **不给**饱食', () => {
    const h = harness({ bossBuffs: [GLUTTONY_COUNT_PASSIVE], skills: [hitSkill(5)] });
    attack(h);
    attack(h);
    expect(h.boss()?.buffs.some((b) => b.defId === GLUTTONY_SATED.id)).toBe(false);
  });

  it('「饱食」的修正生效：它受到的伤害 ×0.7', () => {
    const h = harness({ bossBuffs: [GLUTTONY_SATED], skills: [hitSkill(100)] });
    const before = h.boss()?.resources.hp ?? 0;
    attack(h);
    const taken = before - (h.boss()?.resources.hp ?? 0);
    expect(taken, '100 × 0.7 = 70').toBe(70);
  });
});
