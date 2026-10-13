/**
 * **备战屏"画一帧"那一段**：把当前状态摆到已经建好的 Pixi 对象上。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是一帧的**装配清单**：标题写什么字、三块各自在哪一行、哪些卡要画、
 * 哪两块收起（块头说什么）、页脚什么状态、详情区给谁。
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
 * ⚠️ 这一层**只读**：它不改 `selection` / `free`（那是 `PrepareScreen`
 * 的事），所以"谁能改状态"这件事仍然只有一个地方。
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
import { SECTION_ORDER, type PrepareCounts } from './prepareLayout';
import {
  foldRect,
  foldTextMaxChars,
  prepareHitAreas,
  prepareLabelY,
  rowTopsOf,
} from './prepareGeometry';
import { canStartBattle, stacksIn, type FreeQiji, type PrepareSelection, type PrepareTarget } from './prepareLogic';
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
}

/** 一帧要读的状态（全部由 `PrepareScreen` 现取）。 */
export interface PrepareFrameState {
  readonly players: readonly FrameEntry[];
  readonly bosses: readonly FrameEntry[];
  readonly qiji: readonly FrameEntry[];
  readonly selection: PrepareSelection;
  /** 光标此刻指着的那一项（`undefined` = 不在任何卡片上）。 */
  readonly cursor: PrepareTarget | undefined;
  readonly free: FreeQiji;
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

  const areas = prepareHitAreas(state.players, state.bosses, state.qiji, expanded);
  const nameOf = (kind: PrepareSectionKind, id: string): string =>
    t(nameKeyOf(state, kind, id));

  parts.cardGfx.clear();
  parts.cards.drawAll(
    cardDrawsOf({
      areas,
      nameOf,
      cursor: state.cursor,
      selection: state.selection,
      stacks: (id) => stacksIn(state.free, id),
      developing: state.developing,
    }),
  );

  parts.foldBars.draw(foldDraws(state, counts, expanded));
  parts.footer.draw(state.selection.focus === 'start', developing);
  parts.detail.update(state.cursor);
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
      stacks: (id) => stacksIn(state.free, id),
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
