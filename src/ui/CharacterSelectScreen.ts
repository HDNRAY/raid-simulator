/**
 * **选角色屏 = 三张"人物详情卡"**（2026-10-22 第三次重做）。
 *
 * ==================================================================
 * 用户的三句原话（这一版的规格就是它们）
 * ==================================================================
 *
 * > 选人 还是有问题，你换一个实现算了，本来就是 **3 张 人物详情卡**，
 * > 只是**没有选中的时候收起来**，另外**收起来也是要有动画的**！
 *
 * > 展开可以快一点 **之前速度就可以**（= `EXPAND_DURATION_MS` 220ms，对称）
 *
 * > **黄/金边框只出现在"展开"那张卡上**
 *
 * > **动画速度记得要用曲线**
 *
 * ⚠️ 所有**画出来的量**（卡片高度 / 详情透明度 / 金边淡入 / 遮罩矩形）
 * 都过 `easeInOutCubic(progress)` —— 双向动画用 InOut（两端平缓），
 * 单端 `easeOutCubic` 会让收起"猛缩然后拖尾" ✗。`progress` 本身仍是
 * 恒速时钟（`stepExpand`），曲线只作用在画的时候（中断才连续）。
 *
 * ==================================================================
 * 这一版"不一样"在哪（前两版被否的原因）
 * ==================================================================
 *
 * | 版本 | 做法 | 用户为什么否 |
 * |---|---|---|
 * | 第一版 | 卡片 + **右边一块独立详情** | "不是在右边有一个单独的模块" |
 * | 第二版 | 卡片矩形插值到 `detailRect()` | 终点在右边 ⇒ 看起来**还是**右侧模块 |
 * | **这一版** | **每张卡自己就是详情卡**：三张并排、底边对齐，选中那张**向上长高**成完整详情，其余收起成短条 | —— |
 *
 * 关键差别：**没有"另一块详情区"**。三个角色的详情内容各住**各自的卡片容器**
 * 里（每张卡一个 `PrepareDetailController`），所以"展开"只是那张卡的高度
 * 从 96 变成 371 —— 内容不搬家、不淡出成另一块面板。
 *
 * ==================================================================
 * 交互（键盘与指针对等，AGENTS §3b）
 * ==================================================================
 *
 *   - `← →`：移光标（= 换选中；到两端停住）
 *   - 指针划到某张卡上：选中它（hover 优先于光标）
 *   - 指针离开所有卡：选中回落到**光标**那一张
 *   - `Enter` / 点卡片：以选中的角色开局（点"已确定"的那张 = 一步开局，
 *     点别的 = 先选中它，见 `tapCharacterIntent`）
 *   - `Shift + ↑ ↓`：滚展开那张卡的详情正文（`app/loopWiring.ts` 已接好）
 *   - 滚轮 / 拖拽 / 触屏拖动：同上（`canvasInput` 的"可滚屏"那条流水）
 *
 * ⚠️ **"没有选中"是一个真实状态**：刚进屏时三张**全收起**（谁都没选中），
 * 指针划到某张、或按过一次 `← →` 之后才有选中。用户原话就是
 * "没有选中的时候**收起来**" ✓
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { isDeveloping, type RosterEntry } from '../data/roster';
import { CARD_RADIUS } from './prepareRender';
import { PORTRAIT_PIXELS } from '../render/portraitAssets';
import { PortraitSprite } from '../render/portraitSprite';
import { portraitFor } from '../render/portraitAssets';
import { detailRect } from './prepareGeometry';
import { drawViewportClip } from './viewportMask';
import {
  easeInOutCubic,
  initialExpand,
  retarget,
  stepExpand,
  type ExpandState,
} from './expandTween';
import { PrepareDetailController } from './prepareDetailController';
import {
  CHARACTER_CARD_LAYOUT,
  canStartRun,
  characterCardRect,
  characterCardHotRect,
  characterCursorTarget,
  characterHoverTarget,
  characterSelectCardRects,
  characterSelectColumns,
  characterSelectHitAreas,
  characterSelection,
  confirmCharacter,
  cycleCharacter,
  pickCharacter,
  tapCharacterIntent,
  type CharacterCardColumn,
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
   * **详情内容的数据装配**（`app/prepareDetailContext.prepareDetailContext`）。
   *
   * ⚠️ 与备战屏**同一个工厂**：人物详情的取值函数（名字 / 生命上限 /
   * 技能表）都由它接上内容表 —— 这一屏不该有自己的第二份装配。
   * 三张卡各用一个 `PrepareDetailController`，但**共用同一个 `DetailContext`**
   * （内容只有一份来源，只是被画在三块矩形里）。
   */
  readonly detailContext: (free: { readonly on: (id: string) => boolean }) => DetailContext;
  /** 是否显示键位提示（触屏为假）。 */
  readonly showKeyHints: () => boolean;
  /** 点右上角的齿轮（打开设置）。 */
  readonly onGear: () => void;
  /** 点左上角的返回箭头（回首页）—— 触屏对等靠它（AGENTS §3b）。 */
  readonly onBack?: (() => void) | undefined;
  /** `F1` 的显示名（齿轮的键位提示）。 */
  readonly f1Label: () => string;
  /** 用这个角色开始一局肉鸽。 */
  readonly onStart: (playerId: string) => void;
}

