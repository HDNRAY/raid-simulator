/** Ability —— 唯一的原子单位（7 个变体）。 */

import type { BuffId, SkillId } from './ids';
import type { ResourceKey, ResourcePoolRef } from './resources';
import type { Expr, StatModifier } from './stats';
import type { BuffDef } from './buffs';
import type { TriggerDef } from './triggers';
import type { HitDef, TargetRule } from './effects';
import type { Condition } from './stats';

/* ================================================================== *
 * 7. Ability —— 唯一的原子单位
 * ================================================================== */

export interface ModifierAbility {
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
  readonly kind: 'modifier';
  readonly modifier: StatModifier;
}

export interface DerivedAbility {
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
  readonly kind: 'derived';
  readonly modifier: Omit<StatModifier, 'value'>;
  readonly value: Expr;
}

export interface TriggerAbility {
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
  readonly kind: 'trigger';
  readonly trigger: TriggerDef;
}

export interface GrantAbility {
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
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
  /**
   * **随这次授予写进实例的自定义数值**（缺省 = 用 `buff.custom`）。
   *
   * 用途：「血盾」每次偷的量不一样，而"破壳时还多少"要**按当初偷的算** ——
   * 所以得让**授予者**把那个数带进来（`grantBuffFromTrigger` 已经收它，
   * 见 `triggers.ts` 的调用点）。
   */
  readonly custom?: number;
}

export interface DealAbility {
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
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
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
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
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
  readonly kind: 'resource';
  readonly target: TargetRule;
  readonly resource: ResourceKey | string;
  readonly delta: number | Expr;
}

/**
 * **移除一个 buff**（按 `buffId`，不分实例）。
 *
 * ==================================================================
 * 为什么需要它（而不是复用现有的 `deal` / `resource`）
 * ==================================================================
 *
 * 触发器的执行器只认**它真的用得上**的那几类动作（`grant` / `resource` /
 * `deal`）。而「懒惰」的「怠惰」要求"**挨一次打就把层数清零**" ——
 * 那是"移除"语义，三者都表达不了：
 *
 *   - `grant` 只能加
 *   - `resource` 只碰资源池
 *   - `deal` 是伤害
 *
 * ⚠️ 写一个联合里没有的 kind 会被**静默忽略**（执行器的 `default: break`）
 * —— 也就是"看起来生效、实际什么都不做"。所以这里**显式**加一个成员，
 * 并在 `triggers.ts` / `runAi.ts` 两处执行器里实现它。
 *
 * ⚠️ **按 `buffId` 移除**（同 defId 的所有实例一起清）：这与
 * `EffectKind: 'removeBuff'` 的语义一致（那条是"把一个 buff 摘掉"），
 * 而且"清零"要的正是这个 —— 不是"减一层"。
 */
export interface RemoveBuffAbility {
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
  readonly kind: 'removeBuff';
  readonly target: TargetRule;
  readonly buffId: BuffId;
  /**
   * **只减多少层**（缺省 = 整条摘掉）。
   *
   * ⚠️ 用户要的"**计数用 buff 层数**"这条路，光能加不够 —— 还得能**减 1**：
   * 「暴怒」的怒火是"每 2 秒不挨打 **−1 层**"（不是清零）。
   * 层数减到 0 的实例会被摘掉（并补 `buffExpired`，与整条摘掉同一条路）。
   */
  readonly stacks?: number;
}

/**
 * 从某个池子扣资源（使用次数、充能、法力都走它）。
 *
 * ⚠️ **未实现的设计**：没有任何消费者（三个能力执行点都不认它），
 * 而且它依赖的离散计数器（`ResourcePool.counters`）本身也还没接线。
 * 保留原因同 `GrantSkillAbility`；同样会被 `ABILITY_UNIMPLEMENTED` 拒绝。
 */
export interface ConsumeAbility {
  /** 条件：假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。 */
  readonly when?: Condition;
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

/**
 * **每条能力都可以带一个条件**（`when`，2026-10-20 加的）。
 *
 * ==================================================================
 * 为什么"能力"需要它（而不是只让触发器有 `when`）
 * ==================================================================
 *
 * 「恶魔低语·二阶段」的做法是：**每个 Boss 自己**写一条
 * `onHpBelow(0.4)` 行为，而"这一层到底抽没抽到二阶段"由一条**隐藏标记**
 * 决定。可是 `Ability` 原先**没有** `when` ⇒ 到了 40% 血，那批能力会
 * **无条件**执行（没抽到二阶段也照切）✗。
 *
 * 另一条路是"每个 Boss 再加一条开关 buff，用触发器条件过滤"—— 能work，
 * 但每个 Boss 多两个 buff（开关 + 形态）且要读两遍数据；有了 `when` 之后
 * 只需要"能力上挂一个条件"，判据与其它 `when` **同一套**（`Condition`）。
 *
 * ⚠️ 语义：`when` 为假 ⇒ **这一条能力不执行**（同一批里的其它能力照常）。
 * ⚠️ 刻意**不**加在 `Effect` 上：命中效果已经有 `when`（`HitDef.effects[].when`）。
 */
/**
 * **能力**：内容声明"到某个时机做什么"的原子单位。
 *
 * ⚠️ **每条能力都可以带 `when`**（2026-10-20 加的）—— 那是「恶魔低语·
 * 二阶段」的开关：每个 Boss 自己写一条 `onHpBelow(0.4)` 行为，而"这一层
 * 到底抽没抽到二阶段"由一条**隐藏标记**决定；没有 `when` 的话，到了 40%
 * 血那批能力会**无条件**执行（没抽到也照切）✗。
 *
 * 判据与其它 `when` **同一套**（`Condition`）；`Effect` 那边早就有
 * `when`（`HitDef.effects[].when`），这里是补上"能力"这一侧。
 */
export type Ability =
  | ModifierAbility
  | DerivedAbility
  | TriggerAbility
  | GrantAbility
  | DealAbility
  | GrantSkillAbility
  | ConsumeAbility
  | ResourceAbility
  | RemoveBuffAbility;

export type AbilityKind = Ability['kind'];
