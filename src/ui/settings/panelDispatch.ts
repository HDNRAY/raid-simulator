/**
 * **设置面板的输入派发** —— "这次点击 / 这次按键该做什么"的纯决策。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 顶到 700 行上限（AGENTS.md §3）。按那里的规则 ——
 * **不许靠删/压注释解决，要拆 util 或横向切割** —— 把面板里最长的两个
 * 方法（`hitTest` 约 72 行、`handleKey` 约 83 行）的**决策**切出来。
 *
 * ⚠️ 切的是决策，**不是执行** —— 面板仍然拿结果去开/关弹窗、改焦点、
 * 重画。这样这一层完全不碰 Pixi，可以直接单测（与 `logic.ts` 的
 * "为什么把判定逻辑抽出来"同一个理由）。
 *
 * ⚠️ 与 `logic.ts` 的分工：那边是"这个坐标落在哪个区域"（几何）与
 * "这个键算哪一类"（单键解析），这边是"**在当前面板状态下**该做什么"
 * （派发）。命中测试直接复用 `logic.ts` 的 `hitTest` —— 绝不再实现一遍，
 * 否则可点区会与画出来的格子再次错开。
 */

import type { KeyAction } from './logic';
import {
  hitTest as hitTestLogic,
  moveFocus,
  cycleZone,
  resolveActivate,
  resolveKeyAction,
  resolveRowTap,
  uiScaleFromPointer,
  type ActivateAction,
  type Direction,
  type FocusContext,
  type SettingsFocus,
} from './logic';
import type { SettingsTab } from './tabs';
import { resolveSlotBind, resolveSlotTap } from './slotActions';

/** 焦点此刻落在哪个技能格上（不在格子上、或下标越界时为 undefined）。 */
export function focusedSkillIdOf(
  focus: SettingsFocus,
  rowSkillIds: readonly string[],
): string | undefined {
  return focus.zone === 'grid' ? rowSkillIds[focus.index] ?? undefined : undefined;
}

/* ------------------------------------------------------------------ *
 * 点击
 * ------------------------------------------------------------------ */

/**
 * 点一下某个位置之后要做的事。
 *
 * 每个 kind 对应面板里的一个执行分支。执行所需的最小信息都在这里，
 * 面板不再自己重算（例如 `from`/`to` 下标）。
 */
export type PanelDispatch =
  /** 点在弹窗内的空白处：消费掉，不穿透到战斗。 */
  | { readonly kind: 'none' }
  | { readonly kind: 'close' }
  | { readonly kind: 'switchTab'; readonly tab: SettingsTab }
  | { readonly kind: 'resetKeys'; readonly notice: 'keysResetDone' }
  /**
   * 正在改键时点到另一个格子：**换按钮位**。
   *
   * ⚠️ `from`/`to` 任一为 -1 时**只重画、不改焦点**（老代码的行为：
   * 不在表里的技能点不出可换的位置，但界面仍要重画）。
   */
  | { readonly kind: 'swapSlots'; readonly from: number; readonly to: number }
  | { readonly kind: 'focusSkill'; readonly skillId: string }
  /** 选中它**并且**开始改键（再点一次已选中的格子，等价键盘的 Enter）。 */
  | { readonly kind: 'captureSkill'; readonly skillId: string }
  /**
   * ================================================================
   * 右下角**模拟键位**上的两步交互（用户 2026-10-12 定案）
   * ================================================================
   *
   *   ① 点一个键位 → `selectSlot`（再点一次 → `deselectSlot`）
   *   ② 点一个技能 → `assignTouchSlot`（绑定 / 交换）
   *   ③ 点**那个键位上已有的**技能 → `clearTouchSlot`（取下）
   *
   * ⚠️ 三个判定都来自 `slotActions`（**鼠标与键盘共用同一份**），
   * 这里只是把它接进派发链 —— 两处各写一遍必然漂。
   */
  | { readonly kind: 'selectSlot'; readonly index: number }
  | { readonly kind: 'deselectSlot' }
  | { readonly kind: 'assignTouchSlot'; readonly slot: number; readonly skillId: string }
  | { readonly kind: 'clearTouchSlot'; readonly slot: number }
  /** 「触屏默认」按钮：回到"默认键位表里那些有键的技能"（截到容量）。 */
  | { readonly kind: 'resetTouch'; readonly notice: 'touchResetDone' }
  /** 拖 / 点 UI 缩放滑块：由横坐标反算倍数。 */
  | { readonly kind: 'setScaleFromPointer'; readonly px: number };

