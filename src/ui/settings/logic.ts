/**
 * 设置界面的**纯逻辑**（不碰 Pixi）：几何、焦点、按键解析。
 *
 * ==================================================================
 * 为什么把判定逻辑抽出来
 * ==================================================================
 *
 * `SettingsPanel` 要构造 Pixi 对象，而 Pixi v8 在 jsdom 里不好跑（需要真
 * canvas / WebGL）。如果判定逻辑留在类里，就只能写"能构造、不报错"这种
 * **几乎没有信息**的冒烟测试。
 *
 * 抽出来之后可以在 node 环境里精确测：
 *   - 点击命中了哪个区域
 *   - 改键是否冲突、冲突时该做什么
 *   - 某个键该不该被弹窗消费掉
 *   - 键名怎么显示
 *
 * ⚠️ 这段理由曾经被我在"压注释腾行数"时删掉了（见 AGENTS.md §3 的
 * "不许靠删/压注释解决"）。它解释的是**架构为什么长这样**，删掉之后
 * 下一个人只会看到"逻辑被拆开了"，不知道该不该拆回去。
 */

/**
 * 共享几何常量（**叶子模块**，见那里的说明 —— 留在这会造循环依赖）。
 * 转发出去，外部 import 路径不变。
 */
import { MNEMONIC_KEYS } from './keyNames';
import type { OperationMode } from '../../render/platform';
import { OPERATION_MODE_ORDER } from './operationModeRow';
import { pickerCellAt, pickerMetrics } from './touchPickerLayout';
/**
 * ⚠️ **缩放后的几何**（这一轮加的 UI 缩放）—— 命中测试与绘制必须读**同一份**，
 * 所以实现在 `./settingsScale`（唯一写入路径 + 当前读数都在那里），
 * 本文件只 import 自己算命中要用的那几个，并把外部要的**转发**出去。
 */
import {
  closeButtonRect,
  insidePanel,
  keyCellRect,
  gridCapacityFor,
  gridMetricsFor,
  modeButtonRect,
  resetButtonRect,
  sliderRect,
  tabRect,
  touchResetButtonRect,
} from './settingsScale';
/**
 * ⚠️ `tab` 的**可见集合**是"按从哪打开取值"的（用户 2026-10-12：
 * "首页点开的设置，可以不要 按键tab"），真相在 `./tabs`。这里只转发类型，
 * 外部 import 路径不变；**判据只有那一份**。
 */
import type { SettingsTab } from './tabs';
import { previewSlotAt } from './touchPreview';
/**
 * 键名显示与助记键反查搬到了 `./keyNames`（那一撮自成一体的）。
 * 这里**转发**，外部 import 路径不变。
 */
export {
  EMPTY_KEY,
  MNEMONIC_KEYS,
  SLOT_NAV_KEYS,
  keyLabel,
  mnemonicKeyOf,
  slotNavKeyHint,
} from './keyNames';
/**
 * 改键语义（`RebindResult` / `applyRebind` / `swapSlotSkills` /
 * `resolveRowTap`）搬到了 `./rebind`（logic.ts 又一次顶到 700 行）。
 * 这里**转发**，外部 import 路径不变 —— 与上面 `keyNames` 同一做法。
 */
export type { RebindResult } from './rebind';
export { applyRebind, swapSlotSkills, resolveRowTap } from './rebind';
export {
  SETTINGS_PANEL,
  KEY_GRID,
  RESET_BUTTON,
  SKILL_DETAIL,
  HINT_LINE,
  HINT_LINES,
  HINT_BLOCK_TOP,
  DETAIL_BOTTOM,
  TOUCH_PREVIEW,
  TOUCH_RESET_BUTTON,
  TOUCH_PICKER,
  OPERATION_MODE_ROW,
  bottomAreaTop,
} from './settingsGeometry';
/**
 * **缩放后的几何**（矩形 + 网格度量 + 行位置）—— 实现收在 `./settingsScale`，
 * 这里转发，外部 import 路径不变。
 *
 * ⚠️ 转发的是**函数**（不是值）：缩放一变，同一份函数返回的矩形就跟着变
 * —— 于是"命中测试"与"绘制"永远读的是同一个当前值。
 */
