/**
 * **可滚内容窗口的数学**（"现在该显示哪一段"）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一段原先长在 `ui/logReview.ts` 里（复盘面板的滚动）。这一轮设置页的
 * **技能详情区**也要滚动（需求："换行呗，然后做类似 overflow scroll 的
 * 效果"），而 AGENTS.md 的纪律是"**不要另发明一套**滚动"——所以把
 * "该显示哪一段"的数学下沉成**叶子模块**，两处共用：
 *
 *   `ui/LogReviewPanel`（整屏战报）→ 一屏 `REVIEW_ROWS` 行
 *   `ui/settings/SkillDetail`（设置页详情区）→ 一屏按像素算出来的行数
 *
 * 两份实现会漂的地方恰恰是**边界**：滚到尽头、内容不足一屏、空内容 ——
 * 那些在一条路径上漏掉时，另一条路径看起来还是好的（本仓库反复踩过）。
 *
 * ⚠️ 这里全是**像素 / 行数**，不认识日志、也不认识技能：`count` 是
 * "内容有多少个单位"，`rows` 是"一屏放几个单位"。调用方决定一个单位
 * 是什么（日志 = 一条，详情区 = 一行文字）。
 *
 * ⚠️ 纯函数、零依赖 —— 能在 node 里精确测。
 */

/**
 * 一屏放几个 —— 非有限值 / 小于 1 时**至少 1**。
 *
 * 调用方给的行数是从高度**算**出来的（`可用高 / 行高`），几何一旦被改小
 * 就可能得到 0 或负数；不兜住的话后面全是 `Infinity` / `NaN`，
 * 表现成"内容凭空消失"。
 */
export function safeRows(rows: number): number {
  if (!Number.isFinite(rows)) return 1;
  return Math.max(1, Math.floor(rows));
}

/**
 * 最大偏移：等于"把头滚出屏幕"。
 *
 * `0` 表示总共不到一屏（没有可滚的）；否则是 `count - 一屏`。
 */
export function maxOffset(count: number, rows: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Math.max(0, safeCount - safeRows(rows));
}

/** 把偏移钳进 `[0, maxOffset]`（非有限值当"滚到底"）。 */
export function clampOffset(offset: number, count: number, rows: number): number {
  const max = maxOffset(count, rows);
  if (!Number.isFinite(offset)) return max;
  return Math.min(max, Math.max(0, Math.floor(offset)));
}

/**
 * 可见的那一段（**从旧到新**，偏移是"第一项的下标"）。
 *
 * ⚠️ `offset` 是"第一条可见条目在数组里的下标"，不是"距末尾多少条" ——
 * 前者才能直接 `slice`，也不会在追加新条目时让画面跳。
 */
export function visibleWindow<T>(entries: readonly T[], offset: number, rows: number): readonly T[] {
  const start = clampOffset(offset, entries.length, rows);
  return entries.slice(start, start + safeRows(rows));
}

/** 滚到最新（"先看最后发生了什么"）。 */
export function tailOffset(count: number, rows: number): number {
  return maxOffset(count, rows);
}

/** 翻页：`delta` 行，**正数 = 往新的翻**（与滚轮向下 / PageDown 一致）。 */
export function scrollOffset(
  offset: number,
  delta: number,
  count: number,
  rows: number,
): number {
  const step = Number.isFinite(delta) ? Math.round(delta) : 0;
  return clampOffset(offset + step, count, rows);
}

/**
 * 翻页一次的步长：**留一行重叠**。
 *
 * 一页正好翻 `rows` 行的话，上一页的最后一行正好落在下一页的视野之外 ——
 * 玩家会觉得"跳了一行"。留一行重叠是分页的通用做法。
 */
export function pageStep(rows: number): number {
  return Math.max(1, safeRows(rows) - 1);
}

/** 当前窗口的条数区间（1 基、闭区间；空内容给 `0-0`）。 */
export interface WindowRange {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

export function windowRange(count: number, rows: number, offset: number): WindowRange {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safeCount === 0) return { from: 0, to: 0, count: 0 };
  const start = clampOffset(offset, safeCount, rows);
  const len = Math.min(safeRows(rows), safeCount - start);
  return { from: start + 1, to: start + len, count: safeCount };
}

/** 滑块位置比例 0..1（`0` = 顶部/最旧，`1` = 底部/最新）。 */
export function scrollFraction(offset: number, count: number, rows: number): number {
  const max = maxOffset(count, rows);
  if (max === 0) return 0;
  return clampOffset(offset, count, rows) / max;
}

/** 滑块长度比例 0..1（内容不足一屏时 = 1，即滑块占满轨道）。 */
export function scrollThumbRatio(count: number, rows: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safeCount <= safeRows(rows)) return 1;
  return safeRows(rows) / safeCount;
}
