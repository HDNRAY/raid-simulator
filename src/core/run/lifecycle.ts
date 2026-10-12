/**
 * 一局肉鸽的生命周期：场次推进 / 胜负 / 通关 / 累计计数器。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §2.2（生命周期）。
 * 全部是**纯状态转移**：进来一个 `RunState`，出去一个**新的** `RunState`，
 * 入参不被修改（与 `core/rng.ts` 的"返回新状态"是同一条纪律 ——
 * 原地修改会让"谁在什么顺序改了它"看不出来）。
 *
 * ==================================================================
 * ⚠️ 本文件**不认识**引擎（P0 刻意如此）
 * ==================================================================
 *
 * 一局肉鸽的边界在引擎之外（§7.2）：`BattleEngine` 永远只处理**一场战斗**。
 * 所以这里**不 import** `BattleState` / `Action` / `RecordedRun` ——
 * 一场战斗打完，app 层把"终局快照里的数字"喂进来，仅此而已。
 *
 * 这样切有两个直接好处：
 *   1. `core/run/` 能零依赖跑在 Node 里（单测覆盖"行为式解锁"全靠它）
 *   2. P0 不产生计数器（那是引擎的 **W1 / W3**，P1 才做）——
 *      **测试直接喂数字**，而不是为了跑通测试自己造一个假的战斗内计数器。
 *
 * ==================================================================
 * ⚠️ "位置"（position）的两种读法，别混
 * ==================================================================
 *
 *   - `status === 'active'`：**下一场是第 `position` 场**（1-based，未打）
 *   - `status === 'defeat'`：**玩家死在 `position` 这一场**（打到第几场）
 *
 * 为什么不让 `defeat` 时停在 1、另存一个 `reached` 字段：那会多一个
 * 可能与 `position` 打架的真相源（"打到第几场"和"下一场是第几场"
 * 是同一个概念的两个说法）。§2.2 的伪码也是这个形状（失败不改 position）。
 *
 * ==================================================================
 * ⚠️ 通关判据 = **打完 `order` 的最后一个**（不是 `MAX_RUN_POSITION`）
 * ==================================================================
 *
 * `order.length` 就是这一局的场数（§2.3："一局肉鸽的场数等于
 * `BOSS_POOL.length`"）。所以：
 *
 *   满编（7 个 Boss 都做完）→ 打完第 7 场通关，`position` 停在 8
 *   开发期（现在只有 2 个能打）→ **打完第 2 场就通关**，`position` 停在 3
 *
 * ⚠️ 这一条**改过一次**，记下来免得改回去：第一版用的是
 * `position > MAX_RUN_POSITION`（= 7），后果是"2 个 Boss 的局永远
 * 通不了关"（打完第 2 场仍停在 `active`，而第 3 场根本没得打）。
 * 用户的原话是"目前是 7 个 boss"+"还剩的 5 个 boss 慢慢加呗" ——
 * **7 是终点、`order.length` 是现实**，所以判据必须是后者。
 * `MAX_RUN_POSITION` 仍然有用（它是强度档的上界，见 `tierForPosition`），
 * 但它**不参与**通关判定。
 *
 * 通关时 `position` 会**超出**这一局的长度一位（满编 = 8、2 场 = 3）：
 * 那是"第 `len + 1` 场不存在"的直接编码，`parseRunState` 的范围校验
 * 以同一件事为准（它读 `order.length`，不读常量）。
 */

import type { EntityId, CombatantId } from '../types/ids';
import type { QijiEntity } from '../types/qiji';
import {
  addCounters,
  pickKnownCounters,
  runLengthOf,
  type RunBattleRecord,
  type RunState,
} from './types';
import { isUnlocked } from './unlock';

/* ================================================================== *
 * 1. 开局
 * ================================================================== */

export interface StartRunInput {
  /** 一局肉鸽的种子（app 层生成，`Date.now() >>> 0`）。**决定 Boss 顺序**。 */
  readonly runSeed: number;
  readonly playerId: CombatantId;
  /** 已经洗好的 Boss 顺序（`shuffle(bossPool, runSeed)`）。空表示"还没定"。 */
  readonly order: readonly EntityId[];
  /** 调试 / 复现用的标签（可选）。 */
  readonly label?: string;
}