/** 键名提示（键名不进 i18n，见 AGENTS §3b）。 */
const SELECT_KEY_HINT = '← → · Enter';

/**
 * 一张卡的**视图部件**（每张卡一套；没有"共享的详情面板"）。
 *
 * ⚠️ 为什么中间多一层 `detailHolder`：`PrepareDetailController` 按**备战的
 * 绝对坐标**（`detailRect()` = x624,y88）画内容，而卡片容器的局部原点在
 * 卡片左上角。这一层只做**坐标平移**（每帧按当前高度算，见 `redraw`），
 * 于是详情渲染仍然只有一份实现，三张卡只是把它摆到三个位置。
 */
interface CardView {
  readonly id: string;
  readonly column: CharacterCardColumn;
  /** 卡片容器（局部原点 = 卡片左上角）。 */
  readonly holder: Container;
  /** 卡片底色 + 边框。 */
  readonly skin: Graphics;
  /** 收起时那个短条上的名字。 */
  readonly name: Label;
  /** 收起时短条上的**小头像**（与详情面板同一个 `PortraitSprite`）。 */
  readonly portrait: PortraitSprite | undefined;
  /** 详情内容的平移层。 */
  readonly detailHolder: Container;
  readonly panel: PrepareDetailController;
  /** 详情内容的遮罩（每帧重画成"这张卡现在的矩形"）。 */
  readonly mask: Graphics;
  /** 这张卡自己的展开进度。 */
  state: ExpandState;
}

