/**
 * 测试共用的小工具。
 *
 * 放在这里而不是每个测试文件各写一份，是为了让"构造一个合法的
 * Combatant / BuffDef"这件事只有一种写法 —— 类型变化时只改一处。
 */

import type { ActiveSkillDef, BuffDef, Combatant, SkillDef } from '../../src/core/types';

/** 一个 tick 的毫秒数（测试里频繁用来算 tick 边界）。 */
export const MS_PER_TICK = 1000 / 60;

/** 表示"当前 tick"的常量，让测试读起来更像自然语言。 */
export const CHANGE_TICK = 0;

/** 构造一个最小可用的战斗单位。 */
export function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'player',
    nameKey: 'resource.hp',
    side: 'ally',
    caps: { hp: 10000, energy: 120, douqi: 100 },
    resources: { hp: 10000, energy: 120, douqi: 0 },
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

/** 构造一个最小可用的 buff 定义。 */
export function makeBuffDef(
  overrides: Partial<BuffDef> & Pick<BuffDef, 'id'>,
): BuffDef {
  return {
    nameKey: 'stat.haste',
    icon: 'icon',
    polarity: 'buff',
    duration: 1000,
    maxStacks: 1,
    stacking: { mode: 'refresh' },
    ...overrides,
  };
}

/**
 * 构造一个最小可用的技能定义。
 *
 * ⚠️ 这里造的**必然都是主动技能**（下面写死了 `kind: 'activeSkill'`），
 * 所以返回类型就是 `ActiveSkillDef` —— 调用方读 `castTime` / `hits` /
 * `cost` 时不必再判 `kind`。被动技能没有对应的构造器：它的效果直接写在
 * `abilities` 里，测试要造就手写一个 `PassiveSkillDef`。
 */
export function makeSkillDef(
  overrides: Partial<ActiveSkillDef> & Pick<ActiveSkillDef, 'id'>,
): ActiveSkillDef {
  return {
    kind: 'activeSkill',
    nameKey: 'stat.strength',
    icon: 'icon',
    abilities: [],
    castTime: 0,
    cooldown: 0,
    cost: [],
    targeting: { mode: 'primaryEnemy' },
    hits: [],
    tags: [],
    interruptible: false,
    ...overrides,
  };
}

/**
 * 把 `SkillDef` 收窄成主动技能（测试里读 `hits` / `castTime` / `cost` 用它）。
 *
 * ⚠️ 这是**类型守卫**，不是逃生舱 —— AGENTS.md §1 明确允许"收窄联合类型"。
 * 测试里大部分技能查表都是主动技能，但类型上是联合，所以要么判 `kind`、
 * 要么用它。**运行期真的检查**（不是 `as`），传错会立刻抛。
 */
export function activeSkillOf(skill: SkillDef | undefined, what = 'skill'): ActiveSkillDef {
  if (skill === undefined) throw new Error(`skill not found: ${what}`);
  if (skill.kind !== 'activeSkill') throw new Error(`not an active skill: ${skill.id}`);
  return skill;
}