/** 起一局肉鸽：`position = 1`、`counters = {}`、`unlocked = []`、`chosen = []`。 */
export function startRun(input: StartRunInput): RunState {
  return {
    runSeed: input.runSeed >>> 0,
    playerId: input.playerId,
    order: [...input.order],
    position: 1,
    status: 'active',
    counters: {},
    unlocked: [],
    chosen: [],
    // ⚠️ 这里**总是**写 `label` 键（值可能是 `undefined`），不写条件展开：
    // `exactOptionalPropertyTypes` 下"键存在且值为 undefined"与"键不存在"
    // 是两件事，而 `JSON.stringify` 会把前者丢掉。条件展开会让
    // `JSON.parse(JSON.stringify(run))` 少一个键 —— 那条"JSON 往返"的
    // 验收就会因为一个与业务无关的差别而失败，而那种失败最容易让人
    // 去改验收标准而不是改代码。统一形状之后，"缺键"只有**外来数据**
    // 一种可能，由 `record.ts` 的解析器补回 `undefined`。
    label: input.label,
  };
}

/* ================================================================== *
 * 2. 计数器（唯一写入路径）
 * ================================================================== */

/**
 * 把一场战斗终局快照里的计数**累加**进 `RunState`。
 *
 * ⚠️ **这是 `RunState.counters` 唯一的写入路径**（§5.2.3）。所有累加都
 * 走它，于是"这一局到底数到了什么"只有一个地方可能写错。
 *
 * 语义是**加**，不是**覆盖**：一局肉鸽内的累计是 §5.2.2 的决议
 * （"时间窗 = 一局肉鸽"，理由：单场可能凑不满，"成功使用 3 次截"
 * 在截 CD 10s、一场 ~95s 的现实下必须跨场数）。
 *
 * **不认识的键被忽略**（不抛异常）：这个函数的入参来自"终局快照"，
 * 而快照是引擎产出的、将来会多出新计数器。多一个键就整局崩掉，
 * 比"这一局少认一个计数器"更糟。真正的**外来**数据（存档 / localStorage）
 * 由 `record.ts` 的解析器逐项校验，那里才是"坏数据整条丢弃"该在的地方。
 *
 * ⚠️ 收窄（哪些键算计数器）与加法都在 `types.ts` 里，本函数只是
 * 把它们串起来 —— 于是"计数器清单"全层只有一处，而 `lifecycle.ts`
 * 这一层读起来只有一句话："把这一场的数加进去"。
 */
export function withCounters(
  state: RunState,
  delta: Readonly<Record<string, number>>,
): RunState {
  return { ...state, counters: addCounters(state.counters, pickKnownCounters(delta)) };
}

/* ================================================================== *
 * 3. 解锁集合
 * ================================================================== */

/**
 * 兜底解锁集合（`unlock: 'always'` 的通用炁机）。
 *
 * ⚠️ **P0 里恒为空数组 —— 这是刻意的，不是没写完。**
 *
 * §5.4 的决议是"兜底 = 一组 `unlock:'always'` 的通用炁机（`category:'generic'`），
 * 不是一条特判分支"。那些通用炁机是**内容**（`src/data/qiji.ts`），
 * 而 P0 明确不做内容表 —— 所以正确做法是这里什么都不塞，由调用方把
 * `pool` 里已知解锁的炁机传进来。
 *
 * 如果这里硬编码 4 个假的通用炁机，它就会在 P3 变成"第二份真相源"：
 * 真正的内容表加了第 5 个通用炁机时，这一份不会跟着长，而候选屏
 * 会同时显示真假两组。
 */
export const GENERIC_QIJI_IDS: readonly EntityId[] = [];

