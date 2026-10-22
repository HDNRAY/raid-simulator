/**
 * **肉鸽：每场战斗前的确认屏**（`runConfirm`）。
 *
 * 设计稿：`docs/specs/2026-10-15-roguelike-confirm-screen.md`（本屏的
 * 内容口径在 2026-10-15 当天改过一次，见下）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它在**开战之前**摆出这一场的两件事 —— 「炁机」与「对手」—— 右边一块
 * **共用**的详情面板显示**当前焦点那一行**的详情，底部一个「开始战斗」。
 *
 * ```
 *   肉鸽：选角色 → 【本屏】→ 战斗 → 选炁机 → 【本屏】→ 战斗 → … → 一局结束
 * ```
 *
 * ==================================================================
 * ⚠️ 2026-10-15 当天的改动：玩家详情挪走了、右侧详情改成**共用**
 * ==================================================================
 *
 * 用户原话：
 *
 * > "选择角色界面，显示当前 hover 角色的详情，战斗开始之前，只显示炁机
 * >  和 boss详情" + "老规矩 炁机和boss共用右侧详情，键盘的话 tab在炁机
 * >  boss 开始战斗间切换"
 *
 * 于是这一屏**曾经**的两栏（本次出战 / 已选炁机）变成：
 *
 * | | 以前 | 现在 |
 * |---|---|---|
 * | 玩家详情 | 左栏一栏（本次出战） | **挪到选角色屏**（hover / 焦点跟随，见 `CharacterSelectScreen`） |
 * | 炁机 / 对手 | 只画炁机那一栏 | **两行只读块头**（炁机在上、对手在下） |
 * | 右侧详情 | 两块并排的面板 | **一块共用面板**，跟着焦点切（"老规矩"） |
 * | 键盘 | 只有 Enter | **Tab 在炁机 / 对手 / 开始战斗间切换**（与备战屏同一条） |
 *
 * ⚠️ 这一版**推翻了**"两栏"那版（它只有一天历史），所以 `runConfirmLayout`
 * 里的两栏几何整块删掉了 —— 留着就是"同一件事的两份表达"（AGENTS §2）。
 *
 * ==================================================================
 * ⚠️ 一行都不新写：全部复用备战屏那一套（"老规矩"）
 * ==================================================================
 *
 * | 这一屏的东西 | 复用谁 |
 * |---|---|
 * | 两行块头的矩形 / 命中区 | `runConfirmLayout` → `prepareGeometry.foldRect` / `foldHitRect` |
 * | 块头那一行字（**已确定的选择**） | `prepareFold.foldSummaryOf`（"已激活 1 条：固本培元" / Boss 名） |
 * | 块头的画法（含焦点那条的光标皮肤） | `prepareFoldBars.PrepareFoldBars` |
 * | 右侧详情面板 | `prepareDetailPanel.PrepareDetailPanel`（备战屏那一块，x624 宽296 通高） |
 * | 焦点状态机（顺序 / 跳空槽 / 环绕 / `expanded`） | `prepareLogic` 的 `moveFocus` / `focusTarget` |
 * | 「开始战斗」+ 提示那一排 | `prepareGeometry.startRect` / `footerHintSlot` / `startCenterX` |
 * | 两行各显示谁（纯判定） | `prepareDetail.runConfirmSelection` / `runConfirmDetailTarget` |
 *
 * ==================================================================
 * 交互（键盘与触屏**对等**，AGENTS.md §3b）
 * ==================================================================
 *
 *   - 键盘 `Tab` / `Shift+Tab` / `↑` / `↓`：焦点在**炁机 → 对手 → 开始战斗**
 *     之间切换（环绕；没有已选炁机时那一站自动跳过 —— 与备战屏跳过空槽位
 *     同一条判据）
 *   - 键盘 `Enter` / `Space`：**开始这一场**（确认屏上"Enter = 确认"）
 *   - 键盘 `Shift + ↑ ↓`：滚右侧详情（Boss 的招式 + 被动比一屏长）
 *   - 触屏 / 鼠标：**点某一行** = 把焦点与右侧详情切到它；**点「开始战斗」** = 开局
 *   - 拖拽 / 滚轮：滚右侧详情
 *   - ⚠️ **没有返回箭头、`Esc` 也不做事**：这一屏紧接在"选炁机 / 开局"
 *     之后，没有"回上一屏"可言（要离开这一局，从**选炁机屏**或一局结束屏
 *     按返回）。见 `phaseLogic.phaseFromEscape` 的表。
 *
 * ⚠️ 键名（`Tab` / `Enter`）**不进 i18n**：语言包里只有标签，键名由渲染层
 * 当**参数**拼进去（§3b："改快捷键害得改 i18n 吗？"）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { PrepareDetailPanel } from './prepareDetailPanel';
import { PrepareFoldBars, type FoldBarDraw } from './prepareFoldBars';
import { foldSummaryOf, type FoldSummary } from './prepareFold';
import { foldTextMaxChars, footerHintSlot, startRect } from './prepareGeometry';
import { TextButton } from './TextButton';
import {
  detailModelOf,
  runConfirmDetailTarget,
  whisperDetailModel,
  type DetailContext,
  type DetailModel,
  type DetailUnit,
  type DetailWhisper,
} from './prepareDetail';
import {
  focusRunConfirmBlock,
  moveRunConfirmFocus,
  runConfirmSelection,
  type RunConfirmFocus,
  type RunConfirmSelection,
} from './runConfirmFocus';
import { DETAIL_SCROLL_STEP } from './prepareDetailMetrics';

import {
  RUN_CONFIRM_LAYOUT,
  isOnRunConfirmBlock,
  runConfirmBlockLabelY,
  runConfirmBlockRect,
  runConfirmBlockTops,
  type RunConfirmBlock,
} from './runConfirmLayout';
import type { TranslateFn } from '../i18n/translator';

/**
 * 这一屏要显示的内容（由 `app/phaseFlow.runConfirmInfo()` 从真实的一局里
 * 拼好）。⚠️ 渲染层**不认识** `RunState` / 内容表：接口形状由消费者声明。
 *
 * ⚠️ 名字（`nameKey`）由 app 层从内容表取（`BOSS_ROSTER` / `qiji.nameKey`）：
 * 这一屏拿到的**只有名字 key**，文字一律走 `translate`。
 */
