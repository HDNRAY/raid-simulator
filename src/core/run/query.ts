/**
 * **对统计的查询**：`BattleStatQuery` 的联合、以及把它翻译成数字的求值。
 *
 * ==================================================================
 * ⚠️ **一次归约，多次查询；加条件不重扫事件**
 * ==================================================================
 *
 * 用户原话（2026-10-12 确认本轮形状时）：
 *
 * > 以后对战斗 log 的处理，**最好遍历一次，统计所有需要统计的**，
 * > 这个处理大概率在**战斗结算时**处理，然后告诉新解锁了什么，
 * > 这个统计也要**方便我们开发进行扩展**
 *
 * 这条纪律在代码里的落点是：
 *
 *   1. **只遍历一次事件**：`stats.ts` 的 `reduceBattleStats` 是**唯一**
 *      读 `EventDef[]` 的地方，它把"以后可能要用的一切"一次算完
 *      （5 个维度 + `ticks`，见 `BattleStats`）。
 *   2. **查询读结果、不重扫事件**：本文件的每个函数都只读
 *      `BattleStats` 的**字段** —— 没有一个会拿到 `EventDef[]`，
 *      更不会去过滤事件数组。
 *   3. **加一个解锁条件不重扫事件**：新炁机只是多写一条
 *      `QijiUnlock`（`data/qiji.ts` 的内容数据），它读的是已经算好的表；
 *      只有当"要数**新维度**"时才动 `stats.ts` 的归约。
 *
 * ⚠️ **别把归约塞进查询里**（例如"顺手在 `readBattleStat` 里遍历一遍
 * 事件来算那个数"）。那会让同一趟归约发生 N 次、让"结算时算一次"这条
 * 设计消失，而且查询会重新依赖事件流的形状 —— 于是"引擎的事件改了"
 * 会同时打断归约与查询两处。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"**读数**"那一半：拿一份（或两份）`BattleStats`，回答"这一次查询
 * 是几"。
 *
 * 另一半是 `stats.ts` 的"**造数**"（`EventDef[]` → `BattleStats` + 累加）。
 * 两者在 `Q-a` 之前挤在一个 514 行的文件里，而那个文件的名字
 * （`stats`）**说不清它到底是哪一半** —— 所以按仓库自己的判据
 * （"一个文件应该能用一句话说清它是什么；那句话里出现'和'就该拆"）
 * 拆成了两个文件。本文件不 import `stats.ts` 的**值**、
 * `stats.ts` 也不 import 本文件的任何东西（两边共同需要的那个小类型在
 * 叶子 `outcome.ts` 里）。
 *
 * ==================================================================
 * ⚠️ 作用是查询的一部分，**没有默认值**
 * ==================================================================
 *
 * 同一句话在两种作用域下是两个答案，而它们是**两套累加**：
 *
 * ```ts
 * readBattleStat({ s:'skillUses', skillId:'jie', scope:'battle' }, battleStats, runStats)  // 这一场
 * readBattleStat({ s:'skillUses', skillId:'jie', scope:'run'    }, battleStats, runStats)  // 整局
 * ```
 *
 * ⚠️ **在 `advanceRun` 的解锁判定那一刻，两份统计的值是一样的**
 * （这一场的统计已经被 `mergeBattleStats` 并进整局了，见
 * `lifecycle.ts` 的 `unlockStatsOf`）。所以**现在**写 `scope:'battle'`
 * 与 `scope:'run'` 的炁机行为**完全相同** —— 这是有意的（§5.2："这一场
 * **结束后**用累计值判定"），但它是一个**会让人困惑**的设计，所以
 * 分叉点写在这里：
 *
 *   1. **P3 的 `QijiSelect` 卡片文案**：这里显示"本场 2/3"还是"本局 2/3"
 *      取决于 `scope`，而那是**两个不同的数**（那时调用方会显式传两份
 *      不同的统计，`battleStats` 是"刚打完的那一场"）
 *   2. **将来的战斗内判定**：`requires` / `when` 若要用统计
 *      （例如"这一场已经用截打断过 ≥ 1 次"，`scope: 'battle'`）
 *
 * 在那两处到来之前，**别把 `scope` 当装饰删掉**，也别以为它现在就该有差别。
 */

