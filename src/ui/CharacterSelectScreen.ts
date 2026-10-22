/**
 * **选角色屏**：从 3 个角色里选 1 个，开始一局肉鸽。
 *
 * ==================================================================
 * 需求（用户 2026-10-12 定的流程）
 * ==================================================================
 *
 * 用户原话："有一个**新的首页**……然后进入肉鸽 才是**选角色**" +
 * "从**现有的 3 个角色**里选（林晚风 / 凯丽 / 黛玄）" +
 * "⚠️ 现在只有**林晚风**能玩，另两个在 `DEVELOPING` 里 →
 * 复用备战界面既有那套「**开发中 → 灰掉**」的做法"。
 *
 * ⚠️ **它不是默认入口**（首页才是）：肉鸽那条路还不完整
 * （炁机选择是 P3、强度曲线是 P4/P5、7 个 Boss 只有 2 个能打）。
 *
 * ==================================================================
 * 交互：**与备战界面共用同一套光标模型**（`prepareLogic`）
 * ==================================================================
 *
 *   - ← →：在卡片间**移动光标**（不改选择，到两端停住）
 *   - Enter：**确定光标处的角色并开始一局**（设计稿 §3.1/§3.5：
 *     CharacterSelect --Enter--> Battle）
 *   - 触屏 / 鼠标：**点卡片 = 移光标 + 确定 + 开始**（一步到位）
 *
 * ⚠️ 键盘一次 Enter、触屏一次点击 —— **数量相同**，满足 AGENTS.md §3b
 * 的"功能对等"。这也是为什么这里**没有**独立的「开始」按钮：
 * 多一个按钮就要多一步，而"点卡片开始"与"Enter 开始"仍然是对等的。
 *
 * ⚠️ **选中"开发中"的角色不会开始**（需求："不能开始战斗（选中它们时
 * 点开始应当无效，或给明确反馈）"）。反馈由底部那行文案给出 ——
 * 它与卡片上的"开发中"**共用同一个 i18n key**（不一致的两句话会让人
 * 以为它们在说两件事，备战界面记着这条）。
 *
 * ==================================================================
 * ⚠️ 2026-10-15：右侧那块**详情区**（用户："显示当前 hover 角色的详情"）
 * ==================================================================
 *
 * 与备战屏**同一块面板、同一个驱动**：`PrepareDetailController` 把
 * "鼠标划过的那一项"与"光标所在的那一项"合成一个 `PrepareTarget`
 * （`focusedTarget`：**hover 优先**），再交给 `PrepareDetailPanel` 画。
 *
 * ```
 *   鼠标  → pointermove 问一次命中（`characterHoverTarget`）→ 详情跟着切
 *   键盘  → ← → 移动光标 → 详情跟着走（没有 hover 时的**同一条**代码）
 *   触屏  → 没有 hover → 自动退化成"跟着光标 / 选择走"
 * ```
 *
 * ⚠️ **矩形就是备战屏那一块**（`prepareGeometry.detailRect`，x624 宽296
 * 通高）：卡片只铺到 x≈616，右边正好是空的 —— "共用右侧详情"是用户
 * 2026-10-15 的原话（"老规矩"）。所以这里**不新写**任何几何。
 *
 * ⚠️ 底部那行提示**必须落在详情区下缘之下**（居中的提示会压在面板左边
 * 那条边上）—— 它的 y 因此由 `detailRect()` 反推，不是手调的。
 *
 * ==================================================================
 * ⚠️ 临时桩（P2 只跑**一场**）
 * ==================================================================
 *
 * 本屏"开始"之后只打**一场战斗**，结算完回到本屏（而不是推进一局肉鸽）。
 * 这是**刻意的桩**：炁机选择是 P3，所以 P3 才会把它接成
 * "N 场 + 炁机选择"。**不要**为了"看起来完整"而在这里假装有炁机选择。
 * 具体的一次性行为在 `app/runSession.ts`（那里也标了同一个桩）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { isDeveloping, type RosterEntry } from '../data/roster';
import { CARD_RADIUS, PREPARE_SKIN, cardSkin } from './prepareRender';
import { detailRect } from './prepareGeometry';
import {
  easeOutCubic,
  initialExpand,
  lerpRect,
  retarget,
  stepExpand,
  type ExpandState,
} from './expandTween';
import { PrepareDetailController } from './prepareDetailController';
import {
  canStartRun,
  characterCursorTarget,
  characterHoverTarget,
  characterSelectCardRects,
  characterSelectHitAreas,
  expandedCardRect,
  type CharacterCardRect,
  characterSelection,
  confirmCharacter,
  cycleCharacter,
  pickCharacter,
  tapCharacterIntent,
} from './characterSelectLogic';
import type { DetailContext } from './prepareDetail';
import type { PrepareSelection, PrepareTarget } from './prepareLogic';
import type { TranslateFn } from '../i18n/translator';

export interface CharacterSelectScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /** 候选角色（顺序 = 卡片顺序）。 */
  readonly players: readonly RosterEntry[];
  /** 初始已确定的角色（上次出战的那个）。 */
  readonly initialPlayerId: string;
  /**
   * **右侧详情区的数据装配**（`app/prepareDetailContext.prepareDetailContext`）。
   *
   * ⚠️ 与备战屏**同一个工厂**：人物详情的取值函数（名字 / 生命上限 /
   * 技能表）都由它接上内容表 —— 这一屏不该有自己的第二份装配。
   */
  readonly detailContext: (free: { readonly on: (id: string) => boolean }) => DetailContext;
  /** 是否显示键位提示（触屏为假）。见 `HomeScreenOptions.showKeyHints`。 */
  readonly showKeyHints: () => boolean;
  /** 点右上角的齿轮（打开设置）。见 `HomeScreenOptions.onGear`。 */
  readonly onGear: () => void;
  /** 点左上角的返回箭头（回首页）—— 触屏对等靠它（AGENTS.md §3b）。 */
  readonly onBack?: (() => void) | undefined;
  /** `F1` 的显示名（齿轮的键位提示）。 */
  readonly f1Label: () => string;
  /** 用这个角色开始一局肉鸽。 */
  readonly onStart: (playerId: string) => void;
}

