/**
 * 设置弹窗（全 canvas）。
 *
 * ==================================================================
 * 为什么也是 canvas 而不是 DOM
 * ==================================================================
 *
 * 架构规范里定的是"所有 UI 走 canvas，方便以后移植小游戏"。
 * 设置界面是最容易被"顺手用 DOM 做"的一块（表单、滚动、输入框都是
 * 浏览器免费的），但一旦开了这个口子，以后再想移植就要重写它 ——
 * 而它偏偏是**交互最复杂**的一块（改键要独占键盘、要处理冲突）。
 *
 * 所以这里连按键捕获都在 canvas 里做。
 *
 * ==================================================================
 * 与引擎的关系
 * ==================================================================
 *
 * 设置界面**完全不碰引擎**：它只改两类东西 ——
 *   1. 键位表（通过回调交出去）
 *   2. 将来的通用选项（缩放模式等）
 *
 * 打开设置时必须**暂停战斗**，否则玩家在改键时会被 Boss 打死。
 * 这个决定交给调用方（`onOpen` / `onClose`），组件自己不假设。
 */

import type { Container, Graphics } from 'pixi.js';
import { LOGICAL } from '../layout';
import { isReservedKey, reservedKeyLabel } from '../../input/keyboard';
import { KeyGrid } from './KeyGrid';
import { SkillDetail } from './SkillDetail';
import { SettingsFrame } from './SettingsFrame';
import { KeysFooter } from './KeysFooter';
import type { KeyRow } from './rows';
import { ScaleSlider } from './ScaleSlider';
import type { PixiCtor } from '../primitives';
import {
  INITIAL_FOCUS,
  cycleZone,
  hitTest as hitTestLogic,
  resolveKeyAction,
  uiScaleFromPointer,
  uiScaleSliderRect,
  contains,
  moveFocus,
  resolveActivate,
  type SettingsFocus,
  type SettingsTab,
} from './logic';

export type { SettingsTab };
export type { KeyRow } from './rows';

