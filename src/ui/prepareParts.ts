/**
 * **备战屏的部件怎么造**（一次）：底色 / 标题 / 三块栏目标题 / 卡片画笔 /
 * 块头画笔 / 页脚 / 详情区 / 边角控件，外加"一帧要用的那组笔"。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏**构造期的全部 Pixi 对象**：造好之后交给 `PrepareScreen`
 * （输入 → 状态）与 `prepareFrame`（状态 → 画面）各自使用，**永不重建**。
 *
 * ==================================================================
 * 为什么从 `PrepareScreen.ts` 切出来（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * 2026-10-13 第二轮之后那个文件 **705 行**（超上限 5 行），而它里面混着
 * 三件事：**造部件** / **输入路由** / **只读读数**。造部件是其中最独立
 * 的一块（它只依赖 `PrepareScreenOptions`，不碰任何状态机），所以按 §3 的
 * 正确顺序做了**横向切割** —— 不是压注释。
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | 本文件 | 这一屏的部件怎么造（一次） |
 * | `PrepareScreen.ts` | 输入怎么改状态、每帧把状态喂给谁 |
 * | `prepareFrame.ts` | 状态怎么变成画面 |
 *
 * ⚠️ **层序在这里定死**：底色 → 卡片笔 → 块头笔 → 名称 → 标题 →
 * 页脚 → 详情区 → 边角控件（后加的在上层）。这一条只在本文件里出现一次。
 *
 * ⚠️ `detailContext` 的两个闭包读的是**活的状态**（`stacks` / `cap`），
 * 所以它们由调用方以**函数**传进来，而不是传一份值 —— 传值会让"层数变了
 * 但详情区还显示上一帧的层数"这种 bug 回来（见 `prepareDetail.DetailContext`）。
 */

import type { Container } from 'pixi.js';
import { LOGICAL } from './layout';
import { Label } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { PREPARE_LAYOUT, type PrepareCounts } from './prepareLayout';
import type { PrepareScreenOptions } from './prepareOptions';
import { prepareLabelY } from './prepareGeometry';
import { PrepareCards } from './prepareCards';
import { PrepareFoldBars } from './prepareFoldBars';
import { PrepareFooter } from './prepareFooter';
import { PrepareDetailController } from './prepareDetailController';
import type { DetailContext } from './prepareDetail';
import type { PrepareFrameParts } from './prepareFrame';
import type { PrepareSelection } from './prepareLogic';

/** 造好的部件（`PrepareScreen` 持有它，`prepareFrame` 只读其中一组）。 */
export interface PrepareParts {
  readonly root: Container;
  /** 卡片那支画笔（**按 (kind, id) 查表**，见 `prepareCards` 的说明）。 */
  readonly cards: PrepareCards;
  /** 收起那两块的块头（文案来自 `prepareFold`）。 */
  readonly foldBars: PrepareFoldBars;
  readonly footer: PrepareFooter;
  /** 详情区（右侧）：悬停 + 光标的合流在这一层（见 `prepareDetailController`）。 */
  readonly detailPanel: PrepareDetailController;
  /** 详情区的数据上下文（探针读 `detailModel()` 要用）。 */
  readonly detailContext: DetailContext;
  /**
   * 本屏自己的边角控件（右上角齿轮 + 左上角返回箭头）。
   *
   * ⚠️ 用户 2026-10-12："多个页面的齿轮，应该分别定义"、"stage 上理论上
   * 不挂任何小组件" —— 两个按钮都在本屏的 root 里。
   */
  readonly chrome: ScreenChrome;
  /** 一帧要用的那组笔（交给 `prepareFrame`）。 */
  readonly frameParts: PrepareFrameParts;
}

export interface PreparePartsArgs {
  readonly options: PrepareScreenOptions;
  /** 进场时的选择（栏目标题的初始 y 由它决定）。 */
  readonly selection: PrepareSelection;
  readonly counts: PrepareCounts;
  /** 某条炁机**此刻**的层数（活闭包，见文件头）。 */
  readonly stacks: (id: string) => number;
  /** 某条炁机的层数上限（活闭包）。 */
  readonly cap: (id: string) => number;
}

