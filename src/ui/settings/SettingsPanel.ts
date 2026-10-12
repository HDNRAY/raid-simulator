/**
 * 设置弹窗（全 canvas）。
 *
 * 不用 DOM：架构规范要求所有 UI 走 canvas。设置界面是最容易被"顺手用
 * DOM 做"的一块，但它偏偏**交互最复杂**（改键要独占键盘、要处理冲突），
 * 所以连按键捕获都在 canvas 里做。
 * 与引擎的关系：**完全不碰引擎**，只通过回调改键位表与通用选项。
 */


import type { Container, Graphics } from 'pixi.js';
import { LOGICAL } from '../layout';
import { RebindSession } from './rebindSession';
import {
  resolveCycleFocus,
  resolveKeyDispatch,
  resolveMoveFocus,
  resolvePanelDispatch,
} from './panelDispatch';
import { runPanelClick, runPanelKey, type PanelActions } from './panelWiring';
import { HoverTracker } from './hoverTracker';
import { PanelNotice } from './panelNotice';
import { KeyGrid } from './KeyGrid';
import { TouchSlotPreview } from './TouchSlotPreview';
import { SkillDetail } from './SkillDetail';
import { SettingsFrame } from './SettingsFrame';
import { KeysFooter } from './KeysFooter';
import type { KeyRow } from './rows';
import { ScaleSlider } from './ScaleSlider';
import type { PixiCtor } from '../primitives';
import type { TranslateFn } from '../../i18n/translator';
import {
  INITIAL_FOCUS,
  keyCellRect,
  keyGridMetrics,
  uiScaleFromPointer,
  uiScaleSliderRect,
  contains,
  preferredTab,
  visibleTabs,
  type FocusContext,
  type SettingsFocus,
} from './logic';
import type { SettingsOrigin, SettingsTab } from './tabs';

export type { SettingsTab, SettingsOrigin };
export type { KeyRow } from './rows';

export interface SettingsPanelOptions {
  readonly pixi: PixiCtor;
  /**
   * ⚠️ **必须带上 `params`**。
   *
   * 这里原先写的是 `(key: string) => string` —— 于是所有拿它去满足
   * `buildKeyRows`（那边要 `(key, params?) => string`）的地方都会
   * **静默丢掉第二个参数**（TS 允许"参数更少"的函数赋值给"参数更多"的类型），
   * 界面上就显示出 `{seconds}` / `{value} {resource}` 这些占位符本身 ✗
   *
   * 类型收窄本身**不是错**，但它把"丢参数"从"显而易见的 bug"变成了
   * "编译器保证正确的写法"。宽到 `params` 才能让实现无处可躲。
   */
  readonly translate: TranslateFn;
  /** 读取当前键位表 */
  readonly getRows: () => readonly KeyRow[];
  /** 改键：把某个技能的键改成 `key` */
  readonly onRebind: (skillId: string, key: string) => void;
  /** 交换两个按钮位的技能（见 `app/bindingActions.ts` 的区别说明）。 */
  readonly onSwapSlots: (from: number, to: number) => void;
  /** 恢复默认键位 */
  readonly onResetKeys: () => void;
  /**
   * 进入/退出**捕获模式**。
   *
   * 捕获期间输入层不再把按键当技能 —— 这是必须的：否则玩家
   * 按 `Esc` 想取消改键，技能会真的放出去。
   */
  readonly onCapture: (handler: ((key: string) => void) | undefined) => void;
  /** 关闭弹窗 */
  readonly onClose: () => void;
  /**
   * 是否显示键名（需求："移动端就不用显示快捷键信息了"）。
   *
   * ⚠️ 是**函数**：它来自平台探测，而触屏控件在设置面板**之后**才
   * 创建 —— 固定值会永远是 `undefined`（键名照样画出来）。
   */
  readonly getShowKeyHints?: (() => boolean) | undefined;
  /**
   * **触屏键位表**（**下标 = 键位号**，`''` = 空键位）。**从 `GameState` 读**，
   * 不在面板里留副本 —— 与键位表同一条纪律。
   */
  readonly getTouchSlots?: (() => readonly string[]) | undefined;
  /**
   * 两步交互的落点：**把这个技能绑到那个键位**（交换 / 顶掉的判定在
   * `slotActions`，这里只管把结果写下去）。
   */
  readonly onAssignTouchSlot?: ((slot: number, skillId: string) => void) | undefined;
  /** 取下某个键位上的技能。 */
  readonly onClearTouchSlot?: ((slot: number) => void) | undefined;
  /** 「触屏默认」= 恢复默认键位表（截到容量）。 */
  readonly onResetTouchButtons?: (() => void) | undefined;
  /** 读当前 UI 缩放倍数（1 = 自动适配） */
  readonly getUiScale: () => number;
  /** UI 缩放变了（调用方负责把它应用到画布尺寸上） */
  readonly onUiScale: (value: number) => void;
}


