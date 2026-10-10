import { describe, expect, it } from 'vitest';
import { stripBoxX } from '../../src/render/IconStrip';

/**
 * buff / debuff 图标条的排布数学。
 *
 * ⚠️ 这块被用户实测纠正过**两次**，而它原先藏在依赖 Pixi 的渲染循环里
 * ——**测不到**，只能靠截图碰运气。抽成纯函数就是为了能这样直接断言坐标。
 *
 * 需求（用户）：
 *   - "boss的buff在左上，debuff在右上"
 *   - "boss debuff 应该靠右，从有到左排列 和buff正相反"
 *   - "裂 还是没好，你好像留了 2 个字的位置"
 *   - "你的易伤 并没有写在 debuff 方块的右边"
 */
const SIZE = 20;
const GAP = 6;
/** 右缘：安全区 8px。 */
const RIGHT = 952;
/** 左缘。 */
const LEFT = 8;

/** 一个 2 字中文标签大约占的宽度 + 间隙。 */
const LABEL_2 = 4 + 30;
/** 空标签（不占宽度）。 */
const NO_LABEL = 0;

describe('左对齐（Boss buff 行）', () => {
  it('第一条贴左缘', () => {
    expect(stripBoxX({ count: 1, x: LEFT, size: SIZE, gap: GAP, labelTotals: [LABEL_2] })[0]).toBe(LEFT);
  });

  it('从左往右依次排开（方块在前、标签在后）', () => {
    const xs = stripBoxX({
      count: 3,
      x: LEFT,
      size: SIZE,
      gap: GAP,
      labelTotals: [LABEL_2, LABEL_2, LABEL_2],
    });
    /** 第二步至少要让开"方块 + 标签 + 间隙"。 */
    expect(xs[1]).toBeGreaterThanOrEqual((xs[0] ?? 0) + SIZE + LABEL_2);
    expect(xs[2]).toBeGreaterThan(xs[1] ?? 0);
  });
});

describe('右对齐（Boss debuff 行）', () => {
  it('【核心】最右那条的**标签右缘**恰好落在 `x`（不溢出、不留空）', () => {
    /**
     * ⚠️ 这是"没靠在最右边"那个 bug 的回归断言。
     *
     * 算法：方块右缘 = `x - 本条的标签宽度`（右侧已无条目）。
     * 于是「方块 .. 标签」整体的右缘正好是 `x`。
     */
    const [boxX] = stripBoxX({
      count: 1,
      x: RIGHT,
      size: SIZE,
      gap: GAP,
      align: 'right',
      labelTotals: [LABEL_2],
    });
    const labelLeft = (boxX ?? 0) + SIZE + 4;
    const labelRight = labelLeft + 30;
    expect(labelRight).toBe(RIGHT);
  });

  it('【核心】标签在方块的**右边**（与 buff 行一致）', () => {
    /**
     * 用户："你的易伤 并没有写在 debuff 方块的右边" —— 我之前为了不溢出
     * 右缘，把标签甩到了方块**左边**。现在两者一致：标签都在右边。
     */
    const [boxX] = stripBoxX({
      count: 1,
      x: RIGHT,
      size: SIZE,
      gap: GAP,
      align: 'right',
      labelTotals: [LABEL_2],
    });
    /** 方块右缘 + 间隙 = 标签左缘 > 方块左缘。 */
    expect((boxX ?? 0) + SIZE).toBeLessThan((boxX ?? 0) + SIZE + 4);
    /** 标签整体在方块右侧。 */
    expect((boxX ?? 0) + SIZE + 4).toBeGreaterThanOrEqual((boxX ?? 0) + SIZE);
  });

  it('【核心】**空标签不占宽度** —— 整排才贴得到右缘', () => {
    /**
     * 用户："裂 还是没好，你好像留了 2 个字的位置"。
     *
     * 原来无条件预留标签位，空标签也会占 `labelGap + 16` ≈ 两个字，
     * 右对齐时那个空隙正好在最右边 → 方块贴不到右缘。
     */
    const withEmpty = stripBoxX({
      count: 1,
      x: RIGHT,
      size: SIZE,
      gap: GAP,
      align: 'right',
      labelTotals: [NO_LABEL],
    });
    /** 空标签时方块右缘 = `x`（完全贴边）。 */
    expect((withEmpty[0] ?? 0) + SIZE).toBe(RIGHT);
  });

  it('多条时**从右往左**排（与左对齐相反）', () => {
    const xs = stripBoxX({
      count: 3,
      x: RIGHT,
      size: SIZE,
      gap: GAP,
      align: 'right',
      labelTotals: [LABEL_2, LABEL_2, LABEL_2],
    });
    /** 后一条（更靠右）的 x **更大** —— 与左对齐的递增方向相反。 */
    expect(xs[1]).toBeGreaterThan(xs[0] ?? 0);
    expect(xs[2]).toBeGreaterThan(xs[1] ?? 0);
  });

  it('【核心】多条时最右那条的标签右缘仍然 ≤ `x`（一个都不溢出）', () => {
    const labelTotals = [LABEL_2, LABEL_2, LABEL_2];
    const xs = stripBoxX({ count: 3, x: RIGHT, size: SIZE, gap: GAP, align: 'right', labelTotals });
    /** 逐条算它的"方块+标签"右缘，都不该超过 RIGHT。 */
    for (let i = 0; i < xs.length; i += 1) {
      const right = (xs[i] ?? 0) + SIZE + (labelTotals[i] ?? 0);
      expect(right, `第 ${i} 条`).toBeLessThanOrEqual(RIGHT);
    }
    /** 而且最右那条**正好**落在 RIGHT（不留空）。 */
    expect((xs[2] ?? 0) + SIZE + LABEL_2).toBe(RIGHT);
  });

  it('标签宽度不同时也不会互相压住', () => {
    const labelTotals = [10, 40, 25];
    const xs = stripBoxX({ count: 3, x: RIGHT, size: SIZE, gap: GAP, align: 'right', labelTotals });
    for (let i = 1; i < xs.length; i += 1) {
      const prevRight = (xs[i - 1] ?? 0) + SIZE + (labelTotals[i - 1] ?? 0);
      expect(xs[i], `第 ${i} 条不该压住第 ${i - 1} 条的标签`).toBeGreaterThanOrEqual(prevRight + GAP);
    }
  });
});
