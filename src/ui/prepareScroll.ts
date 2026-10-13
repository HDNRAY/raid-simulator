/**
 * **备战屏的滚动规则**（纯函数：谁滚、滚多少、光标换行时视角跟不跟）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它回答三个问题，**一行 Pixi 都不碰**：
 *
 * 1. 这个点落在**哪一块**的可滚视口里？（滚轮 / 拖拽该给谁）
 * 2. 这一块滚动 `delta` 像素之后偏移是多少？（含钳位）
 * 3. 光标换了行，视角**要不要**跟、跟到哪？（`followedCursor`）
 *
 * ==================================================================
 * 为什么从 `PrepareScreen.ts` 切出来（AGENTS.md §3）
 * ==================================================================
 *
 * 2026-10-13 第三轮（卡片区可滚）之后那个类到了 **730 行**（超上限）。
 * 按 §3 先看它混了几件事：
 *
 * | 那一半 | 一句话 |
 * |---|---|
 * | 本文件 | 滚动**怎么算**（纯逻辑，能在 node 里测） |
 * | `PrepareScreen` | 输入**怎么改状态**、每帧把状态喂给谁 |
 *
 * 切出来的另一个好处是**可测**：`PrepareScreen` 要构造 Pixi 对象，而
 * Pixi v8 在 jsdom 里不好跑 —— 留在类里就只能写"能构造、不报错"那种
 * 零信息的冒烟测试。"光标换行时视角跟不跟"恰恰是**会被写错、而截图看
 * 不出来**的那类规则（滚动位置只在两个状态下看得出差别）。
 *
 * ⚠️ 偏移的**钳位**不在这里写第二遍：`scrollWindow.clampOffset` 已经是
 * "滚到尽头 / 内容不足一屏 / 空内容"三种边界的唯一实现，本文件只是把
 * 它接到"哪一块 / 光标在哪一行"上。
 */

import type { PrepareCounts } from './prepareLayout';
import { PREPARE_LAYOUT } from './prepareLayout';
import type { SectionScroll } from './prepareGeometry';
import {
  NO_SCROLL,
  rowTopsOf,
  sectionColumns,
  sectionMaxScroll,
  sectionRowStep,
  sectionViewport,
  sectionViewportRows,
} from './prepareGeometry';
import { cursorTarget, type PrepareOption, type PrepareSelection } from './prepareLogic';
import { gridCell } from './gridNav';

/** 三块的张数（滚动量取决于内容多少）。 */
export interface ScrollShape {
  readonly counts: PrepareCounts;
}

/** 三块各自的选项表（光标跟随要知道"光标是第几张卡"）。 */
export interface ScrollLists {
  readonly players: readonly PrepareOption[];
  readonly bosses: readonly PrepareOption[];
  readonly qiji: readonly PrepareOption[];
}

/** 光标此刻停在哪一格（`index` = 它在自己那一块里的下标）。 */
export interface CursorCell {
  readonly kind: 'player' | 'qiji' | 'boss';
  readonly index: number;
  readonly count: number;
}

/**
 * 光标落在**第几行**（二维网格；`undefined` = 焦点不在卡片上）。
 *
 * ⚠️ 行号由 `gridNav` 算（与键盘 ← → ↑ ↓ 走的是**同一份**网格数学）：
 * 两处各算一遍的话，键盘以为自己在第 2 行、而视角以为在第 1 行 ——
 * 表现就是"按 ↓ 换了行，但画面没跟过去"。
 */
export function cursorCell(
  sel: PrepareSelection,
  lists: ScrollLists,
): CursorCell | undefined {
  const at = cursorTarget(sel, lists.players, lists.bosses, lists.qiji);
  if (at === undefined) return undefined;
  const list = at.kind === 'player' ? lists.players : at.kind === 'boss' ? lists.bosses : lists.qiji;
  const index = Math.max(
    0,
    list.findIndex((e) => e.id === at.id),
  );
  return { kind: at.kind, index, count: list.length };
}

