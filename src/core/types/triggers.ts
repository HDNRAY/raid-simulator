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
  /**
   * 「阶段变化」。
   *
   * ⚠️ **引擎尚未派发 —— 当前是设计稿。** 全仓没有它的触发点，
   * `combat/triggers.ts` 的运行时白名单里也没有它。
   *
   * 为什么留着：**阶段是这个游戏明确会有的东西**（傲慢 / 色欲的二阶段，
   * 以及肉鸽的强度曲线都要用），所以它是一个"设计过、还没接线"的能力，
   * 不是陈旧值 —— 删掉会丢设计。
   *
   * 为什么现在没人用：引擎**根本没有 "phase" 这个概念**，「傲慢」的二阶段
   * 是内容用 `onHpBelow`（跨过血量阈值）+ `grantBuff`（授予阶段 buff）
   * 拼出来的，不经过这个 hook。
   *
   * ⚠️ 别以为写上它就会触发：`validate.ts` 的 `SUPPORTED_HOOKS` 不在表里，
   * 内容用了会被报 `UNSUPPORTED_HOOK`（默认严格模式下就是 error）。
   * 真要做，需要先有"阶段"的归属者与派发点，见 `docs/` 的落地清单。
   */
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
  /**
   * **随机内置 CD**（ms，`[min, max]`）—— 每次触发之后**现掷**一个间隔。
   *
   * 用途：「贪婪」的「弱点」被动是"**随机频率** 3–5 秒来一次"，而不是
   * 固定节拍。写 `cooldownMs` 只能给固定值，写在这里才有随机。
   *
   * ⚠️ 掷点走**种子化 RNG**（与 `chance` 同一条流），所以固定种子下的
   * 重放仍然逐位可复现 —— 不消耗 `Math.random`。
   * ⚠️ 与 `cooldownMs` **二选一**（都写时本字段优先）。
   */
  readonly cooldownRangeMs?: readonly [number, number];
  /** 触发概率，走种子化 RNG */
  readonly chance?: number;
  readonly maxTriggersPerTick?: number;
  /** 整场战斗最多触发次数 */
  readonly maxTriggersPerEncounter?: number;
  /** 产出：又是 ability，天然可嵌套（buff 授予 buff） */
  readonly then: readonly Ability[];
}
