/**
 * 解锁判定 + 每场战斗后的候选生成。**全部是纯函数。**
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.2 / §5.3 / §5.4。
 *
 * 本文件回答三个问题，一个不多：
 *   1. 某个炁机**解锁了没有**？（`isUnlocked` —— 求值 `QijiUnlock`）
 *   2. 现在还差多少？（`unlockProgress` —— 给 `QijiSelect` 显示"截 2/3"）
 *   3. 这一场结束后，玩家**能选什么**？（`nextCandidates`）
 *
 * ⚠️ **本文件不产生统计**（那是 `stats.ts` 从事件流归约出来的），
 * 也**不推进场次**（那是 `lifecycle.ts`）。它只把"已经算好的数字"
 * 翻译成"能选什么"。这个边界是有意的：`RunState.battleStats` 只有
 * **一个**写入路径（`advanceRun`），如果这里也能写，"解锁"与"统计"
 * 就会互相依赖，测试也没法只喂数字。
 *
 * ⚠️ **本文件不碰 `QijiEntity.abilities`**：解锁是"能不能选"，不是"选了
 * 生效什么"。后者是 `core/loadout/` 的规范化层（**W7**，P6）。
 */

import type { QijiEntity, QijiUnlock } from '../types/qiji';
import type { BattleStats } from './stats';
import { statProgress } from './query';
import type { RunState } from './types';

/**
 * 求值一个解锁条件需要的**两份统计**。
 *
 * ⚠️ 为什么是两份而不是一份：`scope` 是**查询的一部分**（见
 * `stats.ts` 的文件头），而"这一场"与"整局"是**两套累加**。
 * 把两份一起传进来，责任就清楚地在**调用方**：它必须两样都给，
 * 而不是让求值器去猜"现在该看哪一份"。
 *
 * `battleStats` 可以是 `undefined`（"只看整局"的调用点，例如
 * `RunOver` 屏的摘要）；但那时任何 `scope: 'battle'` 的查询都会
 * **抛错**（`statsForScope`），而不是静默拿到整局的数。
 */
export interface UnlockStats {
  readonly battleStats?: BattleStats;
  readonly runStats: BattleStats;
}

/* ================================================================== *
 * 1. 判定
 * ================================================================== */

/**
 * 这个解锁条件**现在**满足吗？
 *
 * 求值语义（逐条写死，避免"读代码猜边界"）：
 *
 * | 条件 | 满足当且仅当 |
 * |---|---|
 * | `always` | 恒真（它带着一个空的 `of`，见 `QijiUnlock` 的说明） |
 * | `statAtLeast` | 那次统计查询的值 `>= value`（缺键 = 0，所以 `value: 0` 恒真） |
 * | `all` | `of` 里**每一项**都满足（**空数组 = 真**） |
 * | `any` | `of` 里**至少一项**满足（**空数组 = 假**） |
 * | `not` | `of` 不满足 |
 *
 * ⚠️ 两个"空数组"的取值是刻意选的，与数学上的全称 / 存在量词一致：
 * `all: []` 恒真（没有一项被违反）、`any: []` 恒假（没有一个证人）。
 * 反过来的写法在两个组合子嵌套时会产生"看起来该解锁却没有"的谜题。
 *
 * ⚠️ **`value` 的比较是 `>=`**：§5.2 的例子是"成功使用 3 次截"→
 * `value: 3`，第 3 次就该解锁（不是第 4 次）。
 *
 * ⚠️ 本函数是**判定逻辑的唯一实现**。`lifecycle.ts` 的 `withUnlocked`
 * 与将来 UI 的"候选屏"都必须走它，不许各自 switch 一遍 ——
 * 两份判定的漂开表现为"卡片上写着已解锁、点下去不生效"。
 */
export function evalUnlock(unlock: QijiUnlock, stats: UnlockStats): boolean {
  switch (unlock.kind) {
    case 'always':
      return true;
    case 'statAtLeast':
      /**
       * ⚠️ 查询本身（`unlock.stat`）带着 `scope`，所以这里**只**把两份
       * 统计原样交给 `readBattleStat`，绝不在这一层判断"该看哪一份" ——
       * 一旦在这里判，`scope` 就有了第二个解释处，而两处必然漂。
       */
      return statProgress(unlock.stat, stats.battleStats, stats.runStats) >= unlock.value;
    case 'all':
      return unlock.of.every((child) => evalUnlock(child, stats));
    case 'any':
      return unlock.of.some((child) => evalUnlock(child, stats));
    case 'not':
      return !evalUnlock(unlock.of, stats);
  }
}

