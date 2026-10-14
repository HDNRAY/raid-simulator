/**
 * **彩虹分段色** —— 给"霸体读条条"的**彩色渐变边框**提供颜色。
 *
 * ==================================================================
 * 为什么是"分段近似"而不是真渐变
 * ==================================================================
 *
 * Pixi 的 `Graphics.stroke()` 吃的是**纯色**（`FillGradient` 那条路在自己的
 * `fill()` 上，描边用不上）。所以"渐变描边"的做法是：把圆角矩形的轮廓切成
 * `count` 段，**每段一个色相**，逐段 stroke —— 段数够多时肉眼就是渐变。
 *
 * ⚠️ 单独一个**纯函数**模块（不 import Pixi）：
 *   - 可单测（颜色是数值，不截图也能验）
 *   - "同一份算法只许有一份实现"（AGENTS.md §2）—— 谁再要彩虹，用这个
 *
 * ⚠️ 色相**首尾相接**（`i / count` 而不是 `i / (count - 1)`）：圆角矩形是
 * **闭合**轮廓，用 `count - 1` 会让起点与终点之间出现一道**明显的接缝**。
 */
export function rainbowColors(count: number): readonly number[] {
  if (count <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(hslToRgbInt(i / count, 0.9, 0.6));
  }
  return out;
}

/**
 * HSL → `0xRRGGBB`。
 *
 * @param h 色相 **0..1**（不是 0..360 —— 调用方做除法时不用记两套刻度）
 * @param s 饱和度 0..1
 * @param l 亮度 0..1
 */
export function hslToRgbInt(h: number, s: number, l: number): number {
  const hue = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 1 / 6
      ? [c, x, 0]
      : hue < 2 / 6
        ? [x, c, 0]
        : hue < 3 / 6
          ? [0, c, x]
          : hue < 4 / 6
            ? [0, x, c]
            : hue < 5 / 6
              ? [x, 0, c]
              : [c, 0, x];
  const to255 = (v: number): number => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}
