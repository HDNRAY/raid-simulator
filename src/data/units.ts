/**
 * **作战单位的构造**（玩家与各 Boss）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这些是**内容装配**：血量上限、基础属性、Boss 的行为表。放在 `main.ts`
 * 里会把"入口装配"和"内容数值"混在一起，而且 `main.ts` 长期贴着 700 行
 * 上限（AGENTS.md §3）—— 加一个 Boss 就要挤一次。
 *
 * ⚠️ 行为表是**每个 Boss 自己的**，而技能注册表是**共用的**：
 * 两个 Boss 的技能都在 `ALL_SKILLS` 里是正常的，各自只放自己轮转里
 * 列出的那些。
 */

import type { Behavior, Combatant, StatKey } from '../core/types';
import { VERROT_BEHAVIORS } from '../core/ai';
import { applyBuff } from '../core/buffs';
import { BOSS_HP_DISPLAY } from './entities/bossHp';
import { DOUQI_MAX, ENERGY_MAX, HP_MAX } from './content';
import { LUST_BEHAVIORS, LUST_PASSIVE } from './lustBoss';
import { BOSS_ROSTER, PLAYER_ROSTER, findEntry } from './roster';

/**
 * 玩家基础属性。
 *
 * 新刻度下**不需要**主属性参与伤害计算了 —— 6 个技能的伤害都是
 * 内容里写死的固定值（攻 10 / 轰 30）。所以这里只留最小的基础值，
 * 属性系统本身仍然可用（装备/增益可以往里加）。
 *
 * 缠回复**不走属性**：它是固定"每 0.1 秒 1 点"，
 * 由 `data/balance.ts` 的 `ENERGY_PER_LOGIC_TICK` 决定。
 */
export const PLAYER_BASE: Partial<Record<StatKey, number>> = {
  strength: 10,
  agility: 10,
  intelligence: 10,
  spirit: 10,
};

/**
 * 资源上限。
 *
 * 需求：双方都是 100 血，缠与炁上限也是 100。
 *
 * **直接用展示刻度**（不再乘 `DISPLAY_SCALE`）：内容的伤害值
 * （攻 10 / 轰 30）本身就是展示刻度，两边同刻度才能对上 ——
 * 早期把血量乘了 10 而伤害没乘，结果 10 点伤害变成打掉 1 点血，
 * 一场战斗要按上百次。
 */
export const PLAYER_CAPS = { hp: HP_MAX, energy: ENERGY_MAX, douqi: DOUQI_MAX };

/**
 * Boss 资源上限。
 *
 * 血量取值依据见 `data/entities/bossHp.ts` —— 那是实测出来的
 * （玩家 214 DPS vs Boss 66 DPS），不是拍脑袋定的。
 */
export const BOSS_CAPS = { hp: BOSS_HP_DISPLAY, energy: 0, douqi: 0 };

export function makePlayer(id: string): Combatant {
  return {
    id,
    /** 显示名来自 roster（需求："这个人物目前就叫 林晚风"）。 */
    nameKey: findEntry(PLAYER_ROSTER, id)?.nameKey ?? 'hud.you',
    side: 'ally',
    caps: { ...PLAYER_CAPS },
    resources: { hp: PLAYER_CAPS.hp, energy: PLAYER_CAPS.energy, douqi: 0 },
    counters: {},
    basePrimary: { strength: 120, agility: 100, intelligence: 110, spirit: 100 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
  };
}

/**
 * 按 Boss id 取它的行为（轮转 / 狂暴 / 时限）。
 *
 * ⚠️ 行为表是**每个 Boss 自己的**，而技能注册表是**共用的** ——
 * 所以"两个 Boss 的技能都在 `ALL_SKILLS` 里"是正常的：各自只会放
 * 自己轮转里列出的那些。
 */
export function behaviorsFor(id: string): readonly Behavior[] {
  return id === 'lust' ? LUST_BEHAVIORS : VERROT_BEHAVIORS;
}

/**
 * @param options.noAi 清空轮转（只留时限）—— **截图/调试用**。
 *
 *   ⚠️ 为什么需要它：Boss 的轮转会不停打玩家，几秒内就死，于是"等某个
 *   特定机制发生"变得几乎不可能（实测想验眩晕，玩家 15 秒内就死了、
 *   「魅惑」还没轮到）。关掉 AI 后场景是**静止**的，可以稳稳造状态再截图。
 *
 *   ⚠️ 用**参数**而不是在函数里读 `location.search`：本文件会被 Node 侧
 *   的单测 import，而那里没有 `location` —— 读它会让测试**直接崩**。
 */
export function makeBoss(id: string, options?: { readonly noAi?: boolean }): Combatant {
  return {
    id,
    nameKey: findEntry(BOSS_ROSTER, id)?.nameKey ?? 'boss.name',
    side: 'enemy',
    caps: { ...BOSS_CAPS },
    resources: { hp: BOSS_CAPS.hp, energy: 0, douqi: 0 },
    counters: {},
    basePrimary: { strength: 400, agility: 200, intelligence: 300, spirit: 200 },
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: options?.noAi === true ? behaviorsFor(id).filter((b) => b.kind === 'timeLimit') : behaviorsFor(id),
    alive: true,
    /**
     * ⚠️ **固有 buff**（常驻被动）在构造时就挂上。
     *
     * 「色欲」的反伤被动需要一个**始终存在**的触发器持有者 —— 见
     * `LUST_PASSIVE` 的"自举悖论"说明。放在这里（而不是战斗开始后的
     * 某个钩子里）是因为它没有"什么时候开始"的问题：整场都在。
     */
    buffs: innateBuffsFor(id),
  };
}

/**
 * 某个 Boss 开战时就带着的 buff。
 *
 * ⚠️ `tick = 0`：固有 buff 在战斗开始前就存在，所以它的 `appliedAtTick`
 * 从 0 起算。永久 buff 不看这个值，但要保持一致（否则重放会有细微差异）。
 */
function innateBuffsFor(id: string): Combatant['buffs'] {
  if (id !== 'lust') return [];
  return applyBuff(EMPTY_FOR_INNATE, LUST_PASSIVE, id, 0).buffs;
}

/**
 * 给 `applyBuff` 用的空壳 —— 它只读 `buffs` 字段来决定"复用还是新建实例"。
 *
 * ⚠️ 不直接用 `makeBoss` 的返回值是为了避免"边构造边读自己"的书写顺序
 * 问题：`innateBuffsFor` 在对象字面量里被调用，那时对象还没建好。
 */
const EMPTY_FOR_INNATE: Combatant = {
  id: '',
  nameKey: 'hud.you',
  side: 'enemy',
  caps: { hp: 0, energy: 0, douqi: 0 },
  resources: { hp: 0, energy: 0, douqi: 0 },
  counters: {},
  basePrimary: { strength: 0, agility: 0, intelligence: 0, spirit: 0 },
  buffs: [],
  cooldowns: {},
  casts: [],
  uses: {},
  behaviors: [],
  alive: true,
};