export interface PanelDispatchInput {
  readonly visible: boolean;
  readonly tab: SettingsTab;
  /** **这个来源下可见的 tab**（首页只有「通用」）—— 命中测试要用。 */
  readonly tabs: readonly SettingsTab[];
  readonly px: number;
  readonly py: number;
  readonly rowSkillIds: readonly string[];
  /** 触屏槽位表（下标 = 槽位，`''` = 空）。 */
  readonly slotSkillIds: readonly string[];
  /** 当前选中的键位（没有则 `undefined`）。 */
  readonly selectedSlot: number | undefined;
  readonly focus: SettingsFocus;
  /** 正在改键的技能 id（undefined = 没在捕获）。 */
  readonly capturingSkillId: string | undefined;
  /** 是否显示键名 —— 它决定网格度量，必须与渲染同源（见 `logic.ts` 的 `hitTest`）。 */
  readonly showKeyHints: boolean;
}

/**
 * 点一下某个位置。命中测试自己算（不做逐对象事件绑定）—— 弹窗只有
 * 十几个可点区域，"第一个命中的"循环就够，也比 Pixi 的事件系统更容易
 * 在测试里驱动。
 */
export function resolvePanelDispatch(input: PanelDispatchInput): PanelDispatch {
  if (!input.visible) return { kind: 'none' };

  const target = hitTestLogic(input.px, input.py, {
    tab: input.tab,
    tabs: input.tabs,
    rowSkillIds: input.rowSkillIds,
    showKeyHints: input.showKeyHints,
  });

  switch (target.kind) {
    case 'outside':
      return { kind: 'close' };
    case 'tab':
      return { kind: 'switchTab', tab: target.tab };
    case 'resetKeys':
      return { kind: 'resetKeys', notice: 'keysResetDone' };
    case 'resetTouch':
      /**
       * ⚠️ 「触屏默认」是**另一个按钮**（与「恢复默认」并排），不是
       * "当前页不同、含义不同" —— 两者现在同处「按键」页，语义必须靠
       * **位置**分开（`touchResetButtonRect`）。见 `KeysFooter`。
       */
      return { kind: 'resetTouch', notice: 'touchResetDone' };
    case 'slot':
      /** ① 点键位：选中 / 取消选中（判定在 `slotActions`）。 */
      return resolveSlotTap(input.selectedSlot, target.index);
    case 'keyRow': {
      /**
       * ==============================================================
       * ② 已选中键位时：点技能 = **绑到这个键位**（用户要的两步交互）
       * ==============================================================
       *
       * ⚠️ 这里**先于** `resolveRowTap` 分流：那一套（选中 → 再点进改键）
       * 是"改键"的语义，在"已经选中了一个键位"的时候不该抢走这次点击 ——
       * 玩家那一刻的意图明确是"把这个技能放到那个键位上"。
       *
       * 判定在 `slotActions.resolveSlotBind`（键盘那条路用同一个函数）。
       */
      if (input.selectedSlot !== undefined) {
        return resolveSlotBind(input.selectedSlot, input.slotSkillIds, target.skillId);
      }
      const action = resolveRowTap({
        focusedSkillId: focusedSkillIdOf(input.focus, input.rowSkillIds),
        capturingSkillId: input.capturingSkillId,
        touchedSkillId: target.skillId,
      });
      if (action.kind === 'bind') {
        /**
         * ⚠️ 触屏要的是**换位置**，不是换键 —— 触屏按钮顺序来自绑定表
         * 顺序，而改键只换键、不动顺序。详见 `app/bindingActions.ts`。
         */
        const from = input.rowSkillIds.findIndex((id) => id === input.capturingSkillId);
        const to = input.rowSkillIds.findIndex((id) => id === action.skillId);
        return { kind: 'swapSlots', from, to };
      }
      if (action.kind === 'capture') {
        /**
         * ⚠️ 顺序是"先选中、再进改键"（面板执行时两步都做）——
         * 与键盘的"方向键选中 → Enter"完全一致，见 `resolveRowTap` 的说明。
         */
        return { kind: 'captureSkill', skillId: target.skillId };
      }
      return { kind: 'focusSkill', skillId: target.skillId };
    }
    case 'close':
      // 曾经只是 Label、没有命中测试 → 点了没反应（已修）
      return { kind: 'close' };
    case 'scaleSlider':
      /**
       * 鼠标点/拖滑块：由横坐标直接反算倍数（点到哪跳到哪）。
       *
       * 需求："ui 缩放的 slider 还是要支持鼠标。"
       * 拖动也能用，因为主循环每次 pointerdown / pointermove 都会
       * 走到这里 —— 面板不需要自己维护"是否在拖"的状态。
       */
      return { kind: 'setScaleFromPointer', px: input.px };
    case 'none':
      // 点在弹窗内的空白处：消费掉，不穿透到战斗
      return { kind: 'none' };
  }
}

