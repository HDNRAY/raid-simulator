/**
 * 设置面板的**焦点模型**：方向键 / Tab 走到哪，`Enter` 激活谁。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `ui/settings/logic.ts` 里原本装着三件事：几何、命中测试、焦点模型。
 * 这一轮加了**触屏键位槽位**这个新的焦点区（右下角的模拟键位），
 * 焦点模型的分支明显变多 —— 而它与"坐标落在哪"本来就不是一件事
 * （几何是"画在哪"，焦点是"键盘在谁身上"）。按 AGENTS.md §3 的顺序，
 * 先**横向切割**再谈行数。
 *
 * ⚠️ 纯函数：不碰 Pixi、不碰 DOM，可以直接单测（与 `logic.ts` 同一个理由）。
 */

import { KEY_GRID } from './settingsGeometry';
import { TOUCH_BUTTON_CAPACITY } from '../../render/touchGeometry';
import type { SettingsTab } from './tabs';
import { resolveSlotBind } from './slotActions';

/**
 * 键盘焦点位置。
 *
 * 用一个**线性游标**而不是"tab 索引 + 列 + 行"三件套：箭头键的处理
 * 只需要"往哪个方向找下一个"，而线性游标把这个逻辑收敛成一次
 * 索引运算，顺便让"Tab 也能切换"变得免费。
 *
 * ⚠️ `slots` = 右下角那组**触屏键位槽位**（`index` 是槽位号）。
 * 它与 `grid` 是两个区：`grid` 是技能表，`slots` 是键位。
 * 两者之间靠方向键上下走（见 `moveFocus`）。
 */
export type SettingsFocus =
  | { readonly zone: 'tabs'; readonly index: number }
  | { readonly zone: 'grid'; readonly index: number }
  | { readonly zone: 'slots'; readonly index: number }
  | { readonly zone: 'slider' }
  /**
   * 底部**唯一**那个「恢复默认」按钮。
   *
   * ⚠️ 原先还有 `touchReset`（并排的第二个按钮）。用户 2026-10-12：
   * "恢复默认和触屏默认 **同一时间显示一个按钮**就可以了，根据当前是否是
   * 触屏" —— 所以那个焦点区整块删掉了；"恢复什么"由设备能力决定
   * （`./resetButton.resetTargetFor`），焦点模型不认识这件事。
   */
  | { readonly zone: 'reset' }
  /** 右上角的「关闭」 */
  | { readonly zone: 'close' };

/** 初始焦点：第一个技能格（最常改的东西）。 */
export const INITIAL_FOCUS: SettingsFocus = { zone: 'grid', index: 0 };

/** 方向键。 */
export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * 焦点模型要的**这页有什么**。
 *
 * ⚠️ 全是参数而不是在模型里读 tab 语义：模型只负责"在这几块之间走"，
 * 调用方说"这页有什么"。这样加一块新区域（比如以后的音量条）时，
 * 判断留在调用方，模型不用认识它。
 */
export interface FocusContext {
  /** 可见的 tab 数（首页只有 1 个）。 */
  readonly tabCount: number;
  /** 可聚焦的技能格数。 */
  readonly cellCount: number;
  readonly hasGrid: boolean;
  readonly hasSlider: boolean;
  /** 有没有触屏键位区（右下角预览）。 */
  readonly hasSlots: boolean;
  /**
   * 进入 `slots` 区时落在哪个槽位 —— 调用方传**已选中的那个**
   * （没有选中就给 0），于是方向键回到键位区时不会跳回第 1 个。
   */
  readonly slotIndex: number;
}

/** 槽位序号钳到 0..容量-1。 */
function clampSlot(index: number): number {
  return Math.min(Math.max(0, index), TOUCH_BUTTON_CAPACITY - 1);
}

/** 「往下一块」的那块（tab 行按下时用，见 `moveFocus`）。 */
function belowTabs(ctx: FocusContext): SettingsFocus {
  if (ctx.hasGrid) return { zone: 'grid', index: 0 };
  if (ctx.hasSlider) return { zone: 'slider' };
  return { zone: 'reset' };
}

