/**
 * **备战屏的几何**：由布局表（`prepareLayout`）算出来的那些矩形。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"按表算"的那一半：卡片网格、三块的纵向链（手风琴）、收起的块头、
 * 开始键、详情区、以及渲染与命中测试**共用**的那一份可点区域。
 *
 * ==================================================================
 * 为什么从 `prepareLayout.ts` 切出来（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * 2026-10-13 第二轮（手风琴）之后那个文件到了 **745 行**（超上限），而它
 * 里面**混着两件事**：
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | `prepareLayout.ts` | 这一屏的**数字从哪来**（下限推导 + 一张表） |
 * | 本文件 | **按那张表算出来的矩形**（网格 / 行顶 / 命中区 / 开始键） |
 *
 * 所以按 §3 的正确顺序做了**横向切割**（不是压注释）：表留在那边、算法
 * 搬到这里。依赖是**单向**的（本文件 → 表），没有环。
 */

import {
  PREPARE_LAYOUT,
  SECTION_ORDER,
  type PrepareCounts,
  type PrepareHitArea,
  type PrepareLayout,
} from './prepareLayout';
import type { PrepareSectionKind } from './prepareTypes';
import { gridCell } from './gridNav';
import { pixelViewport, scrollThumbRatio, steppedViewport } from './scrollWindow';

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
   * 每行的实际张数：`count` 张按行优先摊到 `rows` 行上，
   * **最后一行可能不满**（7 张 5 列 2 行 → 5 + 2）。
   */
  const base = Math.floor(count / allRows);
  const extra = count % allRows;

  const out: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    const inRow = base + (row < extra ? 1 : 0);
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

/* ------------------------------------------------------------------ *
 * 手风琴：三块的纵向链
 * ------------------------------------------------------------------ */

/**
 * 某一块**展开时**的**内容**高度（它自己的卡片网格摊几行就是几行）。
 *
 * ⚠️ 它**不是**画面上占的高度（那是 `sectionBlockH`）：排不下时画面只占
 * 视口那么高，多出来的部分靠滚动看。两份数各有各的用途，不要合并 ——
 * 合并之后滚动条算不出"内容比视口高多少"。
 *
 * ⚠️ 张数为 0 时返回 0：空槽位（选角色屏没有 Boss / 炁机）不该占一行。
 * 调用方（`prepareHitAreas`）也会跳过空槽位。
 */
/**
 * 某一块**展开时在画面上占多高** = `min(内容, 视口)`。
 *
 * ⚠️ 它是**手风琴纵向链的输入**（`rowTopsOf` 与 `sectionsBottom` 读它）：
 * 于是"炁机有 20 条"与"炁机有 8 条"占的高度**一样**，`开始战斗` 不会
 * 被内容条数顶下去。
 */
export function sectionBlockH(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  const count = countOf(kind, counts);
  if (count <= 0) return 0;
  return Math.min(sectionStackH(kind, counts, L), sectionViewportH(kind, L));
}

/**
 * 某一块在这一帧里的**内容高度**：展开的那块 = 卡片网格，收起的 = 块头。
 *
 * ⚠️ 这是手风琴的**唯一几何判据**（`rowTopsOf` 与命中区域都读它）。
 * 两块各写一遍"收起时多高"必然会让命中区与画面错开。
 */
export function sectionContentH(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  expanded: PrepareSectionKind,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  return kind === expanded ? sectionBlockH(kind, counts, L) : L.foldH;
}

/**
 * 三块内容的**第一行顶边**：`人物 → 炁机 → 对手`（用户指定的顺序）。
 *
 * ==================================================================
 * ⚠️ 为什么"算出来"而不是在布局表里写三个 y
 * ==================================================================
 *
 * 对手和炁机都会**折行**（7 张卡 → 2 行、8 条炁机 → 2 行），而它们的
 * 行数是**内容决定的**（今天 7 张、明天 8 张）；再加上**手风琴**——
 * 展开哪一块，三块的高度都跟着变。写死 `bossRowY` / `qijiRowY` 就等于
 * "上一块的底边"是手算的 —— 加一个 Boss 就会有一块内容压到下一块上，
 * 而**压的方式是一行汉字正好压在一行卡片上面**（实测过一次）。
 *
 * 所以这里按**块高**递推：
 *
 * ```
 *   人物第一行 = 主标题行框下面
 *   炁机第一行 = 人物块底边 + rowGap + 标题行框 + labelGap
 *   对手第一行 = 炁机块底边 + rowGap + 标题行框 + labelGap
 * ```
 *
 * ⚠️ 递推的输入是**张数 + 展开的是哪一块**：换顺序只改这里的**递推顺序**
 * （`SECTION_ORDER`），不许在别处再手调一次 y。
 *
 * @param expanded 这一帧展开的那一块（收起的两块只占 `foldH`）。
 */
