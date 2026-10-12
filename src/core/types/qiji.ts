/**
 * 炁机（qiji）—— 一局肉鸽里的强化方向 / 奇物 / 奖励。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5。
 *
 * ==================================================================
 * 本文件是**形状**，不是内容（P0 只做形状）
 * ==================================================================
 *
 * `QijiEntity` 是 `GameEntity` 的子类（用户原话："炁机也是 gameentity
 * 啊……继承"）。这样展示信息（`nameKey` / `icon` / `rarity`）、"解锁后
 * 生效什么"（`abilities`）、战斗内条件（`requires`）、使用次数 / 充能
 * （`pool`）全部**直接继承**，不需要为炁机另起一套数据结构。
 *
 * ⚠️ **内容表 `src/data/qiji.ts` 不在 P0**：本文件只声明形状，
 * 一个炁机实例都还没有。于是"引擎里还没有消费者"这件事在 P0
 * 不会造成静默无效 —— 因为没有内容可以写。
 *
 * 与 `EntityKind` / 校验器 / 注册表的关系见下面 `QijiEntity.kind`
 * 的说明（那是 **W8**，属于 P6）。
 *
 * 依赖方向与 `LocaleKey` 同一条纪律（`core/types/ids.ts`）：**接口形状
 * 由消费者声明，实现方满足它** —— `data/qiji.ts` 将来实现这里声明的
 * `QijiEntity`，而 core 层不认识任何具体炁机。
 */

import type { GameEntity } from './skills';

/* ================================================================== *
 * 1. 一局肉鸽的计数器
 * ================================================================== */

/**
 * 一局肉鸽内可累计的计数器。
 *
 * **封闭联合**，理由是"拼错一个键名会静默失效"：如果这里是
 * `string`，`{ kind: 'counterAtLeast', counter: 'jieInterupts' }`
 * 会编译通过、求值恒为 0（永远差一点解锁），而**没有任何东西会报错**。
 * 做成联合之后，拼错是编译错误。
 *
 * ⚠️ 五个值的语义与"从哪来"（P0 只**累加**它们，不产生它们）：
 *
 * | 值 | 含义 | 谁产生 |
 * |---|---|---|
 * | `jieInterrupts` | 「截」成功打断次数 | 引擎（**W3** 派发 `onInterruptSuccess` + **W1** 写计数器）→ P1 |
 * | `interrupts` | 任何技能成功打断次数 | 同上 |
 * | `dodges` | 成功闪避次数 | 引擎（已有 `avoided` 事件 / 池子）→ P1 |
 * | `battlesWon` | 赢下的战斗数 | `RunState` 自己（`core/run/lifecycle.ts`） |
 * | `flawlessBattles` | 满血赢下的战斗数 | 引擎（终局快照里玩家的 `hp === caps.hp`）→ P1 |
 *
 * ⚠️ **P0 不实现引擎侧的计数器**（那是 W1 / W3）。`core/run/` 在每场战斗
 * 结束时读**终局快照里的计数**并**累加** —— 所以本文件只声明键名，
 * 不声明"怎么数出来"。
 */
export type RunCounter =
  /** 「截」成功打断次数（W3 派发 `onInterruptSuccess` 后可得）。 */
  | 'jieInterrupts'
  /** 任何技能成功打断次数。 */
  | 'interrupts'
  /** 成功闪避次数。 */
  | 'dodges'
  /** 赢下的战斗数。 */
  | 'battlesWon'
  /** 满血赢下的战斗数。 */
  | 'flawlessBattles';

/**
 * 全部合法计数器键，**运行期**的一份。
 *
 * 存在的理由：类型在运行期被擦除，而"解析一份外来的存档 / 一份未经验证
 * 的终局快照"必须按**同一份清单**过滤（`isRunCounter`）。若这份清单与
 * `RunCounter` 漂移，坏数据就会被静默当成 0 —— 那正是封闭联合要防的事，
 * 所以两者放在同一个文件、相邻的位置，改一个就会看见另一个。
 */
export const RUN_COUNTERS: readonly RunCounter[] = [
  'jieInterrupts',
  'interrupts',
  'dodges',
  'battlesWon',
  'flawlessBattles',
];