/* ------------------------------------------------------------------ *
 * 按键
 * ------------------------------------------------------------------ */

export interface KeyDispatchInput {
  readonly visible: boolean;
  readonly key: string;
  readonly capturingSkillId: string | undefined;
  /** 当前焦点（`activate` 要靠它解析出"激活了谁"）。 */
  readonly focus: SettingsFocus;
  readonly rowSkillIds: readonly string[];
  /** **可见的 tab 表**（`Enter` 落在 tab 行时要解析出是哪一页）。 */
  readonly tabs: readonly SettingsTab[];
  /** 触屏槽位表（下标 = 槽位，`''` = 空）—— 见 `focus.slots`。 */
  readonly slotSkillIds: readonly string[];
  /** 当前选中的键位（`Enter` 在技能格上时决定"改键"还是"绑键位"）。 */
  readonly selectedSlot: number | undefined;
}

/** `handleKey` 的决策结果：面板拿 `action` / `activate` 去执行，`trace` 记轨迹。 */
export interface KeyPanelDispatch {
  readonly action: KeyAction;
  /**
   * `action.kind === 'activate'` 时已经解析好的动作（切 tab / 进改键 /
   * 恢复默认 / 关闭）—— 免得面板再调一次 `resolveActivate`。
   */
  readonly activate: ActivateAction | undefined;
  /**
   * 给 `settingsTrace` 的那一行 —— 把轨迹文本与决策放在一起，
   * 面板里不再有第二处 `resolveKeyAction` 调用。
   */
  readonly trace: string;
}

/**
 * 键盘输入（弹窗打开时由主循环转发）。
 *
 * ⚠️ 没打开时 `trace` 为空（不记轨迹）—— 老的 `handleKey` 第一行就是
 * `if (!this.visible) return false;`，没打开时什么都不做。
 */
export function resolveKeyDispatch(input: KeyDispatchInput): KeyPanelDispatch {
  if (!input.visible) {
    return { action: { kind: 'ignore' }, activate: undefined, trace: '' };
  }

  const action = resolveKeyAction(input.key, input.capturingSkillId !== undefined);
  const trace = `handleKey(${input.key}) cap=${input.capturingSkillId ?? '-'} -> ${action.kind}`;
  const activate =
    action.kind === 'activate'
      ? resolveActivate({
          focus: input.focus,
          tabs: input.tabs,
          rowSkillIds: input.rowSkillIds,
          slotSkillIds: input.slotSkillIds,
          selectedSlot: input.selectedSlot,
        })
      : undefined;

  return { action, activate, trace };
}