export interface RunConfirmInfo {
  /** 这是第几场（1-based）。 */
  readonly position: number;
  /** 这一局一共几场。 */
  readonly length: number;
  /** 这一场的对手。 */
  readonly boss: DetailUnit;
  /**
   * 本局已选的炁机（**全部**，按选的先后；空数组 = 第一场之前 → 那一行
   * 整块不画）。
   *
   * ⚠️ 是**清单**：块头照实写"已激活 N 条：A、B"（与备战屏同一个
   * `foldSummaryOf`），而右侧详情一次只画得出**最后一条**（刚选的那条）。
   */
  readonly qiji: readonly DetailUnit[];
  /**
   * **这一层的「恶魔低语」**（2026-10-16）；第 1 层是 `undefined`。
   *
   * ⚠️ `undefined` 不是"这一行不画" —— 那一行**永远在**（写「本层纯净」），
   * 因为"这一层有没有惩罚"本身就是要给玩家看的信息。
   */
  readonly whisper: DetailWhisper | undefined;
}

export interface RunConfirmScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /** 这一场打谁、带了哪条炁机（**取值函数**：一局里这一屏会出现多次）。 */
  readonly getInfo: () => RunConfirmInfo;
  /**
   * 详情区的数据装配（`app/prepareDetailContext.prepareDetailContext`）。
   *
   * ⚠️ 与备战屏**同一个工厂**：两行的取值函数（Boss 招式 / 炁机说明）都由
   * 它接上内容表 —— 这一屏不该有自己的第二份装配。
   */
  readonly detailContext: (free: { readonly on: (id: string) => boolean }) => DetailContext;
  /** 是否显示键位提示（触屏为假）。 */
  readonly showKeyHints: () => boolean;
  /** `F1` 的显示名（齿轮的键位提示；键名不进 i18n）。 */
  readonly f1Label: () => string;
  /** 点右上角的齿轮（打开设置）。 */
  readonly onGear: () => void;
  /** 「开始战斗」（真的进战斗）。 */
  readonly onStart: () => void;
}

