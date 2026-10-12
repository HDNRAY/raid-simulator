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

/**
 * 授予一个主动技能（G5）。
 *
 * ⚠️ **未实现的设计**：全仓**没有任何消费者** —— `castPipeline` /
 * `runAi` / `combat/triggers.ts` 三个能力执行点都不认它；
 * `EquipmentEntity.grantsSkills` 那条"规范化后变成 grantSkill"的
 * 规范化也从来没有写过。写了它，战斗里**静默无效**。
 *
 * **保留**是因为它是设计过的能力（技能书 / 装备授予技能那条路要用的
 * 就是这个形状），删掉会丢设计。
 *
 * ⚠️ 但**内容里写它会被校验器拒绝**（`ABILITY_UNIMPLEMENTED`，error）：
 * "静默无效"和"静默算错"一样必须被拦下。要写设计稿就显式
 * `{ strict: false }`（见 `AGENTS.md` §2）。实现之后把那条对账项删掉。
 */
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

/**
 * 从某个池子扣资源（使用次数、充能、法力都走它）。
 *
 * ⚠️ **未实现的设计**：没有任何消费者（三个能力执行点都不认它），
 * 而且它依赖的离散计数器（`ResourcePool.counters`）本身也还没接线。
 * 保留原因同 `GrantSkillAbility`；同样会被 `ABILITY_UNIMPLEMENTED` 拒绝。
 */
export interface ConsumeAbility {
  readonly kind: 'consume';
  readonly pool: ResourcePoolRef;
  readonly resource: ResourceKey | string;
  readonly amount: number | Expr;
}

/**
 * 能力的七种发射方式。
 *
 * 判定标准只有一条：**这个能力是"持续存在"还是"在某一刻发生"？**
 *   持续存在 → modifier / derived
 *   某一刻发生 → trigger / grant / deal / grantSkill / consume / resource
 *
 * 一个具体的机制永远是这两类的组合。所以新增增伤类型通常
 * **不需要新的 kind**，只需要新的 StatKey / Expr 节点 / Hook。
 *
 * ⚠️ 但上面标了"未实现的设计"的两个（`grantSkill` / `consume`）是例外：
 * 它们**有类型、有校验、没有执行点**，写了会静默无效。
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
