/**
 * **一局肉鸽的持有者**（app 层）—— P2 只有"**一场**"。
 *
 * ==================================================================
 * ⚠️⚠️ 这是一个**临时的桩**，不要把它当成最终形态
 * ==================================================================
 *
 * 用户 2026-10-12 定的流程（P2 第一半）：
 *
 * ```
 * 选角色 → 打一场 → 结算 →（按 Enter）回选角色
 * ```
 *
 * 之所以只打一场：**炁机选择是 P3**（设计稿 §10 的 P3 行）。所以这里
 * **刻意**不把一局肉鸽推进下去 —— `RunState` 只用来"洗出 Boss 顺序、
 * 取第 1 场是谁"，战斗一结束就整个丢掉（`clear()`）。
 *
 * **P3 会把它接成"N 场 + 炁机选择"**：
 *   - 保留 `RunState` 跨场（而不是一场就丢）
 *   - 每场结束喂 `advanceRun(state, { events, outcome, flawless }, pool)`（P0 已实现）
 *   - 接上 `QijiSelect` 与 `nextCandidates`
 *   - 每场战斗的种子改用 `battleSeed(runSeed, position)`（§7.1）
 *
 * ⚠️ **不要**为了"看起来完整"而在这里假装有炁机选择 / 多场推进。
 *
 * ==================================================================
 * 为什么这层单独一个文件（设计稿 §9.1 的 `app/runSession.ts`）
 * ==================================================================
 *
 * `RunState` 是**跨场**的状态，而 `BattleLoop` 每场重建。两者都不该
 * 持有对方：`BattleLoop` 是"一场战斗"，`RunState` 是"一局肉鸽"。
 * 所以由这里当转接点：谁要打下一场，先问它"这一场打谁、是第几场"。
 *
 * ⚠️ **随机流独立**（§7.1）：洗牌只吃 `begin()` 传进来的 `runSeed`，
 * 绝不碰 `BattleState.rngSeed` / `aiRngSeed` —— 否则"一局肉鸽的随机"
 * 会同时改掉玩家侧的概率判定，黄金重放会因此变红（见 `core/run/shuffle.ts`）。
 *
 * ⚠️ **种子由调用方给**（`begin(playerId, runSeed)`），这一层不调
 * `Date.now()`：`src/app/` 允许它，但把它留在调用方让本模块**纯函数化** ——
 * 可以在 node 里单测"同一 runSeed → 同一 Boss"（`core/` 里不许有
 * `Date.now`，这是 lint C2 的硬约束）。
 */

import { shuffle, startRun } from '../core/run/index';
import type { RunState } from '../core/run/index';
import type { EntityId } from '../core/types/ids';

/** 创建时的依赖。 */
export interface RunSessionOptions {
  /**
   * 能打的 Boss（顺序无关 —— 这里会洗牌）。
   *
   * 生产路径传 `data/roster.ts` 的 `BOSS_POOL`（已实现的那些）。
   */
  readonly bossPool: readonly EntityId[];
}

/** 一局肉鸽的持有者（P2 只有一场，见文件头的桩说明）。 */
export interface RunSession {
  /** 现在是否有**没结束**的一局（= 当前战斗属于肉鸽模式）。 */
  readonly active: boolean;
  /** 起一局：用 `runSeed` 洗出 Boss 顺序、`position = 1`。 */
  begin(playerId: string, runSeed: number): void;
  /** 丢掉当前这一局（回选角色 / 离开肉鸽时调）。 */
  clear(): void;
  /** 这一场打谁（没有进行中的一局、或位置越界时 `undefined`）。 */
  bossId(): EntityId | undefined;
  /** 这是第几场（1-based；没有进行中的一局时 `undefined`）。 */
  position(): number | undefined;
  /** 这一局一共几场（= `bossPool.length`；没有进行中的一局时 `undefined`）。 */
  length(): number | undefined;
  /** 当前状态（调试 / P3 的 `advanceRun` 会用；只读引用，别改它）。 */
  state(): RunState | undefined;
}

export function createRunSession(options: RunSessionOptions): RunSession {
  /**
   * ⚠️ 只有这一个可变字段 —— "当前这一局"。它有两个状态（有 / 没有），
   * 所以**不需要**再加一个 `mode: 'roguelike' | 'free'` 布尔 / 枚举：
   * "有一局没结束的肉鸽"与"当前战斗是肉鸽那一场"是**同一件事**，
   * 两份真相必然会漂（例如离开肉鸽时漏改其中一个）。
   */
  let run: RunState | undefined;

  return {
    get active(): boolean {
      return run !== undefined && run.status === 'active';
    },

    begin(playerId: string, runSeed: number): void {
      run = startRun({
        runSeed,
        playerId,
        /**
         * 顺序由 `runSeed` 决定（纯函数、同一 seed 同一顺序）。
         * 空池子会得到空 `order` —— `bossId()` 因此返回 `undefined`，
         * 调用方据此不开战（而不是打一个不存在的 Boss）。
         */
        order: shuffle(options.bossPool, runSeed),
      });
    },

    clear(): void {
      run = undefined;
    },

    bossId(): EntityId | undefined {
      if (run === undefined) return undefined;
      /** `position` 是 1-based（见 `core/run/types.ts` 的两种读法）。 */
      return run.order[run.position - 1];
    },

    position(): number | undefined {
      return run?.position;
    },

    length(): number | undefined {
      return run?.order.length;
    },

    state(): RunState | undefined {
      return run;
    },
  };
}