export {
  closeButtonRect,
  detailContentRect,
  detailViewport,
  gridBottomFor,
  gridCapacityFor,
  gridMetricsFor,
  hintLineY,
  insidePanel,
  keyCellRect,
  modeButtonRect,
  modeLabelPos,
  resetButtonRect,
  sliderRect,
  tabRect,
  touchPickerArea,
  touchPreviewArcBox,
  touchPreviewCaptionPos,
  touchResetButtonRect,
} from './settingsScale';
export type { MetricsRect, ScaledGridMetrics, SettingsMetrics } from './settingsScale';
/** tab 行 / 关闭按钮的**底座常量**（`SettingsFrame` 从本文件取）。 */
export { TAB_BAR, CLOSE_BUTTON } from './settingsGeometry';
/**
 * ⚠️ 两个**老名字**：`operationModeRect` / `operationModeLabelPos` 是
 * 「通用」页操作方式选择器的几何，`ModeSwitch` 从本文件 import 它们。
 * 实现搬到了 `./settingsScale`（新名字是 `modeButtonRect` / `modeLabelPos`），
 * 这里转发老名字，调用点不用动。
 */
export {
  modeButtonRect as operationModeRect,
  modeLabelPos as operationModeLabelPos,
} from './settingsScale';
/**
 * 操作方式选择器的**顺序与文案**（`./operationModeRow`）—— 命中测试、
 * 绘制、面板三处都要那张表，转发一次省得各写一遍路径。
 */
export {
  OPERATION_MODE_ORDER,
  operationModeAt,
  operationModeLabelKey,
  operationModeStorageValue,
} from './operationModeRow';
export type { OperationMode } from '../../render/platform';
/**
 * ⚠️ **焦点模型搬到了 `./focus`**（这一轮加了"触屏键位"这个新的焦点区，
 * 几何/命中与焦点模型本来就不是一件事，按 AGENTS.md §3 的顺序先横向切割）。
 * 这里**转发**，外部 import 路径不变 —— 与 `keyNames` / `rebind` 同一做法。
 */
export type { ActivateAction, ActivateInput, Direction, FocusContext, SettingsFocus } from './focus';
export { INITIAL_FOCUS, cycleZone, moveFocus, resolveActivate } from './focus';
export { visibleTabs, preferredTab, tabAt, tabIsVisible, ALL_SETTINGS_TABS } from './tabs';
export type { SettingsOrigin, SettingsTab } from './tabs';
/**
 * ⚠️ **格阵几何**（`KEY_GRID_CAPACITY` / `keyGridMetrics` / `rowsCapacity`）
 * 的实现收在 `./settingsScale`（缩放后的行高**只有**那一处），
 * `./keyGridLayout` 转发老名字。这里 import 自己算命中要用的两个，
 * 并把外部要的转发出去。
 */
import { UI_SCALE_MAX, UI_SCALE_MIN, clampUiScale } from '../../render/scaling';

/* ------------------------------------------------------------------ *
 * 几何
 * ------------------------------------------------------------------ *
 * ⚠️ 这一块的**实现在 `./settingsScale`**（这一轮加了 UI 缩放：几何现在
 * 依赖"面板能用多大"，那是 `settingsScale` 的唯一关注点）。
 *
 * 本文件**转发**，外部 import 路径不变 —— 与 `keyNames` / `rebind` /
 * `focus` 同一做法。转发而不在这里实现，是因为命中测试（本文件）与绘制
 * （`KeyGrid` / `SkillDetail` / …）**必须**读同一份缩放后的几何；
 * 各算一份就是"看着能点、点不中"。
 */

/** 「通用」页 UI 缩放滑块的行（面板相对）—— 位置**不跟 k**（不在竖向预算里）。 */
export const UI_SCALE_SLIDER = {
  x: 16,
  /**
   * 距弹窗顶部的距离。
   *
   * ⚠️ 必须**大于 TAB_BAR 的底部**（40 + 30 = 70），否则会盖住 tab 栏。
   * 需求："ui 缩放控件现在盖住了 tabbar，需要往下挪"。
   * 取 96：距 tab 栏底 26px，是"另一组设置"该有的间距。
   */
  top: 96,
  w: 320,
  h: 24,
} as const;






/**
 * 一个矩形（画布逻辑坐标）—— 定义收在 `./settingsScale`，这里**既 import
 * 又 export**（本文件的 `contains` 要用它，而外部 import 路径不变）。
 * ⚠️ `export ... from` 不产生本地绑定，所以必须分两步写。
 */
import type { MetricsRect } from './settingsScale';
export type Rect = MetricsRect;

