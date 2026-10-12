/**
 * **一次按键在设置面板里的完整走法**（键盘输入的执行侧接线）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 在加了"按操作方式分两块"之后到了 **730 行**
 * （AGENTS.md §3 的上限 700）。按 §3 的顺序**不许压注释**：这一段是
 * "把面板的各个能力接给纯决策层、再把结果套回焦点"—— 决策本身在
 * `./panelDispatch`（纯函数、可单测），这里只是**接线**，与"面板怎么画"
 * 没有交集。注释一起搬。
 */

import { resolveKeyDispatch } from './panelDispatch';
import { runPanelKey, type PanelActions } from './panelWiring';
import type { SettingsFocus } from './focus';
import type { SettingsTab } from './tabs';
import type { KeyRow } from './rows';

export interface PanelKeyRouteDeps {
  readonly key: string;
  readonly visible: () => boolean;
  readonly focus: () => SettingsFocus;
  /** 直接写入焦点（**不**重画 —— 收尾统一重画一次，见 `KeyExecutionResult.redraw`）。 */
  readonly assignFocus: (focus: SettingsFocus) => void;
  readonly rows: () => readonly KeyRow[];
  readonly tabs: () => readonly SettingsTab[];
  readonly touchSlots: () => readonly string[];
  readonly selectedSlot: () => number | undefined;
  readonly capturingSkillId: () => string | undefined;
  readonly pickerOffset: () => number;
  readonly actions: () => PanelActions;
  /** 滑块调值（`slider` 焦点下左右键）。 */
  readonly nudgeSlider: (direction: -1 | 1) => void;
  /** 键盘走到键位区时"顺便选中那个键位"（见下面那条注释）。 */
  readonly selectSlot: (index: number) => void;
  readonly scrollPicker: (delta: number) => void;
  readonly pushTrace: (line: string) => void;
  readonly redraw: () => void;
}

/**
 * 处理一次按键。
 *
 * **决策与执行**都在 `./panelDispatch`（纯函数，可单测）；这里只把面板的
 * 各个能力接进去，并套用"焦点变了 / 要调滑块"这两个结果。
 *
 * @returns 是否消费了这次按键
 */
export function routePanelKey(d: PanelKeyRouteDeps): boolean {
  if (!d.visible()) return false;

  const dispatch = resolveKeyDispatch({
    visible: true,
    key: d.key,
    capturingSkillId: d.capturingSkillId(),
    focus: d.focus(),
    rowSkillIds: d.rows().map((r) => r.skillId),
    tabs: d.tabs(),
    slotSkillIds: d.touchSlots(),
    /**
     * ⚠️ **触屏技能面上的 `Enter` 只在"已经选中键位"时才是绑定**；
     * 键盘格阵（`grid`）上的 `Enter` **永远是改键** —— 判定在
     * `focus.resolveActivate`（与鼠标同一份），这里只喂状态。
     */
    selectedSlot: d.selectedSlot(),
    pickerOffset: d.pickerOffset(),
  });
  d.pushTrace(dispatch.trace);

  const result = runPanelKey(
    { action: dispatch.action, activate: dispatch.activate, key: d.key },
    d.actions(),
  );

  if (result.focus !== undefined) {
    d.assignFocus(result.focus);
    /**
     * ⚠️ **键盘走到键位区 = 选中那个键位**（与"点一下键位"同一件事）。
     *
     * 不这么做的话，方向键移进键位区之后还得再按一次 `Enter` 才生效，
     * 而提示写的是"点键位 → 点技能" —— 键盘那条路就多了一步、
     * 也就是 AGENTS.md §3b 说的"功能不对等"。
     * `Enter` 在键位区里的语义只剩"**取消选中**"（见 `focus.resolveActivate`）。
     */
    if (result.focus.zone === 'slots') d.selectSlot(result.focus.index);
  }
  /**
   * ⚠️ 焦点在**触屏技能面**上时，把窗口偏移拉回合法范围（池子换角色会变小）
   * —— 与鼠标滚轮走**同一个** `scrollPicker`（滚动数学只有 `ui/scrollWindow`
   * 那一处）。
   */
  if (d.focus().zone === 'picker') d.scrollPicker(0);
  if (result.nudgeSlider !== undefined) d.nudgeSlider(result.nudgeSlider);
  /**
   * ⚠️ `redraw === false` 时**不要重画** —— 那是 `ignore`（什么都没改）。
   * 按住一个与设置无关的键会连续打到这里（`settingsKeys` 不过滤
   * `event.repeat`），无条件重画等于按按键重复率重绘整个面板。
   * 详见 `KeyExecutionResult.redraw` 的说明。
   */
  if (result.redraw !== false) d.redraw();
  return result.consumed;
}