/* ------------------------------------------------------------------ *
 * 方向键
 * ------------------------------------------------------------------ */

/**
 * 方向键移动后的新焦点。
 *
 * ⚠️ **slider 焦点的左右是"调值"、不是"移动焦点"** —— 那种情况在这里
 * 返回 `undefined`，执行层看到之后就去调滑块（与老的 `handleKey` 的
 * `move` 分支同一判据，只是把"调值"这一步留给画滑块的人做）。
 */
export function resolveMoveFocus(input: {
  readonly focus: SettingsFocus;
  readonly direction: Direction;
  /** 这一页有什么（tab 数 / 格子数 / 有没有键位区与按钮）—— 见 `FocusContext`。 */
  readonly ctx: FocusContext;
}): SettingsFocus | undefined {
  const horizontal = input.direction === 'left' || input.direction === 'right';
  if (input.focus.zone === 'slider' && horizontal) return undefined;
  return moveFocus(input.focus, input.direction, input.ctx);
}

/** Tab / Shift+Tab 在较大区域之间切换（见 `focus.cycleZone`）。 */
export function resolveCycleFocus(input: {
  readonly focus: SettingsFocus;
  readonly ctx: FocusContext;
  readonly back: boolean;
}): SettingsFocus {
  return cycleZone(input.focus, input.ctx, input.back);
}

/* ------------------------------------------------------------------ *
 * 点击 · 执行
 * ------------------------------------------------------------------ */

/**
 * `resolvePanelDispatch` 的结果要碰的那些外部世界。
 *
 * 面板把这些接进来，执行层就**不碰 Pixi** —— 于是"点一下会发生什么"
 * 整个决策 + 执行都在本文件里，可以直接单测（`SettingsPanel.ts` 那种
 * 自己构造 Pixi 对象的类在 jsdom 里不好跑，见 `logic.ts` 文件头）。
 */
export interface PanelActionBindings {
  readonly close: () => void;
  readonly switchTab: (tab: SettingsTab) => void;
  readonly resetKeys: () => void;
  /** 「触屏默认」按钮：恢复默认键位表。 */
  readonly resetTouch: () => void;
  /** 提示文案（来自 i18n），执行层只负责把它交给 `notice`。 */
  readonly notice: (text: string) => void;
  readonly swapSlots: (from: number, to: number) => void;
  readonly focusSkill: (skillId: string) => void;
  readonly startCapture: (skillId: string) => void;
  /** 选中 / 取消选中一个触屏键位（两步交互的第一步）。 */
  readonly selectSlot: (index: number) => void;
  readonly deselectSlot: () => void;
  /** 把技能绑到某个键位（含交换 / 顶掉）。 */
  readonly assignTouchSlot: (slot: number, skillId: string) => void;
  /** 取下某个键位上的技能。 */
  readonly clearTouchSlot: (slot: number) => void;
  readonly uiScale: (value: number) => void;
  /** 执行完之后画一遍（面板的重绘入口）。 */
  readonly redraw: () => void;
}

/**
 * 把 `PanelDispatch` 执行掉。
 *
 * @returns 是否消费了这次点击（与老 `hitTest` 的返回值同义）。
 */