export class SettingsPanel {
  readonly root: Container;

  private readonly dim: Graphics;

  /**
   * UI 缩放滑块。
   *
   * 抽成独立组件（需求指出原先"没有做好组件和模块化"）——
   * 第一版把两个 Label 直接建在 body 上，切 tab 时不清理，
   * 于是滑块漏到了按键页。现在**显示/隐藏由组件自己拥有**。
   */
  private readonly scaleSlider: ScaleSlider;

  /**
   * 按键页底部的**选中技能详情**（四行）。
   *
   * 需求："除了显示标签，还显示一下技能说明和代价，cd 等信息"。
   * 只为**当前焦点**那一项显示 —— 十几个格子各塞一段中文会挤成一团。
   */
  /** 选中技能的详情（独立组件，见 `SkillDetail`） */
  private readonly detail: SkillDetail;

  /** 外框：底板 + 标题 + 「关闭」 + tab 按钮（独立组件） */
  private readonly frame: SettingsFrame;

  private readonly body: Container;
  /**
   * 按键页的技能格（独立组件，见 `KeyGrid` 的说明）。
   *
   * 原先格子的构造与绘制直接写在这里 —— "面板顺手把格子也画了"。
   */
  private readonly keyGrid: KeyGrid;
  /**
   * 右下角的**模拟键位**（触屏键位配置，独立组件）。
   *
   * ⚠️ 它**拥有"当前选中哪个键位"**这份状态（`preview.selected`）——
   * 面板不另存一份，否则就会出现"预览高亮的和实际绑定用的不是同一个键位"。
   */
  private readonly preview: TouchSlotPreview;
  /**
   * 底部：提示行 + 「恢复默认」按钮（独立组件）。
   *
   * ⚠️ 恢复按钮原先**借用格子的 `rowGfx`**（两者共用一个 Graphics）
   * —— 那是"顺手画上去"，格子抽走后就断了。现在归它自己管。
   */
  private readonly footer: KeysFooter;

  private tab: SettingsTab = 'keys';
  /**
   * **从哪打开的** —— 决定哪几页可见（首页没有「按键」页）。
   *
   * ⚠️ 取自 `open(tab, origin)` 的参数，而这个参数由
   * `settingsToggle` 从**相位**算出来（`app/phaseLogic.settingsOriginOf`）。
   * 面板自己**不许**去读相位：那样"哪些页可见"就会有两份判据。
   */
  private origin: SettingsOrigin = 'gameplay';
  /**
   * 键盘焦点游标。
   *
   * 需求："几乎支持键盘操作，包括设置弹窗里的一切"。所以弹窗里
   * **没有只能点鼠标的地方** —— tab、每个技能格、恢复默认按钮
   * 都在这个线性游标上。
   */
  private focus: SettingsFocus = INITIAL_FOCUS;
  private visible = false;
  /**
   * **改键会话**（等按键 → 收尾 → 写回）。
   *
   * ⚠️ 整块搬到了 `./rebindSession`（这个文件又顶到 700 行上限，
   * 按 AGENTS.md §3 做**横向切割**：那是"改键会话"自己的关注点，
   * 与"面板怎么画、焦点在谁身上"没有交集）。面板只转发。
   */
  private readonly rebind: RebindSession;
  /**
   * 悬停 → 焦点的**去重**（"光标停着不动时方向键还走得动"）。
   *
   * ⚠️ 判定整块在 `./hoverTracker`（这个文件又顶到 700 行上限，按
   * "拆 util"切出去）—— 面板只负责把结果套到焦点上。
   */
  private readonly hover = new HoverTracker();
  /**
   * 底部提示（"已恢复默认键位"这类）—— 自带"过一会儿消失"的生命周期，
   * 所以整块在 `./panelNotice`（这个文件顶到 700 行上限）。
   */
  private readonly notice = new PanelNotice();

