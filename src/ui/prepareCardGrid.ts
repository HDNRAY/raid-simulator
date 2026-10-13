/**
 * **卡片在这一块里怎么摊开 + 看得见哪几行**（纯几何）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把"这一块有几张卡 / 几列 / 卡片多大 / 现在滚到哪"翻成**一格一格的
 * 矩形**，外加"一屏放几行 / 还能滚多远 / 滚动条在哪"。
 *
 * 没有它，`prepareGeometry` 就同时是"块与块之间怎么摞"和"卡片在这一块
 * 里怎么排" —— 2026-10-13 第三轮（卡片区可滚）之后那个文件因此到了
 * **703 行**（超上限）。按 AGENTS.md §3 做**横向切割**（不是压注释）：
 *
 * | 那一半 | 一句话 |
 * |---|---|
 * | 本文件 | 卡片**在一格里**怎么排、看得见哪几行 |
 * | `prepareGeometry` | 三块**之间**怎么摞（手风琴 / 块头 / 开始键 / 命中区） |
 *
 * ⚠️ 依赖是**单向**的（`prepareGeometry` → 本文件）：本文件**不许**
 * 反过来读 `rowTopsOf` —— 所以 `sectionScrollbar` 的行顶由调用方传
 * （见那个参数）。
 *
 * ==================================================================
 * ⚠️ 网格的列数只有一个含义（踩过一次）
 * ==================================================================
 *
 * `cardGrid` 每行**尽量塞满 `columns` 张**、最后一行不满；而键盘的走位
 * （`ui/gridNav.ts`）也按同一个 `columns` 算"↓ 去哪一格"。两处**必须**
 * 认同一个数：旧版 `cardGrid` 是"把 `count` 均分到各行"（8 条 → 4 + 4），
 * 而布局表与键盘都按 5 列理解 —— 于是光标在第 4 张按 ↓ 会跳到斜下方
 * （画面上第 5 张的右下角那只）。
 */

import { PREPARE_LAYOUT, type PrepareCounts, type PrepareLayout } from './prepareLayout';
import type { PrepareSectionKind } from './prepareTypes';
import { pixelViewport, scrollBarGeometry, steppedViewport } from './scrollWindow';

/** 一个矩形（布局层给渲染 / 命中测试的通用形状）。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/* ------------------------------------------------------------------ *
 * 卡片网格
 * ------------------------------------------------------------------ */

/** 一个矩形（布局层给渲染 / 命中测试的通用形状）。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 某个槽位的卡片数。 */
export function countOf(kind: PrepareSectionKind, counts: PrepareCounts): number {
  if (kind === 'player') return counts.players;
  if (kind === 'qiji') return counts.qiji;
  return counts.bosses;
}

/** 某个槽位的目标列数 / 列宽 / 卡片高（三块各自的几何，集中在这里）。 */
function columnsOf(kind: PrepareSectionKind, L: PrepareLayout): number {
  if (kind === 'player') return L.playerColumns;
  if (kind === 'qiji') return L.qijiColumns;
  return L.bossColumns;
}

function colWOf(kind: PrepareSectionKind, L: PrepareLayout): number {
  if (kind === 'player') return L.playerColW;
  if (kind === 'qiji') return L.qijiColW;
  return L.bossColW;
}

function cardHOf(kind: PrepareSectionKind, L: PrepareLayout): number {
  return kind === 'qiji' ? L.qijiCardH : L.cardH;
}

function cardMinWOf(kind: PrepareSectionKind, L: PrepareLayout): number {
  return kind === 'qiji' ? L.qijiMinW : L.cardMinW;
}

/**
 * 某一块的卡片**目标列数**（键盘在二维网格里走位要用它）。
 *
 * ⚠️ 与 `cardGrid` 用的是**同一个数**：面板按 5 列画、键盘按 5 列走 ——
 * 两处各写一遍会让"↓ 到底去了哪一格"和画面对不上（`gridNav` 记着这条）。
 */
export function sectionColumns(kind: PrepareSectionKind, L: PrepareLayout = PREPARE_LAYOUT): number {
  return columnsOf(kind, L);
}

/**
 * 一块的四个度量（列宽 / 列数 / 卡片高 / 可读性下限）。
 *
 * ⚠️ 一次给全（而不是四个 `sectionXxx()`）：`cardGrid` 的入参就是这四个，
 * 分开取会让调用方（`prepareHitAreas`）抄一遍"哪个 kind 用哪个数"——
 * 而那正是 `columnsOf` / `colWOf` / `cardHOf` / `cardMinWOf` 存在的理由。
 */
export interface SectionMetrics {
  readonly colW: number;
  readonly columns: number;
  readonly cardH: number;
  readonly minW: number;
}

