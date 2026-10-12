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
 * ⚠️ 上一轮把 `cellH` 从 56 砍到 44 是**按桌面标准**压的。那个结论对
 * 桌面成立，但**不该跟着用在触屏上** —— 触屏要"好点"，不是"紧凑"。
 *
 * ==================================================================
 * ⚠️ 推导只有**一层**（踩过两种"自己咬自己"）
 * ==================================================================
 *
 *   `./settingsGeometry` 的常量（面板高 / 格阵下沿 `KEY_GRID_BOTTOM` /
 *   详情区底边 `DETAIL_BOTTOM`）
 *     → `gridRows()`（这一套度量能放几行）
 *       → `rowsCapacity()` / `gridBottom()` / `skillDetailViewport()`
 *
 * 踩过的两个坑，写在这里免得下一个人重犯：
 *
 *   1. **互相调用**：初版让 `gridRows` 问"详情区顶边"、而"顶边"又回问
 *      `gridRows` —— 实测 `RangeError: Maximum call stack size exceeded`。
 *   2. **模块级常量 TDZ / 静默算错**：初版把"格阵下沿"由 `gridRows`
 *      反推成常量、又让 `gridRows` 去读它 —— 实测
 *      `Cannot access 'KEY_GRID_BOTTOM' before initialization`；换成
 *      "函数版"之后还静默算出过 **5 行**（详情区只剩 26px）。
 *
 * 现在 `KEY_GRID_BOTTOM` 是 `settingsGeometry` 里的**显式常量**，本文件
 * 只**读**它，不再反推。
 */

import {
  SETTINGS_PANEL,
  KEY_GRID,
  TOUCH_CELL_H,
  TOUCH_GRID_COLS,
  KEY_GRID_BOTTOM,
  KEY_GRID_BOTTOM_TOUCH,
  DETAIL_TOP,
  DETAIL_BOTTOM,
  SKILL_DETAIL,
} from './settingsGeometry';
/**
 * ⚠️ `Rect` 只是**类型**，从 `./logic` 取没问题（类型在编译期擦除，
 * 不参与运行期初始化顺序）。而常量必须从叶子 `./settingsGeometry` 取 ——
 * 从 `./logic` 取会构成循环依赖（实测报 `KEY_GRID is undefined`）。
 */
import type { Rect } from './logic';

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
 * | 模式 | 列 | 行 | 容量 | 格高 |
 * |---|---|---|---|---|
 * | 桌面（显示键名） | 4 | 2 | **8** | 44 |
 * | 触屏（隐藏键名） | 3 | 2 | 6 | 64 |
 *
 * ⚠️ 桌面 4 列是为了"一屏配得到每一个可绑技能"（当前 8 个 —— 见
 * `settingsGeometry.KEY_GRID.cols`）；触屏那 6 格对触屏玩家够用：
 * 他们配键位的地方是右下角那 7 个槽位（`TOUCH_PREVIEW`）。
 *
 * ⚠️ **格子宽度一律从面板宽度算**（`面板宽 - 两侧内缩 - 列间隙`），
 * 不写死：写死的话改列数时两处必然漂（"画出来的格子"与"能点到的格子"
 * 错开正是本仓库踩过的坑，见 `settings.test.ts` 那条命中回归）。
 * `KEY_GRID.cellW` 只作为**桌面度量的默认值**（供 `keyCellRect` 的默认参数
 * 与几何断言引用），不参与这里的分支。
 *
 * @param showKeyHints 桌面为 `true`（要显示键名），触屏为 `false`。
 */
export function keyGridMetrics(showKeyHints: boolean): GridMetrics {
  const { gapX, gapY, inset, top } = KEY_GRID;
  const cols = showKeyHints ? KEY_GRID.cols : TOUCH_GRID_COLS;
  const cellW = Math.floor(
    (SETTINGS_PANEL.w - inset * 2 - gapX * (cols - 1)) / cols,
  );
  return {
    cols,
    cellW,
    cellH: showKeyHints ? KEY_GRID.cellH : TOUCH_CELL_H,
    gapX,
    gapY,
    inset,
    top,
  };
}

