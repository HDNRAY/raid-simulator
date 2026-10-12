/**
 * **设置面板的输入派发** —— "这次点击 / 这次按键该做什么"的纯决策。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 顶到 700 行上限（AGENTS.md §3）。按那里的规则 ——
 * **不许靠删/压注释解决，要拆 util 或横向切割** —— 把面板里最长的两个
 * 方法（`hitTest` 约 72 行、`handleKey` 约 83 行）的**决策**切出来。
 *
 * ⚠️ 切的是决策，**不是执行** —— 面板仍然拿结果去开/关弹窗、改焦点、
 * 重画。这样这一层完全不碰 Pixi，可以直接单测（与 `logic.ts` 的
 * "为什么把判定逻辑抽出来"同一个理由）。
 *
 * ⚠️ 与 `logic.ts` 的分工：那边是"这个坐标落在哪个区域"（几何）与
 * "这个键算哪一类"（单键解析），这边是"**在当前面板状态下**该做什么"
 * （派发）。命中测试直接复用 `logic.ts` 的 `hitTest` —— 绝不再实现一遍，
 * 否则可点区会与画出来的格子再次错开。
 */

import type { KeyAction } from './logic';
import {
  hitTest as hitTestLogic,
  moveFocus,
  cycleZone,
  resolveActivate,
  resolveKeyAction,
  resolveRowTap,
  type ActivateAction,
  type Direction,
  type FocusContext,
  type SettingsFocus,
} from './logic';
import type { SettingsTab } from './tabs';
import { resolveSlotBind, resolveSlotTap } from './slotActions';
import type { OperationMode } from '../../render/platform';

/** 焦点此刻落在哪个技能格上（不在格子上、或下标越界时为 undefined）。 */
export function focusedSkillIdOf(
  focus: SettingsFocus,
  rowSkillIds: readonly string[],
): string | undefined {
  return focus.zone === 'grid' ? rowSkillIds[focus.index] ?? undefined : undefined;
}

/* ------------------------------------------------------------------ *
 * 点击
 * ------------------------------------------------------------------ */

/**
 * 点一下某个位置之后要做的事。
 *
 * 每个 kind 对应面板里的一个执行分支。执行所需的最小信息都在这里，
 * 面板不再自己重算（例如 `from`/`to` 下标）。
 */
export type PanelDispatch =
  /** 点在弹窗内的空白处：消费掉，不穿透到战斗。 */
  | { readonly kind: 'none' }
  | { readonly kind: 'close' }
  | { readonly kind: 'switchTab'; readonly tab: SettingsTab }
  /** 「通用」页切操作方式（唯一 flag 的用户入口）。 */
  | { readonly kind: 'switchOperationMode'; readonly mode: OperationMode }
  /** **键盘块**那一个「恢复默认」—— 只恢复键盘键位。 */
  | { readonly kind: 'resetKeys'; readonly notice: 'keysResetDone' }
  /**
   * 正在改键时点到另一个格子：**换按钮位**。
   *
   * ⚠️ `from`/`to` 任一为 -1 时**只重画、不改焦点**（老代码的行为：
   * 不在表里的技能点不出可换的位置，但界面仍要重画）。
   */
  | { readonly kind: 'swapSlots'; readonly from: number; readonly to: number }
  | { readonly kind: 'focusSkill'; readonly skillId: string }
  /** 选中它**并且**开始改键（再点一次已选中的格子，等价键盘的 Enter）。 */
  | { readonly kind: 'captureSkill'; readonly skillId: string }
  /**
   * ================================================================
   * 右下角**模拟键位**上的两步交互（用户 2026-10-12 定案）
   * ================================================================
   *
   *   ① 点一个键位 → `selectSlot`（再点一次 → `deselectSlot`）
   *   ② 点一个技能 → `assignTouchSlot`（绑定 / 交换）
   *   ③ 点**那个键位上已有的**技能 → `clearTouchSlot`（取下）
   *
   * ⚠️ 三个判定都来自 `slotActions`（**鼠标与键盘共用同一份**），
   * 这里只是把它接进派发链 —— 两处各写一遍必然漂。
   */
  | { readonly kind: 'selectSlot'; readonly index: number }
  | { readonly kind: 'deselectSlot' }
  | { readonly kind: 'assignTouchSlot'; readonly slot: number; readonly skillId: string }
  | { readonly kind: 'clearTouchSlot'; readonly slot: number }
  /**
   * **触屏块**那一个「恢复默认」—— 只恢复触屏键位。
   *
   * ⚠️ 与 `resetKeys` 是**两个块各自的按钮**（不再"同一个按钮按设备
   * 分流"）：哪个按钮被点，就恢复它所在那一块 —— 见
   * `settingsGeometry.RESET_BUTTON` 里那段"为什么不再是同一个按钮"。
   */
  | { readonly kind: 'resetTouch'; readonly notice: 'touchResetDone' }
  /** 拖 / 点 UI 缩放滑块：由横坐标反算倍数。 */
  | { readonly kind: 'setScaleFromPointer'; readonly px: number };

