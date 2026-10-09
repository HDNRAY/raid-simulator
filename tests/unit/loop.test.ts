import { describe, expect, it, vi } from 'vitest';
import {
  DT,
  FixedLoop,
  MAX_CATCHUP_TICKS,
  MS_PER_TICK,
  PS_PER_TICK,
  TICKS_PER_SECOND,
  exactTickMs,
  frameOf,
  msToPs,
  quantizeToFrame,
  tickToMs,
  ticksAt,
} from '../../src/core/loop';
import { SimClock } from '../../src/core/simClock';

/**
 * 用"模拟真实 rAF"的方式推进：每帧只喂一个 DT，避免触发 MAX_CATCHUP_TICKS。
 * 裸的 `advance(t0 + 1000)` 不是"60 帧"，而是"睡了 1 秒"——那是另一条路径。
 */
function advanceFrames(loop: FixedLoop, frames: number, onTick?: () => void): void {
  for (let i = 1; i <= frames; i += 1) {
    // 必须用 exactTickMs 而不是 i * MS_PER_TICK：
    // 后者是浮点乘法，60 * MS_PER_TICK = 1000.0000000000001，
    // 与"精确的第 60 个 tick 边界"不是同一个数。
    loop.advance(exactTickMs(i), onTick ?? (() => {}));
  }
}

describe('时间常量', () => {
  it('频率是 60Hz，由频率派生每 tick 时长', () => {
    expect(TICKS_PER_SECOND).toBe(60);
    expect(MS_PER_TICK).toBeCloseTo(16.6667, 3);
    expect(DT).toBe(MS_PER_TICK);
  });

  it('PS_PER_TICK 是整数且相对误差极小（皮秒单位的意义）', () => {
    expect(Number.isInteger(PS_PER_TICK)).toBe(true);
    // 皮秒下每 tick 的相对表示误差约 2e-11，比纳秒（2e-8）小三个数量级
    const exact = 1_000_000_000_000 / TICKS_PER_SECOND;
    expect(Math.abs(PS_PER_TICK - exact) / exact).toBeLessThan(1e-10);
  });

  it('频率误差是固定的、不随时间增长（皮秒单位的关键好处）', () => {
    // 皮秒下每 tick 的相对表示误差约 2e-11，比纳秒（2e-8）小三个数量级
    const nominalHz = 1e12 / PS_PER_TICK;
    expect(Math.abs(nominalHz - 60) / 60).toBeLessThan(1e-10);
    // 5 分钟累计偏差远小于 1 微秒（对比：纳秒单位下会差 6 微秒，
    // 正好足以让 ticksAt(300000) 少 1 tick）
    const elapsedMs = 5 * 60 * 1000;
    const modeledMs = (elapsedMs / 1000) * TICKS_PER_SECOND * (PS_PER_TICK / 1e9);
    expect(Math.abs(elapsedMs - modeledMs)).toBeLessThan(1e-3);
  });

  it('单帧最大补帧是 5 tick', () => {
    expect(MAX_CATCHUP_TICKS).toBe(5);
  });
});

describe('换算函数', () => {
  it('msToPs 得到精确整数', () => {
    expect(msToPs(0)).toBe(0);
    expect(msToPs(1)).toBe(1_000_000_000);
    expect(Number.isInteger(msToPs(16.6667))).toBe(true);
    expect(Number.isInteger(msToPs(123.456789))).toBe(true);
  });

  it('ticksAt 由真实时间直接决定 tick 数', () => {
    expect(ticksAt(0)).toBe(0);
    expect(ticksAt(1000)).toBe(60);
    expect(ticksAt(5000)).toBe(300);
    expect(ticksAt(60_000)).toBe(3600);
  });

  it('tickToMs 与 ticksAt 在整 tick 边界上互逆', () => {
    for (const tick of [0, 1, 60, 300, 18000]) {
      const ms = tickToMs(tick);
      expect(ticksAt(ms)).toBe(tick);
    }
  });

  it('quantizeToFrame 把时间吸附到最近的 tick 边界', () => {
    expect(quantizeToFrame(0)).toBe(0);
    expect(quantizeToFrame(MS_PER_TICK * 0.4)).toBe(0);
    expect(quantizeToFrame(exactTickMs(2))).toBeCloseTo(exactTickMs(2), 6);
  });

  it('frameOf 与时钟用同一套换算（否则会出现自相矛盾）', () => {
    expect(frameOf(0)).toBe(0);
    expect(frameOf(1000)).toBe(60);
    expect(frameOf(5000)).toBe(300);
    expect(frameOf(exactTickMs(7))).toBe(7);
  });
});