import type { SkillId } from '../types/ids';
import type { BattleOutcomeRecord } from './outcome';
import type { BattleStats, SkillCounts } from './stats';

/** 一局肉鸽的**作用域**。见文件头：它是查询的一部分，没有默认值。 */
export type StatScope = 'battle' | 'run';

/**
 * 可查询的**技能级**维度。
 *
 * ⚠️ 这个集合是**开放**的：加一个维度 = 在 `stats.ts` 的 `BattleStats`
 * 加一张表 + 在这里加一个成员 + 在 `readSkillCounts` 的 `switch` 加一行。
 * **不碰 `QijiUnlock`。**
 */
export type SkillStatId = 'skillUses' | 'skillDamage' | 'skillHits' | 'skillInterrupts';

/**
 * 全部技能级维度，**运行期**的一份。
 *
 * ⚠️ 与 `SkillStatId` 必须一致（类型在运行期被擦除，而解析存档 /
 * 校验外来数据需要一份**运行期清单**）。两者放在相邻位置，
 * 改一个就会看见另一个；`readSkillCounts` 的 `switch` 上
 * `noImplicitReturns` 会逼着每个联合成员都有分支。
 */
export const SKILL_STAT_IDS: readonly SkillStatId[] = [
  'skillUses',
  'skillDamage',
  'skillHits',
  'skillInterrupts',
];

/** 类型守卫：这个字符串是不是一个合法的 `SkillStatId`。 */
export function isSkillStatId(value: unknown): value is SkillStatId {
  return typeof value === 'string' && SKILL_STAT_IDS.some((id) => id === value);
}

/** `BattleStatQuery` 里"带 `scope` 的"那一支（技能级 + `dodges`）。 */
type ScopedStatQuery =
  | { readonly s: SkillStatId; readonly skillId: SkillId; readonly scope: StatScope }
  | { readonly s: 'dodges'; readonly scope: StatScope };

/**
 * 对统计的**一次查询**（§5.2 修正后的形状）。
 *
 * 它取代了第一版那个**封闭的 5 元素计数器联合**
 * （`jieInterrupts | interrupts | dodges | battlesWon | flawlessBattles`）。
 * 三个差别，每个都对应一个具体的"做不出来"：
 *
 *   1. **按技能**（第一版做不到）："「截」打断了 3 次"与"「破」打断了 3 次"
 *      在第一版里是**同一个数**（`interrupts`），因为闭集里没有"哪个技能"。
 *   2. **伤害 / 命中**（第一版做不到）：闭集里根本没有 `damage` 维度，
 *      所以"某个技能造成伤害数"（用户的第一条要求）无法表达。
 *   3. **作用域显式**：同一个问句在两种作用域下是两个答案（见文件头）。
 *
 * ⚠️ **条件是内容数据**（`data/qiji.ts` 里的一条 `QijiUnlock`），
 * 不是写死在 `core/types/` 里的常量表 —— 用户原话就是嫌它
 * "只能数技能使用次数"。加维度只扩这一层。
 */
export type BattleStatQuery =
  | ScopedStatQuery
  /**
   * 赢下的场数。`scope: 'battle'` → 这一场赢了吗（0 / 1）；
   * `scope: 'run'` → 整局赢了几场。
   *
   * ⚠️ 两个作用域**都有意义**，而且实现是同一条（数结果数组里 `won`
   * 的个数）—— 因为"这一场"就是"长度为 1 的那个集合"。
   */
  | { readonly s: 'battlesWon'; readonly scope: StatScope }
  /** 满血赢下的场数。同上，两个作用域都有意义。 */
  | { readonly s: 'flawlessBattles'; readonly scope: StatScope };

/* ------------------------------------------------------------------ *
 * 1. 读数
 * ------------------------------------------------------------------ */

/** 读一张计数表的某个键（缺键 = 0）。⚠️ 全层只有这一处 `?? 0`。 */
export function skillStatValue(counts: SkillCounts, skillId: SkillId): number {
  return counts[skillId] ?? 0;
}

/** 一张计数表里所有键的和（"总伤害"这类派生量用它，不另存一份）。 */
export function sumCounts(counts: SkillCounts): number {
  let total = 0;
  for (const key of Object.keys(counts)) total += counts[key] ?? 0;
  return total;
}

