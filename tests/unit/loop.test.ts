import { describe, expect, it, vi } from 'vitest';
import {
  DT,
  FixedLoop,
  MAX_CATCHUP_MS,
  frameOf,
  quantizeToFrame,
} from '../../src/core/loop';

/**
 * 用"模拟真实 rAF"的方式推进：每帧只喂一个 DT，避免触发 MAX_CATCHUP_MS 钳制。
 * 裸的 `advance(t0 + 1000)` 不是"60 帧"，而是"睡了 1 秒"——那是另一条路径。
 */
function advanceFrames(loop: FixedLoop, frames: number, onTick?: () => void): void {
  for (let i = 1; i <= frames; i += 1) {
    loop.advance(i * DT, onTick ?? (() => {}));
  }
}

describe('常量', () => {
  it('步长是 60Hz', () => {
    expect(DT).toBeCloseTo(16.6667, 3);
    expect(1 / (DT / 1000)).toBeCloseTo(60, 6);
  });

  it('单帧最大补帧是 5 步', () => {
    expect(MAX_CATCHUP_MS / DT).toBeCloseTo(5, 10);
  });
});

describe('FixedLoop.advance', () => {
  it('第一帧只校准起点，不推进逻辑', () => {
    const loop = new FixedLoop();
    const onTick = vi.fn();
    const r = loop.advance(1000, onTick);
    expect(r.steps).toBe(0);
    expect(r.alpha).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
    expect(loop.tickCount).toBe(0);
  });

  it('逐帧推进 60 次得到 60 步', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    advanceFrames(loop, 60);
    expect(loop.tickCount).toBe(60);
    expect(loop.currentTime).toBeCloseTo(1000, 6);
  });

  it('每步传入的 tick 序号与时间满足 ticks * DT 不变量', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    const seen: Array<[number, number]> = [];
    advanceFrames(loop, 3, () => {});
    // 重新建一个来收集
    const loop2 = new FixedLoop();
    loop2.advance(0, () => {});
    for (let i = 1; i <= 3; i += 1) {
      loop2.advance(i * DT, (tick, time) => seen.push([tick, time]));
    }
    expect(seen.map(([t]) => t)).toEqual([1, 2, 3]);
    for (const [tick, time] of seen) {
      expect(time).toBeCloseTo(tick * DT, 10);
    }
  });

  it('不足一步时不推进，只累积 alpha', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    const r = loop.advance(DT / 2, () => {});
    expect(r.steps).toBe(0);
    expect(r.alpha).toBeCloseTo(0.5, 10);
    expect(loop.currentTime).toBe(0);
  });

  it('alpha 始终落在 [0, 1)', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    let t = 0;
    for (let i = 0; i < 200; i += 1) {
      t += 7.3;
      const r = loop.advance(t, () => {});
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThan(1);
    }
  });

  it('一次巨大的 delta 只补 MAX_CATCHUP_MS，并报告丢弃的时间', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    // 标签页休眠 5 秒后回来
    const r = loop.advance(5000, () => {});
    expect(r.steps).toBe(5);
    expect(r.droppedMs).toBeCloseTo(5000 - MAX_CATCHUP_MS, 6);
    expect(loop.tickCount).toBe(5);
  });

  it('钳制是可恢复的：连续补帧能追上（不是永久丢失）', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    loop.advance(5000, () => {});
    const afterJump = loop.tickCount;
    // 之后每个真实帧仍会正常推进
    advanceFrames(loop, 10);
    expect(loop.tickCount).toBeGreaterThan(afterJump);
    // 但被丢弃的时间不会补回来：总 tick 数仍远小于 300
    expect(loop.tickCount).toBeLessThan(20);
  });

  it('时间倒流时静默忽略，不推进也不抛错', () => {
    const loop = new FixedLoop();
    loop.advance(1000, () => {});
    loop.advance(1200, () => {});
    const before = loop.tickCount;
    const r = loop.advance(1100, () => {});
    expect(r.steps).toBe(0);
    expect(r.droppedMs).toBe(0);
    expect(loop.tickCount).toBe(before);
  });

  it('逐帧推进无累积漂移（600 帧 = 600 步）', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    advanceFrames(loop, 600);
    expect(loop.tickCount).toBe(600);
    expect(loop.currentTime).toBeCloseTo(600 * DT, 6);
  });

  it('浮点抖动下不丢步也不多步（抖动均值为 DT）', () => {
    // 真实 rAF 的间隔会在 DT 附近抖动。这里用对称抖动：
    // 均值恰好是 DT，所以 tick 数应该紧贴 floor(t / DT)。
    const loop = new FixedLoop();
    loop.advance(0, () => {}); // 校准帧
    const jitter = [0.4, -0.4, 0.15, -0.15, 0];
    let t = 0;
    for (let i = 0; i < 1000; i += 1) {
      t += DT + (jitter[i % jitter.length] ?? 0);
      loop.advance(t, () => {});
    }
    const expected = Math.floor(t / DT);
    // 允许 ±1 步的边界差，但绝不允许系统性丢步
    expect(Math.abs(loop.tickCount - expected)).toBeLessThanOrEqual(1);
  });

  it('reset 后可以重新开始', () => {
    const loop = new FixedLoop();
    loop.advance(0, () => {});
    advanceFrames(loop, 60);
    expect(loop.tickCount).toBe(60);
    loop.reset();
    expect(loop.tickCount).toBe(0);
    expect(loop.currentTime).toBe(0);
    // reset 后第一帧又是校准帧
    expect(loop.advance(0, () => {}).steps).toBe(0);
  });

  it('tickAt 把时间换算成 tick 序号', () => {
    const loop = new FixedLoop();
    expect(loop.tickAt(0)).toBe(0);
    expect(loop.tickAt(DT * 2.9)).toBe(2);
    expect(loop.tickAt(DT * 3)).toBe(3);
  });
});

describe('帧量化', () => {
  it('quantizeToFrame 把时间吸附到最近的帧边界', () => {
    expect(quantizeToFrame(0)).toBe(0);
    expect(quantizeToFrame(DT * 0.4)).toBe(0);
    expect(quantizeToFrame(DT * 0.6)).toBeCloseTo(DT, 10);
    expect(quantizeToFrame(DT * 2)).toBeCloseTo(DT * 2, 10);
  });

  it('frameOf 向下取整到 tick 序号', () => {
    expect(frameOf(0)).toBe(0);
    expect(frameOf(DT - 0.001)).toBe(0);
    expect(frameOf(DT)).toBe(1);
    expect(frameOf(DT * 2.5)).toBe(2);
  });
});