describe('SimClock —— 这是精度问题的核心', () => {
  it('第一帧只校准，不推进', () => {
    const clock = new SimClock();
    const a = clock.advance(1000);
    expect(a.steps).toBe(0);
    expect(a.tick).toBe(0);
    expect(a.alpha).toBe(0);
  });

  it('【回归】恰好 60 帧产出恰好 60 tick', () => {
    // 这是旧实现真正的 bug：60 * MS_PER_TICK = 1000.0000000000001，
    // 而逐帧累加得 999.9999999999999，于是只推进 59。
    // 当时靠加 1e-9 容差掩盖，换个帧率又错。
    const clock = new SimClock();
    clock.advance(0);
    for (let i = 1; i <= 60; i += 1) clock.advance(exactTickMs(i));
    expect(clock.tickCount).toBe(60);
  });

  it('【回归】累积 1000ms（分多次）产出恰好 60 tick', () => {
    // 注意不能写 `clock.advance(1000)`：那是"一次跳 1000ms"，
    // 会触发 MAX_CATCHUP_TICKS 钳制（设计如此，对应标签页休眠）。
    // 真实 rAF 每 ~16ms 一帧，所以这里按帧喂。
    const clock = new SimClock();
    clock.advance(0);
    for (let i = 1; i <= 60; i += 1) clock.advance(exactTickMs(i));
    expect(clock.tickCount).toBe(60);
  });

  it('【回归】单次跳跃 1000ms 只补钳制上限（这是预期行为）', () => {
    const clock = new SimClock();
    clock.advance(0);
    const a = clock.advance(1000);
    expect(a.steps).toBe(MAX_CATCHUP_TICKS);
    expect(a.droppedTicks).toBeGreaterThan(0);
  });

  it('【回归】逐帧推进与分批推进给出相同的 tick 数', () => {
    const frameByFrame = new SimClock();
    frameByFrame.advance(0);
    for (let i = 1; i <= 1000; i += 1) frameByFrame.advance(exactTickMs(i));

    const batched = new SimClock();
    batched.advance(0);
    // 一次跳 1000 帧会触发钳制，所以分 200 次每次 5 帧
    for (let i = 1; i <= 200; i += 1) batched.advance(exactTickMs(i * 5));

    expect(frameByFrame.tickCount).toBe(1000);
    expect(batched.tickCount).toBe(1000);
  });

  it('144Hz 渲染下 tick 数仍严格按真实时间（不会多 tick）', () => {
    const clock = new SimClock();
    clock.advance(0);
    const hz = 144;
    const frames = hz * 5; // 5 秒
    for (let i = 1; i <= frames; i += 1) clock.advance((i * 1000) / hz);
    expect(clock.tickCount).toBe(ticksAt((frames * 1000) / hz));
    expect(clock.tickCount).toBe(300);
  });

  it('30Hz 渲染下 tick 数也严格按真实时间（掉帧会补上）', () => {
    const clock = new SimClock();
    clock.advance(0);
    const hz = 30;
    for (let i = 1; i <= hz * 5; i += 1) clock.advance((i * 1000) / hz);
    expect(clock.tickCount).toBe(ticksAt((hz * 5 * 1000) / hz));
    expect(clock.tickCount).toBe(300);
  });

  it('抖动帧间隔（均值为 MS_PER_TICK）不产生系统性丢 tick', () => {
    const clock = new SimClock();
    clock.advance(0);
    const jitter = [0.4, -0.4, 0.15, -0.15, 0];
    let t = 0;
    const frames = 1000;
    for (let i = 0; i < frames; i += 1) {
      t += MS_PER_TICK + (jitter[i % jitter.length] ?? 0);
      clock.advance(t);
    }
    // 真实时间 t 对应的 tick 数就是标准答案 —— 不需要"容忍 ±1"
    expect(clock.tickCount).toBe(ticksAt(t));
  });

  it('【回归】5 分钟（18000 tick）无累积漂移', () => {
    const clock = new SimClock();
    clock.advance(0);
    const frames = 60 * 60 * 5; // 5 分钟 @60fps
    for (let i = 1; i <= frames; i += 1) clock.advance(exactTickMs(i));
    expect(clock.tickCount).toBe(frames);
    // 模拟时间由 tick 数派生，与"tick * 每 tick 时长"必然一致，不可能漂
    expect(clock.time).toBe(tickToMs(frames));
  });

  it('不足一个 tick 时不推进，但 alpha 反映进度', () => {
    const clock = new SimClock();
    clock.advance(0);
    const a = clock.advance(MS_PER_TICK * 0.5);
    expect(a.steps).toBe(0);
    expect(a.alpha).toBeGreaterThan(0.4);
    expect(a.alpha).toBeLessThan(0.6);
  });

  it('alpha 始终落在 [0, 1)', () => {
    const clock = new SimClock();
    clock.advance(0);
    let t = 0;
    for (let i = 0; i < 300; i += 1) {
      t += 7.3;
      const a = clock.advance(t);
      expect(a.alpha).toBeGreaterThanOrEqual(0);
      expect(a.alpha).toBeLessThan(1);
    }
  });

  it('一次巨大的 delta 只补 MAX_CATCHUP_TICKS，并报告丢弃的 tick 数', () => {
    const clock = new SimClock();
    clock.advance(0);
    const a = clock.advance(5000);
    expect(a.steps).toBe(MAX_CATCHUP_TICKS);
    // 5000ms 名义上是 300 tick，丢弃的是除补齐部分外的全部
    expect(a.droppedTicks).toBe(ticksAt(5000) - MAX_CATCHUP_TICKS);
    expect(a.droppedMs).toBeCloseTo(a.droppedTicks * MS_PER_TICK, 3);
  });

  it('钳制语义直接对应 tick（不受每 tick 时长表示误差影响）', () => {
    const clock = new SimClock();
    clock.advance(0);
    // 无论睡多久，steps 恒为 MAX_CATCHUP_TICKS
    for (const sleep of [100, 1000, 100_000]) {
      const c = new SimClock();
      c.advance(0);
      expect(c.advance(sleep).steps).toBe(MAX_CATCHUP_TICKS);
    }
  });

  it('【回归】慢帧的零头必须跨帧累积，不能慢性丢 tick', () => {
    // 20ms 一帧（慢于 60Hz）。天真实现会每帧只产出 1 tick，
    // 把 3.33ms 的零头永久丢掉 —— 平均每 5 帧少 1 tick。
    const clock = new SimClock();
    clock.advance(0);
    const frames = 500;
    const frameMs = 20;
    for (let i = 1; i <= frames; i += 1) clock.advance(i * frameMs);
    // 500 帧 × 20ms = 10000ms → 应当是 600 tick
    expect(clock.tickCount).toBe(ticksAt(frames * frameMs));
    expect(clock.tickCount).toBe(600);
  });

  it('【回归】债务上限只影响"挂起恢复"，不影响正常慢帧', () => {
    // 每帧 4 tick 的慢帧（约 66ms，极端但合法）应完整补齐
    const clock = new SimClock();
    clock.advance(0);
    for (let i = 1; i <= 10; i += 1) clock.advance(i * 4 * MS_PER_TICK);
    expect(clock.tickCount).toBe(ticksAt(10 * 4 * MS_PER_TICK));
  });

  it('时间倒流时静默忽略，不推进也不抛错', () => {
    const clock = new SimClock();
    clock.advance(1000);
    clock.advance(1200);
    const before = clock.tickCount;
    const a = clock.advance(1100);
    expect(a.steps).toBe(0);
    expect(a.droppedTicks).toBe(0);
    expect(clock.tickCount).toBe(before);
  });

  it('reset 后可以重新开始', () => {
    const clock = new SimClock();
    clock.advance(0);
    for (let i = 1; i <= 60; i += 1) clock.advance(exactTickMs(i));
    expect(clock.tickCount).toBe(60);
    clock.reset();
    expect(clock.tickCount).toBe(0);
    expect(clock.advance(0).steps).toBe(0);
  });
});

