/**
 * 一局肉鸽（run）的状态形状。
 *
 * 术语（`docs/specs/2026-10-12-roguelike.md` §0.0）：
 *   - **一局肉鸽**（run）：从选完角色到"某场战斗失败"或"打完最后一场"
 *   - **一场战斗**（battle）：一个 `BattleEngine` 从 `running` 到 `victory`/`defeat`
 * 本目录只装**一局肉鸽**这一层；它**不认识** `BattleState` / `Action` /
 * 任何战斗内的类型（见 `advanceRun` 的说明）。
 *
 * ==================================================================
 * 为什么是"纯逻辑层"，不是塞进 `BattleState` 或 app 层（§2.1）
 * ==================================================================
 *
 * 1. `BattleState` 是**一场战斗**、被黄金重放逐位钉死。把跨场数据塞进去，
 *    "第 3 场战斗的重放"就要依赖前两场的输入，重放文件会爆炸。
 * 2. 放 app 层**不能写单测**（要 DOM），而"行为式解锁"的正确性必须单测。
 * 3. 所以放在这里：零依赖、无 `Math.random` / `Date.now`、无异步，
 *    状态是 plain object，可结构化克隆、可 JSON 往返、可哈希（§7.3）。
 */

import type { CombatantId, EntityId } from '../types/ids';
import type { BattleStats } from './stats';

/**
 * **满编**时一局肉鸽有几场（§12 决议 #7：固定 7 场）。
 *
 * ⚠️⚠️ **它不是通关判据** —— 判据是"打完 `order` 的最后一个"，
 * 见下面的 `runLengthOf`。这个常量只表示两件事：
 *
 *   1. **满编时的长度**：7 个 Boss 都做完之后，`order.length` 就是 7。
 *   2. **强度档的上界**（§6.1 的"7 个位置 ↔ 7 档"）：它同时是**档数**，
 *      所以改它等于改曲线表，不该随手改。
 *
 * **为什么通关判据不能是它**：开发期的 `order.length < 7`（现在只有 2 个
 * Boss 能打），若拿 `position > MAX_RUN_POSITION` 当判据，一局 2 个 Boss 的
 * 肉鸽**永远通不了关**。用户的原话是"目前是 7 个 boss"+"还剩的 5 个 boss
 * 慢慢加呗" —— **7 是终点、`len` 是现实**，所以今天这一局必须能打完。
 * §6.1 的取档公式 `ceil(k * 7 / len)` 本来就是为"开发期子集"准备的，
 * 它是这条结论的旁证：位置的上界一直是 `len`，不是 7。
 */
export const MAX_RUN_POSITION = 7;

/**
 * 这一局肉鸽一共几场。**`order.length` 就是它**（§2.3："一局肉鸽的场数
 * 等于 `BOSS_POOL.length`"）。
 *
 * 抽成一个有名字的函数、而不是让调用方到处写 `state.order.length`：
 * "这一局有多长"是一个**会被反复引用**的概念（通关判据、`position` 的
 * 范围校验、未来的 `?runlen=` 调试参数、进度文案"第 k/len 场"），
 * 有名字之后它就只有一处定义，也就能被测试单独钉住。
 *
 * ⚠️ 返回 0 表示"顺序还没定"（`startRun` 允许空 `order`）。调用方自己
 * 决定 0 怎么处理 —— `advanceRun` **抛错**（还不知道要打几场就推进一局
 * 是程序错误），`parseRunState` 把 `position` 限制在 1。
 */
export function runLengthOf(state: Pick<RunState, 'order'>): number {
  return state.order.length;
}

