/**
 * **备战屏卡片的那一支画笔**：造一次对象，每帧按调用方给的状态重画。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它负责**一张卡的样子**：底板（圆角 + 描边 + 光标外环）、名字的摆放、
 * 名字右边那颗对话头像（含"没加载完"的占位方框）、以及炁机卡"已开"
 * 的角标。
 *
 * ==================================================================
 * ⚠️ 2026-10-13 第二轮：按 **(kind, id) 查表**，不再按下标对齐
 * ==================================================================
 *
 * 旧版靠"命中区域数组的下标 = 卡片对象数组的下标"对齐，而那个约定的
 * 代价写在旧注释里："两处顺序一漂，卡片上的名字就会画到别人的命中区上
 * —— 而那看起来像'点谁都不对'"。
 *
 * 手风琴让这个约定**直接不成立**：收起的那两块不画卡，于是"这一帧要画的
 * 卡"只是全部卡的一个**子集**（展开那一块的那些）。按下标就会把炁机的
 * 名字画到对手的卡上。所以现在按 `${kind}:${id}` 查表 —— 顺序漂移这个
 * 失效模式**从结构上消失**（不是"记住了别漂"）。
 *
 * ==================================================================
 * ⚠️ 每帧只改字符串与可见性，**不重建** Text / Graphics
 * ==================================================================
 *
 * 全部对象在构造时建一次（每人一张卡一份），`drawOne()` 只做 `set()` /
 * `clear()` / 坐标。这是 `Label` / `primitives` 的契约，也是本仓库的
 * 硬约束（每帧 `new Text()` 会重建 GPU 纹理）。
 */

import type { Container, Graphics } from 'pixi.js';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { PREPARE_LAYOUT } from './prepareLayout';
import { CARD_RADIUS, CARD_STROKE, CURSOR_RING_GAP, PREPARE_SKIN } from './prepareRender';
import { portraitFor } from '../render/portraitAssets';
import { PortraitSprite } from '../render/portraitSprite';
import type { CardDraw } from './prepareCardState';
import type { PrepareSectionKind } from './prepareTypes';

/** 一张卡持有的 Pixi 对象（构造时建好，永不重建）。 */
interface CardParts {
  readonly name: Label;
  readonly portrait: PortraitSprite | undefined;
}

/** 卡片在表里的键（画与查都用它 —— 顺序不再参与）。 */
function cardKey(kind: PrepareSectionKind, id: string): string {
  return `${kind}:${id}`;
}

export class PrepareCards {
  private readonly parts = new Map<string, CardParts>();

  /**
   * @param keys 每个卡位的 `(kind, id)`（决定有没有头像素材）。
   *   ⚠️ 传**全部**卡位（三块的都传），因为它们随时可能变成"展开那一块"；
   *   "这一帧画哪几张"由 `drawAll` 的入参决定。
   * @param parents 标签与头像要挂上的容器（同一个 root；顺序即层序）。
   *   ⚠️ 头像挂在 `parents` 上而**不是**挂在卡片自己的 Graphics 上：
   *   Graphics 是一整层（所有卡片画在同一层），Sprite 挂进去会被那一层
   *   的绘制顺序牵着走。
   */
  constructor(
    pixi: PixiCtor,
    private readonly gfx: Graphics,
    private readonly parents: Container,
    keys: readonly { readonly kind: PrepareSectionKind; readonly id: string }[],
  ) {
    for (const key of keys) {
      /**
       * ⚠️ 字号**按块给**（炁机 15、人物 / 对手 17，见 `prepareLayout`）：
       * 同一个 `Label` 的字号在构造期定死（`Label` 的契约是"只改文本 /
       * 颜色 / 坐标"），所以每张卡在造的时候就要知道自己那一块的字号。
       */
      const name = new Label(pixi, {
        x: 0,
        y: 0,
        size: key.kind === 'qiji' ? PREPARE_LAYOUT.qijiNameSize : PREPARE_LAYOUT.nameSize,
        color: PALETTE.text,
        kai: true,
      });
      /**
       * ⚠️ 头像只有**配了对的**才有素材（`render/portraitAssets`）：炁机
       * 与 Boss 都没有对话头像 —— 那两类不建 Sprite（少一个对象，也少
       * 一次无谓的贴图请求）。
       */
      const asset = portraitFor(key.id);
      const portrait =
        asset === undefined
          ? undefined
          : new PortraitSprite(pixi, this.parents, asset, PREPARE_LAYOUT.portraitBox);
      this.parts.set(cardKey(key.kind, key.id), { name, portrait });
      this.parents.addChild(name.root);
    }
  }

  /** 卡片张数（构造时登记了几个卡位）。 */
  get count(): number {
    return this.parts.size;
  }