/**
 * 取某个技能级维度对应的那张表。
 *
 * ⚠️ 加维度时这里会**编译错误**（`noImplicitReturns` + 返回值非
 * `undefined`）：这正是"运行期清单与联合必须一致"的机器保障之一。
 */
function readSkillCounts(stats: BattleStats, field: SkillStatId): SkillCounts {
  switch (field) {
    case 'skillUses':
      return stats.skillUses;
    case 'skillDamage':
      return stats.skillDamage;
    case 'skillHits':
      return stats.skillHits;
    case 'skillInterrupts':
      return stats.skillInterrupts;
  }
}

/**
 * 按**作用域**取一份统计：这一场 或 整局累加。
 *
 * ⚠️ 缺失的那一份按作用域判断，是**调用方的程序错误**，所以抛错
 * （英文，i18n 规范 I1）而不是静默回落到另一份 —— 静默回落会让
 * "整局累计"读到**这一场**的数，而那看起来完全正常（只是偏小），
 * 是最难查的一类错。
 */
function statsForScope(
  scope: StatScope,
  battleStats: BattleStats | undefined,
  runStats: BattleStats | undefined,
): BattleStats {
  if (scope === 'battle') {
    if (battleStats === undefined) {
      throw new Error("statsForScope: scope 'battle' requires battleStats");
    }
    return battleStats;
  }
  if (runStats === undefined) {
    throw new Error("statsForScope: scope 'run' requires runStats");
  }
  return runStats;
}

/** 取一份统计的逐场结果（缺失时按空数组 —— 见 `BattleStats.battles` 的说明）。 */
function outcomesOf(stats: BattleStats): readonly BattleOutcomeRecord[] {
  return stats.battles ?? [];
}

/**
 * 求一次查询。**这是本模块对外的唯一"读数"入口。**
 *
 * `battleStats` / `runStats` 都允许 `undefined`（调用方可能只有其中一份），
 * 而**按作用域取哪一份**由 `statsForScope` 强制 —— 缺了就抛错，绝不静默。
 */
export function readBattleStat(
  query: BattleStatQuery,
  battleStats: BattleStats | undefined,
  runStats: BattleStats | undefined,
): number {
  const stats = statsForScope(query.scope, battleStats, runStats);

  switch (query.s) {
    case 'skillUses':
    case 'skillDamage':
    case 'skillHits':
    case 'skillInterrupts':
      return skillStatValue(readSkillCounts(stats, query.s), query.skillId);
    case 'dodges':
      /**
       * ⚠️ 只数 `dodged`，**不数 `immune`**。
       *
       * `reason` 有两种（`EventDef` 的说明）：`dodged` 是"真的闪开了"，
       * `immune` 是"这一下打不动我"（机制免疫，不是操作）。
       * 用户要的"成功闪避次数"是**前者** —— 免疫不用玩家做任何事，
       * 数进去会让"闪避流"的进度在挨某些机制时白涨。
       *
       * ⚠️ **将来要数免疫时，这里是第一个要改的地方**：
       * `BattleStats.dodges['immune']` 已经在归约里存着了，
       * 只是"没有查询能拿到它"（符合"死值先删"—— 现在没有内容需求）。
       * 加一个 `{ s: 'immunes'; scope }` 即可，不要改 `dodges` 的语义
       * （那会让已经写好的"闪避流"炁机数字突然变大）。
       */
      return stats.dodges['dodged'] ?? 0;
    case 'battlesWon':
      return outcomesOf(stats).filter((b) => b.won).length;
    case 'flawlessBattles':
      return outcomesOf(stats).filter((b) => b.flawless).length;
  }
}

/**
 * 求一次查询的**进度值**（`current`），给 `QijiSelect` 的"截 2/3"用。
 *
 * 返回"当前值"，分母由条件自己带（`value`）。这个薄封装存在的唯一理由是
 * **语义命名**：调用点写 `statProgress(…)` 比 `readBattleStat(…)` 更清楚
 * 地表达"这是在算进度条的那个数"。
 */
export function statProgress(
  query: BattleStatQuery,
  battleStats: BattleStats | undefined,
  runStats: BattleStats | undefined,
): number {
  return readBattleStat(query, battleStats, runStats);
}
