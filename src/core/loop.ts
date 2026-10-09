/**
 * 固定步长循环。
 *
 * 这是整个模拟确定性的地基（architecture 规范 §2.3）：
 * **绝不把 requestAnimationFrame 的 delta 直接喂给逻辑。**
 * 逻辑永远按 16.6667ms 一步推进，渲染用插值对齐屏幕刷新率。
 *
 * 本文件是纯逻辑：不知道 DOM、不知道 performance.now。
 * 真实时间由调用方（app/ 或 worker）传进来。
 */

/** 固定步长：60Hz。任何地方都不许改这个值（改了会让所有黄金测试失效）。 */
export const DT = 1000 / 60;

/** 单帧最多补多少毫秒。防止标签页休眠后回来一次性补几千帧（死亡螺旋）。 */
export const MAX_CATCHUP_MS = DT * 5;

/**
 * 浮点容差：1 纳秒。
 *
 * 累加器是 `n * DT` 的浮点和，而 `n * DT` 由于 `DT = 1000/60` 无限循环，
 * 几乎永远不是精确的 `n * DT`。例如 60 * DT = 1000.0000000000001，
 * 而逐帧累加 60 次的结果是 999.9999999999999 —— 差 1.4e-13，
 * 于是"喂 60 帧却只推进 59 步"。
 *
 * 1e-9 ms 远小于一帧的百万分之一，不会造成真实的步进偏差，
 * 但足以吸收这层浮点噪声。
 */
const TIME_EPSILON = 1e-9;

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

export interface FixedLoopOptions {
  /** 一步的随机源。默认取 Date.now() —— 只在真正开新战斗时调用一次。 */
  startTime?: number;
}

/**
 * 累加器式固定步长循环。
 *
 * 用法：
 * ```ts
 * const loop = new FixedLoop();
 * function frame(realNow: number) {
 *   const r = loop.advance(realNow, (ctx) => sim.tick(ctx));
 *   renderer.render(sim.snapshot(), r.alpha);
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class FixedLoop {
  /** 累加器：主线程时间线里"还没被逻辑消化"的毫秒数 */
  private accumulator = 0;
  /** 上一次 advance 传入的真实时间；undefined 表示还没被校准 */
  private lastRealTime: number | undefined;
  /** 已推进的 tick 数 */
  private ticks = 0;
  /** 战斗内时间（ms） = ticks * DT */
  private time = 0;

  reset(): void {
    this.accumulator = 0;
    this.lastRealTime = undefined;
    this.ticks = 0;
    this.time = 0;
  }

  get tickCount(): number {
    return this.ticks;
  }

  get currentTime(): number {
    return this.time;
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
    // 第一帧只用来校准起点，不推进逻辑
    if (this.lastRealTime === undefined) {
      this.lastRealTime = realNowMs;
      return { steps: 0, time: this.time, alpha: 0, droppedMs: 0 };
    }

    const elapsed = realNowMs - this.lastRealTime;
    this.lastRealTime = realNowMs;

    // 时间倒流（切标签页、系统时钟调整、时钟精度抖动）时静默忽略
    if (elapsed <= 0) {
      return { steps: 0, time: this.time, alpha: this.accumulator / DT, droppedMs: 0 };
    }

    let droppedMs = 0;
    this.accumulator += elapsed;
    if (this.accumulator > MAX_CATCHUP_MS + TIME_EPSILON) {
      droppedMs = this.accumulator - MAX_CATCHUP_MS;
      this.accumulator = MAX_CATCHUP_MS;
    }

    let steps = 0;
    // 容差不是可选的：没有它，"喂 60 帧"会只推进 59 步。
    while (this.accumulator + TIME_EPSILON >= DT) {
      this.accumulator -= DT;
      this.ticks += 1;
      this.time = this.ticks * DT;
      onTick(this.ticks, this.time);
      steps += 1;
    }

    return {
      steps,
      time: this.time,
      alpha: this.accumulator / DT,
      droppedMs,
    };
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