export function executePanelDispatch(
  action: PanelDispatch,
  do_: PanelActionBindings,
): boolean {
  switch (action.kind) {
    case 'close':
      do_.close();
      return true;
    case 'switchTab':
      do_.switchTab(action.tab);
      return true;
    case 'resetKeys':
      do_.resetKeys();
      do_.notice('settings.keysResetDone');
      do_.redraw();
      return true;
    case 'resetTouch':
      do_.resetTouch();
      do_.notice('settings.touchResetDone');
      do_.redraw();
      return true;
    case 'selectSlot':
      do_.selectSlot(action.index);
      do_.redraw();
      return true;
    case 'deselectSlot':
      do_.deselectSlot();
      do_.redraw();
      return true;
    case 'assignTouchSlot':
      /**
       * ⚠️ **绑完就取消选中**（"这次指派完成了"）。
       *
       * 不取消的话，下一次点技能会**静默**改掉这个键位 —— 玩家只是想
       * 看看别的技能，结果把刚配好的键位换了。要配下一个键位就再点一个，
       * 反正每配一个键位本来就要点一次它。
       */
      do_.assignTouchSlot(action.slot, action.skillId);
      do_.deselectSlot();
      do_.redraw();
      return true;
    case 'clearTouchSlot':
      /** ⚠️ 取下之后**保留选中**：玩家多半是想换一个技能放上来。 */
      do_.clearTouchSlot(action.slot);
      do_.redraw();
      return true;
    case 'swapSlots':
      /**
       * `from`/`to` 任一为 -1 时**只重画、不改焦点** —— 老代码就是这个
       * 形状（`if (from >= 0 && to >= 0) { ... }` 之后无条件 `redraw()`）。
       */
      if (action.from >= 0 && action.to >= 0) {
        do_.swapSlots(action.from, action.to);
      }
      do_.redraw();
      return true;
    case 'captureSkill':
      /**
       * ⚠️ 顺序是"先选中、再进改键" —— 与键盘的"方向键选中 → Enter"
       * 完全一致（见 `resolveRowTap` 的说明）。
       */
      do_.focusSkill(action.skillId);
      do_.startCapture(action.skillId);
      do_.redraw();
      return true;
    case 'focusSkill':
      do_.focusSkill(action.skillId);
      return true;
    case 'setScaleFromPointer':
      /**
       * 鼠标点/拖滑块：由横坐标直接反算倍数（点到哪跳到哪）。
       *
       * 需求："ui 缩放的 slider 还是要支持鼠标。"
       * 拖动也能用，因为主循环每次 pointerdown / pointermove 都会
       * 走到这里 —— 面板不需要自己维护"是否在拖"的状态。
       */
      do_.uiScale(uiScaleFromPointer(action.px));
      do_.redraw();
      return true;
    case 'none':
      // 点在弹窗内的空白处：消费掉，不穿透到战斗
      return true;
  }
}

/* ------------------------------------------------------------------ *
 * 按键 · 执行
 * ------------------------------------------------------------------ */

/** `executeKeyPanelAction` 要碰的那些外部世界（与 `PanelActionBindings` 分开定义）。 */
export interface KeyActionBindings {
  readonly close: () => void;
  readonly switchTab: (tab: SettingsTab) => void;
  readonly resetKeys: () => void;
  /** 「触屏默认」按钮：恢复默认键位表。 */
  readonly resetTouch: () => void;
  /** 提示文案（来自 i18n）。 */
  readonly notice: (text: string) => void;
  /** 把某个技能改绑到某个键（收尾由 `finishCapture` 做）。 */
  readonly rebind: (skillId: string, key: string) => void;
  /** 选中 / 取消选中 / 绑定 / 取下——触屏键位的两步交互（与鼠标同一份判定）。 */
  readonly selectSlot: (index: number) => void;
  readonly deselectSlot: () => void;
  readonly assignTouchSlot: (slot: number, skillId: string) => void;
  readonly clearTouchSlot: (slot: number) => void;
  readonly startCapture: (skillId: string, triggerKey?: string) => void;
  readonly stopCapture: () => void;
  readonly finishCapture: (key: string) => void;
  readonly moveFocus: (direction: 'up' | 'down' | 'left' | 'right') => SettingsFocus | undefined;
  readonly cycleFocus: (back: boolean) => SettingsFocus;
  readonly nudgeSlider: (direction: -1 | 1) => void;
  /** 焦点是否需要更新（undefined = 不变）。 */
  readonly redraw: () => void;
}

