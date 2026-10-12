import { describe, expect, it } from 'vitest';
import {
  ICON_BUTTON_DEFAULTS,
  estimateMonoWidth,
  iconHintPlacement,
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

  const place = (icon: typeof gear) =>
    iconHintPlacement({ icon, canvasW: LOGICAL.width, canvasH: LOGICAL.height }, hintW, hintH);

  /** 提示包围盒（`anchorX/Y = 0` = 锚点是它的左上角）。 */
  const boxOf = (p: ReturnType<typeof place>) => ({
    x: p.anchorX === 1 ? p.x - hintW : p.x,
    y: p.anchorY === 1 ? p.y - hintH : p.y,
    right: p.anchorX === 1 ? p.x : p.x + hintW,
    bottom: p.anchorY === 1 ? p.y : p.y + hintH,
  });

  it('【关键】一条全局规则：提示的**左上角**就是**图标的左上角**', () => {
    /**
     * ⚠️ 用户 2026-10-12 把规格说死了（原话）："**快捷键在图标的左上角**"。
     *
     * 判据不是"两个按钮的绝对坐标相同"（它们在对角，不可能相同），
     * 而是"**同一个公式 + 同一个锚点**"：
     *   - 锚点都是提示的**左上角**（`anchorX = 0` / `anchorY = 0`）
     *   - 提示左缘 = **图标左缘**（`b.x === icon.x`，不是"以图标左缘为中心"）
     *   - 提示上缘 = **图标上缘**（`b.y === icon.y`）
     *
     * ⚠️ 上一版这里断言的是 `b.y - icon.y === hintOverlap`（上缘比图标低
     * 4px）。那 4px 在 20~22px 的图标上让提示**纵向几乎居中** —— 用户报的
     * 正是"F1 位置不对，现在是**左中**"。那个常量已删，`hintOverlap` 也
     * 不再存在（这条断言本身就是回归测试）。
     */
    for (const icon of [gear, back]) {
      const p = place(icon);
      const b = boxOf(p);
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
     * ⚠️ 旧版有个 `'auto'` 会按"按钮在画布哪一半"翻角 —— 用户否掉了。
     * 这条断言就是那条否决的回归测试：同样的图标放到画布四个角，
     * **相对自己图标**的落位都不变。
     */
    const atCorners = [
      { ...gear, x: 8, y: 8 },
      { ...gear, x: LOGICAL.width - 30, y: 8 },
      { ...gear, x: 8, y: LOGICAL.height - 30 },
      { ...gear, x: LOGICAL.width - 30, y: LOGICAL.height - 30 },
    ];
    for (const icon of atCorners) {
      const p = place(icon);
      const b = boxOf(p);
      const tag = JSON.stringify(icon);
      expect(p.anchorX, tag).toBe(0);
      expect(b.x, tag).toBe(icon.x);
      expect(b.y, tag).toBe(icon.y);
    }
  });

  it('两个真实调用点的提示都**不需要**避让（整块在画布内）', () => {
    /**
     * ⚠️ 这条是"**别再加第二套避让逻辑**"的判据（用户 2026-10-12 明确否掉
     * 避让）。规则只让提示**往右下方**长，而两个按钮的图标左上角本来
     * 就留了 8px 边距 —— 所以整块提示天然落在画布内。
     *
     * ⚠️ 若哪天有人把图标挪到贴边处，这条会先失败 —— 那时候该改的是
     * **布局**（或者去问用户），**不是**在 `iconHintPlacement` 里悄悄加一段
     * 夹取把它推回来（那会让两个按钮看起来又不一样）。
     */
    for (const icon of [gear, back]) {
      const b = boxOf(place(icon));
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
