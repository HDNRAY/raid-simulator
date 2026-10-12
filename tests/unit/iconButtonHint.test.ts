import { describe, expect, it } from 'vitest';
import { ICON_BUTTON_DEFAULTS } from '../../src/ui/IconButton';
import { FONT, LOGICAL } from '../../src/ui/layout';
import {
  BASE_HINT_FONT,
  BASE_ICON_SIZE,
  MIN_HINT_FONT,
  estimateMonoWidth,
  iconHintBoxSize,
  iconHintFontSize,
  iconHintPlacement,
} from '../../src/ui/iconHint';
import { buildFocusContext } from '../../src/ui/settings/panelFocus';
import { keyGridMetrics } from '../../src/ui/settings/keyGridLayout';
import { KEY_GRID, TOUCH_GRID_COLS } from '../../src/ui/settings/settingsGeometry';
import { rowsCapacity } from '../../src/ui/settings/logic';

/**
 * ==================================================================
 * 键位提示的摆法：**角标**（压在图标**左上角**上）
 * ==================================================================
 *
 * 用户 2026-10-13 的原话："**是角标在左上角啊？** 你随便找个【昨天】的版本
 * 都是这样。今天我让你把返回改得跟设置一样之后，就都不对了，**没一次是对的**。"
 *
 * 参照物 = **`e64eb2d`**（昨天最后一个"角标"提交）。它那一版的落位就是
 * **一行**：
 *
 * ```ts
 * // src/ui/IconButton.ts @ e64eb2d
 * return { x: icon.x, y: icon.y, anchorX: 0, anchorY: 0 };
 * ```
 *
 * ⚠️ `41ca468` 那次"恢复历史"挖到了**首个提交**（`d4e3fb7`）的**并排**
 * （`⚙ F1` / `F1 ⚙`），把角标拆了 —— 那是挖错了参照物（用户要的不是它）。
 * 本文件钉的就是改回角标之后的样子。
 */
describe('IconButton：提示是压在图标左上角上的**角标**（一条落位公式）', () => {
  /** 两个真实调用点的图标矩形（尺寸与锚点抄自 `ScreenChrome` 的常量）。 */
  const gear = { x: LOGICAL.width - 8 - 20, y: 8, w: 20, h: 20 };
  const back = { x: 8, y: 8, w: 22, h: 22 };

  const place = (icon: typeof gear) => {
    const hint = iconHintBoxSize('Esc', icon.w);
    return {
      hint,
      p: iconHintPlacement(
        { icon, canvasW: LOGICAL.width, canvasH: LOGICAL.height },
        hint.w,
        hint.h,
      ),
    };
  };

  /** 提示包围盒（锚点是它的左上角，`anchorX/Y = 0`）。 */
  const boxOf = (hint: { w: number; h: number }, p: { x: number; y: number }) => ({
    x: p.x,
    y: p.y,
    right: p.x + hint.w,
    bottom: p.y + hint.h,
  });

  it('【关键】提示的**左上角**就是图标的**左上角**', () => {
    /**
     * ⚠️ 用户 2026-10-13 把规格说死了（原话）："**是角标在左上角啊？**"。
     *
     * 判据不是"两个按钮的绝对坐标相同"（它们在对角，不可能相同），
     * 而是"**同一个公式 + 同一个锚点**"：
     *   - 锚点都是提示的**左上角**（`anchorX = 0` / `anchorY = 0`）
     *   - 提示左缘 = **图标左缘**（`b.x === icon.x`，不是"以图标左缘为中心"）
     *   - 提示上缘 = **图标上缘**（`b.y === icon.y`）
     */
    for (const icon of [gear, back]) {
      const { hint, p } = place(icon);
      const b = boxOf(hint, p);
      const tag = JSON.stringify(icon);
      expect(p.anchorX, tag).toBe(0);
      expect(p.anchorY, tag).toBe(0);
      /** 左对齐图标左缘 —— 这正是"不在正中间"的判据。 */
      expect(b.x, tag).toBe(icon.x);
      /** 上对齐图标上缘 —— 这正是"不在左中"的判据。 */
      expect(b.y, tag).toBe(icon.y);
      /** 提示与图标在同一角：横向交叠必须为正。 */
      expect(Math.min(b.right, icon.x + icon.w) - Math.max(b.x, icon.x), tag).toBeGreaterThan(0);
      /** ⚠️ 且提示**整块落在图标的上半部分**（"贴顶部"而不是"居中"）。 */
      expect(b.bottom, tag).toBeLessThan(icon.y + icon.h / 2);
    }
  });

  it('提示**不按位置换规则**：把图标搬到画布四个角，落位公式不变', () => {
    /**
     * ⚠️ 旧版有个 `'auto'` 会按"按钮在画布哪一半"翻角 —— 用户否掉了
     * （原话："**不用看在哪一半，全局统一风格**"）。这条断言就是那条否决的
     * 回归测试：同样的图标放到画布四个角，**相对自己图标**的落位都不变。
     */
    const atCorners = [
      { ...gear, x: 8, y: 8 },
      { ...gear, x: LOGICAL.width - 30, y: 8 },
      { ...gear, x: 8, y: LOGICAL.height - 30 },
      { ...gear, x: LOGICAL.width - 30, y: LOGICAL.height - 30 },
    ];
    for (const icon of atCorners) {
      const { hint, p } = place(icon);
      const b = boxOf(hint, p);
      const tag = JSON.stringify(icon);
      expect(p.anchorX, tag).toBe(0);
      expect(b.x, tag).toBe(icon.x);
      expect(b.y, tag).toBe(icon.y);
    }
  });

  it('两个真实调用点的提示都**不需要**避让（整块在画布内）', () => {
    /**
     * ⚠️ 这条是"**别再加第二套避让逻辑**"的判据（用户明确否掉避让）。
     * 规则只让提示**往右下方**长，而两个按钮的图标左上角本来就留了 8px
     * 边距 —— 所以整块提示天然落在画布内。
     *
     * ⚠️ 若哪天有人把图标挪到贴边处，这条会先失败 —— 那时候该改的是
     * **布局**（或者去问用户），**不是**在 `iconHintPlacement` 里悄悄加一段
     * 夹取把它推回来（那会让两个按钮看起来又不一样）。
     */
    for (const icon of [gear, back]) {
      const { hint, p } = place(icon);
      const b = boxOf(hint, p);
      const tag = JSON.stringify(icon);
      expect(b.x, tag).toBeGreaterThanOrEqual(0);
      expect(b.y, tag).toBeGreaterThanOrEqual(0);
      expect(b.right, tag).toBeLessThanOrEqual(LOGICAL.width);
      expect(b.bottom, tag).toBeLessThanOrEqual(LOGICAL.height);
    }
  });
});

