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
 *
 * ==================================================================
 * ⚠️ 2026-10-12：按**操作方式**分成两套区（不再"缝在同一批格子上"）
 * ==================================================================
 *
 * 用户报障的顺序说明了问题：
 *
 *   1. "键盘 **不显示**右下角的那个"（触屏键位预览）
 *   2. "触屏**没有点击进入绑定状态**"
 *   3. "虽然都是 **按键 tab**，但是里面的实现**有一半都不一样**"
 *
 * 上一版把两套缝在同一批技能格上：格子上 `Enter` 是"改键"还是"绑到键位"
 * **取决于有没有选中键位** ✗ —— 那正是玩家的困惑来源。现在：
 *
 *   | 操作方式 | 「按键」页的区 |
 *   |---|---|
 *   | 键盘 | `grid`（技能格）+ `reset`（键盘默认） |
 *   | 触屏 | `picker`（触屏技能面）+ `slots`（键位预览）+ `touchReset`（触屏默认） |
 *
 * 两块**互斥**（`hasGrid` / `hasPicker` 不会同时为真），本模型只回答
 * "在这几块之间怎么走" —— "这一页有什么"由调用方（`./panelFocus`）给。
 */

import { KEY_GRID } from './settingsGeometry';
import { TOUCH_BUTTON_CAPACITY } from '../../render/touchGeometry';
import type { SettingsTab } from './tabs';
import { operationModeAt } from './operationModeRow';
import { resolveSlotBind } from './slotActions';
import type { OperationMode } from '../../render/platform';

/**
 * 键盘焦点位置。
 *
 * 用一个**线性游标**而不是"tab 索引 + 列 + 行"三件套：箭头键的处理
 * 只需要"往哪个方向找下一个"，而线性游标把这个逻辑收敛成一次
 * 索引运算，顺便让"Tab 也能切换"变得免费。
 */
export type SettingsFocus =
  | { readonly zone: 'tabs'; readonly index: number }
  /** 键盘那套的**技能格**（`index` 是行下标）。 */
  | { readonly zone: 'grid'; readonly index: number }
  /**
   * 触屏那套的**技能面**（`index` 是**窗口内**的格子下标）。
   *
   * ⚠️ 与 `grid` 是两个不同的区：它们的技能池一样、格子位置甚至一样，
   * 但**语义不同**（这一格是"改键"还是"绑到已选键位"）—— 用户明确说
   * "里面的实现有一半都不一样"，所以状态与命中区都分开。
   */
  | { readonly zone: 'picker'; readonly index: number }
  /** 触屏键位槽位（右下角的双弧预览）。 */
  | { readonly zone: 'slots'; readonly index: number }
  | { readonly zone: 'slider' }
  /** 「通用」页的操作方式选择器（键盘 / 触屏）。 */
  | { readonly zone: 'mode'; readonly index: number }
  /** 键盘块那一个「恢复默认」（提示文字下面）。 */
  | { readonly zone: 'reset' }
  /** 触屏块那一个「恢复默认」（键位预览下面）。 */
  | { readonly zone: 'touchReset' }
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
  /** 可聚焦的**键盘**技能格数（键盘方式；触屏方式给 0）。 */
  readonly cellCount: number;
  readonly hasGrid: boolean;
  readonly hasSlider: boolean;
  /** 有没有触屏**键位区**（右下角预览）。 */
  readonly hasSlots: boolean;
  /** 有没有触屏**技能面**（两步交互的第二步）。 */
  readonly hasPicker: boolean;
  /** 有没有操作方式选择器（「通用」页）。 */
  readonly hasMode: boolean;
  /** 有没有**键盘块**那个「恢复默认」。 */
  readonly hasReset: boolean;
  /** 有没有**触屏块**那个「恢复默认」。 */
  readonly hasTouchReset: boolean;
  /**
   * 触屏技能面**能聚焦几格**（= 窗口容量与技能数的小者）。
   *
   * ⚠️ 焦点不该走到画不出来的格子上，否则 `Enter` 会"对空气绑定"。
   */
  readonly pickerCount: number;
  /**
   * 进入 `slots` 区时落在哪个槽位 —— 调用方传**已选中的那个**
   * （没有选中就给 0），于是方向键回到键位区时不会跳回第 1 个。
   */
  readonly slotIndex: number;
  /** 触屏技能面几列（缺省 3 —— 与 `touchPickerLayout.TOUCH_PICKER_COLS` 同源）。 */
  readonly pickerCols?: number;
  /**
   * **键盘格子这一屏是几列**（缺省 = 桌面那套 `KEY_GRID.cols`）。
   *
   * ==================================================================
   * 为什么它必须由调用方给，而不是模型自己读常量
   * ==================================================================
   *
   * 桌面是 **4 列**、触屏是 **3 列**（见 `settingsGeometry.KEY_GRID.cols` /
   * `TOUCH_GRID_COLS`）—— `cellCount` 相同（都是 8 个技能）而列数不同时，
   * `↓` 该跳 4 格还是 3 格**只能按当前那一屏**算。
   * 模型里读 `KEY_GRID.cols` 会在触屏上斜着跳（焦点落到旁边的列上），
   * 那是"按了 ↓、光标横着跑了"这种一眼可见的 bug。
   */
  readonly gridCols?: number;
  /**
   * **最多可聚焦几行**（缺省 = 由 `cellCount` 与列数推出来）。
   *
   * ⚠️ 它给"技能比格子多"兜底：焦点不该走到**画不出来**的格子上，
   * 否则按 `Enter` 会"对空气改键"（本仓库已有的那条断言就是在防这个）。
   */
  readonly gridRows?: number;
}

