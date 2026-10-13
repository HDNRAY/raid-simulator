/**
 * **详情区的驱动**：把 hover 与键盘焦点合成"当前该看谁"，再交给面板画。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"这一帧详情区显示哪一项"这件事的**唯一**判据来源：持有悬停项 → 与
 * 光标合流（`prepareDetail.focusedTarget`）→ 造模型（`detailModelOf`）→
 * 交给 `PrepareDetailPanel` 画。
 *
 * ==================================================================
 * 为什么单独一层（而不是留在 `PrepareScreen` 里）
 * ==================================================================
 *
 * `PrepareScreen` 已经有**三件**不相干的职责：输入状态机、卡片、以及这里
 * 这一层"详情区"。用户 2026-10-13 的布局改造把详情区变成一个**独立区域**
 * （右侧通高一块），它自己的驱动规则（hover 优先、触屏退化成焦点）
 * 就该有自己的家 —— 与 `prepareCards` 同一条理由（AGENTS.md §3 的
 * "一个文件一句话"）。
 *
 * ==================================================================
 * ⚠️ 两种输入**同一段代码**（AGENTS.md §3b）
 * ==================================================================
 *
 *   - 鼠标：`hoverAt()` 每次 `pointermove` 问一次命中
 *   - 触屏：**没有 hover** —— `hoverAt` 永不被调用，`_hover` 恒为
 *     `undefined`，于是 `focusedTarget` 自动退化成"跟着键盘焦点 / 点选走"
 *
 * ⚠️ 所以"触屏能切详情"**不是**另一条分支，而是"没有 hover 时这段代码
 * 本来就有的行为"。这也正是把它做成一个纯函数（`focusedTarget`）的理由：
 * 那条性质可以在 node 里断言，而不是靠"记得给触屏写一条路"。
 */

import type { Container } from 'pixi.js';
import type { PixiCtor } from './primitives';
import { PrepareDetailPanel } from './prepareDetailPanel';
import { detailModelOf, focusedTarget, type DetailContext, type DetailModel } from './prepareDetail';
import { DETAIL_SCROLL_STEP } from './prepareDetailMetrics';
import type { PrepareTarget } from './prepareLogic';
import type { TranslateFn } from '../i18n/translator';

export interface PrepareDetailControllerOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /** 数据装配（`app/prepareDetailContext.prepareDetailContext()` 的产物）。 */
  readonly context: DetailContext;
  /** 详情区要挂上去的容器。 */
  readonly parent: Container;
}

export class PrepareDetailController {
  readonly root: Container;
  private readonly panel: PrepareDetailPanel;
  private readonly ctx: DetailContext;
  /**
   * **悬停**的那一项（`undefined` = 鼠标不在任何卡片上）。
   *
   * ⚠️ 它**不进光标状态**（见 `prepareDetail` 的文件头）：悬停是纯查看，
   * 键盘那条"焦点 → 光标"的路一个字不改。
   */
  private hover: PrepareTarget | undefined = undefined;

  constructor(options: PrepareDetailControllerOptions) {
    this.ctx = options.context;
    this.panel = new PrepareDetailPanel(options.pixi, options.translate);
    this.root = this.panel.root;
    options.parent.addChild(this.root);
  }

  /** 当前悬停项（调试探针用）。 */
  get hovered(): PrepareTarget | undefined {
    return this.hover;
  }

  /**
   * 鼠标划过 (px, py)：`hit` 是"那一点命中了哪一项"（由调用方用
   * `prepareLogic.hitTestPrepare` 算好 —— 命中几何归那一处，这里只管
   * "同一个目标不要重复重画"）。
   *
   * @returns 有没有发生变化（调用方据此决定要不要立刻重画一帧）。
   */
  hoverAt(hit: PrepareTarget | undefined): boolean {
    if (sameTarget(hit, this.hover)) return false;
    this.hover = hit;
    return true;
  }

  /** 指针离开画布：清掉悬停（否则详情区会一直停在最后划过的那一项）。 */
  clearHover(): boolean {
    if (this.hover === undefined) return false;
    this.hover = undefined;
    return true;
  }

  /**
   * 画一帧。
   *
   * @param cursor 键盘光标此刻指着的那一项（`undefined` = 光标不在任何
   *   可指项上，例如停在「开始战斗」）。
   */
  update(cursor: PrepareTarget | undefined): void {
    const model: DetailModel | undefined = detailModelOf(
      focusedTarget(cursor, this.hover),
      this.ctx,
    );
    this.panel.setVisible(true);
    this.panel.update(model);
  }

  /**
   * 这个逻辑点是不是落在详情区的**可滚视口**里。
   *
   * ⚠️ 转发给面板（而不是在这里自己按 `detailRect` 判一次）：面板才知道
   * "内容有没有溢出"——不溢出时不消费滚轮/拖拽，那一下该归页面自己。
   */
  isOnDetail(px: number, py: number): boolean {
    return this.panel.isOnDetail(px, py);
  }

  /** 滚详情区（滚轮 / 拖拽都走它）。 */
  scrollBy(delta: number): boolean {
    return this.panel.scrollBy(delta);
  }

  /**
   * **Shift + ↑ ↓**：按一个**固定步长**滚详情区（键盘那条路；滚轮 / 拖拽
   * 那条路是 `scrollBy`，步长由输入自己的位移决定）。
   *
   * ⚠️ 它**不需要焦点在详情区上**、也**不碰**光标：详情区不是第 4 个"站"，
   * 它显示的就是"当前展开那一块"里的东西（见文件头）。所以"滚它"是一个
   * 随时可做的动作，与裸 ↑↓ 的"块内走光标"互不影响。
   *
   * @returns 有没有真的动（内容不足一屏时为 `false` —— 那是**正常**的
   *   "什么也不做"，不是 bug；调用方据此决定要不要重画）。
   */
  scrollStep(dir: 'up' | 'down'): boolean {
    return this.panel.scrollBy(dir === 'up' ? -DETAIL_SCROLL_STEP : DETAIL_SCROLL_STEP);
  }

  /** 当前该显示的那一项（探针用；等价于渲染层实际拿到的输入）。 */
  target(cursor: PrepareTarget | undefined): PrepareTarget | undefined {
    return focusedTarget(cursor, this.hover);
  }
}

/** 两个"聚焦项"是不是同一个（悬停去重要用）。 */
function sameTarget(a: PrepareTarget | undefined, b: PrepareTarget | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.kind === b.kind && a.id === b.id;
}
