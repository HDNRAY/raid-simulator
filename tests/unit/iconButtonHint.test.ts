import { describe, expect, it } from 'vitest';
import {
  ICON_BUTTON_DEFAULTS,
  estimateMonoWidth,
  iconHintPlacement,
  type IconHintInput,
} from '../../src/ui/IconButton';
import { LOGICAL } from '../../src/ui/layout';
import { buildFocusContext } from '../../src/ui/settings/panelFocus';
import { keyGridMetrics } from '../../src/ui/settings/keyGridLayout';
import { KEY_GRID, TOUCH_GRID_COLS } from '../../src/ui/settings/settingsGeometry';
import { rowsCapacity } from '../../src/ui/settings/logic';

/**
 * ==================================================================
 * 角落提示的**落位是推出来的**（不是手调偏移）
 * ==================================================================
 *
 * 这一条说的是需求："返回按钮应该和设置按钮用同样的组件，保证 Esc 在
 * 左上" —— 而"提示贴自己那一侧、又不被画布边裁掉"这件事必须**算出来**。
 *
 * ⚠️ 旧版是 `hintOffset: { dx: 34, dy: 22 }`（返回按钮专供）。那个参数
 * 已删：它存在的唯一理由就是补"两个角落两套算法"这个不该存在的差异。
 * 这里钉住的正是"删掉它之后两边仍然各自贴自己那一侧"。
 */
describe('IconButton：角落提示的位置由图标位置推出来', () => {
  /** 两个真实调用点的图标矩形（尺寸与锚点抄自组件自己的常量）。 */
  const gear = { x: LOGICAL.width - 8 - 44 / 2 - 20 / 2, y: 8 + 44 / 2 - 20 / 2, w: 20, h: 20 };
  const back = { x: 8, y: 8, w: 22, h: 22 };

  const hintW = estimateMonoWidth('Esc', ICON_BUTTON_DEFAULTS.cornerSize);
  const hintH = ICON_BUTTON_DEFAULTS.cornerSize;

  const place = (icon: typeof gear, corner: IconHintInput['corner'] = 'auto') =>
    iconHintPlacement({ icon, canvasW: LOGICAL.width, canvasH: LOGICAL.height, corner }, hintW, hintH);

  /** 提示包围盒（`anchorX = 1` 时锚点是它的右缘）。 */
  const boxOf = (p: ReturnType<typeof place>) => ({
    x: p.anchorX === 1 ? p.x - hintW : p.x,
    y: p.y,
    right: p.anchorX === 1 ? p.x : p.x + hintW,
    bottom: p.y + hintH,
  });

  it('【关键】右上角的齿轮 → 提示贴它的**左上角**（往左展开）', () => {
    const p = place(gear);
    expect(p.anchorX).toBe(1);
    const b = boxOf(p);
    // 提示在图标左缘附近（压住它一小块），而不是跑到图标右边去
    expect(b.x).toBeLessThan(gear.x + gear.w);
    expect(b.right).toBeGreaterThan(gear.x);
    expect(b.x).toBeGreaterThanOrEqual(0);
  });

  it('【关键】左上角的返回箭头 → 提示贴它的**右上角**（往右展开）', () => {
    const p = place(back);
    expect(p.anchorX).toBe(0);
    const b = boxOf(p);
    // 提示在图标右缘附近（往画布内侧展开），而不是伸到画布外
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(LOGICAL.width);
    expect(b.x).toBeLessThan(back.x + back.w);
  });

  it('两边的提示都在画布内（含描边的余量），且都**不在**自己外侧', () => {
    for (const icon of [gear, back]) {
      const b = boxOf(place(icon));
      expect(b.x, JSON.stringify(icon)).toBeGreaterThanOrEqual(0);
      expect(b.y, JSON.stringify(icon)).toBeGreaterThanOrEqual(0);
      expect(b.right, JSON.stringify(icon)).toBeLessThanOrEqual(LOGICAL.width);
      expect(b.bottom, JSON.stringify(icon)).toBeLessThanOrEqual(LOGICAL.height);
    }
  });

  it('"贴哪一侧"是**算出来的**：同一个图标换到画布另一半，提示就翻过去', () => {
    /**
     * ⚠️ 这条正是"不许写死两个常量"的判据：把齿轮放到左上角，
     * `'auto'` 必须给它 `top-right`；把箭头放到右上角，必须给 `top-left`。
     */
    const gearTopLeft = { ...gear, x: 8 };
    expect(place(gearTopLeft).anchorX).toBe(0);
    const backTopRight = { ...back, x: LOGICAL.width - 30 };
    expect(place(backTopRight).anchorX).toBe(1);
  });

  it('显式给角就是那个角（不做二次翻转）', () => {
    expect(place(gear, 'top-left').anchorX).toBe(1);
    expect(place(gear, 'top-right').anchorX).toBe(0);
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