export function contains(rect: Rect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/* ------------------------------------------------------------------ *
 * 点击命中
 * ------------------------------------------------------------------ */

export type ClickTarget =
  | { readonly kind: 'outside' }
  | { readonly kind: 'tab'; readonly tab: SettingsTab }
  /**
   * **键盘块**那一个「恢复默认」（提示文字下面）。
   *
   * ⚠️ 恢复的是**键盘键位** —— 这件事实由"点在哪个块里"决定，**不由**
   * 任何设备判断决定（上一版正是按设备分流，于是触屏笔记本上键盘键位
   * 恢复不了）。触屏块那个见 `resetTouch`。
   */
  | { readonly kind: 'resetKeys' }
  /** **触屏块**那一个「恢复默认」（键位预览下面）—— 恢复触屏键位。 */
  | { readonly kind: 'resetTouch' }
  /** 「通用」页的操作方式按钮（`?touch=` 之外的用户入口）。 */
  | { readonly kind: 'operationMode'; readonly mode: OperationMode }
  | { readonly kind: 'keyRow'; readonly skillId: string }
  /**
   * 右下角**模拟键位**上的一个槽位（触屏两步交互的第一步）。
   *
   * ⚠️ 它与 `keyRow` 是**两个区**，与 `touchSkill` 也是两个区：
   * 触屏技能面（`touchSkill`）是触屏那套**自己的**技能选择面，
   * 不再借键盘格阵当它的技能表（那正是上一版把两套缝在一起的根源）。
   */
  | { readonly kind: 'slot'; readonly index: number }
  /**
   * **触屏技能面**上的一个技能（触屏两步交互的第二步）。
   *
   * ⚠️ 只有"已经选中了一个键位"（绑定状态）时它才有意义 —— 判定在
   * `panelDispatch`（`slotActions.resolveSlotBind`，与键盘那条路共用）。
   */
  | { readonly kind: 'touchSkill'; readonly skillId: string }
  /** 通用页的 UI 缩放滑块（支持鼠标点击/拖动） */
  | { readonly kind: 'scaleSlider' }
  /** 右上角的关闭 */
  | { readonly kind: 'close' }
  | { readonly kind: 'none' };

/**
 * 判断一次点击落在哪里。
 *
 * 顺序即优先级：先判断"点在弹窗外"，再 tab，再按钮，最后键位行。
 * 之所以把命中判定写成纯函数：它是最容易出错、也最值得测的一段
 * （坐标算错一个偏移，点击就会错位，而截图上看不出来）。
 */
export function hitTest(
  px: number,
  py: number,
  options: {
    readonly tab: SettingsTab;
    /**
     * **这个来源下可见的 tab**（首页只有「通用」）。
     *
     * ⚠️ 必须由调用方给：命中测试不能自己去算"哪几页可见"，
     * 那会造出第二份判据（`./tabs.visibleTabs` 才是唯一真相）。
     */
    readonly tabs: readonly SettingsTab[];
    readonly rowSkillIds: readonly string[];
    /**
     * **当前操作方式**（唯一 flag）——决定「按键」页判哪一块：
     * 键盘块（技能格 + 键盘默认）还是触屏块（键位预览 + 技能面 + 触屏默认）。
     *
     * ⚠️ 这是**唯一**的分流依据：不传 / 传坏值就会让两个块的命中区同时
     * 生效（点到看不见的东西）。
     */
    readonly mode: OperationMode;
    /**
     * **触屏技能面**当前滚到第几个技能（窗口偏移）。
     *
     * ⚠️ 必须由调用方给：窗口偏移是那一块自己的状态（`TouchSkillPicker`），
     * 命中测试不能自己推 —— 推一份就会出现"看着是这个技能、点下去绑了别的"
     * （滚动过的列表最容易出这种错）。
     */
    readonly pickerOffset?: number | undefined;
    /**
     * 是否显示键名 —— 它**决定网格度量**（桌面 4 列 44 高 / 触屏 3 列 64 高）。
     *
     * ⚠️ 必须传，否则命中测试与渲染**用的不是同一套格子**。
     * 踩过的坑（实测）：`hitTest` 默认走桌面度量，而 `KeyGrid` 在触屏下
     * 渲染的是 196×64 的格子 —— 于是点「闪」只有 **6.3%** 的位置能命中，
     * 「破」有 46.9% 会点到别的技能。桌面度量自洽（7 格全 100%），
     * 所以光靠"命中测试自身自洽"的测试抓不到它。
     */
    readonly showKeyHints?: boolean | undefined;
  },
): ClickTarget {
  if (!insidePanel(px, py)) return { kind: 'outside' };

  // 关闭按钮优先级最高（它在右上角，与别的区域不重叠，但语义上该先判）
  if (contains(closeButtonRect(), px, py)) return { kind: 'close' };

  for (const [i, tab] of options.tabs.entries()) {
    if (contains(tabRect(i), px, py)) return { kind: 'tab', tab };
  }

  if (options.tab === 'general') {
    /**
     * 通用页的两样：UI 缩放滑块（要支持鼠标，需求点名）与操作方式选择器。
     *
     * ⚠️ 顺序**无所谓**（两者不重叠），但都排在 tab 判断之后 ——
     * 与老的滑块判定同一条纪律。
     */
    if (contains(sliderRect(), px, py)) return { kind: 'scaleSlider' };
    for (const [index, mode] of OPERATION_MODE_ORDER.entries()) {
      if (contains(modeButtonRect(index), px, py)) return { kind: 'operationMode', mode };
    }
    return { kind: 'none' };
  }

  /* ---- 「按键」页：按操作方式判**其中一块**（两块不同时出现） ---- */
  if (options.mode === 'touch') {
    /**
     * 触屏块：预览（键位）→ 技能面（第二步）→ 它自己的恢复按钮。
     *
     * ⚠️ 恢复按钮**先于**键位与技能面判定：它在预览块的下方、不与圆重叠，
     * 但"按钮优先于内容区"是整页一致的顺序（键盘块那边也是）。
     */
    if (contains(touchResetButtonRect(), px, py)) return { kind: 'resetTouch' };
    /**
     * ⚠️ 键位（`slot`）**先于**技能面判定：它们在面板里是两块不重叠的区域，
     * 但判定顺序固定下来能保证"以后有人挪动它们"时不会变成"点键位 = 绑技能"。
     */
    const slot = previewSlotAt(px, py);
    if (slot !== undefined) return { kind: 'slot', index: slot };
    const cell = pickerCellAt(px, py, pickerMetrics(options.rowSkillIds.length));
    if (cell !== undefined) {
      const skillId = options.rowSkillIds[(options.pickerOffset ?? 0) + cell];
      if (skillId !== undefined) return { kind: 'touchSkill', skillId };
    }
    return { kind: 'none' };
  }

  /**
   * ⚠️ **键盘块**那一个「恢复默认」：恢复的是**键盘键位**（与设备无关）。
   * 触屏那块不显示，所以它的按钮也不在这里判 —— 两块是互斥的。
   */
  if (contains(resetButtonRect(), px, py)) return { kind: 'resetKeys' };
  /**
   * ⚠️ 用**当前模式**的度量与容量 —— 渲染那边（`KeyGrid`）就是这么算的，
   * 两处必须同源。
   */
  const metrics = gridMetricsFor(options.showKeyHints !== false);
  const capacity = gridCapacityFor(metrics);
  for (const [i, skillId] of options.rowSkillIds.entries()) {
    if (i >= capacity) break;
    if (contains(keyCellRect(i, metrics), px, py)) return { kind: 'keyRow', skillId };
  }

  return { kind: 'none' };
}

/* ------------------------------------------------------------------ *
 * 键盘：这一次按键意味着什么
 * ------------------------------------------------------------------ *
 * ⚠️ 焦点模型（含「触屏键位」那个新的焦点区）搬到了 `./focus` ——
 * 见那里的说明。这里只剩**单键解析**：这个键是移动、激活、还是忽略。
 * 焦点是"现在在谁身上"，与"这个键是什么"是两件事。
 */

/**
 * 弹窗打开时，某个按键该怎么处理。
 *
 * ------------------------------------------------------------------
 * 优先级
 * ------------------------------------------------------------------
 *
 * 1. **捕获中**：除了 Esc（唯一退路）之外，一切按键都是"玩家想绑这个键"。
 *    这一步必须在最前面 —— 否则玩家想把技能绑成 `arrowup` 就会被
 *    当成导航。
 * 2. **方向键 / Tab**：移动焦点。
 * 3. **Enter / 空格**：激活当前焦点。
 * 4. **Esc**：关闭弹窗。
 *
 * 需求是"几乎全键盘可操作，包括设置弹窗里的一切"，所以这里
 * 不能有"只能用鼠标"的死角 —— 改键、切 tab、恢复默认全部可达。
 */
export type KeyAction =
  | { readonly kind: 'cancelCapture' }
  | { readonly kind: 'closePanel' }
  | { readonly kind: 'capture'; readonly key: string }
  /**
   * 助记键：**直达**某个控件（需求："这几个按钮，都需要增加『通用(G)』
   * 这样的按键支持，而不是只能依赖 tab，包括 UI 缩放"）。
   *
   * 与 `cycle`（Tab 遍历）的分工：
   *   cycle     线性遍历 —— 保证"没有只能用鼠标的地方"
   *   mnemonic  一键直达 —— 熟练之后不必按六次
   * 两者并存，互不替代。
   */
  | {
      readonly kind: 'mnemonic';
      /**
       * ⚠️ **不含触屏**（`T` 已删）：触屏键位不再是一个独立的 tab，
       * 而是「按键」页右下角的一块 —— 它有自己的焦点区（`focus.slots`），
       * 从网格按下方向键就到，不需要助记键。
       */
      readonly target: 'tabGeneral' | 'tabKeys' | 'resetKeys' | 'slider';
    }
  | { readonly kind: 'move'; readonly direction: 'up' | 'down' | 'left' | 'right' }
  | { readonly kind: 'cycle'; readonly back: boolean }
  | { readonly kind: 'activate' }
  | { readonly kind: 'ignore' };

/** 方向键键名 → 方向。 */
const ARROWS: Readonly<Record<string, 'up' | 'down' | 'left' | 'right'>> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
};


