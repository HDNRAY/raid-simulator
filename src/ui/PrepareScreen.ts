/**
 * **自由模式（备战屏）**：选人物 →（开炁机）→ 选对手 → 开始战斗。
 *
 * ==================================================================
 * 需求（本轮，用户原话）
 * ==================================================================
 *
 * > "做完这些开始做 **自由模式，选了人之后，可以激活任意个他的炁机**，
 * >  同时，**右边或者左边 切出一部分区域，显示当前选择框（hover或者
 * >  键盘）所在的人物 or 炁机 or boss 的详情**。
 * >  **选择人物的卡片可以尽量缩小一点，留一个名字** +（去 fd 资源里，
 * >  找到 索尔 凯丽 索菲亚 3 个人的**说话的头像**放在**我们3个角色名字
 * >  的右边**，高度比名字高一点点）"
 *
 * 三件事的落点：
 *
 * | 需求 | 落在哪 |
 * |---|---|
 * | 卡片缩小 + 名字右边加头像 | `prepareLayout`（尺寸）+ `prepareRender`（皮肤）+ 本文件的卡片循环 |
 * | 详情区（hover / 键盘驱动） | `prepareDetail`（模型）+ `PrepareDetailPanel`（画）+ 本文件的 `hover()` |
 * | 选人之后激活任意个炁机 | `prepareLogic.cycleQijiStack`（规则）+ `app/freeQijiStore`（存档与生效） |
 *
 * ⚠️ 本文件**只是装配**：几何在 `prepareLayout`、状态机在 `prepareLogic`、
 * 皮肤在 `prepareRender`、详情内容在 `prepareDetail`。这一层负责"把它们的
 * 产物摆到 Pixi 对象上"，以及"输入事件该调哪个纯函数"。
 *
 * ==================================================================
 * ⚠️ 每帧只改字符串与可见性，不重建 Text / Graphics
 * ==================================================================
 *
 * `Label` / `Graphics` 全部在构造时建好（含**行池**），`draw()` 只做
 * `set()` / `clear()` / 坐标。加东西时请照这条走 —— 每帧 `new Text()`
 * 会重建 GPU 纹理（本仓库为此专门收窄过 `Label.set`）。
 *
 * ==================================================================
 * ⚠️ 键盘与触屏**功能对等**（AGENTS.md §3b）
 * ==================================================================
 *
 * | 动作 | 键盘 | 触屏 / 鼠标 |
 * |---|---|---|
 * | 移光标 | ← → ↑ ↓ / Tab | 点卡片 |
 * | 确定人物 / Boss | Enter | 点卡片（一步到位） |
 * | 炁机 +1 层 | Enter | 点卡片**右半边** |
 * | 炁机 −1 层 | Shift+Enter | 点卡片**左半边** |
 * | 看详情 | 移动焦点 | **点一下**（触屏没有 hover） |
 * | 开战 | Enter（光标在「开始」上） | 点「开始战斗」 |
 *
 * ⚠️ **触屏看详情的路必须有**：触屏没有 hover，而"选人之后"要先看得到
 * 那条炁机是什么 —— 点一下卡片就够了（它同时会把光标移过去，于是详情
 * 跟着换）。这条不是"退而求其次"：桌面上的 hover **也**落在同一段代码上
 * （`hover()`），所以两种输入不会漂。
 */

