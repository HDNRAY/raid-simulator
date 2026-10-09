/**
 * 模拟时钟：把"真实时间"换算成"固定步数的模拟时间"。
 *
 * 从 FixedLoop 里抽出来，让它能同时在两个地方复用：
 *   - 主线程（渲染循环）
 *   - worker 内部（真正的模拟推进，M0-6）
 *
 * 这是一个**纯累加器**：不知道 DOM、不知道 performance.now、不调 requestAnimationFrame。
 * 真实时间由调用方传进来。
 */

import { DT, MAX_CATCHUP_MS, TIME_EPSILON } from './loopConstants';

export interface ClockAdvance {
  /** 本次推进的步数 */
  steps: number;
  /** 步进后的模拟时间（ms），等于 tick * DT */
  time: number;
  /** 插值系数 [0, 1) */
  alpha: number;
  /** 因 MAX_CATCHUP_MS 被丢弃的真实时间（ms） */
  droppedMs: number;
}

/**
 * 累加器式固定步长时钟。
 *
 * 用法：
 * ```ts
 * const clock = new SimClock();
 * const a = clock.advance(realNow);   // 第一次只校准，steps 为 0
 * for (let i = 0; i < a.steps; i++) tick();
 * ```
 */
export class SimClock {
  /** 主线程时间线里"还没被逻辑消化"的毫秒数 */
  private accumulator = 0;
  /** 上次校准的真实时间；undefined 表示还没校准 */
  private lastRealTime: number | undefined;
  /** 已推进的 tick 数 */
  private ticks = 0;

  get tickCount(): number {
    return this.ticks;
  }

  /** 模拟时间（ms） = tick * DT */
  get time(): number {
    return this.ticks * DT;
  }

  get alpha(): number {
    return this.accumulator / DT;
  }

  /** 用真实时间重新校准起点。用于暂停后恢复，避免把暂停时长当成 elapsed。 */
  sync(realNowMs: number): void {
    this.lastRealTime = realNowMs;
  }

  /** 完全重置（开始新战斗）。 */
  reset(): void {
    this.accumulator = 0;
    this.lastRealTime = undefined;
    this.ticks = 0;
  }

  /**
   * 推进。返回本次应该执行多少步。
   *
   * **本方法不执行任何逻辑**，只回一个步数 —— 这样时钟可以被纯粹地测试，
   * 也避免把"要不要 tick"和"tick 里做什么"混在一起。
   */
  advance(realNowMs: number): ClockAdvance {
    // 未校准：只记起点
    if (this.lastRealTime === undefined) {
      this.lastRealTime = realNowMs;
      return { steps: 0, time: this.time, alpha: 0, droppedMs: 0 };
    }

    const elapsed = realNowMs - this.lastRealTime;
    this.lastRealTime = realNowMs;

    // 时间倒流（系统时钟调整、计时器精度抖动）：静默忽略
    if (elapsed <= 0) {
      return { steps: 0, time: this.time, alpha: this.alpha, droppedMs: 0 };
    }

    let droppedMs = 0;
    this.accumulator += elapsed;
    if (this.accumulator > MAX_CATCHUP_MS + TIME_EPSILON) {
      droppedMs = this.accumulator - MAX_CATCHUP_MS;
      this.accumulator = MAX_CATCHUP_MS;
    }

    let steps = 0;
    while (this.accumulator + TIME_EPSILON >= DT) {
      this.accumulator -= DT;
      this.ticks += 1;
      steps += 1;
    }

    return { steps, time: this.time, alpha: this.alpha, droppedMs };
  }
}