/**
 * 重算"曾经解锁过"的集合：**累积 + 只增不减**。
 *
 * `pool` 里**现在**满足解锁条件、且**还不在** `state.unlocked` 里的炁机
 * 会被追加进去（顺序 = `pool` 的顺序，便于 diff 与黄金测试）。
 * 空数组表示这一场没有新解锁 —— 那是**正常情况**（7 场里能解锁的本来就不多）。
 *
 * 为什么"只增不减"而不是"按当前计数器重算全集"：§5.3 的决议是
 * **选了就不能换、永久生效**。若解锁集合会回缩，"这一局解锁过 X"
 * 与"X 现在还在不在池子里"就变成两件事，而 `QijiSelect` 的候选
 * （由当前计数器算）与 `RunOver` 的"本局带了哪些炁机"（由 `chosen` 算）
 * 会对不上。
 *
 * ⚠️ 判定**复用** `unlock.ts` 的 `isUnlocked`，不在这里再写一份 ——
 * 判定只有一处实现（`evalUnlock`），本文件只负责"集合怎么维护"。
 * 方向是 `lifecycle → unlock`（值导入），而 `unlock → lifecycle` 只有
 * `import type`（编译期擦除），所以**运行期没有环**。
 */
export function withUnlocked(state: RunState, pool: readonly QijiEntity[]): RunState {
  const fresh = pool
    .filter((qiji) => !state.unlocked.includes(qiji.id))
    .filter((qiji) => isUnlocked(qiji, state.counters))
    .map((qiji) => qiji.id);

  if (fresh.length === 0) return state;
  return { ...state, unlocked: [...state.unlocked, ...fresh] };
}

/* ================================================================== *
 * 4. 一场战斗的结果
 * ================================================================== */

/**
 * 一场战斗的终局输入。**由外部喂进来**（P0 不产生它）。
 *
 * `counters` 的形状是 `Record<string, number>` 而不是 `RunCounters`：
 * 这个值来自**引擎的终局快照**，在 P1 落地之前它的类型在 core 里
 * 还没有一个真相源。写成宽形状 + `withCounters` 的键过滤，是"外来
 * 未验证数据"的正确处理（AGENTS.md §1 的第三种场景）。
 */
export interface BattleOutcomeInput {
  readonly outcome: 'victory' | 'defeat';
  /** 这一场战斗期间玩家侧累积出来的计数（引擎 W1 的产物）。 */
  readonly counters: Readonly<Record<string, number>>;
}

/**
 * 打完一场战斗之后的一步状态转移。**这是 `core/run/` 的主入口。**
 *
 * 严格按 §2.2 的顺序做四件事：
 *   1. `counters += 这一场的 counters`（**先累加**）
 *   2. 用累加后的 counters 刷新"已解锁"集合（**后判定** —— 顺序反了
 *      就会"这一场刚数够的截，要等下一场才解锁"，而那表现为"最后一场
 *      打完才解锁的东西永远选不到"）
 *   3. 胜 → `battlesWon += 1`（**赢的场数由这里数**，不由引擎数 ——
 *      引擎不知道"一局肉鸽"这种东西）
 *   4. 胜 → `position += 1`；超出**这一局的长度**则 `status = 'victory'`
 *      负 → `status = 'defeat'`，**`position` 不动**（= 死在第几场）
 *
 * ⚠️ 第 4 步的判据是 `runLengthOf(state)`（= `order.length`），
 * **不是** `MAX_RUN_POSITION` —— 理由见文件头（"2 个 Boss 永远通不了关"
 * 是荒谬的）。
 *
 * ⚠️ **结算不加 `flawlessBattles` / `dodges` / `interrupts`**：那些必须
 * 来自引擎的终局快照（W1），由调用方放进 `counters` 一起喂进来。
 * 本函数只负责它**唯一能自己知道**的那个（`battlesWon`）—— 见 §5.2.3
 * "唯一写入路径"的纪律：能自己数的就别指望别人喂，但别人能数的
 * 绝不在这里猜。
 *
 * @param pool 全部炁机（用来刷新解锁集合；P0 没有内容表，调用方传 `[]`
 *   或测试构造的假表）
 */