/** 槽位序号钳到 0..容量-1。 */
function clampSlot(index: number): SettingsFocus {
  return { zone: 'slots', index: Math.min(Math.max(0, index), TOUCH_BUTTON_CAPACITY - 1) };
}

/** 操作方式序号钳到 0..1。 */
function clampMode(index: number): SettingsFocus {
  return { zone: 'mode', index: index <= 0 ? 0 : 1 };
}

/** 触屏技能面的格子序号（钳进 `[0, pickerCount-1]`，空面给 0）。 */
function clampPicker(index: number, ctx: FocusContext): SettingsFocus {
  const max = Math.max(0, ctx.pickerCount - 1);
  return { zone: 'picker', index: Math.min(Math.max(0, index), max) };
}

/** 「往下进入内容区」的那一块（tab 行按下 / 底部区往上越界时用）。 */
function belowTabs(ctx: FocusContext): SettingsFocus {
  if (ctx.hasGrid) return { zone: 'grid', index: 0 };
  if (ctx.hasPicker) return clampPicker(0, ctx);
  if (ctx.hasSlider) return { zone: 'slider' };
  if (ctx.hasMode) return clampMode(0);
  return { zone: 'tabs', index: 0 };
}

/** 底部那一区（`reset` / `touchReset`）**往上**回到哪。 */
function aboveBottom(ctx: FocusContext): SettingsFocus {
  if (ctx.hasGrid && ctx.cellCount > 0) return { zone: 'grid', index: ctx.cellCount - 1 };
  if (ctx.hasPicker) return clampPicker(ctx.pickerCount - 1, ctx);
  if (ctx.hasSlots) return clampSlot(ctx.slotIndex);
  if (ctx.hasSlider) return { zone: 'slider' };
  if (ctx.hasMode) return clampMode(0);
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
    if (direction === 'down') return ctx.hasMode ? clampMode(0) : { zone: 'tabs', index: 0 };
    return { zone: 'tabs', index: 0 };
  }

  if (focus.zone === 'mode') {
    /** 左右在"键盘 / 触屏"之间走；上下离开这一行。 */
    if (direction === 'left') return clampMode(focus.index - 1);
    if (direction === 'right') return clampMode(focus.index + 1);
    if (direction === 'up') return ctx.hasSlider ? { zone: 'slider' } : { zone: 'tabs', index: 0 };
    /** 操作方式下面是空的（「通用」页没有恢复按钮）—— 停在原地。 */
    return focus;
  }

  if (focus.zone === 'slots') {
    /** 槽位之间左右走（线性，与预览里的编号一致）；上下离开这一区。 */
    if (direction === 'left') return clampSlot(focus.index - 1);
    if (direction === 'right') return clampSlot(focus.index + 1);
    /**
     * ⚠️ 键位区之上是**触屏技能面**（两步交互的第二步就在那儿），
     * 之下是它**自己那一块**的恢复按钮。
     */
    if (direction === 'up') {
      return ctx.hasPicker ? clampPicker(ctx.pickerCount - 1, ctx) : { zone: 'tabs', index: 0 };
    }
    return ctx.hasTouchReset ? { zone: 'touchReset' } : focus;
  }

  if (focus.zone === 'picker') {
    const cols = Math.max(1, ctx.pickerCols ?? 3);
    const rows = Math.max(1, Math.ceil(Math.max(1, ctx.pickerCount) / cols));
    const col = focus.index % cols;
    const row = Math.floor(focus.index / cols);
    const to = (i: number): SettingsFocus =>
      i >= 0 && i < ctx.pickerCount ? { zone: 'picker', index: i } : focus;
    if (direction === 'left') return col > 0 ? to(focus.index - 1) : focus;
    if (direction === 'right') return col < cols - 1 ? to(focus.index + 1) : focus;
    if (direction === 'up') {
      return row > 0 ? to(focus.index - cols) : { zone: 'tabs', index: 0 };
    }
    // 最后一行再往下 = 去键位区（两步交互顺着走）
    if (row < rows - 1) {
      const next = to(focus.index + cols);
      if (next !== focus) return next;
    }
    return ctx.hasSlots ? clampSlot(ctx.slotIndex) : focus;
  }

  if (focus.zone === 'reset') {
    /** 上回到键盘格阵（键盘方式下它是最后一块内容）。 */
    if (direction === 'up') return aboveBottom(ctx);
    return focus;
  }

  if (focus.zone === 'touchReset') {
    if (direction === 'up') {
      return ctx.hasSlots ? clampSlot(ctx.slotIndex) : aboveBottom(ctx);
    }
    return focus;
  }

  // 网格：左右在同一行内移动，上下按列移动；越界则换区
  // ⚠️ 必须先收窄到 grid —— 焦点也可能停在 tabs / slider / reset / close 上
  if (focus.zone !== 'grid') return focus;
  const index = focus.index;
  /**
   * ⚠️ 列/行取**当前这一屏**的（见 `FocusContext.gridCols`）：桌面 4 列、
   * 触屏 3 列。缺省回落到桌面常量，是为了让"没传"的旧调用点保持原语义。
   */
  const cols = Math.max(1, ctx.gridCols ?? KEY_GRID.cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  const rows = Math.max(
    1,
    ctx.gridRows ?? Math.ceil(ctx.cellCount / cols),
  );

  const clampToCell = (i: number): SettingsFocus =>
    i >= 0 && i < ctx.cellCount ? { zone: 'grid', index: i } : focus;

  switch (direction) {
    case 'left':
      return col > 0 ? clampToCell(index - 1) : focus;
    case 'right':
      return col < cols - 1 ? clampToCell(index + 1) : focus;
    case 'up':
      if (row > 0) return clampToCell(index - cols);
      return { zone: 'tabs', index: 0 };
    case 'down': {
      if (row < rows - 1) {
        const next = index + cols;
        // 最后一行的空位不落焦点
        if (next < ctx.cellCount) return { zone: 'grid', index: next };
      }
      /**
       * ⚠️ 格阵之下是**本块自己的**恢复按钮（键盘方式没有键位区）——
       * 见 `FocusContext` 那段"按操作方式分成两套区"。
       */
      return ctx.hasReset ? { zone: 'reset' } : focus;
    }
  }
}

