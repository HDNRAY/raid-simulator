import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGICAL_H, LOGICAL_W } from '../../src/render/scaling';
import { applyStageSize, measureStage, observeStage } from '../../src/render/sizes';

/**
 * 这些测试验证 architecture 规范 §10.2 那条约定的**可执行保证**：
 * canvas 的内部尺寸在生命周期内永不改变，缩放只改 CSS。
 */

function makeStage(w: number, h: number): HTMLElement {
  const stage = document.createElement('div');
  Object.defineProperty(stage, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(stage, 'clientHeight', { value: h, configurable: true });
  return stage;
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = LOGICAL_W;
  canvas.height = LOGICAL_H;
  return canvas;
}

describe('measureStage', () => {
  it('按视口算出 CSS 尺寸与黑边', () => {
    const size = measureStage(makeStage(1920, 1080), 'fit');
    expect(size.width).toBe(1920);
    expect(size.height).toBe(1080);
    expect(size.scale).toBeCloseTo(2, 10);
    expect(size.padX).toBe(0);
    expect(size.padY).toBe(0);
  });

  it('超宽屏留出左右黑边', () => {
    // 21:9 显示器 2560x1080：高度受限 -> 缩到 1920x1080，左右各留 320
    const size = measureStage(makeStage(2560, 1080), 'fit');
    expect(size.width).toBe(1920);
    expect(size.height).toBe(1080);
    expect(size.padX).toBe(320);
    expect(size.padY).toBe(0);
  });

  it('高窄屏留出上下黑边', () => {
    const size = measureStage(makeStage(1080, 1920), 'fit');
    expect(size.padY).toBeGreaterThan(0);
    expect(size.padX).toBe(0);
  });
});

describe('applyStageSize', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = makeCanvas();
  });

  it('只写 CSS 尺寸，不动内部尺寸', () => {
    applyStageSize(canvas, { width: 1920, height: 1080, scale: 2, padX: 0, padY: 0 });
    expect(canvas.style.width).toBe('1920px');
    expect(canvas.style.height).toBe('1080px');
    // 关键断言：内部尺寸不变
    expect(canvas.width).toBe(LOGICAL_W);
    expect(canvas.height).toBe(LOGICAL_H);
  });

  it('内部尺寸被改动过就抛错（防止有人用 renderer.resize 走回老路）', () => {
    canvas.width = 1920;
    expect(() =>
      applyStageSize(canvas, { width: 1920, height: 1080, scale: 2, padX: 0, padY: 0 }),
    ).toThrow(/backing size must stay 960x540/);
  });
});

describe('observeStage', () => {
  it('首次调用立即应用一次尺寸', () => {
    const canvas = makeCanvas();
    const { dispose } = observeStage(makeStage(1280, 720), canvas, 'fit');
    expect(canvas.style.width).toBe('1280px');
    expect(canvas.style.height).toBe('720px');
    dispose();
  });

  it('refresh() 按**当前**缩放倍数重测（用户拖 slider 时用）', () => {
    const canvas = makeCanvas();
    let multiplier = 1;
    const handle = observeStage(makeStage(1280, 720), canvas, 'fit', () => {}, () => multiplier);
    expect(canvas.style.width).toBe('1280px');
    // 用户把 UI 缩放调到 150%（视口没变，ResizeObserver 不会自己回调）
    multiplier = 1.5;
    handle.refresh();
    expect(canvas.style.width).toBe('1920px');
    handle.dispose();
  });

  it('回调收到尺寸信息，dispose 之后不再触发', () => {
    const canvas = makeCanvas();
    const onResize = vi.fn();
    const { dispose } = observeStage(makeStage(960, 540), canvas, 'fit', onResize);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0]?.[0]).toMatchObject({ width: 960, height: 540 });
    dispose();
  });
});
