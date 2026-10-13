/**
 * **自由模式（备战屏）**：选人物 →（开炁机）→ 选对手 → 开始战斗。
 *
 * ==================================================================
 * 需求（本轮，用户原话）
 * ==================================================================
 *
 * > "自由选择对的 layout 可以优化"
 * > "1. 先选炁机 再选 boss"
 * > "2. 详情页右上角是空的，名字 头像 血量啥的，优化一下布局"
 * > "3. 开始战斗和按钮错位了，并且所有的角色 boss 选项卡 可以再小一点"
 * > "4. 同一时间只展开暂时 3 个选择中的一个，其他的收起来，只展示当前选择"
 *
 * 四件事的落点：
 *
 * | 需求 | 落在哪 |
 * |---|---|
 * | ① 顺序：人物 → **炁机** → 对手 | `prepareLayout.SECTION_ORDER` + `rowTopsOf` 的递推顺序（**只改声明顺序**，不再手调 y） |
 * | ② 详情区顶栏（名字 / 头像 / 血量） | `prepareDetail`（模型）+ `prepareDetailPanel`（画） |
 * | ③ 「开始战斗」与文字对齐 + 卡片更小 | `prepareLayout.startRect`（按钮唯一出处）+ `prepareFooter`；卡片尺寸见布局表的推导 |
 * | ④ 手风琴（同时只展开一块） | `prepareLogic.expanded`（状态）+ `prepareLayout`（几何）+ `prepareFold` / `prepareFoldBars`（收起那块显示什么 / 怎么画） |
 *
 * ⚠️ 本文件**只是装配**：几何在 `prepareLayout`、状态机在 `prepareLogic`、
 * 皮肤在 `prepareRender`、详情内容在 `prepareDetail`、块头文案在
 * `prepareFold`。这一层负责"把它们的产物摆到 Pixi 对象上"，以及"输入事件
 * 该调哪个纯函数"。
 *
 * ==================================================================
 * ⚠️ 手风琴：**焦点在哪一块，就展开哪一块**
 * ==================================================================
 *
 * | 输入 | 行为 |
 * |---|---|
 * | 键盘方向键 / Tab 移到收起的那一块 | **立刻展开它**（一步，不用先按 Enter） |
 * | 点 / 点触收起那块「块头」 | 展开它（**不改选择**） |
 * | **鼠标划过**块头 | **不展开**（划一下就展开太跳 —— 见下） |
 *
 * ⚠️ **为什么不给块头做 hover 展开**：这一屏的鼠标划过卡片时详情区会跟着
 * 切（"hover 优先"），若 hover 也展开手风琴，那么"从卡片划到另一块"的
 * 路上会连续展开/收起两次，整屏跟着重排 —— 玩家看到的是一屏在抖。所以
 * **展开只由"焦点"决定**（键盘 / 点击），hover 只管详情区。
 *
 * ⚠️ **为什么是"自动展开"而不是"按 Enter 才展开"**：进界面后玩家的第一
 * 个动作可能是 ↑↓ 换块，而"焦点在一块收起的块上、画面上却没有光标"正是
 * 本仓库点名过的那种"以为按键坏了"。触屏对等也靠同一条：点块头就是
 * 一次操作展开它（不需要"选中 → 确认"两步）。
 *
 * ==================================================================
 * ⚠️ 收起的那两块里，**卡片是点不到的**（也就 hover 不到）
 * ==================================================================
 *
 * 命中区里只有**展开那一块**的卡（`prepareLayout.prepareHitAreas`）——
 * 收起的块里根本没有"看不见却能点中的幽灵卡"。于是详情区恒等于"**当前
 * 展开那一块**里"的那一项（焦点 / 悬停都落在可见的卡上）。用户明确
 * 允许这个判断："若不能 → 详情区就只显示当前展开那块里的东西，但要说明"。
 *
 * ==================================================================
 * ⚠️ 每帧只改字符串与可见性，不重建 Text / Graphics
 * ==================================================================
 *
 * `Label` / `Graphics` 全部在构造时建好，`draw()` 只做
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
 * | **展开收起的那一块** | 焦点移过去（自动） | **点那块头** |
 * | 看详情 | 移动焦点 | **点一下**（触屏没有 hover） |
 * | 开战 | Enter（光标在「开始」上） | 点「开始战斗」 |
 */

