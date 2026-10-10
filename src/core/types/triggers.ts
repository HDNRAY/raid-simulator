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
 * 招式的**玩法提示标签**（给玩家看的，不参与计算）。
 *
 * ⚠️ 与 `SkillTag` 分开的理由是**生命周期不同**：`tags` 是静态作者数据，
 * 而 `hintTags` 在视图层是**计算集**（`viewAdapter` 会把霸体等状态派生
 * 进去）—— 合并后就没地方放"由状态推出的提示"。标识符英文，文案在 i18n。
 */
export type HintTag =
  /** 「霸体」：无法被打断 —— 别浪费打断技 */
  | 'interruptImmune'
  /** 「高伤」：单次伤害很高 —— 闪避（全免）比防御（减伤）更值 */
  | 'highDamage'
  /** 「打断」：这一招会打断目标读条 */
  | 'interrupt';


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
