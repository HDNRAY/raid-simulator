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

  it('【关键】角标提示**不进**可点区域（它是附注，不是同行元素）', () => {
    /**
     * 这条是"角标"与"并排"的分界：并排时提示占一行、必须框进可点区域
     * （否则点提示没反应）；角标**压在图标自己身上**，它的坐标范围在
     * 图标之内 —— 所以可点区域**只由图标决定**。
     *
     * ⚠️ 老版 `e64eb2d` 就是这么算的（`corner` 模式下 `hintW` 归零）。
     */
    const iconOnly = computeContentBox({ size: 20, anchor: { x: 100, y: 100 } });
    const withHint = computeContentBox({
      size: 20,
      shortcut: 'Esc',
      anchor: { x: 100, y: 100 },
    });
    /** 有无提示，盒子一样大（提示不占布局宽度）。 */
    expect(withHint.w).toBe(iconOnly.w);
    expect(withHint.h).toBe(iconOnly.h);
  });

  it('提示**不改变**图标在盒内的位置（角标不排布）', () => {
    /**
     * 并排摆法里"提示在左 → 图标右移"，角标没有这回事：图标永远在盒内左端，
     * 提示压在它左上角上（落位见 `iconHint.test.ts` / `iconHint.ts`）。
     */
    const iconOnly = computeContentBox({ size: 20, anchor: { x: 100, y: 100 } });
    const withHint = computeContentBox({
      size: 20,
      shortcut: 'Esc',
      anchor: { x: 100, y: 100 },
    });
    expect(withHint.iconX).toBe(iconOnly.iconX);
    expect(withHint.iconY).toBe(iconOnly.iconY);
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
