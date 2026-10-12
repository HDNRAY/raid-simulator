import { describe, expect, it } from 'vitest';
import {
  KEY_GRID,
  cycleZone,
  moveFocus,
  resolveKeyAction,
  type FocusContext,
  type SettingsFocus,
} from '../../src/ui/settings/logic';
import { visibleTabs } from '../../src/ui/settings/tabs';
import { TOUCH_BUTTON_CAPACITY } from '../../src/render/touchGeometry';

/**
 * 设置弹窗的**键盘导航**与 `Enter` 激活。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `settings.test.ts` 顶到 700 行上限（AGENTS.md §3）。按那里的规则 ——
 * **不许靠删/压注释解决** —— 这里是**横向切割**：几何 / 命中测试属于
 * "坐标落在哪"，而焦点 / 激活属于"键盘在谁身上、回车作用在谁身上"。
 * 两者本来就不是一件事（这一轮加了「触屏键位」这个新的焦点区，后者明显变大）。
 */

/**
 * `hitTest` / 焦点模型要的**可见 tab 表**。
 *
 * ⚠️ 它是**参数**（首页只有「通用」），所以测试也按"游戏内"那一套显式传，
 * 而不是让被测函数自己去猜。
 */
const TABS = visibleTabs('gameplay');

/** 焦点模型的上下文（默认 = 「按键」页：有格子、有键位区、有两个按钮）。 */
function ctx(over: Partial<FocusContext> = {}): FocusContext {
  return {
    tabCount: TABS.length,
    cellCount: 8,
    hasGrid: true,
    hasPicker: false,
    hasMode: false,
    hasReset: true,
    hasTouchReset: false,
    pickerCount: 0,
    hasSlider: false,
    /** ⚠️ 键位区 / 技能面同属**触屏块** —— 键盘方式下不出现（见 `focus.ts` 文件头）。 */
    hasSlots: false,
    slotIndex: 0,
    ...over,
  };
}

