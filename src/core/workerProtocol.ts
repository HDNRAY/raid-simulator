/**
 * 主线程 ↔ 模拟 worker 的消息协议。
 *
 * 硬约束（architecture 规范 §2.1 的 C5）：
 * **所有消息体必须是可结构化克隆的 plain object** ——
 * 没有类实例、没有函数、没有 Map/Set。
 *
 * 设计要点：不每帧发全量快照，而是
 *   - 每 tick 发 `events`（只增的事件队列）
 *   - 每 N tick 发一次 `snapshot`（全量状态）
 * 主线程用"最近一次快照 + 之后的事件"重建视图。
 */

import type { Action } from './protocol';

export type { Action };

/** 每多少 tick 发一次全量快照。60 tick = 1 秒。 */
export const SNAPSHOT_INTERVAL_TICKS = 60;

/* ------------------------------------------------------------------ *
 * 主线程 -> worker
 * ------------------------------------------------------------------ */

export type ToWorker =
  /** 开始 / 重开一场模拟 */
  | {
      readonly kind: 'start';
      readonly seed: number;
      /** 单调时间戳，worker 用它校准时钟起点 */
      readonly realNow: number;
    }
  /** 推进到某个真实时间点 */
  | { readonly kind: 'frame'; readonly realNow: number }
  /** 注入玩家 / AI 的操作 */
  | { readonly kind: 'actions'; readonly actions: readonly Action[] }
  /** 请求立即回一次全量快照（调试/暂停恢复用） */
  | { readonly kind: 'requestSnapshot' }
  /** 关闭并释放 */
  | { readonly kind: 'stop' };

/* ------------------------------------------------------------------ *
 * worker -> 主线程
 * ------------------------------------------------------------------ */

export interface WorkerStats {
  readonly tick: number;
  /** 模拟时间（ms） */
  readonly time: number;
  /** 本帧推进的步数 */
  readonly steps: number;
  /** 插值系数 [0, 1) */
  readonly alpha: number;
  /** 因 MAX_CATCHUP_MS 累计丢弃的真实时间（ms） */
  readonly droppedMs: number;
}

export type FromWorker =
  /** 推进了一帧 */
  | {
      readonly kind: 'frame';
      readonly stats: WorkerStats;
      readonly snapshot?: SimSnapshot;
      readonly events?: readonly SimEvent[];
    }
  /** 对 requestSnapshot 的应答，或 start 后的初始快照 */
  | { readonly kind: 'snapshot'; readonly snapshot: SimSnapshot }
  /** worker 内部错误（绝不能静默吞掉） */
  | { readonly kind: 'error'; readonly message: string; readonly stack?: string | undefined };

/* ------------------------------------------------------------------ *
 * 快照与事件
 * ------------------------------------------------------------------ *
 *
 * M0 只放"演示用"的最小字段，M1 起由 core/snapshot.ts 正式定义。
 * 刻意先定义在这，是为了让协议层与模拟实现解耦：
 * worker 与 client 只依赖这个形状。
 */

export interface SimSnapshot {
  /** 已推进的 tick 数 */
  readonly tick: number;
  /** 模拟时间（ms） */
  readonly time: number;
  /** 随机数状态（保证快照可直接续跑，也是黄金测试哈希的一部分） */
  readonly rngSeed: number;
  /**
   * 演示用的动态值：一个水平往复的位置，单位是逻辑像素。
   * M1 起会被真正的战斗状态取代。
   */
  readonly demoX: number;
}

export interface SimEvent {
  readonly kind: 'tick' | 'started' | 'stopped';
  readonly tick: number;
}
