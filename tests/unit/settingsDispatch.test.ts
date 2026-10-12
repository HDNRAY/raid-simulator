import { describe, expect, it, vi } from 'vitest';
import {
  executeKeyPanelAction,
  executePanelDispatch,
  resolveKeyDispatch,
  resolveMoveFocus,
  resolvePanelDispatch,
  type KeyActionBindings,
  type PanelActionBindings,
  type PanelDispatchInput,
} from '../../src/ui/settings/panelDispatch';
import {
  closeButtonRect,
  keyCellRect,
  keyGridMetrics,
  resetButtonRect,
  tabRect,
  touchResetButtonRect,
  type FocusContext,
  type SettingsFocus,
  type SettingsTab,
} from '../../src/ui/settings/logic';
import { DETAIL_TOP, KEY_GRID_BOTTOM, SETTINGS_PANEL } from '../../src/ui/settings/settingsGeometry';
import { visibleTabs } from '../../src/ui/settings/tabs';
import { TOUCH_BUTTON_CAPACITY } from '../../src/render/touchGeometry';
import { previewSlotCenter } from '../../src/ui/settings/touchPreview';
import { pickerCellRect, pickerMetrics } from '../../src/ui/settings/touchPickerLayout';

/**
 * 设置面板的**输入派发**（点击 / 按键）。
 *
 * 这段原本是 `SettingsPanel` 里最长的两个方法，长在 Pixi 类里 ——
 * 于是"点到哪一格、这一格该干什么"完全没法在 node 里测。抽出来之后
 * 可以精确断言（截图只能看出"画得对不对"，看不出"点了之后该调谁"）。
 */

const ROWS = ['attack', 'blast', 'focus', 'break', 'dodge', 'guard', 'flash', 'jie'];
const GRID: SettingsFocus = { zone: 'grid', index: 0 };
/** 可见的 tab 表（游戏内那一套；首页只有「通用」，见 `settings.test.ts`）。 */
const TABS = visibleTabs('gameplay');

/** 焦点模型的上下文（默认 = 「按键」页：有格子、有键位区、两个按钮）。 */
function ctx(over: Partial<FocusContext> = {}): FocusContext {
  return {
    tabCount: TABS.length,
    cellCount: ROWS.length,
    hasGrid: true,
    hasSlider: false,
    hasSlots: true,
    hasPicker: false,
    hasMode: false,
    hasReset: true,
    hasTouchReset: false,
    pickerCount: 0,
    slotIndex: 0,
    ...over,
  };
}

function panelInput(over: Partial<PanelDispatchInput> = {}): PanelDispatchInput {
  return {
    visible: true,
    tab: 'keys',
    tabs: TABS,
    px: 0,
    py: 0,
    rowSkillIds: ROWS,
    slotSkillIds: [],
    selectedSlot: undefined,
    focus: GRID,
    capturingSkillId: undefined,
    showKeyHints: true,
    /**
     * 默认 = **键盘方式**（「按键」页画键盘块）；触屏那两块由专门的用例
     * 显式传 `mode: 'touch'` —— 两种方式的命中区是**互斥**的。
     */
    mode: 'keyboard',
    pickerOffset: 0,
    ...over,
  };
}

/** 第 `index` 个格子的中心（按**当前模式**的度量 —— 与渲染同源）。 */
function cellCenter(index: number, showKeyHints = true): { px: number; py: number } {
  const r = keyCellRect(index, keyGridMetrics(showKeyHints));
  return { px: r.x + r.w / 2, py: r.y + r.h / 2 };
}

function centerOf(rect: { x: number; y: number; w: number; h: number }): {
  px: number;
  py: number;
} {
  return { px: rect.x + rect.w / 2, py: rect.y + rect.h / 2 };
}

/**
 * **触屏技能面**第 `index` 格的圆心（窗口偏移 0）。
 *
 * ⚠️ 与渲染同一份几何（`touchPickerLayout`）—— 命中测试与画出来的位置
 * 必须可比，脚本 / 测试也不例外。
 */
