/**
 * **备战屏底部那条**：开始按钮 + 操作提示 + 第三方素材声明。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是屏幕**下半部分那一条**的画法：一颗居中的「开始战斗」、它下面一行
 * 随状态变化的提示、以及贴底边的素材声明。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * `PrepareScreen` 这一轮加了三样东西（详情区、炁机行、卡片头像），
 * 而这三件与"按钮怎么画"毫无关系。把它们都留在那个类里，它就会变成
 * "一个文件装了整个屏幕"（§3 点名的形状）。抽出来之后：
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | 本文件 | 底部那一条（按钮 / 提示 / 声明）怎么画 |
 * | `PrepareScreen` | 光标与选择怎么走 |
 *
 * ==================================================================
 * ⚠️ 提示行承担一个**反馈职责**
 * ==================================================================
 *
 * 需求："不能开始战斗（选中它们时点开始应当无效，**或给明确反馈**）"。
 * 选中开发中的单位时，这一行从操作说明换成"开发中"三个字 ——
 * 而它**常驻**（不是点了才出现），所以玩家在点之前就看得见为什么点不动。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { PREPARE_LAYOUT } from './prepareLayout';
import { CARD_RADIUS, PREPARE_SKIN, startSkin } from './prepareRender';
import type { TranslateFn } from '../i18n/translator';

export interface PrepareFooterOptions {
  readonly pixi: PixiCtor;
  readonly parent: Container;
  /**
   * 取词函数。
   *
   * ⚠️ 存在**构造参数**上（而不是构造之后再 `setTranslate`）：后者会在
   * "还没装好就被 `draw` 一次"时静默显示空字符串 —— 而空白的按钮比报错
   * 难查得多。
   */
  readonly translate: TranslateFn;
}

export class PrepareFooter {
  private readonly gfx: Graphics;
  private readonly startLabel: Label;
  private readonly hint: Label;
  private readonly notice: Label;

  constructor(private readonly options: PrepareFooterOptions) {
    const { pixi, parent } = options;
    this.gfx = new pixi.Graphics();

    this.startLabel = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: PREPARE_LAYOUT.startY + PREPARE_LAYOUT.startH / 2,
      size: FONT.body,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      /**
       * ⚠️ 提示行贴在**炁机块下面**（不是按钮下面 —— 按钮已经挪到炁机行
       * 右侧了，见 `startY`）。它与素材声明之间的间距由布局测试盯着。
       */
      y: PREPARE_LAYOUT.startY + PREPARE_LAYOUT.startH + 10,
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    /**
     * 页脚声明：贴屏幕**底边**。
     *
     * ⚠️ 它不是装饰，是**权利归属的标示**（素材取自《炎龍騎士團2》）。
     * 字号用 `FONT.small`(13) 而不是 `FONT.tiny`(11) —— 中文有 13 的
     * 下限（见 `layout.ts` 的字号表）。
     */
    this.notice = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: LOGICAL.height - 16,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });

    parent.addChild(this.gfx, this.startLabel.root, this.hint.root, this.notice.root);
  }

  /**
   * 「开始战斗」的矩形（命中测试与渲染**共用** `PREPARE_LAYOUT` 的推导）。
   *
   * ⚠️ x 靠**卡片列右边缘**（不是水平居中）：它要躲开炁机那一行的卡片，
   * 而"躲到哪儿"由列宽与按钮宽一起决定 —— 见 `startY` 的说明。
   */
  static startRect(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
    const L = PREPARE_LAYOUT;
    return {
      x: Math.round(L.pad + (L.playerColW - L.startW) / 2),
      y: L.startY,
      w: L.startW,
      h: L.startH,
    };
  }

  /**
   * 画一帧。
   *
   * @param cursored 光标停在「开始战斗」上（只有这一种态 —— 它不是选项，
   *   没有"已选中"，见 `prepareRender.startSkin`）。
   * @param developing 当前的**选择**里有开发中的单位（灰掉 + 换提示）。
   */
  draw(cursored: boolean, developing: boolean): void {
    const translate = this.options.translate;
    const sr = PrepareFooter.startRect();
    const skin = startSkin({ developing, cursored });
    this.gfx.clear();
    this.gfx
      .roundRect(sr.x, sr.y, sr.w, sr.h, CARD_RADIUS)
      .fill({ color: skin.fillColor, alpha: skin.fillAlpha });
    this.gfx
      .roundRect(sr.x, sr.y, sr.w, sr.h, CARD_RADIUS)
      .stroke({ color: skin.strokeColor, width: skin.strokeWidth });
    this.startLabel.setColor(skin.labelColor);
    this.startLabel.set(translate('roster.ui.start'));
    this.hint.set(developing ? translate('roster.ui.developing') : translate('roster.ui.hintCursor'));
    this.hint.setColor(developing ? PREPARE_SKIN.selectionText : PALETTE.textDim);
    this.notice.set(translate('roster.ui.notice'));
  }
}