/** Tab / Shift+Tab 在较大区域之间切换（无障碍习惯用 Tab，所以也支持）。 */
export function cycleZone(focus: SettingsFocus, ctx: FocusContext, back = false): SettingsFocus {
  /**
   * Tab 顺序跟着"这一页实际有什么"走 —— 见 `FocusContext` 的说明。
   *
   * ⚠️ `reset` / `touchReset` 按"那一块在不在"进表：上一版无条件把 `reset`
   * 放进去，于是「通用」页（没有恢复按钮）按 Tab 会落在一个**看不见**的
   * 按钮上 —— 而这一轮的另一条纪律正是"焦点不落在画不出来的东西上"。
   */
  const usable: SettingsFocus['zone'][] = ['tabs'];
  if (ctx.hasGrid && ctx.cellCount > 0) usable.push('grid');
  if (ctx.hasPicker) usable.push('picker');
  if (ctx.hasSlots) usable.push('slots');
  if (ctx.hasTouchReset) usable.push('touchReset');
  if (ctx.hasSlider) usable.push('slider');
  if (ctx.hasMode) usable.push('mode');
  if (ctx.hasReset) usable.push('reset');
  usable.push('close');
  const current = usable.indexOf(focus.zone);
  const step = back ? -1 : 1;
  const next = usable[(current + step + usable.length) % usable.length] ?? 'tabs';
  if (next === 'grid') {
    const index = focus.zone === 'grid' ? focus.index : 0;
    return { zone: 'grid', index: Math.min(index, Math.max(0, ctx.cellCount - 1)) };
  }
  if (next === 'picker') return clampPicker(focus.zone === 'picker' ? focus.index : 0, ctx);
  if (next === 'slots') return clampSlot(ctx.slotIndex);
  if (next === 'touchReset') return { zone: 'touchReset' };
  if (next === 'slider') return { zone: 'slider' };
  if (next === 'mode') {
    return clampMode(focus.zone === 'mode' ? focus.index : 0);
  }
  if (next === 'tabs') return { zone: 'tabs', index: 0 };
  if (next === 'close') return { zone: 'close' };
  return { zone: 'reset' };
}

