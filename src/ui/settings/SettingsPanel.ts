/**
 * 设置弹窗（全 canvas）。
 *
 * 不用 DOM：架构规范要求所有 UI 走 canvas。设置界面是最容易被"顺手用
 * DOM 做"的一块，但它偏偏**交互最复杂**（改键要独占键盘、要处理冲突），
 * 所以连按键捕获都在 canvas 里做。
 * 与引擎的关系：**完全不碰引擎**，只通过回调改键位表与通用选项。
 */


import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from '../layout';
import { PALETTE } from '../../render/theme';
import { isReservedKey, reservedKeyLabel } from '../../input/keyboard';
import { beginCapture, classifyCaptureKey, endCapture, type CaptureState } from './captureState';
import {
  executeKeyPanelAction,
  executePanelDispatch,
  resolveCycleFocus,
  resolveKeyDispatch,
  resolveMoveFocus,
  resolvePanelDispatch,
} from './panelDispatch';
import { KeyGrid } from './KeyGrid';
import { SkillDetail } from './SkillDetail';
import { SettingsFrame } from './SettingsFrame';
import { KeysFooter } from './KeysFooter';
import type { KeyRow } from './rows';
import { ScaleSlider } from './ScaleSlider';
import type { PixiCtor } from '../primitives';
import type { TranslateFn } from '../../i18n/translator';
import {
  INITIAL_FOCUS,
  hitTest,
  uiScaleFromPointer,
  uiScaleSliderRect,
  contains,
  type SettingsFocus,
  type SettingsTab,
} from './logic';