/**
 * ==================================================================
 * 角标的**两条外观特征**（字号更小 + 描边）—— 值本身也要钉住
 * ==================================================================
 *
 * 用户 2026-10-12 报过"esc 的描边没有让它看起来足够清晰"，`e64eb2d` 的
 * 结论是：**角标必须比并排那版小一圈（9 < 13）且带 3px 黑描边** ——
 * 它**压**在图标浅色笔画上，没有描边会糊成一团。这两条就是"角标"与
 * "并排"在**尺度**上的区别，所以单独钉。
 *
 * ⚠️ 摆法（在左上角、一个公式）在上面那组；这一组管"多大、有没有描边"。
 */
describe('角标：字号比并排小一圈 + 带描边', () => {
  it('基准字号是 **9**（老版 `cornerSize`），不是并排的 `FONT.small`（13）', () => {
    expect(BASE_HINT_FONT).toBe(9);
    expect(BASE_HINT_FONT).toBeLessThan(FONT.small);
    expect(ICON_BUTTON_DEFAULTS.hintFont).toBe(BASE_HINT_FONT);
  });

  it('描边宽度是 **3**（老版 `cornerStroke`），且默认开启', () => {
    expect(ICON_BUTTON_DEFAULTS.cornerStroke).toBe(3);
  });

  it('提示盒子按**角标字号**算宽（不是按 `FONT.small` 估）', () => {
    const box = iconHintBoxSize('F1', BASE_ICON_SIZE);
    expect(box.w).toBe(estimateMonoWidth('F1', BASE_HINT_FONT));
    expect(box.h).toBe(BASE_HINT_FONT);
  });
});

/**
 * ==================================================================
 * 提示整块跟着图标缩放（用户要求，与摆法是两件事）
 * ==================================================================
 *
 * 规格：字号 + 落位跟图标一起缩，而且**一条公式**（只有图标边长一个输入）
 * + **规则给出的下限**。
 */
describe('IconButton：提示随图标缩放（一条公式）', () => {
  /** 图标的实际边长：`chromeBoxAt` / `UiLayout.len` 都是 `round(base × scale)`。 */
  const iconSizeAt = (scale: number) => Math.max(1, Math.round(BASE_ICON_SIZE * scale));

  it('字号按比例放大：0.5 / 1 / 1.5 / 2 四档各不相同', () => {
    const sizes = [0.5, 1, 1.5, 2].map((s) => iconHintFontSize(iconSizeAt(s)));
    expect(sizes[0]).toBeLessThan(sizes[1] as number);
    expect(sizes[1]).toBeLessThan(sizes[2] as number);
    expect(sizes[2]).toBeLessThan(sizes[3] as number);
    /** 1 倍时就是老版角标的 9px（`e64eb2d` 的 `cornerSize`）。 */
    expect(iconHintFontSize(BASE_ICON_SIZE)).toBe(BASE_HINT_FONT);
  });

  it('⚠️ 缩到 0.5 时仍有**规则给出的下限**（不是算完再夹）', () => {
    const font = iconHintFontSize(iconSizeAt(0.5));
    /** 按比例算出来是 5（9 × 0.5 = 4.5 → 5，角标比并排更小、更早触底），下限是 8。 */
    expect(Math.round(BASE_HINT_FONT * 0.5)).toBeLessThan(MIN_HINT_FONT);
    expect(font).toBe(MIN_HINT_FONT);
    /** 而且下限**只在缩放 < 0.9 时生效**：1 倍仍然走 9。 */
    expect(iconHintFontSize(iconSizeAt(1))).toBeGreaterThan(MIN_HINT_FONT);
  });

  it('落位仍然只有一条规则（缩放不改"左上角 = 左上角"）', () => {
    for (const scale of [0.5, 1, 2]) {
      const size = iconSizeAt(scale);
      const icon = { x: LOGICAL.width - 8 - size, y: 8, w: size, h: size };
      const hint = iconHintBoxSize('F1', size);
      const p = iconHintPlacement(
        { icon, canvasW: LOGICAL.width, canvasH: LOGICAL.height },
        hint.w,
        hint.h,
      );
      const tag = `scale=${scale}`;
      expect(p.x, tag).toBe(icon.x);
      expect(p.y, tag).toBe(icon.y);
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
