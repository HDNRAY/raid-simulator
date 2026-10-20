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
 *
 * ⚠️ **2026-10-20 起内部尺寸不再恒等于 960×540**：它是
 * `960×540 × STAGE_SCALE`（`render/stageScale.ts`，1 或 2 倍）。
 * 断言随之改成"**必须等于 逻辑尺寸 × 这一次的倍率**" —— 仍然是"缩放只能
 * 改 CSS、唯一能改内部尺寸的是那个**启动期常数**"，只是它不再恒为 1。
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
 * ⚠️ 这里**没有**用户缩放倍数：画布永远是"自动适配视口"。
 * 设置里的"UI 缩放"只作用于 UI 部件（`ui/uiLayout.ts`），
 * 不改变画布 —— 需求明确要求"战斗画面保持不变"。
 */
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
  /** 这一台设备用的缓冲倍率（`render/stageScale.ts` 的 `StageScale`）。 */
  scale: number,
): void {
  if (canvas.width !== LOGICAL_W * scale || canvas.height !== LOGICAL_H * scale) {
    // 开发者错误，不是面向玩家的文案 —— 所以用英文，不进 i18n 表。
    throw new Error(
      `canvas backing size must stay ${LOGICAL_W * scale}x${LOGICAL_H * scale} ` +
        `(logical ${LOGICAL_W}x${LOGICAL_H} × scale ${scale}), got ` +
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
  scale: number,
  onResize?: (size: StageSize) => void,
): { dispose: () => void; refresh: () => void } {
  const update = () => {
    const size = measureStage(stage, mode);
    applyStageSize(canvas, size, scale);
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