/**
 * 位置 `k` 落在第几档（§6.1）。**开发期子集走的就是这一条。**
 *
 * 公式：`档 = ceil(k * MAX_RUN_POSITION / runLength)`，`k` 从 **1** 起。
 * 保证"**第一个位置一定是最软档、最后一个位置一定是最硬档**"，
 * 而且补完 Boss 之后 `MAX_RUN_POSITION` 与档表**一个字都不用改** ——
 * 变的只是 `runLength`。
 *
 * | `runLength` | 位置 → 档 | 说明 |
 * |---|---|---|
 * | 7（满编） | T1 T2 T3 T4 T5 T6 T7 | 一位置一档 |
 * | 3 | T2 T5 T7 | |
 * | 2（现在） | **T4 T7** | `ceil(1*7/2)=4`、`ceil(2*7/2)=7` |
 * | 1 | T7 | 单场即终局 |
 *
 * ⚠️ **`k` 的上界是 `runLength`（不是 `MAX_RUN_POSITION`）** —— 这条
 * 正是"通关判据是 `order.length`"的同一个结论的另一面：短局里
 * **最后一个位置就是最硬档**。
 *
 * ⚠️ 这是**纯函数、纯数据**：它只算档号，不碰 `Behavior[]` / 数值 /
 * `caps`（那些是 P4 的 `data/intensity.ts` + `behaviorsFor(id, tier)`）。
 * 放在 `core/run/` 是因为它属于"一局肉鸽的位置"这一层，而且 P0 的
 * 单测能直接把它钉住 —— 档号算错（比如把 T4/T7 写成 T4/T4）会让
 * "越后越难"整条设计静默失效。
 *
 * `k` 超出 `1..runLength` 时**夹到边界**（而不是抛错）：调用方可能是
 * 一个"下一场"预览文案，在通关那一刻 `position` 会等于 `runLength + 1`，
 * 那时显示终局档比抛错有用。真正"位置不合法"的判定在 `advanceRun`
 * 与 `parseRunState` 里，不在这里重复。
 */
export function tierForPosition(k: number, runLength: number = MAX_RUN_POSITION): number {
  const length = Math.max(1, Math.trunc(runLength));
  const clamped = Math.min(Math.max(1, Math.trunc(k)), length);
  return Math.min(MAX_RUN_POSITION, Math.ceil((clamped * MAX_RUN_POSITION) / length));
}

/**
 * 一局肉鸽的状态。
 *
 * `idle`（已结算）在 P0 不产生。P6 / P7 要考虑的是**回访入口**：
 *   - `victory`（已通关）
 *   - `defeat`（已失败）
 * 三选一之后，`parseRun` 的"`status` 是不是终局"就能直接推出
 * "这份存档还能不能继续"，不需要第二个布尔字段。
 * 多一个 `isOver: boolean` 就会多一个可能与 `status` 打架的真相源。
 */
export type RunStatus = 'active' | 'victory' | 'defeat';

/**
 * 一场战斗的结果。
 *
 * `outcome: 'victory' | 'defeat'` 而不是 `boolean`：`'victory'` 与
 * `true` 在阅读 `record.battles` 的 JSON 时不是一回事，而这份记录要给人看。
 */
export interface RunBattleRecord {
  /** 这是第几场（`1..runLengthOf(state)`，即 §2.3 的"位置"）。 */
  readonly position: number;
  /** 这一场打的是谁。 */
  readonly bossId: EntityId;
  /** 这一场用的战斗种子（由 `shuffle.ts` 的 `battleSeed` 派生，**每场独立**）。 */
  readonly seed: number;
  readonly outcome: 'victory' | 'defeat';
  /**
   * 这一场是不是**满血赢的**。
   *
   * ⚠️ 它在 `RUN_FORMAT_VERSION` 从 **1 → 2** 时**从可选收成了必填**。
   *
   * 中间曾经有过一版是"可选 + 缺 = 不参与对账"，那是为了兼容"不含它的
   * v1 记录"。**那个理由不成立**：肉鸽存档是 P7 才做的东西，
   * `RunRecord` 从来没有被真正写出去过 —— **没有任何 v1 记录存在**。
   * 于是那个口子只换来"一条有洞的检查"（`record.ts` 的对账里
   * 有半条永远不执行），而**有洞的检查等于没有检查**。
   *
   * ⚠️ 这条改动的性质是 ①（见 §7.2）的一个应用：它只动了
   * **我们自己的记录格式** → `RUN_FORMAT_VERSION + 1`；
   * 而 `REPLAY_FORMAT_VERSION`（引擎的确定性语义）**不动**。
   */
  readonly flawless: boolean;
}

