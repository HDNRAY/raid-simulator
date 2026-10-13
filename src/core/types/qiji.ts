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
 * 一个炁机实例都还没有。
 *
 * 与 `EntityKind` / 校验器 / 注册表的关系见下面 `QijiEntity.kind`
 * 的说明（那是 **W8**，属于 P6）。
 *
 * 依赖方向与 `LocaleKey` 同一条纪律（`core/types/ids.ts`）：**接口形状
 * 由消费者声明，实现方满足它** —— `data/qiji.ts` 将来实现这里声明的
 * `QijiEntity`，而 core 层不认识任何具体炁机。
 */

import type { GameEntity } from './skills';
import type { BuffDef } from './buffs';
import type { BuffId, SkillId } from './ids';
import type { ResourceKey } from './resources';
import type { StatKey } from './stats';
import type { ResourceAbility } from './abilities';
import type { BattleStatQuery as RunStatQuery } from '../run/query';

/* ================================================================== *
 * 1. 解锁条件（一局肉鸽维度）
 * ================================================================== */

/**
 * 一个炁机的解锁条件（**一局肉鸽维度**）。
 *
 * ==================================================================
 * ⚠️ 这里**曾经**是一个封闭的 5 元素计数器联合（已删除）
 * ==================================================================
 *
 * 旧形状（第一版设计）：
 *
 * ```ts
 * type RunCounter = 'jieInterrupts' | 'interrupts' | 'dodges'
 *                  | 'battlesWon' | 'flawlessBattles';   // ✗ 已删
 * ```
 *
 * 用户否掉了它，原话是嫌它**只能数技能使用次数**。具体三个"做不出来"：
 *
 *   1. **分不出是哪个技能**：「截」打断 3 次与「破」打断 3 次在旧形状里
 *      是**同一个数**（`interrupts`），因为闭集里没有"哪个技能"这一维。
 *      而用户的「截拳道」/「招架反击流」要的正是这个区分。
 *   2. **没有伤害维度**：闭集里根本没有 `damage`，所以"某个技能造成
 *      伤害数"（用户点名的第一条要求）**无法表达** —— 只能回去改
 *      `core/types/` 的常量表，也就是"加一条炁机要动引擎类型"。
 *   3. **作用域含糊**：旧形状里 `'battle' | 'run'` 只写在文档里，
 *      类型上没有位置放它。
 *
 * 现在改成**对统计的一次查询 + 组合子**：
 *   - 叶子 = `{ kind: 'statAtLeast'; stat: RunStatQuery; value }`
 *     （查询本身声明在 `core/run/stats.ts`，**开放**：加维度不动本文件）
 *   - 组合子 = `all` / `any` / `not`（与 `Condition` 同构）
 *
 * ⚠️ 于是"条件写在**内容数据**里"（`data/qiji.ts` 的每一条 `QijiUnlock`）
 * 成为可能：新炁机只需要写一条查询，不需要往 `core/` 加一个联合成员。
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
 * **组合子那一层只需要处理"里面几项"一件事**，而不用为"`of` 不一定存在"
 * 再开一条分支。少一条分支就是少一个"两处实现漂开"的机会。
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
 * 求值时机、状态来源、错误后果都不同，所以不复用同一个联合。
 * 组合子与 `Condition` 同构，是为了让"读一份解锁条件"不用学第二套语法。
 */
export type QijiUnlock =
  /** 开局即可选（"通用炁机"，§5.4 —— 兜底不是特判，只是零子条件的 `all`）。 */
  | { readonly kind: 'always'; readonly of: readonly QijiUnlock[] }
  /**
   * 对**统计**的一次查询 >= `value`。
   *
   * ⚠️ 比较方向是 `>=`（"成功使用 3 次截"在第 3 次就该解锁，不是第 4 次），
   * 求值只在 `core/run/unlock.ts` 的 `evalUnlock` 一处实现。
   *
   * ⚠️ 查询对象（`RunStatQuery`）声明在 `core/run/stats.ts`：
   * 那里才有"统计里有哪些维度"的知识。本文件只负责"条件可以引用一次查询"。
   */
  | { readonly kind: 'statAtLeast'; readonly stat: RunStatQuery; readonly value: number }
  /** 全部满足（**空 = 真**：没有一项被违反）。 */
  | { readonly kind: 'all'; readonly of: readonly QijiUnlock[] }
  /** 任一满足（**空 = 假**：没有一个证人）。 */
  | { readonly kind: 'any'; readonly of: readonly QijiUnlock[] }
  /** 取反。`of` 是**单个**条件；取反多个条件的正确写法是 `not(all([…]))`。 */
  | { readonly kind: 'not'; readonly of: QijiUnlock };

