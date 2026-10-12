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
import { pickerAreaRect, pickerMetrics } from './touchPickerLayout';
import type { SettingsTab } from './tabs';
import type { OperationMode } from '../../render/platform';

/** 这一撮转发要读/改的那点面板状态。 */
export interface PointerTargets {
  /** 面板此刻可见吗（关着时任何指针都不该被它消费）。 */
  readonly visible: boolean;
  readonly tab: SettingsTab;
  /** 当前操作方式 —— 决定「按键」页有没有触屏技能面可滚。 */
  readonly mode: OperationMode;
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
  /** 触屏**技能面**滚轮（正数 = 往下，一格一行）；越界时由面板钳位。 */
  readonly wheelPicker: (delta: number) => void;
  /** 技能池大小（技能面能不能滚要看它）。 */
  readonly rowCount: () => number;
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
 * 触屏**技能面**滚轮。
 *
 * ⚠️ 只在"这一面真的画得出来、而且真的滚得动"时返回 `true` —— 调用方据此
 * 决定要不要 `preventDefault`（与 `wheelDetail` 同一条判据：内容装得下时
 * 页面滚动不是本面板的事）。
 *
 * ⚠️ 一行 = `deltaMode` 归一化之后的一个"格"：像素模式下按 40px 折算
 * （与详情区同一档手感），行/页模式直接当一格。
 */
export function wheelPicker(
  t: PointerTargets,
  px: number,
  py: number,
  deltaY: number,
): boolean {
  if (!t.visible || t.tab === 'general' || t.mode !== 'touch') return false;
  const area = pickerAreaRect();
  if (!contains(area, px, py)) return false;
  /** 装得下就不消费（免得替页面挡掉滚动）。 */
  const metrics = pickerMetrics(t.rowCount());
  if (metrics.cols * metrics.rows >= t.rowCount()) return false;
  const step = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0;
  if (step !== 0) t.wheelPicker(step);
  return true;
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

/* ------------------------------------------------------------------ *
 * 面板的**指针路由表**（把上面那几件"谁在消费这次指针"装成一组）
 * ------------------------------------------------------------------ *
 * ⚠️ 抽成工厂而不是让 `SettingsPanel` 自己留 7 个转发方法：那些方法
 * （`isOnScaleSlider` / `isOnDetail` / `wheelDetail` / `wheelPicker` /
 * `detailPointer` / `dragScaleSlider`）在面板里各占 3~8 行、还各自带一段
 * "为什么这样判"的注释 —— 但**判断其实全在本文件**。面板只该暴露一个
 * `pointers`，由 `app/canvasInput` 直接问它。
 *
 * ⚠️ 依赖一律传**取值函数**：面板的 `visible` / `tab` / 方式 / 技能数都会变，
 * 传快照会让"切页之后还在拖上一页的滑块"。
 */
export interface PointerRouteDeps {
  readonly visible: () => boolean;
  readonly tab: () => SettingsTab;
  readonly mode: () => OperationMode;
  readonly setUiScale: (value: number) => void;
  readonly redraw: () => void;
  readonly wheelDetail: (deltaY: number, deltaMode: number) => boolean;
  readonly wheelPicker: (delta: number) => void;
  readonly rowCount: () => number;
  readonly detailPointer: (phase: 'down' | 'move' | 'up', pointerId: number, py: number) => void;
}

export interface PanelPointerRoutes {
  isOnScaleSlider(px: number, py: number): boolean;
  isOnDetail(px: number, py: number): boolean;
  wheelDetail(px: number, py: number, deltaY: number, deltaMode: number): boolean;
  wheelPicker(px: number, py: number, delta: number): boolean;
  detailPointer(phase: 'down' | 'move' | 'up', pointerId: number, py?: number): void;
  dragScaleSlider(px: number): void;
}

export function buildPanelPointerRoutes(d: PointerRouteDeps): PanelPointerRoutes {
  /** 当前这一帧的读法（全部现读 —— 见 `PointerRouteDeps` 的说明）。 */
  const targets = (): PointerTargets => ({
    visible: d.visible(),
    tab: d.tab(),
    mode: d.mode(),
    setUiScale: d.setUiScale,
    redraw: d.redraw,
    wheelDetail: d.wheelDetail,
    wheelPicker: d.wheelPicker,
    rowCount: d.rowCount,
  });

  return {
    isOnScaleSlider: (px, py) => isOnScaleSlider(targets(), px, py),
    isOnDetail: (px, py) => isOnDetail(targets(), px, py),
    wheelDetail: (px, py, deltaY, deltaMode) => wheelDetail(targets(), px, py, deltaY, deltaMode),
    wheelPicker: (px, py, delta) => wheelPicker(targets(), px, py, delta),
    /**
     * 详情区拖拽滚动的三个阶段。
     *
     * ⚠️ 三件事收成**一个入口**：它们是同一次手势，分开写会让"漏接一个阶段"
     * 表现成"拖到一半就断"，很难查。坐标**只认逻辑 Y**。
     */
    detailPointer: (phase, pointerId, py = 0) => d.detailPointer(phase, pointerId, py),
    dragScaleSlider: (px) => dragScaleSlider(targets(), px),
  };
}