/**
 * 激活当前焦点时的动作。
 *
 * ⚠️ 触屏键位的两步交互就落在这里（**触屏那套自己的区**）：
 *   `selectSlot`     在键位区（`slots`）按 `Enter` = 选中这个键位
 *   `pickSkill`      在触屏技能面（`picker`）按 `Enter` = 绑到那个键位
 *   `clearTouchSlot` 绑"它已经在那儿"的那个技能 = 取下（判定在 `slotActions`）
 *
 * ⚠️ **键盘技能格（`grid`）上的 `Enter` 永远是 `startCapture`（改键）** ——
 * 它**不**随"有没有选中触屏键位"变（用户报的正是那个混淆）。
 *
 * 鼠标那条路走 `panelDispatch`，但"绑 / 取下"的判定是**同一份**
 * （`slotActions.resolveSlotBind`）—— 两处各写一遍必然漂。
 */
export type ActivateAction =
  | { readonly kind: 'switchTab'; readonly tab: SettingsTab }
  | { readonly kind: 'switchOperationMode'; readonly mode: OperationMode }
  | { readonly kind: 'startCapture'; readonly skillId: string }
  | { readonly kind: 'selectSlot'; readonly index: number }
  | { readonly kind: 'deselectSlot' }
  /** 触屏技能面上的一个技能 → 绑到**已选中**的那个键位（或取下）。 */
  | { readonly kind: 'assignTouchSlot'; readonly slot: number; readonly skillId: string }
  | { readonly kind: 'clearTouchSlot'; readonly slot: number }
  /** 键盘块那一个「恢复默认」—— **只**恢复键盘键位。 */
  | { readonly kind: 'resetKeys' }
  /** 触屏块那一个「恢复默认」—— **只**恢复触屏键位。 */
  | { readonly kind: 'resetTouch' }
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
  /**
   * 触屏技能面**当前窗口**的第一个技能在 `rowSkillIds` 里的下标。
   *
   * ⚠️ 焦点是**窗口内**的下标，而技能 id 要按窗口偏移取 —— 少了它，
   * 滚动过的列表会"点第 1 格绑了第 5 个技能"。
   */
  readonly pickerOffset: number;
}

export function resolveActivate(input: ActivateInput): ActivateAction {
  const { focus } = input;
  if (focus.zone === 'tabs') {
    return { kind: 'switchTab', tab: input.tabs[focus.index] ?? input.tabs[0] ?? 'general' };
  }
  if (focus.zone === 'reset') return { kind: 'resetKeys' };
  if (focus.zone === 'touchReset') return { kind: 'resetTouch' };
  if (focus.zone === 'close') return { kind: 'close' };
  // slider 没有"激活"动作 —— 它的变化由左右方向键直接完成
  if (focus.zone === 'slider') return { kind: 'none' };
  if (focus.zone === 'mode') {
    const mode = operationModeAt(focus.index);
    return mode === undefined ? { kind: 'none' } : { kind: 'switchOperationMode', mode };
  }

  if (focus.zone === 'slots') {
    /** 再按一次已选中的键位 = **取消选中**（不清空，清空见 `slotActions`）。 */
    return input.selectedSlot === focus.index
      ? { kind: 'deselectSlot' }
      : { kind: 'selectSlot', index: focus.index };
  }

  if (focus.zone === 'picker') {
    const skillId = input.rowSkillIds[input.pickerOffset + focus.index];
    /**
     * ⚠️ **没有选中键位时什么都不做**（不猜"你想绑到第几个"）：
     * 绑定状态由键位区那一步明确建立，提示行写着"点键位 → 点技能"。
     *
     * ⚠️ "绑 / 取下"的判定走 `slotActions.resolveSlotBind` —— 与鼠标那条路
     * **同一份**（两处各写一遍必然漂）。
     */
    if (skillId === undefined || input.selectedSlot === undefined) return { kind: 'none' };
    return resolveSlotBind(input.selectedSlot, input.slotSkillIds, skillId);
  }

  const skillId = input.rowSkillIds[focus.index];
  if (skillId === undefined) return { kind: 'none' };
  /**
   * ⚠️ **永远**是改键（`startCapture`）—— 上一版这里有一条
   * `if (selectedSlot !== undefined) return resolveSlotBind(...)`，
   * 它让同一个格子上的 `Enter` 含义随触屏选中状态变，用户明确不要
   * （"键盘 使用之前的快捷键绑定方式"）。
   */
  return { kind: 'startCapture', skillId };
}
