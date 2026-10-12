/**
 * 一局肉鸽的生命周期：场次推进 / 胜负 / 通关 / 累计战斗统计。
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
 * 一场战斗打完，app 层把**那一场的事件流**（`EventDef[]`）与胜负喂进来，
 * 由 `stats.ts` 归约成 `BattleStats` 再累加进 `RunState`。
 *
 * 这样切有三个直接好处：
 *   1. `core/run/` 能零依赖跑在 Node 里（单测覆盖"行为式解锁"全靠它）
 *   2. **不需要引擎写计数器**：统计是事件流的**只读派生**，
 *      它与事件流不可能漂（§5.2 的方向修正）
 *   3. 测试**喂一个事件数组**就能测，不必起引擎
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

import type { EventDef } from '../events';
import type { EntityId, CombatantId } from '../types/ids';
import type { QijiEntity } from '../types/qiji';
import { EMPTY_BATTLE_STATS, mergeBattleStats, reduceBattleStats, type BattleStats } from './stats';
import { isUnlocked, type UnlockStats } from './unlock';
import { runLengthOf, type RunBattleRecord, type RunState } from './types';

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

/** 起一局肉鸽：`position = 1`、统计为空、`unlocked = []`、`chosen = []`。 */
export function startRun(input: StartRunInput): RunState {
  return {
    runSeed: input.runSeed >>> 0,
    playerId: input.playerId,
    order: [...input.order],
    position: 1,
    status: 'active',
    battleStats: EMPTY_BATTLE_STATS,
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
 * 2. 战斗统计（唯一写入路径）
 * ================================================================== */

/**
 * 从"这一场的事件流 + 胜负 + 满血标记"装配这一场的统计。
 *
 * ⚠️ **这是 `RunState.battleStats` 的唯一写入路径的入口**（`advanceRun`
 * 调它）。所有统计都走这里，于是"这一局到底数到了什么"只有一个地方
 * 可能写错。
 *
 * 为什么统计**不是**在引擎里数的（§5.2 的方向修正）：
 * `BattleState` 已经被黄金重放逐位钉死，往它里面加计数器字段等于
 * ① 造一份**与事件流并行的第二份真相**（会漂）② 动唯一可能改变
 * 确定性语义的东西。而事件流本来就是输出、本来就带全部信息，
 * 所以统计是**只读派生**。
 *
 * `battles` 这个字段（"逐场结果数组"，`battlesWon` 的骨架）在这里补上：
 * 归约器只看得见事件与"这一场的视角 / 结果"，看不见"整局里有几场"，
 * 所以由本函数装成"长度 1 的那一份"。
 *
 * ⚠️ `flawless` **必填**（`Q-b`）：不给默认值，所以"忘了传"是编译错误，
 * 而不是"某个炁机永远解锁不了、没人知道为什么"。
 */
export function battleStatsFor(
  events: readonly EventDef[],
  input: {
    readonly actorId: CombatantId;
    readonly outcome: 'victory' | 'defeat';
    readonly flawless: boolean;
  },
): BattleStats {
  const reduced = reduceBattleStats(events, {
    actorId: input.actorId,
    outcome: input.outcome,
    flawless: input.flawless,
  });
  return {
    ...reduced,
    battles: [{ won: input.outcome === 'victory', flawless: input.flawless }],
  };
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
  const stats = unlockStatsOf(state);
  const fresh = pool
    .filter((qiji) => !state.unlocked.includes(qiji.id))
    .filter((qiji) => isUnlocked(qiji, stats))
    .map((qiji) => qiji.id);

  if (fresh.length === 0) return state;
  return { ...state, unlocked: [...state.unlocked, ...fresh] };
}

/* ================================================================== *
 * 4. 一场战斗的结果
 * ================================================================== */

/**
 * 一场战斗打完之后的输入。**由 app 层喂进来**。
 *
 * ⚠️ 这里收的是**原始事件流**，不是"已经算好的计数"：
 * `RunState.battleStats` 的唯一来源就是它。若收算好的数字，
 * "谁负责统计"就变成了调用方 —— 而那是本层（`stats.ts`）的职责，
 * 分散到 app 层之后就没法单测了。
 *
 * 三个字段都是 app 层**已经拿在手里**的（它刚从引擎拿到这一场的结果）：
 *   - `events`：这一场的 `EventDef[]`（引擎 `drainEvents()` / 循环里累积）
 *   - `outcome`：`snapshot.status` 是 `victory` 还是 `defeat`
 *   - `flawless`：终局快照里玩家 `hp === caps.hp`（且赢了）
 *     ⚠️ 事件流里**没有**血量上限，所以这个事实推不出来，只能喂。
 *     **必填**（`Q-b`）—— 给默认值会让"忘了传"变成静默失效。
 */
export interface BattleInput {
  readonly outcome: 'victory' | 'defeat';
  /** 这一场战斗期间引擎产生的**全部**事件（从开战到结束）。 */
  readonly events: readonly EventDef[];
  /**
   * 这一场是不是满血赢的。**必填**（`Q-b`）。
   *
   * ⚠️ 事件流里**没有**血量上限，所以这个事实推不出来，只能喂。
   * 必填而不是"省略 = false"：默认值会让"忘了传"表现为
   * "某个炁机永远解锁不了"，而那是**静默失效**。
   */
  readonly flawless: boolean;
}

/**
 * 打完一场战斗之后的一步状态转移。**这是 `core/run/` 的主入口。**
 *
 * 严格按 §2.2 的顺序做四件事：
 *   1. **先归约 + 累加**这一场的统计（`battleStatsFor` + `mergeBattleStats`）
 *   2. 用累加后的统计刷新"已解锁"集合（**后判定** —— 顺序反了就会
 *      "这一场刚数够的截，要等下一场才解锁"，而那表现为"最后一场
 *      打完才解锁的东西永远选不到"）
 *   3. 胜 → `position += 1`；超出**这一局的长度**则 `status = 'victory'`
 *      负 → `status = 'defeat'`，**`position` 不动**（= 死在第几场）
 *   4. `battlesWon` / `flawlessBattles` **不在这里加** —— 它们是
 *      `battleStats.battles`（逐场结果数组）的**过滤结果**，而这一场的
 *      结果已经由第 1 步装进去了（"结论"不另存，见 `stats.ts`）
 *
 * ⚠️ 第 3 步的判据是 `runLengthOf(state)`（= `order.length`），
 * **不是** `MAX_RUN_POSITION` —— 理由见文件头（"2 个 Boss 永远通不了关"
 * 是荒谬的）。
 *
 * ⚠️ **输的那一场的统计照样累加**：输了不等于白打
 * （"这一局用了几次截"不该因为最后一场输了就归零，
 * 而且 `RunOver` 屏要显示"你用了几次截"）。所以第 1 步在胜负分支**之前**。
 *
 * @param pool 全部炁机（用来刷新解锁集合；P0 没有内容表，调用方传 `[]`
 *   或测试构造的假表）
 */
export function advanceRun(
  state: RunState,
  battle: BattleInput,
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

  /**
   * ⚠️ 用 `state.playerId` 作为归约视角：结算永远是"**玩家**这一场做了什么"。
   * 这不是可选参数 —— 不筛视角会把 Boss 打玩家的 `damage` 也算进玩家的
   * 招式里（见 `stats.ts` 的 `BattleStatsScope`）。
   */
  const battleStats = battleStatsFor(battle.events, {
    actorId: state.playerId,
    outcome: battle.outcome,
    flawless: battle.flawless,
  });
  const accumulated: RunState = {
    ...state,
    battleStats: mergeBattleStats(state.battleStats, battleStats),
  };

  if (battle.outcome === 'defeat') {
    const unlocked = withUnlocked(accumulated, pool);
    return { ...unlocked, status: 'defeat' };
  }

  const unlocked = withUnlocked(accumulated, pool);
  const position = state.position + 1;
  if (position > runLength) {
    return { ...unlocked, position, status: 'victory' };
  }
  return { ...unlocked, position };
}

/**
 * 从 `RunState` 取求值解锁条件用的**两份统计**。
 *
 * ⚠️ 两份都是 `state.battleStats`（这是对的，不是偷懒）：
 * `RunState.battleStats` **就是整局累加**（`scope: 'run'` 读它），
 * 而"这一场"的统计在 `advanceRun` 里**已经被并进去了** ——
 * 所以 `scope: 'battle'` 的查询读到的是"包含这一场在内"的累加。
 *
 * 这在 `advanceRun` 的语境下**正好是想要的**：解锁判定发生在
 * "这一场打完、该刷新解锁了"那一刻，而 §5.2 的语义是"这一场**结束后**
 * 用累计值判定"。把两份都给累加值，等于承认"在这一层，一场战斗的
 * 统计与整局的统计在结算那一刻是同一份东西"。
 *
 * ⚠️ 真正区分 `scope` 的场合在 **UI**（P3 的 `QijiSelect`：卡片要显示
 * "本场 2/3"还是"本局 2/3"），那时调用方会显式传两份不同的
 * （`{ battleStats: 这一场, runStats: 整局 }`）。这一层的辅助函数
 * 只服务"结算判定"，不假装能区分。
 */
export function unlockStatsOf(state: RunState): UnlockStats {
  return { battleStats: state.battleStats, runStats: state.battleStats };
}

/* ================================================================== *
 * 5. 失败 = 全丢（§2.4 / §12 决议 #1）
 * ================================================================== */

/**
 * 失败之后**丢掉这一局肉鸽**（回"选角色"重开）。
 *
 * 本函数**不保存任何东西**：`battleStats` / `unlocked` / `chosen` 全部清空，
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
    battleStats: EMPTY_BATTLE_STATS,
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
  flawless: boolean,
): RunBattleRecord {
  const bossId = state.order[state.position - 1];
  if (bossId === undefined) {
    throw new Error(
      `cannot record battle at position ${state.position}: order has ${state.order.length} entries`,
    );
  }
  /**
   * ⚠️ `flawless` 也是**必填**参数（`Q-b` 的同一条理由）：它要被
   * `record.ts` 拿去与 `battleStats.battles[].flawless` **对账**（`Q-e`），
   * 而给默认值会让"忘了传"变成一条永远不成立的对账。
   */
  return { position: state.position, bossId, seed, outcome, flawless };
}
