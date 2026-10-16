/**
 * **收起态的「块头」那一支画笔**（手风琴收起来的两块怎么画）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它画"被收起的那一块"：一条横跨卡片列的浅底长条，里面写着**当前选的是
 * 什么**（人物 = 头像 + 名字；对手 = 名字；炁机 = 已激活哪几条）。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * 它与 `prepareCards` 是**两种东西**：
 *
 * | 文件 | 画什么 | 点它是做什么 |
 * |---|---|---|
 * | `prepareCards` | 展开那一块的卡片（可多行、带光标环/选中金） | 选它 / 改层数 |
 * | 本文件 | 收起那两块的**块头**（一行、无选中态） | **只展开**那一块 |
 *
 * 混进卡片那支画笔会让它同时服务"可点的选项"与"一块的摘要"，而两者的
 * 状态（光标 / 选中 / 层数 vs 什么都不看）完全不一样。
 *
 * ==================================================================
 * ⚠️ 每帧只改字符串与可见性，**不重建** Text / Graphics
 * ==================================================================
 *
 * 三个 Label 与那一颗头像在构造时建好（头像**懒建一次**，见 `draw`），
 * 每帧只做 `set()` / `clear()` / 坐标 —— 与 `prepareCards` 同一条纪律。
 */

import type { Container, Graphics } from 'pixi.js';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { PREPARE_LAYOUT, SECTION_ORDER } from './prepareLayout';
import type { Rect } from './prepareGeometry';
import { CARD_RADIUS, cardSkin, centeredTextTopY } from './prepareRender';
import { portraitFor } from '../render/portraitAssets';
import { PortraitSprite } from '../render/portraitSprite';
import type { PrepareSectionKind } from './prepareTypes';

/**
 * 一条块头要画的东西（`foldSummaryOf` 的产物 + 几何）。
 *
 * ⚠️ `kind` 是**泛型**（2026-10-16）：肉鸽确认屏要画的第三行是
 * 「恶魔低语」，它不属于备战屏那三个手风琴块（`PrepareSectionKind`）。
 * 把那个联合塞进 `PrepareSectionKind` 会逼**备战屏**也认一个它永远没有的
 * 块（它的边框是 `Record<PrepareSectionKind, Label>`）—— 所以这里只要求
 * "某个能当槽位名的字符串"，各屏用自己的联合。
 */
export interface FoldBarDraw<T extends string = PrepareSectionKind> {
  readonly kind: T;
  /** 画出来的那一条（`prepareLayout.foldRect`）。 */
  readonly rect: Rect;
  /** **已本地化**的那行字（见 `prepareFold`）。 */
  readonly text: string;
  readonly portraitId?: string | undefined;
  /**
   * 这一条此刻是不是**焦点所在**（2026-10-15 加；目前只有肉鸽确认屏会传）。
   *
   * ⚠️ 备战屏**永远不传**：那里的焦点是"哪一块展开"，而收起的两块不可能
   * 有焦点（见文件头）。确认屏两行**全是只读块头**，焦点就落在它们身上 ——
   * 不给个可见的光标态就会出现"Tab 切过去画面没变、右侧详情却换了"
   * （最难查的那类：看不出按没按上）。
   */
  readonly focused?: boolean;
}

export interface PrepareFoldBarsOptions {
  readonly pixi: PixiCtor;
  /** 与卡片共用的那一层 `Graphics`（整屏只有一支笔，见 `PrepareScreen`）。 */
  readonly gfx: Graphics;
  /** 标签与头像挂上去的容器（同一个 root）。 */
  readonly parent: Container;
}

export class PrepareFoldBars<T extends string = PrepareSectionKind> {
  private readonly pixi: PixiCtor;
  private readonly gfx: Graphics;
  private readonly parent: Container;
  /** 每个槽位一条（只有收起的那两块会被画，第三条永远藏着）。 */
  private readonly labels = new Map<T, Label>();
  /**
   * 块头上的那一颗头像（**只有人物有素材**）。
   *
   * ⚠️ 懒建一次：构造时不知道"哪一块会收起"，而每帧新建 `Sprite` 是
   * 本仓库点名禁止的形状（见文件头）。所以第一次真需要它时才建，之后
   * 只 `setAsset`（`setVisible` 管显隐）。
   */
  private portrait: PortraitSprite | undefined;
  private portraitId: string | undefined;