  constructor(private readonly options: SettingsPanelOptions) {
    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    this.dim = new pixi.Graphics();
    this.dim.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: 0x000000, alpha: 0.66 });
    this.root.addChild(this.dim);

    this.frame = new SettingsFrame(pixi, (key, params) => this.options.translate(key, params));
    this.root.addChild(this.frame.root);

    /* ---- 内容区 ---- */
    this.body = new pixi.Container();
    this.root.addChild(this.body);

    this.keyGrid = new KeyGrid(pixi, (key, params) => this.options.translate(key, params));
    this.body.addChild(this.keyGrid.root);

    this.footer = new KeysFooter(
      pixi,
      (key, params) => this.options.translate(key, params),
      () => this.notice.text,
    );
    this.body.addChild(this.footer.root);

    this.preview = new TouchSlotPreview(pixi, options.translate);
    this.body.addChild(this.preview.root);

    this.rebind = new RebindSession({
      translate: options.translate,
      onCapture: options.onCapture,
      onRebind: options.onRebind,
      rows: () => this.options.getRows(),
      notice: (text) => this.notice.set(text),
      redraw: () => this.redraw(),
      trace: (line) => this.pushTrace(line),
    });

    /* ---------- 通用页：UI 缩放滑块 ---------- */
    this.detail = new SkillDetail(pixi, (key, params) => this.options.translate(key, params));
    this.body.addChild(this.detail.root);

    this.scaleSlider = new ScaleSlider({
      pixi,
      translate: options.translate,
      get: options.getUiScale,
      set: options.onUiScale,
    });
    this.body.addChild(this.scaleSlider.root);

    this.drawFrame();
  }

  /** 当前 tab 有没有 UI 缩放 slider（只有通用页有）。 */
  private hasSlider(): boolean {
    return this.tab === 'general';
  }

  /** 当前 tab 有没有技能格（只有「按键」页有）。 */
  private hasGrid(): boolean {
    return this.tab !== 'general';
  }

  /**
   * **这个来源下可见的 tab**（首页只有「通用」）。
   *
   * ⚠️ 唯一真相在 `ui/settings/tabs.visibleTabs`：面板、命中测试、
   * 外框渲染、助记键**都读这一处**，没有人再写一遍
   * `origin === 'home'`。
   */
  private get tabs(): readonly SettingsTab[] {
    return visibleTabs(this.origin);
  }

  /** 触屏键位表（下标 = 键位号，`''` = 空）。 */
  private touchSlots(): readonly string[] {
    return this.options.getTouchSlots?.() ?? [];
  }

  /**
   * 焦点模型要的"这一页有什么"。
   *
   * ⚠️ 只在这里算一次并喂给 `moveFocus` / `cycleZone` —— 焦点模型不认识
   * tab 的语义（见 `focus.FocusContext`），判断留在这一处。
   */
  private focusContext(): FocusContext {
    return {
      tabCount: this.tabs.length,
      cellCount: this.options.getRows().length,
      hasGrid: this.hasGrid(),
      hasSlider: this.hasSlider(),
      hasSlots: this.hasGrid(),
      hasTouchReset: this.hasGrid(),
      slotIndex: this.preview.selected ?? 0,
    };
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** 按键轨迹（环形缓冲，供调试探针读取）。
   *
   * 保留它是因为"按键没生效"这类问题**只能靠事件序列定位** ——
   * 我这次排查"一次 Enter 同时进入改键并完成绑定"就是靠它，
   * 日志一眼看出 `startCapture` 之后紧跟 `finishCapture(enter)`。
   * 截图和单元测试都看不到这个层面的信息。
   */
  readonly settingsTrace: string[] = [];

  /** 记一行轨迹（环形缓冲，最多 40 行）。 */
  private pushTrace(line: string): void {
    this.settingsTrace.push(line);
    if (this.settingsTrace.length > 40) this.settingsTrace.shift();
  }

  /** 正在等待按键的技能 id（调试探针用）。 */
  get capturingSkillId(): string | undefined {
    return this.rebind.skillId;
  }

  /** 当前键盘焦点（调试探针用）。 */
  get focusState(): SettingsFocus {
    return this.focus;
  }

  /**
   * 第 `index` 个技能格的圆心（逻辑坐标）—— 验证脚本注入真实点击用。
   *
   * ⚠️ 走的是**渲染/命中同一份度量**（`keyGridMetrics(showKeyHintsNow)`），
   * 不是另算一份。见 `debugApi.SettingsDebugTarget.cellCenter` 的说明。
   */
  cellCenter(index: number): { readonly x: number; readonly y: number } {
    const rect = keyCellRect(index, keyGridMetrics(this.showKeyHintsNow));
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  /** 第 `index` 个**键位**的圆心（键位预览自己的几何，越界返回 `undefined`）。 */
  slotCenter(index: number): { readonly x: number; readonly y: number } | undefined {
    return this.preview.centerOf(index);
  }


  /**
   * 打开面板。
   *
   * @param tab 想打开的页（这个来源下不可见时**退到第一页**）
   * @param origin **从哪打开的**（首页没有「按键」页）——
   *   由 `settingsToggle` 从相位算出来（`app/phaseLogic.settingsOriginOf`）。
   */
  open(tab: SettingsTab = 'keys', origin: SettingsOrigin = 'gameplay'): void {
    this.origin = origin;
    this.visible = true;
    this.root.visible = true;
    /**
     * ⚠️ 落到 `preferredTab` 上：请求「按键」页但从首页打开时必须退到
     * 「通用」—— 否则会出现"选中了一个画不出来的 tab"（内容空白）。
     */
    this.setTab(preferredTab(origin, tab));
  }

  close(): void {
    this.resetTransientState();
    this.visible = false;
    this.root.visible = false;
  }

  setTab(tab: SettingsTab): void {
    /**
     * ⚠️ 挡住**这个来源下不可见**的页（助记键、`switchTab` 都可能传进来）。
     * 退到第一页而不是照单全收 —— 否则内容区会停在一个不属于当前集合的页上。
     */
    this.tab = preferredTab(this.origin, tab);
    this.resetTransientState();
    this.notice.clear();
    /**
     * ⚠️ **焦点不能停在这一页没有的区域上**：从首页打开的设置只剩
     * 「通用」页（没有技能格、没有键位区），而 `INITIAL_FOCUS` 是
     * "第一个技能格" —— 不挪走的话，在首页按 `Enter` 会对一个**看不见的**
     * 技能开始改键（界面像死了）。
     */
    if (!this.hasGrid() && (this.focus.zone === 'grid' || this.focus.zone === 'slots')) {
      this.focus = this.hasSlider() ? { zone: 'slider' } : { zone: 'tabs', index: 0 };
    }
    this.redraw();
  }

  /**
   * 当前是否显示键名（决定网格度量）。
   * ⚠️ 命中测试与渲染必须用同一个值，否则可点区与画出的位置错开。
   */
  private get showKeyHintsNow(): boolean {
    return this.options.getShowKeyHints?.() !== false;
  }

  /**
   * 点一下某个位置。**决策与执行**都在 `./panelDispatch`（纯函数，可单测），
   * 这里只把面板的各个能力接进去。
   *
   * @returns 是否消费了这次点击
   */
  hitTest(px: number, py: number): boolean {
    if (!this.visible) return false;

    const action = resolvePanelDispatch({
      visible: this.visible,
      tab: this.tab,
      tabs: this.tabs,
      px,
      py,
      rowSkillIds: this.options.getRows().map((r) => r.skillId),
      slotSkillIds: this.touchSlots(),
      selectedSlot: this.preview.selected,
      focus: this.focus,
      capturingSkillId: this.rebind.skillId,
      showKeyHints: this.showKeyHintsNow,
    });

    return runPanelClick(action, this.panelActions());
  }

  /**
   * 面板对外的**动作面**（点击与按键共用，见 `./panelWiring`）。
   *
   * ⚠️ 一处实现、两处接线：原先 `hitTest` 与 `handleKey` 各写一份绑定，
   * 字段名还对不上（`toggleTouch` vs `rebind`）—— 那种"两份接线"
   * 漏一个字段的表现是**某个入口静默失效**。
   *
   * ⚠️ 每次调用新建一个对象：它只是把"面板现在能做什么"交给纯决策层，
   * 不持有状态（真的状态在 `focus` / `preview` / `rebind` 里）。
   */
  private panelActions(): PanelActions {
    return {
      close: () => this.options.onClose(),
      switchTab: (tab) => this.setTab(tab),
      resetKeys: () => this.options.onResetKeys(),
      /** ⚠️ 「触屏默认」是**另一个按钮**（见 `resolvePanelDispatch`）。 */
      resetTouch: () => this.options.onResetTouchButtons?.(),
      notice: (text) => this.notice.set(this.options.translate(text)),
      rebind: (skillId, key) => this.options.onRebind(skillId, key),
      swapSlots: (from, to) => {
        this.rebind.stop();
        this.options.onSwapSlots(from, to);
      },
      focusSkill: (skillId) => this.setFocusToSkill(skillId),
      startCapture: (skillId, triggerKey) => this.rebind.begin(skillId, triggerKey),
      stopCapture: () => this.rebind.stop(),
      finishCapture: (key) => this.rebind.handleKey(key),
      selectSlot: (index) => this.selectSlot(index),
      deselectSlot: () => this.preview.deselect(),
      assignTouchSlot: (slot, skillId) => this.options.onAssignTouchSlot?.(slot, skillId),
      clearTouchSlot: (slot) => this.options.onClearTouchSlot?.(slot),
      moveFocus: (direction) =>
        resolveMoveFocus({ focus: this.focus, direction, ctx: this.focusContext() }),
      cycleFocus: (back) =>
        resolveCycleFocus({ focus: this.focus, ctx: this.focusContext(), back }),
      nudgeSlider: (direction) => this.scaleSlider.nudge(direction),
      uiScale: (value) => this.options.onUiScale(value),
      redraw: () => this.redraw(),
    };
  }

  /**
   * 选中某个技能（合并鼠标与键盘的"选中"语义）。
   *
   * 只移动焦点并重画 —— **不**进入改键。改键统一由 `Enter` 触发
   * （见 `activateFocus`），于是"选中"与"改键"是两个清晰的动作。
   */
  setFocusToSkill(skillId: string): void {
    const index = this.options.getRows().findIndex((r) => r.skillId === skillId);
    if (index < 0) return;
    this.setFocus({ zone: 'grid', index });
  }

  /**
   * 选中某个**键位**（右下角模拟键位）—— 与 `setFocusToSkill` 对称。
   *
   * ⚠️ 焦点也跟着移进键位区：这样"点了一下键位"之后按方向键，
   * 走的是键位之间（而不是从技能格开始），与键盘进来时一致。
   */
  private selectSlot(index: number): void {
    this.preview.select(index);
    this.setFocus({ zone: 'slots', index });
  }

  /**
   * 鼠标悬停到某个技能格上 —— 与方向键选中是**同一件事**。
   *
   * 需求要求合并这两者；悬停也走同一条路径，所以"鼠标划过"与
   * "方向键移动"看到的是同一个高亮、同一份详情。
   *
   * ⚠️ 去重（"同一格的重复 hover 忽略"）在 `./hoverTracker` ——
   * 那段语义踩过坑（方向键刚移走焦点就被拽回来），所以它有自己的注释与测试。
   */
  hoverSkill(px: number, py: number): void {
    if (!this.visible || this.tab !== 'keys') return;
    const skillId = this.hover.skillAt(px, py, {
      tab: this.tab,
      tabs: this.tabs,
      rows: this.options.getRows(),
      showKeyHints: this.showKeyHintsNow,
    });
    if (skillId !== undefined) this.setFocusToSkill(skillId);
  }

  /** 设焦点并重画（统一入口，保证焦点变化一定会重绘）。 */
  private setFocus(next: SettingsFocus): void {
    /**
     * ⚠️ 带下标的两个区（`grid` / `slots`）要比较下标 —— 只比 `zone` 的话
     * "在第 5 个键位上点第 2 个"会被当成没变、**不重画**。
     */
    const indexOf = (f: SettingsFocus): number =>
      f.zone === 'grid' || f.zone === 'slots' ? f.index : -1;
    const same = next.zone === this.focus.zone && indexOf(next) === indexOf(this.focus);
    if (same) return;
    this.focus = next;
    this.redraw();
  }

  /** 某个逻辑坐标是否落在通用页的滑块上（拖动拖拽用）。 */
  isOnScaleSlider(px: number, py: number): boolean {
    return this.visible && this.tab === 'general' && contains(uiScaleSliderRect(), px, py);
  }

  /** 拖拽滑块到某个横坐标（由主循环在 pointermove 时调用）。 */
  dragScaleSlider(px: number): void {
    if (this.tab !== 'general') return;
    this.options.onUiScale(uiScaleFromPointer(px));
    this.redraw();
  }

  /**
   * 键盘输入（弹窗打开时由主循环转发过来）。
   *
   * **决策与执行**都在 `./panelDispatch`（纯函数，可单测）；这里只把面板的
   * 各个能力接进去，并套用"焦点变了 / 要调滑块"这两个结果。
   *
   * @returns 是否消费了这次按键
   */
  handleKey(key: string): boolean {
    if (!this.visible) return false;

    const rows = this.options.getRows();
    const dispatch = resolveKeyDispatch({
      visible: this.visible,
      key,
      capturingSkillId: this.rebind.skillId,
      focus: this.focus,
      rowSkillIds: rows.map((r) => r.skillId),
      tabs: this.tabs,
      slotSkillIds: this.touchSlots(),
      /**
       * ⚠️ **选中了键位时，技能格上的 `Enter` 是"绑到这个键位"**，
       * 没选中时才是改键 —— 判定在 `focus.resolveActivate`（与鼠标同一份）。
       */
      selectedSlot: this.preview.selected,
    });
    this.pushTrace(dispatch.trace);

    const result = runPanelKey(
      { action: dispatch.action, activate: dispatch.activate, key },
      this.panelActions(),
    );

    if (result.focus !== undefined) {
      this.focus = result.focus;
      /**
       * ⚠️ **键盘走到键位区 = 选中那个键位**（与"点一下键位"同一件事）。
       *
       * 不这么做的话，方向键移进键位区之后还得再按一次 `Enter` 才生效，
       * 而提示写的是"点键位 → 点技能" —— 键盘那条路就多了一步、
       * 也就是 §3b 说的"功能不对等"。
       * `Enter` 在这里的语义只剩"**取消选中**"（见 `focus.resolveActivate`）。
       */
      if (result.focus.zone === 'slots') this.preview.select(result.focus.index);
    }
    if (result.nudgeSlider !== undefined) this.scaleSlider.nudge(result.nudgeSlider);
    /**
     * ⚠️ `redraw === false` 时**不要重画** —— 那是 `ignore`（什么都没改）。
     * 按住一个与设置无关的键会连续打到这里（`settingsKeys` 不过滤
     * `event.repeat`），无条件重画等于按按键重复率重绘整个面板。
     * 详见 `KeyExecutionResult.redraw` 的说明。
     */
    if (result.redraw !== false) this.redraw();
    return result.consumed;
  }

  /** 停捕获 + 取消选中键位（切页 / 关面板时统一走它）。 */
  private resetTransientState(): void {
    this.rebind.stop();
    this.preview.deselect();
  }

  /** 每帧调用：提示的倒计时（到点自己消失，见 `PanelNotice`）。 */
  update(): void {
    if (this.notice.tick()) this.redraw();
  }

  private redraw(): void {
    this.drawFrame();
    this.drawBody();
  }

  /**
   * 画选中技能的详情：名字 / 标签 / 说明 / 代价·冷却。
   *
   * ⚠️ 只在焦点落在技能格上时调用（见调用处的说明）。
   */
  /** 画选中技能的详情（实现见 `SkillDetail`）。 */
  private drawDetail(row: KeyRow): void {
    this.detail.render(row);
  }

  /** 画外框（实现见 `SettingsFrame`）。 */
  private drawFrame(): void {
    const tabFocus = this.focus.zone === 'tabs' ? this.focus.index : -1;
    /** ⚠️ 可见的 tab 表一路传进渲染层 —— 首页时「按键」页整个不画。 */
    this.frame.update(this.tabs, this.tab, this.focus.zone, tabFocus, this.showKeyHintsNow);
  }

  private drawBody(): void {
    this.keyGrid.setVisible(this.tab !== 'general');
    /** 通用页的滑块 / 详情 / 键位预览都在此隐藏 —— 这里只写隐藏，
     * 通用页分支只写显示。 */
    this.scaleSlider.setVisible(false);
    this.preview.setVisible(false);
    this.detail.clear();

    if (this.tab === 'general') {
      // 通用 tab 目前是空的 —— 明确写出来，而不是给一片空白
      // 通用页没有"恢复默认键位"，那一栏留空（它属于按键页）
      this.footer.showGeneralHint(this.showKeyHintsNow);
      /**
       * 通用页的控件：**显示** + 重画。
       *
       * ⚠️ 这里只负责"现在是通用页"；**隐藏由下面那行统一处理** ——
       * 两处都写 hide 就会漏（第一版就是这样漏到按键页的）。
       */
      this.scaleSlider.setVisible(true);
      this.scaleSlider.setFocused(this.focus.zone === 'slider');
      this.scaleSlider.redraw();
      return;
    }

    /* ---- 「按键」页：键盘键位 + 右下角的触屏键位 ---- */
    const rows = this.options.getRows();
    const slots = this.touchSlots();

    /**
     * 格子交给组件画。
     *
     * ⚠️ 详情区由**格子驱动**（`onFocused` 回调）：焦点在哪一格就显示
     * 哪个技能。这样"画格子"与"显示谁"只有一个真相来源，
     * 不会再出现"点完格子、详情还停在上一个技能"。
     *
     * ⚠️ 还要喂一份**触屏键位表**：格子上那个小号（"第几个键位"）
     * 与右下角的预览是同一份数据的两个视图。
     */
    this.keyGrid.update(
      rows,
      {
        focusIndex: this.focus.zone === 'grid' ? this.focus.index : -1,
        capturingSkillId: this.rebind.skillId,
        showKeyHints: this.showKeyHintsNow,
        slotSkillIds: slots,
      },
      (row) => this.drawDetail(row),
    );

    /**
     * 右下角的**模拟键位**：显示 + 刷新。
     *
     * 技能名从**行数据**里取（那一份已经是 i18n 之后的 nameKey），
     * 与技能格显示的是同一个来源 —— 不会出现"格子里是「斩」、
     * 键位上写成别的字"。
     */
    const nameOf = (skillId: string): string => {
      const row = rows.find((r) => r.skillId === skillId);
      return row === undefined ? '' : this.options.translate(row.nameKey);
    };
    this.preview.setVisible(true);
    this.preview.update(
      slots,
      nameOf,
      this.focus.zone === 'slots' ? this.focus.index : undefined,
    );

    this.footer.updateKeys({
      capturing: this.rebind.skillId !== undefined,
      resetFocused: this.focus.zone === 'reset',
      touchResetFocused: this.focus.zone === 'touchReset',
      showKeyHints: this.showKeyHintsNow,
      selectedSlot: this.preview.selected,
    });
  }

  /** 空 tab 的占位：一行主文案 + 一行提示，避免一片空白让人以为坏了。 */
}
