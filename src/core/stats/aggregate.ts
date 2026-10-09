/**
 * 属性聚合规则表。
 *
 * 数据模型规范 §5.2：**每个 stat 的聚合方式是数据，不是代码分支。**
 *
 * 为什么 `damageBoost` 必须相加而不是相乘：两个 +10% 相乘是 +21%，
 * 玩家永远算不清自己的伤害，数值也会失控。相加是 +20%，直觉正确。
 *
 * 但 `damageMult` 故意做成相乘，因为有些机制表达的就是"最终伤害 ×2"。
 * **两种语义都由数据选择，引擎不猜。**
 */

import type { StatKey } from '../types';

/** 聚合方式。 */
export type Combine =
  /** 加法层求和（力量、暴击率、增伤百分比……） */
  | 'sum'
  /** 乘法层连乘（最终伤害倍率、受到伤害倍率……） */
  | 'max'
  /** 只取最大值（不叠加，取最强的一个） */
  | 'override';

/** 结算阶段。顺序是不变量 —— 改了顺序就会改变战斗结果（黄金测试会红）。 */
export const enum Phase {
  /** 0. 基础值（来自内容定义 / 等级） */
  Base = 0,
  /** 1. 加法层 */
  Add = 1,
  /** 2. 派生层（依赖其他 stat，按 tier 升序求值） */
  Derived = 2,
  /** 3. 百分比层 `(1 + Σ addPercent)` */
  Percent = 3,
  /** 4. 乘法层 `∏ mult` */
  Mult = 4,
  /** 5. 覆盖层 */
  Override = 5,
  /** 6. 最大值层 */
  Max = 6,
  /** 7. 钳制到合法范围 */
  Clamp = 7,
}

/**
 * stat 的语义分类。**这是结算公式的分叉点**，也是我在 M1-3 踩过的坑。
 *
 * 最初我把所有 stat 都按 `(base + add) × (1 + Σpercent) × ∏mult` 计算，
 * 结果 `damageBoost = 0.1` 会被算成 `0 × 1.1 = 0` ——
 * 因为百分比乘在了 0 上。根因是**两种语义被混在一起**：
 *
 *   `damageBoost` 是**累加器**：`+10%` 就直接加到 0.1，
 *     由伤害公式在别处用它做 `× (1 + damageBoost)`。
 *
 *   `damageMult` 是**乘子**：它本身就是"最终要乘上去的那个数"，
 *     所以加法型贡献要 `1 + Σ`，乘法型贡献要 `∏`。
 */
export type Kind =
  /** 纯累加：base + Σ(add)。百分比类贡献也直接加进来。 */
  | 'accumulator'
  /** 乘子：基值 1，加法型贡献按 `1 + Σ`，乘法型贡献按 `∏`。 */
  | 'multiplier'
  /** 覆盖型：主要由 setOverride / max 决定（如 critChance 走 add 累加后钳制）。 */
  | 'value';

export interface StatRule {
  readonly combine: Combine;
  readonly kind: Kind;
  /** 钳制范围。`undefined` 表示不限制。 */
  readonly clamp?: readonly [number, number];
  /** 是否是"百分比"语义（影响 UI 显示：0.204 → 20.4%） */
  readonly percent?: boolean;
}

/**
 * 全部 stat 的规则。
 *
 * 用 `Record<StatKey, StatRule>` 强制**穷尽**：
 * 新增一个 StatKey 而不在这里给规则，编译就不过。
 * 这是"加机制要写数据、不会漏"的保障。
 */
export const STAT_RULES: Record<StatKey, StatRule> = {
  /* ---- 主属性：纯加法 ---- */
  strength: { combine: 'sum', kind: 'accumulator' },
  agility: { combine: 'sum', kind: 'accumulator' },
  intelligence: { combine: 'sum', kind: 'accumulator' },
  spirit: { combine: 'sum', kind: 'accumulator' },

  /* ---- 资源上限：加法 ---- */
  maxHp: { combine: 'sum', kind: 'accumulator', clamp: [0, Number.POSITIVE_INFINITY] },
  maxMp: { combine: 'sum', kind: 'accumulator', clamp: [0, Number.POSITIVE_INFINITY] },
  maxEnergy: { combine: 'sum', kind: 'accumulator', clamp: [0, Number.POSITIVE_INFINITY] },
  maxFury: { combine: 'sum', kind: 'accumulator', clamp: [0, Number.POSITIVE_INFINITY] },

  /* ---- 资源回复（每秒）：加法 ---- */
  hpRegen: { combine: 'sum', kind: 'accumulator' },
  mpRegen: { combine: 'sum', kind: 'accumulator' },
  energyRegen: { combine: 'sum', kind: 'accumulator' },
  furyRegen: { combine: 'sum', kind: 'accumulator' },

  /* ---- 次级属性 ---- */
  /** 暴击率上限 100% —— 超过没有意义，且会让"必定暴击"的判定变得含糊 */
  critChance: { combine: 'sum', kind: 'value', clamp: [0, 1], percent: true },
  critDamage: { combine: 'sum', kind: 'accumulator', clamp: [0, Number.POSITIVE_INFINITY] },
  /** 急速上限 50%：再高会让读条趋近于 0，破坏时间轴的语义 */
  haste: { combine: 'sum', kind: 'accumulator', clamp: [0, 0.5], percent: true },
  armor: { combine: 'sum', kind: 'accumulator', clamp: [0, Number.POSITIVE_INFINITY] },
  tenacity: { combine: 'sum', kind: 'accumulator', clamp: [0, 1], percent: true },
  /** 施法速度 / 冷却速率是**乘算**（"缩短 20%"这类表达） */
  castSpeed: { combine: 'sum', kind: 'accumulator' },
  cooldownRate: { combine: 'sum', kind: 'accumulator' },

  /* ---- 伤害修饰 ---- */
  /**
   * 全局增伤：**百分比层相加**。
   *
   * 这是数值可预期性的关键决定。两个 +10% 得到 +20%，
   * 而不是 1.1 × 1.1 - 1 = 21%。玩家能心算，数值不会失控。
   */
  damageBoost: { combine: 'sum', kind: 'accumulator', percent: true },
  /**
   * 最终伤害倍率：**乘法层连乘**。
   *
   * 与 damageBoost 并存，因为"最终伤害 ×2"和"增伤 +10%"是两种语义。
   * 由内容作者选，引擎不猜（数据模型规范 §9.4）。
   */
  damageMult: { combine: 'sum', kind: 'multiplier' },
  physicalBoost: { combine: 'sum', kind: 'accumulator', percent: true },
  spellBoost: { combine: 'sum', kind: 'accumulator', percent: true },
  dotBoost: { combine: 'sum', kind: 'accumulator', percent: true },
  directBoost: { combine: 'sum', kind: 'accumulator', percent: true },
  /** 暴击伤害加成：乘在暴击倍率上 */
  critDamageBoost: { combine: 'sum', kind: 'multiplier' },
  /** 护甲穿透：上限 100% */
  armorPen: { combine: 'sum', kind: 'accumulator', clamp: [0, 1], percent: true },
  /** 易伤（目标侧）：加法 */
  vulnerability: { combine: 'sum', kind: 'accumulator', percent: true },
  /** 受到伤害倍率：乘算 */
  damageTakenMult: { combine: 'sum', kind: 'multiplier' },
  healingBoost: { combine: 'sum', kind: 'accumulator', percent: true },
  shieldBoost: { combine: 'sum', kind: 'accumulator', percent: true },
};

/** 是否以百分比形式展示。 */
export function isPercentStat(stat: StatKey): boolean {
  return STAT_RULES[stat].percent === true;
}