/** 已选生效的一个炁机（带层数）。 */
export interface RunChoice {
  /** 炁机的 `QijiEntity.id`。 */
  readonly qijiId: EntityId;
  /** 层数。默认上限是 1，可选多次的（通用炁机）> 1。 */
  readonly stacks: number;
}

/**
 * 一局肉鸽的完整状态。
 *
 * 字段全部 `readonly`（与 core 其余状态一致：状态转移产出**新对象**，
 * 于是"谁改了它"在代码里显式可见，重放与 diff 也不需要防御性拷贝）。
 */
export interface RunState {
  /** 本局的一局肉鸽种子，**决定 Boss 顺序**（由 app 层生成，§7.1）。 */
  readonly runSeed: number;
  /** 玩家选定的角色 id（`data/roster.ts` 的 `PLAYER_ROSTER`）。 */
  readonly playerId: CombatantId;
  /** 这一局的 Boss 顺序：`shuffle(bossPool, runSeed)` 的结果（§2.1）。 */
  readonly order: readonly EntityId[];
  /** 当前在第几场（1-based）。⚠️ 语义见 `lifecycle.ts` 的"位置的两种读法"。 */
  readonly position: number;
  readonly status: RunStatus;
  /**
   * 一局肉鸽累计的战斗统计（**唯一写入路径**是 `lifecycle.ts` 的
   * `advanceRun`，它把这一场的统计 `mergeBattleStats` 进来）。
   *
   * ⚠️ 这里**没有** `counters` 字段 —— 第一版有过，已删。删它的理由就是
   * 本次方向修正的核心：计数器是**第二份真相**（它与事件流会漂），
   * 而"整局统计"本来就是"把每场的统计加起来"的结果，不需要再存一份。
   *
   * `scope: 'run'` 的查询读的就是它。
   */
  readonly battleStats: BattleStats;
  /** 这一局曾经解锁过的炁机 id（**只增不减**，保序便于 diff / 哈希）。 */
  readonly unlocked: readonly EntityId[];
  /** 已经选了生效的炁机（**不能换**，§5.3，所以也是只增不减）。 */
  readonly chosen: readonly RunChoice[];
  /**
   * 可选标签（调试 / `?order=a,b` 复现某个局面时用）。
   *
   * `string | undefined` 而不是 `label?: string`：这是"**值**可以是
   * `undefined`"，不是"这个字段可有可无" —— 后者在
   * `exactOptionalPropertyTypes` 下会让"把一个 `string | undefined`
   * 传进来"变成类型错误，而调用方（回放一个存档）本来就有一个可能
   * 不存在的值。可选标记与 `undefined` 值混用是这类 bug 的常见来源。
   */
  readonly label: string | undefined;
}

/**
 * 一局肉鸽的重放记录（§7.2 的 `{ runFormatVersion, runSeed, playerId,
 * order, choices, battles }`）。
 *
 * 与"一场战斗的重放"（`src/core/run.ts` 的 `RecordedRun`）**刻意不合并**：
 *   - 那一份是**引擎的**重放（种子 + 逐 tick 输入 → 逐位复现一场战斗）
 *   - 这一份是**一局肉鸽的**记录（顺序 + 选择 + 每场战斗的种子与胜负）
 * 两份东西的消费者、变更节奏、版本号都不同。合并会让"改炁机的记录格式"
 * 与"改引擎的确定性语义"共用一个版本号 —— 而后者 +1 是有硬后果的
 * （旧重放文件作废，§7.2 的表）。
 *
 * ⚠️ P0 **不内嵌** `RecordedRun`：那会让一局肉鸽的记录在战斗重放格式
 * 变更时被迫一起变。真正的接线（P2 的 P7 存档）再决定是内嵌还是引用。
 */
export interface RunRecord {
  readonly runFormatVersion: number;
  /** 起局的完整状态（`order` / `position` / `battleStats`… 都在里面）。 */
  readonly state: RunState;
  /** 已经打完的每一场，按时间顺序。 */
  readonly battles: readonly RunBattleRecord[];
}