/**
 * 一次统计查询（转发别名）。
 *
 * 真正的定义在 `core/run/query.ts` —— 那里才有"查询能问什么维度"的
 * 知识（`skillUses` / `skillDamage` / …）。这里转发是为了让
 * `QijiEntity.unlock` 的读者不必知道"查询住在 run 层"。
 *
 * ⚠️ 依赖方向：这是**纯类型**转发（`export type`），编译期即擦除 ——
 * 不产生"`core/types` → `core/run`"的运行期依赖，也就不可能与
 * `core/run/stats.ts`（它 `import type` 本文件所在的目录）成环。
 */
export type { BattleStatQuery as RunStatQuery } from '../run/query';

/* ================================================================== *
 * 2. QijiEntity
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
 * ⚠️ **`kind` 在 P3 收窄成了 `'qiji'`**（`EntityKind` 同时加了那个值）——
 * 这是 W8 的**类型那一半**。P0 时它只能是 `GameEntity['kind']`，于是内容里
 * 只能填 `'passive'` 这种假值；现在类型系统会逼着"炁机就是炁机"。
 *
 * ⚠️ **W8 的另一半（校验器 / 注册表）仍然没做**（P6）：`data/qiji.ts` 的
 * 内容**不进 `ContentBundle.entities`**，所以它今天不会被内容校验器读到。
 * 这不产生静默行为（炁机的效果走 `BattleKit` / `comboWindow` 两条明路），
 * 但"一个炁机引用了不存在的 buff / 技能"要等 P6 才有人拦。
 */
export interface QijiEntity extends GameEntity {
  readonly kind: 'qiji';
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
  /**
   * **它接回的那条派生关系**（P3；§5.2 的「炁机接回产出者」）。
   *
   * 用户 2026-10-13 的定调：「**这个整体是一个炁机，不是 击 是炁机**」——
   * 所以这里存的是"**源技能 → 派生技**"这条关系，不是"一个叫击的道具"：
   *
   *   - `sourceSkillId`：**哪个技能成功时开窗口**（「截」= `jie`）
   *   - `derivedSkillId`：**窗口开着时哪个技能可用**（「击」= `strike`）
   *   - `buff`：要挂的窗口 buff。它的 `flags.comboWindowSource` 就是
   *     `sourceSkillId`（渲染层靠它把派生技画在源技能上方）
   *   - `viaBuffId`（可选）：**第二条成功通道** ——
   *     这个 buff 挡下整击时也算"用成功了"。「卸」（`guard`）与
   *     「闪」（`flash-iframe`）走它，因为它们从不发 `interruptSuccess`。
   *
   * ⚠️ 它是**内容字段**（`data/qiji.ts` 写它），而引擎侧的消费者是
   * `app/kit.ts` 的 `buildPlayerKit` → `CreateBattleOptions.comboWindows`。
   * `core/run/`（解锁那一条线）**不读它** —— 解锁只看统计。
   */
  readonly comboWindow?: QijiComboWindow;
  /**
   * **它对某个技能的改动**（代价 / 成功后的一次性资源）。
   *
   * 见 `QijiSkillTweak` 的说明：与 `comboWindow` 同一条路 —— 都是
   * "内容层多一种专门字段"，因为它们要表达的东西继承来的 `abilities`
   * 表达不了。
   */
  readonly skillTweak?: QijiSkillTweak;
}

/**
 * 一个炁机接回的派生关系（见 `QijiEntity.comboWindow`）。
 *
 * ⚠️ 单独一个接口而不是内联对象：`app/kit.ts` 的 `buildPlayerKit` 与
 * `data/qiji.ts` 的内容作者都要写它，而"这两个 id + 一个 buff"是三处
 * 必须一起对上的东西（少一个就是"窗口开了但派生技不出现"）。
 */
export interface QijiComboWindow {
  /** **哪个技能**成功时开窗口。 */
  readonly sourceSkillId: SkillId;
  /** **窗口开着时哪个技能可用**（派生技）。 */
  readonly derivedSkillId: SkillId;
  /** 要挂的窗口 buff（`flags.comboWindowSource` 应当等于 `sourceSkillId`）。 */
  readonly buff: BuffDef;
  /** 第二条成功通道：这个 buff 挡下整击时也算成功（「卸」/「闪」）。 */
  readonly viaBuffId?: BuffId;
}