export class CharacterSelectScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly title: Label;
  private readonly hint: Label;
  /** 三张卡的视图（顺序 = `players` 顺序）。 */
  private readonly cards: readonly CardView[];
  /**
   * **本屏自己的边角控件**：右上角齿轮 + 左上角返回箭头。
   *
   * ⚠️ 用户 2026-10-12："多个页面的齿轮，应该分别定义"、"stage 上理论上
   * 不挂任何小组件" ⇒ 它们住在屏里，显隐与缩放都跟着本屏走。
   */
  readonly chrome: ScreenChrome;

  /** 指针此刻**停在卡上**的那个 id（`undefined` = 没停在卡上）。 */
  private hoveredId: string | undefined;
  /**
   * 指针**在画布内**吗（无论是否停在卡上）。
   *
   * ⚠️ 它与 `hoveredId` 是**两个事实**（用户 2026-10-22 报的 bug：
   * "鼠标在空白处也会展开"）：指针在画布内、但没落在卡上 ⇒ 选中为
   * `undefined` ⇒ **三张全收起** ✓；指针**离开画布**（或压根没动过鼠标）
   * 才回落到"键盘光标那张"。
   *
   * 进屏初值 `true` = "当作指针在画布内但不在任何卡上" ⇒ **三张全收起**
   * （用户："没有选中的时候收起来"）✓
   */
  private pointerInside = true;
  /**
   * 键盘有没有**接管**（按过 `← →` / Tab 之后为真，鼠标一动就交还）。
   * 键盘接管时选中**跟着光标**，与指针停在哪无关（父规格里那条
   * "指针还停在空白处？也以键盘动作为准"）。
   */
  private keyboardActive = false;

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
      y: 52,
      size: FONT.title,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.root.addChild(this.title.root);

    /** 底部提示：**落在卡片区下方**（卡片底边 = 详情区下缘，提示要更下）。 */
    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: CHARACTER_CARD_LAYOUT.bottomY + 40,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.hint.root);

    /**
     * **三张详情卡**（每张一套部件 + 一个详情驱动器）。
     *
     * ⚠️ 遮罩挂在 `detailHolder` 上：**只裁详情内容**，不裁卡片底色与
     * 短条名字（它们本来就在卡片矩形内）。
     */
    const context = options.detailContext({ on: () => false });
    const columns = characterSelectColumns(this.players.length);
    this.cards = this.players.map((player, index) => {
      const column = columns[index] ?? { x: 0, w: CHARACTER_CARD_LAYOUT.w };
      const holder = new pixi.Container();
      holder.x = column.x;
      this.root.addChild(holder);

      const skin = new pixi.Graphics();
      holder.addChild(skin);

      /**
       * **收起态的小头像**（2026-10-22 用户："收起时也要显示头像"）。
       * ⚠️ 复用详情面板那颗 `PortraitSprite`（**唯一**的头像渲染），
       * 只是 box 小一些 —— 不另找一份素材表/自己画图片。
       */
      const asset = portraitFor(player.id);
      const portrait = asset === undefined
        ? undefined
        : new PortraitSprite(pixi, holder, asset, Math.round(PORTRAIT_PIXELS * 0.6));

      const name = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.title,
        color: PALETTE.text,
        anchorX: 0,
        anchorY: 0.5,
        kai: true,
      });
      holder.addChild(name.root);

      const detailHolder = new pixi.Container();
      holder.addChild(detailHolder);
      const panel = new PrepareDetailController({
        pixi,
        translate: options.translate,
        context,
        parent: detailHolder,
      });
      const mask = new pixi.Graphics();
      /**
       * ⚠️ 遮罩**住在卡片容器里**、而不是 `detailHolder` 自己身上：
       * `detailHolder` 被平移了 (-624, -88) 去对齐详情内容，把遮罩挂进去
       * 等于让它跟着平移 ⇒ 遮罩落到画布外、把内容整块裁掉（实测：展开后
       * 一片空白 ✗）。遮罩矩形是**卡片局部坐标**（0,0,w,h），所以它的
       * 父节点必须是"卡片容器"。
       */
      holder.addChild(mask);
      detailHolder.mask = mask;

      return {
        id: player.id,
        column,
        holder,
        skin,
        name,
        portrait,
        detailHolder,
        panel,
        mask,
        state: initialExpand(),
      };
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

    this.redraw();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (visible) this.redraw();
  }

  /** 当前选择 + 光标（调试入口读它）。 */
  get current(): PrepareSelection {
    return this.selection;
  }

  /**
   * 展开动画的读数（调试 / 截图验收）：`card` = 展开的是第几张，
   * `progress` = 那张卡此刻的进度（0 收起 / 1 展开）。
   */
  expand(): { readonly card: number | null; readonly progress: number } {
    const index = this.focusIndex();
    return {
      card: index < 0 ? null : index,
      progress: Math.round(this.progressOf(index) * 1000) / 1000,
    };
  }

  /** `← →`：**只移动光标**（不改已确定的角色）。 */
  cycle(delta: number): void {
    const next = cycleCharacter(this.selection, this.players, delta);
    if (next === this.selection) return;
    this.selection = next;
    /** 键盘一动 ⇒ 选中交给光标（指针的"划过"让位）。 */
    this.hoveredId = undefined;
    this.keyboardActive = true;
    this.redraw();
  }

  /**
   * `Enter`：确定光标处的角色；能开始就开始一局。
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

  /** **只选中**某个角色（移光标 + 确定，**不开局**）—— 点别人的第一步。 */
  select(id: string): void {
    const next = pickCharacter(this.selection, this.players, id);
    if (next === this.selection) return;
    this.selection = next;
    this.keyboardActive = true;
    this.redraw();
  }

  /**
   * **悬停**（鼠标划过）：选中指针所在的卡。
   *
   * ⚠️ 触屏永远走不到这里（没有 `pointermove`）—— 那时选中就退化成
   * "跟着光标 / 点选走"，同一段代码服务两种输入。
   *
   * @returns 悬停落在某张卡上（供调用方判"要不要重画"）
   */
  hover(px: number, py: number): boolean {
    const next = characterHoverTarget(this.players, px, py)?.id;
    const changed = next !== this.hoveredId
      || !this.pointerInside
      || this.keyboardActive;
    /** 指针一动 ⇒ 选中重新归指针（键盘接管结束）。 */
    this.pointerInside = true;
    this.keyboardActive = false;
    this.hoveredId = next;
    if (changed) this.redraw();
    return next !== undefined;
  }

  /** 指针离开画布：清掉悬停（选中回落到光标那一张）。 */
  clearHover(): void {
    /** 指针离开画布 ⇒ 选中回落到键盘光标那张。 */
    const changed = this.pointerInside || this.hoveredId !== undefined;
    this.pointerInside = false;
    this.hoveredId = undefined;
    if (changed) this.redraw();
  }

  /**
   * 当前**可点区域**（只读；调试 / 截图脚本按它换算坐标）。
   *
   * ⚠️ 脚本**不许自己复制一份布局数字**（备战屏同一条纪律）：布局一调，
   * 抄的那份会静默指到别处，而"点空了"与"功能坏了"长得一模一样。
   */
  hitAreas(): ReturnType<typeof characterSelectHitAreas> {
    return characterSelectHitAreas(this.players);
  }

  /** 选中那一项（hover 优先，见 `focusedTarget`）。 */
  detail(): PrepareTarget | undefined {
    const id = this.focusId();
    return id === undefined ? undefined : { kind: 'player', id };
  }

  /** 悬停那一项（调试探针用；`undefined` = 鼠标不在任何卡上）。 */
  hovered(): PrepareTarget | undefined {
    return this.hoveredId === undefined ? undefined : { kind: 'player', id: this.hoveredId };
  }

  /** 三张卡的**命中区**（= 展开后的整块；与动画无关，见逻辑层注释）。 */
  cardRects(): readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[] {
    return characterSelectCardRects(this.players.length);
  }

  /* ---------------------------------------------------------------- *
   * 滚动（2026-10-22：展开那张卡的正文可滚，键盘 Shift+↑↓ 也走这里）
   * ---------------------------------------------------------------- */

  /**
   * 这个点是不是落在**展开那张卡**的正文区里（拖拽 / 滚轮的判据）。
   *
   * ⚠️ 判据用**命中区**（`characterCardHotRect`，与动画无关）而不是动画
   * 矩形：后者每帧在变，指针停在边缘会"忽进忽出"。
   * ⚠️ 收起状态（progress < 0.5）**不吃滚动** —— 那时卡片还没长成详情。
   */
  isOnScrollable(px: number, py: number): boolean {
    const index = this.focusIndex();
    if (index < 0 || this.progressOf(index) < 0.5) return false;
    const card = this.cards[index];
    if (card === undefined) return false;
    const hot = characterCardHotRect(card.column);
    return px >= hot.x && px <= hot.x + hot.w && py >= hot.y && py <= hot.y + hot.h;
  }

  /**
   * **键盘滚动**：`Shift + ↑ / ↓`（`loopWiring` 按同一约定接好）。
   * ⚠️ 只在展开到位时才滚：收起时那张还是短条，滚它没有意义。
   */
  scrollDetail(dir: 'up' | 'down'): void {
    const index = this.focusIndex();
    if (index < 0 || this.progressOf(index) < 0.5) return;
    this.cards[index]?.panel.scrollStep(dir);
  }

  /** **滚轮**：滚展开那张卡的正文。@returns 有没有真的滚 */
  wheelDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.isOnScrollable(px, py)) return false;
    return this.cards[this.focusIndex()]?.panel.scrollBy(deltaY * 3) ?? false;
  }

  /** **拖拽**（触屏没有滚轮，这条路必须存在）。@param deltaY 向上为负 */
  dragDetail(px: number, py: number, deltaY: number): boolean {
    if (!this.isOnScrollable(px, py)) return false;
    return this.cards[this.focusIndex()]?.panel.scrollBy(-deltaY) ?? false;
  }

  /**
   * 点一下（逻辑坐标）。@returns 是否消费了这次点击
   *
   * ⚠️ **先选中、再点同一张才开局**（`tapCharacterIntent`）：触屏没有
   * hover，不这么分就"点谁开谁、永远看不到别人的详情"（§3b）。
   */
  hitTest(px: number, py: number): boolean {
    /** ⚠️ 齿轮 / 返回箭头先于卡片（顺序即优先级）。 */
    if (this.chrome.hitTest(px, py)) return true;
    const hit = characterHoverTarget(this.players, px, py);
    if (hit === undefined) return false;
    if (tapCharacterIntent(this.selection, hit.id) === 'start') this.pick(hit.id);
    else this.select(hit.id);
    return true;
  }

  /** 每帧：推进三张卡各自的动画，然后按当前进度重画。 */
  frame(): void {
    if (!this.root.visible) return;
    /**
     * ⚠️ 用 `performance.now()` 的**差值**（不是每帧固定 16.67）：帧率抖动
     * 时时长才不会跟着变。这是渲染层的时间，`core/` 那条"只走 `logicMs()`"
     * 的规则只管战斗逻辑。
     */
    const now = performance.now();
    const dt = this.lastFrameMs === 0 ? 0 : now - this.lastFrameMs;
    this.lastFrameMs = now;
    /** ⚠️ **每一张**都推进：换选中时旧卡缩、新卡长，两张同时跑。 */
    for (const card of this.cards) card.state = stepExpand(card.state, dt);
    this.redraw();
    this.chrome.update();
  }

  /**
   * **UI 缩放**：本屏只转发给它自己的边角控件（与 `HomeScreen` 同一条）。
   *
   * ⚠️ 卡片**不随缩放**：这一屏是满屏布局，卡片几何由
   * `CHARACTER_CARD_LAYOUT` 定死（详情区宽高是备战屏共用常数）。
   */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  /* ---------------------------------------------------------------- *
   * 内部
   * ---------------------------------------------------------------- */

  /**
   * 此刻"选中"的是谁（**hover 优先、其次光标**）。
   *
   * ⚠️ **谁都没 hover、键盘也还没动过 ⇒ `undefined`**（三张全收起）——
   * 那就是用户说的"没有选中的时候收起来" ✓
   */
  private focusId(): string | undefined {
    /** 键盘接管 ⇒ 跟光标（指针停在哪都不影响）。 */
    if (this.keyboardActive) return characterCursorTarget(this.selection, this.players)?.id;
    /** 指针在画布内 ⇒ **只看它有没有落在卡上**（落在空白则全收起）。 */
    if (this.pointerInside) return this.hoveredId;
    return characterCursorTarget(this.selection, this.players)?.id;
  }

  /** 选中那张卡的下标（没有 ⇒ -1）。 */
  private focusIndex(): number {
    const id = this.focusId();
    if (id === undefined) return -1;
    return this.cards.findIndex((card) => card.id === id);
  }

  /** 第 `index` 张卡此刻的进度（缺省 0 = 收着）。 */
  private progressOf(index: number): number {
    if (index < 0) return 0;
    return this.cards[index]?.state.progress ?? 0;
  }

  /**
   * 真正开始一局。
   *
   * ⚠️ **开发中的角色不开局**（需求）。反馈由底部提示给出 —— 玩家点之前
   * 就看得见，不是"点了没反应"。
   */
  private begin(): void {
    if (!canStartRun(this.selection, isDeveloping)) return;
    this.options.onStart(this.selection.playerId);
  }

  /**
   * 画一帧：目标 → 进度 → 三张卡的几何 / 底色 / 名字 / 详情 / 遮罩。
   *
   * ⚠️ 这里是**唯一**写几何的地方：渲染矩形（`characterCardRect`）与命中
   * 矩形（`characterCardHotRect`）都从 `characterSelectLogic` 来，不会漂。
   */
  private redraw(): void {
    const t = this.options.translate;
    const developing = !canStartRun(this.selection, isDeveloping);
    const focusIndex = this.focusIndex();

    this.title.set(t('screen.characterSelect.title'));
    /**
     * 提示 = 标签 + （键名）；**选中开发中的角色时换成"开发中"**
     * （需求："不能开始战斗……或给明确反馈"）。
     */
    const label = developing ? t('roster.ui.developingHint') : t('screen.characterSelect.hint');
    const keys = !developing && this.options.showKeyHints()
      ? t('screen.keyHint', { keys: SELECT_KEY_HINT })
      : '';
    this.hint.set(`${label}${keys}`);

    /** 每张卡各自的目标：选中那张 1、其余 0 ⇒ 换选中时两张同时跑。 */
    for (const [index, card] of this.cards.entries()) {
      card.state = retarget(card.state, index === focusIndex ? 1 : 0);
    }

    const detail = detailRect();
    for (const [index, card] of this.cards.entries()) {
      const eased = easeInOutCubic(this.progressOf(index));
      const rect = characterCardRect(card.column, eased);

      /** 卡片容器：x 固定（列），y 由"底边固定、向上长"给出。 */
      card.holder.x = card.column.x;
      card.holder.y = rect.y;

      /**
       * 底色 + 边框。
       * ⚠️ **金边只属于"展开"那张**（用户 2026-10-22："黄/金边框只出现在
       * 展开那张卡上"）：按 `eased` 插值透明度，收起态必须是 0。
       */
      const focused = index === focusIndex;
      card.skin.clear();
      card.skin
        .roundRect(0, 0, rect.w, rect.h, CARD_RADIUS)
        .fill({
          color: focused ? PALETTE.panel : PALETTE.panelLine,
          alpha: focused ? 0.55 : 0.35,
        });
      if (eased > 0.02) {
        card.skin
          .roundRect(0, 0, rect.w, rect.h, CARD_RADIUS)
          .stroke({ color: PALETTE.douqi.base, width: 2, alpha: eased });
      } else {
        /** 收起的两张：中性细边（不是金色，也不是"光标框"）。 */
        card.skin
          .roundRect(0, 0, rect.w, rect.h, CARD_RADIUS)
          .stroke({ color: PALETTE.panelLine, width: 1 });
      }

      /**
       * 短条上的名字：展开时淡出（详情自带标题，不能叠字）。
       * y 放在**卡片底部那条短条的中心**（底边固定 ⇒ 它不跟着长高跑）。
       */
      const barCenterY = rect.h - CHARACTER_CARD_LAYOUT.barH / 2;
      /** 短条排版：头像在左（12 起）、名字在它右边（12 + 头像 48 + 12）。 */
      const portraitBox = card.portrait === undefined ? 0 : Math.round(PORTRAIT_PIXELS * 0.6);
      const barLeft = 14;
      if (card.portrait !== undefined) {
        card.portrait.root.x = barLeft + portraitBox / 2;
        card.portrait.root.y = barCenterY;
        card.portrait.root.alpha = 1 - eased;
        card.portrait.root.visible = eased < 0.98;
      }
      card.name.root.x = barLeft + (portraitBox === 0 ? 0 : portraitBox + 14);
      card.name.root.y = barCenterY;
      card.name.root.alpha = 1 - eased;
      card.name.root.visible = eased < 0.98;
      const player = this.players[index];
      if (player !== undefined) card.name.set(t(player.nameKey));

      /**
       * 详情内容：底部对齐到卡片底边（`h - fullH`），再减掉它自己的绝对
       * 原点 `detailRect()` ⇒ 内容在卡片局部坐标里正好铺满整张卡。
       */
      card.detailHolder.x = -detail.x;
      card.detailHolder.y = rect.h - detail.h - detail.y;
      card.detailHolder.alpha = eased;

      /** 遮罩 = 这张卡**现在**的矩形（局部坐标；每帧重画）。 */
      drawViewportClip(card.mask, { x: 0, y: 0, w: rect.w, h: rect.h });

      /** 每张卡固定显示**自己**那个人（不跟 hover / 光标）。 */
      if (player !== undefined) {
        card.panel.update({ kind: 'player', id: player.id });
      }
    }
  }
}
