/**
 * 按键网格的**几何与容量**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 它原先在 `ui/settings/logic.ts` 里，而那个文件里"几何"（面板/格子/
 * 详情区的位置）与"交互解析"（焦点移动、按键含义）本来就不是一件事。
 * 加进**按模式分两套网格**之后前者变大，`logic.ts` 顶到了 741 行
 * （AGENTS.md §3 上限 700），所以把几何这部分分出来。
 *
 * ==================================================================
 * ⚠️ 为什么按模式分两套（需求："按钮太小了，根本不好点"）
 * ==================================================================
 *
 * 触屏上**键名列是空的**（键名被隐藏了），而格子只有 44px 高 ——
 * 手指点不准。所以触屏换一套：
 *   - **更高**（**64px**，明显大于 44 的可点下限）
 *   - **更宽**（每格摊到 `面板宽 / 3` ≈ 197px；桌面的 188px 是"给键名
 *     留位置"算出来的，键名没了就不必那么窄）
 *
 * ⚠️ **列数仍是 3**，不是 2。2 列时 `2×3 = 6` 格 < 7 个技能 ——
 * 实测「闪」那一格被裁掉了。3 列 × 3 行 = **9** 格，够用。
 *
 *
 * ⚠️ 上一轮把 `cellH` 从 56 砍到 44 是**按桌面标准**压的。那个结论对
 * 桌面成立，但**不该跟着用在触屏上** —— 触屏要"好点"，不是"紧凑"。
 */

import { SETTINGS_PANEL, KEY_GRID, SKILL_DETAIL, bottomAreaTop } from './settingsGeometry';
/**
 * ⚠️ `Rect` 只是**类型**，从 `./logic` 取没问题（类型在编译期擦除，
 * 不参与运行期初始化顺序）。而常量必须从叶子 `./settingsGeometry` 取 ——
 * 从 `./logic` 取会构成循环依赖（实测报 `KEY_GRID is undefined`）。
 */
import type { Rect } from './logic';

/**
 * 触屏格子的高度。
 *
 * 64 而不是 44：手指的可点区下限约 44px，而格子还要容纳
 * `FONT.warn`(20px) 的技能字 + 上下留白，64 才不显得挤。
 */
const TOUCH_CELL_H = 64;

/** 网格度量（桌面 / 触屏两套）。 */
export interface GridMetrics {
  readonly cols: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly gapX: number;
  readonly gapY: number;
  readonly inset: number;
  readonly top: number;
}

/**
 * 按模式给出网格度量。
 *
 * @param showKeyHints 桌面为 `true`（要显示键名），触屏为 `false`。
 */
export function keyGridMetrics(showKeyHints: boolean): GridMetrics {
  const { gapX, gapY, inset, top } = KEY_GRID;
  if (showKeyHints) {
    return {
      cols: KEY_GRID.cols,
      cellW: KEY_GRID.cellW,
      cellH: KEY_GRID.cellH,
      gapX,
      gapY,
      inset,
      top,
    };
  }
  const cols = KEY_GRID.cols;
  const cellW = Math.floor(
    (SETTINGS_PANEL.w - inset * 2 - gapX * (cols - 1)) / cols,
  );
  return { cols, cellW, cellH: TOUCH_CELL_H, gapX, gapY, inset, top };
}

/**
 * 给定度量下网格能放多少个格子 —— **由剩余空间推导，不是写死的**。
 *
 * 踩过的坑：早期写死行数，后来调整行高就直接压到了"恢复默认"按钮上
 * —— 那里点下去会命中按钮，玩家以为在改某个技能的键，实际按了恢复默认。
 * 现在从下往上留出按钮与提示文字的空间，剩下的高度才给格子用。
 */
export function rowsCapacity(metrics: GridMetrics): number {
  /**
   * ⚠️ **不能越过详情区**（`SKILL_DETAIL.top`）。
   *
   * 踩过的坑：原来只减到底部的"恢复默认"按钮位置，而**详情区在
   * `y 344`** —— 触屏换成 2 列大格后第 4 行落在 `y 304..368`，
   * 正好压在详情区的技能名上（实测截图里"攻"字盖住了「闪」那一格）。
   *
   * 桌面那套格子矮（44），4 行只到 `y 296`，所以没暴露这个问题。
   */
  const usable = Math.min(bottomAreaTop(), SKILL_DETAIL.top) - metrics.top - 6;
  const rows = Math.max(
    1,
    Math.floor((usable + metrics.gapY) / (metrics.cellH + metrics.gapY)),
  );
  return rows * metrics.cols;
}

/**
 * 一格的位置。
 *
 * ⚠️ 默认参数是**桌面**那套（`keyGridMetrics(true)`）—— 老的调用点
 * 与测试都按这个语义写的。触屏调用点显式传度量。
 */
export function keyCellRect(
  index: number,
  metrics: GridMetrics = keyGridMetrics(true),
): Rect {
  const col = index % metrics.cols;
  const row = Math.floor(index / metrics.cols);
  return {
    x: SETTINGS_PANEL.x + metrics.inset + col * (metrics.cellW + metrics.gapX),
    y: SETTINGS_PANEL.y + metrics.top + row * (metrics.cellH + metrics.gapY),
    w: metrics.cellW,
    h: metrics.cellH,
  };
}

/**
 * 桌面那套的容量。
 *
 * ⚠️ 用 `rowsCapacity` 算而不是把同一段公式再写一遍 —— 之前这里与
 * `rowsCapacity` 是**两份重复实现**，改一个忘一个就会漂。
 */
export const KEY_GRID_CAPACITY: number = rowsCapacity(keyGridMetrics(true));