export function rowTopsOf(
  counts: PrepareCounts,
  expanded: PrepareSectionKind = 'player',
  L: PrepareLayout = PREPARE_LAYOUT,
): { readonly player: number; readonly qiji: number; readonly boss: number } {
  /**
   * ⚠️ 标题的**行框**（`1.3 × labelSize`）—— 与布局测试同一个保守估计。
   * 它是"标题本身占多高"，与 `labelGap`（标题下缘到卡片的距离）是两段。
   */
  const labelBox = Math.ceil(L.labelSize * 1.3);
  /**
   * ⚠️ 人物那一块**从主标题推**（不是直接写 y）：主标题的锚点是 `0.5`，
   * 所以它的行框是 `titleY ± 32×1.3/2`。
   */
  const titleBox = Math.ceil(32 * 1.3);
  /** 这一块的标题行顶 = 上一块底边 + rowGap；行顶 = 标题行顶 + 行框 + labelGap。 */
  const below = (prevBottom: number): number => prevBottom + L.rowGap + labelBox + L.labelGap;
  const player = L.titleY + Math.ceil(titleBox / 2) + L.rowGap + labelBox + L.labelGap;

  const playerBottom = player + sectionContentH('player', counts, expanded, L);
  const qiji = below(playerBottom);
  const qijiBottom = qiji + sectionContentH('qiji', counts, expanded, L);
  const boss = below(qijiBottom);
  return { player, qiji, boss };
}

/**
 * 三块的最底边（**最高的一种展开方式**）。
 *
 * ⚠️ 它是"按钮放在哪"的输入：按钮**不能跟着展开的那一块上下跳**
 * （那会让"点开始"变成每次都要重新找目标），所以取三种展开方式里
 * 最低的那一条 —— 见 `startRect`。
 */
export function sectionsBottom(
  counts: PrepareCounts,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  const last = SECTION_ORDER[SECTION_ORDER.length - 1]!;
  return Math.max(
    ...SECTION_ORDER.map((expanded) => {
      const tops = rowTopsOf(counts, expanded, L);
      return tops[last] + sectionContentH(last, counts, expanded, L);
    }),
  );
}

/**
 * 栏目标题**底边**的 y（`PrepareScreen` 用它把标题画在卡片上方）。
 *
 * ⚠️ 抽出来的理由：原来这是 `PrepareScreen` 里的一个 `- 22` 字面量，
 * 与"卡片行在哪"是两处真相 —— 行一移，标题不跟。
 * ⚠️ 今天它**派生自** `rowTopsOf`（见那里的说明）。
 */
export function prepareLabelY(
  counts: PrepareCounts,
  expanded: PrepareSectionKind = 'player',
  L: PrepareLayout = PREPARE_LAYOUT,
): {
  readonly player: number;
  readonly boss: number;
  readonly qiji: number;
} {
  const tops = rowTopsOf(counts, expanded, L);
  return {
    player: tops.player - L.labelGap,
    qiji: tops.qiji - L.labelGap,
    boss: tops.boss - L.labelGap,
  };
}

/* ------------------------------------------------------------------ *
 * 收起态的「块头」
 * ------------------------------------------------------------------ */

/**
 * 收起那一块的**块头**矩形（画出来的那一条）。
 *
 * ⚠️ 宽度用 `playerColW`（= 整个卡片列的宽度）而不是每块自己的 `*ColW`：
 * 三个块头宽度不一致会看起来像三个不同的控件（炁机列比别的窄一档，
 * 那一条只有"卡片列宽"这一个语义）。
 */
export function foldRect(top: number, L: PrepareLayout = PREPARE_LAYOUT): Rect {
  return { x: L.pad, y: top, w: L.playerColW, h: L.foldH };
}

/**
 * 块头的**可点矩形**：向上多吃进"标题带"（标题行框 + `labelGap`）。
 *
 * ⚠️ 与 `IconButton.hitSlop` 同一个模式（"命中范围 = 内容盒 ∪ 外扩"）：
 * 触屏点的是"**块头那一整块**"（含它上面那行「选择对手」），而画出来的
 * 只有 `foldH` 那一条。上界正好是**上一块的底边**（`rowTopsOf` 的
 * `rowGap` = 0 时相邻不相交），所以它不会吃掉上一条卡片的点击。
 */
