import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ENERGY_PER_LOGIC_TICK } from '../../src/data/balance';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { JEALOUSY_FLAME_AMOUNT, JEALOUSY_BEHAVIORS } from '../../src/data/jealousyBoss';
import type {
  Behavior,
  BuffDef,
  Combatant,
  SkillDef,
  StatKey,
} from '../../src/core/types';
import { makeBuffDef, makeCombatant, makeSkillDef } from './helpers';

/**
 * **不走命中管线的效果**（`core/combat/effectOps.ts`）与 `onCooldown` 行为。
 *
 * 三块新东西，每块都有一条"错了会**静默**"的理由：
 *
 *   1. `transfer`（搬运）：「妒火」偷血 / 「夺息」偷炁。**"你掉多少它就回
 *      多少"是结构性保证**（先扣、按实际 delta 加）—— 写错的表现只是
 *      "它回的血比你掉的多/少"，玩家说不清，改的人也不知道该看哪。
 *   2. 荆棘反伤（`reflectFraction`）：**必须每次受伤都触发、且不会
 *      自己弹自己**。弹自己的后果是两个反伤角色互相弹到死（死循环）。
 *   3. `onCooldown`：「妒火」CD 一到就出、不抽签。写错的表现是
 *      "招牌变成了轮转里的普通一招"，而它照样打得完 —— 看不出来。
 *
 * ⚠️ 这里**不钉具体数值**（AGENTS.md §4 的判据：数值由黄金覆盖、
 * 且会经常调）：算式一律从**内容里导出的那个对象**取（
 * `JEALOUSY_FLAME_AMOUNT`），所以调平衡不会让这些用例变红。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
  'lust.bind.name',
  'jealousy.mark.name',
]);

/**
 * 一个逻辑步里炁自然回多少（`regenerate` 每逻辑步跑一次）。
 * ⚠️ **从常量取**，不要在测试里写 `1` —— 那个数会调（见 `data/balance.ts`）。
 */
const REGEN_PER_TICK = ENERGY_PER_LOGIC_TICK;

/** 一条"打一下"的普通攻击技（伤害可调）。 */
function hitSkill(damage: number, id = 'test-hit'): SkillDef {
  return makeSkillDef({
    id,
    nameKey: 'skill.attack.name',
    castTime: 0,
    hits: [
      {
        at: 0,
        effects: [{ kind: 'damage', damage: { base: damage, canCrit: false, countsAsHit: true } }],
      },
    ],
  });
}