/** 本屏要拼上去的**键名**（键名不进 i18n，见 AGENTS.md §3b）。 */
const RUN_CONFIRM_KEYS = { tab: 'Tab', enter: 'Enter' } as const;

export class RunConfirmScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  /** 「开始战斗」—— 共用组件（与选人屏「开始游戏」同一份皮肤/画法）。 */
  private readonly startButton: TextButton;
  private readonly title: Label;
  private readonly progress: Label;
  private readonly qijiLabel: Label;
  private readonly bossLabel: Label;
  /** 「恶魔低语」那一行的栏目标题（永远在，见 `RunConfirmInfo.whisper`）。 */
  private readonly whisperLabel: Label;
  private readonly hint: Label;
  /**
   * 两行**只读块头**（复用备战屏那一支画笔）。
   *
   * ⚠️ 它自己带一支 `Graphics`（备战屏与卡片共用一个笔；这一屏只有它画
   * 块头）—— `PrepareFoldBars.draw` 会 `clear()` 那一支笔，所以不能与
   * 按钮共用。
   */
  private readonly bars: PrepareFoldBars<RunConfirmBlock>;
  private readonly barGfx: Graphics;
  /** 右侧那块**共用**详情面板（与备战屏同一个类、同一块矩形）。 */
  private readonly panel: PrepareDetailPanel;

  readonly chrome: ScreenChrome;

  private readonly options: RunConfirmScreenOptions;
  /**
   * 焦点状态（`runConfirmFocus` 那台**确认屏自己的**状态机）。
   *
   * ⚠️ 走位算法与备战屏**共用**（`ui/focusOrder.stepFocus`），但状态形状
   * 不同：这一屏有**四站**（多一行「恶魔低语」）、没有块内光标 ——
   * 理由逐条写在 `runConfirmFocus.ts` 的文件头。
   */
  private selection: RunConfirmSelection;
  /** 详情上下文（**构造一次**；`on` 读的是下面那个字段，见 `redraw`）。 */
  private readonly ctx: DetailContext;
  /** 本局已选的炁机 id（`ctx.qijiOn` 的判据：选了的那些就是"激活"）。 */
  private currentQijiIds: readonly string[] = [];
  /**
   * 这一屏**此刻画的是哪一场**（上一次 `redraw` 读到的 `getInfo()`）。
   *
   * ⚠️ 它是**观测数据**（调试 / 验收探针读它）：截图能证明"屏上有两行字"，
   * 证明不了"那是第几场、右栏是不是刚选的那条炁机"。不参与任何判定。
   */
  private lastInfo: RunConfirmInfo | undefined = undefined;

  constructor(options: RunConfirmScreenOptions) {
    this.options = options;
    const { pixi } = options;

    this.root = new pixi.Container();
    this.root.visible = false;

    /**
     * ⚠️ `on` 判据是"**本局已选的那条**"：确认屏上炁机的激活态没有别的来源
     * （肉鸽里选过的就是生效的），与 `phaseFlow.activeQiji()` 同一条事实。
     */
    this.ctx = options.detailContext({ on: (id) => this.currentQijiIds.includes(id) });
    this.selection = runConfirmSelection(options.getInfo());

    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.root.addChild(this.bg);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: RUN_CONFIRM_LAYOUT.titleY,
      size: 32,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.progress = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: RUN_CONFIRM_LAYOUT.progressY,
      size: FONT.body,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.title.root, this.progress.root);

    /**
     * 两行的**栏目标题**：位置由 `runConfirmLayout` 的纵向链给（块头顶边
     * 反推 `labelGap`）—— 与备战屏同一条，不在别处再写一个 y。
     *
     * ⚠️ 两块都建好、由 `redraw` 决定显隐（没有已选炁机时那一行**整块**
     * 不画：连标题一起藏）。
     */
    this.qijiLabel = this.makeBlockLabel(pixi);
    this.bossLabel = this.makeBlockLabel(pixi);
    /** 第三行：「恶魔低语」（**永远在**，第 1 层写「本层纯净」）。 */
    this.whisperLabel = this.makeBlockLabel(pixi);

    /** 两行块头：共用`Graphics` + 每行一个 `Label`（`PrepareFoldBars` 内部建）。 */
    this.barGfx = new pixi.Graphics();
    this.root.addChild(this.barGfx);
    this.bars = new PrepareFoldBars<RunConfirmBlock>({ pixi, gfx: this.barGfx, parent: this.root });

    /** 右侧那块共用详情面板（与备战屏同一块矩形，见 `PrepareDetailPanel`）。 */
    this.panel = new PrepareDetailPanel(pixi, options.translate);
    this.root.addChild(this.panel.root);

    /** 「开始战斗」：矩形 / 提示格 / 文字中心全部来自备战屏那一套几何。 */
    const start = startRect();
    this.startButton = new TextButton({
      pixi,
      rect: start,
      label: options.translate('roster.ui.start'),
      kind: 'primary',
      size: FONT.body,
      kai: false,
      /** 点它 = 与 `Enter` **同一个**动作。 */
      onPress: () => this.confirm(),
    });
    this.hint = new Label(pixi, {
      x: footerHintSlot().x,
      y: start.y + start.h / 2,
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 0,
      anchorY: 0.5,
    });
    this.root.addChild(this.startButton.root, this.hint.root);

    this.chrome = new ScreenChrome({
      pixi,
      showKeyHints: options.showKeyHints,
      f1Label: options.f1Label,
      onGear: options.onGear,
    });
    this.root.addChild(this.chrome.root);

    this.redraw();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** 这一屏此刻画的是哪一场（调试读数；`undefined` = 还没画过）。 */
  get currentInfo(): RunConfirmInfo | undefined {
    return this.lastInfo;
  }

  /** 焦点此刻在哪一站（调试读数：`'qiji' | 'boss' | 'whisper' | 'start'`）。 */
  get focus(): RunConfirmFocus {
    return this.selection.focus;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    /**
     * ⚠️ 每次显示都**按这一场重造焦点状态**（否则会停在上一次打开时的
     * 焦点 / 展开块上）—— 与选炁机屏"每次显示把光标归零"同一条。
     */
    if (visible) {
      const info = this.options.getInfo();
      this.selection = runConfirmSelection(info);
      this.redraw();
    }
  }

  /* ---------------------------------------------------------------- *
   * 键盘（`loopWiring` 分发）
   * ---------------------------------------------------------------- */

  /**
   * **Tab / Shift+Tab / ↑ / ↓**：焦点在炁机 → 对手 → 开始战斗之间切（环绕）。
   *
   * ⚠️ 跳过空槽位 / 顺序 / 环绕**全在** `prepareLogic.moveFocus`（备战屏那套）
   * —— 本屏不复制一份"哪几站可以停"。
   */
  moveFocus(delta: number): void {
    const next = moveRunConfirmFocus({
      selection: this.selection,
      delta,
      hasQiji: (this.lastInfo?.qiji.length ?? 0) > 0,
    });
    if (next === this.selection) return;
    this.selection = next;
    this.redraw();
  }

  /** 把焦点**直接**放到某一行（点块头；与 Tab 同一个状态机）。 */
  focusBlock(block: RunConfirmBlock): void {
    const next = focusRunConfirmBlock({
      selection: this.selection,
      block,
      hasQiji: (this.lastInfo?.qiji.length ?? 0) > 0,
    });
    if (next === this.selection) return;
    this.selection = next;
    this.redraw();
  }

  /** `Enter` / `Space`：开始这一场（确认屏上"Enter = 确认"）。 */
  confirm(): void {
    this.options.onStart();
  }

  /**
   * **`Shift + ↑ ↓`**：滚右侧详情正文（Boss 的招式 + 被动比一屏长）。
   *
   * ⚠️ 与备战屏**同一个键位习惯**（裸 ↑↓ 是焦点导航，Shift+↑↓ 才是正文）。
   *
   * @returns 有没有真的动（内容不足一屏时为 `false` —— 那是正常的"什么
   *   也不做"，不是 bug）
   */
  scrollDetail(dir: 'up' | 'down'): boolean {
    return this.panel.scrollBy(dir === 'up' ? -DETAIL_SCROLL_STEP : DETAIL_SCROLL_STEP);
  }

  /* ---------------------------------------------------------------- *
   * 指针（`canvasInput` 路由）
   * ---------------------------------------------------------------- */

  /**
   * 点一下（逻辑坐标）。@returns 是否消费了这次点击
   *
   * ⚠️ 顺序即优先级：齿轮 → 两行块头 → 开始键（与备战屏同一条）。
   */
  hitTest(px: number, py: number): boolean {
    if (this.chrome.hitTest(px, py)) return true;
    const hasQiji = (this.lastInfo?.qiji.length ?? 0) > 0;
    for (const block of ['qiji', 'boss', 'whisper'] as const) {
      if (!isOnRunConfirmBlock(block, hasQiji, px, py)) continue;
      this.focusBlock(block);
      return true;
    }
    const start = startRect();
    if (px < start.x || px > start.x + start.w) return false;
    if (py < start.y || py > start.y + start.h) return false;
    this.confirm();
    return true;
  }

  /** 这个点是不是落在**右侧详情**那块可滚视口里（拖拽 / 滚轮的判据）。 */
  isOnScrollable(px: number, py: number): boolean {
    return this.panel.isOnDetail(px, py);
  }

  /** **滚轮**：滚右侧详情。@returns 有没有真的滚 */
  wheelDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.panel.isOnDetail(px, py)) return false;
    return this.panel.scrollBy(deltaY * 3);
  }

  /** **拖拽**（触屏没有滚轮，这条路必须存在）。@param deltaY 向上为负 */
  dragDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.panel.isOnDetail(px, py)) return false;
    return this.panel.scrollBy(-deltaY);
  }

  /* ---------------------------------------------------------------- *
   * 每帧
   * ---------------------------------------------------------------- */

  /** 每帧：只在可见时保证画面与这一场的信息一致。 */
  frame(): void {
    if (this.root.visible) {
      this.redraw();
      this.chrome.update();
    }
  }

  /** **UI 缩放**：本屏只转发给**它自己的**边角控件（与其它整屏界面同一条）。 */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  /* ---------------------------------------------------------------- *
   * 内部
   * ---------------------------------------------------------------- */

  /** 一行的栏目标题（左对齐，画在块头上方；位置在 `redraw` 里给）。 */
  private makeBlockLabel(pixi: PixiCtor): Label {
    const label = new Label(pixi, {
      x: 0,
      y: 0,
      size: FONT.body,
      color: PALETTE.textDim,
      anchorX: 0,
      anchorY: 0.5,
    });
    this.root.addChild(label.root);
    return label;
  }

  private redraw(): void {
    const t = this.options.translate;
    const info = this.options.getInfo();
    /** ⚠️ 先更新 `on` 读的那个字段，再问面板要模型（顺序即正确性）。 */
    this.currentQijiIds = info.qiji.map((q) => q.id);
    this.lastInfo = info;

    this.title.set(t('screen.runConfirm.title'));
    this.progress.set(
      t('screen.runConfirm.progress', {
        position: String(info.position),
        length: String(info.length),
      }),
    );

    const hasQiji = info.qiji.length > 0;
    /**
     * ⚠️ 焦点状态在**每次重画时对齐当前这一场**：两行里的"炁机"那一行
     * 在第一场之前不存在，而焦点可能停在它上面（理论上到不了 —— 每次
     * `setVisible(true)` 都会重造 —— 但 `frame()` 每帧重画，所以这里
     * 兜一次底：把不存在的槽位上的焦点挪到对手上）。
     */
    if (!hasQiji && this.selection.expanded === 'qiji') {
      this.selection = runConfirmSelection(info);
    }

    /** 块头文字 = "当前选了什么"（`prepareFold` 那条判据），不是"光标指着谁"。 */
    const maxChars = foldTextMaxChars();
    /**
     * ⚠️ 块头文字 = "当前选了什么"（`prepareFold` 那条判据），不是"光标指着谁"。
     * 这一屏没有人物行，所以 `playerId` 恒为空串（`foldSummaryOf` 的入参形状
     * 与备战屏共用，空值 = 没有那一行）。
     */
    const chosen = { playerId: '', bossId: info.boss.id };
    const summaries: {
      readonly qiji: FoldSummary | undefined;
      readonly boss: FoldSummary | undefined;
    } = {
      qiji: hasQiji
        ? foldSummaryOf({
            kind: 'qiji',
            selection: chosen,
            players: [],
            bosses: [],
            qiji: info.qiji,
            on: (id) => this.currentQijiIds.includes(id),
            translate: t,
            maxChars,
          })
        : undefined,
      boss: foldSummaryOf({
        kind: 'boss',
        selection: chosen,
        players: [],
        bosses: [info.boss],
        qiji: [],
        on: () => false,
        translate: t,
        maxChars,
      }),
    };

    /**
     * 两行块头的画（含**焦点那条**的光标皮肤）—— 位置全部来自
     * `runConfirmLayout`（它内部又走备战屏的 `foldRect`）。
     */
    const bars: FoldBarDraw<RunConfirmBlock>[] = [];
    const labelOf = (block: RunConfirmBlock): Label =>
      block === 'qiji' ? this.qijiLabel : block === 'boss' ? this.bossLabel : this.whisperLabel;
    const titleOf = (block: RunConfirmBlock): string =>
      block === 'qiji'
        ? t('roster.ui.qijiLabel')
        : block === 'boss'
          ? t('screen.runConfirm.bossBlock')
          : t('screen.runConfirm.whisperBlock');
    const place = (block: RunConfirmBlock, summary: { readonly text: string } | undefined): void => {
      const rect = runConfirmBlockRect(block, hasQiji);
      const label = labelOf(block);
      if (rect === undefined || summary === undefined) {
        /** 这一行不存在：连标题一起藏（不是"画一条空的"）。 */
        label.root.visible = false;
        return;
      }
      label.set(titleOf(block));
      label.root.x = rect.x;
      label.root.y = blockLabelY(block, hasQiji);
      label.root.visible = true;
      bars.push({
        kind: block,
        rect,
        text: summary.text,
        focused: this.selection.focus === block,
      });
    };
    place('qiji', summaries.qiji);
    place('boss', summaries.boss);
    /**
     * 「恶魔低语」那一行的块头文字：抽到的那条的名字，第 1 层写「本层纯净」。
     * 它**没有** `foldSummaryOf` 那一套（那不是"选择"，是"这一层的规则"）。
     */
    place('whisper', { text: info.whisper === undefined ? t('screen.runConfirm.whisperNone') : t(info.whisper.nameKey) });
    this.bars.draw(bars);

    /** 右侧**共用**详情：读 `expanded`（焦点在开始键上时它仍是上一块）。 */
    const target = runConfirmDetailTarget({
      expanded: this.selection.expanded,
      boss: info.boss,
      qiji: info.qiji,
      whisper: info.whisper,
    });
    /**
     * ⚠️ 低语那一条**不走** `detailModelOf`：那台机器按 `DetailContext` 查
     * "内容表里有什么"（人物 / 炁机 / Boss 各自的取数函数），而低语是一段
     * **这一层现算出来的规则**（名字 + 一句话），没有第二个来源可查。
     */
    const model: DetailModel | undefined =
      target.kind === 'whisper'
        ? whisperDetailModel(info.whisper, {
            nameKey: 'screen.runConfirm.whisperNone',
            descKey: 'screen.runConfirm.whisperNoneDesc',
          })
        : detailModelOf(target, this.ctx);
    this.panel.setVisible(true);
    this.panel.update(model);

    /** 「开始战斗」：焦点在它上面时换光标皮肤（`startSkin` 在组件里 ✓）。 */
    this.startButton.setFocused(this.selection.focus === 'start');

    /**
     * 操作提示：**触屏为空**。
     *
     * ⚠️ 与备战屏不同（那里触屏有一句 `hintTouch`）：这一屏能做的事就是
     * "点一行看详情 / 点开始"，而两条路都摆在画面上 —— 编一句触屏文案
     * 只会多一句要维护的话。键盘那一句要说明的是**键怎么用**（Tab 切换）。
     */
    this.hint.set(
      this.options.showKeyHints()
        ? t('screen.runConfirm.hint', RUN_CONFIRM_KEYS)
        : '',
    );
  }
}

/** 某一块的栏目标题中心 y（炁机那一行不在时按对手算 —— 调用方不会传它）。 */
function blockLabelY(block: RunConfirmBlock, hasQiji: boolean): number {
  const tops = runConfirmBlockTops(hasQiji);
  if (block === 'qiji') return runConfirmBlockLabelY(tops.qiji ?? tops.boss);
  return runConfirmBlockLabelY(block === 'boss' ? tops.boss : tops.whisper);
}
