/**
 * 设置面板的**指针输入转发**（拖动滑块 / 滚动与拖动技能说明）。
 *
 * ==================================================================
 * 为什么单独一个文件（面板又贴到 700 行）
 * ==================================================================
 *
 * 这一撮方法有一个共同点：**面板自己什么都不判断**，只是"面板此刻开不开
 * / 在哪一页"加"逻辑坐标落在哪块几何里"，然后把动作转给对应的部件。
 * 按 AGENTS.md §3 的顺序，这是典型的**拆 util**（纯转发 + 几何判定），
 * 而且它们一起构成"指针怎么进设置面板"这一个关注点。
 *
 * ⚠️ 面板**不挂**任何 DOM 监听：归属判定在 `app/canvasInput`，它算完
 * 逻辑坐标再调这里（复盘面板为"自己挂 `window` 监听"吃过一轮亏，
 * 见 `app/inputRouter` 的文件头）。所以本文件的坐标参数**都是逻辑坐标**
 * （960×540），不碰 `clientX/Y`。
 *
 * ⚠️ 纯函数、零 Pixi 依赖 —— 能在 node 里直接测（与 `panelDispatch`
 * 同一个理由）。
 */

import { contains, uiScaleFromPointer, uiScaleSliderRect, skillDetailRect } from './logic';
import type { SettingsTab } from './tabs';

/** 这一撮转发要读/改的那点面板状态。 */
export interface PointerTargets {
  /** 面板此刻可见吗（关着时任何指针都不该被它消费）。 */
  readonly visible: boolean;
  readonly tab: SettingsTab;
  /** 写回 UI 缩放（滑块用）。 */
  readonly setUiScale: (value: number) => void;
  /** 重画（滑块拖完要立刻反映）。 */
  readonly redraw: () => void;
  /**
   * 技能详情区的**滚轮**（本文件唯一要调它的地方）。
   *
   * ⚠️ 只收滚轮：拖动那三个（`pointerDown/Move/Up`）在面板里就是一行
   * 转发（见 `SettingsPanel.detailPointerDown`），绕到这里没有意义 ——
   * 契约越小，"谁在消费指针"越清楚（与 `CanvasInputReviewSource` 同一条）。
   */
  readonly wheelDetail: (deltaY: number, deltaMode: number) => boolean;
}

/** 「按键」页才有的详情区在不在（它是这一撮里唯一跟页有关的东西）。 */
function onKeysPage(t: PointerTargets): boolean {
  return t.tab !== 'general';
}

/**
 * 某个逻辑坐标是否落在通用页的滑块上（拖动拖拽用）。
 *
 * ⚠️ "是不是通用页"必须与 `hitTest` 的判据一致（那里也只在
 * `tab === 'general'` 时返回 `scaleSlider`）—— 两处各写一遍就会出现
 * "看得到把手、拖不动"。
 */
export function isOnScaleSlider(t: PointerTargets, px: number, py: number): boolean {
  return t.visible && t.tab === 'general' && contains(uiScaleSliderRect(), px, py);
}

/** 某个逻辑坐标是否落在**技能详情区**上（「按键」页）。 */
export function isOnDetail(t: PointerTargets, px: number, py: number): boolean {
  return t.visible && onKeysPage(t) && contains(skillDetailRect(), px, py);
}

/**
 * 详情区滚轮。
 *
 * ⚠️ 只在详情区**真的滚得动**时返回 `true` —— 调用方据此决定要不要
 * `preventDefault`（内容装得下时，页面滚动不是本面板的事）。
 */
export function wheelDetail(
  t: PointerTargets,
  px: number,
  py: number,
  deltaY: number,
  deltaMode: number,
): boolean {
  if (!isOnDetail(t, px, py)) return false;
  return t.wheelDetail(deltaY, deltaMode);
}

/**
 * 拖拽滑块到某个横坐标（由 `canvasInput` 在 `pointermove` 时调用）。
 *
 * ⚠️ 只在通用页生效：切页之后残留的那次拖动不该改缩放（页都换了一块，
 * 手势本来就该结束 —— `canvasInput` 那边也会在 `pointerup` 清标志）。
 */
export function dragScaleSlider(t: PointerTargets, px: number): void {
  if (t.tab !== 'general') return;
  t.setUiScale(uiScaleFromPointer(px));
  t.redraw();
}