/**
 * **一个炁机对某个技能的改动**（2026-10-13 加的）。
 *
 * ==================================================================
 * 为什么 `abilities` 表达不了它（这是它存在的全部理由）
 * ==================================================================
 *
 * `QijiEntity` 继承来的 `abilities` 只有两条生效路径
 * （`data/kit.ts` 的 `buildPlayerKit`）：
 *
 *   - `modifier` / `derived` → `passiveModifiers`：改的是**玩家身上的属性**
 *   - `comboWindow`          → `comboWindows`：接回一条派生关系
 *
 * 而用户点名的三条新炁机改的是**某一个技能的定义本身**：
 *
 *   - 「避」用出后**回复 20 缠**（一次性的资源变动，挂在"用出避"这一刻）
 *   - 「凝」的**缠消耗 −20**（改的是那个技能的 `cost`）
 *   - 「凝」的**增伤变成 100%**（改的是那个 buff 的修正值）
 *
 * 这三样都**不是玩家属性**：`passiveModifiers` 加不出"某个技能便宜 20 缠"
 * （代价读的是 `SkillDef.cost`，属性管线碰不到它）；而 `ResourceAbility`
 * （引擎有消费者，`castPipeline` 付账后结算 `kind:'resource'`）只能挂在
 * **技能自己的** `abilities` 上，不在炁机里。
 *
 * ==================================================================
 * ⚠️ 它属于**既有模型**，不是新开的一套（判据在 AGENTS.md §2）
 * ==================================================================
 *
 * 与 `QijiComboWindow` 逐条同构：
 *
 *   | | `comboWindow` | `skillTweak` |
 *   |---|---|---|
 *   | 住在 | `QijiEntity` 的一个可选字段 | 同 |
 *   | 谁写它 | 内容（`data/qiji.ts`） | 同 |
 *   | 谁消费 | `buildPlayerKit` → `comboWindows` | `buildPlayerKit` → 覆盖后的技能表 |
 *   | 为什么不能复用 `abilities` | 派生关系不是能力 | 技能定义不是属性 |
 *
 * 也就是说：**没有加"引擎机制"，加的是"内容能说什么"** ——
 * 与 P3 给炁机加 `comboWindow` 是同一步的继续。
 *
 * ==================================================================
 * 两条效果，各自的语义
 * ==================================================================
 *
 * - `costDeltas`：**加**在技能基础代价上（`40 − 20 = 20`）。多个炁机改同一个
 *   技能时**相加**，所以它天然满足 §5.3 的"交换律"（不像 `setOverride`）。
 *   ⚠️ 只对**数字**代价生效；表达式代价（`Cost.value: Expr`）今天加不了，
 *   而"静默不生效"比"报错"危险得多 —— 所以 `applySkillTweak` 会对
 *   **找不到的代价项**抛错（见那里的说明）。
 * - `buffOverrides`：把**某个 buff 的修正值整体改成这个数**（不是加上去）。
 *   用户原话是"增伤**变成** 100%" —— 那是覆盖，不是 +100%。
 *   与 `passiveModifiers` 里其它来源的 `addPercent` 仍然**相加**：
 *   「凝」贡献 100，装备再给 10，玩家就是 110（符合"增伤百分比层相加"）。
 */
export interface QijiSkillTweak {
  /** 被改的那个技能。 */
  readonly skillId: SkillId;
  /** 代价的增量（负 = 减少）。同名资源的多条会在应用时合并。 */
  readonly costDeltas?: readonly {
    readonly resource: ResourceKey | string;
    readonly delta: number;
  }[];
  /**
   * **成功用出这个技能时**一次性给资源。
   *
   * 形状就是引擎已经支持的 `ResourceAbility`（它挂在技能上时由
   * `castPipeline` 在付账后结算，与 `on: 'castFinish'` 同一时刻）——
   * 这里复用那个形状，而不是再造一个"回缠"的专属字段。
   *
   * ⚠️ 时点：本仓库今天的"用了 3 次"（`skillUses`）数的是**用出去**
   * （`skillUsed` 事件），所以"回缠"跟它同一时刻 —— 见
   * `tests/unit/qijiWiring.test.ts` 的实测。
   */
  readonly onUse?: ResourceAbility;
  /**
   * 把某个 buff 的修正值**覆盖**成给定值（按 `stat` 匹配）。
   *
   * ⚠️ 只覆盖 `value`，其余字段（`sourceKey` / `namespace` / `tier`）
   * 保持原样，所以溯源面板仍然认得它。
   */
  readonly buffOverrides?: readonly {
    readonly buffId: BuffId;
    readonly modifiers: readonly {
      readonly stat: StatKey;
      readonly value: number;
    }[];
  }[];
}

/**
 * ⚠️ **引擎尚未校验这个实体**（W8 / 注册表的对账项）。
 *
 * 现在注册表能收 `entities`（`core/content/registry.ts`），但 `QijiEntity`
 * 的 `kind` 不在 `EntityKind` 里、也没有"为什么这个 kind 不被支持"的
 * 报错路径 —— 所以一份炁机内容**既不会生效、也不会被拦下**。
 *
 * 这条常量的作用是：把"引擎还没把它当一等公民"写在**一个可被 import
 * 的名字**上（将来 `data/qiji.ts` 或载荷校验可以断言它），而不是只写在注释里。
 */
export const QIJI_ENTITY_VALIDATED = false as const;
