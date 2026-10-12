/**
 * **从"这一页有什么"推出焦点模型要的上下文**（`FocusContext`）。
 *
 * ==================================================================
 * 为什么单独一个文件（而不是留在 `SettingsPanel` 里）
 * ==================================================================
 *
 * 这段算术有三个容易写错的点，而且**每一条都有过真实的 bug 形态**：
 *
 *   1. **列数必须按当前那一屏** —— 桌面 4 列、触屏 3 列
 *      （`KEY_GRID.cols` / `TOUCH_GRID_COLS`）。用桌面常量会让触屏的
 *      `↓` **斜着跳**：焦点落到旁边一列上。
 *   2. **格子数要封顶在容量上** —— 技能比格子多时，焦点不该走到
 *      **画不出来**的格子上，否则按 `Enter` 会"对空气改键"。
 *   3. **行数由容量除列数得到** —— 它就是"这一屏画得出来几行"，
 *      与 `keyGridMetrics` 是**同一份度量**算出来的。
 *
 * 三者都是纯算术，所以搬出来能在 node 里直接测（`panelFocus.test.ts`）——
 * 留在那个已经贴着 700 行的 Pixi 组件里，就只能靠"看截图猜"。
 *
 * ⚠️ `SettingsPanel` 现在这样调它：`buildFocusContext({ rows: ..., metrics:
 * keyGridMetrics(showKeyHintsNow), selectedSlot: ... })`。**列数与容量只有
 * 一处来源**（`keyGridMetrics`），本文件不再自己推一遍。
 */

import type { GridMetrics } from './keyGridLayout';
import { rowsCapacity } from './keyGridLayout';
import type { FocusContext, SettingsFocus } from './focus';
import { pickerCapacity, TOUCH_PICKER_COLS } from './touchPickerLayout';
import { TOUCH_BUTTON_CAPACITY } from '../../render/touchGeometry';

export interface FocusContextInput {
  /** 技能表（顺序 = 格子顺序）。 */
  readonly rows: readonly unknown[];
  /** **当前这一屏**的网格度量（键盘方式下 = `keyGridMetrics(showKeyHints)`）。 */
  readonly metrics: GridMetrics;
  /**
   * 这一页有没有**键盘**技能格（键盘方式 + 「按键」页）。
   *
   * ⚠️ 与 `hasPicker` **互斥**：两块按操作方式各显示一块（用户："键盘
   * 不显示右下角的那个"、"里面的实现有一半都不一样"）。
   */
  readonly hasGrid: boolean;
  /** 这一页有没有**触屏**技能面 + 键位预览（触屏方式 + 「按键」页）。 */
  readonly hasPicker: boolean;
  readonly hasSlider: boolean;
  /** 有没有操作方式选择器（「通用」页）。 */
  readonly hasMode: boolean;
  readonly tabCount: number;
  /** 已选中的键位（没有则 `undefined`）。 */
  readonly selectedSlot: number | undefined;
}

/**
 * 焦点模型的上下文。
 *
 * ⚠️ `cellCount` 取 `min(技能数, 容量)`：**容量**是"这一屏画得出来几格"
 * —— 焦点与命中测试都必须用它，否则会出现"能聚焦但看不见"那一格。
 *
 * ⚠️ 触屏那两块（`slots` / `picker` / `touchReset`）**只在触屏方式**下进
 * 上下文：它们与键盘块是互斥的（见 `FocusContextInput.hasGrid`）。
 * 触屏技能面的可聚焦格数同理封顶在**窗口容量**上（`pickerCapacity()`）——
 * 与 `cellCount` 是同一条纪律："焦点不落在画不出来的东西上"。
 */
