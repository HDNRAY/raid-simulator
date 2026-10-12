/**
 * **内容区的画**（「通用」页 / 「按键」页各画什么、谁显示谁隐藏）。
 *
 * ==================================================================
 * 为什么单独一个文件（第三次给 `SettingsPanel.ts` 让位）
 * ==================================================================
 *
 * `SettingsPanel.ts` 又一次贴到 700 行（AGENTS.md §3）。这一轮要加的东西
 * **只会让它更长**，所以按 §3 的顺序先**横向切割**再动手 —— 切的是
 * **最内聚的一块**："这一页内容区里哪些部件显示、按什么状态刷新"。
 *
 * ⚠️ 这里**不持有状态**：只读传进来的方式 / 焦点 / tab / 行数据，然后调各
 * 部件自己的 `update`。所以"显示谁"只有一个判据（本文件），部件不自己猜。
 *
 * ==================================================================
 * ⚠️ 2026-10-12：「按键」页按**操作方式**分两块（互斥）
 * ==================================================================
 *
 *   | 方式 | 画什么 |
 *   |---|---|
 *   | 键盘 | `KeyGrid`（技能格）+ `SkillDetail`（选中技能的说明）+ 键盘块底部 |
 *   | 触屏 | `TouchSkillPicker`（触屏自己的技能面）+ `TouchSlotPreview`（键位预览）+ 触屏块底部 |
 *
 * 用户原话："键盘 **不显示**右下角的那个" —— 所以键盘方式下预览**整块不画**；
 * 反过来触屏方式下键盘格阵与技能详情也不画（触屏那套自己成一个面，
 * 见 `TouchSkillPicker` 文件头）。
 */

import type { KeyGrid } from './KeyGrid';
import type { ModeSwitch } from './ModeSwitch';
import type { ScaleSlider } from './ScaleSlider';
import type { SkillDetail } from './SkillDetail';
import type { TouchSkillPicker } from './TouchSkillPicker';
import type { TouchSlotPreview } from './TouchSlotPreview';
import type { KeysFooter } from './KeysFooter';
import type { KeyRow } from './rows';
import type { SettingsFocus } from './focus';
import type { SettingsTab } from './tabs';
import type { OperationMode } from '../../render/platform';

/** 内容区里由面板**造好、传进来**的部件（本文件不造它们）。 */
export interface BodyParts {
  readonly grid: KeyGrid;
  readonly picker: TouchSkillPicker;
  readonly slider: ScaleSlider;
  readonly modeSwitch: ModeSwitch;
  readonly preview: TouchSlotPreview;
  readonly detail: SkillDetail;
  readonly footer: KeysFooter;
  /** 当前键位行（每次重画重新取 —— 它跟着键位表变）。 */
  readonly rows: readonly KeyRow[];
  /** 当前触屏键位表（下标 = 键位号，`''` = 空）。 */
  readonly slots: readonly string[];
  /** 触屏技能面当前窗口的第一个技能下标。 */
  readonly pickerOffset: number;
}

/** 画内容区的输入：这一页是谁、焦点在谁身上、有没有在改键、哪种方式。 */
export interface BodyInput {
  readonly tab: SettingsTab;
  /** **当前操作方式**（唯一 flag）—— 决定「按键」页画哪一块。 */
  readonly mode: OperationMode;
  readonly focus: SettingsFocus;
  /** 正在改键的技能 id（`undefined` = 没在捕获）。 */
  readonly capturingSkillId: string | undefined;
  /** 当前是否显示键名（= 键盘方式；决定网格度量，必须与命中测试同源）。 */
  readonly showKeyHints: boolean;
  /** 取词（技能名那类）。 */
  readonly translate: (key: string, params?: Readonly<Record<string, string | number>>) => string;
}

/**
 * 画一次内容区。
 *
 * ⚠️ **"隐藏"统一在这一处写，两个分支只写"显示"**：两处都写 hide 就会
 * 漏（第一版就是这样把滑块漏到按键页的）。
 */
