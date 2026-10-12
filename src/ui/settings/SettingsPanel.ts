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
import { resolveKeyDispatch, resolvePanelDispatch } from './panelDispatch';
import { runPanelClick, runPanelKey, type PanelActions } from './panelWiring';
import { drawBody } from './settingsBody';
import { buildPanelActions } from './panelActions';
import {
  dragScaleSlider,
  isOnDetail,
  isOnScaleSlider,
  wheelDetail,
  type PointerTargets,
} from './panelInput';
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
   * 这台设备**是不是触屏**（`render/platform` 的能力探测，**不看 UA**）。
   *
   * ⚠️ 与 `getShowKeyHints` **分开**：两者今天反相关，但语义不同 ——
   * 这个字段只回答"底部那个唯一的「恢复默认」恢复谁"
   * （用户 2026-10-12："同一时间显示一个按钮……根据当前是否是触屏"）。
   *
   * ⚠️ 同样是**函数**：能力值由 `touchCapsSource` 在触屏层构造后回填，
   * 固定值会永远读到占位。
   */
  readonly getTouchCapable?: (() => boolean) | undefined;
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
   * 按键页底部的**选中技能详情**（名字 / 标签 / 说明 / 代价·冷却）。
   *
   * 需求："除了显示标签，还显示一下技能说明和代价，cd 等信息"。
   * 只为**当前焦点**那一项显示 —— 十几个格子各塞一段中文会挤成一团。
   * 实现在 `SkillDetail`（含这一轮加的**换行 + 滚动**）。
   */
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
  private get hasSlider(): boolean {
    return this.tab === 'general';
  }

  /** 当前 tab 有没有技能格（只有「按键」页有）。 */
  private get hasGrid(): boolean {
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
      hasGrid: this.hasGrid,
      hasSlider: this.hasSlider,
      hasSlots: this.hasGrid,
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
   * 技能详情区的滚动状态（调试探针用）。
   *
   * ⚠️ 存在的理由与 `settingsTrace` 一样：**"滚了没有"看不出来** ——
   * 滚动前后各拍一张图只能证明"内容位置不同"，证明不了"是谁动的、
   * 还能不能继续滚"。验证脚本读它做前后对比。
   */
  detailScroll(): {
    readonly offset: number;
    readonly total: number;
    readonly rows: number;
    readonly lines: readonly number[];
  } {
    return this.detail.scrollState();
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
    if (!this.hasGrid && (this.focus.zone === 'grid' || this.focus.zone === 'slots')) {
      this.focus = this.hasSlider ? { zone: 'slider' } : { zone: 'tabs', index: 0 };
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
      touch: this.touchCapable(),
    });

    return runPanelClick(action, this.panelActions());
  }

  /** 面板对外的**动作面**（点击与按键共用）—— 实现见 `./panelActions`。 */
  private panelActions(): PanelActions {
    return buildPanelActions({
      close: () => this.options.onClose(),
      switchTab: (tab) => this.setTab(tab),
      resetKeys: () => this.options.onResetKeys(),
      resetTouch: () => this.options.onResetTouchButtons?.(),
      touch: () => this.touchCapable(),
      notice: (text) => this.notice.set(this.options.translate(text)),
      rebind: (skillId, key) => this.options.onRebind(skillId, key),
      swapSlots: (from, to) => this.options.onSwapSlots(from, to),
      stopCapture: () => this.rebind.stop(),
      focusSkill: (skillId) => this.setFocusToSkill(skillId),
      startCapture: (skillId, triggerKey) => this.rebind.begin(skillId, triggerKey),
      finishCapture: (key) => this.rebind.handleKey(key),
      selectSlot: (index) => this.selectSlot(index),
      deselectSlot: () => this.preview.deselect(),
      assignTouchSlot: (slot, skillId) => this.options.onAssignTouchSlot?.(slot, skillId),
      clearTouchSlot: (slot) => this.options.onClearTouchSlot?.(slot),
      nudgeSlider: (direction) => this.scaleSlider.nudge(direction),
      uiScale: (value) => this.options.onUiScale(value),
      redraw: () => this.redraw(),
      focus: () => this.focus,
      rows: () => this.options.getRows(),
      focusContext: () => this.focusContext(),
      selectedSlot: () => this.preview.selected,
    });
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

  /** 指针输入要读/改的那点状态（转发给 `./panelInput`，见那里的说明）。 */
  private pointerTargets(): PointerTargets {
    return {
      visible: this.visible,
      tab: this.tab,
      setUiScale: (value) => this.options.onUiScale(value),
      redraw: () => this.redraw(),
      wheelDetail: (deltaY, deltaMode) => this.detail.wheel(deltaY, deltaMode),
    };
  }

  /** 逻辑坐标是否落在通用页的滑块上（`canvasInput` 用它决定开始拖拽）。 */
  isOnScaleSlider(px: number, py: number): boolean {
    return isOnScaleSlider(this.pointerTargets(), px, py);
  }

  /** 逻辑坐标是否落在**技能详情区**上（`canvasInput` 用它决定拖拽滚动）。 */
  isOnDetail(px: number, py: number): boolean {
    return isOnDetail(this.pointerTargets(), px, py);
  }

  /** 详情区滚轮；**滚得动才算消费**（调用方据此 `preventDefault`）。 */
  wheelDetail(px: number, py: number, deltaY: number, deltaMode: number): boolean {
    return wheelDetail(this.pointerTargets(), px, py, deltaY, deltaMode);
  }

  /**
   * 详情区**拖拽滚动**的三个阶段（一个入口：它们是同一次手势；分开写会
   * 让"漏接一个阶段"表现成"拖到一半就断"，很难查）。坐标**只认逻辑 Y**。
   */
  detailPointer(phase: 'down' | 'move' | 'up', pointerId: number, py = 0): void {
    if (phase === 'down') this.detail.pointerDown(pointerId, py);
    else if (phase === 'move') this.detail.pointerMove(pointerId, py);
    else this.detail.pointerUp(pointerId);
  }

  /** 拖拽滑块到某个横坐标（由 `canvasInput` 在 `pointermove` 时调用）。 */
  dragScaleSlider(px: number): void {
    dragScaleSlider(this.pointerTargets(), px);
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
      touch: this.touchCapable(),
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

  /**
   * 这台设备**是不是触屏**（决定底部那个唯一的「恢复默认」恢复谁）。
   *
   * ⚠️ 唯一真相是 `SettingsPanelOptions.getTouchCapable`（来自
   * `render/platform` 的能力探测，**不看 UA**）。
   *
   * ⚠️ 它**不是** `!showKeyHints` 的别名：两个字段今天恰好反相关
   * （见 `render/platform.detectPlatform` 的说明），但"显示不显示键名"
   * 与"恢复哪套键位"是两件事 —— 所以 `getTouchCapable` 缺失时才退回这个
   * 近似（而不是反过来让 `showKeyHints` 承担语义）。
   */
  private touchCapable(): boolean {
    const explicit = this.options.getTouchCapable?.();
    if (explicit !== undefined) return explicit;
    return this.options.getShowKeyHints !== undefined && !this.showKeyHintsNow;
  }

  /** 每帧调用：提示的倒计时（到点自己消失，见 `PanelNotice`）。 */
  update(): void {
    if (this.notice.tick()) this.redraw();
  }

  private redraw(): void {
    this.drawFrame();
    this.drawBody();
  }

  private drawFrame(): void {
    const tabFocus = this.focus.zone === 'tabs' ? this.focus.index : -1;
    /** ⚠️ 可见的 tab 表一路传进渲染层 —— 首页时「按键」页整个不画。 */
    this.frame.update(this.tabs, this.tab, this.focus.zone, tabFocus, this.showKeyHintsNow);
  }

  /** 画外框 / 内容区（实现在 `SettingsFrame` 与 `./settingsBody`）。 */
  private drawBody(): void {
    this.footer.setTouch(this.touchCapable());
    drawBody(
      {
        grid: this.keyGrid,
        slider: this.scaleSlider,
        preview: this.preview,
        detail: this.detail,
        footer: this.footer,
        rows: this.options.getRows(),
        slots: this.touchSlots(),
      },
      {
        tab: this.tab,
        focus: this.focus,
        capturingSkillId: this.rebind.skillId,
        showKeyHints: this.showKeyHintsNow,
        translate: (key, params) => this.options.translate(key, params),
      },
    );
  }

}