export function buildFocusContext(input: FocusContextInput): FocusContext {
  const capacity = rowsCapacity(input.metrics);
  const picker = input.hasPicker;
  return {
    tabCount: input.tabCount,
    cellCount: Math.min(input.rows.length, capacity),
    hasGrid: input.hasGrid,
    hasSlider: input.hasSlider,
    /** 键位区与技能面同属**触屏块**（一起出现、一起消失）。 */
    hasSlots: picker,
    hasPicker: picker,
    hasMode: input.hasMode,
    /** 两块各自那一个「恢复默认」—— 它跟着块走，不跟设备走。 */
    hasReset: input.hasGrid,
    hasTouchReset: picker,
    pickerCount: Math.min(input.rows.length, pickerCapacity()),
    pickerCols: TOUCH_PICKER_COLS,
    slotIndex: input.selectedSlot ?? 0,
    gridCols: input.metrics.cols,
    gridRows: Math.max(1, Math.ceil(capacity / input.metrics.cols)),
  };
}

/**
 * **焦点换家**：切页 / 切操作方式之后，把停留在一个**已经不存在**的区上的
 * 焦点挪到一个存在的区。
 *
 * ==================================================================
 * 为什么必须有它（两个真实的 bug 形态）
 * ==================================================================
 *
 *   1. **从首页打开设置**只剩「通用」页，而 `INITIAL_FOCUS` 是"第一个技能格"
 *      —— 不挪走的话，在首页按 `Enter` 会对一个**看不见的**技能开始改键
 *      （界面像死了）。
 *   2. **切换操作方式**时两块互换：焦点可能停在 `grid`（键盘块）而现在是
 *      触屏方式 —— 那时它指向一个不存在的区，方向键与 `Enter` 全都没有反应。
 *
 * ⚠️ 回落的顺序是"这一页最像主体的那一块"：技能格 → 键位区 → 滑块 →
 * 操作方式 → tab 行。
 */
export function rehomeFocus(focus: SettingsFocus, ctx: FocusContext): SettingsFocus {
  /**
   * ⚠️ 带下标的两个区还要**钳下标**：换角色之后技能表可能变短 ——
   * 焦点停在一个画不出来的格子上时，详情区会是空的、`Enter` 会"对空气改键"。
   */
  if (focus.zone === 'grid' && ctx.hasGrid && focus.index >= ctx.cellCount) {
    return { zone: 'grid', index: Math.max(0, ctx.cellCount - 1) };
  }
  if (focus.zone === 'picker' && ctx.hasPicker && focus.index >= ctx.pickerCount) {
    return { zone: 'picker', index: Math.max(0, ctx.pickerCount - 1) };
  }
  if (zoneExists(focus.zone, ctx)) return focus;

  if (ctx.hasGrid && ctx.cellCount > 0) {
    const index = focus.zone === 'grid' ? Math.min(focus.index, ctx.cellCount - 1) : 0;
    return { zone: 'grid', index };
  }
  /**
   * ⚠️ 触屏那套的**主体是键位区**（两步交互的第一步），不是技能面 ——
   * 所以优先落到 `slots`（而且 `moveFocus` 的 `slots.up` 正好回到技能面）。
   */
  if (ctx.hasSlots) {
    const index = Math.max(0, Math.min(ctx.slotIndex, TOUCH_BUTTON_CAPACITY - 1));
    return { zone: 'slots', index };
  }
  if (ctx.hasPicker) return { zone: 'picker', index: 0 };
  if (ctx.hasSlider) return { zone: 'slider' };
  if (ctx.hasMode) return { zone: 'mode', index: 0 };
  return { zone: 'tabs', index: 0 };
}

/** 这个焦点区在**当前这一页 / 这种方式**下存不存在。 */
function zoneExists(zone: SettingsFocus['zone'], ctx: FocusContext): boolean {
  switch (zone) {
    case 'grid':
      return ctx.hasGrid && ctx.cellCount > 0;
    case 'picker':
      return ctx.hasPicker;
    case 'slots':
      return ctx.hasSlots;
    case 'reset':
      return ctx.hasReset;
    case 'touchReset':
      return ctx.hasTouchReset;
    case 'slider':
      return ctx.hasSlider;
    case 'mode':
      return ctx.hasMode;
    /** tab 行与「关闭」永远在（外框自己的一行）。 */
    case 'tabs':
    case 'close':
      return true;
  }
}
