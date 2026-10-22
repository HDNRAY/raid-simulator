/**
 * **设置面板的选项装配**（它怎么读写键位表、缩放、捕获）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一块有 60 多行，而且它是一整块**内聚的知识**："设置界面能改哪些
 * 东西、改了之后要同步到哪儿"。抽出来之后 `main.ts` 只剩
 * `new SettingsPanel(buildSettingsOptions({...}))` 一行，而"改键之后
 * 必须同步到 loop + 存储"这类规则集中在一处 —— 少一处就会出现
 * "改了键但战斗里还是旧键"。
 *
 * ⚠️ **两条改动线，互不派生**（用户 2026-10-12："触屏和键盘当然是 2 套"）：
 *
 *   键位表（`apply`）      改键 / 换位 / 恢复默认 → `loop` + `settingsStore`
 *   键位表（`applyTouch`）键位指派 / 恢复默认 → 触屏层 + `settingsStore`
 *
 * ⚠️ 键位表那条**不再**同步触屏按钮：那是被推翻的派生
 * （"没绑键的技能在触屏上就没有按钮"，而触屏又进不去改键）。
 */

import { DEFAULT_BINDINGS, type KeyBinding } from '../input/keyboard';
import { assignSkillToSlot, clearSlot, defaultTouchButtonIds } from '../input/touchLayout';
import { TOUCH_BUTTON_CAPACITY } from '../render/touchGeometry';
import type { SettingsPanelOptions } from './../ui/settings/SettingsPanel';
import { rebindWithSwap, swapSlots } from './bindingActions';
import { buildKeyRows } from './keyRows';
import type { ContentRegistry } from '../core/content/registry';
import { EMPTY_SNAPSHOT } from '../render/viewModel';
import type { OperationMode } from '../render/platform';
import type { TranslateFn } from '../i18n/translator';

export interface SettingsOptionsDeps {
  /**
   * **当前出战角色的注册表**（取值函数）。
   *
   * ⚠️ 用户 2026-10-12："备战界面，**根据当前选的人**，设置里决定显示谁的
   * 技能" —— 所以键位行必须按**当前选中的角色**过滤，而不是用全局那张表
   * （那样林晚风也能给「截」绑一个她按不出来的键）。
   *
   * ⚠️ 是**取值函数**：备战界面改人选之后，下一次 `getRows()` 就该换表。
   */
  readonly getRegistry: () => ContentRegistry;
  /** 当前键位表（读引用，改键会替换它）。 */
  readonly getBindings: () => readonly KeyBinding[];
  /** 写入新键位表（同时同步到 loop / 存储 —— 见文件头）。 */
  readonly setBindings: (next: readonly KeyBinding[]) => void;
  readonly settingsStore: {
    saveBindings(b: readonly KeyBinding[]): void;
    saveTouchButtons(ids: readonly string[]): void;
    saveUiScale(v: number): void;
  };
  readonly getUiScale: () => number;
  readonly setUiScale: (v: number) => void;
  /** 当前战斗快照（设置页用它显示代价 / CD）。备战阶段给空快照。 */
  readonly snapshot: () => unknown;
  /** ⚠️ 用共享的 `TranslateFn`（带 `params`）—— 收窄成只收 `key` 会让占位符漏到界面上。 */
  readonly translate: TranslateFn;
  /**
   * **当前操作方式**（唯一 flag，见 `render/platform`）。
   *
   * ⚠️ 面板要用它回答两件事（都从这一个值派生）：
   *   - 「按键」页显示**键盘绑定**还是**触屏键位**（`caps.touch`）
   *   - 要不要拼键名提示（`caps.showKeyHints`）
   */
  readonly getOperationMode: () => OperationMode;
  /** 用户在「通用」页切了操作方式（落点在 `game.ts` 的 `applyOperationMode`）。 */
  readonly onOperationMode: (mode: OperationMode) => void;
  readonly pixi: SettingsPanelOptions['pixi'];
  /** 关闭面板（由 `settingsToggle` 处理"恢复暂停"）。 */
  readonly close: () => void;
  /**
   * **底部「回主菜单」**（2026-10-22）：面板点它时调用；装配方在这里弹
   * **二次确认**（`ui/ConfirmDialog`），确认之后才真的回主菜单。
   */
  readonly exitToHome: () => void;
  /** 键盘捕获转发（输入层独占键盘）。 */
  readonly capture: (handler: ((key: string) => void) | undefined) => void;
  /** 是否正由主监听器处理这次按键（是则跳过捕获，避免重复投递）。 */
  readonly isHandlingKeyDown: () => boolean;
  /**
   * **触屏键位表**（**下标 = 键位号**，`''` = 空键位）—— 读的是
   * `GameState`，与键盘绑定表**互不派生**（用户 2026-10-12 定案）。
   */
  readonly getTouchSkillIds: () => readonly string[];
  /** 写入触屏键位表（同时同步到触屏层与存储 —— 见文件头）。 */
  readonly setTouchSkillIds: (next: readonly string[]) => void;
}