export function resolveKeyAction(key: string, capturing: boolean): KeyAction {
  if (capturing) {
    // Esc 是唯一的退路，其余按键都当作"玩家想绑这个键"
    return key === 'escape' ? { kind: 'cancelCapture' } : { kind: 'capture', key };
  }

  /**
   * **助记键**（需求："这几个按钮，都需要增加『通用(G)』这样的按键支持，
   * 而不是只能依赖 tab，包括 UI 缩放"）。
   *
   * 与 `Tab` / 方向键的区别：`Tab` 是**线性遍历**（要按很多次才到目标），
   * 助记键是**直达**。两者并存 —— 遍历保证"没有只能用鼠标的地方"，
   * 助记保证"熟练之后不用按六次"。
   *
   * ⚠️ 它们只在**非捕获模式**下生效（捕获模式在上面就 return 了），
   * 所以改键时按 `g` 会把它绑给技能，而不是切 tab —— 这是对的：
   * 玩家那一刻的意图就是"我要绑 g"。
   */
  const mnemonic = MNEMONIC_KEYS[key];
  if (mnemonic !== undefined) return mnemonic;

  const arrow = ARROWS[key];
  if (arrow) return { kind: 'move', direction: arrow };
  if (key === 'tab') return { kind: 'cycle', back: false };
  if (key === 'shift+tab') return { kind: 'cycle', back: true };
  if (key === 'enter' || key === ' ') return { kind: 'activate' };
  if (key === 'escape') return { kind: 'closePanel' };
  return { kind: 'ignore' };
}