/**
 * 选角色屏要拼上去的**键名**（键名不进 i18n，见 AGENTS.md §3b 与
 * `HomeScreen` 里同名常量的说明）。
 */
const SELECT_KEY_HINT = '← → · Enter';

export class CharacterSelectScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly title: Label;
  private readonly hint: Label;
  private readonly cardGfx: Graphics;
  private readonly cards: { readonly name: Label; readonly status: Label }[] = [];
  /**
   * **本屏自己的边角控件**：右上角的齿轮 + 左上角的返回箭头。
   *
   * ⚠️ 用户 2026-10-12："多个页面的齿轮，应该分别定义"、"stage 上理论上
   * 不挂任何小组件" —— 所以两个按钮都在本屏的 root 里，显隐与缩放都跟着
   * 本屏走（不再是挂在 stage 上、靠 `setScreen` 挪位置的那一个）。
   */
  readonly chrome: ScreenChrome;
  /**
   * 右侧那块详情区（**与备战屏同一个驱动器**：hover 优先 + 光标兜底）。
   *
   * ⚠️ 这一屏的详情只可能显示人物，所以"某条炁机开着没有"（`qijiOn`）
   * 传 `() => false` —— 那个人物详情里没有一处读它（读它的是炁机详情）。
   */
  private readonly detailPanel: PrepareDetailController;
  /**
   * **展开动画**（2026-10-21，用户："选中的展开（动画）成详情的样子，移开会
   * 收起…快速展开和收起，动画会被中断并朝反状态运行"）。
   *
   * 画的是一个"正在变成详情面板"的卡片：从被选中的那张卡片的矩形，
   * 插值到右侧详情面板的矩形（`detailRect()`），边变边淡出。
   * 打断语义全在 `expandTween`（值不动、只换目标 ⇒ 从当前进度往回跑）。
   */
  /**
   * **每张卡各自一份进度**（2026-10-22）：换人时 A 的 target 变 0、B 的变 1，
   * **两张同时跑**（上一版只有一份状态 ⇒ "旧卡瞬间收、新卡瞬间开" ✗）。
   */
  private expandStates: ExpandState[] = [];
  /**
   * **指针停在空白处**（或离开画布）—— 2026-10-22 用户："hover 哪个哪个就
   * 展开，**移开就收起**"。
   *
   * 判据只在两个地方改：`hover()` 命中/落空、以及**键盘移光标**（`cycle`）。
   * 指针落空 ⇒ 全部收起；键盘一动 ⇒ 重新跟着光标展开（键盘用户也要看得到
   * 详情 —— 那正是"hover 优先、其次光标"那条老规矩）。
   */
  private hoverAway = false;
  /**
   * **指针停在谁身上**（`undefined` = 没停在任何卡上）。
   *
   * ⚠️ 屏幕必须自己记这一份：`PrepareDetailController` 的 hover 是它**内部**
   * 的状态（`characterCursorTarget` 只读光标），而"哪张卡在展开"要跟着
   * **hover** 走 —— 拿光标当判据就成了"永远展开光标那张"✗（实测过）。
   */
  private hoveredId: string | undefined;
  /** 正在展开的是第几张卡（`undefined` = 没有在展开）。 */
  private expandCard: number | undefined;
  private readonly expandGfx: Graphics;
  private readonly expandTitle: Label;
  /** 上一帧的时间戳（动画的 `dt`；0 = 还没有上一帧）。 */
  private lastFrameMs = 0;
  private readonly players: readonly RosterEntry[];
  private readonly options: CharacterSelectScreenOptions;

  private selection: PrepareSelection;

  constructor(options: CharacterSelectScreenOptions) {
    this.options = options;
    this.players = options.players;
    this.selection = characterSelection(options.initialPlayerId);

    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    /** 整屏底色（与备战界面一致：这个界面要盖住战斗场景）。 */
    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.root.addChild(this.bg);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: 54,
      size: 32,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.cardGfx = new pixi.Graphics();
    this.root.addChild(this.cardGfx, this.title.root);

    /**
     * 每张卡两行：名字 + **状态行**（开发中）。状态行**常驻存在**、
     * 只在需要时填字 —— 每帧新建 / 销毁 Label 会让 Pixi 反复重建纹理
     * （`PrepareScreen` 记着这条）。
     */
    for (let i = 0; i < this.players.length; i += 1) {
      const name = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.title,
        color: PALETTE.text,
        kai: true,
      });
      const status = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.small,
        color: PALETTE.textDim,
      });
      this.cards.push({ name, status });
      this.root.addChild(name.root, status.root);
    }

    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      /**
       * ⚠️ **必须落在右侧详情区的下缘之下**（提示是居中的，而面板从
       * x 624 起 —— 两者在纵向上重叠时，提示的尾巴会压到面板边上）。
       * 所以它的 y 由**面板矩形**反推，不是手调的 `height - 100`。
       */
      y: detailRect().y + detailRect().h + 24,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.hint.root);

    /**
     * **右侧详情区**（2026-10-15）：与备战屏同一块面板、同一个驱动器，
     * 矩形用备战屏那一块（`PrepareDetailPanel` 的缺省）。
     *
     * ⚠️ 挂在本屏 root 里（不放 stage）：显隐跟着这一屏走 —— 那是
     * `phaseVisibility` 那条不变量的一部分（边角控件 / 面板都住在屏里）。
     */
    this.detailPanel = new PrepareDetailController({
      pixi,
      translate: options.translate,
      context: options.detailContext({ on: () => false }),
      parent: this.root,
    });

    /**
     * **展开中的那张卡**：加在详情面板**之后**（= 画在它上面）—— 视觉上是
     * "卡片**变成**了面板"，所以它得盖住面板，再淡出。
     */
    this.expandGfx = new pixi.Graphics();
    this.expandTitle = new Label(pixi, {
      x: 0,
      y: 0,
      size: FONT.title,
      color: PALETTE.text,
      kai: true,
    });
    this.root.addChild(this.expandGfx, this.expandTitle.root);

    /** 齿轮 + 返回箭头（最后加 = 最上层；见 `HomeScreen` 里同一条说明）。 */
    this.chrome = new ScreenChrome({
      pixi,
      showKeyHints: options.showKeyHints,
      f1Label: options.f1Label,
      onGear: options.onGear,
      onBack: options.onBack,
    });
    this.root.addChild(this.chrome.root);

    this.redraw();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (visible) this.redraw();
  }

  /** 展开动画的进度（调试 / 截图验收读它）。 */
  expand(): { readonly card: number | null; readonly progress: number } {
    return {
      card: this.expandCard === undefined ? null : this.expandCard,
      progress: Math.round(this.progressOf(this.expandCard ?? 0) * 1000) / 1000,
    };
  }

  /** 当前选择 + 光标（调试入口读它）。 */
  get current(): PrepareSelection {
    return this.selection;
  }

  /** ← →：**只移动光标**（不改已确定的角色）。 */
  cycle(delta: number): void {
    const next = cycleCharacter(this.selection, this.players, delta);
    if (next === this.selection) return;
    this.selection = next;
    /** 键盘一动 ⇒ 重新跟着光标展开（指针不在卡片上也算"看这一张"）。 */
    this.hoverAway = false;
    this.hoveredId = undefined;
    this.redraw();
  }

  /**
   * Enter：确定光标处的角色；能开始就开始一局。
   *
   * ⚠️ 光标**已经**在已确定的角色上时，`confirmCharacter` 返回同一个对象
   * （它有意的"没变化就别重画"），这里仍然要 `begin()` —— 否则
   * "选中的是林晚风、光标也在林晚风上，按 Enter 没反应"。
   */
  confirm(): void {
    const next = confirmCharacter(this.selection, this.players);
    if (next !== this.selection) {
      this.selection = next;
      this.redraw();
    }
    this.begin();
  }

  /** 点卡片：移光标 + 确定 + 开始（一步到位；开发中的角色只会被选中）。 */
  pick(id: string): void {
    const next = pickCharacter(this.selection, this.players, id);
    if (next !== this.selection) {
      this.selection = next;
      this.redraw();
    }
    this.begin();
  }

  /**
   * **只选中**某个角色（移光标 + 确定，**不开局**）。
   *
   * ⚠️ 它是触屏 / 鼠标"先看详情"那一步的落点（见 `tapCharacterIntent`）：
   * 与键盘 ← → + Enter 中的"← →"完全等价。
   */
  select(id: string): void {
    const next = pickCharacter(this.selection, this.players, id);
    if (next === this.selection) return;
    this.selection = next;
    this.redraw();
  }

  /**
   * **悬停**（鼠标划过）：只影响右侧详情，**不动光标**（与备战屏同一条）。
   *
   * ⚠️ 触屏永远走不到这里（没有 `pointermove`）——那时详情自动退化成
   * "跟着光标 / 选择走"，同一段代码服务两种输入（`focusedTarget`）。
   *
   * @returns 悬停落在某张卡上（供调用方判"要不要重画"）
   */
  hover(px: number, py: number): boolean {
    const next = characterHoverTarget(this.players, px, py);
    /** ⚠️ 指针落空 ⇒ 收起全部（"移开就收起"）。 */
    this.hoverAway = next === undefined;
    this.hoveredId = next?.id;
    if (this.detailPanel.hoverAt(next)) this.redraw();
    return next !== undefined;
  }

  /** 指针离开画布：清掉悬停（否则详情会一直停在最后划过的那一项）。 */
  clearHover(): void {
    this.hoverAway = true;
    this.hoveredId = undefined;
    if (this.detailPanel.clearHover()) this.redraw();
  }

  /**
   * 当前**可点区域**（只读；调试 / 截图脚本按它换算坐标）。
   *
   * ⚠️ 与备战屏 `hitAreas()` 同一条纪律：脚本**不许自己复制一份布局数字**
   * —— 布局一调，抄的那份会静默指到别处（"点空了"与"功能坏了"长得一样）。
   */
  hitAreas(): ReturnType<typeof characterSelectHitAreas> {
    return characterSelectHitAreas(this.players);
  }

  /** 详情区此刻显示的是哪一项（hover 优先，见 `prepareDetail`）。 */
  detail(): PrepareTarget | undefined {
    return this.detailPanel.target(characterCursorTarget(this.selection, this.players));
  }

  /** 悬停那一项（调试探针用；`undefined` = 鼠标不在任何卡上）。 */
  hovered(): PrepareTarget | undefined {
    return this.detailPanel.hovered;
  }

  /* ---------------------------------------------------------------- *
   * 滚动（2026-10-22，用户："人物详情 有滚动条 但是滚动不了"）
   * ---------------------------------------------------------------- */

  /**
   * 这个点是不是落在**展开后的详情区**里（拖拽 / 滚轮的判据）。
   *
   * ⚠️ 判据用**详情面板自己的矩形**（`PrepareDetailController.isOnDetail`），
   * 不在这里再算一份 —— 面板的位置一改，这里自动跟上。
   * ⚠️ 收起状态下（`progress` 还没到位）**不吃滚动**：那时卡片还没长成详情，
   * 在卡片上滚轮不该动详情（会让人以为"卡片自己能滚"）。
   */
  isOnScrollable(px: number, py: number): boolean {
    if (this.progressOf(this.expandCard ?? -1) < 0.5) return false;
    const card = this.expandedSlot();
    if (card === undefined) return false;
    /** ⚠️ 判据用**长大的那张卡**的矩形（面板已被平移，它的命中仍用固定矩形）。 */
    const grown = expandedCardRect(card);
    return px >= grown.x && px <= grown.x + grown.w
      && py >= grown.y && py <= grown.y + grown.h;
  }

  /** 第 `index` 张卡此刻的进度（缺省 0 = 收着）。 */
  private progressOf(index: number): number {
    return this.expandStates[index]?.progress ?? 0;
  }

  /** 当前正在展开的那张卡的**槽位**（没有在展开 ⇒ `undefined`）。 */
  private expandedSlot(): CharacterCardRect | undefined {
    if (this.expandCard === undefined || this.expandCard < 0) return undefined;
    return characterSelectCardRects(this.players.length)[this.expandCard];
  }

  /**
   * **键盘滚动**：`Shift + ↑ / ↓`（`loopWiring` 已按同一约定接好）。
   * ⚠️ **只在展开到位时才滚**（收起时那张还是小卡，滚它没有意义）。
   */
  scrollDetail(dir: 'up' | 'down'): void {
    if (this.progressOf(this.expandCard ?? -1) < 0.5) return;
    this.detailPanel.scrollStep(dir);
  }

  /** **滚轮**：滚详情正文。@returns 有没有真的滚 */
  wheelDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.isOnScrollable(px, py)) return false;
    return this.detailPanel.scrollBy(deltaY * 3);
  }

  /** **拖拽**（触屏没有滚轮，这条路必须存在）。@param deltaY 向上为负 */
  dragDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.isOnScrollable(px, py)) return false;
    return this.detailPanel.scrollBy(-deltaY);
  }

  /**
   * 点一下（逻辑坐标）。@returns 是否消费了这次点击
   *
   * ⚠️ **先选中、再点同一张才开局**（`tapCharacterIntent`）：触屏没有
   * hover，不这么分就"点谁开谁、永远看不到别人的详情"（§3b）。默认选中的
   * 是上次出战的那个 —— 点它仍然是**一步**开局，与改之前一样。
   */
  hitTest(px: number, py: number): boolean {
    /** ⚠️ 齿轮 / 返回箭头先于卡片（顺序即优先级，见 `HomeScreen.hitTest`）。 */
    if (this.chrome.hitTest(px, py)) return true;
    const hit = characterHoverTarget(this.players, px, py);
    if (hit === undefined) return false;
    if (tapCharacterIntent(this.selection, hit.id) === 'start') this.pick(hit.id);
    else this.select(hit.id);
    return true;
  }

  /** 每帧：只在可见时保证画面与选择一致。 */
  frame(): void {
    if (this.root.visible) {
      /**
       * ⚠️ 用 `performance.now()` 的**差值**（不是每帧固定 16.67）：帧率抖动
       * 时动画的时长才不会跟着变。这是渲染层的时间，`core/` 那条"只走
       * `logicMs()`"的规则只管战斗逻辑。
       */
      const now = performance.now();
      const dt = this.lastFrameMs === 0 ? 0 : now - this.lastFrameMs;
      this.lastFrameMs = now;
      /** ⚠️ **每一张**都要推进（换人时 A 收、B 开是同时跑的）。 */
      this.expandStates = this.expandStates.map((state) => stepExpand(state, dt));
      this.redraw();
      this.chrome.update();
    }
  }

  /**
   * **UI 缩放**：本屏只转发给**它自己的**边角控件（与 `HomeScreen` 同一条）。
   *
   * ⚠️ 卡片与标题**不随缩放**（现状如此）：这一屏是满屏布局，卡片位置由
   * `CHARACTER_SELECT_LAYOUT` 定死；只有浮在界面之上的齿轮 / 返回箭头要
   * 跟别的界面保持一致的大小。
   */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  /**
   * 真正开始一局。
   *
   * ⚠️ **开发中的角色不开局**（需求）。反馈由 `redraw` 里那行常驻提示给出 ——
   * 玩家点之前就看得见，不是"点了没反应"。
   */
  private begin(): void {
    if (!canStartRun(this.selection, isDeveloping)) return;
    this.options.onStart(this.selection.playerId);
  }

  private redraw(): void {
    const t = this.options.translate;
    /** 已确定的角色是不是开发中 —— 决定底部提示写操作说明还是"开发中"。 */
    const developing = !canStartRun(this.selection, isDeveloping);

    this.title.set(t('screen.characterSelect.title'));
    /**
     * 提示 = 标签 + （键名）；**选中开发中的角色时换成"开发中"**
     * （需求："不能开始战斗……或给明确反馈"），与卡片上的状态行同一个 key。
     */
    const keys = this.options.showKeyHints() ? t('screen.keyHint', { keys: SELECT_KEY_HINT }) : '';
    this.hint.set(developing ? t('roster.ui.developing') : `${t('screen.characterSelect.hint')}${keys}`);
    this.hint.setColor(developing ? PREPARE_SKIN.selectionText : PALETTE.textDim);

    const areas = characterSelectHitAreas(this.players);

    this.cardGfx.clear();
    this.expandGfx.clear();
    this.cards.forEach((card, i) => {
      const area = areas[i];
      const entry = this.players[i];
      if (area === undefined || entry === undefined) return;
      /**
       * ⚠️ 三态与备战界面**完全同源**（这是"复用同一套"的落点）：
       * `selected` 只认已确定的角色，`cursored` 只认光标 —— 两者可以分离。
       * 皮肤来自 `prepareRender.cardSkin()`（纯函数、有单测）。
       */
      const selected = entry.id === this.selection.playerId;
      const soon = isDeveloping(entry.id);
      /** ⚠️ 不传 `cursored`：用户"不需要白色光标了"（焦点只由展开态表达）。 */
      const skin = cardSkin({ developing: soon, cursored: false, selected });
      /** ⚠️ 没被展开的那两张压暗到 30%（仍可见、仍 hover 得到）。 */
      const dimmed = this.expandCard !== undefined && i !== this.expandCard;
      const cardAlpha = dimmed ? Math.max(0.3, 1 - 0.7 * easeOutCubic(this.progressOf(this.expandCard ?? 0))) : 1;
      card.name.root.alpha = cardAlpha;
      card.status.root.alpha = cardAlpha;
      /** ⚠️ 被展开的那张不画自己的名字（详情里已有；否则会透出重影）。 */
      const selfLabel = !dimmed && this.progressOf(i) > 0.15;
      card.name.root.visible = !selfLabel;
      card.status.root.visible = !selfLabel;

      card.name.set(t(entry.nameKey));
      card.name.setColor(skin.nameColor);
      card.status.set(soon ? t('roster.ui.developing') : '');
      card.name.root.x = area.x + 18;
      card.status.root.x = area.x + 18;
      if (soon) {
        card.name.root.y = area.y + area.h / 2 - 22;
        card.status.root.y = area.y + area.h / 2 + 4;
      } else {
        card.name.root.y = area.y + area.h / 2 - 10;
        card.status.root.y = area.y + area.h / 2 + 16;
      }

      /**
       * ⚠️ **被展开的那张，描边画在 `expandGfx` 里**（它比详情面板**更上层**，
       * 而 `cardGfx` 在下层）：否则那两张压暗的卡会盖在长大卡的内容上
       * （实测"凯丽/黛玄"两块压在详情正文上 ✗）。底色仍留在 `cardGfx`
       * （内容要压在底色之上）。
       */
      /** ⚠️ 被展开的那张只画底色；描边由 `drawExpand` 画在长大后的矩形上。 */
      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .fill({ color: skin.fillColor, alpha: skin.fillAlpha * cardAlpha });
      if (dimmed) {
        this.cardGfx
          .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
          .stroke({ color: skin.strokeColor, width: skin.strokeWidth, alpha: cardAlpha });
      }
    });

    /**
     * 右侧详情：**hover 优先、其次光标**（`PrepareDetailController` 内部就是
     * `prepareDetail.focusedTarget`）—— 与备战屏**同一句**，所以"鼠标停在
     * A 上、面板显示 B"这种错位在结构上不可能发生。
     */
    /**
     * **展开动画**（2026-10-21）：光标（hover 优先，与面板同源）落在哪张卡上
     * 就朝哪张展开。`retarget` 只换方向、不动进度 ⇒ 快速来回时**从当前
     * 进度往反方向跑**（用户要的"中断并朝反状态运行"）。
     */
    /**
     * 展开哪张 = **hover 优先、其次光标**（用户："hover 哪个哪个就展开"）。
     * 指针停在空白处（`hoverAway`）⇒ 全部收起。
     */
    const cursorTarget = characterCursorTarget(this.selection, this.players);
    const focusId = this.hoveredId ?? (this.hoverAway ? undefined : cursorTarget?.id);
    const focus = focusId === undefined ? undefined : { kind: 'player' as const, id: focusId };
    const focusIndex = this.players.findIndex((p) => p.id === focus?.id);
    if (focusIndex !== this.expandCard) this.expandCard = focusIndex;
    /** **每张卡各自的目标**：焦点那张 1、其余 0（于是换人时两张同时跑）。 */
    this.expandStates = this.players.map((_entry, index) =>
      retarget(this.expandStates[index] ?? initialExpand(), index === focusIndex ? 1 : 0),
    );
    this.drawExpand(focusIndex);
    /**
     * **详情内容 = 展开后的那张卡的内容**（2026-10-22）：面板的透明度跟着
     * `progress` 走 —— 展开到 1 时它完全是详情、收起时它一点都看不见。
     * 于是"卡片长成详情"是**同一块区域**在变，不是左右两块各画一份 ✗。
     */
    const panelAlpha = easeOutCubic(this.progressOf(focusIndex));
    this.detailPanel.root.alpha = panelAlpha;
    /** 详情面板**平移到那张长大的卡上**（不缩放：宽度恒等 296）。 */
    if (focusIndex >= 0) {
      const slot = characterSelectCardRects(this.players.length)[focusIndex];
      if (slot !== undefined) {
        const grown = expandedCardRect(slot);
        const base = detailRect();
        this.detailPanel.root.x = grown.x - base.x;
        this.detailPanel.root.y = grown.y - base.y;
      }
    }

    this.detailPanel.update(focus);
  }

  /**
   * 画"正在变成详情面板"的那张卡。
   *
   * 起止都是**算出来的矩形**（卡片 / 详情面板），中间只做插值 ⇒ 卡片大小
   * 改了、面板位置改了，动画自动跟着变（不手调）。
   *
   * ⚠️ `alpha = 1 - progress`：越接近面板越透明 —— 看起来就是"卡片被
   * 面板吸收"，而不是"两个东西叠在一起"。
   */
  private drawExpand(cardIndex: number): void {
    /**
     * ⚠️ **不再 `clear()`**：`redraw` 的卡片循环已经把"被展开那张的描边"
     * 画进同一个 Graphics 了（见那里的说明），这里只负责名字标签。
     */
    this.expandTitle.root.visible = false;
    if (cardIndex < 0 || this.progressOf(cardIndex) <= 0) return;

    const areas = characterSelectHitAreas(this.players);
    const from = areas[cardIndex];
    const player = this.players[cardIndex];
    if (from === undefined || player === undefined) return;

    /**
     * ⚠️ 终点是**这张卡自己长高**（`expandedCardRect`），不是右侧那块
     * `detailRect()` —— 用户 2026-10-22 纠正："不是在右边有一个单独的模块"。
     */
    const to = expandedCardRect(from);
    const rect = lerpRect(from, to, easeOutCubic(this.progressOf(cardIndex)));
    /**
     * ⚠️ **不淡出**（2026-10-22）：这张卡是"正在长成详情"的那一块 —— 它
     * 一直实心，到 progress=1 时正好与详情面板重合，看起来就是"卡片变成了
     * 详情" ✓（上一版让它淡出 ⇒ 像"卡片消失、详情凭空出现"✗）。
     */
    const alpha = 1;
    const skin = cardSkin({ developing: false, cursored: true, selected: true });

    /** 长大的那张的**底色**画在 `cardGfx` 下层（内容要压在上面）。 */
    this.cardGfx
      .roundRect(rect.x, rect.y, rect.w, rect.h, CARD_RADIUS)
      .fill({ color: skin.fillColor, alpha: skin.fillAlpha * alpha });
    /** **描边画在 `expandGfx`**（它在详情面板之上）⇒ 卡片自己那圈金边 ✓ */
    this.expandGfx
      .roundRect(rect.x, rect.y, rect.w, rect.h, CARD_RADIUS)
      .stroke({ color: skin.strokeColor, width: skin.strokeWidth });

    /** 名字跟着卡片走（字号不插值：中文 >= 13 的下限比"大小连贯"更重要）。 */
    this.expandTitle.root.visible = this.progressOf(cardIndex) < 0.5;
    this.expandTitle.root.alpha = alpha;
    this.expandTitle.set(this.options.translate(player.nameKey));
    this.expandTitle.root.x = rect.x + 18;
    this.expandTitle.root.y = rect.y + Math.min(rect.h / 2, 40);
  }
}