function engineWith(args: {
  readonly player: Partial<Combatant>;
  readonly boss: Partial<Combatant>;
  readonly skills: readonly SkillDef[];
  readonly buffs?: readonly BuffDef[];
  readonly behaviors?: readonly Behavior[];
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
      /**
       * ⚠️ 行为挂在**战斗者**身上（不是引擎参数）—— 与 `makeBoss` 一样：
       * "每一招怎么打"是那个单位自己的东西，引擎只负责执行。
       */
      makeCombatant({
        id: 'boss',
        side: 'enemy',
        behaviors: args.behaviors ?? [],
        ...args.boss,
      }),
    ],
    seed: 12345,
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

const hpOf = (e: BattleEngine, id: string): number =>
  e.snapshot.combatants.find((c) => c.id === id)?.resources.hp ?? -1;

/* ================================================================== *
 * 1. `transfer` —— 按百分比搬运（「妒火」）
 * ================================================================== */

describe('`transfer`：搬运量 = 血量百分比差的三分之一（「妒火」的算式）', () => {
  /** 一条只有 `transfer` 的招（0 前摇，直接结算）。 */
  function flameSkill(): SkillDef {
    return makeSkillDef({
      id: 'test-flame',
      nameKey: 'skill.attack.name',
      castTime: 0,
      hits: [
        {
          at: 0,
          effects: [
            { kind: 'transfer', transfer: { pool: 'hp', amount: JEALOUSY_FLAME_AMOUNT } },
          ],
        },
      ],
    });
  }

  /** 你 `playerHp%`、它 `bossHp%` —— 双方上限都是 100，算起来直白。 */
  function castFlame(playerHp: number, bossHp: number): BattleEngine {
    const e = engineWith({
      player: { caps: { hp: 100, energy: 100, douqi: 100 }, resources: { hp: playerHp, energy: 0, douqi: 0 } },
      boss: { caps: { hp: 100, energy: 0, douqi: 0 }, resources: { hp: bossHp, energy: 0, douqi: 0 } },
      skills: [flameSkill()],
    });
    e.tick([{ type: 'useSkill', skillId: 'test-flame', atTick: 0 }], 'boss');
    e.drainEvents();
    return e;
  }

  it('你 80% / 它 20% → 你掉 (80−20)/3，它回**同一个数**', () => {
    const e = castFlame(80, 20);
    const moved = (80 - 20) / 3;

    expect(hpOf(e, 'player')).toBe(80 - moved);
    expect(hpOf(e, 'boss')).toBe(20 + moved);
  });

  it('⚠️ 你掉多少它就回多少 —— **同一个数**（不是各按自己上限算一遍）', () => {
    const e = castFlame(80, 20);
    const playerLost = 80 - hpOf(e, 'player');
    const bossGained = hpOf(e, 'boss') - 20;

    expect(playerLost).toBe(bossGained);
  });

  it('你比它低 / 一样高 → **这条效果整个不结算**（负数会被当"不成立"）', () => {
    for (const [playerHp, bossHp] of [
      [40, 60],
      [50, 50],
    ] as const) {
      const e = castFlame(playerHp, bossHp);
      expect(hpOf(e, 'player'), `你 ${playerHp} / 它 ${bossHp}`).toBe(playerHp);
      expect(hpOf(e, 'boss'), `你 ${playerHp} / 它 ${bossHp}`).toBe(bossHp);
    }
  });

  it('你身上不够（只剩 2 点）→ 搬走量夹在"你有的"之内，它不会凭空多回', () => {
    /**
     * ⚠️ 这条是 `transferResources` 里"先扣、按**实际** delta 加"的顺序
     * 保证的。若改成"两边各按算出来的数加"，Boss 会凭空多回一份血 ——
     * 而那种错在画面上的表现只是"它回得有点多"。
     *
     * ⚠️ 断言写成**差值**而不是绝对值：`resolveHit` 之后引擎还会跑
     * `regenerate`（炁每逻辑步自然回 1，`ENERGY_PER_LOGIC_TICK`），
     * 只在这里写死绝对值会挂在一个与本题无关的常数上。
     */
    const e = castFlame(2, 0);
    const playerLost = 2 - hpOf(e, 'player');
    const bossGained = hpOf(e, 'boss');

    expect(bossGained, '它最多只能拿到你掉的那一份').toBeLessThanOrEqual(playerLost);
    expect(hpOf(e, 'player')).toBeGreaterThanOrEqual(0);
  });
});

/* ================================================================== *
 * 2. `transfer` —— 固定比例 + 门槛（「夺息」）
 * ================================================================== */

describe('`transfer` + `when`：门槛不成立时整条效果不结算（「夺息」）', () => {
  function snatchSkill(): SkillDef {
    return makeSkillDef({
      id: 'test-snatch',
      nameKey: 'skill.attack.name',
      castTime: 0,
      hits: [
        {
          at: 0,
          effects: [
            {
              kind: 'transfer',
              when: { kind: 'resourceAbove', who: 'target', resource: 'energy', value: 60 },
              transfer: {
                pool: 'energy',
                amount: {
                  e: 'mul',
                  of: [
                    { e: 'resource', who: 'target', resource: 'energy' },
                    { e: 'const', value: 0.5 },
                  ],
                },
              },
            },
          ],
        },
      ],
    });
  }

  function castSnatch(playerEnergy: number, bossEnergy = 0): BattleEngine {
    const e = engineWith({
      player: {
        caps: { hp: 100, energy: 100, douqi: 100 },
        resources: { hp: 100, energy: playerEnergy, douqi: 0 },
      },
      boss: {
        caps: { hp: 100, energy: 100, douqi: 0 },
        resources: { hp: 100, energy: bossEnergy, douqi: 0 },
      },
      skills: [snatchSkill()],
    });
    e.tick([{ type: 'useSkill', skillId: 'test-snatch', atTick: 0 }], 'boss');
    e.drainEvents();
    return e;
  }

  const energyOf = (e: BattleEngine, id: string): number =>
    e.snapshot.combatants.find((c) => c.id === id)?.resources.energy ?? -1;

  it('你的炁 80（> 60）→ 掉一半，它拿到同样多', () => {
    /**
     * ⚠️ 期望值里带 `REGEN_PER_TICK`：`resolveHit` 之后引擎还会跑
     * `regenerate`（炁每逻辑步 +1），所以两边都比"手算的静默值"多 1。
     * 把它显式写出来，是为了让"为什么不是 40"这个问题有答案。
     */
    const e = castSnatch(80);
    expect(energyOf(e, 'player')).toBe(40 + REGEN_PER_TICK);
    expect(energyOf(e, 'boss')).toBe(40 + REGEN_PER_TICK);
  });

  it('你的炁 60（正好等于门槛）→ **不动**（判据是"高于"）', () => {
    const e = castSnatch(60);
    expect(energyOf(e, 'player')).toBe(60 + REGEN_PER_TICK);
    expect(energyOf(e, 'boss')).toBe(REGEN_PER_TICK);
  });

  it('你的炁 59 → 不动', () => {
    const e = castSnatch(59);
    expect(energyOf(e, 'player')).toBe(59 + REGEN_PER_TICK);
  });
});

/* ================================================================== *
 * 3. 荆棘反伤（`BuffFlags.reflectFraction`）
 * ================================================================== */

describe('荆棘反伤：每次受伤都按比例反弹，且**不会自己弹自己**', () => {
  const THORNS: BuffDef = makeBuffDef({
    id: 'test-thorns',
    nameKey: 'lust.bind.name',
    duration: 10_000,
    flags: { reflectFraction: 0.5 },
  });

  function engineFor(reflectOn: readonly ('player' | 'boss')[]): BattleEngine {
    const hp1000 = { hp: 1000, energy: 0, douqi: 0 };
    const withThorns = (id: 'player' | 'boss', side: 'ally' | 'enemy'): Partial<Combatant> => {
      const bare = makeCombatant({ id, side, caps: hp1000, resources: hp1000 });
      return {
        id,
        side,
        caps: hp1000,
        resources: hp1000,
        buffs: reflectOn.includes(id) ? applyBuff(bare, THORNS, id, 0).buffs : [],
      };
    };
    return engineWith({
      player: withThorns('player', 'ally'),
      boss: withThorns('boss', 'enemy'),
      skills: [hitSkill(40)],
      buffs: [THORNS],
    });
  }

  it('打带荆棘的人 → 攻击者挨反弹（50% × 实际伤害）', () => {
    const e = engineFor(['boss']);
    e.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: 0 }], 'player');
    const events = e.drainEvents();

    const reflected = events.filter((ev) => ev.kind === 'damage' && ev.reflect === true);
    expect(reflected).toHaveLength(1);
    expect(reflected[0]?.kind === 'damage' ? reflected[0].amount : -1).toBe(20);
    expect(hpOf(e, 'boss')).toBe(960);
    expect(hpOf(e, 'player')).toBe(980);
  });

  it('⚠️ 两边都带荆棘 → **只弹一次**（反弹不再触发反弹）', () => {
    const e = engineFor(['player', 'boss']);
    e.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: 0 }], 'player');
    const events = e.drainEvents();

    const reflected = events.filter((ev) => ev.kind === 'damage' && ev.reflect === true);
    expect(reflected, '再弹一次就会互相弹到死').toHaveLength(1);
  });

  it('被反的那一方没有荆棘 → 一点反弹都没有', () => {
    const e = engineFor(['player']);
    e.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: 0 }], 'player');
    const events = e.drainEvents();
    expect(events.filter((ev) => ev.kind === 'damage' && ev.reflect === true)).toHaveLength(0);
  });
});