/**
 * 这一套度量**放得下几行** —— 由剩余空间推导，不是写死的。
 *
 * 可用高度 = `KEY_GRID_BOTTOM`（面板相对的上沿）- `top`
 *
 * 踩过的坑：早期写死行数，后来调整行高就直接压到了"恢复默认"按钮上
 * —— 那里点下去会命中按钮，玩家以为在改某个技能的键，实际按了恢复默认。
 *
 * ⚠️ 上沿是 `KEY_GRID_BOTTOM`（**桌面**那两行的下沿）—— 它同时是详情区的
 * 顶边，所以"格阵能长到哪"与"详情区从哪儿开始"是**同一个数**（原先分成
 * `SKILL_DETAIL.top` 与 `bottomAreaTop()` 两份，加了第二行提示之后立刻漂）。
 *
 * ⚠️ 触屏那套格子更高（64），所以它自己算出来的行数更少 —— 这正是要的：
 * 它的行**不会**越过同一条上沿。**不能**把上沿换成触屏自己的下沿，否则
 * 桌面那两行格子就压到详情区上了。
 */
function gridRows(metrics: GridMetrics): number {
  /**
   * 上沿按**这一套度量**选：桌面用 `KEY_GRID_BOTTOM`，触屏用
   * `KEY_GRID_BOTTOM_TOUCH`（两者行高不同 → 能放的行数不同）。
   *
   * ⚠️ 判据是 `metrics.cellH`（44 = 桌面、64 = 触屏），与
   * `keyGridMetrics` 是**同一处**决定的 —— 不必再传一个"是不是触屏"的
   * 布尔，那样就会出现"两处对触屏的定义"。
   */
  const bottom = metrics.cellH === KEY_GRID.cellH ? KEY_GRID_BOTTOM : KEY_GRID_BOTTOM_TOUCH;
  const usable = bottom - metrics.top;
  return Math.max(
    1,
    Math.floor((usable + metrics.gapY) / (metrics.cellH + metrics.gapY)),
  );
}

/**
 * 给定度量下网格能放多少个格子。
 */
export function rowsCapacity(metrics: GridMetrics): number {
  return gridRows(metrics) * metrics.cols;
}

/**
 * 这一套格子**最后一行实际落在哪**（画布坐标）—— 也就是"详情区从哪儿
 * 开始"。
 *
 * ⚠️ 它从 `gridRows` 反推（而不是直接用 `KEY_GRID_BOTTOM`）：格子放不满
 * 整数行时，最后一行的下沿离上限还差一截，详情区应当**贴着格子的真实
 * 下沿**，否则两者之间会留出一条看不出原因的缝。
 */
export function gridBottom(metrics: GridMetrics = keyGridMetrics(true)): number {
  const rows = gridRows(metrics);
  return SETTINGS_PANEL.y + metrics.top + rows * metrics.cellH + (rows - 1) * metrics.gapY;
}

/**
 * 详情区（可滚的那块）在**画布坐标**里的矩形。
 *
 * ==================================================================
 * ⚠️ 它是"详情区该滚不该滚 / 指针该不该由它吃掉"的**唯一**几何判据
 * ==================================================================
 *
 * 顶边 = 桌面那套格子的真实下沿（`gridBottom`），底边 = `DETAIL_BOTTOM`。
 *
 * ⚠️ 高度**不能**写死：详情区原来写死 `h: 80`，这一轮提示从一行变两行、
 * 提示区往上长，写死的那份就留在原地了。现在它是"两条线之间剩多少"。
 *
 * ⚠️ 它跟着**桌面**度量：详情区与键盘格阵是一对。触屏那套格子更高，
 * 但它同样受 `KEY_GRID_BOTTOM` 约束（不会压到详情区）——
 * `tests/unit/settingsTouch.test.ts` 有这条断言。
 */
export function skillDetailViewport(): Rect {
  const top = DETAIL_TOP;
  const bottom = SETTINGS_PANEL.y + DETAIL_BOTTOM;
  return {
    x: SETTINGS_PANEL.x + SKILL_DETAIL.x,
    y: top,
    w: SKILL_DETAIL.w,
    h: bottom - top,
  };
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
