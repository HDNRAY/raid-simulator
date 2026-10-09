import { describe, expect, it } from 'vitest';
import {
  LOGICAL_ASPECT,
  LOGICAL_H,
  LOGICAL_W,
  computeCanvasCssSize,
  computeScale,
} from '../../src/render/scaling';
import { LOGICAL, skillSlotLabels, skillSlotRect } from '../../src/ui/layout';

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

describe('技能格内三个标签都不越界、互不重叠', () => {
  /**
   * 这条约束以前只存在于坐标算术里，没有测试保护 —— 结果连着踩了三次：
   *   1. 冷却数字放正中 → 与技能字完全重叠
   *   2. 按键提示移到格子外下方 → 落到 y=531，画布只有 540，被截断
   *   3. 冷却数字又放底部居中 → 与右下角的按键提示挤在一起
   *
   * 画布固定 960×540 不随窗口变化，所以"画到外面"在截图里看起来
   * 像"没画"，很难发现。用算术断言就一目了然。
   */
  it('6 个槽位：三个标签都在格子内', () => {
    const total = 6;
    for (let i = 0; i < total; i += 1) {
      const rect = skillSlotRect(i, total);
      const pos = skillSlotLabels(rect);
      for (const [name, p] of Object.entries(pos)) {
        expect(p.x, `${name} 的 x 越界（槽位 ${i}）`).toBeGreaterThanOrEqual(rect.x);
        expect(p.x, `${name} 的 x 越界（槽位 ${i}）`).toBeLessThanOrEqual(rect.x + rect.w);
        expect(p.y, `${name} 的 y 越界（槽位 ${i}）`).toBeGreaterThanOrEqual(rect.y);
        expect(p.y, `${name} 的 y 越界（槽位 ${i}）`).toBeLessThanOrEqual(rect.y + rect.h);
      }
    }
  });

  it('【关键】所有标签都在画布内 —— 不能贴到底边之外', () => {
    const total = 6;
    /** 标签的字号上限：技能字 26、其它 13。加它是为了估算文字高度。 */
    const heights: Record<string, number> = { glyph: 17, cooldown: 18, key: 13 };
    for (let i = 0; i < total; i += 1) {
      const rect = skillSlotRect(i, total);
      const pos = skillSlotLabels(rect);
      for (const [name, p] of Object.entries(pos)) {
        expect(p.y + (heights[name] ?? 0), `${name} 超出画布高度`).toBeLessThanOrEqual(
          LOGICAL.height,
        );
      }
    }
  });

  it('三个标签的**实际文字矩形**互不重叠', () => {
    /**
     * 用实测尺寸做矩形重叠检测，而不是靠"y 坐标谁大谁小"。
     *
     * 早先我写的是"数字的 y 必须 ≥ 技能字底部"，那条断言假设了两个
     * 标签**左右对齐**；但数字是居中的、技能字也在中间，两者本来就
     * 在垂直方向交叠 —— 真正避免重叠的是**水平错开**（数字居中、
     * 按键右对齐）与**垂直错开**（字在上、数字在中下）。
     * 只有矩形相交检测能同时覆盖这两种情况。
     *
     * 尺寸来自浏览器实测（探针读 `getBounds()`）：
     *   技能字 26x28、冷却数字 11x18、按键提示 7x13
     */
    /**
     * 尺寸来自浏览器实测（探针读 `getBounds()`）：
     *   技能字 15px 楷体 → 15x17
     *   冷却秒数 13px     → 9x18（含描边）
     *   按键提示 11px     → 7x13
     */
    const sizes = { glyph: { w: 15, h: 17 }, cooldown: { w: 11, h: 18 }, key: { w: 7, h: 13 } };
    const total = 6;
    for (let i = 0; i < total; i += 1) {
      const rect = skillSlotRect(i, total);
      const pos = skillSlotLabels(rect);
      // 把 anchor 折算成左上角
      const boxes = [
        { name: 'glyph', x: pos.glyph.x - sizes.glyph.w / 2, y: pos.glyph.y, ...sizes.glyph },
        {
          name: 'cooldown',
          x: pos.cooldown.x - sizes.cooldown.w / 2,
          y: pos.cooldown.y,
          ...sizes.cooldown,
        },
        // 按键提示现在是**左对齐**（左上角）
        { name: 'key', x: pos.key.x, y: pos.key.y, ...sizes.key },
      ];

      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const A = boxes[a]!;
          const B = boxes[b]!;
          const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
          const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
          // 允许 1px 的抗锯齿交叠
          const overlapping = ox > 1 && oy > 1;
          expect(overlapping, `${A.name} 与 ${B.name} 重叠（槽位 ${i}）`).toBe(false);
        }
      }
    }
  });

  it('槽位右对齐：最后一格的右边缘贴合安全边距', () => {
    const total = 6;
    const last = skillSlotRect(total - 1, total);
    expect(last.x + last.w).toBe(LOGICAL.width - 8);
  });
});
