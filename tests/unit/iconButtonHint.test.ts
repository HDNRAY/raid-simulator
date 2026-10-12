import { describe, expect, it } from 'vitest';
import { ICON_BUTTON_DEFAULTS } from '../../src/ui/IconButton';
import { FONT, LOGICAL } from '../../src/ui/layout';
import {
  BASE_HINT_FONT,
  BASE_ICON_SIZE,
  HINT_GAP,
  MIN_HINT_FONT,
  estimateMonoWidth,
  iconHintBoxSize,
  iconHintFontSize,
  iconHintPlacement,
  iconWithHintSize,
} from '../../src/ui/iconHint';
import { buildFocusContext } from '../../src/ui/settings/panelFocus';
import { keyGridMetrics } from '../../src/ui/settings/keyGridLayout';
import { KEY_GRID, TOUCH_GRID_COLS } from '../../src/ui/settings/settingsGeometry';
import { rowsCapacity } from '../../src/ui/settings/logic';

/**
 * ==================================================================
 * 键位提示的摆法：**并排**（`⚙ F1` / `F1 ⚙`）—— 从历史恢复的那一版
 * ==================================================================
 *
 * 用户 2026-10-12 的原话："设置按钮的 快捷键 **无法找到之前好的那个版本的
 * 位置了吗**？？" —— 他指的是最早那一版（`d4e3fb7` 的 `IconButton`）：
 *
 * ```ts
 * readonly hintSide?: 'left' | 'right';   // 只有这两个值
 * hintSide: 'right' as const;              // 默认
 * // "图标在左、提示在右（阅读顺序）；`hintSide` 可以翻转。"
 * ```
 *
 * 也就是提示与图标**同一行、垂直居中**（不是"角标压在图标角上"）。
 * 中间两轮（`291a005` / `4fa55ef`）把它改成了角标 —— 那是一次**理解错误**
 * （把"快捷键在图标的左上角"读成了"角标"），本文件钉的就是恢复之后的样子。
 *
 * ⚠️ 一侧由**每个按钮自己配**（齿轮 `'left'`、返回 `'right'`），不是运行时
 * 按"按钮在画布哪一半"猜 —— 后者才是被用户否掉的那条。
 */
