/**
 * `core/run/` —— **一局肉鸽**的纯逻辑层（转发）。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §9.1。
 *
 * ==================================================================
 * ⚠️ 本目录与 `src/core/run.ts`（单数文件）是**两件不同的事**
 * ==================================================================
 *
 * | 路径 | 是什么 | 交付阶段 |
 * |---|---|---|
 * | `src/core/run.ts` | **一场战斗**的重放 / 无头运行（`RecordedRun` / `replayRun` / 黄金基线） | 已有 |
 * | `src/core/run/`（本目录） | **一局肉鸽**的纯逻辑（7 场、顺序、解锁、累计） | **P0（新）** |
 *
 * 两者同名不是笔误，是设计稿 §9.1 对"一局肉鸽"这一层的命名（`core/run`）。
 * 模块解析上两者**不冲突**：
 *   - `import … from '../core/run'`（无扩展名）→ 解析到 **`run.ts`**（文件优先）
 *   - `import … from '../core/run/index'` → 本目录
 *   - `import … from '../core/run/…'` → 本目录下的模块
 * 这是有实测依据的（`moduleResolution: bundler` 与 Vite 都是"文件优先
 * 于同名目录"），`tests/golden/replay.test.ts` 等既有 import 因此**一字未改**。
 *
 * ⚠️ 但这条"同名"是**阅读成本**，不是零成本：一个人看到 `core/run` 时必须
 * 知道存在两种可能。本仓库的命名原则是"一个文件能用一句话说清它是什么"，
 * 而这两个都叫 "run" 但一个是"一场战斗"、一个是"一局肉鸽" ——
 * 恰好是设计稿 §0.0 要求**严格区分**的那对术语。若将来要改名，
 * 建议 `core/run.ts` → `core/replay.ts`（它其实只做重放与无头运行）。
 * P0 不改它：那会让既有测试文件与黄金基线的 import 全动一遍，
 * 违反"P0 不碰既有文件"的范围约束。
 *
 * ==================================================================
 * 转发什么、不转发什么
 * ==================================================================
 *
 * 本文件是**转发**（与 `core/types/index.ts` 同一条纪律）：调用方
 * `import { startRun, advanceRun } from '…/core/run/index'` 一处拿全。
 *
 * - 状态形状与生命周期：`types`
 * - **事件流 → 统计**（造数，§5.2 的方向修正）：`stats`
 * - **对统计的查询**（读数）：`query`
 * - 这一场的结果（叶子）：`outcome`
 * - 随机（本层唯一的随机消费者）：`shuffle`
 * - 解锁判定与候选：`unlock`
 * - 场次推进：`lifecycle`
 * - 记录与校验：`record`
 * - 炁机的**类型**在 `core/types/qiji.ts`（接口形状由消费者声明），
 *   本层不重新导出它 —— 类型只有一处来源，避免"两个入口拿到两份
 *   看起来一样、其实可以各自演化的类型"。
 */

/* ---------- 状态形状 ---------- */
export { MAX_RUN_POSITION, runLengthOf, tierForPosition } from './types';
export type {
  RunBattleRecord,
  RunChoice,
  RunRecord,
  RunState,
  RunStatus,
} from './types';

/* ---------- 事件流 → 统计（造数） ---------- */
export { EMPTY_BATTLE_STATS, mergeAllBattleStats, mergeBattleStats, reduceBattleStats } from './stats';
export type { BattleStats, BattleStatsScope, SkillCounts } from './stats';

/* ---------- 对统计的查询（读数） ---------- */
export {
  SKILL_STAT_IDS,
  isSkillStatId,
  readBattleStat,
  skillStatValue,
  statProgress,
  sumCounts,
} from './query';
export type { BattleStatQuery, SkillStatId, StatScope } from './query';

/* ---------- 这一场的结果（叶子） ---------- */
export { outcomeOf } from './outcome';
export type { BattleOutcomeRecord } from './outcome';

/* ---------- 洗牌（唯一的随机消费者） ---------- */
export { battleSeed, shuffle } from './shuffle';

/* ---------- 解锁判定 + 候选生成 ---------- */
export {
  diffUnlocked,
  evalUnlock,
  isUnlocked,
  maxStacksOf,
  nextCandidates,
  stacksOf,
  unlockedIds,
  unlockProgress,
} from './unlock';
export type { Candidate, UnlockProgress, UnlockStats } from './unlock';

/* ---------- 生命周期 ---------- */
export {
  GENERIC_QIJI_IDS,
  advanceRun,
  battleRecordOf,
  battleStatsFor,
  dropRunProgress,
  startRun,
  unlockStatsOf,
  withRunSeed,
  withUnlocked,
} from './lifecycle';
export type { BattleInput, StartRunInput } from './lifecycle';

/* ---------- 记录（序列化 + 校验） ---------- */
export { RUN_FORMAT_VERSION, parseRecordedRun, parseRunState, serializeRun } from './record';