/** 造一份设置面板选项。 */
export function buildSettingsOptions(d: SettingsOptionsDeps): SettingsPanelOptions {
  const t = d.translate;
  return {
    pixi: d.pixi,
    /**
     * ⚠️ 唯一 flag 的**读写口**：「按键」页显示哪一块、要不要拼键名，
     * 以及「通用」页那个"操作方式"选择器 —— 都走这两个函数。
     */
    getOperationMode: () => d.getOperationMode(),
    onOperationMode: (mode) => d.onOperationMode(mode),
    getTouchSlots: () => d.getTouchSkillIds(),
    /**
     * ⚠️ **透传 `params`** —— 只写 `(key) => t(key)` 会把占位符参数吃掉，
     * 界面上的 `{seconds}` 就会原样显示出来（踩过，见 `main.ts` 的 `translateSafe`）。
     */
    translate: (key, params) => t(key, params),
    getRows: () =>
      buildKeyRows({
        bindings: d.getBindings(),
        registry: d.getRegistry(),
        snapshotOf: () => (d.snapshot() ?? EMPTY_SNAPSHOT) as never,
        translate: t,
      }),
    onRebind: (skillId, key) => {
      apply(d, rebindWithSwap(d.getBindings(), skillId, key));
    },
    /** 触屏换位（与改键分开：那个换键、这个换**位置**）。 */
    onSwapSlots: (from, to) => {
      apply(d, swapSlots(d.getBindings(), from, to));
    },
    /**
     * **两步交互的落点**：把技能绑到某个键位（用户 2026-10-12：
     * "点键位 =》 点技能 =》 绑定这个技能到这个键位"）。
     *
     * ⚠️ 改的是**触屏键位表**（`GameState.touchButtons`），与键位表无关 ——
     * 这正是那条被切断的派生（"有键的技能才有触屏按钮"）。
     */
    onAssignTouchSlot: (slot, skillId) => {
      applyTouch(d, assignSkillToSlot(d.getTouchSkillIds(), slot, skillId));
    },
    /** 取下某个键位上的技能（判定在 `ui/settings/slotActions`）。 */
    onClearTouchSlot: (slot) => {
      applyTouch(d, clearSlot(d.getTouchSkillIds(), slot));
    },
    /** 「触屏默认」：回到"默认键位表里那些有键的技能"（截到容量）。 */
    onResetTouchButtons: () => {
      applyTouch(d, defaultTouchButtonIds(TOUCH_BUTTON_CAPACITY));
    },
    onResetKeys: () => {
      /** 恢复默认**也覆盖存储**，否则刷新之后又变回玩家改过的键位。 */
      apply(d, DEFAULT_BINDINGS);
    },
    /**
     * 把捕获回调包一层：**主监听器正在处理这次按键时直接跳过**。
     *
     * 否则那一次按键会被输入层重复投递，导致"一次按键进入改键并立刻
     * 完成绑定"。
     */
    onCapture: (handler) =>
      d.capture(
        handler === undefined
          ? undefined
          : (key) => {
              if (d.isHandlingKeyDown()) return;
              handler(key);
            },
      ),
    onClose: () => d.close(),
    /** 只转发 —— "要不要确认、确认之后去哪"在 `game.ts`。 */
    onExitToHome: () => d.exitToHome(),
    getUiScale: () => d.getUiScale(),
    onUiScale: (value) => d.setUiScale(value),
  };
}

/** 三条改动路径共用的同步（见文件头的"三处同步"）。 */
function apply(d: SettingsOptionsDeps, next: readonly KeyBinding[]): void {
  d.setBindings([...next]);
  d.settingsStore.saveBindings(d.getBindings());
}

/**
 * 触屏按钮改动的同步 —— 与 `apply` 同一条纪律：
 *   `setTouchSkillIds`（内存 + 触屏层）→ `saveTouchButtons`（存储）。
 *
 * ⚠️ 与键位表**分开的两个函数**（不是给 `apply` 加一个参数）：
 * 两者改的是不同的东西（键位表 vs 按钮集合），合在一起的签名会让人以为
 * "改键也要写一遍按钮"，而那正是那条被推翻的派生关系。
 */
function applyTouch(d: SettingsOptionsDeps, next: readonly string[]): void {
  d.setTouchSkillIds(next);
  d.settingsStore.saveTouchButtons(next);
}
