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

/** 计算 canvas 的 CSS 尺寸（始终保持 16:9）。 */
export function computeCanvasCssSize(
  viewportW: number,
  viewportH: number,
  mode: ScalingMode,
): { width: number; height: number; scale: number } {
  const scale = computeScale(viewportW, viewportH, mode);
  return {
    scale,
    width: Math.round(LOGICAL_W * scale),
    height: Math.round(LOGICAL_H * scale),
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