/** 类型守卫：这个字符串是不是一个合法的 `RunCounter`（用于校验外来数据）。 */
export function isRunCounter(value: unknown): value is RunCounter {
  return typeof value === 'string' && RUN_COUNTERS.some((counter) => counter === value);
}

/**
 * 一份"计数器 → 次数"的映射（**不完整**，缺的键等于 0）。
 *
 * 用 `Partial` 而不是全零对象：`RunState` 要进 JSON、要被 diff，
 * `{ jieInterrupts: 3 }` 比 `{ jieInterrupts: 3, interrupts: 0, dodges: 0, … }`
 * 既短又能一眼看出"这一局真的数到了什么"。读的时候统一走
 * `core/run/lifecycle.ts` 的 `counterValue`（缺键 = 0），
 * 不要在别处写 `?? 0`。
 */
export type RunCounters = Readonly<Partial<Record<RunCounter, number>>>;

/* ================================================================== *
 * 2. 解锁条件
 * ================================================================== */

/**
 * 一个炁机的解锁条件（**一局肉鸽维度**）。
 *
 * ==================================================================
 * ⚠️ 为什么 `always` 带一个空的 `of`（而不是"没有 `of` 的可选字段"）
 * ==================================================================
 *
 * 这个联合要同时被三个地方按**同一种形状**消费：
 *   - `core/run/unlock.ts` 的 `evalUnlock`（判定）与 `unlockProgress`（进度文案）
 *   - `core/run/lifecycle.ts` 的 `withUnlocked`（刷新解锁集合）
 *   - 将来 `data/qiji.ts` 的内容作者
 *
 * `always` 是"零个子条件的 `all`"：写成 `{ kind: 'always', of: [] }` 之后，
 * **组合子那一层只需要处理"有没有 `of`、里面几项"一件事**，而不用为
 * "`of` 不一定存在"再开一条分支。少一条分支就是少一个"两处实现漂开"的
 * 机会 —— 判定与进度文案各自针对 `of === undefined` 做不同的兜底，
 * 正是"卡片说 3/3、点下去却没解锁"这类 bug 的来源。
 *
 * ⚠️ 代价是内容作者要写 `of: []`。这比"两个联合成员长得不一样、
 * 每个消费者各自判空"便宜得多。
 *
 * ==================================================================
 * 与 `Condition`（战斗内条件）是两件事
 * ==================================================================
 *
 *   - `Condition`：一场战斗**之中**，某个技能 / buff / 行为此刻能不能生效
 *   - `QijiUnlock`：一局肉鸽**之间**，某个炁机累积够了没有
 *
 * 刻意不复用同一个联合：两者的求值时机、状态来源、错误后果都不同
 * （战斗内条件错了是这一局打错，解锁条件错了是**整局的成长路线错**）。
 * 组合子与 `Condition` 同构，是为了让"读一份解锁条件"不用学第二套语法。
 *
 * ⚠️ P0 只实现这一种叶子（`counterAtLeast`），**没有 `counterBelow`**：
 * "解锁"在语义上只有"够不够"，没有"少到某个程度才给"。真要"少挨打才给"
 * 这类条件，用 `not` + `counterAtLeast` 表达，比加一个方向相反的叶子
 * 少一份需要解释的语义（`value` 是"低于它才算满足"听起来就像 bug）。
 */
export type QijiUnlock =
  /** 开局即可选（"通用炁机"，§5.4 —— 兜底不是特判，只是零子条件的 `all`）。 */
  | { readonly kind: 'always'; readonly of: readonly QijiUnlock[] }
  /**
   * 一局肉鸽内累计到 `value` 次。
   *
   * 比较方向是 `>=`（"成功使用 3 次截"在第 3 次就该解锁，不是第 4 次），
   * 求值只在 `core/run/unlock.ts` 的 `evalUnlock` 一处实现。
   */
  | { readonly kind: 'counterAtLeast'; readonly counter: RunCounter; readonly value: number }
  /** 全部满足（**空 = 真**：没有一项被违反）。 */
  | { readonly kind: 'all'; readonly of: readonly QijiUnlock[] }
  /** 任一满足（**空 = 假**：没有一个证人）。 */
  | { readonly kind: 'any'; readonly of: readonly QijiUnlock[] }
  /** 取反。`of` 是**单个**条件（不是数组）—— 取反多个条件的正确写法是 `not(all([…])`。 */
  | { readonly kind: 'not'; readonly of: QijiUnlock };