  constructor(options: PrepareFoldBarsOptions) {
    this.pixi = options.pixi;
    this.gfx = options.gfx;
    this.parent = options.parent;
    /**
     * ⚠️ **懒建**（2026-10-16 泛型化之后改的）：`SECTION_ORDER` 是**备战屏**
     * 那三个块的名字，而泛型参数可以是别的字符串（确认屏的「恶魔低语」）。
     * 所以标签按"第一次画到这一块"建 —— 与上面那颗头像同一条纪律
     * （构造时不假设"会有哪几块"）。
     */
    void SECTION_ORDER;
    for (const kind of [] as T[]) {
      const label = new Label(this.pixi, {
        x: 0,
        y: 0,
        size: PREPARE_LAYOUT.nameSize,
        color: PALETTE.text,
        kai: true,
      });
      this.labels.set(kind, label);
      this.parent.addChild(label.root);
    }
  }

  /** 这一块的标签（没有就建一个 —— 见构造里那段"懒建"）。 */
  private labelOf(kind: T): Label {
    const existing = this.labels.get(kind);
    if (existing !== undefined) return existing;
    const label = new Label(this.pixi, {
      x: 0,
      y: 0,
      size: PREPARE_LAYOUT.nameSize,
      color: PALETTE.text,
      kai: true,
    });
    this.labels.set(kind, label);
    this.parent.addChild(label.root);
    return label;
  }

  /**
   * 画**收起的那几块**（展开的那块不传进来）。
   *
   * ⚠️ 位置取自调用方给的 `rect`（=`prepareLayout.foldRect`），本组件不
   * 自己算几何 —— 与卡片同一条纪律："看到的"与"点中的"是同一个矩形。
   */
  draw(bars: readonly FoldBarDraw<T>[]): void {
    this.gfx.clear();
    /**
     * 焦点那一条用**光标皮肤**（冷白）：与卡片上的光标**同一个颜色语言**
     * （`cardSkin({ cursored: true })`）—— 本作里"光标"只有这一种画法。
     */
    const cursorSkin = cardSkin({ developing: false, cursored: true, selected: false });
    const drawn = new Set<T>();
    for (const bar of bars) {
      drawn.add(bar.kind);
      const { x, y, w, h } = bar.rect;
      const centerY = y + h / 2;

      this.gfx
        .roundRect(x, y, w, h, CARD_RADIUS)
        .fill({
          color: bar.focused === true ? cursorSkin.fillColor : PALETTE.panel,
          alpha: bar.focused === true ? cursorSkin.fillAlpha : 0.55,
        });
      this.gfx
        .roundRect(x, y, w, h, CARD_RADIUS)
        .stroke({
          color: bar.focused === true ? cursorSkin.strokeColor : PALETTE.panelLine,
          width: bar.focused === true ? cursorSkin.strokeWidth : 1,
          alpha: bar.focused === true ? 1 : 0.8,
        });

      const label = this.labelOf(bar.kind);
      const box = PREPARE_LAYOUT.portraitBox;
      const gap = PREPARE_LAYOUT.nameAvatarGap;
      const pad = PREPARE_LAYOUT.cardPad;
      const hasPortrait = this.placePortrait(bar, x + pad + box / 2, centerY);
      label.set(bar.text);
      label.setColor(bar.focused === true ? cursorSkin.nameColor : PALETTE.text);
      label.root.x = x + pad + (hasPortrait ? box + gap : 0);
      /**
       * ⚠️ 与卡片同一条：**按实测盒高**垂直居中（不是 `nameLineH / 2`）。
       * 块头这一行比卡片上的字更明显 —— 它两边都是空的，偏 3px 一眼看得出。
       * ⚠️ `set()` 在**前**（盒高跟着文本变）。
       */
      label.root.y = centeredTextTopY(y, h, label.root.height);
      label.root.visible = true;
    }
    /** 没画的两块：连字带脸一起藏掉（否则会停在上一帧的位置）。 */
    for (const [kind, label] of this.labels) {
      if (!drawn.has(kind)) label.root.visible = false;
    }
    if (!bars.some((b) => b.portraitId !== undefined)) this.portrait?.setVisible(false);
  }

  /**
   * 把头像摆到块头左端（人物专用）。
   *
   * @returns 有没有真的画（没素材 / 没配对 = `false`，调用方据此决定
   *   文字要不要让位）。
   */
  private placePortrait(bar: FoldBarDraw<T>, x: number, y: number): boolean {
    const id = bar.portraitId;
    if (id === undefined) return false;
    const asset = portraitFor(id);
    if (asset === undefined) return false;
    if (this.portrait === undefined) {
      this.portrait = new PortraitSprite(this.pixi, this.parent, asset, PREPARE_LAYOUT.portraitBox);
      this.portraitId = id;
    } else if (this.portraitId !== id) {
      /** ⚠️ 换了个人：`setAsset` 自己会判"同一张就不重载"。 */
      this.portrait.setAsset(asset);
      this.portraitId = id;
    }
    this.portrait.setVisible(true);
    this.portrait.root.x = x;
    this.portrait.root.y = y;
    return true;
  }
}