import type { Container, Graphics } from 'pixi.js';
import { LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { isDeveloping, type RosterEntry } from '../data/roster';
import type { TranslateFn } from '../i18n/translator';
import { PREPARE_LAYOUT, prepareHitAreas, prepareLabelY, type PrepareHitArea } from './prepareLayout';
import {
  canStartBattle,
  confirmCursor,
  cursorTarget,
  cycleCursor,
  cycleQijiStack,
  focusTarget,
  halfOfCard,
  hitTestPrepare,
  initialSelection,
  moveFocus,
  pickOption,
  pickQiji,
  stackCapOf,
  stacksIn,
  unstackQiji,
  type FreeQiji,
  type PrepareTarget,
} from './prepareLogic';
import { PrepareCards } from './prepareCards';
import { cardAppearance } from './prepareCardState';
import { PrepareFooter } from './prepareFooter';
import { detailModelOf, type DetailContext } from './prepareDetail';
import { PrepareDetailController } from './prepareDetailController';

/* ------------------------------------------------------------------ *
 * 选项
 * ------------------------------------------------------------------ */

/**
 * 炁机在这一屏需要的最小形状。
 *
 * ⚠️ 与 `core/types/qiji.ts` 的 `QijiEntity` **刻意不同**（结构性类型）：
 * 这一屏只用得到"叫什么 / 能叠几层 / 怎么开"，而 `QijiEntity` 带着
 * `abilities` / `unlock` / `comboWindow` 那些战斗期的知识。收窄之后
 * 单测可以喂 3 个字面量。
 */
export interface PrepareQijiOption {
  readonly id: string;
  readonly nameKey: string;
  /**
   * 一局/一次配置里最多生效几层（`QijiEntity.maxStacks`，缺省 1）。
   *
   * ⚠️ 自由模式**沿用**它（不另开一套无限叠加的规则）：判据只有内容表
   * 那一处，见 `prepareLogic` 文件头的长说明。
   */
  readonly maxStacks?: number;
}

export interface PrepareScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  readonly players: readonly RosterEntry[];
  readonly bosses: readonly RosterEntry[];
  /** 可选炁机（**从内容表读**，不写死条数）。 */
  readonly qiji: readonly PrepareQijiOption[];
  /**
   * 详情区的数据装配（`app/prepareDetailContext.prepareDetailContext`）。
   *
   * ⚠️ **注入**而不是在这里 import 内容表：本文件是"装配"，而"Boss 的
   * 招式叫什么、说明里的秒数是多少"是内容层的知识。注入之后这一屏在
   * 测试里可以喂假上下文（与 `prepareLogic.canStartBattle` 注入
   * `developing` 同一条纪律）。
   */
  readonly detailContext: (free: {
    readonly stacks: (id: string) => number;
    readonly cap: (id: string) => number;
  }) => DetailContext;
  readonly initial: { readonly playerId: string; readonly bossId: string };
  /** 上次存下来的炁机激活状态（未开的条目不出现）。 */
  readonly freeQiji?: FreeQiji | undefined;
  /** 是否显示键位提示（触屏为假）。见 `HomeScreenOptions.showKeyHints`。 */
  readonly showKeyHints: () => boolean;
  /** 点右上角的齿轮（打开设置）。见 `HomeScreenOptions.onGear`。 */
  readonly onGear: () => void;
  /** 点左上角的返回箭头（回首页）—— 触屏对等靠它（AGENTS.md §3b）。 */
  readonly onBack?: (() => void) | undefined;
  /** `F1` 的显示名（齿轮的键位提示）。 */
  readonly f1Label: () => string;
  /** 点了「开始」。 */
  readonly onStart: (playerId: string, bossId: string) => void;
  /** 选择变了（用于持久化）。 */
  readonly onChange?: (playerId: string, bossId: string) => void;
  /**
   * 炁机的层数变了（用于持久化）。
   *
   * ⚠️ 它**只报层数表**，不报"哪一条变了"：调用方（`app/`）要的是
   * "存什么"，而"哪一条"是界面的事 —— 多传一个 id 只会让两边都要维护
   * 一个用不上的字段。
   */
  readonly onQijiChange?: (free: FreeQiji) => void;
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export class PrepareScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly title: Label;
  private readonly playerLabel: Label;
  private readonly bossLabel: Label;
  private readonly qijiLabel: Label;
  /**
   * 底部那一条：开始按钮 + 操作提示 + 素材声明。
   * ⚠️ 整块在 `prepareFooter`（本类只喂"光标在不在按钮上 / 能不能开战"）。
   */
  private readonly footer: PrepareFooter;
  /** 详情区（右侧）：悬停 + 光标的合流在这一层（见 `prepareDetailController`）。 */
  private readonly detailPanel: PrepareDetailController;
  /** 详情区的数据上下文（探针读 `detailModel()` 要用，见那个方法）。 */
  private readonly detailContext: DetailContext;

  private readonly cardGfx: Graphics;
  private readonly players: readonly RosterEntry[];
  private readonly bosses: readonly RosterEntry[];
  private readonly qiji: readonly PrepareQijiOption[];
  private readonly options: PrepareScreenOptions;

  /**
   * 卡片那支画笔（人物在前、炁机在中、Boss 在后，与 `prepareHitAreas` 同序）。
   * ⚠️ "怎么画一张卡"整块在 `prepareCards`，本类只负责喂状态。
   */
  private readonly cards: PrepareCards;

  private selection: ReturnType<typeof initialSelection>;
  private free: FreeQiji;

  /**
   * 本屏自己的边角控件（右上角齿轮 + 左上角返回箭头）。
   *
   * ⚠️ 用户 2026-10-12："多个页面的齿轮，应该分别定义"、"stage 上理论上
   * 不挂任何小组件" —— 两个按钮都在本屏的 root 里。
   */
  readonly chrome: ScreenChrome;

  constructor(options: PrepareScreenOptions) {
    this.options = options;
    this.players = options.players;
    this.bosses = options.bosses;
    this.qiji = options.qiji;
    this.free = options.freeQiji ?? {};
    this.selection = initialSelection(options.initial, this.qiji);

    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    /** 整屏底色（备战界面要盖住战斗场景）。 */
    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.root.addChild(this.bg);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: 54, // 标题基线（见 `prepareLayout` 的布局表）
      size: 32,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });

    /**
     * 栏目标题（「选择人物」/「炁机」/「选择对手」）。
     * ⚠️ 字号与位置**都来自布局表**，不再是这里的字面量。
     */
    /**
     * ⚠️ 行顶是**算出来的**（随张数变），所以标题的 y 也得跟着算 ——
     * 传当前三块的张数进去（见 `prepareLayout.rowTopsOf`）。
     */
    const labelY = prepareLabelY({
      players: this.players.length,
      bosses: this.bosses.length,
      qiji: this.qiji.length,
    });
    const label = (y: number): Label =>
      new Label(pixi, {
        x: PREPARE_LAYOUT.pad,
        y,
        size: PREPARE_LAYOUT.labelSize,
        color: PALETTE.textDim,
      });
    this.playerLabel = label(labelY.player);
    this.qijiLabel = label(labelY.qiji);
    this.bossLabel = label(labelY.boss);

    this.cardGfx = new pixi.Graphics();
    this.root.addChild(
      this.cardGfx,
      this.playerLabel.root,
      this.qijiLabel.root,
      this.bossLabel.root,
      this.title.root,
    );

    /**
     * 卡片上的文字与头像（人物在前、炁机在中、Boss 在后）。
     *
     * ⚠️ 卡片上**只有名字**（+ 人物卡的名字右边一颗说话头像）——
     * 用户："卡片可以尽量缩小一点，留一个名字"。开发中的状态由**灰色的
     * 卡片皮肤**表达（见 `prepareRender.cardSkin`），不再占一行字。
     */
    /**
     * ⚠️ 卡片的 id 顺序必须与 `prepareHitAreas` **完全一致**
     * （人物 → 炁机 → Boss）：两处顺序一漂，卡片上的名字就会画到别人的
     * 命中区上 —— 而那看起来像"点谁都不对"。
     */
    this.cards = new PrepareCards(
      pixi,
      this.cardGfx,
      this.root,
      [...this.players, ...this.qiji, ...this.bosses].map((e) => e.id),
    );

    this.footer = new PrepareFooter({ pixi, parent: this.root, translate: options.translate });

    /**
     * ⚠️ 上下文**只建一次**：它的每个取值函数都接在静态内容表上，而
     * "此刻几层"由 `qijiStacks` 现取（两个闭包读的是 `this.free`，
     * 所以层数一变它自己就是新的）。
     */
    this.detailContext = options.detailContext({
      stacks: (id) => stacksIn(this.free, id),
      cap: (id) => stackCapOf(this.qijiById(id)?.maxStacks),
    });
    this.detailPanel = new PrepareDetailController({
      pixi,
      translate: options.translate,
      parent: this.root,
      context: this.detailContext,
    });

    /** 齿轮 + 返回箭头（最后加 = 最上层）。 */
    this.chrome = new ScreenChrome({
      pixi,
      showKeyHints: options.showKeyHints,
      f1Label: options.f1Label,
      onGear: options.onGear,
      onBack: options.onBack,
    });
    this.root.addChild(this.chrome.root);

    this.draw();
  }

  /* ---------------------------------------------------------------- *
   * 只读查询
   * ---------------------------------------------------------------- */

  get visible(): boolean {
    return this.root.visible;
  }

  /** 当前选择（`main.ts` 用它起战斗、也用它持久化）。 */
  get current(): ReturnType<typeof initialSelection> {
    return this.selection;
  }

  /** 当前开着的炁机（层数表）—— 调试探针与存档读它。 */
  get freeQiji(): FreeQiji {
    return this.free;
  }

  /**
   * 光标此刻指着的那一项（**受键盘控制**，不受 hover 影响）。
   *
   * ⚠️ 与详情区显示的那个（`focusedTarget(cursor, hover)`）**不是同一个
   * 东西**：hover 只影响详情。两个都导出来是为了让调试探针能分别对账。
   */
  cursor(): PrepareTarget | undefined {
    return cursorTarget(this.selection, this.players, this.bosses, this.qiji);
  }

  /** 详情区此刻显示的是哪一项（hover 优先，见 `prepareDetail`）。 */
  detailed(): PrepareTarget | undefined {
    return this.detailPanel.target(this.cursor());
  }

  /** 当前**悬停**的那一项（`undefined` = 鼠标不在任何卡片上）。 */
  hovered(): PrepareTarget | undefined {
    return this.detailPanel.hovered;
  }

  /**
   * 详情区**此刻拿到的画面模型**（只读探针）。
   *
   * ⚠️ 与 `detail()` 的区别：那个只说"是哪一项"，这个说"面板手里到底是
   * 什么数据"（标题 key、有没有副标题、几行、每行是什么）。截图与
   * `detail()` 都证明不了"面板收到的是不是它该收到的"——
   * 实测就是靠它查出"副标题根本没被画出来"的。
   */
  detailModel(): ReturnType<typeof detailModelOf> {
    return detailModelOf(this.detailed(), this.detailContext);
  }

  /**
   * **详情区此刻显示的是哪一项**（给调试探针用）。
   *
   * ⚠️ 它与 `cursor()` / `hovered()` 是**三个不同的读数**：截图能看出
   * "面板上有字"，但"是**谁的**字"只有这个返回值能钉死。合成一个读数就
   * 无法区分"hover 生效了"与"只是光标停在那儿"。
   */
  detail(): PrepareTarget | undefined {
    return this.detailed();
  }

  /** 当前布局的可点区域（探针 / 单测读它与渲染对账）。 */
  hitAreas(): readonly PrepareHitArea[] {
    return prepareHitAreas(this.players, this.bosses, this.qiji);
  }

  /* ---------------------------------------------------------------- *
   * 键盘
   * ---------------------------------------------------------------- */

  /**
   * 键盘：在同槽位里**移动光标**（`delta` = ±1），到边界**不环绕**。
   * ⚠️ **不改选择**。要它变成选择得按 Enter（`commit`）。
   */
  cycle(delta: number): void {
    this.selection = cycleCursor(this.selection, this.players, this.bosses, delta, this.qiji);
    this.draw();
  }

  /**
   * 键盘：上下换槽位（人物 ↔ 炁机 ↔ 对手 ↔ 开始）。
   *
   * `wrap` 给 Tab / Shift+Tab 用（环绕），方向键不环绕。
   */
  moveFocus(delta: number, wrap = false): void {
    this.selection = moveFocus(this.selection, delta, {
      wrap,
      players: this.players,
      bosses: this.bosses,
      qiji: this.qiji,
    });
    this.draw();
  }

  /**
   * Enter：确定光标处的那一项；若光标停在「开始战斗」上就开战。
   *
   * ⚠️ 光标在**炁机**上时它做的是"叠一层"（见 `cycleQijiStack`），
   * 而不是"确定选择" —— 炁机是可反复开关的集合，没有"选定的那一个"。
   *
   * @param back `Shift+Enter`：炁机**退一层**（触屏对等见 `hitTest`）。
   */
  confirm(back = false): void {
    const at = this.cursor();
    if (at !== undefined && at.kind === 'qiji') {
      this.applyQiji(at.id, back);
      return;
    }
    const next = confirmCursor(this.selection, this.players, this.bosses, this.qiji);
    if (next !== this.selection) {
      this.applySelection(next);
      return;
    }
    /**
     * 光标在「开始战斗」上（或已经确定过同一项）→ 开战。
     * ⚠️ 不能只看 `focus === 'start'`：光标在卡片上、而那一项恰好就是
     * 已确定的选择时，`confirmCursor` 也返回同一个对象 —— 那时按 Enter
     * 应当是"没反应"，而不是"开战"。
     */
    if (this.selection.focus === 'start' && at === undefined) this.start();
  }

  /**
   * 只把**焦点**移到某个槽位（调试入口一步到位）。
   *
   * ⚠️ 与 `moveFocus` 的区别是"直接指定"而不是"相对移动"。
   */
  focusSlot(slot: 'player' | 'qiji' | 'boss' | 'start'): void {
    this.selection = focusTarget(this.selection, slot, {
      players: this.players,
      bosses: this.bosses,
      qiji: this.qiji,
    });
    this.draw();
  }

  /**
   * 选中某个人物 / 对手（点卡片 = 移光标 + 确定；调试入口也走它）。
   */
  pick(kind: 'player' | 'boss', id: string): void {
    const next = pickOption(this.selection, this.players, this.bosses, kind, id);
    if (next !== this.selection) this.applySelection(next);
  }

  /**
   * **清空炁机激活**（调试入口：让截图 / 探针可复现）。
   *
   * ⚠️ 它与"玩家点掉每一条"是同一件事的捷径，而不是旁路：产物仍然是
   * 一张层数表，并且**照样写存储**（`onQijiChange`）—— 所以"清空之后
   * 刷新还在 0 层"这件事也能一起验。
   */
  resetQiji(): void {
    if (Object.keys(this.free).length === 0) return;
    this.free = {};
    this.options.onQijiChange?.(this.free);
    this.draw();
  }

  /* ---------------------------------------------------------------- *
   * 指针
   * ---------------------------------------------------------------- */

  /**
   * **悬停**（鼠标）。只影响详情区，**不动光标**（见 `prepareDetail`）。
   *
   * @returns 悬停落在某一项上（供调用方判"要不要重画"）。
   */
  hover(px: number, py: number): boolean {
    const at = hitTestPrepare(px, py, this.players, this.bosses, this.qiji);
    /** ⚠️「开始战斗」不是"一项"，悬停它不该把详情区切走。 */
    const next = at === undefined || at.kind === 'start' ? undefined : { kind: at.kind, id: at.id };
    if (this.detailPanel.hoverAt(next)) this.draw();
    return at !== undefined;
  }

  /** 指针离开画布：清掉悬停（否则详情区会一直停在最后划过的那一项）。 */
  clearHover(): void {
    if (this.detailPanel.clearHover()) this.draw();
  }

  /**
   * **滚轮**滚详情区（桌面）。
   *
   * ⚠️ 与设置页的技能详情同一条分工：入口在 `canvasInput`（输入归属只有
   * 一处），本屏只回答"滚不滚得动"。
   *
   * @returns 有没有消费这次滚轮（没消费就让页面自己滚）。
   */
  /** 这个点是不是落在详情区的**可滚视口**里（输入层的拖拽判据）。 */
  isOnDetail(px: number, py: number): boolean {
    return this.detailPanel.isOnDetail(px, py);
  }

  wheelDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.detailPanel.isOnDetail(px, py)) return false;
    /**
     * ⚠️ 像素 → 逻辑像素：`deltaMode === 1` 时 `deltaY` 的单位是**行**
     * （Firefox 常见），直接当像素用会滚得几乎看不出来。
     */
    const step = deltaY * 3;
    return this.detailPanel.scrollBy(step);
  }

  /**
   * **拖拽**滚详情区（触屏：没有滚轮，AGENTS.md §3b 要求这条路必须存在）。
   *
   * @param deltaY 这一帧相对上一帧的位移（像素，向上为负）。
   */
  dragDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.detailPanel.isOnDetail(px, py)) return false;
    return this.detailPanel.scrollBy(-deltaY);
  }

  /**
   * 点一下（逻辑坐标）。
   *
   * @returns 是否消费了这次点击
   */
  hitTest(px: number, py: number): boolean {
    /** ⚠️ 齿轮 / 返回箭头先于卡片（顺序即优先级）。 */
    if (this.chrome.hitTest(px, py)) return true;
    const at = hitTestPrepare(px, py, this.players, this.bosses, this.qiji);
    if (at === undefined) return false;
    if (at.kind === 'start') {
      this.start();
      return true;
    }
    if (at.kind === 'qiji') {
      /**
       * ⚠️ **左右半边 = 加一层 / 退一层**（`halfOfCard`）：触屏没有 Shift，
       * 而"取消"这条路必须存在（AGENTS.md §3b 的功能对等）。
       */
      const card = this.hitAreas().find((a) => a.kind === 'qiji' && a.id === at.id);
      const back = card !== undefined && halfOfCard(px, card) === 'left';
      this.applyQiji(at.id, back);
      return true;
    }
    const next = pickOption(this.selection, this.players, this.bosses, at.kind, at.id);
    if (next !== this.selection) this.applySelection(next);
    /**
     * ⚠️ **点一下也要更新详情**（触屏没有 hover，这是它唯一的路）：
     * `pickOption` 已经把光标移到那一项上，所以详情自然跟着换 ——
     * 这里只需要在"点的是同一张卡"（`next === this.selection`）时
     * 也刷一次详情。
     */
    else this.draw();
    return true;
  }

  /* ---------------------------------------------------------------- *
   * 每帧
   * ---------------------------------------------------------------- */

  /** 每帧：只在"可见"时保证画面与选择一致（选择是离散的，很便宜）。 */
  frame(): void {
    if (this.root.visible) {
      this.draw();
      this.chrome.update();
    }
  }

  /**
   * **UI 缩放**：本屏只转发给**它自己的**边角控件。
   *
   * ⚠️ 卡片 / 标题 / 详情区**不随缩放**（现状如此）：它们的位置由
   * `PREPARE_LAYOUT` 定死，重排它是一次独立的重构。
   */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  /* ---------------------------------------------------------------- *
   * 内部：状态变更
   * ---------------------------------------------------------------- */

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    /**
     * ⚠️ 切回来时要**重画一次**：`Label.set` 只在文本变化时写 Pixi，
     * 而"隐藏期间选择被改了"不会自动反映出来。
     */
    if (visible) this.draw();
  }

  private qijiById(id: string): PrepareQijiOption | undefined {
    return this.qiji.find((q) => q.id === id);
  }

  /** 写入**已经确定**的选择（Enter / 点击）。 */
  private applySelection(next: ReturnType<typeof initialSelection>): void {
    const changed =
      next.playerId !== this.selection.playerId || next.bossId !== this.selection.bossId;
    this.selection = next;
    this.draw();
    if (changed) this.options.onChange?.(next.playerId, next.bossId);
  }

  /**
   * 炁机加 / 退一层，并把光标移到它上面。
   *
   * ⚠️ 光标一定要移过去：不加这一句，触屏点一张卡之后**光标还停在别处**，
   * 于是"点一下看详情"这条触屏唯一的路就没有了。
   */
  private applyQiji(id: string, back: boolean): void {
    const def = this.qijiById(id);
    if (def === undefined) return;
    this.selection = pickQiji(this.selection, this.qiji, id);
    const next = back
      ? unstackQiji(this.free, id)
      : cycleQijiStack(this.free, id, def.maxStacks);
    if (next.free !== this.free) {
      this.free = next.free;
      this.options.onQijiChange?.(this.free);
    }
    this.draw();
  }

  /* ---------------------------------------------------------------- *
   * 内部：画
   * ---------------------------------------------------------------- */

  private draw(): void {
    const t = this.options.translate;
    const developing = !canStartBattle(this.selection, isDeveloping);
    this.title.set(t('roster.ui.title'));
    this.playerLabel.set(t('roster.ui.playerLabel'));
    this.qijiLabel.set(t('roster.ui.qijiLabel'));
    this.bossLabel.set(t('roster.ui.bossLabel'));

    const all = [...this.players, ...this.qiji, ...this.bosses];
    const areas = this.hitAreas();
    const at = this.cursor();

    this.cardGfx.clear();
    /**
     * ⚠️ 卡片与命中区**按顺序对齐**（人物 → 炁机 → 对手），而命中区末尾
     * 还有一块 `start`（它不是卡）。所以这里按 `kind` 收窄 ——
     * `PrepareHitArea.kind` 的类型里有 `'start'`，靠"它一定在最后"这种
     * 位置约定去骗类型是本仓库明令禁止的形状（见 AGENTS.md §1）。
     */
    const cardAreas = areas.filter((a) => a.kind !== 'start');
    this.cards.drawAll(
      cardAreas,
      all.map((entry, i) => {
        const area = cardAreas[i];
        const kind = area?.kind ?? 'player';
        const appearance = cardAppearance({
          kind: kind === 'start' ? 'player' : kind,
          cursored: at !== undefined && at.kind === kind && at.id === entry.id,
          selected:
            (kind === 'player' && entry.id === this.selection.playerId) ||
            (kind === 'boss' && entry.id === this.selection.bossId),
          developing: isDeveloping(entry.id),
          stacks: kind === 'qiji' ? stacksIn(this.free, entry.id) : 0,
        });
        return { ...appearance, name: t(entry.nameKey) };
      }),
    );

    /** 底部那一条（按钮皮肤 + 提示行 + 声明）。 */
    this.footer.draw(this.selection.focus === 'start', developing);
    this.drawDetail();
  }

  private drawDetail(): void {
    this.detailPanel.update(this.cursor());
  }

  /**
   * Enter / 点「开始」。
   *
   * ⚠️ **开发中的单位不能开战**（需求）。反馈由界面上那行常驻提示给出。
   */
  private start(): void {
    if (!canStartBattle(this.selection, isDeveloping)) return;
    this.options.onStart(this.selection.playerId, this.selection.bossId);
  }
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 供 `app/` 造上下文用
 * ------------------------------------------------------------------ */

export type { DetailContext };