/** 某个炁机解锁了没有。 */
export function isUnlocked(qiji: QijiEntity, stats: UnlockStats): boolean {
  return evalUnlock(qiji.unlock, stats);
}

/**
 * "还差多少"的进度。给 `QijiSelect` 的卡片文案用（如"截 2/3"）。
 *
 * 形状刻意做成**递归的**（每个条件都能报进度），而不是只报最外层一个数：
 *
 *   - `items` —— 逐个子条件的进度。叶子条件为空数组。
 *   - `current` / `required` —— 两个**数**，文案层想显示"2/3"还是
 *     "还差 1 次"都能从它们推出来（反过来推不出 `current`）。
 *     叶子条件 = 查询当前的值 / 要求的值（`statProgress` / `unlock.value`）；
 *     组合条件 = 已满足的**叶子条件个数**与叶子条件总数。
 *   - `complete` —— 整个条件饱和了没有（= `evalUnlock`）。冗余存一份
 *     是为了让调用方**不必**再调一次 `evalUnlock`（两次求值在将来引入
 *     随机或计时的条件时会变成两个可能不一致的真相源）。
 *
 * ⚠️ `current` / `required` 数的是**叶子条件**（不是直接子条件）：
 * `all: [ 截3, all: [闪避2, 打断5] ]` 报的是 `0..3`，而不是 `0..2`。
 * 数直接子条件会让"嵌套一层"看起来比"平铺"要求得少，而两者的实际
 * 工作量完全一样 —— 那正是"卡片说 2/2 完成了、其实还差两件事"的来源。
 *
 * ⚠️ `not` 的 `current` / `required` 恒为 `1` / `1`（要么反过来了、
 * 要么没有），因为"离取反条件还差多少"没有可读的含义。
 */
export interface UnlockProgress {
  readonly complete: boolean;
  /** 叶子条件：已满足到的值。组合条件：已满足的叶子条件个数。 */
  readonly current: number;
  /** 叶子条件：要求的值。组合条件：叶子条件总数。 */
  readonly required: number;
  /** 组合条件里**逐个子条件**的进度（叶子条件为空数组）。 */
  readonly items: readonly UnlockProgress[];
}

/** 求一个解锁条件的进度。与 `evalUnlock` 同源（`complete` 就是它的结果）。 */
export function unlockProgress(unlock: QijiUnlock, stats: UnlockStats): UnlockProgress {
  switch (unlock.kind) {
    case 'always':
      return { complete: true, current: 1, required: 1, items: [] };
    case 'statAtLeast': {
      const current = statProgress(unlock.stat, stats.battleStats, stats.runStats);
      return { complete: current >= unlock.value, current, required: unlock.value, items: [] };
    }
    case 'all':
    case 'any': {
      const items = unlock.of.map((child) => unlockProgress(child, stats));
      // `items` 上已有 `complete`，直接数它而不是再 `evalUnlock` 一遍：
      // 两个真相源会在嵌套条件下漂开。
      const satisfied = items.filter((item) => item.complete).length;
      const complete = unlock.kind === 'all' ? satisfied === items.length : satisfied > 0;
      return {
        complete,
        current: satisfied,
        required: items.length,
        items,
      };
    }
    case 'not': {
      const inner = unlockProgress(unlock.of, stats);
      return { complete: !inner.complete, current: inner.complete ? 0 : 1, required: 1, items: [inner] };
    }
  }
}

/* ================================================================== *
 * 2. 候选生成
 * ================================================================== */

/**
 * 一个候选炁机。
 *
 * ⚠️ **不在这里给"已叠几层"** —— 那是 `RunState.chosen` 的事，而且
 * 一个候选要显示"当前 1 层 / 上限 3"时，两份数据必须来自同一个地方。
 * `nextCandidates` 的调用方（P3 的 `QijiSelect`）自己从 `state.chosen`
 * 读层数即可。把 `stacks` 复制进候选里 = 多一个会与 `chosen` 漂开的
 * 真相源。
 */
export interface Candidate {
  readonly qiji: QijiEntity;
  /** 还能选几次（`maxStacks - 已选层数`）。恒 `>= 1`。 */
  readonly remainingStacks: number;
}

/** 某个炁机在一局肉鸽里最多能选几层（默认 1，§5.3）。 */
export function maxStacksOf(qiji: QijiEntity): number {
  return qiji.maxStacks ?? 1;
}

