/**
 * **肉鸽：每场战斗前的确认屏**（`runConfirm`）。
 *
 * 设计稿：`docs/specs/2026-10-15-roguelike-confirm-screen.md`。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把"本局这一场要派谁、带哪条炁机"**摆成两栏只读详情**，再给一个
 * 「开始战斗」—— 玩家在这一屏**不能改**任何选择（要改得回备战 / 选炁机）。
 *
 * ```
 *   肉鸽：选角色 → 【本屏】→ 战斗 → 选炁机 → 【本屏】→ 战斗 → … → 一局结束
 * ```
 *
 * ==================================================================
 * ⚠️ 两栏**复用**备战屏那块详情面板（不新写一套 UI）
 * ==================================================================
 *
 * 左栏「本次出战」= `detailModelOf({ kind:'player', id })`；
 * 右栏「已选炁机」= `detailModelOf({ kind:'qiji', id })`。
 *
 * ⚠️ 面板的排版**完全**由它拿到的矩形派生，所以这里只是"把同一块面板
 * 画到两块不同大小的矩形里"（`runConfirmLayout` + `PrepareDetailPanel`
 * 的矩形注入口，见那边的文件头）。**不许**复制一份面板去改宽度 ——
 * 那正是"同一份几何两份实现"（AGENTS.md §2）。
 *
 * ⚠️ 右栏显示的是**最近选的那一条**（`RunState.chosen` 的最后一条）。
 * 一局可以选多条（每场之后一条），而这一屏一次只画一条 —— 这是设计稿的
 * 口径（`detailModelOf({kind:'qiji', id})` 收的是一条 id）。整局的清单在
 * 一局结束屏（`RunOverScreen` 的「本局炁机」）里给。第一场之前**没有**
 * 已选炁机，右栏画一句占位，而不是空着。
 *
 * ==================================================================
 * 交互（键盘与触屏**对等**，AGENTS.md §3b）
 * ==================================================================
 *
 *   - 键盘 `Enter` / `Space`：开始战斗（`loopWiring` 的键盘分发）
 *   - 键盘 `Shift + ↑ ↓`：滚**左栏**（本次出战；那一条会比一屏长）
 *   - 触屏 / 鼠标：点「开始战斗」；在任一栏里**拖拽**滚动
 *   - 鼠标滚轮：滚指针底下那一栏
 *   - ⚠️ **没有返回箭头、`Esc` 也不做事**：这一屏紧接在"选炁机 / 开局"
 *     之后，没有"回上一屏"可言（要离开这一局，从**选炁机屏**或一局结束屏
 *     按返回 —— 那两处都还在）。见 `phaseLogic.phaseFromEscape` 的表。
 *
 * ⚠️ **为什么两栏要能滚**：面板按"一屏放得下"画（放不下的行不画），而左栏
 * 是 1 行标题 + 5 条技能 —— 比这一屏给两栏的高度长。不能滚 = 第 5 条技能
 * **永远看不到**（那正是验收里"屏上能读到玩家技能表"）。
 *
 * ⚠️ 键名（`Enter` / `Shift+↑↓`）**不进 i18n**：语言包里只有标签，键名由
 * 渲染层拼（§3b："改快捷键害得改 i18n 吗？"）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { CARD_RADIUS, centeredTextTopY, startSkin } from './prepareRender';
import { PrepareDetailPanel } from './prepareDetailPanel';
import { detailModelOf, runConfirmTargets, type DetailContext, type DetailModel } from './prepareDetail';
import { DETAIL_SCROLL_STEP } from './prepareDetailMetrics';
import {
  RUN_CONFIRM_LAYOUT,
  isOnRunConfirmColumn,
  isOnRunConfirmStart,
  runConfirmColumnLabelY,
  runConfirmColumnRect,
  runConfirmStartCenterX,
  runConfirmStartRect,
} from './runConfirmLayout';
import type { TranslateFn } from '../i18n/translator';

/**
 * 这一屏要显示的内容（由 `app/phaseFlow.runConfirmInfo()` 从真实的一局里
 * 拼好）。⚠️ 渲染层**不认识** `RunState`：接口形状由消费者声明。
 */
