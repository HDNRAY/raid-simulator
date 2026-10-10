/**
 * 设置弹窗的**共享几何常量**。
 *
 * ==================================================================
 * 为什么单独一个文件（而且必须是**叶子**）
 * ==================================================================
 *
 * `ui/settings/logic.ts`（交互解析）与 `ui/settings/keyGridLayout.ts`
 * （网格几何）**都要**这些常量。如果它们留在 `logic.ts`，就构成循环：
 *
 *   logic.ts        →（要网格几何）→ keyGridLayout.ts
 *   keyGridLayout.ts →（要 KEY_GRID）→ logic.ts
 *
 * ESM 下循环依赖**不报错**，但会让一侧在初始化未完成时读到 `undefined`
 * —— 实测报 `Cannot destructure property 'gapX' of 'KEY_GRID' as it is
 * undefined`（`KEY_GRID_CAPACITY` 是模块级立即求值的，它在 `logic.ts`
 * 的表还没建好时就去读了）。
 *
 * 所以把这些常量**下沉成叶子**：两边都向下依赖它，谁也不再依赖谁。
 * （同一个坑在 `src/data/scale.ts` 上踩过一次，那里也是这个解法。）
 */

import { LOGICAL } from '../layout';

export const SETTINGS_PANEL = {
  w: 640,
  /**
   * 高度按"能放下当前全部技能"定。
   *
   * 演进 400 → 440 → **500**：
   *   440：按键页底部要加一块**选中技能的详情**（说明、代价、CD）
   *   500：详情区那段中文说明在 440 里放不下
   *
   * 500 在画布（540）内仍然放得下（居中后 y 20..520）。
   */
  h: 500,
  /** 居中 */
  get x(): number {
    return Math.round((LOGICAL.width - this.w) / 2);
  },
  get y(): number {
    return Math.round((LOGICAL.height - this.h) / 2);
  },
} as const;

export const KEY_GRID = {
  top: 88,
  cols: 3,
  cellW: 188,
  /**
   * **桌面**单元格高度：44。
   *
   * ⚠️ 56 是被**已经删掉的东西**撑出来的：当初从 44 加到 56 的理由是
   * "在技能名下放一行提示标签"，而那行标签后来被需求删掉了。于是下半截
   * 变成空白 —— 表现就是"行虚高、尺寸不对"。
   *
   * ⚠️ 但触屏**不能**跟着用 44（手指点不准）—— 见 `keyGridLayout` 里
   * `TOUCH_CELL_H` 的说明。
   */
  cellH: 44,
  gapX: 10,
  gapY: 8,
  inset: 16,
} as const;

/**
 * 底部两个元素的位置：**提示文字在上、按钮在下**。
 *
 * 踩过的坑：`RESET_BUTTON.bottom` 曾在容量推导与绘制里各写了一次，
 * 算重了 —— 结果"恢复默认"按钮压在提示文字上。现在只在**这一处**定义。
 */
export const RESET_BUTTON = {
  x: 16,
  w: 96,
  h: 26,
  /**
   * 距弹窗底部。
   *
   * ⚠️ `bottom` 与 `KEY_GRID_CAPACITY` 联动：容量推导会从下往上留出
   * 按钮与提示文字的空间。改这里必须让容量跟着重算（它是推导出来的，
   * 不是写死的行数）。
   */
  bottom: 16,
} as const;

export const HINT_LINE = {
  height: 20,
  /** 与按钮之间的间隙 */
  gap: 8,
} as const;

/**
 * 按键页底部：**选中技能的详情**（四行：名字 / 标签 / 说明 / 代价·冷却）。
 *
 * 位置在格阵之下、提示行之上。⚠️ 网格容量必须**在它之前**停下 ——
 * 见 `keyGridLayout.rowsCapacity` 里踩过的坑。
 */
export const SKILL_DETAIL = {
  x: 16,
  /** 距弹窗顶部的距离 */
  top: 344,
  w: 608,
  /**
   * 四行，行距 **22px**。
   *
   * 22 是**量出来的**：13px 的 `Label` 实测占高 22px（Pixi 的行高远大于
   * 字号）。试过 14 / 15 / 18，三次都叠字。
   */
  h: 80,
} as const;

/** 提示文字行的 y（相对弹窗顶部）。 */
export function hintLineY(): number {
  return (
    SETTINGS_PANEL.h - RESET_BUTTON.bottom - RESET_BUTTON.h - HINT_LINE.gap - HINT_LINE.height
  );
}

/** 底部区域上沿：格子不能越过这条线。 */
export function bottomAreaTop(): number {
  return hintLineY();
}