/* ================================================================== *
 * 4. `onCooldown` —— CD 好了就用（不抽签）
 * ================================================================== */

describe('`onCooldown`：技能就绪就出手，**优先于轮转**', () => {
  /** 招牌（无前摇，好测）与一条"填充"轮转技。 */
  const flame = makeSkillDef({
    id: 'test-flame',
    nameKey: 'skill.attack.name',
    castTime: 0,
    hits: [
      { at: 0, effects: [{ kind: 'transfer', transfer: { pool: 'hp', amount: 10 } }] },
    ],
  });
  const filler = makeSkillDef({
    id: 'test-filler',
    nameKey: 'skill.attack.name',
    castTime: 0,
    hits: [{ at: 0, effects: [{ kind: 'damage', damage: { base: 1, canCrit: false, countsAsHit: true } }] }],
  });

  it('🎯 招牌与轮转**同时就绪**时，出手的是招牌', () => {
    const e = engineWith({
      player: { caps: { hp: 100, energy: 0, douqi: 0 }, resources: { hp: 80, energy: 0, douqi: 0 } },
      boss: { caps: { hp: 100, energy: 0, douqi: 0 }, resources: { hp: 20, energy: 0, douqi: 0 } },
      skills: [flame, filler],
      behaviors: [
        { kind: 'onCooldown', skillId: 'test-flame' },
        { kind: 'rotation', steps: [{ skillId: 'test-filler' }] },
      ],
    });
    e.tick([], 'boss');
    const events = e.drainEvents();

    /** 招牌是"偷血"（没有伤害事件），填充是"打一下"（有伤害事件）。 */
    const used = events.filter((ev) => ev.kind === 'resourceChanged');
    expect(used.length, '招牌应该出手（偷血 → 资源变动）').toBeGreaterThan(0);
    expect(events.some((ev) => ev.kind === 'damage')).toBe(false);
  });

  it('id 写错（注册表里没有）→ **永不出手**，也不会崩', () => {
    /**
     * ⚠️ 这条对应 `validate.ts` 里 `behaviorSkillRefs` 的 `onCooldown`
     * 分支：**内容写错 id 时**，校验器会在启动那一刻拦下它。
     * 而这里测的是引擎侧的兜底（跳过，而不是抛错）。
     */
    const e = engineWith({
      player: { caps: { hp: 100, energy: 0, douqi: 0 }, resources: { hp: 80, energy: 0, douqi: 0 } },
      boss: { caps: { hp: 100, energy: 0, douqi: 0 }, resources: { hp: 20, energy: 0, douqi: 0 } },
      skills: [flame, filler],
      behaviors: [{ kind: 'onCooldown', skillId: 'does-not-exist' }],
    });
    e.tick([], 'boss');
    expect(() => e.drainEvents()).not.toThrow();
    expect(hpOf(e, 'player')).toBe(80);
  });

  it('嫉妒的真实行为数组里，招牌**不在轮转里**（它走 onCooldown）', () => {
    const onCooldown = JEALOUSY_BEHAVIORS.filter((b) => b.kind === 'onCooldown');
    expect(onCooldown.map((b) => b.skillId)).toEqual(['jealousy-flame']);

    const rotated = JEALOUSY_BEHAVIORS.flatMap((b) =>
      b.kind === 'rotation' ? b.steps.map((s) => s.skillId) : [],
    );
    expect(rotated, '招牌不该同时出现在轮转里（那会让它的节拍变成两个条件）').not.toContain(
      'jealousy-flame',
    );
  });
});
