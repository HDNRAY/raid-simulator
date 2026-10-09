import { describe, expect, it } from 'vitest';
import {
  LOGICAL_ASPECT,
  LOGICAL_H,
  LOGICAL_W,
  computeCanvasCssSize,
  computeScale,
} from '../../src/render/scaling';

describe('逻辑分辨率常量', () => {
  it('是 960x540 且为 16:9', () => {
    expect(LOGICAL_W).toBe(960);
    expect(LOGICAL_H).toBe(540);
    expect(LOGICAL_ASPECT).toBeCloseTo(16 / 9, 10);
  });
});

describe('computeScale', () => {
  it('fit 模式按 min(w/960, h/540) 等比缩放', () => {
    // 受限的是宽度：1280/960=1.333，720/540=1.333 -> 1.333...
    expect(computeScale(1280, 720, 'fit')).toBeCloseTo(4 / 3, 10);
    // 超宽屏：高度受限
    expect(computeScale(3840, 1080, 'fit')).toBeCloseTo(2, 10);
    // 竖屏：宽度受限
    expect(computeScale(540, 960, 'fit')).toBeCloseTo(0.5625, 10);
  });

  it('fit 模式在常见分辨率下倍率恰好是整数', () => {
    // 这是选 fit 作为默认模式的关键理由（architecture 规范 §10.2）
    expect(computeScale(1920, 1080, 'fit')).toBeCloseTo(2, 10);
    expect(computeScale(3840, 2160, 'fit')).toBeCloseTo(4, 10);
    expect(computeScale(960, 540, 'fit')).toBeCloseTo(1, 10);
  });

  it('integer 模式向下取整', () => {
    expect(computeScale(1920, 1080, 'integer')).toBe(2);
    // 2560/960 = 2.667 -> 2，而不是 2.667
    expect(computeScale(2560, 1440, 'integer')).toBe(2);
    // 3839/960 = 3.999 -> 3
    expect(computeScale(3839, 2160, 'integer')).toBe(3);
  });

  it('integer 模式至少为 1 倍（小窗口允许被裁切，但不缩到看不见）', () => {
    expect(computeScale(480, 270, 'integer')).toBe(1);
    expect(computeScale(100, 100, 'integer')).toBe(1);
    expect(computeScale(1, 1, 'integer')).toBe(1);
  });

  it('非正数 / NaN / Infinity 输入退回 1 倍，不产生 NaN 尺寸', () => {
    expect(computeScale(0, 0, 'fit')).toBe(1);
    expect(computeScale(-100, -100, 'fit')).toBe(1);
    expect(computeScale(Number.NaN, 540, 'fit')).toBe(1);
    expect(computeScale(960, Number.POSITIVE_INFINITY, 'fit')).toBe(1);
  });
});

describe('computeCanvasCssSize', () => {
  it('CSS 尺寸严格保持 16:9', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [2560, 1440],
      [1366, 768],
      [3440, 1440],
      [800, 600],
      [500, 900],
    ] as const) {
      const size = computeCanvasCssSize(w, h, 'fit');
      expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
      // 不能溢出视口（浮点取整留 1px 容差）
      expect(size.width).toBeLessThanOrEqual(w + 1);
      expect(size.height).toBeLessThanOrEqual(h + 1);
    }
  });

  it('尺寸是整数（避免 CSS 半像素导致边缘发虚）', () => {
    const size = computeCanvasCssSize(1366, 768, 'fit');
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});