/** 造齐这一屏的全部 Pixi 对象（只调用一次）。 */
export function buildPrepareParts(args: PreparePartsArgs): PrepareParts {
  const { options, counts, selection } = args;
  const { pixi } = options;

  const root = new pixi.Container();
  root.visible = false;

  /** 整屏底色（备战界面要盖住战斗场景）。 */
  const bg = new pixi.Graphics();
  bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
  root.addChild(bg);

  const title = new Label(pixi, {
    x: LOGICAL.width / 2,
    y: 54, // 标题基线（见 `prepareLayout` 的布局表）
    size: 32,
    color: PALETTE.text,
    anchorX: 0.5,
    anchorY: 0.5,
    kai: true,
  });

  /**
   * 栏目标题（「选择人物」/「炁机」/「选择对手」）。
   *
   * ⚠️ 字号来自布局表、**y 每帧由 `prepareFrame` 重算**（手风琴一展开
   * 别的块，行顶就变，标题必须跟着走 —— 旧版只在构造时算一次）。
   */
  const label = (y: number): Label =>
    new Label(pixi, {
      x: PREPARE_LAYOUT.pad,
      y,
      size: PREPARE_LAYOUT.labelSize,
      color: PALETTE.textDim,
    });
  const labelY = prepareLabelY(counts, selection.expanded);
  const playerLabel = label(labelY.player);
  const qijiLabel = label(labelY.qiji);
  const bossLabel = label(labelY.boss);

  const cardGfx = new pixi.Graphics();
  /** 收起那两块「块头」的一支笔（与卡片分开：各清各的层）。 */
  const foldGfx = new pixi.Graphics();
  /**
   * **滚动条那一支笔**（三块共用一支，见 `prepareFrame.drawScrollBars`）。
   *
   * ⚠️ 它画在卡片**之上**（后加 = 上层）：滚动条压在卡片列最右那条
   * `scrollGutter` 里，不该被卡片底板盖掉。
   */
  const scrollGfx = new pixi.Graphics();
  root.addChild(
    cardGfx,
    foldGfx,
    scrollGfx,
    playerLabel.root,
    qijiLabel.root,
    bossLabel.root,
    title.root,
  );

  /**
   * 卡片上的文字与头像 —— 传**全部**卡位（三块的都传），因为它们随时
   * 可能变成"展开那一块"；"这一帧画哪几张"由 `drawAll` 的入参决定。
   *
   * ⚠️ 人物在前、炁机在中、Boss 在后（与 `SECTION_ORDER` 同序）只是为了
   * 层序稳定 —— 名字画到哪张卡上由 **(kind, id) 查表**决定，不再依赖
   * 下标对齐（见 `prepareCards` 文件头）。
   */
  const cards = new PrepareCards(pixi, cardGfx, root, [
    ...options.players.map((e) => ({ kind: 'player' as const, id: e.id })),
    ...options.qiji.map((e) => ({ kind: 'qiji' as const, id: e.id })),
    ...options.bosses.map((e) => ({ kind: 'boss' as const, id: e.id })),
  ]);
  const foldBars = new PrepareFoldBars({ pixi, gfx: foldGfx, parent: root });

  const footer = new PrepareFooter({
    pixi,
    parent: root,
    translate: options.translate,
    /**
     * ⚠️ 它决定提示行写**键盘版还是触屏版**（见 `PrepareFooter.draw`）。
     * 取值函数而不是布尔：操作方式可以在「通用」页里当场改（§3b 的
     * 唯一 flag），每帧读一次才不会停在进场时的那一套。
     */
    showKeyHints: options.showKeyHints,
    /** ⚠️ 按钮的位置由张数算出来（见 `prepareGeometry.startRect`）。 */
    counts,
  });

  /**
   * ⚠️ 上下文**只建一次**：它的每个取值函数都接在静态内容表上，而
   * "此刻几层"由 `qijiStacks` 现取（`stacks` 是**活闭包**，
   * 所以层数一变它自己就是新的）。
   */
  const detailContext = options.detailContext({ stacks: args.stacks, cap: args.cap });
  const detailPanel = new PrepareDetailController({
    pixi,
    translate: options.translate,
    parent: root,
    context: detailContext,
  });

  /** 齿轮 + 返回箭头（最后加 = 最上层）。 */
  const chrome = new ScreenChrome({
    pixi,
    showKeyHints: options.showKeyHints,
    f1Label: options.f1Label,
    onGear: options.onGear,
    onBack: options.onBack,
  });
  root.addChild(chrome.root);

  return {
    root,
    cards,
    foldBars,
    footer,
    detailPanel,
    detailContext,
    chrome,
    frameParts: {
      title,
      sectionLabels: { player: playerLabel, qiji: qijiLabel, boss: bossLabel },
      cards,
      cardGfx,
      foldBars,
      footer,
      detail: detailPanel,
      scrollGfx,
    },
  };
}