/**
 * 已经选了几层（没选过 = 0）。
 *
 * ⚠️ 这里的 `chosen` 参数形状**刻意不写成 `RunChoice`**（虽然它就是）：
 * 解锁层只需要"id + 层数"这两个字段，写成结构化的最小形状之后，
 * 测试可以直接喂 `[{ qijiId: 'a', stacks: 2 }]` 而不用构造整个 `RunState`。
 * 这是本仓库"接口形状由消费者声明"（`core/types/ids.ts`）的同一条用法。
 */
export function stacksOf(
  chosen: readonly { readonly qijiId: string; readonly stacks: number }[],
  qijiId: string,
): number {
  const entry = chosen.find((choice) => choice.qijiId === qijiId);
  return entry?.stacks ?? 0;
}

/**
 * 这一场战斗结束后，玩家**能选什么**。纯函数，顺序 = `pool` 的顺序。
 *
 * ⚠️ **顺序必须确定**（不能按"解锁时间"或"随机"排），因为：
 *   1. `QijiSelect` 的光标模型默认落在第 0 项，顺序变了 = 默认选的东西变了
 *   2. 黄金测试 / 截图要能复现同一个候选屏
 * 所以这里的顺序就是传入 `pool` 的顺序（也就是内容表的顺序），
 * 没有任何二次排序。
 *
 * 过滤规则（§5.3 的决议）：
 *   - **没解锁** → 不出现（`unlock` 求值）
 *   - **已叠满** → 不出现（`maxStacks`，默认 1）
 *   - 其余全出现 —— 包括解锁了但这次不想选的（选 1 个 ≠ 只给 1 个）
 *
 * @param pool 全部炁机（内容表，P0 没有；测试直接构造）
 * @param stats 这一场结束后**已经累加过**的两份统计（先 `advanceRun` 再调它）
 * @param chosen 已经选了生效的（`RunState.chosen`）
 */
export function nextCandidates(
  pool: readonly QijiEntity[],
  stats: UnlockStats,
  chosen: readonly { readonly qijiId: string; readonly stacks: number }[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const qiji of pool) {
    if (!isUnlocked(qiji, stats)) continue;
    const remaining = maxStacksOf(qiji) - stacksOf(chosen, qiji.id);
    if (remaining <= 0) continue;
    candidates.push({ qiji, remainingStacks: remaining });
  }
  return candidates;
}

/**
 * 一份便于阅读的"这一局现在解锁了什么"快照（**不参与任何判定**）。
 *
 * 给调试面板 / `RunOver` 的摘要排版用。存在的理由是让 `RunState.unlocked`
 * （一个 id 数组）能被人看懂，而不必自己去 `pool` 里查。
 *
 * ⚠️ 返回**新数组**（不是 Set）：`core/` 的状态必须可结构化克隆
 * （lint C5）。这里虽然只是展示用，也没有理由引入不可克隆的容器。
 */
export function unlockedIds(
  pool: readonly QijiEntity[],
  stats: UnlockStats,
): readonly string[] {
  return pool.filter((qiji) => isUnlocked(qiji, stats)).map((qiji) => qiji.id);
}

/**
 * ⚠️ **开发期对账**：把"这一局现在能选什么"与 `RunState.unlocked` 比一比。
 *
 * 防的是一类**静默漂移**：`RunState.unlocked` 是"曾经解锁过"的累积
 * （只增不减），而候选是由**当前**统计重算的。若有人不小心按"解锁
 * 条件不再满足"去**回缩** `unlocked`，或者漏了某次累加，两边的差异
 * 只会表现为"这个炁机怎么突然不见了"，很难查。
 *
 * 不抛异常（P0 的判定逻辑是纯的、测试里会直接断言），而是返回差异，
 * 让调用方决定是丢弃还是报错 —— 与 `parseBindings` 的"坏数据整条丢弃"
 * 相比，"少解锁一个"不是安全问题，所以这里只**报告**。
 *
 * 用 `Array.prototype.includes` 而不是 `Set`：这是**展示 / 断言**路径，
 * 规模是一局肉鸽的十几个炁机，而 `Set` 会让"这一层状态可克隆"多一个
 * 需要解释的例外（§7.3 第 1 条把 `Map` / `Set` 列为不许进状态的容器，
 * 这一层干脆一个都不用，省掉"到底算不算状态"的争论）。
 */
export function diffUnlocked(pool: readonly QijiEntity[], state: RunState): readonly string[] {
  const now = unlockedIds(pool, {
    battleStats: state.battleStats,
    runStats: state.battleStats,
  });
  return state.unlocked.filter((id) => !now.includes(id));
}
