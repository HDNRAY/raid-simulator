import { describe, expect, it } from 'vitest';
import {
  SETTINGS_PANEL,
  closeButtonRect,
  cycleZone,
  hitTest,
  keyCellRect,
  resolveActivate,
  type FocusContext,
} from '../../src/ui/settings/logic';
import { UiLayout } from '../../src/ui/uiLayout';
import { FONT, LAYOUT } from '../../src/ui/layout';
import { KEY_GRID } from '../../src/ui/settings/settingsGeometry';
import { visibleTabs } from '../../src/ui/settings/tabs';

/**
 * 设置弹窗的**布局几何**（关闭按钮 / 技能格尺寸 / 键阵容量）。
 *
 * ⚠️ 从 `tests/unit/settings.test.ts` 搬出来的（那个文件 2026-10-12 因为
 * "按操作方式分两块"长到 703 行，AGENTS.md §3 的上限是 700）——
 * 横向切割：这几条断言只关心"画出来的矩形在哪、多大"，与"点一下会发生
 * 什么"（留在原文件）不是一件事。
 */

/** 可见的 tab 表（游戏内那一套）。 */
const TABS = visibleTabs('gameplay');

/** 焦点模型的上下文（键盘方式：「按键」页有格子与它自己的恢复按钮）。 */
function ctx(over: Partial<FocusContext> = {}): FocusContext {
  return {
    tabCount: TABS.length,
    cellCount: 8,
    hasGrid: true,
    hasSlider: false,
    hasSlots: false,
    hasPicker: false,
    hasMode: false,
    hasReset: true,
    hasTouchReset: false,
    pickerCount: 0,
    slotIndex: 0,
    ...over,
  };
}

describe('关闭按钮与 Boss 面板边距', () => {
  /**
   * 需求："设置弹窗里的『关闭』点了没反应。"
   *
   * 根因：它只是个 `Label`，**没有命中测试** —— 点它落到
   * `hitTestLogic` 的 `none` 分支（"点在弹窗内空白处，消费掉"）。
   * 点面板外的空白也能关，但那不是玩家会去点的地方。
   */
  it('【关键】点「关闭」命中 close，且关掉弹窗', () => {
    const r = closeButtonRect();
    const hit = hitTest(r.x + r.w / 2, r.y + r.h / 2, { tabs: TABS, tab: 'general', rowSkillIds: [] , mode: 'keyboard'});
    expect(hit.kind).toBe('close');
    // 每一页上都该能点（它是弹窗级的，不属于某一页）
    expect(hitTest(r.x + 2, r.y + 2, { tabs: TABS, tab: 'keys', rowSkillIds: ['attack'] , mode: 'keyboard'}).kind).toBe('close');
    expect(hitTest(r.x + 2, r.y + 2, { tabs: TABS, tab: 'general', rowSkillIds: ['attack'] , mode: 'keyboard'}).kind).toBe('close');
  });

  it('关闭按钮在弹窗内、右上角，且不与 tab 行重叠', () => {
    const r = closeButtonRect();
    expect(r.x).toBeGreaterThan(SETTINGS_PANEL.x + SETTINGS_PANEL.w / 2);
    expect(r.y).toBeLessThan(SETTINGS_PANEL.y + 40);
    // 竖向上不该压到 tab 行（tab 在 top 40..70）
    expect(r.y + r.h).toBeLessThanOrEqual(SETTINGS_PANEL.y + 40);
  });

  it('键盘也能到「关闭」（Enter 可触发）', () => {
    expect(
      resolveActivate({
        focus: { zone: 'close' },
        tabs: TABS,
        rowSkillIds: [],
        pickerOffset: 0,
        slotSkillIds: [],
        selectedSlot: undefined,
      }).kind,
    ).toBe('close');
    // 循环里必须包含它，否则它只能用鼠标
    expect(cycleZone({ zone: 'reset' }, ctx()).zone).toBe('close');
  });

  /**
   * 需求："boss 面板……无论 ui 如何缩放，应该保持和屏幕左右两边的
   * 边距不变，只是缩放高度和内容尺寸。"
   */
  it('Boss 面板缩放时左右边距恒定、只缩高度', () => {
    for (const k of [0.5, 1, 1.5, 2]) {
      const ui = new UiLayout(k);
      expect(ui.bossBar.x).toBe(LAYOUT.bossBar.x);
      expect(ui.bossBar.w).toBe(LAYOUT.bossBar.w);
      expect(ui.bossHp.x).toBe(LAYOUT.bossHp.x);
      expect(ui.bossHp.w).toBe(LAYOUT.bossHp.w);
    }
    // 高度确实跟着缩放
    expect(new UiLayout(2).bossBar.h).toBeGreaterThan(new UiLayout(1).bossBar.h);
  });

  /**
   * 需求："玩家面板目前距离屏幕底部太远了，应该和按钮区域到底部距离一致。"
   */
  it('玩家面板底边与技能栏底边对齐（距屏幕底同一边距）', () => {
    const skillBottom = LAYOUT.skillBar.y + LAYOUT.skillBar.slot;
    const panelBottom = LAYOUT.player.y + LAYOUT.player.h;
    expect(panelBottom).toBe(skillBottom);
    // 缩放后依然对齐（两者都是底锚点）
    const ui = new UiLayout(1.5);
    expect(ui.playerPanel.y + ui.playerPanel.h).toBe(skillBottom);
  });

  it('玩家读条跟着面板下移，且不压到面板', () => {
    const castBottom = LAYOUT.playerCastBar.y + LAYOUT.playerCastBar.h;
    expect(castBottom).toBeLessThanOrEqual(LAYOUT.player.y);
    // 间距不宜过大（否则中间空一块）
    expect(LAYOUT.player.y - castBottom).toBeLessThanOrEqual(10);
  });
});

describe('按键行的尺寸（需求："按键那一行 尺寸有问题"）', () => {
  /**
   * ⚠️ 这一条锁的是一个"被已经删掉的东西撑出来"的尺寸。
   *
   * `cellH` 当初从 44 加到 56 的理由是"**在技能名下放一行提示标签**"，
   * 而那行标签后来被需求删掉了（见 `KeyGrid` 的说明）。于是 56 的下半截
   * 变成空白：技能字在 `y+12`、按键在 `y+14`，下面 30px 什么都没有 ——
   * 表现就是"每行虚高、尺寸不对"。
   */
  it('【关键】行高回到 44（不是被已删标签撑出来的 56）', () => {
    expect(KEY_GRID.cellH).toBe(44);
  });

  it('行高容得下技能字（`FONT.warn` 实测占高约 1.5 倍字号）', () => {
    expect(KEY_GRID.cellH).toBeGreaterThan(FONT.warn * 1.5);
  });

  it('行高不再虚高：格子下半截没有第二行内容', () => {
    /**
     * 现在格子里只有两样东西，都在**上半截**：
     *   技能字 `y+12` / 按键 `y+14`
     * 两行文字各占约 21px 高，所以 `12 + 21 = 33 < 44` —— 放得下。
     *
     * 如果以后又往格子里加第三行，`cellH` 必须重新算，
     * 这一条会先失败提醒。
     */
    const first = keyCellRect(0);
    expect(first.h).toBe(KEY_GRID.cellH);
    expect(12 + FONT.warn * 1.5).toBeLessThan(first.h);
  });
});
