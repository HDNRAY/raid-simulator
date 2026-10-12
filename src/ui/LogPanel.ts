/**
 * 战斗日志面板（屏幕右侧）。
 *
 * ==================================================================
 * 它在分层里的位置
 * ==================================================================
 *
 *   引擎 EventDef[] → `app/logFormat.ts`（纯函数）→ LogEntry[]
 *     → **本文件**（只负责取词 + 画）
 *
 * 所以这里**没有任何"哪些事件值得记"的判断** —— 那是格式化层的事。
 * 本文件只做三件：
 *   1. 把 `entry.key` 翻成文案（i18n 规范 I1：文案不进日志数据）
 *   2. 按类别配色
 *   3. 把最近 N 条画成一列，旧的往上淡出
 *
 * ==================================================================
 * 两个模式（同一个组件，`view.status` 决定用哪个）
 * ==================================================================
 *
 *   战斗中   → 左边那条**实时短列**：只画最近几条 `level === 'major'` 的。
 *              玩家在打的时候只有余光，能读的只有最近几行；`minor`
 *              进来会把面板刷爆。
 *   一局结束 → **全屏复盘**（`LogReviewPanel`）：画**全部**条目（含
 *              `minor`）、有时间轴、能滚。需求："一局结束 也显示完整log，
 *              玩家好复盘。"
 *
 * 判断"结束了"只用 `view.status`（`victory` / `defeat`）—— 见
 * `logReview.isFinished`。这里不额外记状态机，也不看时间。
 *
 * ==================================================================
 * 复盘时为什么要动节点层级（`syncLayer`）
 * ==================================================================
 *
 * 结算面板（`render/BattleScene.ts` 的 `resultLayer`）是场景 root 的
 * **最后一个子节点**，所以它画在整个 HUD 之上；本面板平时挂在 `hud` 里。
 * 复盘不提到最上层的话，会被结算那一层半透明黑幕压暗 —— 一屏 28 行
 * 的正文直接读不了。所以进入复盘时把 `root` 提到结算层之上，
 * 退出时放回原处。**只动节点，不动数据流。**
 */

import type { Container } from 'pixi.js';
import type { LogEntry } from '../app/logFormat';
import { FONT, LAYOUT, LOGICAL } from './layout';
import { Label, PANEL_STYLE, Panel, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import type { BattleSnapshotView } from '../render/viewModel';
import { LogReviewPanel } from './LogReviewPanel';
import { CATEGORY_COLORS, majorEntries, resolveLogParams } from './logReview';
import { FEED_PAD_X, layoutFeed, type FeedBlock } from './logFeed';

export interface LogPanelOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string, params?: Readonly<Record<string, string | number>>) => string;
}

/**
 * 每行的高度（逻辑像素）。
 *
 * 需求："行间距小一点"。16 → **13**，行间空隙 2 → **1**。
 * 每行占高从 18 降到 14，10 行省下 40px —— 面板也跟着变矮。
 * 13px 的行高配 `FONT.tiny`(11) 仍然放得下，不会挤。
 *
 * ⚠️ 现在它是**折行后每一行**的高度，不再等于"一条的高度"：
 * 一条最多折 2 行（见 `logFeed.ts` 的文件头）。
 */
const LINE_H = 13;
/**
 * 标签池大小（= 最多同时显示几条）。
 *
 * ⚠️ 名字仍是"可见行数"：单行条目最多就是这么多条，而每条 2 行时
 * 实际条数由高度预算决定（`logFeed.layoutFeed`）—— 少于这个数。
 */
const VISIBLE_LINES = 10;
/** 条与条之间的间距 */
const LINE_GAP = 1;
/** 文字区距面板底 / 顶（标题那一条）的内边距。 */
const FEED_PAD_BOTTOM = 8;
const FEED_PAD_TOP = 22;

export class LogPanel {
  readonly root: Container;

  private readonly panel: Panel;
  private readonly title: Label;
  private readonly lines: Label[] = [];
  /** 复盘（一局结束后的全屏模式）。
   *
   * ⚠️ 经 `get review()` 暴露出去 —— 输入归属要问它"开着没有"，见那个 getter。 */
  private readonly reviewPanel: LogReviewPanel;
  /** 上一次画的内容指纹，用来跳过无变化的重排（每帧都会调进来）。 */
  private lastSignature = '';

