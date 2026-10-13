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
import {
  NO_SCROLL,
  cardGrid,
  countOf,
  sectionMetrics,
  sectionRowStep,
  sectionStackH,
  sectionViewportH,
  sectionViewportRows,
  type Rect,
  type SectionScroll,
} from './prepareCardGrid';

/**
 * ⚠️ **转发卡片网格 / 视口那一套**（实现在 `./prepareCardGrid`）：
 * §3 的横向切割把它们搬走了，而调用方（`prepareLogic` 的转发、测试、
 * 渲染层）**一行都不该改** —— 拆文件不该改 import 路径。
 */
export {
  NO_SCROLL,
  cardBlockH,
  sectionColumns,
  sectionMetrics,
  cardGrid,
  cardRowsOf,
  countOf,
  sectionMaxScroll,
  sectionRowStep,
  sectionScrollbar,
  sectionStackH,
  sectionViewport,
  sectionViewportH,
  sectionViewportRows,
  sectionVisibleRows,
  type Rect,
  type SectionScroll,
} from './prepareCardGrid';

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
 * ⚠️ 2026-10-13 第四轮：**锚定画布底部**（旧版跟着内容走）
 * ==================================================================
 *
 * 用户原话："**开始战斗 和 开始战斗下面的说明 其实可以放一排，
 * 并且 锚定在底部**"。
 *
 * 旧版的 y 由 `sectionsBottom`（三块里最高的一种展开方式）+ `startGap`
 * 推出 —— 也就是**跟着卡片内容走**：张数一变、切一块，按钮就上下溜。
 * 现在 y 只由 `L.footerRowCenterY`（从画布底边往上推的常量）决定，
 * **不看张数、也不看展开哪一块**。
 *
 * ==================================================================
 * ⚠️ 为什么 x 是**卡片列左端**（`pad`），而不是"按钮 + 说明"整块居中
 * ==================================================================
 *
 * 整块居中要让按钮的 x 依赖**说明文字的实测宽度**，而同一个矩形在
 * **命中测试**里也要算一遍（那是纯几何，量不到文字）—— 同一个矩形两处
 * 各算一遍，正是上一轮那个"开始战斗与文字错位 152px"的 bug 形状。
 * 所以按钮的 x 只由布局常量决定：它贴卡片列左端，说明在它右边那一格
 * （`footerHintSlot`）里左对齐。
 *
 * ⚠️ 它**不再接 `counts`**：这个矩形与张数无关（那正是"锚定"的意思）。
 */
export function startRect(L: PrepareLayout = PREPARE_LAYOUT): Rect {
  return {
    x: L.pad,
    y: Math.round(L.footerRowCenterY - L.startH / 2),
    w: L.startW,
    h: L.startH,
  };
}

/**
 * 「开始战斗」的**中心 x** —— 按钮上那四个字的对齐基准。
 *
 * ⚠️ 这个函数存在的唯一理由是**把那个错位 bug 钉死**：旧版按钮矩形由
 * `pad + (playerColW - startW)/2` 算出（中心 **328**），而文字画在
 * `LOGICAL.width / 2`（**480**）—— 同一个东西两处各算一遍，于是漂了 152px。
 * 现在 `prepareFooter` 的文字**从这里取**，而它又由 `startRect` 推 ——
 * 布局再动也不会漂（单测直接断言"文字中心 = 矩形中心"）。
 */
export function startCenterX(L: PrepareLayout = PREPARE_LAYOUT): number {
  const rect = startRect(L);
  return rect.x + rect.w / 2;
}

/**
 * **操作说明那一格**（按钮右边：`footerRowGap` + `footerHintW`）。
 *
 * ⚠️ 与按钮**同一排**（同一个 `y` / 同一个垂直中心）：用户要的正是
 * "放一排"。`x` 从按钮右边推 —— 于是"按钮与说明"的相对位置只有一处
 * 说了算。
 *
 * ⚠️ `w` 是**格子的宽度上限**（不是文字的实测宽度）：说明左对齐写在
 * 这一格里，文字短就留白 —— 格子宽度不随文案变，切换键盘 / 触屏时
 * 这一排不会左右跳。
 */
export function footerHintSlot(L: PrepareLayout = PREPARE_LAYOUT): Rect {
  const start = startRect(L);
  return {
    x: start.x + start.w + L.footerRowGap,
    y: start.y,
    w: L.footerHintW,
    h: start.h,
  };
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
    const m = sectionMetrics(kind, L);
    const rects = cardGrid(list.length, top, L, {
      colW: m.colW,
      columns: m.columns,
      h: m.cardH,
      minW: m.minW,
      gridRows: windows.first + windows.rows,
    });
    const card = Math.max(1, Math.min(m.columns, list.length));
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
  out.push({ kind: 'start', id: 'start', ...startRect(L) });
  return out;
}

/** 详情区矩形（渲染层只读它，不再自己写数字）。 */
export function detailRect(L: PrepareLayout = PREPARE_LAYOUT): Rect {
  return { x: L.detailX, y: L.detailY, w: L.detailW, h: L.detailH };
}
