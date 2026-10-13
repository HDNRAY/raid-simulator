/**
 * 按键网格的**几何与容量** —— 现在只是**转发**（实现在 `./settingsScale`）。
 *
 * ==================================================================
 * 为什么它变成了转发层（2026-10-13 加 UI 缩放）
 * ==================================================================
 *
 * 这一轮面板要**响应 UI 缩放**，而缩放后的几何（格阵行高、详情区上下沿、
 * 提示行位置）只能有**一处**实现 —— 否则"画出来的格子"与"能点到的格子"
 * 会错开（本文件的老注释里记着两个真实的坑：`gridRows` 互相调用爆栈、
 * 模块级常量 TDZ / 静默算出 5 行）。
 *
 * 所以整块搬去了 `./settingsScale`（那里的文件头写着缩放模型与钳位规则），
 * 本文件保留**老名字**（`keyGridMetrics` / `rowsCapacity` / `keyGridLayout`
 * 的那几个矩形）转发出去，外部 import 路径不变。
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
 * ⚠️ 上一轮把 `cellH` 从 56 砍到 44 是**按桌面标准**压的。那个结论对
 * 桌面成立，但**不该跟着用在触屏上** —— 触屏要"好点"，不是"紧凑"。
 *
 * ⚠️ **行数由剩余空间推**（不是写死）：早期写死行数，调行高时格子直接
 * 压到「恢复默认」按钮上 —— 那里点下去会命中按钮，玩家以为在改某个技能的
 * 键，实际按了恢复默认。
 */

import {
  detailContentRect,
  detailViewport,
  gridCapacityFor,
  gridBottomFor,
  gridMetricsFor,
  keyCellRect,
  type MetricsRect,
  type ScaledGridMetrics,
} from './settingsScale';

/** 网格度量（形状在 `./settingsScale`）—— `GridMetrics` 是老名字。 */
export type GridMetrics = ScaledGridMetrics;

/**
 * 按模式给出网格度量（**缩放取自当前那份**）。
 *
 * | 模式 | 列 | 容量 | 格高 |
 * |---|---|---|---|
 * | 桌面（显示键名） | 4 | **8** | 44 × k |
 * | 触屏（隐藏键名） | 3 | 6 | 64 × k |
 *
 * ⚠️ 桌面 4 列是为了"一屏配得到每一个可绑技能"（当前 8 个 —— 见
 * `settingsGeometry.KEY_GRID.cols`）；触屏那 6 格对触屏玩家够用：
 * 他们配键位的地方是右下角那 7 个槽位（`TOUCH_PREVIEW`）。
 */
export const keyGridMetrics = gridMetricsFor;

/** 给定度量下网格能放多少个格子（老名字，实现同在 `./settingsScale`）。 */
export const rowsCapacity = gridCapacityFor;

/** 这一套格子**最后一行实际落在哪**（画布坐标）。 */
export const gridBottom = gridBottomFor;

/**
 * 详情区（可滚的那块）在**画布坐标**里的矩形 —— 老名字。
 *
 * ⚠️ 顶边是桌面那套格子的真实下沿（`gridBottom`），底边是提示区上沿；
 * 高度**不能**写死（原来写死 `h: 80`，提示从一行变两行之后就留在原地了）。
 */
export const skillDetailViewport = detailViewport;

/**
 * 详情区**文字那块内框**（外框减掉 `SKILL_DETAIL.padding`）。
 *
 * ⚠️ 折行宽度与可见行数都从**内框**取空间 —— 只在画的时候把字挪 8px 是
 * 治不了的（长行会压到右边框、滚到底时最后一行被裁）。理由整段在
 * `settingsGeometry.SKILL_DETAIL.padding` 里。
 */
export const skillDetailContentRect = detailContentRect;

/** 一格的位置。 */
export { keyCellRect };

/**
 * 桌面那套的容量。
 *
 * ⚠️ 用 `rowsCapacity` 算而不是把同一段公式再写一遍 —— 之前这里与
 * `rowsCapacity` 是**两份重复实现**，改一个忘一个就会漂。
 */
export const KEY_GRID_CAPACITY: number = gridCapacityFor(gridMetricsFor(true));

/** 矩形类型（老名字 `Rect` 在 `./logic`，这里是缩放模块那份）。 */
export type { MetricsRect };
