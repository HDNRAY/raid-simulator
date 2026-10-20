import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import {
  WRATH_BEHAVIORS,
  WRATH_FURY,
  WRATH_MAX_RAGE,
  WRATH_RAGE,
  WRATH_RAGE_PASSIVE,
  WRATH_RECENT_HIT,
  WRATH_VENT,
} from '../../src/data/wrathBoss';
import { logicMs } from '../../src/core/loopConstants';
import type { BuffDef, Combatant, SkillDef, StatKey } from '../../src/core/types';
import { makeCombatant, makeSkillDef } from './helpers';

/**
 * **「暴怒」** —— 七宗罪的最后一个。
 *
 * 它和「懒惰」是一对镜像：**懒惰"你不打它就变强"，暴怒"你打它就变强"**。
 * 所以这一组的判据全是"**打与不打分别发生什么**"：
 *
 *   1. 挨打 **+1 层**（上限 8）
 *   2. **2 秒不挨打 −1 层**（⚠️ 是 **−1**，不是清零 —— 那是 2026-10-14
 *      为它新加的 `removeBuff.stacks` 能力）
 *   3. 满 8 层 → **「暴怒」形态**（霸体 + 增伤）+ **层数清零**
 *   4. 「泄怒」的伤害**按层数加成**
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

/** 一记小伤害（用来"打它一下"）。 */
function hitSkill(damage = 5): SkillDef {
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
  readonly boss: () => Combatant | undefined;
}

function harness(args: { readonly bossBuffs?: readonly BuffDef[]; readonly damage?: number } = {}): Harness {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS, hitSkill(args.damage)], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const bare = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 900, energy: 0, douqi: 0 },
    resources: { hp: 900, energy: 0, douqi: 0 },
  });
  const boss: Combatant = {
    ...bare,
    buffs: (args.bossBuffs ?? []).reduce(
      (c, def) => ({ ...c, buffs: applyBuff(c, def, 'boss', 0).buffs }),
      bare,
    ).buffs,
  };
  const engine = new BattleEngine({
    combatants: [
      makeCombatant({
        id: 'player',
        side: 'ally',
        caps: { hp: 500, energy: 0, douqi: 0 },
        resources: { hp: 500, energy: 0, douqi: 0 },
      }),
      boss,
    ],
    seed: 4242,
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
    boss: () => engine.snapshot.combatants.find((c) => c.id === 'boss'),
  };
}

const rageStacks = (h: Harness): number =>
  (h.boss()?.buffs ?? [])
    .filter((b) => b.defId === WRATH_RAGE.id)
    .reduce((sum, b) => sum + b.stacks, 0);

const has = (h: Harness, id: string): boolean =>
  (h.boss()?.buffs ?? []).some((b) => b.defId === id);

/** 打它一下（玩家施放那一记小伤害）。 */
function hitOnce(h: Harness): void {
  h.engine.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: h.engine.snapshot.tick }], 'player');
  h.engine.drainEvents();
}

describe('「怒火」：挨打 +1 层、2 秒不挨打 −1 层', () => {
  it('🎯 挨一次打 → +1 层（用户："根据受伤次数"）', () => {
    const h = harness({ bossBuffs: [WRATH_RAGE_PASSIVE] });
    expect(rageStacks(h)).toBe(0);
    hitOnce(h);
    expect(rageStacks(h)).toBe(1);
  });

  it('🎯 连着挨打就攒起来，而且**封顶在 8**', () => {
    const h = harness({ bossBuffs: [WRATH_RAGE_PASSIVE] });
    for (let i = 0; i < WRATH_MAX_RAGE + 5; i += 1) hitOnce(h);
    /**
     * ⚠️ 满 8 层会**立刻转成「暴怒」形态并清零**（`WRATH_RAGE` 的触发器），
     * 所以"打 13 下"之后不会停在 8 —— 它已经经历过一次爆发。
     * 判据因此是"**不超过上限**"，而不是"恰好等于 8"。
     */
    expect(rageStacks(h)).toBeLessThanOrEqual(WRATH_MAX_RAGE);
    expect(has(h, WRATH_FURY.id), '满层应当触发过一次「暴怒」').toBe(true);
  });

  it('⚠️ **2 秒不挨打 −1 层**（不是清零 —— 这条钉住新加的 `removeBuff.stacks`）', () => {
    const h = harness({ bossBuffs: [WRATH_RAGE_PASSIVE] });
    /** 先攒 3 层。 */
    for (let i = 0; i < 3; i += 1) hitOnce(h);
    expect(rageStacks(h)).toBe(3);

    /** 停手 2 秒（CD 到点 → 退 1 层）。 */
    for (let i = 0; i < 2 * 60 + 4; i += 1) h.engine.tick([]);
    h.engine.drainEvents();
    expect(rageStacks(h), '退一层（3 → 2），不是清零').toBe(2);

    /** ⚠️ 再停 2 秒 → 再退一层（证明是"每 2 秒 −1"，不是"只退一次"）。 */
    for (let i = 0; i < 2 * 60 + 4; i += 1) h.engine.tick([]);
    h.engine.drainEvents();
    expect(rageStacks(h)).toBe(1);
  });

  it('🎯 退到 0 之后停住（不会变成负数 / 不会崩）', () => {
    const h = harness({ bossBuffs: [WRATH_RAGE_PASSIVE] });
    hitOnce(h);
    for (let i = 0; i < 10 * 60; i += 1) h.engine.tick([]);
    h.engine.drainEvents();
    expect(rageStacks(h)).toBe(0);
  });

  it('⚠️ 挨打的**那 2 秒内不退火**（判据是「刚挨打」那条标记）', () => {
    const h = harness({ bossBuffs: [WRATH_RAGE_PASSIVE] });
    hitOnce(h);
    expect(has(h, WRATH_RECENT_HIT.id), '挨打会挂上"刚挨打"').toBe(true);
    expect(WRATH_RECENT_HIT.duration, '它活 2 秒 = 退火间隔').toBe(logicMs(20));
  });
});