export function advanceRun(
  state: RunState,
  battle: BattleOutcomeInput,
  pool: readonly QijiEntity[] = [],
): RunState {
  if (state.status !== 'active') {
    // 已经结束的一局肉鸽不该再被推进。抛错（开发者错误用英文，i18n 规范 I1）
    // 而不是静默忽略：静默忽略会让"UI 忘了判 status"变成一个数值上的怪事
    // （赢了最后一场还在打），而不是一个能在开发期立刻看见的崩溃。
    throw new Error(
      `advanceRun called on a finished run (status=${state.status}, position=${state.position})`,
    );
  }
  const runLength = runLengthOf(state);
  if (runLength === 0) {
    throw new Error('advanceRun called on a run with no boss order (order is empty)');
  }

  const accumulated = withCounters(state, battle.counters);

  if (battle.outcome === 'defeat') {
    const unlocked = withUnlocked(accumulated, pool);
    return { ...unlocked, status: 'defeat' };
  }

  const won = withCounters(accumulated, { battlesWon: 1 });
  const unlocked = withUnlocked(won, pool);
  const position = state.position + 1;
  if (position > runLength) {
    return { ...unlocked, position, status: 'victory' };
  }
  return { ...unlocked, position };
}

/* ================================================================== *
 * 5. 失败 = 全丢（§2.4 / §12 决议 #1）
 * ================================================================== */

/**
 * 失败之后**丢掉这一局肉鸽**（回"选角色"重开）。
 *
 * 本函数**不保存任何东西**：`counters` / `unlocked` / `chosen` 全部清空，
 * 只留 `runSeed` 与 `playerId`（调用方要保留什么由它自己决定 ——
 * P2 的 `runSession` 负责这件事，因为"回选角色时记住刚才选的谁"
 * 是**界面**的偏好，不是一局肉鸽的状态）。
 *
 * ⚠️ 所以这个函数的返回值**不写任何存档**：§12 决议 #1 是"全丢"，
 * 不做跨局永久成长（那是 roguelite 的元进度，会让"一局肉鸽内的解锁"
 * 与"跨局解锁"两套状态打架）。这个函数存在的唯一目的是把"全丢"
 * 写成一个**可测的状态转移**，而不是散在 app 层的几个 `= {}`。
 */
export function dropRunProgress(state: RunState): RunState {
  return {
    runSeed: state.runSeed,
    playerId: state.playerId,
    order: [...state.order],
    position: 1,
    status: 'active',
    counters: {},
    unlocked: [],
    chosen: [],
    label: state.label,
  };
}

/**
 * 换一个新的 `runSeed`（"再来一局"，但顺序由**调用方**洗好传进来）。
 *
 * 不在这里调 `shuffle`：洗牌是 `shuffle.ts` 的关注点，而"新一局要给什么
 * 种子"是 app 层的事（`Date.now()`）。把两件事分开之后，
 * `core/run/` 里"谁在消耗随机"依然一眼可见（只有 `shuffle.ts`）。
 */
export function withRunSeed(state: RunState, order: readonly EntityId[]): RunState {
  return { ...state, order: [...order], position: 1, status: 'active' };
}

/**
 * 构造一份"这一场打了什么"的记录（给 `RunRecord.battles` 用）。
 *
 * `seed` 由调用方从 `battleSeed(runSeed, position)` 拿到再传进来：
 * 本函数不 import `shuffle.ts`，因为"这一场用的种子"是**已经决定好**的事实，
 * 记录层只该抄写它、不该重新推导它（重新推导会让"记录里的种子"与
 * "真正跑的那一场用的种子"变成两次计算，任何一次偏差都会让重放失败
 * 而看不出原因）。
 */
export function battleRecordOf(
  state: RunState,
  seed: number,
  outcome: 'victory' | 'defeat',
): RunBattleRecord {
  const bossId = state.order[state.position - 1];
  if (bossId === undefined) {
    throw new Error(
      `cannot record battle at position ${state.position}: order has ${state.order.length} entries`,
    );
  }
  return { position: state.position, bossId, seed, outcome };
}