/* ================================================================== *
 * 3. QijiEntity
 * ================================================================== */

/**
 * 一个炁机的分类，**只用于 UI 分组与排序**（不参与任何判定）。
 */
export type QijiCategory = 'offense' | 'defense' | 'tempo' | 'utility' | 'generic';

/**
 * 一个炁机：`GameEntity` 的子类。
 *
 * 继承来的字段各自的作用（§5.1 的对照表）：
 *   - `id` / `nameKey` / `icon` / `descKey` / `rarity` → 展示，零额外字段
 *   - `abilities` → **解锁后生效什么**（与既有能力系统同一套）
 *   - `requires` → 战斗内条件
 *   - `pool` → 奇物类炁机的使用次数 / 充能（要靠 **W5** 才活）
 *
 * ⚠️ **`kind` 是 `GameEntity['kind']`，还不是字面量 `'qiji'`** —— 这是
 * **W8 没做**的直接后果，写清楚以免下一个人以为是笔误：
 *
 *   `GameEntity.kind` 的类型是 `EntityKind`（`core/types/skills.ts`），
 *   而 `'qiji'` **还不在**那个联合里。把这里写成 `readonly kind: 'qiji'`
 *   会让 `QijiEntity` **不再满足 `GameEntity`**：`abilities: readonly Ability[]`
 *   都写得进去，但任何 `QijiEntity` 都没法赋给 `GameEntity` 参数 ——
 *   而"继承 `GameEntity`"正是这个设计选它的理由。所以要么真的做 W8
 *   （加值 + 校验器 + 注册表，**P6**），要么就只能在这里如实写
 *   `GameEntity['kind']`。
 *
 *   P0 没有任何炁机内容，`core/run/` 也**不读 `kind`**，所以这个宽化
 *   在 P0 不产生任何静默行为。做 W8 时把 `EntityKind` 加上 `'qiji'`，
 *   然后把这一行收窄成 `readonly kind: 'qiji'` —— 类型系统会**逼着**
 *   那一刻发生，而不是让它悄悄漂。
 */
export interface QijiEntity extends GameEntity {
  /** ⚠️ W8 之后收窄成 `'qiji'`；现在只能是 `GameEntity['kind']`（见上）。 */
  readonly kind: GameEntity['kind'];
  /** 只用于 UI 分组与排序。 */
  readonly category: QijiCategory;
  /** 解锁条件（**一局肉鸽**维度）。 */
  readonly unlock: QijiUnlock;
  /**
   * 一局肉鸽内最多生效几层（**默认 1**，§5.3）。
   *
   * 默认 1 的语义是"每次做一个**新**决定"：同一个炁机不会变成无脑叠加，
   * 只有明确声明了上限的通用炁机（+30 生命这类）才允许叠，而叠满之后
   * 玩家被迫看向机制炁机（§11 风险 #2 的缓解）。
   */
  readonly maxStacks?: number;
}

/**
 * ⚠️ **引擎尚未校验这个实体**（W8 / 注册表的对账项）。
 *
 * 现在注册表能收 `entities`（`core/content/registry.ts`），但 `QijiEntity`
 * 的 `kind` 不在 `EntityKind` 里、也没有"为什么这个 kind 不被支持"的
 * 报错路径 —— 所以一份炁机内容**既不会生效、也不会被拦下**。
 *
 * P0 没有内容表，所以不会有这种内容出现。这条常量的作用是：把
 * "引擎还没把它当一等公民"写在**一个可被 import 的名字**上
 * （将来 `data/qiji.ts` 或载荷校验可以断言它），而不是只写在注释里。
 */
export const QIJI_ENTITY_VALIDATED = false as const;
