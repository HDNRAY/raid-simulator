/**
 * 模拟时钟：把"真实时间"换算成"整数 tick 数"。
 *
 * 主线程与 worker 内部复用同一份实现。
 *
 * ------------------------------------------------------------------
 * 数值纪律：**不做时间累积**
 * ------------------------------------------------------------------
 *
 * 直觉写法是维护一个"累积了多少毫秒"的变量，每帧 `acc += elapsed`，
 * 然后 `while (acc >= MS_PER_TICK)`。这条路必然要引入容差，而且
 * 换个帧率就会错 —— 原因见 loopConstants.ts 的详细记录。
 *
 * 这里的做法是：**tick 数由真实时间直接算出**。
 *
 *   targetTick = ticksAt(realNow)          // 唯一真相源
 *   steps      = targetTick - tick
 *
 * 于是：
 *   - 没有累积状态 → 没有漂移
 *   - 掉帧自动补上；高频渲染自动被限制
 *   - 不存在"两套舍入算法差 1 tick"的问题，因为只有一套
 *   - 不需要任何容差常量
 *
 * 唯一保留的浮点运算是 `target - tick`，而两者都是整数，
 * 相减在安全整数范围内**精确**。
 */

import { MAX_CATCHUP_TICKS, PS_PER_MS, PS_PER_TICK, msToPs, ticksAt } from './loopConstants';

export interface ClockAdvance {
  /** 本次推进的 tick 数 */
  steps: number;
  /** 步进后的 tick 数（绝对）。逻辑一律用它，不要用毫秒。 */
  tick: number;
  /** 步进后的模拟时间（ms），= tickToMs(tick)。展示用。 */
  time: number;
  /** 插值系数 [0, 1)：当前真实时间落在上一个 tick 与下一个 tick 之间的位置 */
  alpha: number;
  /** 因 MAX_CATCHUP_TICKS 被丢弃的 tick 数 */
  droppedTicks: number;
  /** 同上，毫秒表示（展示用） */
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
  /** 已推进的 tick 数。整数，永不漂移。 */
  private ticks = 0;
  /**
   * 上次推进时的真实时间（整数皮秒）。
   *
   * 只保存"上一次调用的时间"，不保存绝对时间起点 ——
   * 因为皮秒的安全整数范围只有约 2.5 小时，
   * 而这里的差值始终是帧间隔（几毫秒到最多几百毫秒），永远安全。
   */
  private lastPs: number | undefined;

  get tickCount(): number {
    return this.ticks;
  }

  /** 模拟时间（ms）。展示用；逻辑一律用 tickCount。 */
  get time(): number {
    return (this.ticks * PS_PER_TICK) / PS_PER_MS;
  }

  /**
   * 插值系数 [0, 1)：从上一次推进之后又过了多少比例的时间。
   *
   * 渲染层用它做位置插值，让 60Hz 的逻辑在任意刷新率下看起来平滑。
   */
  private alphaFor(nowPs: number): number {
    // 上一次推进后已经走过的皮秒数。它总是落在 [0, PS_PER_TICK)：
    // advance() 会把 tick 推进到 `ticksAt(now)`，所以 now 必然在
    // [tick*PS_PER_TICK, (tick+1)*PS_PER_TICK) 区间内。
    const into = nowPs - this.ticks * PS_PER_TICK;
    if (into <= 0) return 0;
    const a = into / PS_PER_TICK;
    // 恰好落在边界（into === PS_PER_TICK）时返回 0：此时下一个 tick
    // 即将产出，插值应当从新 tick 的起点开始，而不是停在旧 tick 的末尾。
    return a >= 1 ? 0 : a;
  }

  /** 用真实时间重新校准起点。用于暂停后恢复，避免把暂停时长当成 elapsed。 */
  sync(realNowMs: number): void {
    this.lastPs = msToPs(realNowMs);
  }

  /** 完全重置（开始新战斗）。 */
  reset(): void {
    this.ticks = 0;
    this.lastPs = undefined;
  }

  /**
   * 推进。返回本次应该执行多少 tick。
   *
   * **本方法不执行任何逻辑**，只回一个步数 —— 这样时钟可以被纯粹地测试，
   * 也避免把"要不要 tick"和"tick 里做什么"混在一起。
   */
  advance(realNowMs: number): ClockAdvance {
    const nowPs = msToPs(realNowMs);

    // 未校准：只记起点
    if (this.lastPs === undefined) {
      this.lastPs = nowPs;
      return this.makeAdvance(0, 0, 0, nowPs);
    }

    // 时间倒流（系统时钟调整、计时器精度抖动）：静默忽略
    if (nowPs <= this.lastPs) {
      this.lastPs = nowPs;
      return this.makeAdvance(0, 0, 0, nowPs);
    }

    this.lastPs = nowPs;

    // 真实时间决定"应该推进到哪"，而不是"攒了多少时间"。
    // 这一句是整个方案的支点：只有一套算法，所以不会有自相矛盾。
    const targetTick = ticksAt(realNowMs);
    let steps = targetTick - this.ticks;
    let droppedTicks = 0;

    if (steps < 0) {
      // 理论上不可达（ticksAt 单调），但外部时钟回拨时要兜住
      steps = 0;
    } else if (steps > MAX_CATCHUP_TICKS) {
      droppedTicks = steps - MAX_CATCHUP_TICKS;
      steps = MAX_CATCHUP_TICKS;
    }

    this.ticks += steps;

    return this.makeAdvance(steps, droppedTicks, droppedTicks * PS_PER_TICK, nowPs);
  }

  private makeAdvance(
    steps: number,
    droppedTicks: number,
    droppedPs: number,
    nowPs: number,
  ): ClockAdvance {
    return {
      steps,
      tick: this.ticks,
      time: this.time,
      alpha: this.alphaFor(nowPs),
      droppedTicks,
      droppedMs: droppedPs / PS_PER_MS,
    };
  }
}
