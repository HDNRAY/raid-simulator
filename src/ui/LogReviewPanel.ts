/**
 * 战报复盘的**画**（全屏、可滚）。
 *
 * ==================================================================
 * 它在分层里的位置
 * ==================================================================
 *
 *   `app/logFormat.ts`（哪些事件值得记）→ `LogEntry[]`
 *     → `ui/logReview.ts`（该显示哪几条 / 怎么配色 / 几何）
 *     → **本文件**（取词 + 画 + 收输入）
 *
 * 所以这里**没有任何"哪些条目重要"的判断**、也不判 `entry.key` 是什么 ——
 * 文案一律 `translate(entry.key, params)`（i18n 规范 I1）。
 * `major`/`minor` 的轻重也由 `logReview.ts` 的 `rowStyle` 决定。
 *
 * ==================================================================
 * 需求与设计（"抄博德之门3"的那几条落在这里）
 * ==================================================================
 *
 *   1. **一条 = 谁 → 做了什么 → 对谁 → 数字 → 来源**。这句话本身在
 *      `logFormat` 的文案模板里；这里负责**把它读起来像一条时间线**：
 *      左边一列"第几秒"，右边按类别配色的正文。
 *   2. **时间轴**：每条前面标出秒数（`tick / 60`，见 `logReview.secondsAt`）。
 *   3. **轻重层次**：`major`（伤害/阶段/死亡）字号大、满色，还带一条
 *      淡底纹；`minor`（回炁、buff 过期）字号小、半透明。
 *   4. **完整**：`minor` 条目**只在这里**出现（实时面板只吃 `major`）。
 *
 * ==================================================================
 * 滚动输入：三种，但只有一条滚动路径
 * ==================================================================
 *
 *   - **滚轮/触控板**（主力：桌面上一只手就能翻）
 *   - **方向键 / PageUp·PageDown / Home·End**（键盘用户；Home=最旧，End=最新）
 *   - **拖拽**（触屏没有滚轮，也没有键盘 —— 见 AGENTS.md §3b
 *     "触屏与键盘功能必须对等"）
 *
 * ⚠️ 三者都只是"算出要滚几行"，然后调**同一个** `scrollRows()`。
 * 不是三套滚动逻辑 —— 否则边界（滚到尽头、一屏不满、空日志）会在
 * 其中一条路径上漏掉。
 *
 * ==================================================================
 * ⚠️ 指针不再是"挂在 window 上的自己的监听"
 * ==================================================================
 *
 * 原先本类自己 `window.addEventListener('pointerdown'…)` 并吃掉**整个
 * 窗口**的手势。那是"输入归属没收口"的一个实例，而且实测有两个后果：
 *
 *   1. **触屏永远滚不动复盘** —— 那一下 pointerdown 会**先**被
 *      `canvasInput` 的"结算中点屏幕 = 离开战斗"接走（它当时只看
 *      `phase === 'battle'`），玩家一碰就重开，拖拽根本没开始
 *   2. 它与结算面板的"点屏幕再来一次"是**两条独立判据**，谁先谁后靠
 *      注册顺序，改一处就会漂
 *
 * 现在指针路由收口在 `app/inputRouter.ts`：
 * `canvasInput` 算出逻辑坐标 → 问 `reviewConsumesPointer`（层是 `review`
 * **且**点在面板矩形内）→ 命中才转发到这里的 `pointerDown/Move/Up`。
 * 面板因此只知道"从这一行的位置开始拖、拖到了这一行"，**不再碰 DOM 坐标**。
 *
 * ⚠️ 键盘监听仍然直接挂 `window`（`render/sizes.ts` 的 resize 也是这么做的）：
 * 它不是 DOM UI，只是"画布之外还有谁在按键"的入口。所有 UI 仍然是 canvas。
 * 但它同样只认**输入层是 `review`** 时的按键 —— 由 `loopWiring` 转发，
 * 见那里的 `inputLayer()`。
 */

