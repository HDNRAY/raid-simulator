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
import { PALETTE } from '../../render/theme';
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, clampUiScale } from '../../render/scaling';
import { FONT, LOGICAL } from '../layout';
import { isReservedKey, reservedKeyLabel } from '../../input/keyboard';
import { Label, Panel, type PixiCtor } from '../primitives';
import {
  INITIAL_FOCUS,
  SETTINGS_PANEL,
  cycleZone,
  hitTest as hitTestLogic,
  keyLabel as formatKey,
  keyCellRect,
  resetButtonRect,
  resolveKeyAction,
  tabRect,
  uiScaleSliderRect,
  KEY_GRID_CAPACITY,
  hintLineY,
  moveFocus,
  resolveActivate,
  type SettingsFocus,
  type SettingsTab,
} from './logic';

export type { SettingsTab };

export interface KeyRow {
  /** 技能 id */
  readonly skillId: string;
  /** 技能名的 i18n key（图标就是那个字） */
  readonly nameKey: string;
  /** 当前绑定（归一化键名） */
  readonly key: string;
  /**
   * 玩法提示标签（需求："玩家技能的 tags 显示在设置里"）。
   *
   * 给的是**标签 id**，文案在 i18n 里（渲染层不持有可显示文字）。
   */
  readonly hintTags?: readonly string[];
}

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
  private readonly panel: Panel;
  private readonly title: Label;
  private readonly closeHint: Label;

  /** UI 缩放 slider 的标签（左：名称，右：百分比） */
  private readonly scaleLabel: Label;
  private readonly scaleValue: Label;

  private readonly tabButtons: Array<{
    tab: SettingsTab;
    gfx: Graphics;
    label: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];

  private readonly body: Container;
  private readonly rowGfx: Graphics;
  private readonly rowLabels: Array<{
    /** 玩法提示标签（如「打断」），没有则为空串 */
    readonly tags: Label;
    name: Label;
    key: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];
  private readonly hintLabel: Label;
  private readonly resetButton: { gfx: Graphics; label: Label; rect: { x: number; y: number; w: number; h: number } };

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

  private readonly origin = {
    x: Math.round((LOGICAL.width - SETTINGS_PANEL.w) / 2),
    y: Math.round((LOGICAL.height - SETTINGS_PANEL.h) / 2),
  };

  constructor(private readonly options: SettingsPanelOptions) {
    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    this.dim = new pixi.Graphics();
    this.dim.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: 0x000000, alpha: 0.66 });
    this.root.addChild(this.dim);

    const { x, y } = this.origin;
    this.panel = new Panel(pixi, {
      x,
      y,
      w: SETTINGS_PANEL.w,
      h: SETTINGS_PANEL.h,
      fill: 0x0e0e16,
      line: 0x6a6c80,
      fillAlpha: 0.98,
      radius: 4,
    });
    this.title = new Label(pixi, {
      x: x + 16,
      y: y + 10,
      size: FONT.title,
      color: PALETTE.text,
      kai: true,
    });
    this.closeHint = new Label(pixi, {
      x: x + SETTINGS_PANEL.w - 14,
      y: y + 12,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 1,
    });
    this.root.addChild(this.panel.root, this.title.root, this.closeHint.root);

    /* ---- tab 按钮 ---- */
    const tabs: SettingsTab[] = ['general', 'keys'];
    for (const [i, tab] of tabs.entries()) {
      const rect = tabRect(i);
      const gfx = new pixi.Graphics();
      const label = new Label(pixi, {
        x: rect.x + rect.w / 2,
        y: rect.y + 6,
        size: FONT.body,
        color: PALETTE.textDim,
        anchorX: 0.5,
        kai: true,
      });
      this.root.addChild(gfx, label.root);
      this.tabButtons.push({ tab, gfx, label, rect });
    }

    /* ---- 内容区 ---- */
    this.body = new pixi.Container();
    this.root.addChild(this.body);

    this.rowGfx = new pixi.Graphics();
    this.body.addChild(this.rowGfx);

    /**
     * 技能格：每个格子显示"技能字 + 当前按键"。
     *
     * 用 grid 而不是单列清单：技能会越来越多，单列 15 个技能就要
     * 450px 高度。grid 每行 3 个，同样数量只要 1/3 的高度。
     */
    for (let i = 0; i < KEY_GRID_CAPACITY; i += 1) {
      const rect = keyCellRect(i);
      const glyph = new Label(pixi, {
        x: rect.x + 12,
        y: rect.y + 12,
        size: FONT.warn,
        color: PALETTE.text,
        kai: true,
      });
      const key = new Label(pixi, {
        x: rect.x + rect.w - 12,
        y: rect.y + 14,
        size: FONT.body,
        color: PALETTE.textDim,
        anchorX: 1,
      });
      /**
       * 玩法提示标签（需求："玩家技能的 tags 显示在设置里"）。
       *
       * 画在技能字**下方**一行，字号用 `tiny` —— 它是补充说明，
       * 不能和"技能名 + 按键"抢视觉。没有标签的技能这一行留空
       * （格子高度是统一的，不为了空行去压缩别的格）。
       */
      const tags = new Label(pixi, {
        x: rect.x + 12,
        y: rect.y + rect.h - 12,
        size: FONT.tiny,
        color: PALETTE.textDim,
      });
      this.body.addChild(glyph.root, key.root, tags.root);
      this.rowLabels.push({ name: glyph, key, tags, rect });
    }

    this.hintLabel = new Label(pixi, {
      x: x + 16,
      y: y + hintLineY(),
      size: FONT.small,
      color: PALETTE.textDim,
    });
    this.body.addChild(this.hintLabel.root);

    /* ---- 恢复默认按钮 ---- */
    const resetRect = resetButtonRect();
    const resetGfx = new pixi.Graphics();
    const resetLabel = new Label(pixi, {
      x: resetRect.x + resetRect.w / 2,
      y: resetRect.y + 4,
      size: FONT.small,
      color: PALETTE.text,
      anchorX: 0.5,
    });
    this.resetButton = { gfx: resetGfx, label: resetLabel, rect: resetRect };
    this.body.addChild(resetGfx, resetLabel.root);

    /* ---------- 通用页：UI 缩放 slider ---------- */
    const slider = uiScaleSliderRect();
    this.scaleLabel = new Label(pixi, {
      x: slider.x,
      y: slider.y,
      size: FONT.body,
      color: PALETTE.text,
    });
    this.scaleValue = new Label(pixi, {
      x: slider.x + slider.w,
      y: slider.y,
      size: FONT.body,
      color: PALETTE.text,
      anchorX: 1,
    });
    this.body.addChild(this.scaleLabel.root, this.scaleValue.root);

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
      case 'keyRow':
        this.startCapture(target.skillId);
        return true;
      case 'none':
        // 点在弹窗内的空白处：消费掉，不穿透到战斗
        return true;
    }
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
          const delta = action.direction === 'right' ? UI_SCALE_STEP : -UI_SCALE_STEP;
          this.options.onUiScale(clampUiScale(this.options.getUiScale() + delta));
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

  private drawFrame(): void {
    const { x, y } = this.origin;
    this.title.set(this.options.translate('settings.title'));
    this.closeHint.set(this.options.translate('settings.close'));

    for (const [i, button] of this.tabButtons.entries()) {
      const active = button.tab === this.tab;
      const focused = this.focus.zone === 'tabs' && this.focus.index === i;
      const label =
        button.tab === 'general'
          ? this.options.translate('settings.tabGeneral')
          : this.options.translate('settings.tabKeys');
      button.label.set(label);
      button.label.setColor(active || focused ? 0xffffff : PALETTE.textDim);
      const g = button.gfx;
      g.clear();
      if (active) {
        // 选中的 tab 只用一个很淡的底色 + 下划线，不用整块高亮
        g.rect(button.rect.x, button.rect.y, button.rect.w, button.rect.h).fill({
          color: 0xffffff,
          alpha: 0.07,
        });
        g.rect(button.rect.x, button.rect.y + button.rect.h - 2, button.rect.w, 2).fill(
          PALETTE.douqi.base,
        );
      }
      /**
       * 键盘焦点：**一圈描边**。
       *
       * 与"选中"（下划线）刻意用不同的视觉手段 —— 它们语义不同：
       * 选中 = 当前显示哪个 tab，焦点 = 回车会作用在谁身上。
       * 两者可能同时存在（焦点在选中的 tab 上），也可能分开
       * （焦点移走了但 tab 没切）。
       */
      if (focused) {
        g.rect(button.rect.x, button.rect.y, button.rect.w, button.rect.h).stroke({
          color: PALETTE.douqi.bright,
          width: 1.5,
        });
      }
    }
    void x;
    void y;
  }

  private drawBody(): void {
    this.rowGfx.clear();
    for (const row of this.rowLabels) {
      row.name.set('');
      row.key.set('');
    }

    if (this.tab === 'general') {
      // 通用 tab 目前是空的 —— 明确写出来，而不是给一片空白
      this.hintLabel.set(this.options.translate('settings.generalHint'));
      // 通用页没有"恢复默认键位"，那一栏留空（它属于按键页）
      this.resetButton.label.set('');
      this.resetButton.gfx.clear();
      this.drawGeneralBody();
      return;
    }

    /* ---- 按键 tab ---- */
    const rows = this.options.getRows();
    this.hintLabel.set(
      this.notice !== ''
        ? this.notice
        : this.capturingSkill !== undefined
          ? this.options.translate('settings.keysCapturingHint')
          : this.options.translate('settings.keysHint'),
    );
    this.hintLabel.setColor(this.notice !== '' ? 0xff9080 : PALETTE.textDim);

    for (const [i, row] of rows.entries()) {
      if (i >= KEY_GRID_CAPACITY) break;
      const slot = this.rowLabels[i];
      if (!slot) continue;

      const capturing = this.capturingSkill === row.skillId;
      const focused = this.focus.zone === 'grid' && this.focus.index === i;
      slot.name.set(this.options.translate(row.nameKey));
      // 按键名统一大写显示，与技能栏上的提示一致
      slot.key.set(capturing ? '…' : formatKey(row.key, this.options.translate('settings.keyUnbound')));
      slot.key.setColor(capturing || focused ? PALETTE.douqi.bright : PALETTE.text);
      /**
       * 标签文案：`settings.hintTags.<id>`。
       *
       * 用"·"分隔多个标签，而不是竖线或逗号 —— 小字下它最轻。
       * 一个标签都没有时留空（不是"无"：那是噪声）。
       */
      const tagText = (row.hintTags ?? [])
        .map((tag) => this.options.translate(`settings.hintTags.${tag}`))
        .join(' · ');
      slot.tags.set(tagText);
      /**
       * 标签颜色按含义分：
       *   霸体（打不断）→ 金，和"这是个屏障"的直觉一致
       *   高伤（很痛）  → 红，和伤害同色
       *   打断（进攻性）→ 青绿，和可打断提示同色
       */
      slot.tags.setColor(tagColor(row.hintTags ?? []));

      const g = this.rowGfx;
      // 交替底色 + 捕获/键盘焦点的高亮
      g.rect(slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h).fill({
        color: capturing || focused ? PALETTE.douqi.base : 0xffffff,
        alpha: capturing ? 0.18 : focused ? 0.12 : i % 2 === 0 ? 0.03 : 0.06,
      });
      if (capturing || focused) {
        g.rect(slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h).stroke({
          color: PALETTE.douqi.bright,
          width: focused ? 1.5 : 1,
        });
      }
    }

    // 恢复默认按钮
    const rb = this.resetButton;
    const resetFocused = this.focus.zone === 'reset';
    rb.label.set(this.options.translate('settings.keysReset'));
    rb.label.setColor(resetFocused ? PALETTE.douqi.bright : PALETTE.text);
    const g = this.rowGfx;
    g.roundRect(rb.rect.x, rb.rect.y, rb.rect.w, rb.rect.h, 3).fill({
      color: resetFocused ? PALETTE.douqi.base : 0xffffff,
      alpha: resetFocused ? 0.16 : 0.08,
    });
    g.roundRect(rb.rect.x, rb.rect.y, rb.rect.w, rb.rect.h, 3).stroke({
      color: resetFocused ? PALETTE.douqi.bright : 0x6a6c80,
      width: resetFocused ? 1.5 : 1,
    });
  }

  /** 空 tab 的占位：一行主文案 + 一行提示，避免一片空白让人以为坏了。 */
  /**
   * 「通用」页的内容：目前只有 **UI 缩放**。
   *
   * 画法：名称在左、百分比在右、中间一条轨道 + 一个方块把手。
   * 焦点落在它上面时加一圈描边（与其它焦点态同一套语言）。
   */
  private drawGeneralBody(): void {
    const rect = uiScaleSliderRect();
    const scale = clampUiScale(this.options.getUiScale());
    const t = (scale - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN);
    const focused = this.focus.zone === 'slider';

    this.scaleLabel.set(this.options.translate('settings.uiScale'));
    this.scaleValue.set(`${Math.round(scale * 100)}%`);
    this.scaleValue.setColor(focused ? PALETTE.douqi.bright : PALETTE.text);
    this.scaleLabel.setColor(focused ? PALETTE.douqi.bright : PALETTE.text);

    const g = this.rowGfx;
    /** 轨道：底部一条 4px 的细线（与技能栏的冷却条同一套语言） */
    const trackY = rect.y + rect.h - 8;
    const trackW = rect.w - 8;
    g.rect(rect.x + 4, trackY, trackW, 4).fill({ color: 0x2a2c38, alpha: 1 });
    g.rect(rect.x + 4, trackY, Math.round(trackW * t), 4).fill({
      color: PALETTE.douqi.base,
      alpha: 1,
    });
    /**
     * 把手：一个 10×14 的方块。
     *
     * 用方块而不是圆：本作整套 UI 没有圆形元素（技能格、条、按钮
     * 全是直角），一个圆把手会显得是"从别处搬来的控件"。
     */
    const knobW = 10;
    const knobX = rect.x + 4 + Math.round(trackW * t) - knobW / 2;
    g.rect(knobX, trackY - 6, knobW, 16).fill({
      color: focused ? PALETTE.douqi.bright : 0xd8d8e4,
      alpha: 1,
    });
    if (focused) {
      g.rect(rect.x, rect.y, rect.w, rect.h).stroke({
        color: PALETTE.douqi.bright,
        width: 1.5,
      });
    }
  }
}

/**
 * 标签行的颜色。
 *
 * 取**优先级最高的那一个**标签的颜色 —— 一行小字里混两种颜色会更乱，
 * 而标签本来就是"最该注意的那条"提示。
 */
function tagColor(tags: readonly string[]): number {
  if (tags.includes('highDamage')) return 0xff8a70; // 红：很痛
  if (tags.includes('interruptImmune')) return 0xe4a840; // 金：打不断
  if (tags.includes('interrupt')) return 0x7cd480; // 绿：进攻性
  return 0x8c8c9e;
}
