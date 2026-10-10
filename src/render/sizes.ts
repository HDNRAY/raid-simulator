import {
  computeCanvasCssSize,
  type ScalingMode,
} from './scaling';

/**
 * 缩放里的 DOM 操作部分。
 *
 * ⚠️ 原设计是"只改 CSS、绝不改内部尺寸"，理由是 resize 廉价
 * （不触发 framebuffer 重建）。**那个决定正是"全屏糊"的根源** ——
 * 内部永远是 960×540，却被 CSS 拉伸 1.3×（视网膜屏等效 2.6×）。
 *
 * 现在内部缓冲跟着 CSS 与 DPR 走（见 `computeCanvasCssSize`）。
 * 代价是 resize 会重建 framebuffer，但 resize 是**低频**操作
 * （拖窗口 / 转屏），而清晰度是每一帧都在看的。
 */

export interface StageSize {
  /** canvas 的 CSS 像素宽高 */
  width: number;
  height: number;
  scale: number;
  /**
   * canvas 的**内部缓冲**宽高 = CSS 尺寸 × 有效 DPR。
   *
   * 渲染层拿它去 `renderer.resize()` —— 这样一张逻辑画面用足物理像素，
   * 不再被浏览器拉伸（见 `computeCanvasCssSize` 的说明）。
   */
  bufferWidth: number;
  bufferHeight: number;
  /** 实际生效的设备像素比（已钳到 [1,2]） */
  dpr: number;
  /** letterbox 的单侧留白，供 HUD 安全区判断用（§10.5） */
  padX: number;
  padY: number;
}

/**
 * 计算当前视口下 canvas 应有的 CSS 尺寸与黑边。
 *
 * ⚠️ 这里**没有**用户缩放倍数：画布永远是"自动适配视口"。
 * 设置里的"UI 缩放"只作用于 UI 部件（`ui/uiLayout.ts`），
 * 不改变画布 —— 需求明确要求"战斗画面保持不变"。
 */
export function measureStage(
  stage: HTMLElement,
  mode: ScalingMode,
  /** 设备像素比；渲染层之外不要传别的（见 `computeCanvasCssSize`） */
  devicePixelRatio = 1,
): StageSize {
  const { width, height, scale, bufferWidth, bufferHeight, dpr } = computeCanvasCssSize(
    stage.clientWidth,
    stage.clientHeight,
    mode,
    devicePixelRatio,
  );
  return {
    width,
    height,
    scale,
    bufferWidth,
    bufferHeight,
    dpr,
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
  /**
   * ⚠️ 断言内部缓冲 = **CSS 尺寸 × DPR**，不再是固定的 960×540。
   *
   * 原先这里是"内部必须永远是 960×540"，那个决定正是"全屏糊"的
   * 根源：它把 960×540 的一张图交给浏览器拉伸 1.3×（视网膜屏上
   * 等效 2.6×）。现在内部缓冲跟着 CSS 与 DPR 走，**世界坐标仍然是
   * 960×540 逻辑单位**（由 Pixi 的 resolution 映射），所以游戏逻辑
   * 一行没改。
   */
  if (canvas.width !== size.bufferWidth || canvas.height !== size.bufferHeight) {
    // 开发者错误，不是面向玩家的文案 —— 所以用英文，不进 i18n 表。
    throw new Error(
      `canvas backing size must be ${size.bufferWidth}x${size.bufferHeight} ` +
        `(css ${size.width}x${size.height} @ dpr ${size.dpr}), got ` +
        `${canvas.width}x${canvas.height}.`,
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
  devicePixelRatio = 1,
): { dispose: () => void; refresh: () => void } {
  const update = () => {
    const size = measureStage(stage, mode, devicePixelRatio);
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