import type { Container, Graphics } from 'pixi.js';
import type { LogEntry } from '../app/logFormat';
import type { LogicalRect } from '../app/inputRouter';
import { reviewRowsAt } from '../app/inputRouter';
import type { BattleSnapshotView } from '../render/viewModel';
import { FONT } from './layout';
import { Label, Panel, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import {
  CATEGORY_COLORS,
  REVIEW_FOOTER_H,
  REVIEW_GAP,
  REVIEW_HEADER_H,
  REVIEW_PAD_X,
  REVIEW_RECT,
  REVIEW_ROWS,
  REVIEW_ROWS_RECT,
  REVIEW_ROWS_Y,
  REVIEW_ROW_H,
  REVIEW_TEXT_X,
  REVIEW_TIME_W,
  clampOffset,
  isFinished,
  pageStep,
  resolveLogParams,
  rowStyle,
  scrollFraction,
  scrollOffset,
  resultStatCells,
  scrollThumbRatio,
  secondsAt,
  tailOffset,
  visibleWindow,
  type BattleStatus,
  type ResultSummary,
} from './logReview';

export interface LogReviewPanelOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string, params?: Readonly<Record<string, string | number>>) => string;
}

/**
 * 滚动方式 / 回结算的**键名**。
 *
 * ⚠️ 它们**不进 i18n**：i18n 里放标签（"翻看日志"），键名由渲染层拼 ——
 * 见 AGENTS.md §3b"键位提示不能放进 i18n"。这样改键（这里目前是固定键，
 * 但将来可能变成可改）不用动语言包，触屏不显示键名时也不用去删文案。
 * 它们全是 ASCII，所以不会被 `no-hardcoded-cjk` 拦（那条规则管的是文案）。
 */
const SCROLL_KEYS = '(Wheel / Up-Down / PgUp-PgDn)';
const TOGGLE_KEY = '(Space)';

/** 滚轮一个"格"折算几行（像素模式的 `deltaY` ÷ 它）。 */
const WHEEL_PX_PER_ROW = 40;

/**
 * 行高与字号的换算系数。
 *
 * Pixi 的 `Text` 高度 ≈ `fontSize × 1.25`（单行、等宽族）。行内垂直居中
 * 要用它，不能用字号本身 —— 否则 13px 的字会偏上、贴住上一行。
 */
const LINE_BOX = 1.25;

/** 滚条轨道宽度（逻辑像素）。 */
const SCROLLBAR_W = 3;
/** 滚条滑块的最小高度：日志上千条时滑块也不能细成一根线（那样看不出来）。 */
const SCROLLBAR_MIN_H = 24;

/** 列表里的一行 = 时间列 + 正文列。 */
interface RowView {
  readonly time: Label;
  readonly text: Label;
}

export class LogReviewPanel {
  readonly root: Container;

  private readonly panel: Panel;
  private readonly frame: Graphics;
  private readonly title: Label;
  private readonly outcome: Label;
  private readonly stats: Label;
  private readonly count: Label;
  private readonly hint: Label;
  private readonly range: Label;
  private readonly rows: RowView[] = [];

  /** 全部条目（只读引用，格式化层拥有它）。 */
  private entries: readonly LogEntry[] = [];
  /** 结算数据（头部第 2 行）。`undefined` = 还没结束。 */
  private result: ResultSummary | undefined;
  /** 这一局是否已经结束（由 `view.status` 推出）。 */
  private finished = false;
  /** 玩家是否要看复盘（`Space` 可在"战报 / 结算"之间来回切）。 */
  private shown = false;
  /** 第一条可见条目的下标（见 `logReview.clampOffset`）。 */
  private offset = 0;
  /** 上一次画的内容指纹：**只在真的变了的时候重画**（每帧都会调进来）。 */
  private lastSignature = '';