export function drawBody(parts: BodyParts, input: BodyInput): void {
  const touch = input.mode === 'touch';
  const keysPage = input.tab !== 'general';

  /* ---- 先统一藏掉所有"按页 / 按方式"才显示的东西 ---- */
  parts.grid.setVisible(keysPage && !touch);
  parts.detail.clear();
  parts.picker.setVisible(keysPage && touch);
  parts.preview.setVisible(keysPage && touch);
  parts.slider.setVisible(false);
  parts.modeSwitch.setVisible(false);

  if (input.tab === 'general') {
    /**
     * 「通用」页：UI 缩放滑块 + **操作方式**选择器。
     *
     * ⚠️ 那一行提示（"← → 调整，↑ ↓ 切换项"）也归它：没有滑块的时候提示会
     * 是错的。触屏方式下整条不显示（那里没有键盘）。
     */
    parts.footer.showGeneralHint(input.showKeyHints);
    parts.slider.setVisible(true);
    parts.slider.setFocused(input.focus.zone === 'slider');
    parts.slider.redraw();
    parts.modeSwitch.setVisible(true);
    parts.modeSwitch.update(input.mode, input.focus.zone === 'mode' ? input.focus.index : -1);
    return;
  }

  /* ---- 「按键」页：**按操作方式画其中一块** ---- */
  /**
   * 技能名从**行数据**里取（那一份已经是 i18n 之后的 `nameKey`）——
   * 两块显示的是同一个来源，不会出现"格子里是「斩」、技能面上写成别的字"。
   */
  const nameOf = (skillId: string): string => {
    const row = parts.rows.find((r) => r.skillId === skillId);
    return row === undefined ? '' : input.translate(row.nameKey);
  };

  if (touch) {
    /**
     * **触屏块**：技能面（两步交互第二步）+ 键位预览（第一步）+ 它自己那
     * 一个「恢复默认」。
     *
     * ⚠️ 技能面**先更新**：滚动偏移可能被这一帧钳过（池子变小），
     * 而焦点 / 命中都要读那个值 —— 顺序反了会有一帧错位。
     */
    parts.picker.update({
      rows: parts.rows,
      slotSkillIds: parts.slots,
      selectedSlot: parts.preview.selected,
      focusIndex: input.focus.zone === 'picker' ? input.focus.index : -1,
      offset: parts.pickerOffset,
    });
    parts.preview.update(
      parts.slots,
      nameOf,
      input.focus.zone === 'slots' ? input.focus.index : undefined,
      input.focus.zone === 'touchReset',
    );
    parts.footer.updateKeys({
      capturing: false,
      resetFocused: false,
      showKeyHints: false,
      selectedSlot: parts.preview.selected,
    });
    return;
  }

  /**
   * **键盘块**：技能格 → 详情 → 两行提示 + 键盘那一份「恢复默认」。
   *
   * ⚠️ 详情区由**格子驱动**（`onFocused` 回调）：焦点在哪一格就显示哪个
   * 技能。这样"画格子"与"显示谁"只有一个真相来源，不会再出现"点完格子、
   * 详情还停在上一个技能"。
   *
   * ⚠️ 还要喂一份**触屏键位表**：格子上那个小号（"第几个键位"）与键位
   * 预览是同一份数据的两个视图。⚠️ 触屏方式下格阵不画，所以这段用不上 ——
   * 号数只在键盘方式下起"交叉参考"的作用。
   */
  parts.grid.update(
    parts.rows,
    {
      focusIndex: input.focus.zone === 'grid' ? input.focus.index : -1,
      capturingSkillId: input.capturingSkillId,
      showKeyHints: input.showKeyHints,
      slotSkillIds: parts.slots,
    },
    (row) => parts.detail.render(row),
  );

  parts.footer.updateKeys({
    capturing: input.capturingSkillId !== undefined,
    resetFocused: input.focus.zone === 'reset',
    showKeyHints: input.showKeyHints,
  });
}
