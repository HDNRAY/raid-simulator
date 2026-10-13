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
 * 为什么从 `PrepareScreen` 切出来（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * 这一轮给卡片加了**四样东西**：缩小的尺寸、名字右边的头像、炁机卡的开关
 * 态、炁机卡的层数角标。它们全是"一张卡怎么画"，而 `PrepareScreen` 里
 * 还有**输入状态机 / 详情区 / 边角控件**三件不相干的职责 —— 混在一起
 * 就是"一个文件装了整个屏幕的所有小区域"（§3 点名的那个形状，
 * `BattleScene` 为此拆过一轮）。
 *
 * 切出来之后两边各自能用一句话说清：
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | 本文件 | 卡片怎么画（尺寸 / 皮肤 / 名字 / 头像 / 角标） |
 * | `PrepareScreen` | 光标与选择怎么走、每帧把状态喂给谁 |
 *
 * ==================================================================
 * ⚠️ 每帧只改字符串与可见性，**不重建** Text / Graphics
 * ==================================================================
 *
 * 全部对象在 `rebuild()` 里建一次（含"行池"式的卡片数组），`drawOne()`
 * 只做 `set()` / `clear()` / 坐标。这是 `Label` / `primitives` 的契约，
 * 也是本仓库的硬约束。
 */

import type { Container, Graphics } from 'pixi.js';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { PREPARE_LAYOUT } from './prepareLayout';
import { CARD_RADIUS, CARD_STROKE, CURSOR_RING_GAP, PREPARE_SKIN } from './prepareRender';
import { portraitFor } from '../render/portraitAssets';
import { PortraitSprite } from '../render/portraitSprite';

/** 命中区里要用到的那几个数（`PrepareHitArea` 满足它）。 */
export interface CardRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 一张卡每帧要画的样子（由 `PrepareScreen` 算好）。 */
export interface CardState extends CardRect {
  /** 要显示的名字（**已本地化**）。 */
  readonly name: string;
  readonly nameColor: number;
  readonly fillColor: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeWidth: number;
  /** 要不要在卡片外面套一圈光标环（见 `prepareRender.CardSkin.ring`）。 */
  readonly ring: boolean;
  readonly ringColor: number;
  /** 画"已开"角标（炁机卡；只在超过 1 层时为真）。 */
  readonly badge: boolean;
  /**
   * **名字右边那颗对话头像要不要画**。
   *
   * ⚠️ 只有"这一格有头像素材"的卡才有意义（素材表在
   * `render/portraitAssets`）—— 传 `true` 而那一格没有素材时会被忽略
   * （`drawOne` 里 `portrait === undefined` 那一支）。
   */
  readonly showPortrait: boolean;
}

/** 一张卡持有的 Pixi 对象（构造时建好，永不重建）。 */
interface CardParts {
  readonly name: Label;
  readonly portrait: PortraitSprite | undefined;
}

/**
 * 每张卡"要画成什么样"（`PrepareScreen` 算好之后逐项传进来）。
 *
 * ⚠️ 它是 `CardState` 去掉**位置**（位置来自命中区，见 `drawAll`）——
 * 于是"卡片画在哪"只有一处真相。
 */
export type CardPaint = Omit<CardState, 'x' | 'y' | 'w' | 'h'>;

export class PrepareCards {
  private readonly parts: CardParts[] = [];

  /**
   * @param parents 标签与头像要挂上的容器（同一个 root；顺序即层序）。
   *   ⚠️ 头像挂在 `parents` 上而**不是**挂在卡片自己的 Graphics 上：
   *   Graphics 是一整层（所有卡片画在同一层），Sprite 挂进去会被那一层
   *   的绘制顺序牵着走。
   */
  constructor(
    pixi: PixiCtor,
    private readonly gfx: Graphics,
    private readonly parents: Container,
    /** 每个卡位一个 id（决定有没有头像素材；没有素材的卡不建 Sprite）。 */
    ids: readonly string[],
  ) {
    for (const id of ids) {
      const name = new Label(pixi, {
        x: 0,
        y: 0,
        size: PREPARE_LAYOUT.nameSize,
        color: PALETTE.text,
        kai: true,
      });
      /**
       * ⚠️ 头像只有**配了对的**才有素材（`render/portraitAssets`）：炁机
       * 与 Boss 都没有对话头像 —— 那两类不建 Sprite（少一个对象，也少
       * 一次无谓的贴图请求）。
       */
      const asset = portraitFor(id);
      const portrait =
        asset === undefined
          ? undefined
          : new PortraitSprite(pixi, this.parents, asset, PREPARE_LAYOUT.portraitBox);
      this.parts.push({ name, portrait });
      this.parents.addChild(name.root);
    }
  }

  /** 卡片张数（`PrepareScreen` 用它把"卡片 ↔ 命中区"对齐）。 */
  get count(): number {
    return this.parts.length;
  }

  /**
   * 画**全部**卡片。
   *
   * ⚠️ 位置取自 `areas`（命中区）而**不是**另算一遍几何：这是"看到的卡片
   * 与点中的卡片是同一个矩形"的结构保证（两处各算一遍必然在改布局时错位）。
   * ⚠️ `paints[i]` 与 `areas[i]` 必须同序（都由 `PrepareScreen` 按
   * 人物 → 炁机 → Boss 拼出来）。
   */
  drawAll(areas: readonly CardRect[], paints: readonly CardPaint[]): void {
    for (let i = 0; i < this.parts.length; i += 1) {
      const area = areas[i];
      const paint = paints[i];
      if (area === undefined || paint === undefined) continue;
      this.drawOne(i, { ...paint, x: area.x, y: area.y, w: area.w, h: area.h });
    }
  }

  /** 全部隐藏（详情区替换整屏内容时用不到，但显隐要一致）。 */
  setVisible(visible: boolean): void {
    for (const part of this.parts) {
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
  drawOne(index: number, state: CardState): void {
    const part = this.parts[index];
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
