import { describe, expect, it } from 'vitest';
import { cycleZone, moveFocus } from '../../src/ui/settings/logic';

/**
 * **焦点模型的走法**（`ui/settings/focus.ts` 的 `moveFocus` / `cycleZone`）。
 *
 * ⚠️ 这一组原先寄在 `tests/unit/log.test.ts` 里（那时它刚好贴着 700 行），
 * 2026-10-12 "「按键」页按操作方式分两块"之后又长了一截 —— 于是按
 * AGENTS.md §3 的**横向切割**搬出来：焦点走法本来就与"日志文案 / 布局"
 * 没有交集，寄在那边只是历史原因。
 *
 * ⚠️ 关键口径：**键盘方式**下 `grid` + `reset`；**触屏方式**下
 * `picker` + `slots` + `touchReset` —— 两块互斥，模型不认识设备。
 */

describe('弹窗内的键盘导航（焦点模型）', () => {
  /**
   * 焦点模型的上下文（见 `ui/settings/focus.FocusContext`）。
   *
   * ⚠️ 2026-10-12 起「按键」页**按操作方式分两块**（互斥）：
   *   键盘方式：`grid`（技能格）+ `reset`（它自己的恢复按钮）
   *   触屏方式：`picker`（技能面）+ `slots`（键位预览）+ `touchReset`
   * 所以下面有**两个**「按键」页上下文 —— 它们各自断言自己那套的走法。
   * 「通用」页则是 `slider` + `mode`（操作方式选择器），没有恢复按钮。
   */
  const generalCtx = {
    tabCount: 1,
    cellCount: 0,
    hasGrid: false,
    hasSlider: true,
    hasSlots: false,
    hasPicker: false,
    hasMode: true,
    hasReset: false,
    hasTouchReset: false,
    pickerCount: 0,
    slotIndex: 0,
  } as const;
  const keysCtx = {
    tabCount: 2,
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
  } as const;
  const touchCtx = {
    tabCount: 2,
    cellCount: 0,
    hasGrid: false,
    hasSlider: false,
    hasSlots: true,
    hasPicker: true,
    hasMode: false,
    hasReset: false,
    hasTouchReset: true,
    pickerCount: 8,
    pickerCols: 3,
    slotIndex: 0,
  } as const;

  it('通用页的焦点顺序是 tabs → slider → mode（Tab 能走完）', () => {
    // 通用页：没有技能格、有 slider 与操作方式选择器
    let focus = cycleZone({ zone: 'tabs', index: 0 }, generalCtx);
    expect(focus.zone).toBe('slider');
    focus = cycleZone(focus, generalCtx);
    /** ⚠️ 滑块下面**没有**恢复按钮了（那是「按键」页两块各自的）—— 是方式选择器。 */
    expect(focus.zone).toBe('mode');
    const close = cycleZone(focus, generalCtx);
    expect(close.zone).toBe('close');
    // 再 Tab 回到 tabs
    expect(cycleZone(close, generalCtx).zone).toBe('tabs');
  });

  it('键盘方式的「按键」页：tabs → grid → reset（Tab 走完）', () => {
    let focus = cycleZone({ zone: 'tabs', index: 0 }, keysCtx);
    expect(focus.zone).toBe('grid');
    focus = cycleZone(focus, keysCtx);
    /** ⚠️ 键盘方式下**没有**键位区 / 技能面（触屏预览整块不画）。 */
    expect(focus.zone).toBe('reset');
    expect(cycleZone(focus, keysCtx).zone).toBe('close');
  });

  it('触屏方式的「按键」页：tabs → picker → slots → touchReset（Tab 走完）', () => {
    let focus = cycleZone({ zone: 'tabs', index: 0 }, touchCtx);
    expect(focus.zone).toBe('picker');
    focus = cycleZone(focus, touchCtx);
    expect(focus.zone).toBe('slots');
    focus = cycleZone(focus, touchCtx);
    expect(focus.zone).toBe('touchReset');
    expect(cycleZone(focus, touchCtx).zone).toBe('close');
  });

  it('通用页里从上往下走是 tabs → slider → mode', () => {
    const toSlider = moveFocus({ zone: 'tabs', index: 0 }, 'down', generalCtx);
    expect(toSlider.zone).toBe('slider');
    const toMode = moveFocus(toSlider, 'down', generalCtx);
    expect(toMode.zone).toBe('mode');
    // slider 的左右**不移动焦点**（调用方拿它们当调值键）——
    // 模型这一层把左右都当作"回到 tabs"
    expect(moveFocus(toSlider, 'up', generalCtx).zone).toBe('tabs');
  });

  it('触屏方式：键位区往下进**它自己那块**的恢复按钮，往上回技能面', () => {
    const down = moveFocus({ zone: 'slots', index: 0 }, 'down', touchCtx);
    expect(down.zone).toBe('touchReset');
    const up = moveFocus({ zone: 'slots', index: 0 }, 'up', touchCtx);
    expect(up.zone).toBe('picker');
    expect(moveFocus({ zone: 'touchReset' }, 'up', touchCtx).zone).toBe('slots');
  });
});
