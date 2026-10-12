import { describe, expect, it } from 'vitest';
import { ICON_BUTTON_DEFAULTS, computeContentBox, focusRingRect } from '../../src/ui/IconButton';
import { estimateMonoWidth } from '../../src/ui/iconHint';
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

  it('【关键】同行提示（left/right）要把提示框进可点区域', () => {
    /**
     * 这是最容易错的一条：如果盒子只按图标算，键位提示就会
     * 落在可点区域之外 —— 玩家点"按键提示"没有反应。
     */
    const iconOnly = computeContentBox({ size: 20, anchor: { x: 100, y: 100 } });
    const withHint = computeContentBox({
      size: 20,
      shortcut: ',',
      hintSide: 'right',
      anchor: { x: 100, y: 100 },
    });
    expect(withHint.w).toBeGreaterThan(iconOnly.w);
    expect(withHint.w - iconOnly.w).toBe(estimateMonoWidth(',', FONT.small) + 4);
  });

  it('并排提示**占**布局宽度 —— 它是与图标同一行的元素', () => {
    /**
     * ⚠️ 这条是 2026-10-12 那次"恢复历史版本"的回归：提示从"角标"（不占
     * 布局宽度）改回**并排**（`d4e3fb7` 那版的 `hintSide: 'left' | 'right'`）。
     *
     * 并排时提示当然要占宽度 —— 否则可点区域会短一截、整块宽度也会算小，
     * 于是"把整块摆进画布"那条规则（`chromeBlockBoxAt`）就失去依据。
     */
    const iconOnly = computeContentBox({ size: 20, anchor: { x: 100, y: 100 } });
    const sideBySide = computeContentBox({
      size: 20,
      shortcut: 'Esc',
      hintSide: 'right',
      anchor: { x: 100, y: 100 },
    });
    expect(sideBySide.w).toBeGreaterThan(iconOnly.w);
    expect(sideBySide.w - iconOnly.w).toBeGreaterThan(0);
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

describe('图标按钮：焦点环（不与"选中"撞色的那一半）', () => {
  /**
   * 需求（用户）："设置按钮 有时也会被变黄" —— 齿轮聚焦时被涂成金色，
   * 和"已选中的角色卡"同一个颜色。
   *
   * 修法的另一半（颜色）在 `theme.ts` / `ScreenChrome.ts`，这里测**形状**：
   * 焦点环必须（a）包住图标、（b）比图标大一圈、（c）外扩量足够小，
   * 不至于碰到旁边的东西。
   */
  it('环包住图标，且比图标大一圈（pad 在左右两侧都要算）', () => {
    const ring = focusRingRect(100, 200, 20);
    const pad = ICON_BUTTON_DEFAULTS.focusRingPad;
    expect(ring.x).toBe(100 - pad);
    expect(ring.y).toBe(200 - pad);
    expect(ring.w).toBe(20 + pad * 2);
    expect(ring.h).toBe(20 + pad * 2);
  });

  it('环是**正方形**且以图标为中心（弧形圆角不会被拉成椭圆）', () => {
    const ring = focusRingRect(0, 0, 24);
    expect(ring.w).toBe(ring.h);
    expect(ring.x + ring.w / 2).toBeCloseTo(12, 5);
    expect(ring.y + ring.h / 2).toBeCloseTo(12, 5);
  });

  it('外扩量不大（战斗 HUD 上方就是 Boss 血条，撑太开会叠上去）', () => {
    expect(ICON_BUTTON_DEFAULTS.focusRingPad).toBeLessThanOrEqual(8);
    expect(ICON_BUTTON_DEFAULTS.focusRingWidth).toBeLessThanOrEqual(3);
  });
});