describe('IconButton：提示与图标**并排**（一条落位公式）', () => {
  /** 两个真实调用点的图标矩形（尺寸与锚点抄自 `ScreenChrome` 的常量）。 */
  const gear = { x: LOGICAL.width - 8 - 20, y: 8, w: 20, h: 20 };
  const back = { x: 8, y: 8, w: 22, h: 22 };

  const place = (icon: typeof gear, side: 'left' | 'right') => {
    const hint = iconHintBoxSize('Esc', icon.w);
    return {
      hint,
      p: iconHintPlacement({
        icon,
        hintW: hint.w,
        hintH: hint.h,
        side,
        canvasW: LOGICAL.width,
        canvasH: LOGICAL.height,
      }),
    };
  };

  /** 提示包围盒（锚点是它的左上角，`anchorX/Y = 0`）。 */
  const boxOf = (hint: { w: number; h: number }, p: { x: number; y: number }) => ({
    x: p.x,
    y: p.y,
    right: p.x + hint.w,
    bottom: p.y + hint.h,
  });

  it('【关键】提示在指定一侧、与图标**同一行**、**垂直居中**', () => {
    for (const [icon, side] of [
      [gear, 'left'],
      [back, 'right'],
    ] as const) {
      const { hint, p } = place(icon, side);
      const b = boxOf(hint, p);
      const tag = `${side} ${JSON.stringify(icon)}`;
      /** 锚点永远是提示的左上角。 */
      expect(p.anchorX, tag).toBe(0);
      expect(p.anchorY, tag).toBe(0);
      /** 垂直居中：提示中心 = 图标中心。 */
      expect(b.y + hint.h / 2, tag).toBeCloseTo(icon.y + icon.h / 2, 6);
      if (side === 'left') {
        /** 提示在左：它的**右缘**贴住图标的**左缘**（间隔 `HINT_GAP`）。 */
        expect(b.right, tag).toBe(icon.x - HINT_GAP);
      } else {
        /** 提示在右：它的**左缘**贴住图标的**右缘**。 */
        expect(b.x, tag).toBe(icon.x + icon.w + HINT_GAP);
      }
    }
  });

  it('提示**不按位置换规则**：同样的图标放到画布四个角，落位公式不变', () => {
    const atCorners = [
      { ...gear, x: 8, y: 8 },
      { ...gear, x: LOGICAL.width - 28, y: 8 },
      { ...gear, x: 8, y: LOGICAL.height - 28 },
      { ...gear, x: LOGICAL.width - 28, y: LOGICAL.height - 28 },
    ];
    for (const icon of atCorners) {
      for (const side of ['left', 'right'] as const) {
        const { hint, p } = place(icon, side);
        const b = boxOf(hint, p);
        const tag = `${side} ${JSON.stringify(icon)}`;
        expect(b.y + hint.h / 2, tag).toBeCloseTo(icon.y + icon.h / 2, 6);
        expect(b.x, tag).toBe(
          side === 'left' ? icon.x - HINT_GAP - hint.w : icon.x + icon.w + HINT_GAP,
        );
      }
    }
  });

  it('⚠️ 落位里**没有夹取**（越界就是越界，由摆图标的规则负责）', () => {
    /**
     * ⚠️ 用户明确否掉了"别再加第二套避让逻辑" —— 所以这里**故意**让一个
     * 贴右缘的图标 + 右侧提示算出画布外，用来钉住"这里不做兜底"这件事。
     * 保证不出界的是**摆图标那条规则**（`chromeBlockBoxAt` 先算整块多大），
     * 见 `screenChrome.test.ts`。
     */
    const icon = { x: LOGICAL.width - 20, y: 8, w: 20, h: 20 };
    const { hint, p } = place(icon, 'right');
    expect(p.x + hint.w).toBeGreaterThan(LOGICAL.width);
  });
});

/**
 * ==================================================================
 * 提示**整块跟着图标缩放**（用户 2026-10-12 的要求，与摆法是两件事）
 * ==================================================================
 *
 * 上一轮"提示故意不缩"的判断被推翻了。规格：字号 + 落位跟图标一起缩，
 * 而且**一条公式**（只有图标边长一个输入）+ **规则给出的下限**。
 */
