/** Ability —— 唯一的原子单位（7 个变体）。 */

import type { SkillId } from './ids';
import type { ResourceKey, ResourcePoolRef } from './resources';
import type { Expr, StatModifier } from './stats';
import type { BuffDef } from './buffs';
import type { TriggerDef } from './triggers';
import type { HitDef, TargetRule } from './effects';

/* ================================================================== *
 * 7. Ability —— 唯一的原子单位
 * ================================================================== */

export interface ModifierAbility {
  readonly kind: 'modifier';
  readonly modifier: StatModifier;
}

export interface DerivedAbility {
  readonly kind: 'derived';
  readonly modifier: Omit<StatModifier, 'value'>;
  readonly value: Expr;
}

export interface TriggerAbility {
  readonly kind: 'trigger';
  readonly trigger: TriggerDef;
}

export interface GrantAbility {
  readonly kind: 'grant';
  readonly buff: BuffDef;
  readonly target: TargetRule;
  /**
   * 结算时刻（默认 `'castFinish'`）。
   *
   * 传 `'castStart'` 让这个 buff **起手就挂上** —— 用于"施法期间的状态"
   * （霸体、施法光环）。详见 `AbilityTiming` 的说明。
   */
  readonly on?: AbilityTiming;
}

export interface DealAbility {
  readonly kind: 'deal';
  readonly target: TargetRule;
  readonly hit: HitDef;
}

export interface GrantSkillAbility {
  readonly kind: 'grantSkill';
  readonly skillId: SkillId;
  readonly autoEquip?: boolean;
}

/**
 * 增减资源（**一次性**变动）。
 *
 * ⚠️ 不能用 `modifier` 加 `douqiRegen` 代替：那表达的是**持续回复速率**，
 * 于是"产生 12 点炁"会变成"每秒 12 点"。语义不同。
 */
export interface ResourceAbility {
  readonly kind: 'resource';
  readonly target: TargetRule;
  readonly resource: ResourceKey | string;
  readonly delta: number | Expr;
}

/** 从某个池子扣资源（使用次数、充能、法力都走它）。 */
export interface ConsumeAbility {
  readonly kind: 'consume';
  readonly pool: ResourcePoolRef;
  readonly resource: ResourceKey | string;
  readonly amount: number | Expr;
}

/**
 * 能力的五种发射方式（+ 授予技能 + 消耗，共 7 个变体）。
 *
 * 判定标准只有一条：**这个能力是"持续存在"还是"在某一刻发生"？**
 *   持续存在 → modifier / derived
 *   某一刻发生 → trigger / grant / deal / grantSkill / consume
 *
 * 一个具体的机制永远是这两类的组合。所以新增增伤类型通常
 * **不需要新的 kind**，只需要新的 StatKey / Expr 节点 / Hook。
 */
/**
 * 能力在**读条的哪个时刻**结算。默认 `'castFinish'`（读条结束）。
 * 传 `'castStart'` 用于"施法期间的状态"（霸体、施法光环）。
 */
export type AbilityTiming = 'castStart' | 'castFinish';

export type Ability =
  | ModifierAbility
  | DerivedAbility
  | TriggerAbility
  | GrantAbility
  | DealAbility
  | GrantSkillAbility
  | ConsumeAbility
  | ResourceAbility;

export type AbilityKind = Ability['kind'];
