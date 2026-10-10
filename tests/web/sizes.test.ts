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

  it('写 CSS 尺寸，并要求内部缓冲 = CSS × DPR', () => {
    /**
     * ⚠️ 这条断言在"全屏糊"修复时**反过来了**。
     *
     * 旧契约是"内部永远是 960×540、只改 CSS" —— 那正是糊的根源：
     * 一张 960×540 的图被浏览器拉伸 1.3×（视网膜屏等效 2.6×）。
     * 新契约是"内部缓冲跟着 CSS 与 DPR 走"。
     */
    canvas.width = 1920;
    canvas.height = 1080;
    applyStageSize(canvas, {
      width: 960,
      height: 540,
      scale: 1,
      bufferWidth: 1920,
      bufferHeight: 1080,
      dpr: 2,
      padX: 0,
      padY: 0,
    });
    expect(canvas.style.width).toBe('960px');
    expect(canvas.style.height).toBe('540px');
  });

  it('内部缓冲与 CSS×DPR 不符就抛错（防止退回"只改 CSS"）', () => {
    // canvas 内部还是 960×540，而按 DPR=2 应该是 1920×1080
    expect(() =>
      applyStageSize(canvas, {
        width: 960,
        height: 540,
        scale: 1,
        bufferWidth: 1920,
        bufferHeight: 1080,
        dpr: 2,
        padX: 0,
        padY: 0,
      }),
    ).toThrow(/backing size must be/);
  });
});

describe('observeStage', () => {
  /**
   * ⚠️ `observeStage` 现在**要求 canvas 的内部缓冲已经是 CSS×DPR**
   * （真实运行时由 Pixi 的 `renderer.resize()` 保证，见 `main.ts` 的
   * `syncRenderer`）。测试里要先把 canvas 摆成合法状态，
   * 否则 `applyStageSize` 的断言会按设计抛错。
   */
  it('首次调用立即应用一次尺寸', () => {
    const canvas = makeCanvas();
    canvas.width = 1280;
    canvas.height = 720;
    const { dispose } = observeStage(makeStage(1280, 720), canvas, 'fit');
    expect(canvas.style.width).toBe('1280px');
    expect(canvas.style.height).toBe('720px');
    dispose();
  });

  it('refresh() 用当前视口重测（面板尺寸变化后可手动触发）', () => {
    const canvas = makeCanvas();
    canvas.width = 1280;
    canvas.height = 720;
    const handle = observeStage(makeStage(1280, 720), canvas, 'fit');
    expect(canvas.style.width).toBe('1280px');
    handle.refresh();
    expect(canvas.style.width).toBe('1280px');
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