function pickerCellCenter(index: number): { px: number; py: number } {
  return centerOf(pickerCellRect(index, pickerMetrics(ROWS.length)));
}

describe('resolvePanelDispatch：点一下该做什么', () => {
  it('没打开 → none（不消费、不穿透）', () => {
    expect(resolvePanelDispatch(panelInput({ visible: false }))).toEqual({ kind: 'none' });
  });

  it('点在弹窗外 → close', () => {
    expect(resolvePanelDispatch(panelInput({ px: -5, py: -5 }))).toEqual({ kind: 'close' });
  });

  it('点在 tab 上 → switchTab（带目标页）', () => {
    const tab0 = centerOf(tabRect(0));
    expect(resolvePanelDispatch(panelInput(tab0))).toEqual({
      kind: 'switchTab',
      tab: 'general',
    });
    const tab1 = centerOf(tabRect(1));
    expect(resolvePanelDispatch(panelInput(tab1))).toEqual({
      kind: 'switchTab',
      tab: 'keys',
    });
  });

  it('点在「恢复默认」上 → resetKeys', () => {
    expect(resolvePanelDispatch(panelInput(centerOf(resetButtonRect())))).toEqual({
      kind: 'resetKeys',
      notice: 'keysResetDone',
    });
  });

  it('点在「关闭」上 → close', () => {
    expect(resolvePanelDispatch(panelInput(centerOf(closeButtonRect())))).toEqual({
      kind: 'close',
    });
  });

  it('点在弹窗内空白处 → none（消费掉）', () => {
    /**
     * ⚠️ 空白处要避开格阵、详情区、提示两行、按钮与**右下角的键位预览**
     * —— 坐标直接**从几何常量推**（别再手写一个"以前是空的"的点：
     * 这一轮布局一改，原来那个点就落进技能格里了）。
     *
     * 取格阵下沿与详情区顶边之间那条缝（`KEY_GRID_BOTTOM .. DETAIL_TOP`）。
     */
    const y = (SETTINGS_PANEL.y + KEY_GRID_BOTTOM + DETAIL_TOP) / 2;
    expect(resolvePanelDispatch(panelInput({ px: SETTINGS_PANEL.x + 8, py: y }))).toEqual({
      kind: 'none',
    });
  });

  describe('右下角的模拟键位（两步交互的第一步）', () => {
    it('点一个键位 → selectSlot；再点同一个键位 → deselectSlot', () => {
      const center = previewSlotCenter(2);
      expect(center).toBeDefined();
      const at = { px: center!.x, py: center!.y, mode: 'touch' as const };
      expect(resolvePanelDispatch(panelInput(at))).toEqual({ kind: 'selectSlot', index: 2 });
      expect(resolvePanelDispatch(panelInput({ ...at, selectedSlot: 2 }))).toEqual({
        kind: 'deselectSlot',
      });
    });

    /**
     * ⚠️ 触屏那套的第二步走的是**它自己的技能面**（`touchSkill`），
     * 不再借键盘格阵 —— 用户 2026-10-12："里面的实现**有一半都不一样**"。
     */
    it('【关键】选中键位之后点**触屏技能面**上的技能 = 绑到那个键位', () => {
      const at = pickerCellCenter(3);
      expect(
        resolvePanelDispatch(
          panelInput({
            ...at,
            mode: 'touch',
            selectedSlot: 1,
            slotSkillIds: ['', ''],
          }),
        ),
      ).toEqual({ kind: 'assignTouchSlot', slot: 1, skillId: 'break' });
    });

    it('没选中键位时点技能面 = **什么都不做**（绑定状态必须先建立）', () => {
      expect(
        resolvePanelDispatch(panelInput({ ...pickerCellCenter(3), mode: 'touch' })),
      ).toEqual({ kind: 'none' });
    });

    it('那个键位上**已经有**这个技能 → clearTouchSlot（= 取下）', () => {
      expect(
        resolvePanelDispatch(
          panelInput({
            ...pickerCellCenter(0),
            mode: 'touch',
            selectedSlot: 0,
            slotSkillIds: ['attack'],
          }),
        ),
      ).toEqual({ kind: 'clearTouchSlot', slot: 0 });
    });

    it('技能在**别的**键位上 → 仍然是 assign（交换在执行层做）', () => {
      expect(
        resolvePanelDispatch(
          panelInput({
            ...pickerCellCenter(0),
            mode: 'touch',
            selectedSlot: 2,
            slotSkillIds: ['attack'],
          }),
        ),
      ).toEqual({ kind: 'assignTouchSlot', slot: 2, skillId: 'attack' });
    });

    /**
     * ⚠️ **两块各自的恢复按钮**（2026-10-12 二次定案）：恢复什么由
     * "点在哪个块里"决定，**与设备无关**（上一版按设备分流，于是触屏笔记本
     * 上键盘键位恢复不了 —— 用户报的正是它）。
     */
    it('键盘块那个「恢复默认」→ 只 resetKeys（触屏方式下它不存在）', () => {
      const r = resetButtonRect();
      expect(resolvePanelDispatch(panelInput(centerOf(r)))).toEqual({
        kind: 'resetKeys',
        notice: 'keysResetDone',
      });
    });

    it('【关键】触屏块那个「恢复默认」→ 只 resetTouch（作用域互不污染）', () => {
      const r = touchResetButtonRect();
      expect(resolvePanelDispatch(panelInput({ ...centerOf(r), mode: 'touch' }))).toEqual({
        kind: 'resetTouch',
        notice: 'touchResetDone',
      });
    });

    it('两个恢复按钮是**两个不相交的矩形**（各自贴在自己那块配置旁）', () => {
      const a = resetButtonRect();
      const b = touchResetButtonRect();
      const overlap =
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap).toBe(false);
    });

    it('键位圆的容差是**算出来的**（容量个圆心都能点中）', () => {
      for (let i = 0; i < TOUCH_BUTTON_CAPACITY; i += 1) {
        const c = previewSlotCenter(i);
        expect(c, `第 ${i} 个键位没有位置`).toBeDefined();
        expect(resolvePanelDispatch(panelInput({ px: c!.x, py: c!.y, mode: 'touch' }))).toEqual({
          kind: 'selectSlot',
          index: i,
        });
      }
    });
  });

  describe('技能格（keyRow 分支）', () => {
    it('点到**别的**格子（没在改键）→ 只聚焦', () => {
      // 焦点在第 0 格，点第 3 格
      expect(
        resolvePanelDispatch(panelInput({ ...cellCenter(3), focus: GRID })),
      ).toEqual({ kind: 'focusSkill', skillId: 'break' });
    });

    /**
     * ⚠️ 再点一次**已选中**的格子 → 选中 + 进改键，**两步都要**。
     * 执行时是先 focus 后 startCapture（见下面的执行顺序断言）。
     */
    it('点到**已选中**的格子 → captureSkill（等价键盘 Enter）', () => {
      expect(
        resolvePanelDispatch(
          panelInput({ ...cellCenter(3), focus: { zone: 'grid', index: 3 } }),
        ),
      ).toEqual({ kind: 'captureSkill', skillId: 'break' });
    });

    it('正在改键时点到另一个格子 → swapSlots（带 from/to 下标）', () => {
      expect(
        resolvePanelDispatch(panelInput({ ...cellCenter(4), capturingSkillId: 'flash' })),
      ).toEqual({ kind: 'swapSlots', from: 6, to: 4 });
    });

    /**
     * ⚠️ `from`/`to` 任一为 -1（技能不在表里）时仍然派发 ——
     * **由执行层只重画、不调 `onSwapSlots`**（老代码就是这个形状）。
     */
    it('改键中的技能不在表里 → from 为 -1，仍派发 swapSlots', () => {
      expect(
        resolvePanelDispatch(panelInput({ ...cellCenter(4), capturingSkillId: 'ghost' })),
      ).toEqual({ kind: 'swapSlots', from: -1, to: 4 });
    });
  });

  describe('通用页的 UI 缩放滑块', () => {
    it('滑块上 → setScaleFromPointer（带 px）', () => {
      // 滑块矩形：x 176..496、y 116..140（`uiScaleSliderRect`）
      const base = panelInput({ tab: 'general' });
      const hit = resolvePanelDispatch({ ...base, px: 200, py: 128 });
      expect(hit).toEqual({ kind: 'setScaleFromPointer', px: 200 });
    });

    it('按键页同一位置**不**判给滑块（滑块只属于通用页）', () => {
      const hit = resolvePanelDispatch({ ...panelInput({ tab: 'keys' }), px: 700, py: 128 });
      expect(hit.kind).not.toBe('setScaleFromPointer');
    });
  });
});

