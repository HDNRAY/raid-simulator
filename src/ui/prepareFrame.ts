/**
 * **备战屏"画一帧"那一段**：把当前状态摆到已经建好的 Pixi 对象上。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是一帧的**装配清单**：标题写什么字、三块各自在哪一行、哪些卡要画、
 * 哪两块收起（块头说什么）、页脚什么状态、详情区给谁、滚动条画在哪。
 *
 * ==================================================================
 * 为什么从 `PrepareScreen.ts` 切出来（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * 2026-10-13 第二轮（手风琴）动那个文件之前它已经 **697 行**（贴着上限），
 * 而这一轮要加的是"收起那两块怎么画 + 焦点换了块就清悬停"。按 §3 的正确
 * 顺序：**先拆 util / 横向切割**，不压注释。切出去之后两边各自能说清：
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | 本文件 | 状态 → 画面（一帧怎么摆） |
 * | `PrepareScreen.ts` | 输入 → 状态（按键 / 指针怎么改选择） |
 *
 * ⚠️ 这一层**只读**：它不改 `selection` / `free` / `scroll`（那是
 * `PrepareScreen` 的事），所以"谁能改状态"这件事仍然只有一个地方。
 *
 * ==================================================================
 * ⚠️ 2026-10-13 第三轮：卡片区**排不下就滚**（三块共用一套）
 * ==================================================================
 *
 * 用户原话："**现在的 layout 应该可以排更多炁机了，而且炁机排不下就滚动**"。
 *
 * 一帧里"看得见哪些卡"由**一处**决定：`sectionViewportRows`（几何）。
 * 命中区（`prepareGeometry.prepareHitAreas`）读的是**同一个**判据，
 * 所以"看到的卡片"与"点中的卡片"仍然是同一个矩形 —— 这一条是滚动能
 * 成立的前提（各自算一遍偏移必然漂）。
 *
 * ⚠️ 偏移**不是"移动内容层"**（对比 `prepareDetailPanel` 的 `content.y`）：
 * 卡片是**按行算出来**的（`cardGrid` + `gridRows` 裁剪），所以偏移体现在
 * 每张卡的 y 上。两者都对，区别是卡片这里"行"是几何的一部分
 * （命中区也要用），而详情区是自由文字（只能整体位移）。
 *
 * ==================================================================
 * ⚠️ 每帧只改字符串与可见性，**不重建** Text / Graphics
 * ==================================================================
 *
 * 所有对象都由调用方在构造时建好并传进来（`PrepareFrameParts`），本文件
 * 只做 `set()` / `clear()` / 坐标。这是 `Label` / `primitives` 的契约，
 * 也是本仓库的硬约束（每帧 `new Text()` 会重建 GPU 纹理）。
 */

import type { Graphics } from 'pixi.js';
import type { Label } from './primitives';
import type { TranslateFn } from '../i18n/translator';
import { paintScrollBar } from './scrollBarPaint';
import { SECTION_ORDER, type PrepareCounts } from './prepareLayout';
import {
  foldRect,
  foldTextMaxChars,
  prepareHitAreas,
  prepareLabelY,
  rowTopsOf,
  sectionScrollbar,
  type SectionScroll,
} from './prepareGeometry';
import { canStartBattle, isQijiOn, type FreeQiji, type PrepareSelection, type PrepareTarget } from './prepareLogic';
import { cardDrawsOf } from './prepareCardState';
import { foldSummaryOf } from './prepareFold';
import type { PrepareCards } from './prepareCards';
import type { PrepareFoldBars, FoldBarDraw } from './prepareFoldBars';
import type { PrepareFooter } from './prepareFooter';
import type { PrepareDetailController } from './prepareDetailController';
import type { PrepareSectionKind } from './prepareTypes';

/** 一个选项在这一帧要的两样东西（名字 key 由内容表给）。 */
export interface FrameEntry {
  readonly id: string;
  readonly nameKey: string;
}

/**
 * 画一帧要用的"笔"（**构造时建好，永不重建**）。
 *
 * ⚠️ 传进来的是**对象本身**（不是"造一个"的回调）：本层不许新建 Pixi
 * 对象 —— 那正是"每帧重建"的入口。
 */
export interface PrepareFrameParts {
  readonly title: Label;
  readonly sectionLabels: Readonly<Record<PrepareSectionKind, Label>>;
  readonly cards: PrepareCards;
  readonly cardGfx: Graphics;
  readonly foldBars: PrepareFoldBars;
  readonly footer: PrepareFooter;
  readonly detail: PrepareDetailController;
  /** 滚动条那一支笔（三块共用；画在卡片之上）。 */
  readonly scrollGfx: Graphics;
}

/** 一帧要读的状态（全部由 `PrepareScreen` 现取）。 */
export interface PrepareFrameState {
  readonly players: readonly FrameEntry[];
  readonly bosses: readonly FrameEntry[];
  readonly qiji: readonly FrameEntry[];
  readonly selection: PrepareSelection;
  /** 光标此刻指着的那一项（`undefined` = 不在任何卡片上）。 */
  readonly cursor: PrepareTarget | undefined;
  /** 已激活的炁机集合（见 `ui/freeQiji.ts`）。 */
  readonly free: FreeQiji;
  /** 三块各自的滚动偏移（**只读**；改它的是 `PrepareScreen`）。 */
  readonly scroll: SectionScroll;
  readonly translate: TranslateFn;
  /** 这个 id 是不是"开发中"（注入，见 `prepareLogic.canStartBattle`）。 */
  readonly developing: (id: string) => boolean;
}