export interface PanelDispatchInput {
  readonly visible: boolean;
  readonly tab: SettingsTab;
  /** **这个来源下可见的 tab**（首页只有「通用」）—— 命中测试要用。 */
  readonly tabs: readonly SettingsTab[];
  readonly px: number;
  readonly py: number;
  readonly rowSkillIds: readonly string[];
  /** 触屏槽位表（下标 = 槽位，`''` = 空）。 */
  readonly slotSkillIds: readonly string[];
  /** 当前选中的键位（没有则 `undefined`）。 */
  readonly selectedSlot: number | undefined;
  readonly focus: SettingsFocus;
  /** 正在改键的技能 id（undefined = 没在捕获）。 */
  readonly capturingSkillId: string | undefined;
  /** 是否显示键名 —— 它决定网格度量，必须与渲染同源（见 `logic.ts` 的 `hitTest`）。 */
  readonly showKeyHints: boolean;
  /**
   * **当前操作方式**（唯一 flag，`render/platform`）。
   *
   * ⚠️ 它只回答一件事："「按键」页判**哪一块**的命中区"（键盘块还是触屏块）。
   * **不要**在这里顺手加别的 `if (touch)` —— "恢复哪一套键位"已经改成
   * "看点是哪个块里的按钮"，与设备无关（见 `./resetButton` 的删除说明）。
   */
  readonly mode: OperationMode;
  /**
   * 触屏技能面当前窗口的第一个技能下标（见 `logic.hitTest` 的同名字段）。
   */
  readonly pickerOffset: number;
}

/**
 * 点一下某个位置。命中测试自己算（不做逐对象事件绑定）—— 弹窗只有
 * 十几个可点区域，"第一个命中的"循环就够，也比 Pixi 的事件系统更容易
 * 在测试里驱动。
 */