describe('FixedLoop', () => {
  it('每步传入的 tick 序号与时间满足 tick * 每tick时长 不变量', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    const seen: Array<[number, number]> = [];
    advanceFrames(loop, 3, () => {});
    const loop2 = new FixedLoop();
    loop2.advance(0, () => {});
    for (let i = 1; i <= 3; i += 1) {
      loop2.advance(exactTickMs(i), (tick, time) => seen.push([tick, time]));
    }
    expect(seen.map(([t]) => t)).toEqual([1, 2, 3]);
    for (const [tick, time] of seen) {
      expect(time).toBeCloseTo(tickToMs(tick), 6);
    }
  });

  it('逐帧推进 60 次得到 60 步，且回调被调用 60 次', () => {
    const loop = new FixedLoop();
    const onTick = vi.fn();
    loop.advance(0, onTick);
    advanceFrames(loop, 60, onTick);
    expect(onTick).toHaveBeenCalledTimes(60);
    expect(loop.tickCount).toBe(60);
  });

  it('tickAt 把时间换算成 tick 序号', () => {
    const loop = new FixedLoop();
    expect(loop.tickAt(0)).toBe(0);
    expect(loop.tickAt(1000)).toBe(60);
    expect(loop.tickAt(exactTickMs(3))).toBe(3);
  });
});
