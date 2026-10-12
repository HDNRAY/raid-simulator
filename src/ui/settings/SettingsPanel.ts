/**
 * 设置弹窗（全 canvas）。
 *
 * 不用 DOM：架构规范要求所有 UI 走 canvas。设置界面是最容易被"顺手用
 * DOM 做"的一块，但它偏偏**交互最复杂**（改键要独占键盘、要处理冲突），
 * 所以连按键捕获都在 canvas 里做。
 * 与引擎的关系：**完全不碰引擎**，只通过回调改键位表与通用选项。
 */


import type { Container } from 'pixi.js';
import { RebindSession } from './rebindSession';
import { resolvePanelDispatch } from './panelDispatch';
import { runPanelClick, type PanelActions } from './panelWiring';
import { drawBody } from './settingsBody';
import { buildPanelActions } from './panelActions';
import { buildPanelPointerRoutes, type PanelPointerRoutes } from './panelInput';
import { makeSettingsProbes, type SettingsProbes } from './panelProbes';
import { routePanelKey } from './panelKeyRoute';
import { HoverTracker } from './hoverTracker';
import { PanelNotice } from './panelNotice';
import { buildPanelParts } from './panelBuild';
import { KeyGrid } from './KeyGrid';
import { TouchSkillPicker } from './TouchSkillPicker';
import { ModeSwitch } from './ModeSwitch';
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
  keyGridMetrics,
  preferredTab,
  visibleTabs,
  type FocusContext,
  type SettingsFocus,
} from './logic';
import { buildFocusContext, rehomeFocus } from './panelFocus';
import { pickerScroll } from './touchPickerLayout';
import { capsOf, type OperationMode } from '../../render/platform';
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
   * **当前操作方式**（键盘 / 触屏）—— 全应用**唯一**的那个 flag。
   *
   * ⚠️ 面板用它回答三件事（都从这一个值派生，没有第二个来源）：
   *   - 「按键」页画**键盘块**还是**触屏块**（`caps.touch`）
   *   - 要不要拼键名提示（`caps.showKeyHints`）
   *   - 「通用」页那个选择器该亮哪一个
   *
   * ⚠️ 是**函数**：玩家能在「通用」页当场切过去，快照会停在构造那一刻。
   */
  readonly getOperationMode: () => OperationMode;
  /**
   * 玩家在「通用」页切了操作方式。
   *
   * ⚠️ 面板**不自己写**（`GameState.operationMode` / 存档 / 换哪一份键位表
   * 分属不同模块）—— 落点在 `app/game.ts` 的 `applyOperationMode`，
   * 它切完会回调面板重画（`setOperationMode`）。
   */
  readonly onOperationMode: (mode: OperationMode) => void;
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

  /**
   * 按键页的技能格（独立组件，见 `KeyGrid` 的说明）。
   *
   * 原先格子的构造与绘制直接写在这里 —— "面板顺手把格子也画了"。
   */
  private readonly keyGrid: KeyGrid;
  /**
   * **触屏技能面**（触屏方式下两步交互的第二步，独立组件）。
   *
   * ⚠️ 它与 `keyGrid` 是**两个组件、两套状态机**（用户："里面的实现有一半
   * 都不一样"）：键盘格的点击是"改键"，这一面是"绑到已选中的键位"。
   * 共用的是**技能池 / 文案来源 / 滚动数学**，不是交互。
   */
  private readonly picker: TouchSkillPicker;
  /**
   * 「通用」页的**操作方式**选择器（键盘 / 触屏）—— 唯一 flag 的用户入口。
   */
  private readonly modeSwitch: ModeSwitch;
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
   * **触屏技能面当前窗口的第一个技能下标**。
   *
   * ⚠️ 这份状态住在面板（不在组件里）：命中测试、焦点激活、渲染三处都要
   * 用它，而它一变就得三处一起变 —— 组件自己留一份就会出现"看着是这个
   * 技能、点下去绑了别的"（滚动过的列表最容易出这种错）。
   *
   * ⚠️ 由 `picker` 组件负责**钳位**（`picker.clampOffset`，池子换角色变小
   * 时），面板只在滚动时写它。
   */
  private pickerOffset = 0;
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

    /**
     * ⚠️ 部件怎么造整块在 `./panelBuild`（这一轮又顶到 700 行 —— AGENTS.md
     * §3 的横向切割：那是"面板由哪些部件组成"这一个关注点）。
     */
    const parts = buildPanelParts(
      {
        pixi,
        translate: options.translate,
        noticeText: () => this.notice.text,
        getUiScale: options.getUiScale,
        onUiScale: options.onUiScale,
      },
      this.root,
    );
    /**
     * ⚠️ `dim` / `body` 不在这里存字段：它们只被 `partBuild` 挂进场景树，
     * 面板自己不读（Pixi 的容器树持有引用）。存一份没人读的字段只会让
     * "谁在用它"看起来比实际复杂。
     */
    this.frame = parts.frame;
    this.keyGrid = parts.grid;
    this.picker = parts.picker;
    this.modeSwitch = parts.modeSwitch;
    this.preview = parts.preview;
    this.detail = parts.detail;
    this.footer = parts.footer;
    this.scaleSlider = parts.slider;

    this.probes = makeSettingsProbes({
      showKeyHints: () => this.showKeyHintsNow,
      detailScroll: () => this.detail.scrollState(),
      slotCenter: (index) => this.preview.centerOf(index),
      rowCount: () => this.options.getRows().length,
    });
    this.settingsTrace = this.probes.trace;

    this.pointers = buildPanelPointerRoutes({
      visible: () => this.visible,
      tab: () => this.tab,
      mode: () => this.options.getOperationMode(),
      setUiScale: (value) => this.options.onUiScale(value),
      redraw: () => this.redraw(),
      wheelDetail: (deltaY, deltaMode) => this.detail.wheel(deltaY, deltaMode),
      wheelPicker: (delta) => this.scrollPicker(delta),
      rowCount: () => this.options.getRows().length,
      detailPointer: (phase, pointerId, py) => {
        if (phase === 'down') this.detail.pointerDown(pointerId, py);
        else if (phase === 'move') this.detail.pointerMove(pointerId, py);
        else this.detail.pointerUp(pointerId);
      },
    });

    this.rebind = new RebindSession({
      translate: options.translate,
      onCapture: options.onCapture,
      onRebind: options.onRebind,
      rows: () => this.options.getRows(),
      notice: (text) => this.notice.set(text),
      redraw: () => this.redraw(),
      trace: (line) => this.probes.pushTrace(line),
    });

    this.drawFrame();
  }

  /** 当前 tab 有没有 UI 缩放 slider（只有通用页有）。 */
  private get hasSlider(): boolean {
    return this.tab === 'general';
  }

  /** 当前 tab 有没有**键盘**技能格（「按键」页 + 键盘方式）。 */
  private get hasGrid(): boolean {
    return this.tab !== 'general' && !this.touchMode;
  }

  /** 当前 tab 有没有**触屏**那一套（技能面 + 键位预览）。 */
  private get hasTouchBlock(): boolean {
    return this.tab !== 'general' && this.touchMode;
  }

  /**
   * **当前操作方式**（唯一 flag）—— 面板所有"键盘 / 触屏"的分支都读它。
   *
   * ⚠️ 每次都**现读**（函数）：玩家能在「通用」页当场切过去。
   */
  private get touchMode(): boolean {
    return capsOf(this.options.getOperationMode()).touch;
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
   * ⚠️ 算术搬到了 `./panelFocus`（纯函数、可在 node 里测）：列数按**当前
   * 这一屏**取（桌面 4 / 触屏 3）、格子数封顶在容量上。这两条各有一次
   * 真实的 bug 形态，写在那个文件头。
   */
  private focusContext(): FocusContext {
    return buildFocusContext({
      rows: this.options.getRows(),
      metrics: keyGridMetrics(this.showKeyHintsNow),
      hasGrid: this.hasGrid,
      hasPicker: this.hasTouchBlock,
      hasSlider: this.hasSlider,
      hasMode: this.hasSlider,
      tabCount: this.tabs.length,
      selectedSlot: this.preview.selected,
    });
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /**
   * **给调试探针看的那几样**（轨迹 / 滚动状态 / 格与键位的圆心）——
   * 实现在 `./panelProbes`（这个文件顶到 700 行，AGENTS.md §3 的横向切割）。
   *
   */
  /**
   * **公开**：`app/debugApi` 直接读它（`settings.probes.cellCenter(i)` 这类）
   * —— 面板不再为每个探针各留一个转发方法。
   */
  readonly probes: SettingsProbes;

  /** 按键轨迹（调试探针用）—— 与 `probes.trace` 是同一个数组。 */
  readonly settingsTrace: string[];

  /** 正在等待按键的技能 id（调试探针用）。 */
  get capturingSkillId(): string | undefined {
    return this.rebind.skillId;
  }

  /** 当前键盘焦点（调试探针用）。 */
  get focusState(): SettingsFocus {
    return this.focus;
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
    this.rehomeFocus();
    this.redraw();
  }

  /**
   * **操作方式变了**（由 `app/game.ts` 的 `applyOperationMode` 在写状态 +
   * 存档之后回调）。
   *
   * ⚠️ 面板只做两件事：把焦点挪到一个**现在存在**的区、重画。它**不写**
   * 那个 flag（唯一来源在 `GameState.operationMode`）—— 也不去改键位表
   * （那是落点的事，理由写在 `SettingsPanelOptions.onOperationMode`）。
   */
  setOperationMode(): void {
    this.resetTransientState();
    this.pickerOffset = 0;
    this.rehomeFocus();
    this.redraw();
  }

  /**
   * 焦点换家：切页 / 切操作方式之后，别让焦点停在一个画不出来的区上。
   *
   * ⚠️ 判定整块在 `./panelFocus.rehomeFocus`（纯函数、有单测）—— 那里写着
   * 两个真实的 bug 形态（首页打开、切方式）。
   */
  private rehomeFocus(): void {
    this.focus = rehomeFocus(this.focus, this.focusContext());
  }

  /**
   * 当前是否显示键名（= **是不是键盘方式**）。
   *
   * ⚠️ 它是唯一 flag 的**派生**（`capsOf(mode).showKeyHints`），不是第二个
   * 来源 —— 命中测试与渲染必须用同一个值，否则可点区与画出的位置错开。
   */
  private get showKeyHintsNow(): boolean {
    return capsOf(this.options.getOperationMode()).showKeyHints;
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
      mode: this.options.getOperationMode(),
      pickerOffset: this.pickerOffset,
    });

    return runPanelClick(action, this.panelActions());
  }

  /** 面板对外的**动作面**（点击与按键共用）—— 实现见 `./panelActions`。 */
  private panelActions(): PanelActions {
    return buildPanelActions({
      close: () => this.options.onClose(),
      switchTab: (tab) => this.setTab(tab),
      switchOperationMode: (mode) => this.options.onOperationMode(mode),
      resetKeys: () => this.options.onResetKeys(),
      resetTouch: () => this.options.onResetTouchButtons?.(),
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
   * ⚠️ 只在**键盘方式**生效：触屏方式下技能格不画（那一块是
   * `TouchSkillPicker`，它的交互是"选中键位之后点技能"，没有悬停语义）。
   *
   * ⚠️ 去重（"同一格的重复 hover 忽略"）在 `./hoverTracker` ——
   * 那段语义踩过坑（方向键刚移走焦点就被拽回来），所以它有自己的注释与测试。
   */
  hoverSkill(px: number, py: number): void {
    if (!this.visible || this.tab !== 'keys' || this.touchMode) return;
    const skillId = this.hover.skillAt(px, py, {
      tab: this.tab,
      tabs: this.tabs,
      rows: this.options.getRows(),
      showKeyHints: this.showKeyHintsNow,
      mode: this.options.getOperationMode(),
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

  /**
   * **指针路由表**（拖滑块 / 滚详情 / 滚技能面 / 拖详情）—— 判断全在
   * `./panelInput`，这里只把面板那点状态接进去。
   *
   * ⚠️ 依赖一律传**取值函数**（见 `buildPanelPointerRoutes` 的说明）。
   * `app/canvasInput` 直接问 `settings.pointers.*` —— 面板不再自己留
   * 七个转发方法（那七段判断本来就在 `panelInput` 里）。
   */
  /** ⚠️ **公开**：`app/canvasInput` 直接问它（见 `buildPanelPointerRoutes`）。 */
  readonly pointers: PanelPointerRoutes;

  /**
   * 把触屏技能面滚一段（鼠标滚轮 / 键盘越界都用它）。
   *
   * ⚠️ 偏移**只有这一处写入**（面板持有）—— 命中测试、焦点激活、渲染读的
   * 是同一个值；组件自己留一份副本就会出现"看着是这个技能、点下去绑了
   * 别的"。钳位与边界数学在 `ui/scrollWindow`（`pickerScroll` 转发）。
   */
  private scrollPicker(delta: number): void {
    const next = pickerScroll(this.pickerOffset, delta, this.options.getRows().length);
    if (next === this.pickerOffset) return;
    this.pickerOffset = next;
    this.redraw();
  }

  /**
   * 键盘输入（弹窗打开时由主循环转发过来）。
   *
   * ⚠️ 整块在 `./panelKeyRoute`（这个文件顶到 700 行，AGENTS.md §3 的横向
   * 切割：那是"一次按键怎么走完"这一个关注点）。面板只把状态接进去。
   */
  handleKey(key: string): boolean {
    return routePanelKey({
      key,
      visible: () => this.visible,
      focus: () => this.focus,
      assignFocus: (next) => {
        this.focus = next;
      },
      rows: () => this.options.getRows(),
      tabs: () => this.tabs,
      touchSlots: () => this.touchSlots(),
      selectedSlot: () => this.preview.selected,
      capturingSkillId: () => this.rebind.skillId,
      pickerOffset: () => this.pickerOffset,
      actions: () => this.panelActions(),
      nudgeSlider: (direction) => this.scaleSlider.nudge(direction),
      selectSlot: (index) => this.preview.select(index),
      scrollPicker: (delta) => this.scrollPicker(delta),
      pushTrace: (line) => this.probes.pushTrace(line),
      redraw: () => this.redraw(),
    });
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
    /**
     * ⚠️ **先给焦点"换家 + 钳下标"**：玩家在备战界面换角色之后技能表会变
     * （用户 2026-10-12："根据当前选的人，设置里决定显示谁的技能"），
     * 而焦点可能停在一个**这一屏画不出来**的格子上 —— 那时详情区是空的、
     * `Enter` 会"对空气改键"。判定在 `./panelFocus.rehomeFocus`（纯函数）。
     */
    this.focus = rehomeFocus(this.focus, this.focusContext());
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
    /**
     * ⚠️ 池子变小（换角色）时把技能面的窗口偏移拉回合法范围 ——
     * **只有这一处**能改它（命中测试与焦点都读同一个值）。
     */
    this.pickerOffset = pickerScroll(this.pickerOffset, 0, this.options.getRows().length);
    drawBody(
      {
        grid: this.keyGrid,
        picker: this.picker,
        slider: this.scaleSlider,
        modeSwitch: this.modeSwitch,
        preview: this.preview,
        detail: this.detail,
        footer: this.footer,
        rows: this.options.getRows(),
        slots: this.touchSlots(),
        pickerOffset: this.pickerOffset,
      },
      {
        tab: this.tab,
        mode: this.options.getOperationMode(),
        focus: this.focus,
        capturingSkillId: this.rebind.skillId,
        showKeyHints: this.showKeyHintsNow,
        translate: (key, params) => this.options.translate(key, params),
      },
    );
  }

}