/** 「往上一块」的那块（键位区 / 按钮按下时用）。 */
function aboveBottom(ctx: FocusContext): SettingsFocus {
  if (ctx.hasSlots) return { zone: 'slots', index: clampSlot(ctx.slotIndex) };
  if (ctx.hasGrid && ctx.cellCount > 0) return { zone: 'grid', index: ctx.cellCount - 1 };
  if (ctx.hasSlider) return { zone: 'slider' };
  return { zone: 'tabs', index: 0 };
}

/**
 * 方向键移动后的新焦点。
 *
 * ⚠️ **`slider` 的左右是"调值"、不是"移动焦点"** —— 那种情况由调用方
 * 处理（`panelDispatch.resolveMoveFocus` 返回 `undefined` 表示"去调滑块"）。
 */
export function moveFocus(
  focus: SettingsFocus,
  direction: Direction,
  ctx: FocusContext,
): SettingsFocus {
  if (focus.zone === 'tabs') {
    // tab 行是横向的一排
    const count = Math.max(1, ctx.tabCount);
    if (direction === 'left') return { zone: 'tabs', index: (focus.index + count - 1) % count };
    if (direction === 'right') return { zone: 'tabs', index: (focus.index + 1) % count };
    return belowTabs(ctx);
  }

  if (focus.zone === 'slider') {
    // slider **不吃上下**：上下是"离开这一行"，左右留给调用方当调节键
    if (direction === 'down') return { zone: 'reset' };
    return { zone: 'tabs', index: 0 };
  }

  if (focus.zone === 'slots') {
    /** 槽位之间左右走（线性，与预览里的编号一致）；上下离开这一区。 */
    if (direction === 'left') return { zone: 'slots', index: clampSlot(focus.index - 1) };
    if (direction === 'right') return { zone: 'slots', index: clampSlot(focus.index + 1) };
    if (direction === 'up') return aboveBottom({ ...ctx, hasSlots: false });
    return { zone: 'reset' };
  }

  if (focus.zone === 'reset') {
    /**
     * ⚠️ 右边**没有**第二个按钮了（用户 2026-10-12 定案）——所以"右"在
     * 这里就是停在原地，而不是"跳到触屏默认"。
     */
    if (direction === 'left' || direction === 'up') return aboveBottom(ctx);
    return focus;
  }

  // 网格：左右在同一行内移动，上下按列移动；越界则换区
  // ⚠️ 必须先收窄到 grid —— 焦点也可能停在 tabs / slider / reset / close 上
  if (focus.zone !== 'grid') return focus;
  const index = focus.index;
  const col = index % KEY_GRID.cols;
  const row = Math.floor(index / KEY_GRID.cols);
  const rows = Math.max(1, Math.ceil(ctx.cellCount / KEY_GRID.cols));

  const clampToCell = (i: number): SettingsFocus =>
    i >= 0 && i < ctx.cellCount ? { zone: 'grid', index: i } : focus;

  switch (direction) {
    case 'left':
      return col > 0 ? clampToCell(index - 1) : focus;
    case 'right':
      return col < KEY_GRID.cols - 1 ? clampToCell(index + 1) : focus;
    case 'up':
      if (row > 0) return clampToCell(index - KEY_GRID.cols);
      return { zone: 'tabs', index: 0 };
    case 'down': {
      if (row < rows - 1) {
        const next = index + KEY_GRID.cols;
        // 最后一行的空位不落焦点
        if (next < ctx.cellCount) return { zone: 'grid', index: next };
      }
      /** ⚠️ 网格之下是**键位区**（右下角的模拟键位），再往下才是按钮。 */
      return ctx.hasSlots
        ? { zone: 'slots', index: clampSlot(ctx.slotIndex) }
        : { zone: 'reset' };
    }
  }
}