describe('弹窗内的键盘导航：没有只能用鼠标的死角', () => {
  it('方向键在技能网格里移动，与 grid 的列数一致', () => {
    const first: SettingsFocus = { zone: 'grid', index: 0 };
    expect(moveFocus(first, 'right', ctx())).toEqual({ zone: 'grid', index: 1 });
    expect(moveFocus(first, 'down', ctx())).toEqual({ zone: 'grid', index: KEY_GRID.cols });
    // 第一列往左不动（不绕到上一行末尾，避免"斜着跳"）
    expect(moveFocus(first, 'left', ctx())).toEqual(first);
  });

  it('网格第一行往上 → tab 行；最后一行往下 → **它自己那块**的恢复按钮', () => {
    expect(moveFocus({ zone: 'grid', index: 0 }, 'up', ctx())).toEqual({ zone: 'tabs', index: 0 });
    const lastRow: SettingsFocus = { zone: 'grid', index: KEY_GRID.cols * 2 };
    /**
     * ⚠️ 键盘方式下格阵**没有**键位区可去（那是触屏块的区）——
     * 往下就是键盘那一份「恢复默认」（见 `focus.ts` 的 `moveFocus`）。
     */
    expect(moveFocus(lastRow, 'down', ctx())).toEqual({ zone: 'reset' });
  });

  it('焦点不会落到看不见的格子上', () => {
    /**
     * 容量是算出来的（`KEY_GRID_CAPACITY`），如果某一行只填了一半，
     * 向下移动不能把焦点放到那个空位上 —— 否则玩家按 Enter
     * 会"对空气改键"。
     */
    const odd = 6; // 6 个格子、4 列 → 第二行只有 2 个（第 5、6 个）
    const secondRowStart: SettingsFocus = { zone: 'grid', index: 4 };
    expect(moveFocus(secondRowStart, 'down', ctx({ cellCount: odd, hasSlots: false }))).toEqual({
      zone: 'reset',
    });
  });

  /**
   * ==================================================================
   * ⚠️ 桌面 4 列、触屏 3 列（`FocusContext.gridCols`）
   * ==================================================================
   *
   * `cellCount` 两边可能一样（技能表相同），而"↓ 跳几格"必须按**当前这一屏**
   * 算 —— 模型里读 `KEY_GRID.cols`（桌面常量）会让触屏的焦点**斜着跳**：
   * 按 ↓ 落到旁边一列上。
   */
  it('【关键】↓ 按**当前这一屏**的列数走（模型不吃桌面常量）', () => {
    /**
     * `FocusContext.gridCols` 由 `buildFocusContext` 按**这一屏的度量**填
     * （`keyGridMetrics(...).cols`）。这里用一个显式的 3 列上下文，证明
     * "↓ 跳几格"跟着它走 —— 模型里读 `KEY_GRID.cols` 会让换列数时**斜着跳**。
     */
    const three = ctx({ gridCols: 3, cellCount: 6, gridRows: 2 });
    expect(moveFocus({ zone: 'grid', index: 0 }, 'down', three)).toEqual({
      zone: 'grid',
      index: 3,
    });
    /** 桌面那套是 4 列（`KEY_GRID.cols`），同一格往下跳 4。 */
    expect(moveFocus({ zone: 'grid', index: 0 }, 'down', ctx())).toEqual({
      zone: 'grid',
      index: KEY_GRID.cols,
    });
  });

  it('格阵行数上限由容量给（`gridRows`）—— 焦点不越过画得出来的行', () => {
    /**
     * 技能比格子多时，焦点必须停在**画得出来**的那几行里：`row < rows-1`
     * 才允许往下走，否则会"对空气改键"。
     */
    const capped = ctx({ cellCount: 8, gridCols: 4, gridRows: 1 });
    expect(moveFocus({ zone: 'grid', index: 0 }, 'down', capped)).toEqual({ zone: 'reset' });
  });

  it('键盘那块「恢复默认」：上回到格阵最后一行，左右**停在原地**', () => {
    /**
     * ⚠️ 2026-10-12 二次定案：两块**各自**一个恢复按钮（不再"一个按钮按设备
     * 分流"）—— 所以 `reset` 右边**没有**第二个按钮，左右就是停在原地。
     */
    expect(moveFocus({ zone: 'reset' }, 'up', ctx())).toEqual({ zone: 'grid', index: 7 });
    expect(moveFocus({ zone: 'reset' }, 'right', ctx())).toEqual({ zone: 'reset' });
    expect(moveFocus({ zone: 'reset' }, 'left', ctx())).toEqual({ zone: 'reset' });
  });

  it('键位区内左右在 0..容量-1 之间走（两端不绕回）', () => {
    expect(moveFocus({ zone: 'slots', index: 0 }, 'left', ctx())).toEqual({
      zone: 'slots',
      index: 0,
    });
    expect(moveFocus({ zone: 'slots', index: 0 }, 'right', ctx())).toEqual({
      zone: 'slots',
      index: 1,
    });
    expect(
      moveFocus({ zone: 'slots', index: TOUCH_BUTTON_CAPACITY - 1 }, 'right', ctx()),
    ).toEqual({ zone: 'slots', index: TOUCH_BUTTON_CAPACITY - 1 });
  });

  it('Tab 循环所有可用区域（含关闭按钮），Shift+Tab 反向', () => {
    const a = cycleZone({ zone: 'tabs', index: 0 }, ctx());
    expect(a.zone).toBe('grid');
    /**
     * ⚠️ 键盘方式下**没有** `slots`（键位区/技能面是触屏那块）——
     * Tab 顺序是 tabs → grid → reset → close → tabs。
     */
    const b = cycleZone(a, ctx());
    expect(b.zone).toBe('reset');
    expect(cycleZone(b, ctx()).zone).toBe('close');
    expect(cycleZone({ zone: 'close' }, ctx()).zone).toBe('tabs');
    // 反向：tabs ← close（顺序是 tabs → grid → reset → close → tabs）
    expect(cycleZone({ zone: 'tabs', index: 0 }, ctx(), true).zone).toBe('close');
  });

  it('没有技能格时 Tab 只在 tab 行与按钮之间走（不产生空焦点）', () => {
    const bare = ctx({ cellCount: 0, hasGrid: false, hasSlots: false });
    const a = cycleZone({ zone: 'tabs', index: 0 }, bare);
    expect(a.zone).toBe('reset');
    const a2 = cycleZone(a, bare);
    expect(a2.zone).toBe('close');
    expect(cycleZone(a2, bare).zone).toBe('tabs');
  });

  it('方向键与 Enter 在弹窗内被当作导航，不会穿透成技能', () => {
    // 这是"几乎全键盘可操作"的前提：弹窗开着时方向键不该去打怪
    expect(resolveKeyAction('arrowup', false)).toEqual({ kind: 'move', direction: 'up' });
    expect(resolveKeyAction('arrowdown', false)).toEqual({ kind: 'move', direction: 'down' });
    expect(resolveKeyAction('arrowleft', false)).toEqual({ kind: 'move', direction: 'left' });
    expect(resolveKeyAction('arrowright', false)).toEqual({ kind: 'move', direction: 'right' });
    expect(resolveKeyAction('enter', false)).toEqual({ kind: 'activate' });
    expect(resolveKeyAction('tab', false)).toEqual({ kind: 'cycle', back: false });
  });

  it('捕获中优先一切 —— 连方向键都是"想绑这个键"', () => {
    // 否则玩家想把技能绑成方向键就永远绑不上
    expect(resolveKeyAction('arrowup', true)).toEqual({ kind: 'capture', key: 'arrowup' });
    expect(resolveKeyAction('enter', true)).toEqual({ kind: 'capture', key: 'enter' });
    // Esc 是唯一退路
    expect(resolveKeyAction('escape', true)).toEqual({ kind: 'cancelCapture' });
  });

  it('无关按键不产生动作（但也不穿透）', () => {
    expect(resolveKeyAction('x', false)).toEqual({ kind: 'ignore' });
  });
});