/**
 * 一次按键的**执行结果**（纯数据，面板照着改状态）。
 */
export interface KeyExecutionResult {
  readonly consumed: boolean;
  /** 焦点的新值（undefined = 不变）。 */
  readonly focus?: SettingsFocus | undefined;
  /** 滑块要调的方向（undefined = 不动滑块）。 */
  readonly nudgeSlider?: -1 | 1 | undefined;
  /**
   * 这次按键是否需要重画。**省略即"需要"** —— 只有确实什么都没改的
   * 路径（`ignore`）才显式给 `false`。
   *
   * ==================================================================
   * ⚠️ 为什么要有这个字段（重构时踩的回归）
   * ==================================================================
   *
   * 重构把"各分支自己重画"改成了"`handleKey` 末尾统一重画一次"。
   * 那样更不容易漏重画，但**把 `ignore` 也带上了**，而原来的 `ignore`
   * 分支是不重画的。
   *
   * 这在本作里不是小事 —— `settingsKeys` 的 keydown **没有过滤
   * `event.repeat`**，所以**按住一个与设置无关的键，会以按键重复率
   * 反复重画整个设置面板**（几百个 Pixi 对象）。旧代码按住是零开销。
   */
  readonly redraw?: boolean | undefined;
}

export interface KeyPanelActionInput {
  readonly action: KeyAction;
  /** `action.kind === 'activate'` 时由 `resolveKeyDispatch` 解析好的动作。 */
  readonly activate: KeyPanelDispatch['activate'];
  /** 触发这次激活的**原始键名**（`startCapture` 要靠它作废那一次按键）。 */
  readonly key: string;
}

/**
 * 把 `resolveKeyDispatch` 的结果执行成数据。
 *
 * 命令式的东西（开/关弹窗、改键）走 `do_`；会改变面板状态的东西
 * （焦点、滑块）走返回值 —— 于是这个函数自身**没有隐藏状态**。
 */