  /**
   * 本面板在**节点树里的原位置**（`hud`）。
   *
   * ⚠️ 构造时还拿不到：`BattleScene` 是先 `new LogPanel` 再
   * `hud.addChild(...)`。所以第一次需要提层时再记下来（见 `syncLayer`）。
   */
  private homeParent: Container | null = null;

  /* ---- 当前几何（缩放后）。初始值 = 未缩放的基础布局 ---- */
  private rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } = LAYOUT.log;
  private scale = 1;
  private lineH = LINE_H;
  private lineGap = LINE_GAP;
  private lineSize: number = FONT.tiny;

  constructor(private readonly options: LogPanelOptions) {
    const { pixi } = options;
    const r = LAYOUT.log;
    this.root = new pixi.Container();

    // 与玩家资源面板**同一套外观**（见 `PANEL_STYLE` 的说明）
    this.panel = new Panel(pixi, {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      ...PANEL_STYLE,
    });
    this.root.addChild(this.panel.root);

    this.title = new Label(pixi, {
      x: r.x + 8,
      y: r.y + 5,
      size: FONT.tiny,
      color: PALETTE.textDim,
    });
    this.title.set(options.translate('log.title'));
    this.root.addChild(this.title.root);

    /**
     * 行标签**一次性建满**，之后只改文本。
     *
     * 不用"按需创建/销毁"：日志每几帧就变一次，反复 new Text
     * 会产生大量纹理垃圾（Pixi 的 Text 是每次改字都重新光栅化的）。
     *
     * ⚠️ `y` 不再一次算死：一条可能折成 1~2 行（见 `logFeed.ts`），
     * 每帧由 `layoutFeed` 从下往上重新排。
     */
    for (let i = 0; i < VISIBLE_LINES; i += 1) {
      const label = new Label(pixi, {
        // 左缘与"可用宽度"用**同一个**常量，见 `logFeed.FEED_PAD_X`
        x: r.x + FEED_PAD_X,
        y: 0,
        size: FONT.tiny,
        color: PALETTE.textDim,
      });
      /**
       * ⚠️ 多行文本的行高必须**显式**设成排版用的 `LINE_H`：Pixi 默认
       * 用字体度量（约 1.25×字号），与 `layoutFeed` 算的 13 对不上 ——
       * 那样每折一行就往下漂一点，几行之后两行文本会重叠。
       */
      label.root.style.lineHeight = LINE_H;
      this.lines.push(label);
      this.root.addChild(label.root);
    }

    /** 复盘面板放在**最后**：它在 `root` 内部也要盖住上面那几条。 */
    this.reviewPanel = new LogReviewPanel({ pixi, translate: options.translate });
    this.root.addChild(this.reviewPanel.root);
  }

  /**
   * **复盘那一层**（一局结束后的全屏战报）。
   *
   * ⚠️ 暴露出去是为了**输入归属**：`app/inputRouter.ts` 要判"复盘开着没有"，
   * 而"开着"这件事只有复盘自己知道（`finished && shown`）。
   * 调用方拿它问状态，**不替它存一份布尔** —— 两份真相会漂，而漂移的样子
   * 正是本次的 bug（设置按钮以为还在战斗、实际复盘盖在上面）。
   */
  get review(): LogReviewPanel {
    return this.reviewPanel;
  }

  /**
   * 每帧重画。
   *
   * `view.status` 决定用哪个模式（见文件头）：`victory` / `defeat` = 一局结束。
   *
   * ⚠️ 传的是**整份 view**（不只是 `status`）：复盘头部第 2 行要显示结算摘要
   * （用时 / 剩余生命 / 伤害 / DPS），而那几项只能来自 `view.result` ——
   * 需求要"一局结束**也**显示完整 log"，也就是**结算不能消失**。
   *
   * 战斗中这一列**只吃 `major`**（需求："`minor` 不要放进战斗中那个
   * 小面板"）；全部条目交给复盘面板。
   */
  update(entries: readonly LogEntry[], view: BattleSnapshotView): void {
    this.reviewPanel.update(entries, view);
    this.syncLayer(this.reviewPanel.root.visible);

    const visible = majorEntries(entries).slice(-VISIBLE_LINES);
    // 内容没变就整段跳过（每帧调用的东西，能省则省）
    const signature = `${view.status}:${visible.map((e) => `${e.id}:${e.category}`).join(',')}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const translate = this.options.translate;
    /** ⚠️ 取词只在"真的变了"之后做：`translate` 是热路径（见 `primitives`）。 */
    const texts = visible.map((entry) => translate(entry.key, resolveLogParams(entry.params, translate)));
    this.paint(layoutFeed(texts, this.feedOptions()), visible);
  }

  /** 排版参数（全部由当前几何推出，不写死 —— UI 缩放后仍然成立）。 */
  private feedOptions() {
    const { rect, scale } = this;
    return {
      bottomY: rect.y + rect.h - Math.round(FEED_PAD_BOTTOM * scale),
      topY: rect.y + Math.round(FEED_PAD_TOP * scale),
      maxPx: rect.w - Math.round(FEED_PAD_X * scale) * 2,
      size: this.lineSize,
      lineH: this.lineH,
      rowGap: this.lineGap,
      maxBlocks: this.lines.length,
    };
  }

  /**
   * 把排好的文本块画到标签上。
   *
   * `blocks[0]` = 最新的一条 = **最下面**那一行；`lines[0]` 也是底部。
   * 越旧越暗（不用动画，靠透明度表达"这条正在变旧"）。
   */
  private paint(blocks: readonly FeedBlock[], entries: readonly LogEntry[]): void {
    for (let i = 0; i < this.lines.length; i += 1) {
      const label = this.lines[i];
      if (label === undefined) continue;
      const block = blocks[i];
      const entry = entries[entries.length - 1 - i];
      if (block === undefined || entry === undefined) {
        label.set('');
        continue;
      }
      label.set(block.lines.join('\n'));
      label.setColor(CATEGORY_COLORS[entry.category]);
      label.root.y = block.y;
      // 越旧越暗：最旧的一条约 0.45
      label.root.alpha = 1 - (i / Math.max(1, blocks.length - 1)) * 0.55;
    }
  }

  /**
   * 复盘时把整块日志**提到结算层之上**，退出时放回原处。
   *
   * ⚠️ 为什么只要这一处：结算面板是场景 root 的最后一个子节点，
   * 复盘留在 `hud` 里会被它那层半透明黑幕压暗（见文件头）。
   * 这里**只重排节点**，不碰任何数据。
   */
  private syncLayer(wantTop: boolean): void {
    const parent = this.root.parent;
    if (wantTop) {
      if (this.homeParent === null && parent !== null) this.homeParent = parent;
      const top = this.homeParent?.parent;
      if (top !== null && top !== undefined && parent !== top) top.addChild(this.root);
      return;
    }
    if (this.homeParent !== null && parent !== this.homeParent) this.homeParent.addChild(this.root);
  }

  /**
   * 改几何与行距（UI 缩放时用）。
   *
   * 行标签是**一次性建满**的（避免反复 new Text），所以缩放时不能
   * 重建，只能改它们的坐标、字号与面板矩形。行距同样按系数走 ——
   * 只放大框不放大行距，十条会挤在面板顶部。
   *
   * ⚠️ 缩放的只是**位置与字号**：文本块的分行由 `layoutFeed` 每帧重算
   * （所以这里把指纹清空，强制下一帧重排一次）。
   */
  setUiScale(scale: number, rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
    this.rect = rect;
    this.scale = scale;
    this.panel.set({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    this.title.root.x = rect.x + Math.round(8 * scale);
    this.title.root.y = rect.y + Math.round(5 * scale);
    this.title.setSize(Math.max(1, Math.round(FONT.tiny * scale)));
    this.lineH = Math.max(1, Math.round(LINE_H * scale));
    this.lineGap = Math.max(1, Math.round(LINE_GAP * scale));
    this.lineSize = Math.max(1, Math.round(FONT.tiny * scale));
    for (const label of this.lines) {
      label.root.x = rect.x + Math.round(FEED_PAD_X * scale);
      label.setSize(this.lineSize);
      if (label.root.style.lineHeight !== this.lineH) label.root.style.lineHeight = this.lineH;
    }
    // 内容没变，但坐标变了 —— 强制下一帧重排一次
    this.lastSignature = '';
  }

  /** 面板整体显隐（结算后可留在屏幕上供复盘）。 */
  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }
}

/** 供布局测试引用：面板占据的矩形。 */
export const LOG_PANEL_RECT = LAYOUT.log;
/** 供测试断言"行数与面板高度一致"。 */
export const LOG_PANEL_METRICS = { LINE_H, LINE_GAP, VISIBLE_LINES } as const;
/** 供测试断言面板没有超出画布右边界。 */
export const LOG_PANEL_RIGHT = LAYOUT.log.x + LAYOUT.log.w;
export const CANVAS_WIDTH = LOGICAL.width;
