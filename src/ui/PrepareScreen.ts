/**
 * **自由模式（备战屏）**：选人物 →（开炁机）→ 选对手 → 开始战斗。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏的**输入层**：按键 / 指针进来，它改状态，然后把状态交给
 * `prepareFrame` 去画。
 *
 * ⚠️ 本文件**只是装配** —— 每一件事都只有一个家，这里不再抄一遍：
 *
 * | 那一件事 | 家 |
 * |---|---|
 * | 这一屏长什么样（矩形 / 网格 / 视口 / 滚动条在哪） | `prepareLayout` + `prepareCardGrid` |
 * | 光标 / 选择 / 焦点怎么走（含块内 ← → ↑ ↓ 的网格数学） | `prepareLogic` + `gridNav` |
 * | 滚动怎么算（谁滚、滚多少、光标跟随） | `prepareScroll` + `scrollWindow` |
 * | "点了什么"（按钮 / 块头 / 炁机卡 / 卡片） | `prepareLogic.pointerIntentOf` |
 * | 皮肤（颜色 / 线宽） | `prepareRender` |
 * | 详情区（内容模型 / 画 / 它自己的滚动） | `prepareDetail` + `prepareDetailMetrics` + `prepareDetailPanel` |
 * | 收起那块显示什么 | `prepareFold` + `prepareFoldBars` |
 * | 页脚（开始键 / 提示行 / 声明） | `prepareFooter` |
 * | **按键怎么路由到这一屏**（哪个键调哪个方法） | `app/loopWiring.ts`（那里有唯一的键位表） |
 *
 * ==================================================================
 * ⚠️ 2026-10-13 第三轮：**方向键只管块内，Tab 才跨块**
 * ==================================================================
 *
 * 用户原话："**炁机内部无法用方向键选择，所以把人物 炁机 对手的切换换成
 * tab**"。
 *
 * | 动作 | 键盘 | 触屏 / 鼠标 |
 * |---|---|---|
 * | 块**内**走光标 | ← → ↑ ↓（二维网格，到边界停住） | 点卡片（移光标 + 确定） |
 * | 块**间**切换 | **Tab / Shift+Tab**（环绕） | **点块头**（`expand`） |
 * | 确定人物 / 对手 | Enter | 点卡片 |
 * | 炁机开 / 关 | Enter | 点卡片（**整张卡，任意位置**） |
 * | 看详情 | 移动焦点 | **点一下**（触屏没有 hover） |
 * | 开战 | Enter（光标在「开始」上） | 点「开始战斗」 |
 *
 * ⚠️ 旧版 ↑ ↓ 是"换块"，而炁机摊成两行之后**第二行永远选不到**（← → 到
 * 行尾又不环绕）—— 规则与根因写在 `prepareLogic.stepCursor` 与
 * `prepareLogic.moveFocus` 的文件说明里，键位表在 `loopWiring`。
 *
 * ==================================================================
 * ⚠️ 手风琴：**焦点在哪一块，就展开哪一块**
 * ==================================================================
 *
 * | 输入 | 行为 |
 * |---|---|
 * | 键盘 `Tab` 移到收起的那一块 | **立刻展开它**（一步，不用先按 Enter） |
 * | 点 / 点触收起那块「块头」 | 展开它（**不改选择**） |
 * | **鼠标划过**块头 | **不展开** |
 *
 * ⚠️ **为什么不给块头做 hover 展开**：这一屏的鼠标划过卡片时详情区会跟着
 * 切（"hover 优先"），若 hover 也展开手风琴，那么"从卡片划到另一块"的
 * 路上会连续展开/收起两次，整屏跟着重排 —— 玩家看到的是一屏在抖。所以
 * **展开只由"焦点"决定**（键盘 / 点击），hover 只管详情区。
 *
 * ⚠️ **为什么是"自动展开"而不是"按 Enter 才展开"**：进界面后玩家的第一
 * 个动作可能是 `Tab` 换块，而"焦点在一块收起的块上、画面上却没有光标"正是
 * 本仓库点名过的那种"以为按键坏了"。触屏对等也靠同一条：点块头就是
 * 一次操作展开它（不需要"选中 → 确认"两步）。
 *
 * ⚠️ 收起的那两块里**卡片点不到**（命中区只有展开那一块的卡）—— 于是详情区
 * 恒等于"当前展开那一块里"的那一项。用户明确允许这个判断："若不能 →
 * 详情区就只显示当前展开那块里的东西，但要说明"。
 *
 * ⚠️ 每帧只改字符串与可见性，**不重建** Text / Graphics（见 `prepareFrame`）。
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
  expandSection,
  focusTarget,
  initialSelection,
  isQijiOn,
  moveFocus,
  pickOption,
  pickQiji,
  pointerIntentOf,
  stepCursor,
  toggleQiji,
  type FreeQiji,
  type PreparePointerIntent,
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
    this.free = options.freeQiji ?? [];
    this.selection = initialSelection(options.initial, this.qiji);

    /**
     * ⚠️ 取值函数是**活闭包**（读 `this.free`），而不是一份值：激活状态
     * 每点一下就变，传值会让详情区显示上一帧的开关态。
     */
    this.parts = buildPrepareParts({
      options,
      selection: this.selection,
      counts: this.counts(),
      on: (id) => isQijiOn(this.free, id),
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

  /** 当前开着的炁机（激活集合）—— 调试探针与存档读它。 */
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

  /**
   * **三块各自的滚动偏移**（只读探针）。
   *
   * ⚠️ 它存在的理由与 `hitAreas()` / `detailModel()` 同源：**滚动位置在
   * 截图上看不出来**（"排满"与"滚到第二行"各一张图，但"偏移是 0 还是 46"
   * 只有读数能钉死）。滚轮 / 拖拽 / 光标跟随三条路都会改它，所以
   * "这一次输入到底有没有让它动"要能读出来。
   */
  scrollOffsets(): SectionScroll {
    return this.scroll;
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

  /** **Shift + ↑ ↓**：滚详情区正文（不切焦点、不动光标 —— 见 `prepareDetailController.scrollStep`）。 */
  scrollDetail(dir: 'up' | 'down'): void {
    this.detailPanel.scrollStep(dir);
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
   * ⚠️ 光标在**炁机**上时它做的是"开 / 关"（见 `toggleQiji`），
   * 而不是"确定选择" —— 炁机是可反复开关的集合，没有"选定的那一个"。
   */
  confirm(): void {
    const at = this.cursor();
    if (at !== undefined && at.kind === 'qiji') {
      this.applyQiji(at.id);
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
    if (this.free.length === 0) return;
    this.free = [];
    this.options.onQijiChange?.(this.free);
    this.draw();
  }

  /* ---------------------------------------------------------------- *
   * 指针
   * ---------------------------------------------------------------- */

  /**
   * 这个点上的点击是什么意思（`pointerIntentOf` 的**唯一**调用点）。
   *
   * ⚠️ 抽出来是为了不让那个 7 参数的调用出现两遍（参数写反一次就是
   * "点到别的卡上"，而那种 bug 截图看不出来）。判定规则见 `prepareLogic`。
   */
  private intentAt(px: number, py: number): PreparePointerIntent {
    return pointerIntentOf(
      px,
      py,
      this.players,
      this.bosses,
      this.qiji,
      this.selection.expanded,
      this.scroll,
    );
  }

  /**
   * **悬停**（鼠标）。只影响详情区，**不动光标、也不展开手风琴**（见文件头）。
   *
   * @returns 悬停落在某一项上（供调用方判"要不要重画"）。
   */
  hover(px: number, py: number): boolean {
    const intent = this.intentAt(px, py);
    /**
     * ⚠️ 只有"点在**一张卡**上"才更新悬停：「开始战斗」「块头」「没点中」
     * 都不是一张卡 —— 把详情区切到它们身上会让玩家"划一下鼠标，面板空了"。
     */
    /** 2026-10-22：**hover 就是"选中"**（判据同 `ui/selection`）—— 指针落在哪张卡上，光标就移到那张卡（白框跟着走、只有一个框 ✓）；落在空白上什么都不改 ✓。 */
    if (intent.kind === 'qiji') {
      this.apply(pickQiji(this.selection, this.qiji, intent.id));
    } else if (intent.kind === 'pick') {
      this.apply(pickOption(this.selection, this.players, this.bosses, intent.option, intent.id));
    }
    return intent.kind !== 'none';
  }

  /**
   * 指针离开画布：**什么都不做**（2026-10-22 之后 hover 就是选中 ⇒ 选中项
   * 由光标持有，指针移开不该让框消失、也不该让详情闪一下 ✗）。
   *
   * 保留这个方法是因为 `canvasInput` 的指针路由会调它（`pointerleave` 与
   * `pointercancel` 都要当成"离开"）—— 未来若真需要在离开时做事，落点在这。
   */
  clearHover(): void {
    /* 有意为空：见上面那段说明。 */
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
   * 把某一块**滚动 `delta` 像素**（正数 = 往下看更多）；钳位在
   * `prepareScroll.scrolledBy`（那里是唯一的边界规则）。
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
   * ⚠️ 规则（判据是"行"、爆出视口才滚、上收下跟）写在
   * `prepareScroll.followedCursor` —— 这里只把它的产物换上去。
   */
  private scrollToShowCursor(sel: PrepareSelection): void {
    const next = followedCursor(sel, this.lists(), this.counts(), this.scroll);
    if (next !== undefined) this.scroll = next;
  }

  /**
   * 点一下（逻辑坐标）。
   *
   * ⚠️ **"点了什么"由 `prepareLogic.pointerIntentOf` 判**（纯函数、有单测：
   * 按钮 → 块头 → 炁机卡 → 人物/对手的确定）。这里只负责"照着改
   * 状态" —— 于是"谁能改状态"仍然只有本类一处，而判定不再只能靠截图验。
   *
   * ⚠️ 齿轮 / 返回箭头**先于**卡片（顺序即优先级）。
   *
   * @returns 是否消费了这次点击
   */
  hitTest(px: number, py: number): boolean {
    if (this.chrome.hitTest(px, py)) return true;
    const intent = this.intentAt(px, py);
    switch (intent.kind) {
      case 'none':
        return false;
      case 'start':
        this.start();
        return true;
      case 'expand':
        this.expand(intent.slot);
        return true;
      case 'qiji':
        /**
         * ⚠️ **整张卡一个含义 = 开 / 关**（判定在 `pointerIntentOf` 里）：
         * 哪一半都一样，所以触屏与键盘走的是同一条规则（AGENTS.md §3b）。
         * 上一版按左/右半边分成"退一层 / 加一层"，0 层时点左半什么都不做
         * —— 那正是用户报的"点了能选中但不能激活"（见 `ui/freeQiji.ts`）。
         */
        this.applyQiji(intent.id);
        return true;
      case 'pick': {
        const next = pickOption(this.selection, this.players, this.bosses, intent.option, intent.id);
        if (next !== this.selection) this.apply(this.followCursor(next), true);
        /**
         * ⚠️ **点一下也要更新详情**（触屏没有 hover，这是它唯一的路）：
         * `pickOption` 已经把光标移到那一项上，所以详情自然跟着换 ——
         * 这里只需要在"点的是同一张卡"（`next === this.selection`）时
         * 也刷一次详情。
         */
        else this.draw();
        return true;
      }
    }
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
   * 炁机**开 / 关**，并把光标移到它上面。
   *
   * ⚠️ 光标一定要移过去：不加这一句，触屏点一张卡之后**光标还停在别处**，
   * 于是"点一下看详情"这条触屏唯一的路就没有了。
   */
  private applyQiji(id: string): void {
    const def = this.qijiById(id);
    if (def === undefined) return;
    /** ⚠️ 光标跟着走，**并且**把它推到看得见的地方（触屏点的是可见的卡）。 */
    this.selection = this.followCursor(pickQiji(this.selection, this.qiji, id));
    const next = toggleQiji(this.free, id);
    if (next !== this.free) {
      this.free = next;
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
