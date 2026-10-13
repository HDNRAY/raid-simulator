/**
 * **备战屏底部那条**：开始按钮 + 操作提示 + 第三方素材声明。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是屏幕**下半部分那一条**的画法：一颗「开始战斗」、它下面一行随状态
 * 变化的提示、以及贴底边的素材声明。
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
 * ⚠️⚠️ 2026-10-13：**「开始战斗」四个字与它的按钮错位** —— 修在这里
 * ==================================================================
 *
 * 用户原话："开始战斗和按钮错位了"。
 *
 * 量出来的原因（不是猜的）：按钮**矩形**由布局表算出来
 * （`startRect()`：`pad + (playerColW - startW)/2` = **280**，中心 **328**），
 * 而按钮上的**文字**画在 `LOGICAL.width / 2` = **480** —— 差 **152px**。
 * 于是画面上是"一颗空按钮 + 一串飘在它右边 150px 的字"。
 *
 * ⚠️ 根因不是"数字写错了"，而是**同一个东西有两个出处**：矩形来自
 * `prepareLayout`（命中测试读它），文字的位置在这里又算了一遍。所以修法
 * 是**让文字从矩形推**（`start.x + start.w / 2`），而不是把 480 改成 328
 * —— 后者下次布局一动手又会漂。
 *
 * ⚠️ 同理，下面那行**操作提示**也居中到按钮的中心（它读起来就是按钮的
 * 说明，旧版把它留在"整张画布的中心"，于是它比按钮偏右 152px）。
 * 只有最底下的**素材声明**仍然居中于整张画布 —— 那是全屏的版权标示，
 * 不属于按钮。
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
import type { PrepareCounts } from './prepareLayout';
import { startCenterX, startRect } from './prepareGeometry';
import { CARD_RADIUS, PREPARE_SKIN, startSkin } from './prepareRender';
import type { TranslateFn } from '../i18n/translator';

export interface PrepareFooterOptions {
  readonly pixi: PixiCtor;
  readonly parent: Container;
  /**
   * 三块的张数 —— ⚠️ 只用来算「开始战斗」的 y（见 `prepareLayout.startRect`）。
   *
   * ⚠️ 它是**构造参数**：按钮的位置在造对象时就要定（文字要摆在按钮中心），
   * 而张数在运行期不变（名单是静态的）—— 传进来比"每帧重算一遍位置"干净。
   */
  readonly counts: PrepareCounts;
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
  /**
   * 「开始战斗」的矩形（**唯一出处**：命中测试也读 `prepareLayout.startRect`）。
   *
   * ⚠️ 文字 / 提示的 x **全部从它推**（`rect.x + rect.w / 2`）—— 这是
   * "错位"那个 bug 的结构性修法，见文件头。
   */
  private readonly start: ReturnType<typeof startRect>;

  constructor(private readonly options: PrepareFooterOptions) {
    const { pixi, parent } = options;
    this.gfx = new pixi.Graphics();
    this.start = startRect(options.counts);
    /**
     * ⚠️ 中心由 `startCenterX` 给（= 矩形中心，**不是** `LOGICAL.width / 2`）
     * —— 见文件头：这一条就是"错位"那个 bug 的修法，而且是**可单测**的
     * （`tests/unit/prepareLayout.test.ts` 断言"文字中心 = 矩形中心"）。
     */
    const centerX = startCenterX(options.counts);

    this.startLabel = new Label(pixi, {
      x: centerX,
      y: this.start.y + this.start.h / 2,
      size: FONT.body,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.hint = new Label(pixi, {
      x: centerX,
      /**
       * ⚠️ 提示行贴在**按钮下面**（它读起来就是那颗按钮的说明）。
       */
      y: this.start.y + this.start.h + 10,
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    /**
     * 页脚声明：贴屏幕**底边、居中于整张画布**（它是全屏的版权标示，
     * 不属于那颗按钮）。
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
   * 画一帧。
   *
   * @param cursored 光标停在「开始战斗」上（只有这一种态 —— 它不是选项，
   *   没有"已选中"，见 `prepareRender.startSkin`）。
   * @param developing 当前的**选择**里有开发中的单位（灰掉 + 换提示）。
   */
  draw(cursored: boolean, developing: boolean): void {
    const translate = this.options.translate;
    const sr = this.start;
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
