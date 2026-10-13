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
 * ⚠️ 宽度取 `max(cardMinW, 按列等分)`：取到下限时**可能溢出列宽**，
 * 那是"该分更多行 / 列数太多"的信号 —— 布局测试里有一条"整块不越出
 * 卡片列"会先失败，比默默缩到点不中好。
 *
 * @param colW 这一列的可用宽度（`playerColW` / `bossColW` / `qijiColW`）。
 * @param columns 目标列数（张数更少时会自动减到 `count`）。
 * @param rows 网格行数（`undefined` = 由 `count` 与列数推出）。
 */
export function cardGrid(
  count: number,
  topY: number,
  L: PrepareLayout,
  opts: {
    readonly colW: number;
    readonly columns: number;
    readonly h: number;
    readonly rows?: number;
  },
): readonly Rect[] {
  if (count <= 0) return [];
  const columns = Math.max(1, Math.min(opts.columns, count));
  const rows = Math.max(1, opts.rows ?? Math.ceil(count / columns));

  const byColumn = Math.floor((opts.colW - L.cardGap * (columns - 1)) / columns);
  const w = Math.max(L.cardMinW, byColumn);

  /**
   * 每行的实际张数：`count` 张按行优先摊到 `rows` 行上，
   * **最后一行可能不满**（7 张 5 列 2 行 → 5 + 2）。
   */
  const base = Math.floor(count / rows);
  const extra = count % rows;

  const out: Rect[] = [];
  let taken = 0;
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
    taken += inRow;
  }
  /** 兜底：`rows` 与 `count` 打架时也不能少画 —— 张数**永远**等于 `count`。 */
  for (let i = taken; i < count; i += 1) {
    out.push({ x: L.pad, y: topY + rows * (opts.h + L.cardGap), w, h: opts.h });
  }
  return out;
}

/** 某个槽位在默认列数下会摊成几行。 */
export function cardRowsOf(count: number, columns: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / Math.max(1, Math.min(columns, count)));
}

/** 某个槽位整块（含折行）的高度。 */
export function cardBlockH(count: number, columns: number, cardH: number, L: PrepareLayout): number {
  const rows = cardRowsOf(count, columns);
  if (rows === 0) return 0;
  return rows * cardH + (rows - 1) * L.cardGap;
}

/* ------------------------------------------------------------------ *
 * 手风琴：三块的纵向链
 * ------------------------------------------------------------------ */

/**
 * 某一块**展开时**的内容高度（它自己的卡片网格摊几行就是几行）。
 *
 * ⚠️ 张数为 0 时返回 0：空槽位（选角色屏没有 Boss / 炁机）不该占一行。
 * 调用方（`prepareHitAreas`）也会跳过空槽位。
 */
export function sectionBlockH(
  kind: PrepareSectionKind,
  counts: PrepareCounts,
  L: PrepareLayout = PREPARE_LAYOUT,
): number {
  const count = countOf(kind, counts);
  if (count <= 0) return 0;
  return cardBlockH(count, columnsOf(kind, L), cardHOf(kind, L), L);
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
 *   1. **展开的那一块** → 它每一张卡的矩形
 *   2. **收起的那两块** → 各一条块头（`foldHitRect`，含标题带的外扩）
 *   3. 最后是「开始战斗」
 *
 * ⚠️ 空槽位（张数为 0）**整块跳过**：它没有卡片可点，块头也没有意义
 * （"展开一个空块"不是正常操作到得了的状态）。
 *
 * @param expanded 这一帧展开的那一块（由选择状态给，见 `prepareLogic`）。
 */
export function prepareHitAreas(
  players: readonly { readonly id: string }[],
  bosses: readonly { readonly id: string }[],
  qiji: readonly { readonly id: string }[] = [],
  expanded: PrepareSectionKind = 'player',
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
    const rects = cardGrid(list.length, top, L, {
      colW: colWOf(kind, L),
      columns: columnsOf(kind, L),
      h: cardHOf(kind, L),
    });
    list.forEach((entry, i) => {
      out.push({ kind, id: entry.id, ...rects[i]! });
    });
  }
  out.push({ kind: 'start', id: 'start', ...startRect(counts, L) });
  return out;
}

/** 详情区矩形（渲染层只读它，不再自己写数字）。 */
export function detailRect(L: PrepareLayout = PREPARE_LAYOUT): Rect {
  return { x: L.detailX, y: L.detailY, w: L.detailW, h: L.detailH };
}
