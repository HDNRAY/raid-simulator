import {
  LOGICAL_H,
  LOGICAL_W,
  computeCanvasCssSize,
  type ScalingMode,
} from './scaling';

/**
 * 缩放里的 DOM 操作部分。
 *
 * **这里只改 canvas 的 CSS 尺寸，绝不改 canvas 的内部尺寸。**
 * 这样 resize 是廉价的（浏览器重排），不触发 Pixi 的 framebuffer / 纹理重建
 * （architecture 规范 §10.2 / §10.4）。
 */

export interface StageSize {
  /** canvas 的 CSS 像素宽高 */
  width: number;
  height: number;
  scale: number;
  /** letterbox 的单侧留白，供 HUD 安全区判断用（§10.5） */
  padX: number;
  padY: number;
}

/** 计算当前视口下 canvas 应有的 CSS 尺寸与黑边。 */
export function measureStage(stage: HTMLElement, mode: ScalingMode): StageSize {
  const { width, height, scale } = computeCanvasCssSize(
    stage.clientWidth,
    stage.clientHeight,
    mode,
  );
  return {
    width,
    height,
    scale,
    padX: Math.max(0, Math.round((stage.clientWidth - width) / 2)),
    padY: Math.max(0, Math.round((stage.clientHeight - height) / 2)),
  };
}

/**
 * 把尺寸写到 canvas 的 CSS 上。
 *
 * 同时断言内部尺寸没被改动过 —— 这是 §10.2 那个决定的可执行保证。
 * 一旦有人（或某个 Pixi 插件）改了 renderer 尺寸，这里立刻抛错。
 */
export function applyStageSize(
  canvas: HTMLCanvasElement,
  size: StageSize,
): void {
  if (canvas.width !== LOGICAL_W || canvas.height !== LOGICAL_H) {
    // 开发者错误，不是面向玩家的文案 —— 所以用英文，不进 i18n 表。
    throw new Error(
      `canvas backing size must stay ${LOGICAL_W}x${LOGICAL_H}, got ` +
        `${canvas.width}x${canvas.height}. Scaling must only change CSS size.`,
    );
  }
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
}

/**
 * 监听视口变化并持续应用尺寸。返回取消订阅函数。
 */
export function observeStage(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  mode: ScalingMode,
  onResize?: (size: StageSize) => void,
): () => void {
  const update = () => {
    const size = measureStage(stage, mode);
    applyStageSize(canvas, size);
    onResize?.(size);
  };

  update();

  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }

  const observer = new ResizeObserver(update);
  observer.observe(stage);
  return () => observer.disconnect();
}
