/**
 * 逻辑分辨率与自适应缩放的**纯计算**部分。
 *
 * 刻意不碰 DOM：这样它可以在 node 环境的测试里跑（architecture 规范 §2.1 / §10）。
 * 所有 DOM 操作在 render/sizes.ts 里。
 *
 * 核心决定（architecture 规范 §10.2）：
 *   canvas 的内部尺寸永远是 960x540，生命周期内不变；
 *   缩放完全交给 CSS。所以这里只负责算"CSS 该多大"。
 */

/** 逻辑分辨率。所有游戏内坐标、HUD 布局、像素画尺寸都基于它。 */
export const LOGICAL_W = 960;
export const LOGICAL_H = 540;

/** 逻辑宽高比（16:9）。用于断言与布局校验。 */
export const LOGICAL_ASPECT = LOGICAL_W / LOGICAL_H;

/**
 * 缩放模式。
 * - `fit`     等比放大到刚好填满视口（默认）。常见分辨率下倍率恰好是整数。
 * - `integer` 向下取整数倍，周围留黑边。绝对锐利，但黑边可能很宽。
 */
export type ScalingMode = 'fit' | 'integer';

/** 计算 CSS 缩放倍率。 */
export function computeScale(
  viewportW: number,
  viewportH: number,
  mode: ScalingMode,
): number {
  if (!Number.isFinite(viewportW) || !Number.isFinite(viewportH)) return 1;
  if (viewportW <= 0 || viewportH <= 0) return 1;

  const fit = Math.min(viewportW / LOGICAL_W, viewportH / LOGICAL_H);
  if (fit <= 0) return 1;

  return mode === 'integer' ? Math.max(1, Math.floor(fit)) : fit;
}

/**
 * 计算 canvas 的 **CSS 尺寸**与**内部缓冲尺寸**（始终保持 16:9）。
 *
 * ==================================================================
 * 为什么要区分这两个尺寸（需求："全屏看着糊"）
 * ==================================================================
 *
 * 之前 `resolution: 1` + CSS 放大到 1244×700 —— 于是 960×540 的
 * 一张图被**浏览器拉伸 1.3 倍**，在 DPR=2 的屏幕上是拉伸 **2.6 倍**：
 * 只用了 39% 的物理像素，所以看起来发糊。
 *
 * 现在内部缓冲 = CSS 尺寸 × DPR，两个尺寸分开管理：
 *   - `cssWidth/cssHeight`  —— 交给 canvas 的 style（自动适配 + letterbox）
 *   - `bufferWidth/bufferHeight` —— 交给 Pixi 清屏（`renderer.resize`）
 *
 * ⚠️ **画布槽位仍然是 960×540 逻辑单位**。Pixi 把世界坐标映射到
 * 缓冲区时会带上这个倍率，所以游戏的坐标系没有变 —— 变的只是
 * "一张逻辑画面用多少物理像素来画"。
 */
export function computeCanvasCssSize(
  viewportW: number,
  viewportH: number,
  mode: ScalingMode,
  /** 设备像素比（`window.devicePixelRatio`）。渲染层之外不要传别的 */
  devicePixelRatio = 1,
): {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  readonly dpr: number;
} {
  const scale = computeScale(viewportW, viewportH, mode);
  const width = Math.round(LOGICAL_W * scale);
  const height = Math.round(LOGICAL_H * scale);
  // DPR 钳到 [1, 2]：4K 屏配 DPR=3 会白烧一半填充率，肉眼几乎无差别
  const dpr = Number.isFinite(devicePixelRatio)
    ? Math.min(2, Math.max(1, devicePixelRatio))
    : 1;
  return {
    scale,
    width,
    height,
    bufferWidth: Math.round(width * dpr),
    bufferHeight: Math.round(height * dpr),
    dpr,
  };
}

/* ------------------------------------------------------------------ *
 * UI 缩放（用户可调）
 * ------------------------------------------------------------------ */

/** UI 缩放的取值范围与步长（设置里的 slider 用）。 */
export const UI_SCALE_MIN = 0.5;
export const UI_SCALE_MAX = 2;
export const UI_SCALE_STEP = 0.1;

/** 把任意输入钳到合法范围并对齐到步长。 */
export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
  // 对齐到步长，避免 0.30000000000000004 这类浮点尾数渗进布局
  return Math.round(clamped / UI_SCALE_STEP) * UI_SCALE_STEP;
}

/**
 * 把 `window.devicePixelRatio` 钳到渲染器实际使用的范围。
 *
 * ⚠️ **上限 2，不是"照搬"**。DPR=3 的 4K 屏会让填充率翻 2.25 倍，
 * 而肉眼在这一档几乎看不出差别 —— 那点清晰度换不回掉帧。
 * 下限 1：DPR < 1（浏览器整页缩放）时不该比 1 更低，否则更糊。
 */
export function clampDevicePixelRatio(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(1, value));
}