export function foldHitRect(top: number, L: PrepareLayout = PREPARE_LAYOUT): Rect {
  const headerH = Math.ceil(L.labelSize * 1.3) + L.labelGap;
  return { x: L.pad, y: top - headerH, w: L.playerColW, h: L.foldH + headerH };
}

/**
 * 块头那行字**最多几个字**（内宽 ÷ 名字字号）。
 *
 * ⚠️ 它给的是"排不下就收口"的依据（见 `prepareFold.joinWithin`）：块头
 * **不折行** —— 一旦折行，它的高度就不再是 `foldH`，下面两块的位置会跟着
 * 变（那是"随手写一行文案把布局搞坏"的形状）。所以宁可少显示几条。
 */
export function foldTextMaxChars(L: PrepareLayout = PREPARE_LAYOUT): number {
  const innerW = L.playerColW - L.cardPad * 2;
  return Math.max(1, Math.floor(innerW / L.nameSize));
}

/* ------------------------------------------------------------------ *
 * 命中区域 / 开始键 / 详情区
 * ------------------------------------------------------------------ */

/**
 * 「开始战斗」的矩形（渲染与命中测试**共用**这一个推导）。
 *
 * ==================================================================
 * ⚠️ 它的 y **算出来**（旧版是布局表里一个写死的 `startY = 430`）
 * ==================================================================
 *
 * 旧版三块同时展开，纵向排不下，于是按钮被横着挪到炁机行的**右侧**
 * （避开卡片列）—— 而那恰好是"按钮与它的文字错位"的来源：按钮的矩形
 * 由 `startY` 推、文字却仍然画在**整张画布的中心**（`LOGICAL.width / 2`
 * = 480，而按钮中心是 328）。
 *
 * 手风琴把纵向省出来之后，按钮回到**卡片列下方居中**；y 由
 * `sectionsBottom`（三块里最高的一种展开方式）+ `startGap` 算出来：
 * 展开哪一块它都不动（见 `sectionsBottom`）。
 */
export function startRect(
  counts: PrepareCounts,
  L: PrepareLayout = PREPARE_LAYOUT,
): Rect {
  return {
    x: Math.round(L.pad + (L.playerColW - L.startW) / 2),
    y: Math.round(sectionsBottom(counts, L) + L.startGap),
    w: L.startW,
    h: L.startH,
  };
}

/**
 * 「开始战斗」的**中心 x** —— 按钮上的文字与它下面那行提示的对齐基准。
 *
 * ⚠️ 这个函数存在的唯一理由是**把那个错位 bug 钉死**：旧版按钮矩形由
 * `pad + (playerColW - startW)/2` 算出（中心 **328**），而文字画在
 * `LOGICAL.width / 2`（**480**）—— 同一个东西两处各算一遍，于是漂了 152px。
 * 现在 `prepareFooter` 的文字 / 提示**都从这里取**，而它又由 `startRect`
 * 推 —— 布局再动也不会漂（单测直接断言"文字中心 = 矩形中心"）。
 */
export function startCenterX(
  counts: PrepareCounts,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  const rect = startRect(counts, L);
  return rect.x + rect.w / 2;
}

/**
 * 当前布局下的可点区域（渲染与命中测试**共用**）。
 *
 * 规则：
 *   1. **展开的那一块** → 它**可见**的那些卡的矩形（见下面的"滚动"）
 *   2. **收起的那两块** → 各一条块头（`foldHitRect`，含标题带的外扩）
 *   3. 最后是「开始战斗」
 *
 * ⚠️ 空槽位（张数为 0）**整块跳过**：它没有卡片可点，块头也没有意义
 * （"展开一个空块"不是正常操作到得了的状态）。
 *
 * ==================================================================
 * ⚠️ 2026-10-13 第三轮：展开那一块**只报可见的那几行**（滚动）
 * ==================================================================
 *
 * 用户原话："**现在的 layout 应该可以排更多炁机了，而且炁机排不下就滚动**"。
 *
 * 排不下时内容仍然摊那么多行，但**画面上只有视口那几行**。于是命中区也
 * 必须只含可见的那几行 —— 否则"看不见的卡"仍然点得中（幽灵卡），而
 * **可见卡的位置也不对了**：第 3 行滚进视口时它的 y 已经不是
 * `rowTops + 2 × 行距` 了（那样点下去会点到别的卡上）。
 *
 * ⚠️ 所以命中区与**渲染共用同一个判据**（`sectionViewportRows`）：
 * 谁是"第一行可见"、可见几行，只有那一处说了算。
 *
 * @param expanded 这一帧展开的那一块（由选择状态给，见 `prepareLogic`）。
 * @param scroll 三块各自的滚动偏移（默认都不滚 = 旧行为）。
 */
