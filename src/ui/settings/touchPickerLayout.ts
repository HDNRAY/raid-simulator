/**
 * **触屏技能面**（「按键」页 · 触屏方式）的几何与窗口 —— 画与命中**同一份**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 与 `keyGridLayout.ts` 同一个理由（那次是 `logic.ts` 顶到 700 行）：
 * "这一块画在哪、能放几个"是纯算术，画的人（`TouchSkillPicker`）与
 * 判命中的人（`logic.hitTest`）**必须**用它 —— 各写一遍就会出现
 * "看着能点、点不中"（本仓库为这条踩过不止一次）。
 *
 * ==================================================================
 * ⚠️ 它与键盘格阵是**两个面**（用户："里面的实现有一半都不一样"）
 * ==================================================================
 *
 * 键盘格阵（`KeyGrid` + `keyGridLayout`）是**键盘**那套：显示的是"哪个技能
 * 绑了哪个键"，格子小（44 高，够鼠标点）。
 *
 * 这里是**触屏**那套：格子要手指点得准（≥44 逻辑像素），显示的是"哪些技能
 * 可以放到键位上、已经放在第几个键位"。所以：
 *
 *   - 列数**自己一个常量**（`TOUCH_PICKER_COLS`）—— ⚠️ 不复用
 *     `TOUCH_GRID_COLS`：那个是"触屏**格阵**画几列"（`keyGridMetrics(false)`
 *     的输入），改它会同时改触屏格阵的列宽与容量。两个面是两件事
 *     （用户："里面的实现有一半都不一样"），常量也该各是各的。
 *   - 格子高度按"要放几个技能"算（1~4 行自适应，44~76），而不是钉死在 44
 *   - 位置取左列（键盘格阵与技能详情在触屏方式下都不画，那一列是空的）
 *
 * ⚠️ 共用的三样（parent 定案）：**可选技能池**（调用方给的行表）、
 * **配色表**（`render/slotLook` 那条纪律）、**滚动数学**
 * （`ui/scrollWindow`）。本文件只负责几何，窗口那段直接转调
 * `scrollWindow` —— 不另写一套。
 */

import { SETTINGS_PANEL, TOUCH_PICKER } from './settingsGeometry';
import { scrollOffset, visibleWindow } from '../scrollWindow';
import type { Rect } from './logic';

/** 触屏技能面的列数（**只有这一处**）。 */
export const TOUCH_PICKER_COLS = 3;

/** 技能面最多排几行（再多的技能用窗口滚 —— 见 `pickerWindow`）。 */
export const PICKER_MAX_ROWS = 4;

/** 格子高度的上下限：44 = 手指可点下限，76 = 再高就只是浪费（4 行放不下）。 */
export const PICKER_MIN_CELL_H = 44;
export const PICKER_MAX_CELL_H = 76;

/** 格子间距：与键盘格阵同一套（`KEY_GRID.gapX/gapY` 的值，这里按触屏的密度取小一档）。 */
const GAP_X = 10;
const GAP_Y = 8;

export interface PickerMetrics {
  /** 列数（= `TOUCH_PICKER_COLS`）。 */
  readonly cols: number;
  /** 这一屏画几行。 */
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  /** 第一个格子的左上角（画布坐标）。 */
  readonly x: number;
  readonly y: number;
}

/** 要放 `count` 个技能需要几行（1..`PICKER_MAX_ROWS`）。 */
export function pickerRows(count: number): number {
  const safe = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  return Math.min(PICKER_MAX_ROWS, Math.max(1, Math.ceil(safe / TOUCH_PICKER_COLS)));
}

/** 这一屏最多画几个格子（= 行数上限 × 列数）。 */
export function pickerCapacity(): number {
  return PICKER_MAX_ROWS * TOUCH_PICKER_COLS;
}

/**
 * 给定"要放几个技能"，算出这一屏的格子尺寸。
 *
 * ⚠️ 行数由**技能数**决定（少了不留空行），而格高由**可用高度**反算
 * —— 两者都不是写死的数字：改了 `TOUCH_PICKER` 那块区域，格子自己跟着变。
 * ⚠️ 技能比容量多时（`count > pickerCapacity()`）行数仍然是上限那几行，
 * 于是**布局不会随滚动跳动**（滚动只换内容，不换格子位置）。
 */
export function pickerMetrics(count: number): PickerMetrics {
  const cols = TOUCH_PICKER_COLS;
  const rows = pickerRows(count);
  const availW = TOUCH_PICKER.w - GAP_X * (cols - 1);
  const availH = TOUCH_PICKER.bottom - TOUCH_PICKER.top - GAP_Y * (rows - 1);
  const cellW = Math.floor(availW / cols);
  const cellH = Math.min(
    PICKER_MAX_CELL_H,
    Math.max(PICKER_MIN_CELL_H, Math.floor(availH / rows)),
  );
  return {
    cols,
    rows,
    cellW,
    cellH,
    x: SETTINGS_PANEL.x + TOUCH_PICKER.x,
    y: SETTINGS_PANEL.y + TOUCH_PICKER.top,
  };
}

/**
 * **整块技能面**的矩形（滚轮归属判定用）。
 *
 * ⚠️ 滚轮判定不能用"落在某个格子里"：格子之间有 `GAP_X/GAP_Y` 的缝隙，
 * 指针停在缝上时滚轮会**漏给页面**（表现成"有时候滚得动、有时候不行"）。
 */
export function pickerAreaRect(): Rect {
  return {
    x: SETTINGS_PANEL.x + TOUCH_PICKER.x,
    y: SETTINGS_PANEL.y + TOUCH_PICKER.top,
    w: TOUCH_PICKER.w,
    h: TOUCH_PICKER.bottom - TOUCH_PICKER.top,
  };
}

/** 第 `cellIndex` 个格子（**窗口内**的下标，不是技能表里的下标）。 */

export function pickerCellRect(cellIndex: number, metrics: PickerMetrics): Rect {
  const col = cellIndex % metrics.cols;
  const row = Math.floor(cellIndex / metrics.cols);
  return {
    x: metrics.x + col * (metrics.cellW + GAP_X),
    y: metrics.y + row * (metrics.cellH + GAP_Y),
    w: metrics.cellW,
    h: metrics.cellH,
  };
}

/**
 * 命中：画布坐标落在第几个格子上（窗口内下标；没命中给 `undefined`）。
 *
 * ⚠️ 与 `pickerCellRect` 是**同一份**几何 —— 分开算就会出现错位。
 */
export function pickerCellAt(
  px: number,
  py: number,
  metrics: PickerMetrics,
): number | undefined {
  const cells = metrics.cols * metrics.rows;
  for (let i = 0; i < cells; i += 1) {
    const r = pickerCellRect(i, metrics);
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
  }
  return undefined;
}

/**
 * 可见窗口（从 `offset` 起的 `容量` 个技能）—— **直接走 `scrollWindow`**。
 *
 * ⚠️ 不另写一套 `slice`：滚动数学（到顶到底、内容不足一屏）的边界只有
 * 一处实现（`ui/scrollWindow.ts`），复盘面板 / 技能详情区 / 这里共用。
 */
export function pickerWindow<T>(entries: readonly T[], offset: number): readonly T[] {
  return visibleWindow(entries, offset, pickerCapacity());
}

/** 滚一段之后的偏移（钳在合法范围内 —— 同样只有 `scrollWindow` 那一处）。 */
export function pickerScroll(offset: number, delta: number, count: number): number {
  return scrollOffset(offset, delta, count, pickerCapacity());
}
