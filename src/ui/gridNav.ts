/**
 * **二维网格里的光标移动**（纯数学：行 / 列 → 下一个下标）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它回答一个问题："光标在第 `index` 格，按 ← / → / ↑ / ↓，该去第几格？"
 * —— 只认 `count` / `columns` 两个数，不认识卡片、炁机、Pixi。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * 同一个函数已经有**两份**了：
 *
 *   - `ui/qijiSelectLogic.ts` 的 `moveQijiCursor`（选炁机屏的 2 行卡片）
 *   - `ui/prepareLogic.ts` 的 `cycleCursor`（备战屏的**一维**光标 —— 它只有
 *     ← →，而炁机那一块是 **2 行**的，所以 ↑ ↓ 在那边**没有实现**）
 *
 * 第二份就是用户报的那个 bug 的**形状**（"炁机内部无法用方向键选择"）：
 * 备战屏的 ↑ ↓ 只管"换块"（人物 ↔ 炁机 ↔ 对手），于是炁机摊成两行之后
 * **第一行的卡用 ↑ 永远到不了**（↑ 直接跳到人物那一块去了），
 * 而 ← → 又被"到边界就换块"截断。
 *
 * 所以把"二维网格怎么走"下沉成**叶子模块**（零依赖、可在 node 里精确测），
 * 两处共用。这仍然是 AGENTS.md §2 的"同一件事不许有第二份表达"：
 * **网格数学**只有这一份，`count` / `columns` 由各自的布局给。
 *
 * ⚠️ 与 `ui/scrollWindow.ts` 的分工：那个管"该显示哪一段"，这个管
 * "光标能走到哪一格"。两者都不认识卡片。
 */

/** 四个方向（与键盘的 ← → ↑ ↓ 一一对应）。 */
export type GridDirection = 'left' | 'right' | 'up' | 'down';

/**
 * 网格的形状。
 *
 * `columns` 是**这一帧实际用了几列**（不是布局表里那个上限）：张数少于
 * 列数时网格会自己收窄（3 张卡不会摊在 5 列里），而"那一行有几个"决定
 * ← → 的边界。
 */
export interface GridShape {
  readonly count: number;
  readonly columns: number;
}

/** 把列数收进 `1..max(count, 1)`（张数为 0 时给 1，调用方自己判空）。 */
export function gridColumns(count: number, columns: number): number {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const c = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  return n === 0 ? 1 : Math.max(1, Math.min(c, n));
}

/** 这个网格摊成几行（`count = 0` 时 0）。 */
export function gridRows(count: number, columns: number): number {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return 0;
  return Math.ceil(n / gridColumns(n, columns));
}

/** 下标落在第几行 / 第几列（越界时钳进网格）。 */
export function gridCell(
  index: number,
  count: number,
  columns: number,
): { readonly row: number; readonly col: number } {
  const cols = gridColumns(count, columns);
  const at = Math.min(Math.max(0, Math.trunc(index) || 0), Math.max(0, count - 1));
  return { row: Math.floor(at / cols), col: at % cols };
}

/** 第 `row` 行 / 第 `col` 列那一格的下标；那一格不存在时 `undefined`。 */
export function gridIndexOf(
  row: number,
  col: number,
  count: number,
  columns: number,
): number | undefined {
  const cols = gridColumns(count, columns);
  if (row < 0 || col < 0 || col >= cols) return undefined;
  const index = row * cols + col;
  return index >= 0 && index < count ? index : undefined;
}

/**
 * 移动一格。**到边界停住（不环绕）**。
 *
 * ==================================================================
 * ⚠️ 两个方向用的判据**不一样**（这是有意的）
 * ==================================================================
 *
 * | 方向 | 怎么找下一格 | 为什么 |
 * |---|---|---|
 * | ← → | **同一行内** `±1`，到该行两端停住 | 左右是"行内顺序"，最后一行只有 3 张时不该跳到上一行的第 6 张 |
 * | ↑ ↓ | **同一列** `±1 行`，到该列两端停住 | 上下是"列"，用列对齐才不会"按一下 ↑ 横着跳一格"（这正是 `qijiSelectLogic` 记着的坑） |
 *
 * ⚠️ **到边界停住而不是环绕**（用户 2026-10-13 的原话："炁机内部无法用
 * 方向键选择"—— 他要的是"能选到"，而"按了没反应"与"绕回自己"是同一类
 * 困惑）。跨块**只走 `Tab`**（见 `prepareLogic.moveFocus`）。
 *
 * @param wrap `Tab` 那种"循环"语义（本模块的调用方今天只有"不环绕"，
 *   留着是因为选炁机屏的 `Tab` 走同一份数学）。
 */
export function stepGrid(
  index: number,
  direction: GridDirection,
  shape: GridShape,
  wrap = false,
): number {
  const { count, columns } = shape;
  if (count <= 0) return 0;
  const cols = gridColumns(count, columns);
  const at = Math.min(Math.max(0, Math.trunc(index) || 0), count - 1);
  /**
   * ⚠️⚠️ **正负号由方向决定**（而不是另一个 `delta` 参数）。
   *
   * 第一版收 `(index, delta, direction, …)`，而符号只认 `delta` —— 于是
   * 调用方传 `(0, 1, 'up')` 时它会**往下**走一行（`'up'` 只被当成"竖直"，
   * 方向被 `delta=1` 覆盖了）。这个 bug 在单测里暴露成"↑ 从第一行跳到了
   * 第二行"，而在页面上**看不出来**（↑ 与 ↓ 都会动一格，玩家只会觉得
   * "上下键反了或乱跳"）。
   *
   * 现在没有"两个可以打架的输入"：方向自带符号。
   */
  const step = direction === 'left' || direction === 'up' ? -1 : 1;
  const { row, col } = gridCell(at, count, cols);

  if (direction === 'left' || direction === 'right') {
    const rowStart = row * cols;
    const rowEnd = Math.min(rowStart + cols, count) - 1;
    const size = rowEnd - rowStart + 1;
    if (wrap) return rowStart + (((col + step) % size) + size) % size;
    return Math.min(rowEnd, Math.max(rowStart, at + step));
  }

  const rows = gridRows(count, cols);
  /**
   * 行内第 `col` 格的**下标**；目标行比上面短时**夹到那一行的最后一格**。
   *
   * ⚠️ 为什么是"夹"而不是"没有就停住"：网格的**最后一行常常不满**
   * （8 条炁机 5 列 → 第二行只有 3 张）。若"没有正下方那一格就不动"，
   * 那么第一行第 5 张按 ↓ **毫无反应** —— 而它下面明明还有一行。
   * 玩家看到的是"最右边那一列的下键坏了"（本仓库点名过的"以为按键坏了"）。
   */
  const cellIn = (targetRow: number, wantCol: number): number => {
    const start = targetRow * cols;
    const len = Math.min(cols, count - start);
    return start + Math.min(wantCol, Math.max(0, len - 1));
  };

  if (wrap) {
    const nextRow = (((row + step) % rows) + rows) % rows;
    return cellIn(nextRow, col);
  }
  const nextRow = row + step;
  if (nextRow < 0 || nextRow >= rows) return at;
  return cellIn(nextRow, col);
}

/**
 * 把光标移到某个下标**那一行的正上方 / 正下方**（用于"光标跟随滚动"：
 * 光标换行时要知道视角该不该跟）。
 */
export function rowOf(index: number, count: number, columns: number): number {
  return gridCell(index, count, columns).row;
}