  /**
   * 画**这一帧要画的那几张卡**（手风琴里 = 展开那一块的全部卡）。
   *
   * ⚠️ 每张卡的矩形取自入参（**命中区域的同一份几何**，见 `cardDrawsOf`）。
   * ⚠️ 不在入参里的卡**先全部藏起来**：收起那两块的卡不能"留在上一帧的
   * 位置上"（那既画错了，也不该还能被点中 —— 命中区里已经没有它们）。
   */
  drawAll(cards: readonly CardDraw[]): void {
    for (const part of this.parts.values()) {
      part.name.root.visible = false;
      part.portrait?.setVisible(false);
    }
    for (const card of cards) this.drawOne(card);
  }

  /** 全部隐藏（显隐要一致，见 `PrepareScreen.setVisible`）。 */
  setVisible(visible: boolean): void {
    for (const part of this.parts.values()) {
      part.name.root.visible = visible;
      part.portrait?.setVisible(visible);
    }
  }

  /**
   * 画一张卡。
   *
   * ⚠️ 名字**水平居中**、头像永远在**名字右边**（需求原文），而头像的 x
   * 跟着**名字的实际宽度**走 —— 固定偏移会让"凯丽"（两个字）与"林晚风"
   * （三个字）的头像不在同一列。`Text.width` 是 Pixi 算好的测量值，
   * 只在文字变化后才变，所以这里每帧读它是安全的。
   */
  private drawOne(state: CardDraw): void {
    const part = this.parts.get(cardKey(state.kind, state.id));
    if (part === undefined) return;
    const { x, y, w, h } = state;

    this.gfx
      .roundRect(x, y, w, h, CARD_RADIUS)
      .fill({ color: state.fillColor, alpha: state.fillAlpha });
    this.gfx
      .roundRect(x, y, w, h, CARD_RADIUS)
      .stroke({ color: state.strokeColor, width: state.strokeWidth });

    part.name.set(state.name);
    part.name.setColor(state.nameColor);
    part.name.root.visible = true;
    part.name.root.y = y + h / 2 - PREPARE_LAYOUT.nameLineH / 2;

    const portrait = part.portrait;
    if (!state.showPortrait || portrait === undefined) {
      /**
       * ⚠️ 卡上没有头像时名字**居中**：炁机卡 / Boss 卡的名字居中更好看，
       * 而人物卡有头像时名字 + 头像**整块**要居中 —— 两种排布由
       * `state.showPortrait` 分。
       */
      part.name.root.x = x + w / 2 - part.name.root.width / 2;
      portrait?.setVisible(false);
    } else {
      const box = PREPARE_LAYOUT.portraitBox;
      const nameW = part.name.root.width;
      const gap = PREPARE_LAYOUT.nameAvatarGap;
      /** 名字 + 间距 + 头像**整块**居中。 */
      const blockW = nameW + gap + box;
      part.name.root.x = x + w / 2 - blockW / 2;
      portrait.setVisible(true);
      portrait.root.x = part.name.root.x + nameW + gap + box / 2;
      portrait.root.y = y + h / 2;
      /**
       * ⚠️ 贴图没到之前画一个**占位方框**：不画的话卡片右边会凭空缺一块
       * （而"没加载完"与"没有这个素材"看起来就不一样了）。
       */
      if (!portrait.ready) {
        this.gfx
          .roundRect(portrait.root.x - box / 2, portrait.root.y - box / 2, box, box, 3)
          .fill({ color: PALETTE.bgTop, alpha: 0.5 });
        this.gfx
          .roundRect(portrait.root.x - box / 2, portrait.root.y - box / 2, box, box, 3)
          .stroke({ color: PALETTE.panelLine, width: 1, alpha: 0.9 });
      }
    }

    if (state.badge) {
      /**
       * ⚠️ 角标画在**卡片内部右上角**（不越出卡片）：越出去会与邻卡的
       * 描边叠在一起，看起来像那颗标记属于旁边那张卡。
       *
       * ⚠️ 角标是**一颗实心圆点**（不写数字）：数字要另一个 Label（每张卡
       * 一份），而它的信息 —— 开了几层 —— 详情区里有确切数字。
       * 这里只需要"它比一层更多"这一个信号。
       */
      const r = 4;
      this.gfx
        .circle(x + w - PREPARE_LAYOUT.cardPad + 2, y + PREPARE_LAYOUT.cardPad - 2, r)
        .fill({ color: PREPARE_SKIN.selectionLine });
      this.gfx
        .circle(x + w - PREPARE_LAYOUT.cardPad + 2, y + PREPARE_LAYOUT.cardPad - 2, r)
        .stroke({ color: PALETTE.text, width: 1, alpha: 0.8 });
    }

    /** 光标外环（两种情况为真，见 `prepareRender.CardSkin.ring`）。 */
    if (state.ring) {
      this.gfx
        .roundRect(
          x - CURSOR_RING_GAP,
          y - CURSOR_RING_GAP,
          w + CURSOR_RING_GAP * 2,
          h + CURSOR_RING_GAP * 2,
          CARD_RADIUS + CURSOR_RING_GAP,
        )
        .stroke({ color: state.ringColor, width: CARD_STROKE.cursor });
    }
  }
}