export type { SettingsTab };
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
  /** 交换两个按钮位的技能（触屏用；见 `app/bindingActions.ts` 的区别说明）。 */
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
  /** 触屏按钮的技能名 key（只读预览）。**从 `TouchLayout` 读**，不留副本。 */
  readonly getTouchSkills?: (() => readonly string[]) | undefined;
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
  /** 触屏按钮的只读预览（需求："暂时就不给玩家自由编辑了"）。 */
  private readonly touchPreview: InstanceType<PixiCtor['Text']>;

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
   * 底部：提示行 + 「恢复默认」按钮（独立组件）。
   *
   * ⚠️ 恢复按钮原先**借用格子的 `rowGfx`**（两者共用一个 Graphics）
   * —— 那是"顺手画上去"，格子抽走后就断了。现在归它自己管。
   */
  private readonly footer: KeysFooter;

  private tab: SettingsTab = 'keys';
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
   * 改键状态（"正在等待按键"）。
   *
   * ⚠️ 它是 `./captureState` 里的一个**值**，不是散落的两个字段 ——
   * 语义（triggerKey 该不该作废、Esc 怎么退）全在那个模块里，面板只负责
   * 把判定执行掉。那段逻辑刚连出过三个 bug，所以现在有单测。
   */
  private capture: CaptureState = endCapture();
  /**
   * 上一次悬停到的技能格（`hoverSkill` 用）。
   *
   * ⚠️ 存在的理由是"别和方向键打架"：`pointermove` 会在鼠标微抖时反复
   * 触发，若每次都重设焦点，方向键刚移走的焦点会被立刻拽回来。
   * 只有**格子真的换了**才改焦点。详见 `hoverSkill` 的说明。
   */
  private lastHoverId: string | undefined;
  /** 提示文字（冲突/已恢复默认） */
  private notice = '';
  private noticeTtl = 0;

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

    this.footer = new KeysFooter(pixi, (key, params) => this.options.translate(key, params), () => this.notice);
    this.body.addChild(this.footer.root);

    /* ---------- 通用页：UI 缩放滑块 ---------- */
    this.touchPreview = new pixi.Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: FONT.small, fill: PALETTE.text },
    });
    this.touchPreview.visible = false;
    this.body.addChild(this.touchPreview);
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

  /** 当前 tab 有没有技能格（只有按键页有）。 */
  private hasGrid(): boolean {
    return this.tab === 'keys';
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

  /** 正在等待按键的技能 id（调试探针用）。 */
  get capturingSkillId(): string | undefined {
    return this.capture.skillId;
  }

  /** 当前键盘焦点（调试探针用）。 */
  get focusState(): SettingsFocus {
    return this.focus;
  }


  open(tab: SettingsTab = 'keys'): void {
    this.visible = true;
    this.root.visible = true;
    this.setTab(tab);
  }

  close(): void {
    this.stopCapture();
    this.visible = false;
    this.root.visible = false;
  }

  setTab(tab: SettingsTab): void {
    this.tab = tab;
    this.stopCapture();
    this.notice = '';
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
      px,
      py,
      rowSkillIds: this.options.getRows().map((r) => r.skillId),
      focus: this.focus,
      capturingSkillId: this.capture.skillId,
      showKeyHints: this.showKeyHintsNow,
    });

    return executePanelDispatch(action, {
      close: () => this.options.onClose(),
      switchTab: (tab) => this.setTab(tab),
      resetKeys: () => this.options.onResetKeys(),
      notice: (key) => this.setNotice(this.options.translate(key)),
      swapSlots: (from, to) => {
        this.stopCapture();
        this.options.onSwapSlots(from, to);
      },
      focusSkill: (skillId) => this.setFocusToSkill(skillId),
      startCapture: (skillId) => this.startCapture(skillId),
      uiScale: (value) => this.options.onUiScale(value),
      redraw: () => this.redraw(),
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
   * 鼠标悬停到某个技能格上 —— 与方向键选中是**同一件事**。
   *
   * 需求要求合并这两者；悬停也走同一条路径，所以"鼠标划过"与
   * "方向键移动"看到的是同一个高亮、同一份详情。
   *
   * ==================================================================
   * ⚠️ 只有**hover 的格子变了**才改焦点
   * ==================================================================
   *
   * 玩家原话："关键是 hover 停止后，方向键要依然有效。"
   *
   * 症状：光标停在一个格子上，用方向键把焦点移走 —— **焦点立刻被拽回来**，
   * 于是"方向键没反应"。原因是 `pointermove` 会在鼠标**极其轻微**的抖动下
   * 反复触发（甚至像素级抖动也算），每次都把焦点重设成光标所在那一格。
   *
   * 所以记住上一次悬停的格子，**同一个格子上的重复 hover 直接忽略**：
   *   - 光标停着不动（或微抖） → 方向键移走的焦点**留得住**
   *   - 光标真的移到另一格 → 才换焦点
   *   - 光标离开网格（`lastHoverId` 清空）→ 再移回来仍能选中它
   *
   * 清空那一步不能省：否则"移到 A → 方向键到 B → 移开 → 再移回 A"
   * 会因为 A 还是 `lastHoverId` 而**选不动 A**。
   */
  hoverSkill(px: number, py: number): void {
    if (!this.visible || this.tab !== 'keys') return;
    const rows = this.options.getRows();
    const target = hitTest(px, py, {
      tab: this.tab,
      rowSkillIds: rows.map((r) => r.skillId),
      showKeyHints: this.showKeyHintsNow,
    });
    if (target.kind !== 'keyRow') {
      this.lastHoverId = undefined;
      return;
    }
    if (target.skillId === this.lastHoverId) return;
    this.lastHoverId = target.skillId;
    this.setFocusToSkill(target.skillId);
  }

  /** 设焦点并重画（统一入口，保证焦点变化一定会重绘）。 */
  private setFocus(next: SettingsFocus): void {
    const same =
      next.zone === this.focus.zone &&
      (next.zone !== 'grid' || next.index === (this.focus.zone === 'grid' ? this.focus.index : -1));
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
      capturingSkillId: this.capture.skillId,
      focus: this.focus,
      rowSkillIds: rows.map((r) => r.skillId),
    });
    this.settingsTrace.push(dispatch.trace);
    if (this.settingsTrace.length > 40) this.settingsTrace.shift();

    const result = executeKeyPanelAction(
      { action: dispatch.action, activate: dispatch.activate, key },
      {
        close: () => this.options.onClose(),
        switchTab: (tab) => this.setTab(tab),
        resetKeys: () => this.options.onResetKeys(),
        notice: (text) => this.setNotice(this.options.translate(text)),
        rebind: (skillId, boundKey) => this.options.onRebind(skillId, boundKey),
        startCapture: (skillId, triggerKey) => this.startCapture(skillId, triggerKey),
        stopCapture: () => this.stopCapture(),
        finishCapture: (captured) => this.finishCapture(captured),
        moveFocus: (direction) =>
          resolveMoveFocus({
            focus: this.focus,
            direction,
            cellCount: rows.length,
            hasSlider: this.hasSlider(),
            hasGrid: this.hasGrid(),
          }),
        cycleFocus: (back) =>
          resolveCycleFocus({
            focus: this.focus,
            cellCount: rows.length,
            back,
            hasSlider: this.hasSlider(),
          }),
        nudgeSlider: (direction) => {
          this.scaleSlider.nudge(direction);
        },
        redraw: () => this.redraw(),
      },
    );

    if (result.focus !== undefined) this.focus = result.focus;
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

  /**
   * 进入改键（等待一个按键）。
   *
   * ⚠️ 状态本身（以及"触发键只作废一次"的判据）在 `./captureState` ——
   * 抽出去是因为那段语义刚连出过三个 bug，需要单测；面板只负责把
   * 结果执行掉（注册捕获回调、重画）。
   *
   * @param triggerKey **触发改键的那一次按键**（键盘 Enter 进来时就是
   *   `'enter'`；**鼠标点击进来时没有这一次按键**，所以传 `undefined`）。
   */
  private startCapture(skillId: string, triggerKey?: string): void {
    this.settingsTrace.push(`startCapture(${skillId}) trigger=${triggerKey ?? '-'}`);
    this.capture = beginCapture(skillId, triggerKey);
    this.options.onCapture((key) => this.finishCapture(key));
    this.redraw();
  }

  private stopCapture(): void {
    if (this.capture.skillId !== undefined) {
      this.settingsTrace.push(`stopCapture(was ${this.capture.skillId})`);
    }
    this.capture = endCapture();
    this.options.onCapture(undefined);
  }

  private finishCapture(key: string): void {
    this.settingsTrace.push(
      `finishCapture(${key}) skip=${this.capture.triggerKey ?? '-'}`,
    );
    const skillId = this.capture.skillId;
    if (skillId === undefined) return;

    const verdict = classifyCaptureKey(this.capture, key);
    if (verdict.kind === 'skip') {
      // 作废"触发改键的那一次按键" —— 只作废一次，之后照常捕获
      this.capture = { ...this.capture, triggerKey: undefined };
      return;
    }
    if (verdict.kind === 'cancel') {
      this.stopCapture();
      return;
    }

    /**
     * ⚠️ **先退出捕获，再做判定** —— 单一出口。
     *
     * 早期 `stopCapture()` 分散在几个分支里（保留键那个漏了），于是
     * 捕获状态**卡住不退**：下一次按键仍被当成改键输入，界面像死了。
     */
    this.stopCapture();

    /**
     * **系统保留键直接拒绝并提示**。
     *
     * 需求："一部分系统 reserved 的按键不支持绑技能，记得加提示"。
     * 提示里必须写出**具体是哪个键**被拒 —— 只说"不能用"会让玩家
     * 反复试同一个键。
     */
    if (isReservedKey(key)) {
      this.setNotice(
        this.options
          .translate('settings.keysReserved')
          .replace('{key}', reservedKeyLabel(key)),
      );
      this.redraw();
      return;
    }

    // 冲突策略（顶掉旧占用者）在 `applyRebind` 里，见它的说明
    const rows = this.options.getRows();
    const before = rows.find((r) => r.skillId === skillId);
    if (before?.key === key) {
      this.redraw();
      return;
    }

    this.options.onRebind(skillId, key);
    this.redraw();
  }

  private setNotice(text: string): void {
    this.notice = text;
    this.noticeTtl = 180;
  }

  /** 每帧调用：倒计时提示文字。 */
  update(): void {
    if (this.noticeTtl > 0) {
      this.noticeTtl -= 1;
      if (this.noticeTtl === 0) {
        this.notice = '';
        this.redraw();
      }
    }
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
    this.frame.update(this.tab, this.focus.zone, tabFocus, this.showKeyHintsNow);
  }

  private drawBody(): void {
    this.keyGrid.setVisible(this.tab === 'keys');
    /** 通用页的滑块 / 触屏预览 / 详情都在此隐藏 —— 这里只写隐藏，通用页
     * 分支只写显示。⚠️ `touchPreview` 原先只在 `drawTouchPreview()` 里置位，
     * 而那里只在通用分支被调用 → 回按键页后它停在显示状态并压住第一格。 */
    this.scaleSlider.setVisible(false);
    this.touchPreview.visible = false;
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
      this.drawTouchPreview();
      this.scaleSlider.redraw();
      return;
    }

    /* ---- 按键 tab ---- */
    const rows = this.options.getRows();

    /**
     * 格子交给组件画。
     *
     * ⚠️ 详情区由**格子驱动**（`onFocused` 回调）：焦点在哪一格就显示
     * 哪个技能。这样"画格子"与"显示谁"只有一个真相来源，
     * 不会再出现"点完格子、详情还停在上一个技能"。
     */
    this.keyGrid.update(rows, {
      focusIndex: this.focus.zone === 'grid' ? this.focus.index : -1,
      capturingSkillId: this.capture.skillId,
      showKeyHints: this.options.getShowKeyHints?.() !== false,
    }, (row) => this.drawDetail(row));

    this.footer.updateKeys(
      this.capture.skillId !== undefined,
      this.focus.zone === 'reset',
      this.options.getShowKeyHints?.() !== false,
    );
  }

  /** 只读预览。⚠️ 无触屏按钮时隐藏（桌面上画它只会让人困惑）。 */
  private drawTouchPreview(): void {
    const skills = this.options.getTouchSkills?.() ?? [];
    const r = uiScaleSliderRect();
    const names = skills.map((k) => this.options.translate(k)).join(' ');
    this.touchPreview.text =
      skills.length === 0 ? '' : `${this.options.translate('settings.touchButtons')}: ${names}`;
    this.touchPreview.x = r.x;
    this.touchPreview.y = r.y + r.h + 10;
    this.touchPreview.visible = skills.length > 0;
  }

  /** 空 tab 的占位：一行主文案 + 一行提示，避免一片空白让人以为坏了。 */
}