export function prepareHitAreas(
  players: readonly { readonly id: string }[],
  bosses: readonly { readonly id: string }[],
  qiji: readonly { readonly id: string }[] = [],
  expanded: PrepareSectionKind = 'player',
  scroll: SectionScroll = NO_SCROLL,
  L: PrepareLayout = PREPARE_LAYOUT,
): readonly PrepareHitArea[] {
  const counts: PrepareCounts = {
    players: players.length,
    bosses: bosses.length,
    qiji: qiji.length,
  };
  const tops = rowTopsOf(counts, expanded, L);
  const lists: Readonly<Record<PrepareSectionKind, readonly { readonly id: string }[]>> = {
    player: players,
    qiji,
    boss: bosses,
  };

  const out: PrepareHitArea[] = [];
  for (const kind of SECTION_ORDER) {
    const list = lists[kind];
    if (list.length === 0) continue;
    const top = tops[kind];
    if (kind !== expanded) {
      out.push({ kind: 'summary', id: kind, ...foldHitRect(top, L) });
      continue;
    }
    const windows = sectionViewportRows(kind, counts, scroll, L);
    /** 只算**可见那几行**的矩形（`gridRows` 裁剪行数，不重排内容）。 */
    const rects = cardGrid(list.length, top, L, {
      colW: colWOf(kind, L),
      columns: columnsOf(kind, L),
      h: cardHOf(kind, L),
      minW: cardMinWOf(kind, L),
      gridRows: windows.first + windows.rows,
    });
    const card = Math.max(1, Math.min(columnsOf(kind, L), list.length));
    const viewH = sectionViewportH(kind, L);
    const step = sectionRowStep(kind, L);
    /**
     * ⚠️ 视口**整体上移** `第一行 × 行距`（**不是**"每张卡各自减自己的
     * 行号"—— 那会把所有行都压到第一行上）。渲染层 `prepareFrame` 用的
     * 是**同一个**偏移，所以"看到的卡片"与"点中的卡片"仍然是同一个矩形
     * （命中区与渲染各自再算一遍偏移必然漂）。
     */
    const offset = windows.first * step;
    for (let i = 0; i < rects.length; i += 1) {
      const entry = list[i];
      const rect = rects[i];
      if (entry === undefined || rect === undefined) continue;
      /** 这一张在第几行（布局测试与键盘导航都要用同一份判据）。 */
      const row = gridCell(i, list.length, card).row;
      /** 视口之外的行：不画、也点不中。 */
      if (row < windows.first || row >= windows.first + windows.rows) continue;
      const y = rect.y - offset;
      /** 兜底：视口下缘之外的（行高不整除）也不报。 */
      if (y + rect.h > top + viewH) continue;
      out.push({ kind, id: entry.id, ...rect, y });
    }
  }
  out.push({ kind: 'start', id: 'start', ...startRect(counts, L) });
  return out;
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
 * ⚠️ 与 `prepareHitAreas` / 渲染层取**同一个** `rowTopsOf(counts, expanded)`：
 * 轨道必须贴在"这一块现在画在哪儿"上，而不是"它展开时会画在哪儿"。
 */
export function sectionScrollbar(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  scroll: SectionScroll = NO_SCROLL,
  expanded: PrepareSectionKind = 'player',
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
  const trackTop = rowTopsOf(counts, expanded, L)[kind];
  const trackH = Math.max(0, view.viewPx);
  const thumbRatio = scrollThumbRatio(view.countPx, view.viewPx);
  const thumbH = Math.max(24, Math.round(thumbRatio * trackH));
  const progress = view.maxPx === 0 ? 0 : view.offsetPx / view.maxPx;
  const thumbTop = trackTop + Math.round((trackH - thumbH) * progress);
  return { trackX, trackTop, trackW: 3, trackH, thumbH, thumbTop, maxPx: view.maxPx };
}

/** 详情区矩形（渲染层只读它，不再自己写数字）。 */
export function detailRect(L: PrepareLayout = PREPARE_LAYOUT): Rect {
  return { x: L.detailX, y: L.detailY, w: L.detailW, h: L.detailH };
}
