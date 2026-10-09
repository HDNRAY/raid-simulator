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
/**
 * 计算当前视口下 canvas 应有的 CSS 尺寸与黑边。
 *
 * `scaleMultiplier` 是**用户可调**的额外倍数（设置里的"UI 缩放"），
 * 乘在自动适配之上，所以"120%"在任意窗口下都是"比自动适配再大 20%"。
 */
export function measureStage(
  stage: HTMLElement,
  mode: ScalingMode,
  scaleMultiplier = 1,
): StageSize {
  const { width, height, scale } = computeCanvasCssSize(
    stage.clientWidth,
    stage.clientHeight,
    mode,
    scaleMultiplier,
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
  /**
   * 额外的缩放倍数（用户可调，见设置里的"UI 缩放"）。
   *
   * 传**函数**而不是数值：这样它每次测量时读取当前值，
   * 于是回调里改了倍数、只要再触发一次重测就生效 ——
   * 不需要重建整个 observer。
   */
  scaleMultiplier: () => number = () => 1,
): { dispose: () => void; refresh: () => void } {
  const update = () => {
    const size = measureStage(stage, mode, scaleMultiplier());
    applyStageSize(canvas, size);
    onResize?.(size);
  };

  update();

  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', update);
    return {
      dispose: () => window.removeEventListener('resize', update),
      refresh: update,
    };
  }

  const observer = new ResizeObserver(update);
  observer.observe(stage);
  return {
    dispose: () => observer.disconnect(),
    // 用户改了缩放倍数时手动触发一次
    // （ResizeObserver 不会因为"同样的视口尺寸"而重新回调）
    refresh: update,
  };
}