export function sectionMetrics(
  kind: PrepareSectionKind,
  L: PrepareLayout = PREPARE_LAYOUT,
): SectionMetrics {
  return {
    colW: colWOf(kind, L),
    columns: columnsOf(kind, L),
    cardH: cardHOf(kind, L),
    minW: cardMinWOf(kind, L),
  };
}

/**
 * 卡片网格：把 `count` 张卡放进 `columns` 列的网格，返回每个格子的矩形。
 *
 * ⚠️ **列数由调用方给**（各槽位的 `*Columns`）：一行放不下时**它自己
 * 折行**，不是靠"调用方预先算好每行几张"。这保证了加第 9 条炁机时不会
 * 溢出，也不会有人手写一个 `4` 到命中测试里去。
 *
 * ⚠️ **居中按"卡片列"算**，不是按整张画布（960）算：详情区占了右边
 * 296，若还按画布居中，卡片在左列里会看起来偏右。
 *
 * ⚠️ 宽度取 `max(minW, 按列等分)`：取到下限时**可能溢出列宽**，
 * 那是"该分更多行 / 列数太多"的信号 —— 布局测试里有一条"整块不越出
 * 卡片列"会先失败，比默默缩到点不中好。
 *
 * @param colW 这一列的可用宽度（`playerColW` / `bossColW` / `qijiColW`）。
 * @param columns 目标列数（张数更少时会自动减到 `count`）。
 * @param minW 这一块的**可读性下限**（人物 / 对手 = `cardMinW`，炁机 = `qijiMinW`）。
 * @param rows 网格行数（`undefined` = 由 `count` 与列数推出）。
 * @param gridRows 只算前几行的矩形（`undefined` = 全部）—— 见下面的说明。
 */
export function cardGrid(
  count: number,
  topY: number,
  L: PrepareLayout,
  opts: {
    readonly colW: number;
    readonly columns: number;
    readonly h: number;
    readonly minW: number;
    readonly rows?: number;
    readonly gridRows?: number;
  },
): readonly Rect[] {
  if (count <= 0) return [];
  const columns = Math.max(1, Math.min(opts.columns, count));
  const allRows = Math.max(1, opts.rows ?? Math.ceil(count / columns));
  /**
   * ⚠️ `gridRows` **只裁剪行数，不改变每行的张数**：卡片的位置是"内容的
   * 实际排布"算出来的，所以"只看第 2、3 行"时它们的 y / x 与看全部时
   * **逐像素相同**（不会因为裁剪而重新居中）。
   *
   * 这一条是**滚动**能成立的前提：视口只决定"画哪几行"，内容的排布不跟着变。
   */
  const rows =
    opts.gridRows === undefined
      ? allRows
      : Math.max(0, Math.min(allRows, Math.floor(opts.gridRows)));
  if (rows === 0) return [];

  const byColumn = Math.floor((opts.colW - L.cardGap * (columns - 1)) / columns);
  const w = Math.max(opts.minW, byColumn);

  /**
   * 每行**尽量塞满**（`columns` 张），**最后一行不满**
   * （8 条炁机 5 列 2 行 → 5 + 3；7 个 Boss → 5 + 2）。
   *
   * ==================================================================
   * ⚠️⚠️ 2026-10-13 第三轮：从"**均分**"改成"**填满**"（这不是审美）
   * ==================================================================
   *
   * 旧版是 `base = count / rows`（**均分**）：8 条炁机 2 行 → **4 + 4**。
   * 而布局表 `qijiColumns` / `bossColumns` 与**键盘的网格走位**
   * （`gridNav` 按 `columns` 算"↓ 去哪一格"）都按 **5 列**理解：
   *
   * ```
   *   画面上（均分）：row0 = 下标 0..3，row1 = 下标 4..7
   *   键盘里（5 列）：row0 = 下标 0..4，row1 = 下标 5..9
   *   → 光标在第 4 张按 ↓，键盘以为去第 9 张，画面上却跳到第 5 张的**右下**
   * ```
   *
   * 那正是本仓库反复踩的"同一个东西两处各算一遍"：**网格的列数只有一个
   * 含义**（一行放几张），画与走必须都认它。
   *
   * ⚠️ 顺带修掉的还有：均分让 4 张卡只占 458px 而列宽有 576px（右边空出
   * 118px，截图上是一块明显的空白），与布局表注明的"5 列 → 110px/张"对不上。
   *
   * ⚠️ 行数**不受影响**（`cardRowsOf` 一直是 `ceil(count / columns)`），
   * 所以"三块占多高"与"开始战斗放哪"一字未变。
   */
  const out: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    const from = row * columns;
    const inRow = Math.max(0, Math.min(columns, count - from));
    if (inRow === 0) continue;
    const totalW = inRow * w + L.cardGap * (inRow - 1);
    const x0 = L.pad + Math.round((opts.colW - totalW) / 2);
    for (let col = 0; col < inRow; col += 1) {
      out.push({
        x: x0 + col * (w + L.cardGap),
        y: topY + row * (opts.h + L.cardGap),
        w,
        h: opts.h,
      });
    }
  }
  return out;
}