export interface RunConfirmInfo {
  /** 这是第几场（1-based）。 */
  readonly position: number;
  /** 这一局一共几场。 */
  readonly length: number;
  /** 出战的角色 id。 */
  readonly playerId: string;
  /** 本局最近选的那条炁机（第一场之前为 `undefined`）。 */
  readonly qijiId?: string | undefined;
}

export interface RunConfirmScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /**
   * 这一场是谁打谁（**取值函数**：每场都不同，一局里这一屏会出现多次）。
   */
  readonly getInfo: () => RunConfirmInfo;
  /**
   * 详情区的数据装配（`app/prepareDetailContext.prepareDetailContext`）。
   *
   * ⚠️ 与备战屏**同一个工厂**：两栏的取值函数（人物技能 / 炁机说明 /
   * 生命上限）都由它接上内容表 —— 这一屏不该有自己的第二份装配。
   */
  readonly detailContext: (free: { readonly on: (id: string) => boolean }) => DetailContext;
  /** 是否显示键位提示（触屏为假）。 */
  readonly showKeyHints: () => boolean;
  /** `F1` 的显示名（齿轮的键位提示；键名不进 i18n）。 */
  readonly f1Label: () => string;
  /** 点右上角的齿轮（打开设置）。 */
  readonly onGear: () => void;
  /** 点 / 按「开始战斗」（真的进战斗）。 */
  readonly onStart: () => void;
}

/** 本屏要拼上去的**键名**（键名不进 i18n，见 AGENTS.md §3b）。 */
const RUN_CONFIRM_KEY_HINT = 'Enter';

