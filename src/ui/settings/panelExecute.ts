/**
 * **设置面板的输入执行** —— "决策出来的那件事怎么落地"（点击与按键两套）。
 *
 * ==================================================================
 * 为什么从 `panelDispatch.ts` 切出来
 * ==================================================================
 *
 * `panelDispatch.ts` 在加了"按操作方式分两块"之后到了 **697 行**（AGENTS.md
 * §3 的上限是 700）—— 而这一轮还要往里加东西（触屏块的 `resetTouch`、
 * 「通用」页切操作方式）。按 §3 的顺序**不许压注释**，要么拆 util、要么
 * 横向切割 —— 这里做的是后者：
 *
 *   决策（`panelDispatch`）  "这次点击 / 这次按键该做什么"
 *   执行（本文件）            "把那个动作落到实处"（关窗 / 改键 / 重画…）
 *
 * 两者本来就是两件事：决策是**纯函数**（可以在 node 里精确测），执行要碰
 * 外部世界（回调），所以执行这边只收一个 `do_` 绑定对象 —— 一样的纪律，
 * 一样的可测性。切完之后 `panelDispatch.ts` 回到 ~440 行，本文件 ~400 行。
 *
 * ⚠️ `PanelDispatch` / `KeyAction` 这些**形状**仍定义在决策那边（是谁产生
 * 的、谁定义），这里只 `import type` —— 类型在编译期擦除，不构成运行期环。
 */

import type { KeyAction, SettingsFocus } from './logic';
import { uiScaleFromPointer } from './logic';
import type { SettingsTab } from './tabs';
import type { OperationMode } from '../../render/platform';
import type { PanelDispatch, KeyPanelDispatch } from './panelDispatch';

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
  /** 「通用」页切操作方式（唯一 flag 的写入点，落点在 `app/game.ts`）。 */
  readonly switchOperationMode: (mode: OperationMode) => void;
  /** 恢复**键盘**键位（键盘块那个按钮）。 */
  readonly resetKeys: () => void;
  /** 恢复**触屏**键位（触屏块那个按钮）。 */
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
    case 'switchOperationMode':
      /**
       * ⚠️ 切完之后**由落点负责重画**（`app/game.ts` 的 `applyOperationMode`
       * 会写状态、存档、键位表，并让面板重画）—— 执行层在这里再画一次
       * 会画到"还没切"的那一帧上。
       */
      do_.switchOperationMode(action.mode);
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
  /** 「通用」页切操作方式（唯一 flag 的写入点）。 */
  readonly switchOperationMode: (mode: OperationMode) => void;
  /** 恢复**键盘**键位（键盘块那个按钮）。 */
  readonly resetKeys: () => void;
  /** 恢复**触屏**键位（触屏块那个按钮）。 */
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
        /**
         * ⚠️ **两块各自的「恢复默认」**（不再"同一个按钮按设备分流"）：
         * 焦点模型只回答"玩家按了哪一块里的按钮"（`resetKeys` / `resetTouch`），
         * 而哪一个动作对应哪一块是**结构上定死**的 —— 不需要设备判断。
         * 见 `settingsGeometry.RESET_BUTTON` 那段"为什么不再是同一个按钮"。
         */
        case 'resetKeys':
          do_.resetKeys();
          do_.notice('settings.keysResetDone');
          return { consumed: true };
        case 'resetTouch':
          do_.resetTouch();
          do_.notice('settings.touchResetDone');
          return { consumed: true };
        case 'switchOperationMode':
          do_.switchOperationMode(activate.mode);
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