/** Tab / Shift+Tab 在较大区域之间切换（无障碍习惯用 Tab，所以也支持）。 */
export function cycleZone(focus: SettingsFocus, ctx: FocusContext, back = false): SettingsFocus {
  /** Tab 顺序跟着"这一页实际有什么"走 —— 见 `FocusContext` 的说明 */
  const usable: SettingsFocus['zone'][] = ['tabs'];
  if (ctx.cellCount > 0) usable.push('grid');
  if (ctx.hasSlots) usable.push('slots');
  if (ctx.hasSlider) usable.push('slider');
  usable.push('reset');
  usable.push('close');
  const current = usable.indexOf(focus.zone);
  const step = back ? -1 : 1;
  const next = usable[(current + step + usable.length) % usable.length] ?? 'tabs';
  if (next === 'grid') {
    const index = focus.zone === 'grid' ? focus.index : 0;
    return { zone: 'grid', index: Math.min(index, Math.max(0, ctx.cellCount - 1)) };
  }
  if (next === 'slots') return { zone: 'slots', index: clampSlot(ctx.slotIndex) };
  if (next === 'slider') return { zone: 'slider' };
  if (next === 'tabs') return { zone: 'tabs', index: 0 };
  if (next === 'close') return { zone: 'close' };
  return { zone: 'reset' };
}

/**
 * 激活当前焦点时的动作。
 *
 * ⚠️ 触屏键位的两步交互就落在这里：
 *   `selectSlot`     在键位区按 `Enter` = 选中这个键位
 *   `assignTouchSlot` 选中键位之后在技能格上按 `Enter` = **绑上去**
 *   `clearTouchSlot`  在那个键位上点它**已有的技能** = 取下（见 `slotActions`）
 *
 * 鼠标那条路走 `panelDispatch`，但**判定是同一份**（`slotActions`）——
 * 两处各写一遍必然漂。
 */
export type ActivateAction =
  | { readonly kind: 'switchTab'; readonly tab: SettingsTab }
  | { readonly kind: 'startCapture'; readonly skillId: string }
  | { readonly kind: 'selectSlot'; readonly index: number }
  | { readonly kind: 'deselectSlot' }
  | { readonly kind: 'assignTouchSlot'; readonly slot: number; readonly skillId: string }
  | { readonly kind: 'clearTouchSlot'; readonly slot: number }
  /**
   * 底部那个唯一按钮。⚠️ "恢复键盘还是触屏"**不在这里**判断 ——
   * 执行层按设备能力分流（`./resetButton.resetTargetFor`），
   * 焦点模型只回答"玩家按了那个按钮"。
   */
  | { readonly kind: 'resetKeys' }
  | { readonly kind: 'close' }
  | { readonly kind: 'none' };

export interface ActivateInput {
  readonly focus: SettingsFocus;
  /** **可见**的 tab 表（首页只有「通用」）。 */
  readonly tabs: readonly SettingsTab[];
  readonly rowSkillIds: readonly string[];
  /** 触屏槽位表（下标 = 槽位，`''` = 空）。 */
  readonly slotSkillIds: readonly string[];
  /** 当前选中的键位（没有则 `undefined`）。 */
  readonly selectedSlot: number | undefined;
}

export function resolveActivate(input: ActivateInput): ActivateAction {
  const { focus } = input;
  if (focus.zone === 'tabs') {
    return { kind: 'switchTab', tab: input.tabs[focus.index] ?? input.tabs[0] ?? 'general' };
  }
  if (focus.zone === 'reset') return { kind: 'resetKeys' };
  if (focus.zone === 'close') return { kind: 'close' };
  // slider 没有"激活"动作 —— 它的变化由左右方向键直接完成
  if (focus.zone === 'slider') return { kind: 'none' };

  if (focus.zone === 'slots') {
    /** 再按一次已选中的键位 = **取消选中**（不清空，清空见 `slotActions`）。 */
    return input.selectedSlot === focus.index
      ? { kind: 'deselectSlot' }
      : { kind: 'selectSlot', index: focus.index };
  }

  const skillId = input.rowSkillIds[focus.index];
  if (skillId === undefined) return { kind: 'none' };
  /**
   * ⚠️ **有选中的键位时，技能格上的"激活"是"绑到这个键位"** ——
   * 这正是用户要的两步交互（点键位 → 点技能）。没有选中键位时才是改键。
   */
  if (input.selectedSlot !== undefined) {
    return resolveSlotBind(input.selectedSlot, input.slotSkillIds, skillId);
  }
  return { kind: 'startCapture', skillId };
}