export interface SettingsPanelOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string) => string;
  /** 读取当前键位表 */
  readonly getRows: () => readonly KeyRow[];
  /** 改键：把某个技能的键改成 `key` */
  readonly onRebind: (skillId: string, key: string) => void;
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
  /**
   * 改键开始的时间戳（`performance.now()`）。
   *
   * 用来挡掉"触发改键的那一次按键本身" —— 见 `startCapture` 的说明。
   */
  private visible = false;
  /** 正在等待按键的技能 id（undefined = 没在捕获） */
  private capturingSkill: string | undefined;
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

    this.frame = new SettingsFrame(pixi, (key) => this.options.translate(key));
    this.root.addChild(this.frame.root);

    /* ---- 内容区 ---- */
    this.body = new pixi.Container();
    this.root.addChild(this.body);

    this.keyGrid = new KeyGrid(pixi, (key) => this.options.translate(key));
    this.body.addChild(this.keyGrid.root);

    this.footer = new KeysFooter(pixi, (key) => this.options.translate(key), () => this.notice);
    this.body.addChild(this.footer.root);

    /* ---------- 通用页：UI 缩放滑块 ---------- */
    this.detail = new SkillDetail(pixi, (key) => this.options.translate(key));
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

  /** 某一行的矩形（相对弹窗内的固定偏移）。 */
  get isOpen(): boolean {
    return this.visible;
  }

  /**
   * 是否作废下一次捕获回调（"触发改键的那一次按键"）。
   *
   * 每次 `startCapture` 置位、`finishCapture` 或 `stopCapture` 清零 ——
   * 所以它不可能卡住。
   */
  private skipNextCapture = false;

  /**
   * 按键轨迹（环形缓冲，供调试探针读取）。
   *
   * 保留它是因为"按键没生效"这类问题**只能靠事件序列定位** ——
   * 我这次排查"一次 Enter 同时进入改键并完成绑定"就是靠它，
   * 日志一眼看出 `startCapture` 之后紧跟 `finishCapture(enter)`。
   * 截图和单元测试都看不到这个层面的信息。
   */
  readonly settingsTrace: string[] = [];

  /** 正在等待按键的技能 id（调试探针用）。 */
  get capturingSkillId(): string | undefined {
    return this.capturingSkill;
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
   * 点一下某个位置。
   *
   * 命中测试自己算（不做逐对象事件绑定）—— 弹窗只有十几个可点区域，
   * 一个"从上到下第一个命中的"循环就够，而且比 Pixi 的事件系统
   * 更容易在测试里驱动（直接传坐标即可）。
   *
   * @returns 是否消费了这次点击
   */
  hitTest(px: number, py: number): boolean {
    if (!this.visible) return false;

    const target = hitTestLogic(px, py, {
      tab: this.tab,
      rowSkillIds: this.options.getRows().map((r) => r.skillId),
    });

    switch (target.kind) {
      case 'outside':
        this.options.onClose();
        return true;
      case 'tab':
        this.setTab(target.tab);
        return true;
      case 'resetKeys':
        this.options.onResetKeys();
        this.setNotice(this.options.translate('settings.keysResetDone'));
        this.redraw();
        return true;
      case 'keyRow': {
        /**
         * ⚠️ 点技能格 = **选中**，不是直接改键。
         *
         * 需求："设置里的按键设置，目前方向键选中和鼠标选中是两件事，
         * 应该合并。"
         *
         * 原先点格子会立刻 `startCapture`（进入改键），而方向键只是移动
         * 焦点 —— 两套语义，而且点完之后详情区显示的还是**上一个**
         * 技能（焦点没变）。现在鼠标与方向键都只做"选中"，
         * 改键统一走 `Enter`（`activateFocus`）。
         */
        this.setFocusToSkill(target.skillId);
        return true;
      }
      case 'close':
        /**
         * 需求："设置弹窗里的『关闭』点了没反应。"
         *
         * 根因：它只是个 Label，没有命中测试 —— 点它落到
         * `hitTestLogic` 的 `none` 分支（"点在弹窗内空白处，消费掉"）。
         */
        this.options.onClose();
        return true;
      case 'scaleSlider':
        /**
         * 鼠标点/拖滑块：由横坐标直接反算倍数（点到哪跳到哪）。
         *
         * 需求："ui 缩放的 slider 还是要支持鼠标。"
         * 拖动也能用，因为主循环每次 pointerdown / pointermove 都会
         * 走到这里 —— 面板不需要自己维护"是否在拖"的状态。
         */
        this.options.onUiScale(uiScaleFromPointer(px));
        this.redraw();
        return true;
      case 'none':
        // 点在弹窗内的空白处：消费掉，不穿透到战斗
        return true;
    }
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
   */
  hoverSkill(px: number, py: number): void {
    if (!this.visible || this.tab !== 'keys') return;
    const rows = this.options.getRows();
    const target = hitTestLogic(px, py, {
      tab: this.tab,
      rowSkillIds: rows.map((r) => r.skillId),
    });
    if (target.kind !== 'keyRow') return;
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
   * @returns 是否消费了这次按键
   */
  /**
   * 键盘输入（弹窗打开时由主循环转发）。
   *
   * @returns 是否消费了这次按键
   */
  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cellCount = this.options.getRows().length;

    const action = resolveKeyAction(key, this.capturingSkill !== undefined);
    this.settingsTrace.push(`handleKey(${key}) cap=${this.capturingSkill ?? '-'} -> ${action.kind}`);
    if (this.settingsTrace.length > 40) this.settingsTrace.shift();

    switch (action.kind) {
      case 'cancelCapture':
        this.stopCapture();
        this.redraw();
        return true;
      case 'closePanel':
        this.options.onClose();
        return true;
      case 'capture':
        // 捕获模式下输入层直接回调，这里不重复处理
        return true;
      case 'move': {
        /**
         * slider 焦点下，**左右是"调值"而不是"移动焦点"**。
         *
         * 需求："设置的通用里，加一个 UI 缩放的 slide，可以调整所有 UI 的比例"，
         * 而本项目要求"几乎全键盘可操作"，所以 slider 必须能纯键盘调。
         * 上下仍然用于离开这一项（回 tab 行 / 去恢复按钮）。
         */
        const horizontal = action.direction === 'left' || action.direction === 'right';
        if (this.focus.zone === 'slider' && horizontal) {
          this.scaleSlider.nudge(action.direction === 'right' ? 1 : -1);
          this.redraw();
          return true;
        }
        this.focus = moveFocus(
          this.focus,
          action.direction,
          cellCount,
          this.hasSlider(),
          this.hasGrid(),
        );
        this.redraw();
        return true;
      }
      case 'cycle':
        this.focus = cycleZone(this.focus, cellCount, action.back, this.hasSlider());
        this.redraw();
        return true;
      case 'activate':
        this.activateFocus();
        return true;
      case 'ignore':
        return true;
    }
  }

  /** 激活当前焦点（Enter / 空格）。 */
  private activateFocus(): void {
    const action = resolveActivate(this.focus, this.options.getRows().map((r) => r.skillId));
    switch (action.kind) {
      case 'switchTab':
        this.setTab(action.tab);
        return;
      case 'startCapture':
        this.startCapture(action.skillId);
        return;
      case 'resetKeys':
        this.options.onResetKeys();
        this.setNotice(this.options.translate('settings.keysResetDone'));
        this.redraw();
        return;
      case 'close':
        this.options.onClose();
        return;
      case 'none':
        return;
    }
  }

  private startCapture(skillId: string): void {
    this.settingsTrace.push(`startCapture(${skillId})`);
    this.capturingSkill = skillId;
    /**
     * 跳过**触发改键的那一次按键**。
     *
     * ------------------------------------------------------------------
     * 为什么必须有这个标记
     * ------------------------------------------------------------------
     *
     * 输入层的 keydown 监听器比主监听器**先注册**（它在 `startBattle()`
     * 里、主监听器在 bootstrap 末尾），所以一次 keydown 的事件顺序是：
     *
     *   1. 输入层 `onKeyDown` 开始执行 —— 此时还没有捕获回调，它什么也没做
     *   2. 主监听器调用 `SettingsPanel.handleKey` → 进入改键模式 →
     *      **当场**把捕获回调注册给输入层
     *   3. 输入层 `onKeyDown` 的执行**还没结束**，它继续走到
     *      "有捕获回调吗" 那一步 —— 现在有了 —— 于是把
     *      **同一个按键**喂给了 `finishCapture`
     *
     * 表现就是"按 Enter 进入改键，技能被静默绑成了 Enter"。
     *
     * 试过但**不管用**的两种修法：
     *   - 在组件里比时间戳（"同一瞬间的按键忽略"）：用阈值猜事件归属，
     *     会误吞玩家的真实连按。
     *   - 在主监听器里标记"这次按键我处理了"：输入层先跑，
     *     标记设置得太晚。
     *
     * 所以只能由**改键协议自己**表达："进入改键后的第一个回调作废"。
     * 它与时序无关，并且每次进入/退出改键都会被重置。
     */
    this.skipNextCapture = true;
    /**
     * 时序守卫：记录改键开始的时刻，**同一瞬间到达的按键一律忽略**。
     *
     * 重入问题**不在这里解决** —— 它发生在输入层与主监听器之间，
     * 由 `main.ts` 的 `dispatching` 标记挡掉（见那里的说明）。
     * 组件这一层只关心"收到一个键，就处理一个键"。
     */
    this.options.onCapture((key) => this.finishCapture(key));
    this.redraw();
  }

  private stopCapture(): void {
    if (this.capturingSkill !== undefined) {
      this.settingsTrace.push(`stopCapture(was ${this.capturingSkill})`);
    }
    this.capturingSkill = undefined;
    this.skipNextCapture = false;
    this.options.onCapture(undefined);
  }

  private finishCapture(key: string): void {
    this.settingsTrace.push(`finishCapture(${key}) skip=${this.skipNextCapture}`);
    const skillId = this.capturingSkill;
    if (skillId === undefined) return;

    // 作废"触发改键的那一次按键" —— 见 `startCapture` 的说明
    if (this.skipNextCapture) {
      this.skipNextCapture = false;
      return;
    }

    /**
     * ⚠️ **先退出捕获，再做判定** —— 单一出口。
     *
     * 早期把 `stopCapture()` 分散在几个分支里（保留键的分支忘了调），
     * 于是"按下保留键"之后捕获状态**卡住不退**：玩家的下一次按键
     * 仍被当成改键输入，界面看起来像死了。
     * 所有分支都必须走到这里。
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
    this.frame.update(this.tab, this.focus.zone, this.focus.zone === 'tabs' ? this.focus.index : -1);
  }

  private drawBody(): void {
    this.keyGrid.setVisible(this.tab === 'keys');
    /**
     * **离开通用页时藏起滑块。**
     *
     * 只在这一处写"隐藏"，通用页分支只写"显示" —— 单一职责，
     * 不会再出现"某个 tab 忘了清"的情况（第一版正是这样漏的）。
     */
    this.scaleSlider.setVisible(false);
    /**
     * 详情同样"只属于按键页" —— 与滑块一个道理：**只在这一处写隐藏**，
     * 按键页分支只写显示。
     */
    this.detail.clear();

    if (this.tab === 'general') {
      // 通用 tab 目前是空的 —— 明确写出来，而不是给一片空白
      // 通用页没有"恢复默认键位"，那一栏留空（它属于按键页）
      this.footer.showGeneralHint();
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
      capturingSkillId: this.capturingSkill,
    }, (row) => this.drawDetail(row));

    this.footer.updateKeys(this.capturingSkill !== undefined, this.focus.zone === 'reset');
  }

  /** 空 tab 的占位：一行主文案 + 一行提示，避免一片空白让人以为坏了。 */
}

/**
 * 标签行的颜色。
 *
 * 取**优先级最高的那一个**标签的颜色 —— 一行小字里混两种颜色会更乱，
 * 而标签本来就是"最该注意的那条"提示。
 */
