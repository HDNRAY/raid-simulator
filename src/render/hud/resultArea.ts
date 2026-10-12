/**
 * **结算面板**：一局结束后的遮罩 + 居中的结果面板（标题 / 原因 / 统计 / 提示）。
 *
 * ==================================================================
 * 为什么单独一个文件（关注分离，AGENTS.md §3）
 * ==================================================================
 *
 * 它是**独立的一层**（`resultLayer` 压在 HUD 之上）、单独一组标签，
 * 与战斗 HUD 没有共享状态 —— 只是原先和"造 HUD"的 345 行构造函数
 * 挤在同一个方法里，读者要读到第 425 行才知道"还有一个结算面板"。
 *
 * ⚠️ 结算面板**不随 UI 缩放**（`BattleScene.setUiScale` 原先就不碰它）——
 * 所以本区域**没有** `setUiScale`：它不在"该跟着变大的读数部件"里。
 * 这是现状，本次重构原样保留。
 *
 * ⚠️ 下面的注释与代码是一起从 `BattleScene.ts` 搬过来的
 * （AGENTS.md §3：抽取时连带注释一起搬）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LAYOUT, LOGICAL } from '../../ui/layout';
import { Label, Panel, type PixiCtor } from '../../ui/primitives';
import { renderResultPanel, type ResultRefs } from '../resultPanel';
import type { FrameRegistry } from '../sceneTypes';

/** 结算区域。 */
export class ResultArea {
  /**
   * 结算层本身。
   *
   * ⚠️ 场景必须把它加在 **HUD 之后**（同一父级），所以它天然压在
   * HUD 之上；见 `BattleScene` 的加入顺序。
   */
  readonly root: Container;

  private readonly resultDim: Graphics;
  private readonly resultPanel: Panel;
  private readonly resultTitle: Label;
  private readonly resultReason: Label;
  private readonly resultStats: Label;
  private readonly resultHint: Label;

  constructor(pixi: PixiCtor) {
    /* ---------- 结算面板 ----------
     * 单独一层，压在 HUD 之上。战斗进行中完全隐藏，
     * 所以它不占用任何视觉注意力。 */
    this.root = new pixi.Container();
    this.root.visible = false;

    this.resultDim = new pixi.Graphics();
    this.resultDim.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: 0x000000, alpha: 0.62 });
    this.root.addChild(this.resultDim);

    const rw = LAYOUT.result.w;
    const rh = LAYOUT.result.h;
    const rx = Math.round((LOGICAL.width - rw) / 2);
    const ry = Math.round((LOGICAL.height - rh) / 2) - 20;
    /**
     * 结算面板**故意比其它面板不透明**（0.97）：它是"结算"，
     * 需要挡住背后的战斗画面让人专心看结果 —— 所以显式覆盖透明度，
     * 而不是跟着 `PANEL_STYLE` 走。
     */
    this.resultPanel = new Panel(pixi, {
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      fill: 0x0e0e16,
      line: 0x6a6c80,
      fillAlpha: 0.97,
      radius: 4,
    });
    this.resultTitle = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: ry + 18,
      size: FONT.big,
      color: 0xffffff,
      anchorX: 0.5,
    });
    this.resultReason = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: ry + 54,
      size: FONT.body,
      color: 0xa0a0b4,
      anchorX: 0.5,
    });
    this.resultStats = new Label(pixi, {
      x: rx + 24,
      y: ry + 84,
      size: FONT.small,
      color: 0xd0d0dc,
    });
    this.resultHint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: ry + rh - 26,
      size: FONT.small,
      color: 0x80d0a0,
      anchorX: 0.5,
    });
    this.root.addChild(
      this.resultPanel.root,
      this.resultTitle.root,
      this.resultReason.root,
      this.resultStats.root,
      this.resultHint.root,
    );
  }

  /** 挂上本区域的每帧部件（结算文案的装配）。 */
  register(registry: FrameRegistry): void {
    registry.add({
      name: 'result',
      /**
       * ⚠️ 结算文案的装配在 `render/resultPanel.ts`（纯文字，不碰节点
       * 生命周期）。这里只把需要写的标签交出去。
       */
      render: (ctx) =>
        renderResultPanel(this.resultRefs(), ctx.view, ctx.translate, ctx.showKeyHints),
    });
  }

  /**
   * 结算面板。
   *
   * ⚠️ 它原先**是唯一用闭包注册**的部件：它要改 5 个自己持有的字段
   * （标题/原因/统计/提示），字段太多不值得为它单独开一个文件传 6 个引用。
   * 闭包把它留在场景里，同时仍然走注册机制 —— 顺序照样由注册决定。
   *
   * ✅ 拆分之后这 5 个标签就是本区域的字段：闭包注册仍然是对的形状，
   * 只是它终于和字段待在**同一个文件**里了。
   */
  /** 结算面板要写的那几个标签（交给 `renderResultPanel`）。 */
  private resultRefs(): ResultRefs {
    return {
      resultLayer: this.root,
      resultTitle: this.resultTitle,
      resultReason: this.resultReason,
      resultStats: this.resultStats,
      resultHint: this.resultHint,
    };
  }
}