export function resolvePanelDispatch(input: PanelDispatchInput): PanelDispatch {
  if (!input.visible) return { kind: 'none' };

  const target = hitTestLogic(input.px, input.py, {
    tab: input.tab,
    tabs: input.tabs,
    rowSkillIds: input.rowSkillIds,
    mode: input.mode,
    pickerOffset: input.pickerOffset,
    showKeyHints: input.showKeyHints,
  });

  switch (target.kind) {
    case 'outside':
      return { kind: 'close' };
    case 'tab':
      return { kind: 'switchTab', tab: target.tab };
    case 'operationMode':
      /** 「通用」页切操作方式（唯一 flag 的用户入口）。 */
      return { kind: 'switchOperationMode', mode: target.mode };
    /**
     * ⚠️ **两块各自的按钮，各自恢复自己那一份** —— 命中测试已经决定了
     * "点的是哪一块里的按钮"，这里不需要任何设备判断（上一版正是把
     * "恢复什么"交给设备探测，于是触屏笔记本上键盘键位恢复不了）。
     */
    case 'resetKeys':
      return { kind: 'resetKeys', notice: 'keysResetDone' };
    case 'resetTouch':
      return { kind: 'resetTouch', notice: 'touchResetDone' };
    case 'slot':
      /** ① 点键位：选中 / 取消选中（判定在 `slotActions`）。 */
      return resolveSlotTap(input.selectedSlot, target.index);
    /*
     * ② 点**触屏技能面**上的技能 = 绑到已选中的键位（触屏那套自己的两步
     * 交互第二步）。
     *
     * ⚠️ 没有选中键位时**什么都不做**（不猜"你想绑到第几个"）——
     * 绑定状态由第一步明确建立。判定走 `slotActions.resolveSlotBind`
     * （键盘那条路用同一个函数）。
     */
    case 'touchSkill':
      return input.selectedSlot === undefined
        ? { kind: 'none' }
        : resolveSlotBind(input.selectedSlot, input.slotSkillIds, target.skillId);
    case 'keyRow': {
      /**
       * ==============================================================
       * 键盘格阵：**永远是改键**（用户："键盘 使用之前的快捷键绑定方式"）
       * ==============================================================
       *
       * ⚠️ 上一版这里有一条"已经选中了触屏键位 → 绑到那个键位"的分流，
       * 于是同一个格子上的点击含义**随触屏状态变** ✗ —— 玩家报的困惑
       * 正是它。触屏那套现在有**自己的**技能面（`touchSkill`），
       * 键盘格阵不再兼职。
       *
       * 判定在 `rebind.resolveRowTap`（正在改键 → 换位；点已选中的格子 →
       * 进改键；其它 → 只选中）。
       */
      const action = resolveRowTap({
        focusedSkillId: focusedSkillIdOf(input.focus, input.rowSkillIds),
        capturingSkillId: input.capturingSkillId,
        touchedSkillId: target.skillId,
      });
      if (action.kind === 'bind') {
        /**
         * ⚠️ 改键时点到另一格 = **换按钮位**（技能栏槽位顺序）。
         * 详见 `app/bindingActions.ts`。
         */
        const from = input.rowSkillIds.findIndex((id) => id === input.capturingSkillId);
        const to = input.rowSkillIds.findIndex((id) => id === action.skillId);
        return { kind: 'swapSlots', from, to };
      }
      if (action.kind === 'capture') {
        /**
         * ⚠️ 顺序是"先选中、再进改键"（面板执行时两步都做）——
         * 与键盘的"方向键选中 → Enter"完全一致，见 `resolveRowTap` 的说明。
         */
        return { kind: 'captureSkill', skillId: target.skillId };
      }
      return { kind: 'focusSkill', skillId: target.skillId };
    }
    case 'close':
      // 曾经只是 Label、没有命中测试 → 点了没反应（已修）
      return { kind: 'close' };
    case 'scaleSlider':
      /**
       * 鼠标点/拖滑块：由横坐标直接反算倍数（点到哪跳到哪）。
       *
       * 需求："ui 缩放的 slider 还是要支持鼠标。"
       * 拖动也能用，因为主循环每次 pointerdown / pointermove 都会
       * 走到这里 —— 面板不需要自己维护"是否在拖"的状态。
       */
      return { kind: 'setScaleFromPointer', px: input.px };
    case 'none':
      // 点在弹窗内的空白处：消费掉，不穿透到战斗
      return { kind: 'none' };
  }
}

/* ------------------------------------------------------------------ *
 * 按键
 * ------------------------------------------------------------------ */

export interface KeyDispatchInput {
  readonly visible: boolean;
  readonly key: string;
  readonly capturingSkillId: string | undefined;
  /** 当前焦点（`activate` 要靠它解析出"激活了谁"）。 */
  readonly focus: SettingsFocus;
  readonly rowSkillIds: readonly string[];
  /** **可见的 tab 表**（`Enter` 落在 tab 行时要解析出是哪一页）。 */
  readonly tabs: readonly SettingsTab[];
  /** 触屏槽位表（下标 = 槽位，`''` = 空）—— 见 `focus.slots`。 */
  readonly slotSkillIds: readonly string[];
  /** 当前选中的键位（`Enter` 在触屏技能面上时决定"绑到哪个键位"）。 */
  readonly selectedSlot: number | undefined;
  /**
   * 触屏技能面当前窗口的第一个技能下标 —— `Enter` 落在那一面上时，
   * 焦点是**窗口内**的下标，技能 id 要按它取（见 `focus.resolveActivate`）。
   */
  readonly pickerOffset: number;
}