export class RunConfirmScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly buttonGfx: Graphics;
  private readonly title: Label;
  private readonly progress: Label;
  private readonly leftLabel: Label;
  private readonly rightLabel: Label;
  private readonly startLabel: Label;
  private readonly hint: Label;
  /** 右栏没有已选炁机时的那一句（第一场之前）。 */
  private readonly qijiPlaceholder: Label;
  /**
   * 两栏的详情面板（**同一个类、同一份实现**，只是矩形不同）。
   *
   * ⚠️ 构造顺序无所谓（它们都画在自己矩形里、互不重叠），但**必须**都在
   * 本屏自己的 `root` 里 —— 否则 `setVisible(false)` 管不住它们
   * （正是 `phaseVisibility` 那条不变量要的形状）。
   */
  private readonly playerPanel: PrepareDetailPanel;
  private readonly qijiPanel: PrepareDetailPanel;

  readonly chrome: ScreenChrome;
  private readonly options: RunConfirmScreenOptions;

  /**
   * 详情上下文（**构造一次**，不是每帧新造）。
   *
   * ⚠️ `on` 读的是这个字段 —— "哪条炁机是已激活的"每帧都要现算（`info`
   * 每场都变），而闭包只需要一个（每帧新造一整套取值函数只是白白分配）。
   */
  private currentQijiId: string | undefined = undefined;
  private readonly ctx: DetailContext;
  /**
   * 这一屏**此刻画的是哪一场**（上一次 `redraw` 读到的 `getInfo()`）。
   *
   * ⚠️ 它是**观测数据**（调试 / 验收探针读它）：截图能证明"屏上有两栏字"，
   * 证明不了"那是第几场、右栏是不是刚选的那条炁机"。不参与任何判定。
   */
  private lastInfo: RunConfirmInfo | undefined = undefined;

  constructor(options: RunConfirmScreenOptions) {
    this.options = options;
    const { pixi } = options;

    this.root = new pixi.Container();
    this.root.visible = false;

    this.ctx = options.detailContext({ on: (id) => id === this.currentQijiId });

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

    /** 栏目标题：两栏各自的**左上角**（贴着面板上边那一行）。 */
    this.leftLabel = this.makeColumnLabel(pixi, 'left');
    this.rightLabel = this.makeColumnLabel(pixi, 'right');
    const rightRect = runConfirmColumnRect('right');

    this.playerPanel = new PrepareDetailPanel(pixi, options.translate, () =>
      runConfirmColumnRect('left'),
    );
    this.qijiPanel = new PrepareDetailPanel(pixi, options.translate, () =>
      runConfirmColumnRect('right'),
    );
    this.root.addChild(this.playerPanel.root, this.qijiPanel.root);

    /**
     * 右栏的占位（**第一场之前没有任何已选炁机**）。
     *
     * ⚠️ 不复用面板自己的"把光标移到卡片上"那句占位：那一句说的是**卡片**，
     * 而这一屏根本没有卡片 —— 会让玩家去找一个不存在的东西。
     */
    this.qijiPlaceholder = new Label(pixi, {
      x: rightRect.x + rightRect.w / 2,
      y: 0,
      size: FONT.body,
      color: PALETTE.textFaint,
      anchorX: 0.5,
      anchorY: 0,
      wrap: { width: rightRect.w - 24 },
    });
    this.root.addChild(this.qijiPlaceholder.root);

    /** 「开始战斗」：一颗按钮 + 四个字（位置都从 `runConfirmStartRect` 推）。 */
    this.buttonGfx = new pixi.Graphics();
    this.startLabel = new Label(pixi, {
      x: runConfirmStartCenterX(),
      y: 0,
      size: FONT.body,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: RUN_CONFIRM_LAYOUT.hintY,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.buttonGfx, this.startLabel.root, this.hint.root);

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

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    /** ⚠️ 显示时立刻按**这一场**重算（否则会停在上一次打开时的内容）。 */
    if (visible) this.redraw();
  }

  /** `Enter` / `Space` / 点按钮：开始这一场。 */
  confirm(): void {
    this.options.onStart();
  }

  /**
   * 点一下（逻辑坐标）。@returns 是否消费了这次点击
   *
   * ⚠️ 齿轮**先于**按钮（顺序即优先级，与其余整屏界面同一条）：点齿轮
   * 不该顺带开战。
   */
  hitTest(px: number, py: number): boolean {
    if (this.chrome.hitTest(px, py)) return true;
    if (!isOnRunConfirmStart(px, py)) return false;
    this.confirm();
    return true;
  }

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
   * 两栏的滚动（滚轮 / 拖拽 / Shift+↑↓）
   * ---------------------------------------------------------------- */

  /**
   * 这个点是不是落在**可以拖拽滚动的区域**里（输入层的拖拽判据）。
   *
   * ⚠️ 与备战屏同一个形状（`PrepareScreen.isOnScrollable`）：这一屏也长了，
   * 而**没有滚轮**的输入方式（触屏）必须能读到下面那几行（AGENTS.md §3b
   * "功能必须对等"）。两栏的矩形判据在 `runConfirmLayout`（纯函数，有单测）。
   */
  isOnScrollable(px: number, py: number): boolean {
    return this.panelUnder(px, py) !== undefined;
  }

  /**
   * **滚轮**（鼠标 / 触控板）：滚指针底下那一栏。
   *
   * @returns 有没有真的滚（没消费就让页面自己滚）
   */
  wheelDetail(px: number, py: number, deltaY: number): boolean {
    const panel = this.panelUnder(px, py);
    if (panel === undefined) return false;
    return panel.scrollBy(deltaY * 3);
  }

  /**
   * **拖拽**（触屏没有滚轮，这条路必须存在）。
   *
   * @param deltaY 这一帧相对上一帧的位移（向上为负）
   */
  dragDetail(px: number, py: number, deltaY: number): boolean {
    const panel = this.panelUnder(px, py);
    if (panel === undefined) return false;
    return panel.scrollBy(-deltaY);
  }

  /**
   * **`Shift + ↑ ↓`**：按固定步长滚**左栏**（本次出战）。
   *
   * ⚠️ 为什么钉的是左栏、而不是"鼠标底下那一栏"：键盘没有指针，而
   * **今天只有左栏会长**（玩家的 5 条技能 > 一屏；右栏最多一条）。
   * 键盘那条路走 `loopWiring` 的 `Shift+↑↓`（与备战屏同一个键位习惯）。
   *
   * @returns 有没有真的动（内容不足一屏时为 `false` —— 那是正常的"什么
   *   也不做"，不是 bug）
   */
  scrollDetail(dir: 'up' | 'down'): boolean {
    return this.playerPanel.scrollBy(dir === 'up' ? -DETAIL_SCROLL_STEP : DETAIL_SCROLL_STEP);
  }

  /** 这一点底下是**哪一栏的面板**（栏外 / 右栏没内容时 `undefined`）。 */
  private panelUnder(px: number, py: number): PrepareDetailPanel | undefined {
    if (isOnRunConfirmColumn('left', px, py)) return this.playerPanel;
    /**
     * ⚠️ 右栏没有内容时（第一场之前）**它自己不可见**：在那一块拖拽不该
     * 被吃掉 —— 那一下属于页面（与"内容装得下就不消费滚轮"同一条纪律）。
     */
    if (this.qijiPanel.visible && isOnRunConfirmColumn('right', px, py)) return this.qijiPanel;
    return undefined;
  }

  /* ---------------------------------------------------------------- *
   * 内部
   * ---------------------------------------------------------------- */

  /** 一栏的标题（左对齐，画在那一栏面板的上方）。 */
  private makeColumnLabel(pixi: PixiCtor, side: 'left' | 'right'): Label {
    const rect = runConfirmColumnRect(side);
    const label = new Label(pixi, {
      x: rect.x,
      y: runConfirmColumnLabelY(),
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
    this.currentQijiId = info.qijiId;
    this.lastInfo = info;

    this.title.set(t('screen.runConfirm.title'));
    this.progress.set(
      t('screen.runConfirm.progress', {
        position: String(info.position),
        length: String(info.length),
      }),
    );
    this.leftLabel.set(t('screen.runConfirm.player'));
    this.rightLabel.set(t('screen.runConfirm.qiji'));

    /**
     * 两栏该显示谁 —— 判据在 `prepareDetail.runConfirmTargets`（纯函数、
     * 有单测）：`qiji === undefined` 就是"第一场之前 → 右栏画占位"。
     */
    const targets = runConfirmTargets(info);
    const player: DetailModel | undefined = detailModelOf(targets.player, this.ctx);
    this.playerPanel.update(player);

    const qiji: DetailModel | undefined =
      targets.qiji === undefined ? undefined : detailModelOf(targets.qiji, this.ctx);
    this.qijiPanel.setVisible(qiji !== undefined);
    this.qijiPlaceholder.root.visible = qiji === undefined;
    if (qiji === undefined) {
      this.qijiPlaceholder.set(t('screen.runConfirm.noQiji'));
      const rect = runConfirmColumnRect('right');
      this.qijiPlaceholder.root.y = centeredTextTopY(rect.y, rect.h, this.qijiPlaceholder.root.height);
    } else {
      this.qijiPanel.update(qiji);
    }

    /**
     * 按钮：**恒定是"主按钮"（金色）**，不画光标皮肤。
     *
     * ⚠️ 这一屏**没有光标**（唯一的动作就是它），用 `cursored: true` 的
     * 冷白会读成"光标停在这儿" —— 而金色在备战屏的语义是"确定 / 生效"
     * （`startSkin` 的说明），正是这里的含义。
     */
    const sr = runConfirmStartRect();
    const skin = startSkin({ developing: false, cursored: false });
    this.buttonGfx.clear();
    this.buttonGfx
      .roundRect(sr.x, sr.y, sr.w, sr.h, CARD_RADIUS)
      .fill({ color: skin.fillColor, alpha: skin.fillAlpha });
    this.buttonGfx
      .roundRect(sr.x, sr.y, sr.w, sr.h, CARD_RADIUS)
      .stroke({ color: skin.strokeColor, width: skin.strokeWidth });
    this.startLabel.set(t('screen.runConfirm.start'));
    this.startLabel.setColor(skin.labelColor);
    this.startLabel.root.y = sr.y + sr.h / 2;

    /**
     * 操作提示。
     *
     * ⚠️ **触屏是空行**（这一屏与别处不同）：这里唯一的动作就是那颗按钮，
     * 而提示的**标签**与按钮文案是同一句（「开始战斗」）—— 触屏又不拼键名，
     * 于是那一行只会把按钮上的字**再写一遍**（实测截图里就是这样）。
     * 一局结束屏的提示不是这种情况（它的标签是动作名「回选角色」，
     * 与屏幕上的任何字都不重复），所以它触屏照写 —— 两者不同**是有意的**。
     */
    const keys = this.options.showKeyHints() ? t('screen.keyHint', { keys: RUN_CONFIRM_KEY_HINT }) : '';
    this.hint.set(keys === '' ? '' : `${t('screen.runConfirm.hint')}${keys}`);
  }
}