import type { Container } from 'pixi.js';
import { isDeveloping } from '../data/roster';
import type { PrepareHitArea } from './prepareLayout';
import { NO_SCROLL, prepareHitAreas, type SectionScroll } from './prepareGeometry';
import { followedCursor, sectionAtPoint, scrolledBy, type ScrollLists } from './prepareScroll';
import {
  canStartBattle,
  confirmCursor,
  cursorTarget,
  cycleCursor,
  cycleQijiStack,
  expandSection,
  focusTarget,
  halfOfCard,
  hitTestPrepare,
  initialSelection,
  isSectionKind,
  moveFocus,
  pickOption,
  pickQiji,
  stackCapOf,
  stacksIn,
  stepCursor,
  unstackQiji,
  type FreeQiji,
  type PrepareSelection,
  type PrepareTarget,
} from './prepareLogic';
import { drawPrepareFrame } from './prepareFrame';
import { detailModelOf, type DetailContext } from './prepareDetail';
import { PrepareDetailController } from './prepareDetailController';
import { buildPrepareParts, type PrepareParts } from './prepareParts';
import type { ScreenChrome } from './ScreenChrome';
import type { PrepareSectionKind } from './prepareTypes';

/** 选项与构造参数在 `prepareOptions`（本文件只装配，见那里的说明）。 */
export type { PrepareQijiOption, PrepareScreenOptions } from './prepareOptions';
import type { PrepareQijiOption, PrepareScreenOptions } from './prepareOptions';

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export class PrepareScreen {
  readonly root: Container;

  /**
   * 本屏自己的边角控件（右上角齿轮 + 左上角返回箭头）。
   *
   * ⚠️ 用户 2026-10-12："多个页面的齿轮，应该分别定义"、"stage 上理论上
   * 不挂任何小组件" —— 两个按钮都在本屏的 root 里。
   */
  readonly chrome: ScreenChrome;

  /**
   * 这一屏的全部部件（造一次，永不重建）。
   *
   * ⚠️ 造部件那一段在 `prepareParts`（见那里的文件头）：本类只管**输入
   * 怎么改状态**，画面那一段在 `prepareFrame`。
   */
  private readonly parts: PrepareParts;
  /** 详情区（右侧）：悬停 + 光标的合流在这一层（见 `prepareDetailController`）。 */
  private readonly detailPanel: PrepareDetailController;
  /** 详情区的数据上下文（探针读 `detailModel()` 要用，见那个方法）。 */
  private readonly detailContext: DetailContext;

  private readonly players: readonly { readonly id: string; readonly nameKey: string }[];
  private readonly bosses: readonly { readonly id: string; readonly nameKey: string }[];
  private readonly qiji: readonly PrepareQijiOption[];
  private readonly options: PrepareScreenOptions;

  private selection: PrepareSelection;
  private free: FreeQiji;
  /**
   * 三块各自的**滚动偏移**（逻辑像素，`0` = 顶部）。
   *
   * ⚠️ 只有本类能写它（渲染 / 命中只读）：三条改它的路 —— 滚轮 / 拖拽 /
   * **光标跟随**（见 `followCursor`）—— 都收在这里的方法里，所以
   * "画面滚到哪"与"点中的是哪张卡"不可能各说各话。
   */
  private scroll: SectionScroll = NO_SCROLL;

  constructor(options: PrepareScreenOptions) {
    this.options = options;
    this.players = options.players;
    this.bosses = options.bosses;
    this.qiji = options.qiji;
    this.free = options.freeQiji ?? {};
    this.selection = initialSelection(options.initial, this.qiji);

    /**
     * ⚠️ 两个取值函数是**活闭包**（读 `this.free` / 静态内容表），而不是
     * 一份值：层数每点一下就变，传值会让详情区显示上一帧的层数。
     */
    this.parts = buildPrepareParts({
      options,
      selection: this.selection,
      counts: this.counts(),
      stacks: (id) => stacksIn(this.free, id),
      cap: (id) => stackCapOf(this.qijiById(id)?.maxStacks),
    });
    this.root = this.parts.root;
    this.chrome = this.parts.chrome;
    this.detailPanel = this.parts.detailPanel;
    this.detailContext = this.parts.detailContext;

    this.draw();
  }

  /* ---------------------------------------------------------------- *
   * 只读查询
   * ---------------------------------------------------------------- */

  get visible(): boolean {
    return this.root.visible;
  }

  /** 当前选择（`main.ts` 用它起战斗、也用它持久化）。 */
  get current(): PrepareSelection {
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
   * `detail()` 都证明不了"面板收到的是不是它该收到的"。
   */
  detailModel(): ReturnType<typeof detailModelOf> {
    return detailModelOf(this.detailed(), this.detailContext);
  }

  /**
   * **详情区此刻显示的是哪一项**（给调试探针用）。
   *
   * ⚠️ 它与 `cursor()` / `hovered()` 是**三个不同的读数**：截图能看出
   * "面板上有字"，但"是**谁的**字"只有这个返回值能钉死。
   */
  detail(): PrepareTarget | undefined {
    return this.detailed();
  }

  /** 当前展开的那一块（手风琴；探针与截图脚本读它对账）。 */
  expandedSection(): PrepareSectionKind {
    return this.selection.expanded;
  }

  /** 当前布局的可点区域（探针 / 单测读它与渲染对账）。 */
  hitAreas(): readonly PrepareHitArea[] {
    return prepareHitAreas(
      this.players,
      this.bosses,
      this.qiji,
      this.selection.expanded,
      this.scroll,
    );
  }

  /* ---------------------------------------------------------------- *
   * 键盘
   * ---------------------------------------------------------------- */

  /**
   * 键盘 ← →：在**当前这一块内部**移动光标（`delta` = ±1），到边界**不环绕**。
   * ⚠️ **不改选择**。要它变成选择得按 Enter（`confirm`）。
   */
  cycle(delta: number): void {
    this.apply(this.followCursor(cycleCursor(this.selection, this.players, this.bosses, delta, this.qiji)));
  }

  /**
   * 键盘 ↑ ↓：**在块内**换行（炁机那一块是 2 行；人物 / 对手只有 1 行）。
   *
   * ⚠️⚠️ 它与 `moveFocus`（Tab）**不是同一件事**：这一条**永不跨块**
   * （到边界停住）。见 `prepareLogic.stepCursor` 的说明 —— 用户报的
   * "炁机内部无法用方向键选择"就是这两件事曾经共用一个键造成的。
   */
  stepVertical(dir: 'up' | 'down'): void {
    this.apply(this.followCursor(stepCursor(this.selection, this.players, this.bosses, dir, this.qiji)));
  }

  /**
   * **Tab / Shift+Tab**：块与块之间换焦点（人物 ↔ 炁机 ↔ 对手 ↔ 开始）。
   *
   * `wrap` 给 Tab / Shift+Tab 用（环绕）—— 方向键**不再**走这条路。
   */
  moveFocus(delta: number, wrap = false): void {
    this.apply(
      moveFocus(this.selection, delta, {
        wrap,
        players: this.players,
        bosses: this.bosses,
        qiji: this.qiji,
      }),
    );
  }

  /** 光标推到看得见的地方（三块共用一套：爆出视口的行才滚，见 `scrollToShowCursor`）。 */
  private followCursor(next: PrepareSelection): PrepareSelection {
    this.scrollToShowCursor(next);
    return next;
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
      this.apply(next, true);
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
   * ⚠️ 焦点落到某一块上时**它同时被展开**（手风琴的唯一判据）。
   */
  focusSlot(slot: 'player' | 'qiji' | 'boss' | 'start'): void {
    this.apply(
      this.followCursor(
        focusTarget(this.selection, slot, {
          players: this.players,
          bosses: this.bosses,
          qiji: this.qiji,
        }),
      ),
    );
  }

  /**
   * 选中某个人物 / 对手（点卡片 = 移光标 + 确定；调试入口也走它）。
   */
  pick(kind: 'player' | 'boss', id: string): void {
    const next = pickOption(this.selection, this.players, this.bosses, kind, id);
    if (next !== this.selection) this.apply(this.followCursor(next), true);
  }

  /**
   * **展开某一块**（点收起态的「块头」；§3b：触屏要能展开）。
   *
   * ⚠️ 只换焦点（= 展开那一块），**不改选择** —— 块头显示的正是"当前
   * 选了什么"，点它不该把它改掉。这一层是**公开方法**，因为调试入口也
   * 用它（截图脚本要能一步摆出"炁机块展开"的画面）。
   */
  expand(slot: PrepareSectionKind): void {
    this.apply(this.followCursor(expandSection(this.selection, slot)));
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
   * **悬停**（鼠标）。只影响详情区，**不动光标、也不展开手风琴**（见文件头）。
   *
   * @returns 悬停落在某一项上（供调用方判"要不要重画"）。
   */
  hover(px: number, py: number): boolean {
    const at = hitTestPrepare(
      px,
      py,
      this.players,
      this.bosses,
      this.qiji,
      this.selection.expanded,
      this.scroll,
    );
    /** ⚠️「开始战斗」与「块头」都不是"一张卡"，悬停它们不该把详情区切走。 */
    const next =
      at === undefined || at.kind === 'start' || at.kind === 'summary'
        ? undefined
        : { kind: at.kind, id: at.id };
    if (this.detailPanel.hoverAt(next)) this.draw();
    return at !== undefined;
  }

  /** 指针离开画布：清掉悬停（否则详情区会一直停在最后划过的那一项）。 */
  clearHover(): void {
    if (this.detailPanel.clearHover()) this.draw();
  }

  /**
   * 这个点是不是落在**可以拖拽滚动的区域**里（输入层的拖拽判据）。
   *
   * ⚠️ 两块：展开那一块的**卡片视口**（排不下时能滚）与**详情区**
   * （Boss 招式说明装不下时能滚）。判据收在这一个方法里，于是
   * `canvasInput` 只问一次"这次手势该不该开始拖"。
   */
  isOnScrollable(px: number, py: number): boolean {
    return this.sectionAt(px, py) !== undefined || this.detailPanel.isOnDetail(px, py);
  }

  /**
   * 这个点是不是落在详情区的**可滚视口**里。
   *
   * ⚠️ 保留它（而不是只留 `isOnScrollable`）：`wheelDetail` 要分别问
   * "卡片区吃不吃"与"详情区吃不吃"两件事，合成一个布尔就分不出来了。
   */
  isOnDetail(px: number, py: number): boolean {
    return this.detailPanel.isOnDetail(px, py);
  }

  /**
   * 这个点是不是落在**某一块卡片区的视口**里（滚轮 / 拖拽的命中判据）。
   *
   * ⚠️ 规则在 `prepareScroll.sectionAtPoint`（纯函数，可在 node 里测）——
   * 这里只把"这一帧的三块张数 / 展开块 / 偏移"喂进去。
   */
  sectionAt(px: number, py: number): PrepareSectionKind | undefined {
    return sectionAtPoint(px, py, this.selection.expanded, this.counts(), this.scroll);
  }

  /**
   * **滚轮**：先问卡片区（排不下时能滚），再问详情区（Boss 招式说明装不下时能滚）。
   *
   * ⚠️ 与设置页的技能详情同一条分工：入口在 `canvasInput`（输入归属只有
   * 一处），本屏只回答"滚不滚得动"。
   *
   * @returns 有没有消费这次滚轮（没消费就让页面自己滚）。
   */
  wheelDetail(px: number, py: number, deltaY: number): boolean {
    /**
     * ⚠️ 像素 → 逻辑像素：`deltaMode === 1` 时 `deltaY` 的单位是**行**
     * （Firefox 常见），直接当像素用会滚得几乎看不出来。
     */
    const step = deltaY * 3;
    const section = this.sectionAt(px, py);
    if (section !== undefined && this.scrollSection(section, step)) return true;
    if (!this.detailPanel.isOnDetail(px, py)) return false;
    return this.detailPanel.scrollBy(step);
  }

  /**
   * **拖拽**：卡片区优先，其次详情区（触屏：没有滚轮，AGENTS.md §3b 要求
   * 这条路必须存在）。
   *
   * @param deltaY 这一帧相对上一帧的位移（像素，向上为负）。
   */
  dragDetail(px: number, py: number, deltaY: number): boolean {
    const section = this.sectionAt(px, py);
    if (section !== undefined && this.scrollSection(section, -deltaY)) return true;
    if (section !== undefined) return true;
    if (!this.detailPanel.isOnDetail(px, py)) return false;
    return this.detailPanel.scrollBy(-deltaY);
  }

  /**
   * 把某一块**滚动 `delta` 像素**（正数 = 往下看更多）。
   *
   * ⚠️ 钳位在 `scrollWindow.clampOffset`（**复用**那一份边界规则，
   * 不在这写第二遍）：滚到尽头 / 内容不足一屏 / 空内容三种边界只有
   * 一处实现。
   */
  private scrollSection(kind: PrepareSectionKind, delta: number): boolean {
    const next = scrolledBy(kind, delta, this.counts(), this.scroll);
    if (next === undefined) return false;
    this.scroll = next;
    this.draw();
    return true;
  }

  /**
   * **光标跟随**：光标换行时，若它落在视口外就把视角推过去。
   *
   * ⚠️ 规则在 `prepareScroll.followedCursor`（纯函数）—— 这里只负责
   * "算出新偏移就换上去"（`undefined` = 光标本来就看得见，不动）。
   */
  private scrollToShowCursor(sel: PrepareSelection): void {
    const next = followedCursor(sel, this.lists(), this.counts(), this.scroll);
    if (next !== undefined) this.scroll = next;
  }

  /**
   * 点一下（逻辑坐标）。
   *
   * @returns 是否消费了这次点击
   */
  hitTest(px: number, py: number): boolean {
    /** ⚠️ 齿轮 / 返回箭头先于卡片（顺序即优先级）。 */
    if (this.chrome.hitTest(px, py)) return true;
    const at = hitTestPrepare(
      px,
      py,
      this.players,
      this.bosses,
      this.qiji,
      this.selection.expanded,
      this.scroll,
    );
    if (at === undefined) return false;
    if (at.kind === 'start') {
      this.start();
      return true;
    }
    /**
     * ⚠️ **点收起态的块头 = 展开那一块**（不改选择）：触屏没有"Tab 到那一块"
     * 这条路（AGENTS.md §3b 的功能对等）。
     */
    if (at.kind === 'summary') {
      if (isSectionKind(at.id)) this.expand(at.id);
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
    if (next !== this.selection) this.apply(next, true);
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

  private counts(): { readonly players: number; readonly bosses: number; readonly qiji: number } {
    return { players: this.players.length, bosses: this.bosses.length, qiji: this.qiji.length };
  }

  /** 三块各自的选项表（滚动那一撮纯函数要它 —— 见 `prepareScroll`）。 */
  private lists(): ScrollLists {
    return { players: this.players, bosses: this.bosses, qiji: this.qiji };
  }

  /**
   * 写**已经确定**的选择（Enter / 点击）。
   *
   * @param notify 要不要报 `onChange`（选择真的变了才报）。
   */
  private apply(next: PrepareSelection, notify = false): void {
    const changed =
      next.playerId !== this.selection.playerId || next.bossId !== this.selection.bossId;
    /**
     * ⚠️ **手风琴换了块就清悬停**：上一块被收起之后，鼠标可能还"停在"
     * 一张已经不在画面上的卡上 —— 留着它会让详情区显示一张看不见的卡。
     */
    const expandedChanged = next.expanded !== this.selection.expanded;
    this.selection = next;
    if (expandedChanged) this.detailPanel.clearHover();
    this.draw();
    if (notify && changed) this.options.onChange?.(next.playerId, next.bossId);
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
    /** ⚠️ 光标跟着走，**并且**把它推到看得见的地方（触屏点的是可见的卡）。 */
    this.selection = this.followCursor(pickQiji(this.selection, this.qiji, id));
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

  /**
   * 画一帧。
   *
   * ⚠️ 本类**不自己摆每一个部件**：那一段在 `prepareFrame`（一帧的装配
   * 清单，见那里的文件头）。这里只把"笔"与"当前状态"交出去 —— 于是
   * "谁能改状态"仍然只有本类一处。
   */
  private draw(): void {
    drawPrepareFrame(this.parts.frameParts, {
      players: this.players,
      bosses: this.bosses,
      qiji: this.qiji,
      selection: this.selection,
      cursor: this.cursor(),
      free: this.free,
      scroll: this.scroll,
      translate: this.options.translate,
      developing: isDeveloping,
    });
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
 * 供 `app/` 造上下文用
 * ------------------------------------------------------------------ */

export type { DetailContext };