/** 某个槽位在默认列数下会摊成几行。 */
export function cardRowsOf(count: number, columns: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / Math.max(1, Math.min(columns, count)));
}

/**
 * 某个槽位整块（含折行）的**内容**高度（**不裁剪**）。
 *
 * ⚠️ 它回答的是"这些卡摊开来有多高"（滚动条要用它算滑块比例）；而
 * **画面上占多高**由 `sectionBlockH`（= min(内容, 视口)）回答。
 * 两者混用会让"内容比视口高"这件事在几何里消失。
 */
export function cardBlockH(count: number, columns: number, cardH: number, L: PrepareLayout): number {
  const rows = cardRowsOf(count, columns);
  if (rows === 0) return 0;
  return rows * cardH + (rows - 1) * L.cardGap;
}

/* ------------------------------------------------------------------ *
 * 滚动视口（三块共用同一套，见 prepareLayout 的 `visibleRows`）
 * ------------------------------------------------------------------ */

/**
 * **一块的卡片区现在滚到哪**（逻辑像素，`0` = 顶部）。
 *
 * ⚠️ 这是"滚动状态"的类型（三块各一份），不是几何。它由 `PrepareScreen`
 * 持有（唯一可写者），几何 / 命中 / 渲染都只**读**它。
 */
export interface SectionScroll {
  readonly player: number;
  readonly qiji: number;
  readonly boss: number;
}

/** 没滚过的那一份（构造 / 换块 / 复位时用）。 */
export const NO_SCROLL: SectionScroll = { player: 0, qiji: 0, boss: 0 };

/** 一块的一行占多高（卡片高 + 行距）—— 视口 / 滚动条都用它。 */
export function sectionRowStep(kind: PrepareSectionKind, L: PrepareLayout = PREPARE_LAYOUT): number {
  return cardHOf(kind, L) + L.cardGap;
}

/**
 * 可滚视口的**高度**（逻辑像素）。
 *
 * ```
 *   视口高 = L.visibleRows × 卡片高 + (L.visibleRows − 1) × 行距
 * ```
 *
 * ⚠️ 它与张数**无关**（见 `PrepareLayout.visibleRows`）：张数只决定
 * "内容多高 / 要不要滚"，不决定"视口多高"。反过来说，"开始战斗"的 y
 * 也不会跟着张数跳。
 */
export function sectionViewportH(
  kind: PrepareSectionKind,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  const rows = sectionVisibleRows(kind, L);
  return rows * cardHOf(kind, L) + (rows - 1) * L.cardGap;
}

/**
 * 这一块一屏放**几行**。
 *
 * ⚠️ 它是 `sectionViewportH`（视口多高）与 `sectionViewportRows`（看得见
 * 哪几行）**唯一**的行数来源：两份各算一遍就会漂（第一版正是如此 ——
 * 一个按像素除法算、一个按布局表算，差 1 行，第二行卡片凭空消失）。
 */
export function sectionVisibleRows(
  kind: PrepareSectionKind,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  /** ⚠️ 它今天三块同值；按块给是为了"以后某一块想多放一行"不必改签名。 */
  void kind;
  return Math.max(1, Math.floor(L.visibleRows));
}

/**
 * 这一块的内容**摊开来**有多高（不裁剪）—— 滚动条滑块比例的输入。
 *
 * ⚠️ 名字里的 `Stack` 是"全部卡片一层层摞起来"的意思：它**不是**画面
 * 上占的高度（那是 `sectionBlockH`）。两者混用会让"内容比视口高"这件事
 * 在几何里消失。
 */
export function sectionStackH(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  const count = countOf(kind, counts);
  if (count <= 0) return 0;
  return cardBlockH(count, columnsOf(kind, L), cardHOf(kind, L), L);
}

/** 这一块**能滚多远**（0 = 不用滚）。 */
export function sectionMaxScroll(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  /**
   * ⚠️ 用 `pixelViewport`（**像素**那一套）而不是 `clampOffset`（行那一套）：
   * 后者的第二个参数是"一个单位几个一行"，而这里两个参数都是像素 ——
   * 混用会让上限差 1（`clampOffset(offset, max, 1)` 算出的上界是
   * `max − 1`，第一版正是如此：滚到底时差 1 像素，看起来像"最后一行
   * 差一点点才露全"）。
   */
  return pixelViewport(sectionStackH(kind, counts, L), sectionViewportH(kind, L), 0).maxPx;
}