/**
 * 详情区（可滚的那块）在**画布坐标**里的矩形。
 *
 * ⚠️ 实现在 `./settingsScale.detailViewport()` —— 它的顶边是"格阵下沿"，
 * 而格阵行高**跟缩放走**，所以那一份几何是缩放模型的一部分。
 * 这里只保留**老名字**转发，外部 import 路径不变。
 */
export { detailViewport as skillDetailRect } from './settingsScale';

/**
 * 「通用」页 UI 缩放滑块的矩形 —— **老名字**（`ScaleSlider` / `panelInput`
 * 都从本文件 import 它）。实现是 `./settingsScale.sliderRect()`。
 */
export function uiScaleSliderRect(): Rect {
  return sliderRect();
}

/**
 * 鼠标点击滑块时，由**横坐标**反算出倍数。
 *
 * 轨道的可点区间与 `ScaleSlider` 里的一致（左右各让 4px、宽 `w-8`），
 * 所以点击位置与把手的视觉位置是对齐的 —— 点到哪里就跳到哪里。
 * 结果**钳到合法范围并对齐步长**（与键盘调值是同一套约束）。
 */
export function uiScaleFromPointer(px: number): number {
  const rect = sliderRect();
  const trackX = rect.x + 4;
  const trackW = rect.w - 8;
  const t = trackW <= 0 ? 0 : (px - trackX) / trackW;
  const clamped = Math.min(1, Math.max(0, t));
  return clampUiScale(UI_SCALE_MIN + clamped * (UI_SCALE_MAX - UI_SCALE_MIN));
}

/**
 * 网格几何（容量 / 度量 / 格子矩形）的实现收在 `./settingsScale`
 * （缩放后的行高**只有**那一处）。这里保留**老名字**转发，
 * 外部 import 不变 —— `./keyGridLayout` 是同一条转发。
 */
export { KEY_GRID_CAPACITY, keyGridMetrics, rowsCapacity } from './keyGridLayout';
export type { GridMetrics } from './keyGridLayout';