/**
 * 这个逻辑点落在**哪一块的可滚视口**里（`undefined` = 不在任何一块里）。
 *
 * ⚠️ 只认**展开的那一块**（收起的两块只有一条块头，"点一下展开"不是
 * 滚动区），而且**不用滚的块不认**：否则它会白吃掉一次滚轮，页面却不能
 * 跟着滚（"滚了没反应，但页面也不动"是最糟的一种）。
 */
export function sectionAtPoint(
  px: number,
  py: number,
  expanded: 'player' | 'qiji' | 'boss',
  counts: PrepareCounts,
  scroll: SectionScroll = NO_SCROLL,
): 'player' | 'qiji' | 'boss' | undefined {
  if (sectionMaxScroll(expanded, counts) <= 0) return undefined;
  const view = sectionViewportRows(expanded, counts, scroll);
  const top = rowTopsOf(counts, expanded)[expanded];
  const bottom = top + view.rows * sectionRowStep(expanded);
  const left = PREPARE_LAYOUT.pad;
  const right = left + PREPARE_LAYOUT.playerColW;
  if (px < left || px > right || py < top || py > bottom) return undefined;
  return expanded;
}

/**
 * 某一块滚动 `delta` 像素（正数 = 往下看更多）之后的偏移。
 *
 * @returns 新的偏移表；**没有真的动**时 `undefined`（调用方据此决定
 *   "这次滚轮吃不吃 / 要不要重画"）。
 */
export function scrolledBy(
  kind: 'player' | 'qiji' | 'boss',
  delta: number,
  counts: PrepareCounts,
  scroll: SectionScroll = NO_SCROLL,
): SectionScroll | undefined {
  /**
   * ⚠️ 钳位交给 `sectionViewport`（它内部是 `pixelViewport`，**像素**那
   * 一套）：把"想去的偏移"当输入传进去，它返回钳过的值。
   *
   * ⚠️ 曾经写的是 `clampOffset(offset, maxScroll, 1)` —— 那是**行**那一套
   * 函数（第二个参数是"一屏几行"），拿它钳像素会让上界差 1，滚到底时
   * 最后一行只露出一点点。两种单位不许互相借。
   */
  const next = sectionViewport(kind, counts, { ...scroll, [kind]: scroll[kind] + delta }).offsetPx;
  if (next === scroll[kind]) return undefined;
  return { ...scroll, [kind]: next };
}

/**
 * **光标跟随**：光标换行之后，视角该滚到哪。
 *
 * ==================================================================
 * ⚠️ 判据是"行"，而且**爆出视口才滚**
 * ==================================================================
 *
 * - 判据用**行**而不是卡片的 y：滚动的最小单位是一行（行高固定），
 *   用 y 会在同一行内按 ← → 时也算出一点偏移（画面横着晃）。
 * - **爆出视口才滚**（而不是"每动一下就居中"）：后者在 5 列网格里会让
 *   每次 ← → 都重新居中，玩家看到的是整块在抖。
 *
 * @returns 新的偏移表；光标已经可见（或这一块不用滚）时 `undefined`。
 */
export function followedCursor(
  sel: PrepareSelection,
  lists: ScrollLists,
  counts: PrepareCounts,
  scroll: SectionScroll = NO_SCROLL,
): SectionScroll | undefined {
  /** 焦点在「开始战斗」上时，跟着走的是**上一块**（见 `PrepareSelection.expanded`）。 */
  const kind = sel.focus === 'start' ? sel.expanded : sel.focus;
  if (sectionMaxScroll(kind, counts) <= 0) return undefined;
  const cell = cursorCell(sel, lists);
  if (cell === undefined || cell.kind !== kind) return undefined;

  const row = gridCell(cell.index, cell.count, sectionColumns(kind)).row;
  const view = sectionViewportRows(kind, counts, scroll);
  const last = view.first + view.rows - 1;
  if (row >= view.first && row <= last) return undefined;

  /** 光标在上方 → 它就是第一行；在下方 → 让它落在**最后一行**（不多滚）。 */
  const first = row < view.first ? row : row - view.rows + 1;
  const step = sectionRowStep(kind);
  const want = scroll[kind] + (first - view.first) * step;
  const next = sectionViewport(kind, counts, { ...scroll, [kind]: want }).offsetPx;
  if (next === scroll[kind]) return undefined;
  return { ...scroll, [kind]: next };
}
