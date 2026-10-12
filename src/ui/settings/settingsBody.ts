/**
 * **内容区的画**（「通用」页 / 「按键」页各画什么、谁显示谁隐藏）。
 *
 * ==================================================================
 * 为什么单独一个文件（第三次给 `SettingsPanel.ts` 让位）
 * ==================================================================
 *
 * `SettingsPanel.ts` 又一次贴到 700 行（AGENTS.md §3）。这一轮要加的东西
 * （详情区换行 + 滚动、两行提示、按设备分流的一个按钮）**只会让它更长**，
 * 所以按 §3 的顺序先**横向切割**再动手 —— 那位上一次拆完就说过
 * "下次再加东西就该把 `drawBody` 切出去"，这次照做。
 *
 * 切的是**最内聚的一块**："这一页内容区里哪些部件显示、按什么状态刷新"。
 * 它与"面板怎么收输入 / 焦点在谁身上 / 改键会话"没有交集 —— 那几件事仍
 * 在面板里。如此面板剩下一句话能说清："设置弹窗的输入与状态"。
 *
 * ⚠️ 这里**不持有状态**：只读传进来的焦点 / tab / 行数据，然后调各部件
 * 自己的 `update`。所以"显示谁"只有一个判据（本文件），部件不自己猜。
 */

import type { KeyGrid } from './KeyGrid';
import type { ScaleSlider } from './ScaleSlider';
import type { SkillDetail } from './SkillDetail';
import type { TouchSlotPreview } from './TouchSlotPreview';
import type { KeysFooter } from './KeysFooter';
import type { KeyRow } from './rows';
import type { SettingsFocus } from './focus';
import type { SettingsTab } from './tabs';

/** 内容区里由面板**造好、传进来**的部件（本文件不造它们）。 */
export interface BodyParts {
  readonly grid: KeyGrid;
  readonly slider: ScaleSlider;
  readonly preview: TouchSlotPreview;
  readonly detail: SkillDetail;
  readonly footer: KeysFooter;
  /** 当前键位行（每次重画重新取 —— 它跟着键位表变）。 */
  readonly rows: readonly KeyRow[];
  /** 当前触屏键位表（下标 = 键位号，`''` = 空）。 */
  readonly slots: readonly string[];
}

/** 画内容区的输入：这一页是谁、焦点在谁身上、有没有在改键。 */
export interface BodyInput {
  readonly tab: SettingsTab;
  readonly focus: SettingsFocus;
  /** 正在改键的技能 id（`undefined` = 没在捕获）。 */
  readonly capturingSkillId: string | undefined;
  /** 当前是否显示键名（决定网格度量，必须与命中测试同源）。 */
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
  parts.grid.setVisible(input.tab !== 'general');
  parts.slider.setVisible(false);
  parts.preview.setVisible(false);
  /**
   * ⚠️ `clear` 会顺手把详情区**藏起来**（`SkillDetail.clear` 里设了
   * `content.visible = false`）—— 于是"离开按键页"时它不会停在最后一个
   * 技能上，而"这一页有技能"时由 `render` 自己重新显示。
   */
  parts.detail.clear();

  if (input.tab === 'general') {
    /**
     * 「通用」页目前只有 UI 缩放滑块 —— 明确写出来，而不是给一片空白。
     *
     * ⚠️ 那一行提示（"← → 调整，↑ ↓ 切换项"）也归它：没有滑块的时候
     * 提示会是错的。触屏上整条不显示（那里没有键盘）。
     */
    parts.footer.showGeneralHint(input.showKeyHints);
    /**
     * 通用页的滑块：**显示** + 重画。
     *
     * ⚠️ 这里只负责"现在是通用页"；**隐藏由上面统一处理**。
     */
    parts.slider.setVisible(true);
    parts.slider.setFocused(input.focus.zone === 'slider');
    parts.slider.redraw();
    return;
  }

  /* ---- 「按键」页：键盘键位 + 右下角的触屏键位 + 底部详情与提示 ---- */
  /**
   * 格子交给组件画。
   *
   * ⚠️ 详情区由**格子驱动**（`onFocused` 回调）：焦点在哪一格就显示哪个
   * 技能。这样"画格子"与"显示谁"只有一个真相来源，不会再出现"点完格子、
   * 详情还停在上一个技能"。
   *
   * ⚠️ 还要喂一份**触屏键位表**：格子上那个小号（"第几个键位"）与右下角
   * 的预览是同一份数据的两个视图。
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

  /**
   * 右下角的**模拟键位**：显示 + 刷新。
   *
   * 技能名从**行数据**里取（那一份已经是 i18n 之后的 `nameKey`），与技能格
   * 显示的是同一个来源 —— 不会出现"格子里是「斩」、键位上写成别的字"。
   */
  const nameOf = (skillId: string): string => {
    const row = parts.rows.find((r) => r.skillId === skillId);
    return row === undefined ? '' : input.translate(row.nameKey);
  };
  parts.preview.setVisible(true);
  parts.preview.update(
    parts.slots,
    nameOf,
    input.focus.zone === 'slots' ? input.focus.index : undefined,
  );

  /**
   * 底部：两行提示 + **一个**「恢复默认」。
   *
   * ⚠️ 按钮恢复什么由**设备能力**决定 —— 面板已经把它喂给 footer
   * （`footer.setTouch()`），这里只管"焦点在不在它身上"。
   */
  parts.footer.updateKeys({
    capturing: input.capturingSkillId !== undefined,
    resetFocused: input.focus.zone === 'reset',
    showKeyHints: input.showKeyHints,
    selectedSlot: parts.preview.selected,
  });
}
