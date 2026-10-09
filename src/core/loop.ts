/**
 * 固定步长循环（主线程渲染驱动）。
 *
 * 这是整个模拟确定性的地基（architecture 规范 §2.3）：
 * **绝不把 requestAnimationFrame 的 delta 直接喂给逻辑。**
 * 逻辑永远按 DT = 16.6667ms 一步推进，渲染用插值对齐屏幕刷新率。
 *
 * 累加器逻辑在 SimClock 里（worker 内部的模拟推进复用同一份实现）。
 * 本文件只负责"把时钟接上回调"。
 */

import { DT } from './loopConstants';
import { SimClock } from './simClock';

export { DT, MAX_CATCHUP_MS, TIME_EPSILON } from './loopConstants';

/** 一帧内实际发生了什么。调用方用它驱动渲染插值。 */
export interface FrameResult {
  /** 本帧推进的 tick 数 */
  steps: number;
  /** 步进后的战斗内时间（ms） */
  time: number;
  /** 插值系数 [0, 1)：renderedTime = (time - DT) + alpha * DT */
  alpha: number;
  /** 因为 MAX_CATCHUP_MS 被丢弃的真实时间（ms） */
  droppedMs: number;
}

/**
 * 累加器式固定步长循环。
 *
 * 用法：
 * ```ts
 * const loop = new FixedLoop();
 * function frame(realNow: number) {
 *   const r = loop.advance(realNow, (tick, time) => sim.tick(tick, time));
 *   renderer.render(sim.snapshot(), r.alpha);
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class FixedLoop {
  private readonly clock = new SimClock();

  get tickCount(): number {
    return this.clock.tickCount;
  }

  get currentTime(): number {
    return this.clock.time;
  }

  reset(): void {
    this.clock.reset();
  }

  /** 把战斗内时间换算成 tick 序号（用于 Action 的帧量化）。 */
  tickAt(timeMs: number): number {
    return Math.floor(timeMs / DT);
  }

  /**
   * 推进逻辑。
   *
   * @param realNowMs 主线程的单调时间戳（performance.now() 的值）
   * @param onTick     每步调用一次，参数是当前 tick 序号与战斗内时间
   */
  advance(realNowMs: number, onTick: (tick: number, time: number) => void): FrameResult {
    const a = this.clock.advance(realNowMs);
    const firstTick = this.clock.tickCount - a.steps;
    for (let i = 0; i < a.steps; i += 1) {
      const tick = firstTick + i + 1;
      onTick(tick, tick * DT);
    }
    return a;
  }
}

/**
 * 把任意毫秒时间量化到帧边界。
 *
 * 玩家按键的时间戳必须量化，否则同一份操作序列在不同帧率下发到不同的 tick，
 * 重放就不可靠了（architecture 规范 §2.2）。
 */
export function quantizeToFrame(timeMs: number): number {
  return Math.round(timeMs / DT) * DT;
}

/** 时间对应的 tick 序号。 */
export function frameOf(timeMs: number): number {
  return Math.floor(timeMs / DT);
}