/** 画一帧。 */
export function drawPrepareFrame(parts: PrepareFrameParts, state: PrepareFrameState): void {
  const t = state.translate;
  const counts: PrepareCounts = {
    players: state.players.length,
    bosses: state.bosses.length,
    qiji: state.qiji.length,
  };
  const expanded = state.selection.expanded;
  /** 能不能开战（灰掉按钮 + 提示行换成"开发中"）。 */
  const developing = !canStartBattle(state.selection, state.developing);

  parts.title.set(t('roster.ui.title'));
  parts.sectionLabels.player.set(t('roster.ui.playerLabel'));
  parts.sectionLabels.qiji.set(t('roster.ui.qijiLabel'));
  parts.sectionLabels.boss.set(t('roster.ui.bossLabel'));

  /**
   * ⚠️ 三个栏目标题的 y **每帧重算**：手风琴一展开别的块，上面那些块的
   * 高度就变了，行顶跟着走（旧版只在构造时算一次，换块就会错位）。
   */
  const labelY = prepareLabelY(counts, expanded);
  parts.sectionLabels.player.root.y = labelY.player;
  parts.sectionLabels.qiji.root.y = labelY.qiji;
  parts.sectionLabels.boss.root.y = labelY.boss;

  const areas = prepareHitAreas(
    state.players,
    state.bosses,
    state.qiji,
    expanded,
    state.scroll,
  );
  const nameOf = (kind: PrepareSectionKind, id: string): string =>
    t(nameKeyOf(state, kind, id));

  parts.cardGfx.clear();
  parts.cards.drawAll(
    cardDrawsOf({
      areas,
      nameOf,
      cursor: state.cursor,
      selection: state.selection,
      on: (id) => isQijiOn(state.free, id),
      developing: state.developing,
    }),
  );

  parts.foldBars.draw(foldDraws(state, counts, expanded));
  drawScrollBars(parts, state, counts, expanded);
  parts.footer.draw(state.selection.focus === 'start', developing);
  parts.detail.update(state.cursor);
}

/**
 * 三块的**滚动条**（只有真能滚的那一块有）。
 *
 * ⚠️ 滑块**出现**本身就是"这一块还有内容在下面"的信号（这一版没有"还能
 * 滚多少"的动画 / 提示行）—— 所以不能只画轨道。
 *
 * ⚠️ 用 `PALETTE` 的既有 token（渲染代码不写死颜色），与详情区那条滚动条
 * 同一个语言：轨道 `panelLine` / 滑块 `textDim`。
 */
function drawScrollBars(
  parts: PrepareFrameParts,
  state: PrepareFrameState,
  counts: PrepareCounts,
  expanded: PrepareSectionKind,
): void {
  const gfx = parts.scrollGfx;
  gfx.clear();
  const tops = rowTopsOf(counts, expanded);
  for (const kind of SECTION_ORDER) {
    /** 收起的两块没有卡片区（只有一条块头），所以没有滚动条。 */
    if (kind !== expanded) continue;
    /**
     * ⚠️ 行顶由**这里**给（`rowTopsOf` 是本文件的输入之一）：滚动条要贴在
     * "这一块现在画在哪一行"上，而"三块怎么摞"是 `prepareGeometry` 的
     * 职责 —— 让 `sectionScrollbar` 自己读它会造出几何文件之间的环。
     */
    const bar = sectionScrollbar(kind, counts, state.scroll, tops[kind]);
    /**
     * **画滚动条 = 共用画笔**（2026-10-22，用户："请统一"）：与图鉴、
     * 详情正文、设置页技能详情**同一份**画法（粗细/颜色/圆角/什么时候画
     * 都在 `ui/scrollBarPaint` 里），几何仍是 `scrollBarGeometry` 那唯一一份。
     */
    paintScrollBar({
      gfx,
      track: { x: bar.trackX, top: bar.trackTop, len: bar.trackH },
      viewportPx: bar.viewportPx,
      maxScrollPx: bar.maxPx,
      scrollPx: bar.scrollPx,
      width: bar.trackW,
    });
  }
}

/**
 * 收起的那两块各要画什么（**只有收起的那两块** —— 展开的那块画卡）。
 *
 * ⚠️ 文案来自 `prepareFold.foldSummaryOf`（纯函数，可在 node 里断言
 * "块头显示的是不是**已确定的选择**"）；这里只把几何配上去。
 */
function foldDraws(
  state: PrepareFrameState,
  counts: PrepareCounts,
  expanded: PrepareSectionKind,
): readonly FoldBarDraw[] {
  const tops = rowTopsOf(counts, expanded);
  const maxChars = foldTextMaxChars();
  const out: FoldBarDraw[] = [];
  for (const kind of SECTION_ORDER) {
    if (kind === expanded) continue;
    const summary = foldSummaryOf({
      kind,
      selection: state.selection,
      players: state.players,
      bosses: state.bosses,
      qiji: state.qiji,
      on: (id) => isQijiOn(state.free, id),
      translate: state.translate,
      maxChars,
    });
    if (summary === undefined) continue;
    out.push({
      kind,
      rect: foldRect(tops[kind]),
      text: summary.text,
      portraitId: summary.portraitId,
    });
  }
  return out;
}

/** 某个选项的名字 key（三块各自一张表；查不到就用 id 兜底，不显示 undefined）。 */
function nameKeyOf(state: PrepareFrameState, kind: PrepareSectionKind, id: string): string {
  const list = kind === 'player' ? state.players : kind === 'boss' ? state.bosses : state.qiji;
  return list.find((e) => e.id === id)?.nameKey ?? id;
}