export function executeKeyPanelAction(
  input: KeyPanelActionInput,
  do_: KeyActionBindings,
): KeyExecutionResult {
  const { action } = input;
  switch (action.kind) {
    case 'cancelCapture':
      do_.stopCapture();
      return { consumed: true };
    case 'closePanel':
      do_.close();
      return { consumed: true };
    case 'capture':
      /**
       * ==============================================================
       * 由**面板自己**完成捕获，不依赖输入层
       * ==============================================================
       *
       * 原先这里只 `return true`（"捕获模式下输入层直接回调"）—— 那个
       * 假设**在备战界面不成立**：
       *
       *   `main.ts` 的接线是 `capture: (h) => battle()?.inputSource?.capture(h)`，
       *   而**备战界面上 `battle()` 是 `undefined`**（还没开局）。
       *   于是捕获回调根本没注册，`finishCapture` 永远收不到键 ——
       *   表现为"点进改键了、按键毫无反应"。
       *
       * 而设置齿轮**就在备战界面上**，所以最常规的路径 100% 坏。
       *
       * 面板本来就通过 `handleKey` 收到每一个按键，所以直接在这里收尾：
       *   - 备战界面：没有输入层 → 全靠这里 ✅
       *   - 战斗界面：面板先处理（`settingsKeys` 在**捕获阶段**），
       *     收尾时 `stopCapture()` 已经 `onCapture(undefined)`，
       *     于是输入层在冒泡阶段**不会**再投递一次 → 不会双重绑定 ✅
       */
      do_.finishCapture(action.key);
      return { consumed: true };
    case 'mnemonic': {
      /**
       * 助记键直达（G / K / R / S）。
       *
       * ⚠️ 每个分支都**同时移动焦点** —— 否则按完 G 之后 `Enter` 还会
       * 作用在原位置上，玩家会觉得"键没生效"。
       */
      switch (action.target) {
        case 'tabGeneral':
          do_.switchTab('general');
          return { consumed: true, focus: { zone: 'tabs', index: 0 } };
        case 'tabKeys':
          do_.switchTab('keys');
          return { consumed: true, focus: { zone: 'tabs', index: 1 } };
        case 'resetKeys':
          // 恢复默认属于按键页 —— 先切过去，玩家才看得到结果
          do_.switchTab('keys');
          do_.resetKeys();
          do_.notice('settings.keysResetDone');
          return { consumed: true };
        case 'slider':
          /**
           * UI 缩放只在通用页存在，所以先切页 —— 否则焦点会落在一个
           * 不可见的控件上（那正是之前「滑块漏到按键页」那类 bug 的温床）。
           */
          do_.switchTab('general');
          return { consumed: true, focus: { zone: 'slider' } };
      }
    }
    case 'move': {
      /**
       * slider 焦点下，**左右是"调值"而不是"移动焦点"**。
       *
       * 需求："设置的通用里，加一个 UI 缩放的 slide，可以调整所有 UI 的比例"，
       * 而本项目要求"几乎全键盘可操作"，所以 slider 必须能纯键盘调。
       * 上下仍然用于离开这一项（回 tab 行 / 去恢复按钮）。
       */
      const next = do_.moveFocus(action.direction);
      if (next === undefined) {
        return {
          consumed: true,
          nudgeSlider: action.direction === 'right' ? 1 : -1,
        };
      }
      return { consumed: true, focus: next };
    }
    case 'cycle':
      return { consumed: true, focus: do_.cycleFocus(action.back) };
    case 'activate': {
      /** ⚠️ 把键传下去：`startCapture` 要靠它作废"触发改键的那一次按键"。 */
      const activate = input.activate;
      if (activate === undefined) return { consumed: true };
      switch (activate.kind) {
        case 'switchTab':
          do_.switchTab(activate.tab);
          return { consumed: true };
        case 'startCapture':
          do_.startCapture(activate.skillId, input.key);
          return { consumed: true };
        /**
         * ============================================================
         * 触屏键位的两步交互（键盘这条路与鼠标**同一份判定**）
         * ============================================================
         *
         * ⚠️ 这里**不改焦点**：
         *   - `selectSlot` 时焦点本来就在键位区（Enter 是它解析出来的）
         *   - `assignTouchSlot` 时焦点在技能格上，而"绑完就取消选中"
         *     之后玩家接着按方向键就是在技能格之间走 —— 正是他想要的
         */
        case 'selectSlot':
          do_.selectSlot(activate.index);
          return { consumed: true };
        case 'deselectSlot':
          do_.deselectSlot();
          return { consumed: true };
        case 'assignTouchSlot':
          do_.assignTouchSlot(activate.slot, activate.skillId);
          do_.deselectSlot();
          return { consumed: true };
        case 'clearTouchSlot':
          do_.clearTouchSlot(activate.slot);
          return { consumed: true };
        case 'resetKeys':
          do_.resetKeys();
          do_.notice('settings.keysResetDone');
          return { consumed: true };
        case 'resetTouch':
          do_.resetTouch();
          do_.notice('settings.touchResetDone');
          return { consumed: true };
        case 'close':
          do_.close();
          return { consumed: true };
        case 'none':
          return { consumed: true };
      }
    }
    case 'ignore':
      /**
       * ⚠️ 唯一显式 `redraw: false` 的路径。
       *
       * 什么都没改就没有重画的理由，而按住键会**以按键重复率**打到这里
       * （`settingsKeys` 不过滤 `event.repeat`）。详见 `KeyExecutionResult.redraw`。
       */
      return { consumed: true, redraw: false };
  }
}

