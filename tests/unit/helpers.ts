/**
 * 测试共用的小工具。
 *
 * 放在这里而不是每个测试文件各写一份，是为了让"构造一个合法的
 * Combatant / BuffDef"这件事只有一种写法 —— 类型变化时只改一处。
 */

import type { BuffDef, Combatant, SkillDef } from '../../src/core/types';

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

/** 构造一个最小可用的技能定义。 */
export function makeSkillDef(
  overrides: Partial<SkillDef> & Pick<SkillDef, 'id'>,
): SkillDef {
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
