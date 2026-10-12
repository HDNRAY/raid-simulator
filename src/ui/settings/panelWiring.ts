/**
 * **面板能力 → 派发层**的接线。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 顶到 700 行上限（AGENTS.md §3）。按那里的规则 ——
 * **不许靠删/压注释解决，要拆 util 或横向切割** —— 这里切的是
 * "面板把自己那十来样能力交给纯决策层"这一块：
 *
 *   `hitTest`         → `executePanelDispatch(action, bindings)`
 *   `handleKey`       → `executeKeyPanelAction(input, bindings)`
 *
 * 两块绑定的**形状是同一样东西**（关窗 / 切页 / 改键 / 键位 / 重画…），
 * 原先在面板里各写一遍、字段名还对不上（`toggleTouch` vs `rebind`）。
 * 收成一个 `PanelActions` 之后：
 *
 *   - 面板只负责**实现**这些动作（`panelActions()` 一处）
 *   - 本文件负责**把它们接给**两个执行函数
 *
 * ⚠️ 它完全不碰 Pixi，也不认识面板的内部状态 —— 与 `panelDispatch`
 * 同一条纪律，所以能单独读、单独测。
 */

import {
  executeKeyPanelAction,
  executePanelDispatch,
  type KeyExecutionResult,
  type KeyPanelActionInput,
  type PanelDispatch,
} from './panelDispatch';
import type { Direction, SettingsFocus, SettingsTab } from './logic';

/**
 * 面板对外的**动作面**（点击与按键共用同一份）。
 *
 * ⚠️ 两个执行函数要的字段是**并集**：按键那条多了改键（`rebind` /
 * `finishCapture`）与调滑块，点击那条多了换位（`swapSlots`）与缩放。
 * 合成一个接口而不是两个：面板实现同一批东西，分成两个接口就要
 * 在面板里写两遍（而漏一个字段的表现是"某个入口静默失效"）。
 */
export interface PanelActions {
  readonly close: () => void;
  readonly switchTab: (tab: SettingsTab) => void;
  /** 恢复**键盘**键位（底部那个按钮在非触屏设备上的行为）。 */
  readonly resetKeys: () => void;
  /** 恢复**触屏**键位（同一个按钮在触屏设备上的行为）。 */
  readonly resetTouch: () => void;
  /**
   * 是不是触屏设备 —— 只用来决定那个按钮恢复谁。
   *
   * ⚠️ 函数而不是值：能力值由 `touchCapsSource` 在触屏层构造后**回填**
   * （见 `app/settingsSetup.ts`），构造期读到的是占位值。
   */
  readonly touch: () => boolean;
  /** 提示一行（已翻译的文案）。 */
  readonly notice: (text: string) => void;
  /** 把某个技能改绑到某个键（收尾由 `finishCapture` 做）。 */
  readonly rebind: (skillId: string, key: string) => void;
  /** 「按键」页换位：交换两个技能栏槽位。 */
  readonly swapSlots: (from: number, to: number) => void;
  readonly focusSkill: (skillId: string) => void;
  readonly startCapture: (skillId: string, triggerKey?: string) => void;
  readonly stopCapture: () => void;
  readonly finishCapture: (key: string) => void;
  /** 触屏键位的两步交互（选中 / 取消 / 绑定 / 取下）。 */
  readonly selectSlot: (index: number) => void;
  readonly deselectSlot: () => void;
  readonly assignTouchSlot: (slot: number, skillId: string) => void;
  readonly clearTouchSlot: (slot: number) => void;
  /** 焦点模型：方向键 / Tab（由面板用 `focusContext()` 算好上下文）。 */
  readonly moveFocus: (direction: Direction) => SettingsFocus | undefined;
  readonly cycleFocus: (back: boolean) => SettingsFocus;
  readonly nudgeSlider: (direction: -1 | 1) => void;
  readonly uiScale: (value: number) => void;
  readonly redraw: () => void;
}

/** 把一次点击执行掉（`SettingsPanel.hitTest` 的收尾）。 */
export function runPanelClick(action: PanelDispatch, a: PanelActions): boolean {
  return executePanelDispatch(action, {
    close: a.close,
    switchTab: a.switchTab,
    resetKeys: a.resetKeys,
    resetTouch: a.resetTouch,
    touch: a.touch,
    notice: a.notice,
    swapSlots: a.swapSlots,
    focusSkill: a.focusSkill,
    startCapture: a.startCapture,
    selectSlot: a.selectSlot,
    deselectSlot: a.deselectSlot,
    assignTouchSlot: a.assignTouchSlot,
    clearTouchSlot: a.clearTouchSlot,
    uiScale: a.uiScale,
    redraw: a.redraw,
  });
}

/** 把一次按键执行掉（`SettingsPanel.handleKey` 的收尾）。 */
export function runPanelKey(
  input: KeyPanelActionInput,
  a: PanelActions,
): KeyExecutionResult {
  return executeKeyPanelAction(input, {
    close: a.close,
    switchTab: a.switchTab,
    resetKeys: a.resetKeys,
    resetTouch: a.resetTouch,
    touch: a.touch,
    notice: a.notice,
    rebind: a.rebind,
    selectSlot: a.selectSlot,
    deselectSlot: a.deselectSlot,
    assignTouchSlot: a.assignTouchSlot,
    clearTouchSlot: a.clearTouchSlot,
    startCapture: a.startCapture,
    stopCapture: a.stopCapture,
    finishCapture: a.finishCapture,
    moveFocus: a.moveFocus,
    cycleFocus: a.cycleFocus,
    nudgeSlider: a.nudgeSlider,
    redraw: a.redraw,
  });
}