/** `handleKey` 的决策结果：面板拿 `action` / `activate` 去执行，`trace` 记轨迹。 */
export interface KeyPanelDispatch {
  readonly action: KeyAction;
  /**
   * `action.kind === 'activate'` 时已经解析好的动作（切 tab / 进改键 /
   * 恢复默认 / 关闭）—— 免得面板再调一次 `resolveActivate`。
   */
  readonly activate: ActivateAction | undefined;
  /**
   * 给 `settingsTrace` 的那一行 —— 把轨迹文本与决策放在一起，
   * 面板里不再有第二处 `resolveKeyAction` 调用。
   */
  readonly trace: string;
}

/**
 * 键盘输入（弹窗打开时由主循环转发）。
 *
 * ⚠️ 没打开时 `trace` 为空（不记轨迹）—— 老的 `handleKey` 第一行就是
 * `if (!this.visible) return false;`，没打开时什么都不做。
 */
export function resolveKeyDispatch(input: KeyDispatchInput): KeyPanelDispatch {
  if (!input.visible) {
    return { action: { kind: 'ignore' }, activate: undefined, trace: '' };
  }

  const action = resolveKeyAction(input.key, input.capturingSkillId !== undefined);
  const trace = `handleKey(${input.key}) cap=${input.capturingSkillId ?? '-'} -> ${action.kind}`;
  const activate =
    action.kind === 'activate'
      ? resolveActivate({
          focus: input.focus,
          tabs: input.tabs,
          rowSkillIds: input.rowSkillIds,
          slotSkillIds: input.slotSkillIds,
          selectedSlot: input.selectedSlot,
          pickerOffset: input.pickerOffset,
        })
      : undefined;

  return { action, activate, trace };
}

/* ------------------------------------------------------------------ *
 * 方向键
 * ------------------------------------------------------------------ */

/**
 * 方向键移动后的新焦点。
 *
 * ⚠️ **slider 焦点的左右是"调值"、不是"移动焦点"** —— 那种情况在这里
 * 返回 `undefined`，执行层看到之后就去调滑块（与老的 `handleKey` 的
 * `move` 分支同一判据，只是把"调值"这一步留给画滑块的人做）。
 */
export function resolveMoveFocus(input: {
  readonly focus: SettingsFocus;
  readonly direction: Direction;
  /** 这一页有什么（tab 数 / 格子数 / 有没有键位区与按钮）—— 见 `FocusContext`。 */
  readonly ctx: FocusContext;
}): SettingsFocus | undefined {
  const horizontal = input.direction === 'left' || input.direction === 'right';
  if (input.focus.zone === 'slider' && horizontal) return undefined;
  return moveFocus(input.focus, input.direction, input.ctx);
}

/** Tab / Shift+Tab 在较大区域之间切换（见 `focus.cycleZone`）。 */
export function resolveCycleFocus(input: {
  readonly focus: SettingsFocus;
  readonly ctx: FocusContext;
  readonly back: boolean;
}): SettingsFocus {
  return cycleZone(input.focus, input.ctx, input.back);
}

/* ------------------------------------------------------------------ *
 * 执行（点击 / 按键）
 * ------------------------------------------------------------------ *
 * ⚠️ 整块搬到了 `./panelExecute`（本文件又一次顶到 700 —— AGENTS.md §3 的
 * 横向切割：决策与执行本来就是两件事）。这里**转发**，外部 import 路径不变
 * —— 与 `keyNames` / `rebind` / `focus` 那几次同一个做法。
 */
export type {
  KeyActionBindings,
  KeyExecutionResult,
  KeyPanelActionInput,
  PanelActionBindings,
} from './panelExecute';
export { executeKeyPanelAction, executePanelDispatch } from './panelExecute';