/**
 * 这一块此刻的视口（内容高 / 视口高 / 钳过的偏移 / 还能滚多少）。
 *
 * ⚠️ 偏移**在这里钳**（而不是让每个消费者自己钳）：滚轮 / 拖拽 / 光标
 * 跟随三条路都会改它，钳在几何一处，三条路就不可能各自越界。
 */
export function sectionViewport(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  scroll: SectionScroll = NO_SCROLL,
  L: PrepareLayout = PREPARE_LAYOUT,
): ReturnType<typeof pixelViewport> {
  return pixelViewport(sectionStackH(kind, counts, L), sectionViewportH(kind, L), scroll[kind]);
}

/**
 * **这一块现在该显示哪几行**（`first` = 第一行的下标）。
 *
 * ⚠️ 行数 / 视口行数 / 第一行三件事都由 `scrollWindow.steppedViewport`
 * 算 —— 与复盘 / 设置页技能详情是**同一份边界规则**（滚到尽头、
 * 内容不足一屏、空内容）。
 */
export function sectionViewportRows(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  scroll: SectionScroll = NO_SCROLL,
  L: PrepareLayout = PREPARE_LAYOUT,
): ReturnType<typeof steppedViewport> {
  const count = countOf(kind, counts);
  return steppedViewport(
    cardRowsOf(count, columnsOf(kind, L)),
    sectionVisibleRows(kind, L),
    scroll[kind],
    sectionRowStep(kind, L),
  );
}

/**
 * 一块的**滚动条**（轨道 + 滑块）该画在哪 — 渲染层只读它。
 *
 * ⚠️ 它从**卡片列的最右侧**那条 `scrollGutter` 里取（`layout.scrollGutter`）：
 * 压在卡片上就与卡片描边叠在一起，"哪一条是滚动条"会看不出来。
 *
 * ⚠️ 只有真能滚时才有意义（`maxPx > 0`）；调用方据此决定画不画 ——
 * "滑块的**出现**"就是"这一块还有内容在下面"的信号。
 *
 * ⚠️ 轨道贴的是**调用方给的那个 `rowTop`**（"这一块现在画在哪儿"），
 * 而不是"它展开时会画在哪儿" —— 手风琴一换块，行顶就变。
 */
export function sectionScrollbar(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  scroll: SectionScroll = NO_SCROLL,
  /**
   * 这一块**此刻画在哪一行**（`prepareGeometry.rowTopsOf(counts, expanded)[kind]`）。
   *
   * ⚠️ 由调用方给（而不是在这里读 `rowTopsOf`）：本文件不认识"手风琴
   * 三块的纵向链"，那是 `prepareGeometry` 的职责 —— 反过来 import 会
   * 让两个几何文件成环。
   */
  rowTop: number,
  L: PrepareLayout = PREPARE_LAYOUT,
): {
  readonly trackX: number;
  readonly trackTop: number;
  readonly trackW: number;
  readonly trackH: number;
  /** 滑块高（内容不足一屏时 = 轨道高）。 */
  readonly thumbH: number;
  /** 滑块顶边。 */
  readonly thumbTop: number;
  /** 还能滚多远（0 = 不用滚）。 */
  readonly maxPx: number;
} {
  const view = sectionViewport(kind, counts, scroll, L);
  const trackX = L.pad + colWOf(kind, L) - 3;
  const trackTop = rowTop;
  const trackH = Math.max(0, view.viewPx);
  /**
   * ⚠️ 滑块的几何走 `scrollWindow.scrollBarGeometry`（**唯一**一份滑动条
   * 数学）—— 详情区那条滚动条用的是同一个函数。这里只是把它的 `offset`
   * 加上轨道顶边，换成**屏幕坐标**。
   *
   * ⚠️ 入参是具名结构：`viewportPx` / `maxScrollPx` / `scrollPx` /
   * `trackLenPx` 各写各的名字 —— 旧版这里是
   * `scrollThumbRatio(view.countPx, view.viewPx)`，而详情区那份的参数顺序
   * 不同，两份都"对"也会被抄错（见 `scrollBarGeometry` 的文件）。
   */
  const thumb = scrollBarGeometry({
    viewportPx: view.viewPx,
    maxScrollPx: view.maxPx,
    scrollPx: view.offsetPx,
    trackLenPx: trackH,
  });
  const thumbH = thumb.length;
  const thumbTop = trackTop + thumb.offset;
  return { trackX, trackTop, trackW: 3, trackH, thumbH, thumbTop, maxPx: view.maxPx };
}

