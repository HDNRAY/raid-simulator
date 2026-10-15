/**
 * **肉鸽确认屏的几何**（纯几何：两栏 + 「开始战斗」）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏的**唯一一张布局表**：两栏详情区各占哪块地方、栏目标题画在
 * 哪、按钮画在哪 —— 渲染层与命中测试读的是**同一份几何**，所以"看到的
 * 按钮"与"点中的按钮"结构上不可能错位（备战屏那条"文字飘在按钮右边
 * 152px"的账见 `prepareFooter` 文件头）。
 *
 * ==================================================================
 * 纵向预算（算出来的，不是手调的）
 * ==================================================================
 *
 * 画布是死高的 960×540，这一屏的纵向账必须一次算平：
 *
 * ```
 *   ① 标题            中心 56（32px 楷体）
 *   ② 第几场 / 共几场  中心 92
 *   ③ 栏目标题        中心 132（两栏各一行）
 *   ④ 两栏详情面板    144 .. 416
 *   ⑤ 「开始战斗」     446 .. 486
 *   ⑥ 操作提示        中心 508
 * ```
 *
 * ⚠️ 两栏的**宽度**由 `side`（左右留白）与 `gap`（栏间空隙）算出来，
 * 不是各自写一个数：两栏各写一个宽度，改动留白时它们就会一宽一窄
 * （而截图上看起来只是"有点歪"）。
 *
 * ⚠️ 这一屏**没有**素材声明那一行（`PrepareFooter` 的 `notice`）：它是
 * **满屏界面**，声明只在备战屏 / 战斗那一屏画（`RunOverScreen` 同样没有）
 * —— 这里不重复它是**有意**的，不是漏了。
 */

import { LOGICAL } from './layout';
import type { DetailRect } from './prepareDetailMetrics';

/** 这一屏的两栏（左 = 本次出战，右 = 已选炁机）。 */
export type RunConfirmColumn = 'left' | 'right';

export const RUN_CONFIRM_LAYOUT = {
  /** 标题中心 y。 */
  titleY: 56,
  /** 「第 N / M 场」那一行的中心 y。 */
  progressY: 92,
  /** 栏目标题的中心 y 到面板顶边的距离（行框的一半 + 呼吸位）。 */
  columnLabelGap: 20,
  /** 两栏面板的顶边 / 底边。 */
  columnsTop: 144,
  columnsBottom: 416,
  /** 画布左右留白（两栏各自的外侧）。 */
  side: 40,
  /** 两栏之间的空隙。 */
  gap: 40,
  /** 「开始战斗」的尺寸与垂直中心。 */
  startW: 200,
  startH: 40,
  startCenterY: 466,
  /** 操作提示那一行的中心 y。 */
  hintY: 508,
} as const;

/** 一栏的宽度（两栏同宽 —— 只由留白与空隙算出来）。 */
export function runConfirmColumnW(): number {
  return (LOGICAL.width - RUN_CONFIRM_LAYOUT.side * 2 - RUN_CONFIRM_LAYOUT.gap) / 2;
}

/**
 * 某一栏的矩形（也是**详情面板自己的矩形** —— 面板按注入的矩形排版）。
 *
 * ⚠️ 它同时是"点得中哪一栏"的判据来源：两栏的滚动（滚轮 / 拖拽）要按
 * 矩形分派（见 `RunConfirmScreen.isOnDetail`），各写一份必然漂。
 */
export function runConfirmColumnRect(side: RunConfirmColumn): DetailRect {
  const { side: margin, gap, columnsTop, columnsBottom } = RUN_CONFIRM_LAYOUT;
  const w = runConfirmColumnW();
  const x = side === 'left' ? margin : margin + w + gap;
  return { x, y: columnsTop, w, h: columnsBottom - columnsTop };
}

/** 栏目标题那一行的中心 y（在面板**上边**）。 */
export function runConfirmColumnLabelY(): number {
  return RUN_CONFIRM_LAYOUT.columnsTop - RUN_CONFIRM_LAYOUT.columnLabelGap;
}

/** 「开始战斗」的矩形（渲染与命中测试共用）。 */
export function runConfirmStartRect(): DetailRect {
  const { startW, startH, startCenterY } = RUN_CONFIRM_LAYOUT;
  return {
    x: (LOGICAL.width - startW) / 2,
    y: startCenterY - startH / 2,
    w: startW,
    h: startH,
  };
}

/** 「开始战斗」四个字的对齐基准 = 矩形中心（**不是** `LOGICAL.width / 2`）。 */
export function runConfirmStartCenterX(): number {
  const rect = runConfirmStartRect();
  return rect.x + rect.w / 2;
}

/**
 * 这个逻辑点是不是落在**某一栏**里。
 *
 * ⚠️ 它是"滚轮 / 拖拽该滚哪一栏"的**唯一**判据（渲染与命中测试共用同一份
 * 矩形）—— 两栏各写一份范围判断必然漂，而漂的样子是"拖左边滚了右边"。
 */
export function isOnRunConfirmColumn(
  side: RunConfirmColumn,
  px: number,
  py: number,
): boolean {
  const rect = runConfirmColumnRect(side);
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/**
 * 这个逻辑点是不是落在「开始战斗」上。
 *
 * ⚠️ 它**只**回答按钮本身：这一屏没有别的可点物（两栏是只读展示），
 * 而"点击分派"的顺序（齿轮 / 返回箭头先于按钮）在屏幕自己的 `hitTest` 里。
 */
export function isOnRunConfirmStart(px: number, py: number): boolean {
  const rect = runConfirmStartRect();
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}
