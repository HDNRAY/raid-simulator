import { describe, expect, it } from 'vitest';
import { computeContentBox, estimateMonoWidth } from '../../src/ui/IconButton';
import { FONT } from '../../src/ui/layout';

/**
 * 通用图标按钮的**布局算术**（纯函数部分）。
 *
 * 为什么只测这一段：`IconButton` 要构造 Pixi 对象，而 Pixi v8 在
 * jsdom 里不好跑。但"可点区域算得对不对"恰恰是最容易错、也最值得
 * 测的地方 —— 算错的症状是"看起来在按钮里却点不到"，
 * 在截图里完全看不出来。
 */

describe('图标按钮：可点区域', () => {
  it('只有图标时，盒子就是图标大小（外加文字的呼吸空间）', () => {
    const box = computeContentBox({ size: 20, anchor: { x: 100, y: 100 } });
    // 内容高度取 max(size, small+4, body+4)
    expect(box.h).toBe(Math.max(20, FONT.small + 4, FONT.body + 4));
    // 宽度只算图标
    expect(box.w).toBe(20);
    // 居中在锚点上
    expect(box.x + box.w / 2).toBeCloseTo(100, 0);
    expect(box.y + box.h / 2).toBeCloseTo(100, 0);
  });

  it('【关键】带快捷键提示时，盒子把提示一起框进去', () => {
    /**
     * 这是最容易错的一条：如果盒子只按图标算，键位提示就会
     * 落在可点区域之外 —— 玩家点"按键提示"没有反应。
     */
    const iconOnly = computeContentBox({ size: 20, anchor: { x: 100, y: 100 } });
    const withHint = computeContentBox({
      size: 20,
      shortcut: ',',
      anchor: { x: 100, y: 100 },
    });
    expect(withHint.w).toBeGreaterThan(iconOnly.w);
    // 增量应当就是提示宽度 + 一个间隙
    expect(withHint.w - iconOnly.w).toBe(estimateMonoWidth(',', FONT.small) + 4);
  });

  it('提示在左时图标右移；提示在右时图标在左', () => {
    const left = computeContentBox({ size: 20, shortcut: ',', hintSide: 'left', anchor: { x: 0, y: 0 } });
    const right = computeContentBox({ size: 20, shortcut: ',', hintSide: 'right', anchor: { x: 0, y: 0 } });
    expect(left.iconX).toBeGreaterThan(right.iconX);
    // 两种情况下图标都在盒子内
    for (const b of [left, right]) {
      expect(b.iconX).toBeGreaterThanOrEqual(b.x);
      expect(b.iconX + 20).toBeLessThanOrEqual(b.x + b.w);
    }
  });

  it('图标在盒内垂直居中', () => {
    const box = computeContentBox({ size: 20, shortcut: ',', anchor: { x: 0, y: 0 } });
    expect(box.iconY + 10).toBe(box.y + box.h / 2);
  });

  it('给了 rect 就完全按 rect（战斗 HUD 需要精确占位）', () => {
    const rect = { x: 700, y: 400, w: 120, h: 30 };
    const box = computeContentBox({ size: 20, shortcut: ',', rect });
    expect({ x: box.x, y: box.y, w: box.w, h: box.h }).toEqual(rect);
  });

  it('多个元素之间的间隙只算 n-1 个（不能多算）', () => {
    const iconOnly = computeContentBox({ size: 20, anchor: { x: 0, y: 0 } });
    const iconAndLabel = computeContentBox({ size: 20, label: '设置', anchor: { x: 0, y: 0 } });
    // 1 个元素 → 0 个间隙；2 个元素 → 1 个间隙
    expect(iconAndLabel.w - iconOnly.w).toBe(estimateMonoWidth('设置', FONT.body) + 4);
  });
});

describe('宽度估算（宁宽勿窄）', () => {
  it('单调递增：字多的更宽', () => {
    expect(estimateMonoWidth('ab', 12)).toBeGreaterThan(estimateMonoWidth('a', 12));
  });

  it('【关键】估算值不小于"实际可能宽度"的下界', () => {
    /**
     * 估算必须**偏大**。偏小的后果是提示落到可点区域之外，
     * 而那是"看得见、点不到"这类最难查的问题。
     * 等宽字体每个字符约 0.6em，这里用 0.62 并向上取整。
     */
    for (const text of [',', 'Esc', 'Shift+1', 'F1']) {
      for (const size of [11, 13, 15]) {
        expect(estimateMonoWidth(text, size)).toBeGreaterThanOrEqual(
          Math.ceil(text.length * size * 0.6),
        );
      }
    }
  });

  it('空串不会产生负宽度', () => {
    expect(estimateMonoWidth('', 13)).toBeGreaterThan(0);
  });
});