describe('IconButton：提示随图标缩放（一条公式）', () => {
  /** 图标的实际边长：`chromeBoxAt` / `UiLayout.len` 都是 `round(base × scale)`。 */
  const iconSizeAt = (scale: number) => Math.max(1, Math.round(BASE_ICON_SIZE * scale));

  it('字号按比例放大：0.5 / 1 / 1.5 / 2 四档各不相同', () => {
    const sizes = [0.5, 1, 1.5, 2].map((s) => iconHintFontSize(iconSizeAt(s)));
    expect(sizes[0]).toBeLessThan(sizes[1] as number);
    expect(sizes[1]).toBeLessThan(sizes[2] as number);
    expect(sizes[2]).toBeLessThan(sizes[3] as number);
    /** 1 倍时就是历史那一版的 13px（`FONT.small`）。 */
    expect(iconHintFontSize(BASE_ICON_SIZE)).toBe(BASE_HINT_FONT);
    expect(BASE_HINT_FONT).toBe(FONT.small);
    expect(ICON_BUTTON_DEFAULTS.hintFont).toBe(BASE_HINT_FONT);
  });

  it('⚠️ 缩到 0.5 时仍有**规则给出的下限**（不是算完再夹）', () => {
    const font = iconHintFontSize(iconSizeAt(0.5));
    /** 按比例算出来是 7（13 × 0.5 = 6.5 → 7），而下限是 8。 */
    expect(Math.round(BASE_HINT_FONT * 0.5)).toBeLessThan(MIN_HINT_FONT);
    expect(font).toBe(MIN_HINT_FONT);
    /** 而且下限**只在缩放 < 0.615 时生效**：1 倍仍然走 13。 */
    expect(iconHintFontSize(iconSizeAt(1))).toBeGreaterThan(MIN_HINT_FONT);
  });

  it('整块（图标 + 提示）随缩放变大 —— `ScreenChrome` 靠它反推落位', () => {
    const at = (scale: number) => iconWithHintSize('F1', iconSizeAt(scale));
    expect(at(2).w).toBeGreaterThan(at(1).w);
    expect(at(1).w).toBeGreaterThan(at(0.5).w);
    /** 并排：高度取较大者（1 倍时图标 20 > 提示 13）。 */
    expect(at(1).h).toBe(BASE_ICON_SIZE);
    /** 整块宽 = 图标 + 间隙 + 提示框宽（宁宽勿窄，不会低估出界）。 */
    const box = iconHintBoxSize('F1', iconSizeAt(1));
    expect(at(1).w).toBe(BASE_ICON_SIZE + HINT_GAP + box.w);
    expect(box.w).toBe(estimateMonoWidth('F1', iconHintFontSize(BASE_ICON_SIZE)));
  });

  it('落位仍然只有一条规则（缩放不改"并排 + 垂直居中"）', () => {
    for (const scale of [0.5, 1, 2]) {
      const size = iconSizeAt(scale);
      const icon = { x: LOGICAL.width - 8 - size, y: 8, w: size, h: size };
      const hint = iconHintBoxSize('F1', size);
      const p = iconHintPlacement({
        icon,
        hintW: hint.w,
        hintH: hint.h,
        side: 'left',
        canvasW: LOGICAL.width,
        canvasH: LOGICAL.height,
      });
      const tag = `scale=${scale}`;
      expect(p.x, tag).toBe(icon.x - HINT_GAP - hint.w);
      expect(p.y + hint.h / 2, tag).toBeCloseTo(icon.y + icon.h / 2, 6);
    }
  });
});

/**
 * ==================================================================
 * 焦点上下文：**列数按当前这一屏**、格子数封顶在容量上
 * ==================================================================
 *
 * 这两条各有一次真实的 bug 形态（见 `panelFocus` 文件头）：
 * 触屏按 `↓` 斜着跳、以及"焦点停在画不出来的格子上"。
 */
describe('焦点上下文：列数 / 容量跟着当前这一屏', () => {
  const rows = Array.from({ length: 8 }, (_, i) => `s${i}`);
  const build = (showKeyHints: boolean) =>
    buildFocusContext({
      rows,
      metrics: keyGridMetrics(showKeyHints),
      hasGrid: true,
      hasPicker: false,
      hasMode: false,
      hasSlider: false,
      tabCount: 2,
      selectedSlot: undefined,
    });

  it('桌面：4 列 × 2 行 = 8 格，8 个技能**全部**可聚焦', () => {
    const ctx = build(true);
    expect(ctx.gridCols).toBe(KEY_GRID.cols);
    expect(ctx.cellCount).toBe(8);
    expect(rowsCapacity(keyGridMetrics(true))).toBe(8);
  });

  it('触屏：3 列 6 格 —— 焦点不会走到画不出来的第 7、8 格', () => {
    const ctx = build(false);
    expect(ctx.gridCols).toBe(TOUCH_GRID_COLS);
    expect(ctx.cellCount).toBe(6);
  });

  it('技能比格子多时，cellCount 封顶在容量上（不"对空气改键"）', () => {
    const many = buildFocusContext({
      rows: Array.from({ length: 40 }, (_, i) => `s${i}`),
      metrics: keyGridMetrics(true),
      hasGrid: true,
      hasPicker: false,
      hasMode: false,
      hasSlider: false,
      tabCount: 2,
      selectedSlot: undefined,
    });
    expect(many.cellCount).toBe(rowsCapacity(keyGridMetrics(true)));
  });
});