describe('满 8 层 → 「暴怒」形态（霸体 + 增伤），然后清零', () => {
  it('🎯 到 8 层：给形态 + **把层数清掉**（可再攒）', () => {
    const h = harness({ bossBuffs: [WRATH_RAGE_PASSIVE] });
    for (let i = 0; i < WRATH_MAX_RAGE; i += 1) hitOnce(h);
    expect(has(h, WRATH_FURY.id), '该进入暴怒形态').toBe(true);
    expect(rageStacks(h), '层数清零').toBe(0);
  });

  it('⚠️ 形态带**霸体**（用户定稿："满 8 层进暴怒形态（霸体 + 大额增伤）"）', () => {
    expect(WRATH_FURY.flags?.interruptImmune, '暴怒形态必须打不断').toBe(true);
    expect(WRATH_FURY.duration).toBeGreaterThan(0);
  });

  it('⚠️ 每层真的按层生效：**急速 +0.05 × 层数**（不是只算一份）', () => {
    /**
     * 判据从内容取（那条修正的声明值 × 层数）—— 数值调了照样绿，
     * "按层展开"坏了才红（那正是 2026-10-14 修的那条）。
     */
    const perStack = (WRATH_RAGE.modifiers ?? [])
      .filter((m) => m.stat === 'haste')
      .reduce((sum, m) => sum + (typeof m.value === 'number' ? m.value : 0), 0);
    expect(perStack, '内容里应当声明了每层 +0.05 急速').toBeGreaterThan(0);

    const h = harness({ bossBuffs: [WRATH_RAGE_PASSIVE] });
    for (let i = 0; i < 3; i += 1) hitOnce(h);
    const stacks = rageStacks(h);
    expect(stacks).toBe(3);
    expect(h.engine.statsOf('boss').haste).toBeCloseTo(perStack * stacks, 6);
  });
});

describe('「泄怒」：伤害**按层数加成**', () => {
  it('🎯 它的伤害 = 基础 + 层数 × 每层加成（判据全从内容取）', () => {
    const effects = WRATH_VENT.hits[0]?.effects ?? [];
    const damages = effects.filter((e) => e.kind === 'damage');
    expect(damages.length, '「泄怒」应当有两条伤害：基础 + 按层数那条').toBe(2);
    /** 第二条的 base 是一个表达式（读 `buffStacks`）。 */
    const scaled = damages[1];
    expect(scaled?.kind === 'damage' && typeof scaled.damage?.base === 'object').toBe(true);
  });

  it('⚠️ 轮转里它**只在层数 ≥ 4** 时出招（玩家才学得到"我打太狠了"）', () => {
    const rotation = WRATH_BEHAVIORS.find((b) => b.kind === 'rotation');
    const step = rotation?.kind === 'rotation'
      ? rotation.steps.find((s) => s.skillId === WRATH_VENT.id)
      : undefined;
    expect(step, '「泄怒」必须在轮转里').toBeDefined();
    /**
     * ⚠️ 2026-10-20：二阶段把这一条扩成了 `any[层数≥4, 二阶段+血量≤40%]`
     * （"它随时可以泄怒"）—— 所以这里钉"**层数门槛仍在**"，而不是"`when`
     * 必须正好是那一句"。
     */
    const when = step?.when;
    expect(when, '而且要带条件').toBeDefined();
    const flat = JSON.stringify(when);
    expect(flat, '层数门槛必须还在（4 层）').toContain(String(4));
    expect(flat).toContain(WRATH_RAGE.id);
    expect(flat, '二阶段那一支也在').toContain('whisper-phase2');
  });

  it('它**不消耗**层数（清层是「暴怒」形态的事）', () => {
    const effects = WRATH_VENT.hits[0]?.effects ?? [];
    expect(effects.some((e) => e.kind === 'removeBuff')).toBe(false);
  });
});