  /**
   * 拖拽中：指针 id 与上一次的**逻辑 Y 坐标**。
   *
   * ⚠️ 存逻辑坐标而不是 `clientY`：后者是 CSS 像素，会随 letterbox 缩放
   * 漂移。换算（CSS → 逻辑）只在 `canvasInput` 做一次
   * （见文件头"指针不再是自己的监听"）。
   */
  private drag: { readonly id: number; logicalY: number } | null = null;
  /** 拖拽累计的"不足一行"的零头 —— 慢速拖动不会因为取整而完全不动。 */
  private dragCarry = 0;

  constructor(private readonly options: LogReviewPanelOptions) {
    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    /**
     * ⚠️ 复盘面板**完全不透明**（`fillAlpha: 1`）。
     *
     * 两个理由，第二个是需求直接提的：
     *   1. 它是"整屏阅读"，背后是战斗画面（角色、飘字、特写）。用
     *      `PANEL_STYLE` 的 0.62 会让文字和背后的角色糊在一起 ——
     *      一屏 27 行的密度下根本读不了
     *   2. 需求："那条结算文字**不再从面板底下透出来**"。0.96 时结算面板
     *      的"用时/造成伤害"会隐约透出来，和头部的同一批数字**重影**
     */
    this.panel = new Panel(pixi, {
      x: REVIEW_RECT.x,
      y: REVIEW_RECT.y,
      w: REVIEW_RECT.w,
      h: REVIEW_RECT.h,
      fill: 0x0a0b12,
      line: 0x6a6c80,
      fillAlpha: 1,
      radius: 4,
    });
    this.root.addChild(this.panel.root);

    /** 色条 / 分隔线 / 滚条都画在这一层（在文字**下面**）。 */
    this.frame = new pixi.Graphics();
    this.root.addChild(this.frame);

    this.title = new Label(pixi, {
      x: REVIEW_RECT.x + REVIEW_PAD_X,
      y: REVIEW_RECT.y + 5,
      size: FONT.title,
      color: PALETTE.text,
      bold: true,
    });
    this.root.addChild(this.title.root);

    /** 第 1 行右侧：胜负 + 原因（如"战斗胜利 · 击败了傲慢"）。 */
    this.outcome = new Label(pixi, {
      x: REVIEW_RECT.x + REVIEW_RECT.w - REVIEW_PAD_X,
      y: REVIEW_RECT.y + 9,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 1,
    });
    this.root.addChild(this.outcome.root);

    /**
     * 第 2 行左侧：**结算摘要**（用时 / 剩余生命 / 造成伤害 / DPS）。
     *
     * ⚠️ 需求："一局结束**也**显示完整log" —— 复盘不该把结算盖掉。
     * 这一行就是"结算"在复盘里活下来的地方（数据来自 `view.result`）。
     */
    this.stats = new Label(pixi, {
      x: REVIEW_RECT.x + REVIEW_PAD_X,
      y: REVIEW_RECT.y + 29,
      size: FONT.small,
      color: PALETTE.textDim,
    });
    this.root.addChild(this.stats.root);

    /** 第 2 行右侧：共 N 条。 */
    this.count = new Label(pixi, {
      x: REVIEW_RECT.x + REVIEW_RECT.w - REVIEW_PAD_X,
      y: REVIEW_RECT.y + 29,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 1,
    });
    this.root.addChild(this.count.root);

    this.hint = new Label(pixi, {
      x: REVIEW_RECT.x + REVIEW_PAD_X,
      y: REVIEW_RECT.y + REVIEW_RECT.h - REVIEW_FOOTER_H + 5,
      size: FONT.tiny,
      color: PALETTE.textDim,
    });
    this.root.addChild(this.hint.root);

    this.range = new Label(pixi, {
      x: REVIEW_RECT.x + REVIEW_RECT.w - REVIEW_PAD_X,
      y: REVIEW_RECT.y + REVIEW_RECT.h - REVIEW_FOOTER_H + 5,
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 1,
    });
    this.root.addChild(this.range.root);

    /**
     * 行标签**一次性建满**，之后只改文本。
     *
     * 与实时面板同一个理由：Pixi 的 `Text` 每次改字都重新光栅化，反复
     * new/destroy 会产生大量纹理垃圾；复盘时每滚一行就要改 28 行。
     */
    for (let i = 0; i < REVIEW_ROWS; i += 1) {
      const y = REVIEW_ROWS_Y + i * REVIEW_ROW_H;
      const time = new Label(pixi, {
        // 时间列右对齐：秒数从 1 位涨到 3 位时，右缘不动、正文列不会跟着抖
        x: REVIEW_RECT.x + REVIEW_PAD_X + REVIEW_TIME_W,
        y: Math.round(y + (REVIEW_ROW_H - FONT.tiny * LINE_BOX) / 2),
        size: FONT.tiny,
        color: PALETTE.textDim,
        anchorX: 1,
      });
      const text = new Label(pixi, {
        x: REVIEW_TEXT_X,
        y: Math.round(y + (REVIEW_ROW_H - FONT.tiny * LINE_BOX) / 2),
        size: FONT.tiny,
        color: PALETTE.text,
      });
      this.rows.push({ time, text });
      this.root.addChild(time.root, text.root);
    }

    /**
     * 输入监听**挂一次、活到页面结束**。
     *
     * ⚠️ 只留**滚轮**：它没有"这一下归谁"的问题（页面本身在复盘时不该滚，
     * 见 `onWheel`），而且浏览器不会把滚轮派给别的界面。
     * 键盘与指针都由 `app/inputRouter.ts` 判完归属再转发进来
     * （`handleKey` / `pointerDown`），见文件头"指针不再是自己的监听"。
     *
     * ⚠️ 不随"进/出复盘"增删：`BattleScene` 一局只建一次、`LogPanel`
     * 也只建一次（重开一局是复用同一个场景），所以没有监听泄漏；
     * 而增删监听会引入"到底注册了没有"的状态 —— 那是重复计入/漏计的经典来源。
     * handler 的第一件事都是 `if (!this.isOpen()) return`。
     */
    window.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /**
   * 每帧调一次（由 `LogPanel.update` 转交）。
   *
   * ⚠️ 传进来的是**全部条目**（含 `minor`）—— 复盘要的就是"信息尽可能多"。
   * 也传**整份 view**（不只是 status）：头部第 2 行的结算摘要要 `view.result`，
   * 而"结算数据只从 view 里拿、渲染层不自己算"是这一块唯一的真相来源。
   */
  update(entries: readonly LogEntry[], view: BattleSnapshotView): void {
    this.entries = entries;
    this.result = view.result;

    const finished = isFinished(view.status);
    if (finished !== this.finished) {
      this.finished = finished;
      if (finished) {
        /**
         * 刚打完：**默认就显示复盘**，并停在最新那几条
         * （先看"最后发生了什么"），往上滚就能读全程。
         */
        this.shown = true;
        this.offset = tailOffset(entries.length, REVIEW_ROWS);
      } else {
        /**
         * 重开一局：把"玩家按 Space 藏起来"的状态复位，否则下一局
         * 打完会**默认不显示复盘**（那个 bug 只在第二局出现，很难查）。
         */
        this.shown = false;
      }
      this.force();
    }

    const visible = this.finished && this.shown;
    if (visible !== this.root.visible) this.root.visible = visible;
    if (!visible) return;

    const signature = `${view.status}:${entries.length}:${this.offset}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.redraw(view.status);
  }

  /* ---------------------------------------------------------------- *
   * 画
   * ---------------------------------------------------------------- */

  /** 强制下一帧重画（偏移变了、或刚进入复盘）。 */
  private force(): void {
    this.lastSignature = '';
  }

  private redraw(status: BattleStatus): void {
    const t = this.options.translate;
    const total = this.entries.length;
    const offset = clampOffset(this.offset, total, REVIEW_ROWS);
    this.offset = offset;
    const visible = visibleWindow(this.entries, offset, REVIEW_ROWS);

    /* ---- 头部第 1 行：标题 + 胜负/原因 ---- */
    const result = this.result;
    this.title.set(t('logReview.title'));
    /**
     * ⚠️ 胜负与原因都**从 `result` 拿**（`titleKey` / `reasonKey`）——
     * 那是结算面板用的同一份数据。拿不到时才退回按 `status` 判词。
     */
    const won = result?.victory ?? status !== 'defeat';
    this.outcome.set(
      result === undefined
        ? t(won ? 'screen.victory' : 'screen.defeat')
        : `${t(result.titleKey)}  ·  ${t(result.reasonKey, resolveLogParams(result.reasonParams, t))}`,
    );
    this.outcome.setColor(won ? PALETTE.douqi.bright : PALETTE.danger.bright);

    /* ---- 头部第 2 行：结算摘要 + 条数（"也显示完整 log"里的"也"） ---- */
    this.stats.set(
      result === undefined
        ? ''
        : resultStatCells(result)
            .map((cell) => `${t(cell.key)} ${cell.value}`)
            .join('   ·   '),
    );
    this.count.set(t('logReview.count', { count: total }));

    /* ---- 头 / 脚的分隔线 ---- */
    const g = this.frame;
    g.clear();
    const sepX = REVIEW_RECT.x + REVIEW_PAD_X;
    const sepW = REVIEW_RECT.w - REVIEW_PAD_X * 2;
    g.rect(sepX, REVIEW_RECT.y + REVIEW_HEADER_H - 1, sepW, 1).fill({
      color: PALETTE.panelLine,
      alpha: 0.9,
    });
    g.rect(REVIEW_RECT.x + 2, REVIEW_RECT.y + REVIEW_RECT.h - REVIEW_FOOTER_H, REVIEW_RECT.w - 4, 1).fill({
      color: PALETTE.panelLine,
      alpha: 0.6,
    });

    /* ---- 行 ---- */
    for (let i = 0; i < this.rows.length; i += 1) {
      const row = this.rows[i];
      if (row === undefined) continue;
      const entry = visible[i];
      if (entry === undefined) {
        /** 最后不足一屏：把残行清空（不清的话会留着上一屏的内容）。 */
        row.time.set('');
        row.text.set('');
        continue;
      }
      const y = REVIEW_ROWS_Y + i * REVIEW_ROW_H;
      const style = rowStyle(entry);
      const color = CATEGORY_COLORS[entry.category];
      const minor = entry.level === 'minor';

      // `major` 的淡底纹：这是"这条更重"最省字数的一招（见 rowStyle 的说明）
      if (style.stripeAlpha > 0) {
        g.rect(REVIEW_RECT.x + 2, y, REVIEW_RECT.w - 4, REVIEW_ROW_H).fill({
          color,
          alpha: style.stripeAlpha,
        });
      }
      // 类别色条：扫一眼就能分出伤害/闪躲/打断
      g.rect(
        REVIEW_RECT.x + REVIEW_PAD_X + REVIEW_TIME_W + REVIEW_GAP,
        y + 3,
        style.barW,
        REVIEW_ROW_H - 6,
      ).fill({ color, alpha: style.barAlpha });

      row.time.set(t('logReview.timeAt', { seconds: secondsAt(entry.tick) }));
      row.time.setColor(minor ? PALETTE.textFaint : PALETTE.textDim);
      row.time.root.alpha = minor ? 0.6 : 1;

      /** ⚠️ 文案一律走 key：渲染层不判 `entry.key` 是什么（i18n 规范 I1）。 */
      row.text.set(t(entry.key, resolveLogParams(entry.params, t)));
      row.text.setSize(style.size);
      row.text.setColor(color);
      row.text.root.alpha = style.alpha;
      /** 字号不同 → 行内居中的偏移也不同，跟着字号算（见 LINE_BOX）。 */
      row.text.root.y = Math.round(y + (REVIEW_ROW_H - style.size * LINE_BOX) / 2);
    }

    /* ---- 滚条（只有真的滚得动才画） ---- */
    if (total > REVIEW_ROWS) {
      const trackX = REVIEW_RECT.x + REVIEW_RECT.w - SCROLLBAR_W - 6;
      const trackY = REVIEW_ROWS_Y;
      const trackH = REVIEW_ROWS * REVIEW_ROW_H;
      g.rect(trackX, trackY, SCROLLBAR_W, trackH).fill({ color: PALETTE.panelLine, alpha: 0.6 });
      const thumbH = Math.max(SCROLLBAR_MIN_H, trackH * scrollThumbRatio(total, REVIEW_ROWS));
      const thumbY = trackY + (trackH - thumbH) * scrollFraction(offset, total, REVIEW_ROWS);
      g.rect(trackX, thumbY, SCROLLBAR_W, thumbH).fill({ color: PALETTE.textDim, alpha: 0.95 });
    }

    /* ---- 页脚 ---- */
    this.hint.set(
      `${t('logReview.hintScroll')} ${SCROLL_KEYS}   ·   ${t('logReview.hintToggle')} ${TOGGLE_KEY}`,
    );
    const win = {
      from: total === 0 ? 0 : offset + 1,
      to: Math.min(offset + REVIEW_ROWS, total),
    };
    this.range.set(t('logReview.range', { from: win.from, to: win.to }));
  }
  /* ---------------------------------------------------------------- *
   * 输入（由 `app/inputRouter.ts` 判完归属再转发进来）
   * ---------------------------------------------------------------- */

  /**
   * 复盘此刻**是否在接收输入**（= 画着且玩家没按 `Space` 藏起来）。
   *
   * ⚠️ 这就是 `inputRouter.activeInputLayer` 判 `review` 层用的那个"开着"。
   * 两个条件缺一不可：`finished`（一局结束）与 `shown`（玩家没有切回结算）。
   */
  isOpen(): boolean {
    return this.finished && this.shown;
  }

  /**
   * 复盘**此刻滚不滚得动** —— 条目多于一屏才算（与滚条的显示条件同源，
   * 见 `redraw` 里 `total > REVIEW_ROWS` 那一段）。
   *
   * ⚠️ 调用方（`canvasInput`）用它决定"这一下点按归复盘还是归
   * 点屏幕离开战斗"：滚不动时复盘吃下点击只会**吞掉**玩家的退出操作。
   */
  canScroll(): boolean {
    return this.entries.length > REVIEW_ROWS;
  }

  /**
   * 复盘**会吃掉指针**的矩形 —— 是**列表区**，不是整块面板。
   *
   * ⚠️ 表头 / 页脚**故意留在外面**：面板几乎占满屏幕（928×516 / 960×540），
   * 若按整块算，"面板外"只剩十几像素的边 —— 手指点不到，触屏玩家就
   * 出不去复盘（详见 `logReview.REVIEW_ROWS_RECT` 的说明）。
   */
  bounds(): LogicalRect {
    return REVIEW_ROWS_RECT;
  }

  /**
   * 滚动位置换算成**指针可用的比例**（0 = 第一行，1 = 最后一行）。
   *
   * 给验证脚本用：它把指针点在哪一行**从面板自己的几何反推**，
   * 而不是抄一份坐标 —— 布局一调，抄的那份就会静默指到别处。
   */
  pointerRatio(): number {
    return scrollFraction(this.offset, this.entries.length, REVIEW_ROWS);
  }

  /** 滚 `delta` 行（正数 = 往新的翻）。**四条**输入路径都走这里。 */
  scrollRows(delta: number): void {
    const next = scrollOffset(this.offset, delta, this.entries.length, REVIEW_ROWS);
    if (next === this.offset) return;
    this.offset = next;
    this.force();
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.isOpen()) return;
    // 复盘时页面本身不该跟着滚（画布是整屏的，滚动没有意义还会误触）
    event.preventDefault();
    // `deltaMode === 1` 时 `deltaY` 的单位是**行**，否则是像素
    const raw = event.deltaMode === 1 ? event.deltaY : event.deltaY / WHEEL_PX_PER_ROW;
    const step = Math.abs(raw) < 1 ? Math.sign(raw) : Math.round(raw);
    if (step !== 0) this.scrollRows(step);
  };

  /**
   * 键盘：**只有输入层是 `review` 时才被调进来**（`loopWiring` 负责判归属）。
   *
   * ⚠️ 这里**不再自查 `event.defaultPrevented`**：归属已经由一个地方
   * （`activeInputLayer`）决定了，再叠一层"谁先注册"的隐式判据就是这次
   * bug 的成因（设置按钮先注册、先吃掉 `↑`）。让路应当发生在**路由**那一步，
   * 而不是靠两个监听器的注册顺序。
   *
   * @returns 是否消费了这次按键（消费了调用方要 `preventDefault`）
   */
  handleKey(key: string): boolean {
    if (!this.isOpen()) return false;
    /** `Space` 在"战报 / 结算"之间来回切（见文件头与 `LogPanel.syncLayer`）。 */
    if (key === ' ') {
      this.shown = false;
      this.force();
      return true;
    }
    switch (key) {
      case 'ArrowDown':
        this.scrollRows(1);
        break;
      case 'ArrowUp':
        this.scrollRows(-1);
        break;
      case 'PageDown':
        this.scrollRows(pageStep(REVIEW_ROWS));
        break;
      case 'PageUp':
        this.scrollRows(-pageStep(REVIEW_ROWS));
        break;
      case 'Home':
        this.scrollRows(-this.entries.length);
        break;
      case 'End':
        this.scrollRows(this.entries.length);
        break;
      default:
        return false;
    }
    return true;
  }

  /**
   * 按下：记住起点（**行**）。
   *
   * ⚠️ 收的是**逻辑 Y 坐标**（画布 960×540），不是 `clientY`：后者是 CSS
   * 像素，会随 letterbox 缩放漂移（见文件头"指针不再是自己的监听"）。
   * 换算与命中判定都收口在 `canvasInput` + `inputRouter`。
   *
   * @param pointerId 指针 id（一个 `pointerId` 只占一个手势）
   * @param logicalY 这一下落在画布逻辑 Y 的哪里
   */
  pointerDown(pointerId: number, logicalY: number): void {
    if (!this.isOpen()) return;
    this.drag = { id: pointerId, logicalY };
    this.dragCarry = 0;
  }

  /**
   * 拖动：**向上拖 = 看更新的**（与"内容跟着手指走"的直觉一致）。
   *
   * ⚠️ 零头要**留着**（`dragCarry`）：慢速拖动时每帧只挪不到一行，
   * 取整会把它抹成 0，表现成"手指慢慢拖、内容纹丝不动"。
   */
  pointerMove(pointerId: number, logicalY: number): void {
    const drag = this.drag;
    if (drag === null || pointerId !== drag.id) return;
    /**
     * 向上拖（`logicalY` 变小）→ `dy` 为正 → 往上翻、看更新的。
     * 零头留在 `dragCarry` 里，跨帧累计。
     */
    const dy = reviewRowsAt(drag.logicalY, 0, REVIEW_ROW_H)
      - reviewRowsAt(logicalY, 0, REVIEW_ROW_H);
    this.drag = { id: pointerId, logicalY };
    /** `dy` 已是**行数**（含小数）；零头跨帧累计。 */
    this.dragCarry += dy;
    const whole = Math.trunc(this.dragCarry);
    if (whole === 0) return;
    this.dragCarry -= whole;
    this.scrollRows(whole);
  }

  /** 松开 / 取消：结束拖拽（`pointercancel` 与 `pointerup` 同义）。 */
  pointerUp(pointerId: number): void {
    if (this.drag !== null && pointerId === this.drag.id) this.drag = null;
  }
}