/* ------------------------------------------------------------------ */

/** 带 mock 的点击绑定（见 `keyBindings` 的说明：返回类型交给推断）。 */
function panelBindings() {
  return {
    close: vi.fn<() => void>(),
    switchTab: vi.fn<(tab: SettingsTab) => void>(),
    resetKeys: vi.fn<() => void>(),
    resetTouch: vi.fn<() => void>(),
    /** 默认桌面 —— 那个唯一的按钮恢复键盘键位（触屏那条另有专门用例）。 */
    switchOperationMode: vi.fn(),
    notice: vi.fn<(text: string) => void>(),
    swapSlots: vi.fn<(from: number, to: number) => void>(),
    focusSkill: vi.fn<(skillId: string) => void>(),
    startCapture: vi.fn<(skillId: string) => void>(),
    selectSlot: vi.fn<(index: number) => void>(),
    deselectSlot: vi.fn<() => void>(),
    assignTouchSlot: vi.fn<(slot: number, skillId: string) => void>(),
    clearTouchSlot: vi.fn<(slot: number) => void>(),
    uiScale: vi.fn<(value: number) => void>(),
    redraw: vi.fn<() => void>(),
  } satisfies PanelActionBindings;
}

describe('executePanelDispatch：把点击执行掉', () => {
  it('captureSkill **先聚焦、再进改键**、最后重画（顺序很关键）', () => {
    const b = panelBindings();
    expect(executePanelDispatch({ kind: 'captureSkill', skillId: 'flash' }, b)).toBe(true);
    expect(b.focusSkill).toHaveBeenCalledWith('flash');
    expect(b.startCapture).toHaveBeenCalledWith('flash');
    expect(b.redraw).toHaveBeenCalledTimes(1);
    // 顺序：focusSkill → startCapture → redraw
    expect(b.focusSkill.mock.invocationCallOrder[0]).toBeLessThan(
      b.startCapture.mock.invocationCallOrder[0]!,
    );
    expect(b.startCapture.mock.invocationCallOrder[0]).toBeLessThan(
      b.redraw.mock.invocationCallOrder[0]!,
    );
  });

  /**
   * ⚠️ `from`/`to` 有 -1 时**只重画**、不换位（老代码：
   * `if (from >= 0 && to >= 0) { ... }` 之后无条件 `redraw()`）。
   */
  it('swapSlots 的 from 为 -1 → 只重画，不调 onSwapSlots', () => {
    const b = panelBindings();
    executePanelDispatch({ kind: 'swapSlots', from: -1, to: 3 }, b);
    expect(b.swapSlots).not.toHaveBeenCalled();
    expect(b.redraw).toHaveBeenCalledTimes(1);
  });

  it('swapSlots 正常 → 换位 + 重画', () => {
    const b = panelBindings();
    executePanelDispatch({ kind: 'swapSlots', from: 6, to: 2 }, b);
    expect(b.swapSlots).toHaveBeenCalledWith(6, 2);
    expect(b.redraw).toHaveBeenCalledTimes(1);
  });

  it('resetKeys → 恢复 + 提示文案 key + 重画', () => {
    const b = panelBindings();
    expect(executePanelDispatch({ kind: 'resetKeys', notice: 'keysResetDone' }, b)).toBe(true);
    expect(b.resetKeys).toHaveBeenCalledTimes(1);
    expect(b.notice).toHaveBeenCalledWith('settings.keysResetDone');
    expect(b.redraw).toHaveBeenCalledTimes(1);
  });

  it('setScaleFromPointer → 只调 uiScale（值由横坐标算出）', () => {
    const b = panelBindings();
    executePanelDispatch({ kind: 'setScaleFromPointer', px: 200 }, b);
    expect(b.uiScale).toHaveBeenCalledTimes(1);
    expect(b.redraw).toHaveBeenCalledTimes(1);
  });

  it('focusSkill → 只聚焦，**不**进改键', () => {
    const b = panelBindings();
    executePanelDispatch({ kind: 'focusSkill', skillId: 'flash' }, b);
    expect(b.focusSkill).toHaveBeenCalledWith('flash');
    expect(b.startCapture).not.toHaveBeenCalled();
  });

  it('none / close / switchTab 都算"消费了这次点击"', () => {
    const b = panelBindings();
    expect(executePanelDispatch({ kind: 'none' }, b)).toBe(true);
    expect(executePanelDispatch({ kind: 'close' }, b)).toBe(true);
    expect(executePanelDispatch({ kind: 'switchTab', tab: 'general' }, b)).toBe(true);
    expect(b.redraw).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */

/**
 * 带 mock 的绑定集合。
 *
 * ⚠️ **不能把返回类型写成 `KeyActionBindings`** —— 那样会丢掉 mock 类型
 * （`(tab) => void` 上没有 `.mock`），断言调用顺序就没法写。所以返回类型
 * 交给推断（每一项都是 `vi.fn<T>()` 的 `Mock<T>`，仍然满足接口）。
 */
function keyBindings(over: Partial<KeyActionBindings> = {}) {
  const mocks = {
    close: vi.fn<() => void>(),
    switchTab: vi.fn<(tab: SettingsTab) => void>(),
    resetKeys: vi.fn<() => void>(),
    resetTouch: vi.fn<() => void>(),
    switchOperationMode: vi.fn(),
    notice: vi.fn<(text: string) => void>(),
    rebind: vi.fn<(skillId: string, key: string) => void>(),
    selectSlot: vi.fn<(index: number) => void>(),
    deselectSlot: vi.fn<() => void>(),
    assignTouchSlot: vi.fn<(slot: number, skillId: string) => void>(),
    clearTouchSlot: vi.fn<(slot: number) => void>(),
    startCapture: vi.fn<(skillId: string, triggerKey?: string) => void>(),
    stopCapture: vi.fn<() => void>(),
    finishCapture: vi.fn<(key: string) => void>(),
    moveFocus: vi.fn<() => SettingsFocus | undefined>(() => GRID),
    cycleFocus: vi.fn<() => SettingsFocus>(() => GRID),
    nudgeSlider: vi.fn<(direction: -1 | 1) => void>(),
    redraw: vi.fn<() => void>(),
  } satisfies KeyActionBindings;
  return { ...mocks, ...over };
}

describe('resolveKeyDispatch：按键决策', () => {
  it('没打开 → ignore，且不记轨迹', () => {
    const d = resolveKeyDispatch({
      visible: false,
      key: 'y',
      capturingSkillId: undefined,
      focus: GRID,
      rowSkillIds: ROWS,
      tabs: TABS,
      slotSkillIds: [],
      selectedSlot: undefined,
      pickerOffset: 0,
    });
    expect(d.action).toEqual({ kind: 'ignore' });
    expect(d.trace).toBe('');
  });

  it('捕获中普通键 → capture（不是导航）', () => {
    const d = resolveKeyDispatch({
      visible: true,
      key: 'y',
      capturingSkillId: 'flash',
      focus: GRID,
      rowSkillIds: ROWS,
      tabs: TABS,
      slotSkillIds: [],
      selectedSlot: undefined,
      pickerOffset: 0,
    });
    expect(d.action).toEqual({ kind: 'capture', key: 'y' });
    expect(d.trace).toBe('handleKey(y) cap=flash -> capture');
  });

  it('捕获中 escape → cancelCapture（唯一退路）', () => {
    const d = resolveKeyDispatch({
      visible: true,
      key: 'escape',
      capturingSkillId: 'flash',
      focus: GRID,
      rowSkillIds: ROWS,
      tabs: TABS,
      slotSkillIds: [],
      selectedSlot: undefined,
      pickerOffset: 0,
    });
    expect(d.action).toEqual({ kind: 'cancelCapture' });
  });

  it('方向键 → move；Tab → cycle', () => {
    const base = {
      visible: true,
      capturingSkillId: undefined,
      focus: GRID,
      rowSkillIds: ROWS,
      tabs: TABS,
      slotSkillIds: [],
      selectedSlot: undefined,
      pickerOffset: 0,
    };
    expect(resolveKeyDispatch({ ...base, key: 'arrowleft' }).action).toEqual({
      kind: 'move',
      direction: 'left',
    });
    expect(resolveKeyDispatch({ ...base, key: 'tab' }).action).toEqual({
      kind: 'cycle',
      back: false,
    });
  });

  it('Enter 在格子上 → activate，并**顺带解析**出 startCapture', () => {
    const d = resolveKeyDispatch({
      visible: true,
      key: 'enter',
      capturingSkillId: undefined,
      focus: { zone: 'grid', index: 6 },
      rowSkillIds: ROWS,
      tabs: TABS,
      slotSkillIds: [],
      selectedSlot: undefined,
      pickerOffset: 0,
    });
    expect(d.action).toEqual({ kind: 'activate' });
    expect(d.activate).toEqual({ kind: 'startCapture', skillId: 'flash' });
    expect(d.trace).toBe('handleKey(enter) cap=- -> activate');
  });
});

describe('resolveMoveFocus / executeKeyPanelAction', () => {
  it('slider 焦点下左右 → undefined（交给执行层调滑块）', () => {
    const next = resolveMoveFocus({
      focus: { zone: 'slider' },
      direction: 'left',
      ctx: ctx({ hasGrid: false, hasSlider: true, hasSlots: false }),
    });
    expect(next).toBeUndefined();
  });

  it('slider 左右 → nudgeSlider（右 +1 / 左 -1）', () => {
    /**
     * ⚠️ 这里**故意把 moveFocus 造成返回 undefined** —— 那正是面板
     * 在"slider 焦点 + 左右键"时给执行层的信号（见 `resolveMoveFocus`）。
     */
    const right = keyBindings({ moveFocus: vi.fn<() => SettingsFocus | undefined>(() => undefined) });
    const r1 = executeKeyPanelAction(
      { action: { kind: 'move', direction: 'right' }, activate: undefined, key: 'arrowright' },
      right,
    );
    expect(r1).toEqual({ consumed: true, nudgeSlider: 1 });

    const r2 = executeKeyPanelAction(
      { action: { kind: 'move', direction: 'left' }, activate: undefined, key: 'arrowleft' },
      keyBindings({ moveFocus: vi.fn<() => SettingsFocus | undefined>(() => undefined) }),
    );
    expect(r2.nudgeSlider).toBe(-1);
  });

  it('activate + startCapture 把**原始键**当 triggerKey 传下去', () => {
    const b = keyBindings();
    executeKeyPanelAction(
      {
        action: { kind: 'activate' },
        activate: { kind: 'startCapture', skillId: 'flash' },
        key: 'enter',
      },
      b,
    );
    expect(b.startCapture).toHaveBeenCalledWith('flash', 'enter');
  });

  it('capture → finishCapture（面板自己收尾，不靠输入层）', () => {
    const b = keyBindings();
    executeKeyPanelAction(
      { action: { kind: 'capture', key: 'y' }, activate: undefined, key: 'y' },
      b,
    );
    expect(b.finishCapture).toHaveBeenCalledWith('y');
  });

  it('助记键 tabKeys → 切页 + 焦点移到 tab 行（同一步）', () => {
    const b = keyBindings();
    const r = executeKeyPanelAction(
      { action: { kind: 'mnemonic', target: 'tabKeys' }, activate: undefined, key: 'k' },
      b,
    );
    expect(b.switchTab).toHaveBeenCalledWith('keys');
    expect(r.focus).toEqual({ zone: 'tabs', index: 1 });
  });

  it('助记键 resetKeys → 先切到按键页、再恢复默认', () => {
    const b = keyBindings();
    executeKeyPanelAction(
      { action: { kind: 'mnemonic', target: 'resetKeys' }, activate: undefined, key: 'r' },
      b,
    );
    // 顺序由执行体保证（switchTab → resetKeys → notice），这里断言"都发生了"
    expect(b.switchTab).toHaveBeenCalledWith('keys');
    expect(b.resetKeys).toHaveBeenCalledTimes(1);
    expect(b.notice).toHaveBeenCalledWith('settings.keysResetDone');
  });

  it('cycle → 返回新焦点（由 do_.cycleFocus 算）', () => {
    const b = keyBindings({ cycleFocus: vi.fn<() => SettingsFocus>(() => ({ zone: 'reset' })) });
    const r = executeKeyPanelAction(
      { action: { kind: 'cycle', back: true }, activate: undefined, key: 'shift+tab' },
      b,
    );
    expect(b.cycleFocus).toHaveBeenCalledWith(true);
    expect(r.focus).toEqual({ zone: 'reset' });
  });

  /** 所有分支都必须"消费"这次按键 —— `handleKey` 的返回值靠它。 */
  it('每个分支都 consumed=true', () => {
    const cases = [
      { action: { kind: 'ignore' } as const, activate: undefined, key: 'x' },
      { action: { kind: 'closePanel' } as const, activate: undefined, key: 'escape' },
      { action: { kind: 'cancelCapture' } as const, activate: undefined, key: 'escape' },
    ];
    for (const c of cases) {
      expect(executeKeyPanelAction(c, keyBindings()).consumed).toBe(true);
    }
  });

  /**
   * ==================================================================
   * 回归：`ignore` **必须**明确要求"不重画"
   * ==================================================================
   *
   * 重构时把"各分支自己重画"改成了"`handleKey` 末尾统一重画一次"，
   * 顺手把 `ignore` 也带上了 —— 而原实现里 `ignore` 是不重画的。
   *
   * 后果不是理论问题：`settingsKeys` 的 keydown **不过滤
   * `event.repeat`**，所以**按住一个与设置无关的键，就会以按键重复率
   * 反复重画整个设置面板**（几百个 Pixi 对象）。旧代码按住是零开销。
   *
   * ⚠️ 断言的是 `redraw === false` 这个**显式值**：约定是"省略即需要
   * 重画"，所以只有这一条路径该给 `false` —— 写成别的形式就说明有人
   * 动了这个语义。
   */
  it('【回归】ignore 显式要求不重画（按住无关键不该反复重绘面板）', () => {
    const r = executeKeyPanelAction(
      { action: { kind: 'ignore' } as const, activate: undefined, key: 'x' },
      keyBindings(),
    );
    expect(r.redraw).toBe(false);
  });

  it('其它分支省略 redraw（= 需要重画）', () => {
    const r = executeKeyPanelAction(
      { action: { kind: 'cancelCapture' } as const, activate: undefined, key: 'escape' },
      keyBindings(),
    );
    expect(r.redraw).toBeUndefined();
  });
});
