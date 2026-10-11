/** 触发（Hook / TriggerDef）与技能标签。 */

import type { BuffId, SkillId } from './ids';
import type { Condition } from './stats';
import type { Ability } from './abilities';

/* ================================================================== *
 * 5. 触发与事件
 * ================================================================== */

/** 快通道：给触发器用。只带最小载荷，渲染层不消费。 */
export type Hook =
  | 'onCastStart'
  | 'onCastFinish'
  | 'onCastInterrupted'
  | 'onInterruptSuccess'
  | 'onHitDealt'
  | 'onHitTaken'
  | 'onCritDealt'
  | 'onCritTaken'
  | 'onAvoided'
  | 'onKill'
  | 'onBuffApplied'
  | 'onBuffExpired'
  | 'onBuffStackChanged'
  | 'onResourceSpent'
  | 'onResourceGained'
  | 'onLowHp'
  | 'onDamagedBelow'
  | 'onHealed'
  | 'onTick'
  | 'onEncounterStart'
  | 'onEncounterEnd'
  | 'onPhaseChange';

/**
 * 技能的**机械分类**（给引擎判定用，不是给玩家看的提示）。
 *
 * ⚠️ 与 `HintTag` **分开、两边都要维护**：本类型是静态作者数据
 * （消费者只有 `BuffFlags.restrictToTags` 的技能白名单）；`HintTag` 是
 * 视图层的**计算集**（`viewAdapter` 把霸体等状态派生进去）。合并后
 * "由状态推出的提示"就没地方放了。
 *
 * ⚠️ 取值要克制，标准是"**当前有消费者吗**"：`dot` / `movement` /
 * `interrupt` 曾是零消费者或零声明的死值，已按需求（"死值先删，以后
 * 需要再加回来"）删除。尤其别把 `interrupt` 加回来 —— `HintTag` 里有
 * 同名值（给玩家看的「打断」），两个 union 各写一遍必然漂移。
 */
export type SkillTag =
  | 'melee'
  | 'spell'
  | 'defensive'
  /**
   * 「闪避」类招式（需求："给『闪』和『避』加上『闪避』tag"）。
   *
   * 用途：**被控时的唯一出路** —— 倒地期间只有带它的技能可按。
   * ⚠️ 与 `defensive` 分开：「防」也属于 `defensive`，但倒地时按「防」
   * 不合理（你正躺着）。
   */
  | 'dodge';

/**
 * ⚠️ 这里**曾经**有过一个 `'knockdown'`（「倒地」）值，已删。
 *
 * 它只活了一小会儿：为了让玩家看到"傲慢的哪一招会让人倒地"而加，
 * 但那个做法是**在手写一份已经存在的数据** —— 倒地这件事的真相在
 * `KNOCKDOWN` 这个 `BuffDef` 里（它自己就有 `nameKey: 'debuff.knockdown.name'`
 * =「倒地」）。
 *
 * 现在控制类提示**从效果推导**，取的就是 debuff 自己的名字
 * （见 `app/skillHints.ts`）。所以再加一个 union 值只会是：
 *   1. 一份需要人工同步的副本（玩家已经因为不同步报过两次 bug）
 *   2. 一个"只能表达倒地、表达不了眩晕"的特例
 *
 * 于是它被推导取代了 —— **不要加回来**。要新增一个"会控住玩家"的
 * debuff，只要那个 buff 带上 `actionLock` / `restrictToTags`，
 * 读条上就自动出现它的名字。
 */


export type HookFilter =
  | { readonly by: 'self' }
  | { readonly by: 'other' }
  | { readonly by: 'skill'; readonly skillId?: SkillId; readonly tag?: SkillTag }
  | { readonly by: 'buff'; readonly buffId: BuffId };

export interface TriggerDef {
  readonly on: Hook;
  readonly filter?: HookFilter;
  readonly when?: Condition;
  /** 内置 CD（ms），防抖 */
  readonly cooldownMs?: number;
  /** 触发概率，走种子化 RNG */
  readonly chance?: number;
  readonly maxTriggersPerTick?: number;
  /** 整场战斗最多触发次数 */
  readonly maxTriggersPerEncounter?: number;
  /** 产出：又是 ability，天然可嵌套（buff 授予 buff） */
  readonly then: readonly Ability[];
}
