/**
 * 面板对外的**动作面**（把"面板现在能做什么"交给纯决策层）。
 *
 * ==================================================================
 * 为什么单独一个文件（第四次给 `SettingsPanel.ts` 让位）
 * ==================================================================
 *
 * `SettingsPanel.ts` 每次触到 700 行（AGENTS.md §3）都会被切一刀 ——
 * 这一刀切的是**最机械的一块**：把回调、焦点、改键会话拼成一个
 * `PanelActions` 对象。它自身**没有任何判断**（判断在 `panelDispatch`），
 * 所以很适合搬出来：面板只剩"状态 + 输入入口"，一眼读得完。
 *
 * ⚠️ 这里**不持有状态**：所有状态都通过 `deps` 的取值函数**当场读**
 * （`focus` / `rows` / `selectedSlot` 都会变）。传值快照就会让
 * "按了一次键之后动作面还停在旧焦点上"。
 */

import type { PanelActions } from './panelWiring';
import type { Direction, FocusContext, SettingsFocus } from './focus';
import { resolveCycleFocus, resolveMoveFocus } from './panelDispatch';
import type { OperationMode } from '../../render/platform';
import type { KeyRow } from './rows';

/**
 * 动作面要读/改的面板内部状态。
 *
 * ⚠️ 全是**函数**（除了那些"永远不变"的回调）：焦点、行表、选中的键位
 * 都在面板生命周期里变，传值会在下一次按键时变成陈旧的快照 ——
 * 那种 bug 的表现是"按了方向键，动作还作用在上一个格子上"。
 */
export interface PanelActionDeps {
  /** 关闭弹窗。 */
  readonly close: () => void;
  /** **底部「回主菜单」**（2026-10-22）：面板只发起询问。 */
  readonly exitToHome: () => void;
  readonly switchTab: (tab: Parameters<PanelActions['switchTab']>[0]) => void;
  /** 「通用」页切操作方式（唯一 flag 的写入点）。 */
  readonly switchOperationMode: (mode: OperationMode) => void;
  /** 恢复**键盘**键位（键盘块那个按钮）。 */
  readonly resetKeys: () => void;
  /** 恢复**触屏**键位（触屏块那个按钮）。 */
  readonly resetTouch: () => void;
  /** 提示一行（已翻译的文案）。 */
  readonly notice: (text: string) => void;
  readonly rebind: (skillId: string, key: string) => void;
  /** 换位（内部会先停掉改键会话 —— 见下面 `swapSlots` 的说明）。 */
  readonly swapSlots: (from: number, to: number) => void;
  readonly stopCapture: () => void;
  readonly focusSkill: (skillId: string) => void;
  readonly startCapture: (skillId: string, triggerKey?: string) => void;
  readonly finishCapture: (key: string) => void;
  readonly selectSlot: (index: number) => void;
  readonly deselectSlot: () => void;
  readonly assignTouchSlot: (slot: number, skillId: string) => void;
  readonly clearTouchSlot: (slot: number) => void;
  readonly nudgeSlider: (direction: -1 | 1) => void;
  readonly uiScale: (value: number) => void;
  readonly redraw: () => void;
  /** 当前焦点（**每次读**，不是快照）。 */
  readonly focus: () => SettingsFocus;
  /** 当前键位行（**每次读**）。 */
  readonly rows: () => readonly KeyRow[];
  /** 焦点模型要的上下文（可见 tab 数 / 格数 / 有没有键位区）。 */
  readonly focusContext: () => FocusContext;
  /** 当前选中的触屏键位（没有则 `undefined`）。 */
  readonly selectedSlot: () => number | undefined;
}

/**
 * 造动作面。
 *
 * ⚠️ **一处实现、两处接线**（`hitTest` 与 `handleKey` 都调它）：原先两处
 * 各写一份绑定，字段名还对不上（`toggleTouch` vs `rebind`）—— 那种
 * "两份接线"漏一个字段的表现是**某个入口静默失效**。
 */
export function buildPanelActions(d: PanelActionDeps): PanelActions {
  return {
    close: () => d.close(),
    /** 底部「回主菜单」：只发起询问（确认后由装配方执行）。 */
    exitToHome: () => d.exitToHome(),
    switchTab: (tab) => d.switchTab(tab),
    switchOperationMode: (mode) => d.switchOperationMode(mode),
    /**
     * ⚠️ 两个恢复**各自接给自己的那一块**——"哪个会被调用"由"点在哪个块
     * 里的按钮"决定（见 `focus` 的 `reset` / `touchReset` 两个区），
     * 不再由任何设备判断分流。
     */
    resetKeys: () => d.resetKeys(),
    resetTouch: () => d.resetTouch(),
    notice: (text) => d.notice(text),
    rebind: (skillId, key) => d.rebind(skillId, key),
    swapSlots: (from, to) => {
      /**
       * ⚠️ 换位**先停改键会话**：换位改的是"哪个技能在哪个槽位"，
       * 而改键会话正等着一个按键 —— 留着它会让接下来那一下既换位又改键。
       */
      d.stopCapture();
      d.swapSlots(from, to);
    },
    focusSkill: (skillId) => d.focusSkill(skillId),
    startCapture: (skillId, triggerKey) => d.startCapture(skillId, triggerKey),
    stopCapture: () => d.stopCapture(),
    finishCapture: (key) => d.finishCapture(key),
    selectSlot: (index) => d.selectSlot(index),
    deselectSlot: () => d.deselectSlot(),
    assignTouchSlot: (slot, skillId) => d.assignTouchSlot(slot, skillId),
    clearTouchSlot: (slot) => d.clearTouchSlot(slot),
    moveFocus: (direction: Direction) =>
      resolveMoveFocus({ focus: d.focus(), direction, ctx: d.focusContext() }),
    cycleFocus: (back: boolean) =>
      resolveCycleFocus({ focus: d.focus(), ctx: d.focusContext(), back }),
    nudgeSlider: (direction) => d.nudgeSlider(direction),
    uiScale: (value) => d.uiScale(value),
    redraw: () => d.redraw(),
  };
}
