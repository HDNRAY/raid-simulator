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
import {
  SETTINGS_PANEL,
  RESET_BUTTON,
  SKILL_DETAIL,
  touchResetButtonRect,
} from './settingsGeometry';
import { MNEMONIC_KEYS } from './keyNames';
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
  TOUCH_PREVIEW,
  hintLineY,
  bottomAreaTop,
} from './settingsGeometry';
/**
 * ⚠️ **焦点模型搬到了 `./focus`**（这一轮加了"触屏键位"这个新的焦点区，
 * 几何/命中与焦点模型本来就不是一件事，按 AGENTS.md §3 的顺序先横向切割）。
 * 这里**转发**，外部 import 路径不变 —— 与 `keyNames` / `rebind` 同一做法。
 */
export type { ActivateAction, ActivateInput, Direction, FocusContext, SettingsFocus } from './focus';
export { INITIAL_FOCUS, cycleZone, moveFocus, resolveActivate } from './focus';
export { visibleTabs, preferredTab, tabAt, tabIsVisible, ALL_SETTINGS_TABS } from './tabs';
export type { SettingsOrigin, SettingsTab } from './tabs';
export { touchResetButtonRect } from './settingsGeometry';
/**
 * ⚠️ 既 import 又 export：本文件内部要用它们（`keyGridStateOf`
 * 之类），而外部 import 路径不变。`export ... from` 不产生本地绑定。
 */
import {
  KEY_GRID_CAPACITY,
  keyCellRect,
  keyGridMetrics,
  rowsCapacity,
  type GridMetrics,
} from './keyGridLayout';
import { UI_SCALE_MAX, UI_SCALE_MIN, clampUiScale } from '../../render/scaling';

/* ------------------------------------------------------------------ *
 * 几何
 * ------------------------------------------------------------------ */


export const TAB_BAR = { y: 40, w: 88, h: 30, gap: 8, x: 16 } as const;
/**
 * 键位行的几何。
 *
 * `h: 30` 而不是 26：技能名是**中文单字**，而中文字形比拉丁字母高
 * （没有 x-height 那种短字框）。26px 行高配 15px 字体时，
 * 字的上下会被行的边界压住 —— 实测 `getBounds()` 只报 16px 高，
 * 但实际字形更高，所以看起来"被裁切"。
 *
 * 留出 30px 之后有足够余量，同时每行的 `textY` 再往下偏 2px，
 * 让视觉重心落在行的中间而不是贴着上沿。
 */
/**
 * 键位行的几何。
 *
 * `h: 30` 而不是 26：技能名是**中文单字**，字形比拉丁字母高。
 * `textY: 6` 让文字在行内垂直居中（行高 30、字高约 16，余量上下各 7）。
 */
/**
 * 技能键位用 **grid** 排布。
 *
 * ------------------------------------------------------------------
 * 为什么从"一列清单"改成 grid
 * ------------------------------------------------------------------
 *
 * 早期是每行一个技能的单列清单。但技能会越来越多 ——
 * 单列的话 15 个技能就需要 15×30 = 450px 高度，弹窗会高得离谱。
 * grid 每行放 3 个，同样 15 个技能只要 5 行。
 *
 * 每个格子 = 技能字 + 它当前的按键，上下排布。
 */


/** 提示文字那一行的顶部（在按钮上方）。 */
/**
 * 「通用」页上的 UI 缩放 slider。
 *
 * ⚠️ 它**只在通用页**出现，而 tab 行/恢复按钮两页都有 ——
 * 所以焦点模型要能表达"这一页有没有 slider"（`hasSlider`）。
 */
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

/** slider 在弹窗坐标系里的矩形。 */
export function uiScaleSliderRect(): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
} {
  return {
    x: SETTINGS_PANEL.x + UI_SCALE_SLIDER.x,
    y: SETTINGS_PANEL.y + UI_SCALE_SLIDER.top,
    w: UI_SCALE_SLIDER.w,
    h: UI_SCALE_SLIDER.h,
  };
}






export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function tabRect(index: number): Rect {
  return {
    x: SETTINGS_PANEL.x + TAB_BAR.x + index * (TAB_BAR.w + TAB_BAR.gap),
    y: SETTINGS_PANEL.y + TAB_BAR.y,
    w: TAB_BAR.w,
    h: TAB_BAR.h,
  };
}

/**
 * 第 `index` 个技能格的矩形（按 grid 排布）。
 *
 * 先算"第几行第几列"，再换算坐标 —— 这样调用方只需要一个下标，
 * 不必知道列数。
 */


export function resetButtonRect(): Rect {
  return {
    x: SETTINGS_PANEL.x + RESET_BUTTON.x,
    y: SETTINGS_PANEL.y + SETTINGS_PANEL.h - RESET_BUTTON.bottom - RESET_BUTTON.h,
    w: RESET_BUTTON.w,
    h: RESET_BUTTON.h,
  };
}

export function contains(rect: Rect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/** 点是否落在弹窗内（用于"点外部关闭"）。 */
export function insidePanel(px: number, py: number): boolean {
  return (
    px >= SETTINGS_PANEL.x &&
    px <= SETTINGS_PANEL.x + SETTINGS_PANEL.w &&
    py >= SETTINGS_PANEL.y &&
    py <= SETTINGS_PANEL.y + SETTINGS_PANEL.h
  );
}

/* ------------------------------------------------------------------ *
 * 点击命中
 * ------------------------------------------------------------------ */

export type ClickTarget =
  | { readonly kind: 'outside' }
  | { readonly kind: 'tab'; readonly tab: SettingsTab }
  | { readonly kind: 'resetKeys' }
  /** 「触屏默认」按钮（恢复触屏键位表）。 */
  | { readonly kind: 'resetTouch' }
  | { readonly kind: 'keyRow'; readonly skillId: string }
  /**
   * 右下角**模拟键位**上的一个槽位（两步交互的第一步）。
   *
   * ⚠️ 它与 `keyRow` 是**两个区**：`keyRow` 是技能表，`slot` 是键位表。
   * 先点 `slot` 再点 `keyRow` = 绑定（判定在 `slotActions.resolveSlotBind`）。
   */
  | { readonly kind: 'slot'; readonly index: number }
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
     * 是否显示键名 —— 它**决定网格度量**（桌面 3 列 44 高 / 触屏 3 列 64 高）。
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

  /**
   * 通用页的滑块**要支持鼠标**（需求："ui 缩放的 slider 还是要支持鼠标"）。
   * 命中测试放在 tab 判断之后、按键页分支之前 —— 它只属于通用页。
   */
  if (options.tab === 'general' && contains(uiScaleSliderRect(), px, py)) {
    return { kind: 'scaleSlider' };
  }

  if (options.tab !== 'general') {
    if (contains(resetButtonRect(), px, py)) return { kind: 'resetKeys' };
    if (contains(touchResetButtonRect(), px, py)) return { kind: 'resetTouch' };
    /**
     * ⚠️ **模拟键位**先于技能格判定：它在格阵之外（右下角），但判定顺序
     * 放在这里能保证"以后有人把它挪到格子上"时**不会**变成"点键位改键"。
     */
    const slot = previewSlotAt(px, py);
    if (slot !== undefined) return { kind: 'slot', index: slot };
    /**
     * ⚠️ 用**当前模式**的度量与容量 —— 渲染那边（`KeyGrid`）就是这么算的，
     * 两处必须同源。用桌面常量 `KEY_GRID_CAPACITY` 会让触屏的第 3 行
     * 整个不可点。
     *
     * ⚠️ 判据是"**不是通用页**"而不是"是按键页"：技能格现在两页都有
     * （「按键」= 键盘键位，「触屏」= 按钮集合），逐页列举必然漏一个新页。
     */
    const metrics = keyGridMetrics(options.showKeyHints !== false);
    const capacity = rowsCapacity(metrics);
    for (const [i, skillId] of options.rowSkillIds.entries()) {
      if (i >= capacity) break;
      if (contains(keyCellRect(i, metrics), px, py)) return { kind: 'keyRow', skillId };
    }
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
 * 右上角的**关闭按钮**。
 *
 * ⚠️ 原先「关闭」只是一个 `Label`，**完全没有命中测试** ——
 * 点它什么也不会发生（需求："设置弹窗里的『关闭』点了没反应"）。
 * 点面板外的空白能关，但那不是玩家会去点的地方。
 *
 * 给一个比文字略大的点击区（文字约 24×16），让它好点中。
 */
export const CLOSE_BUTTON = { right: 12, top: 7, w: 40, h: 22 } as const;

export function closeButtonRect(): Rect {
  return {
    x: SETTINGS_PANEL.x + SETTINGS_PANEL.w - CLOSE_BUTTON.right - CLOSE_BUTTON.w,
    y: SETTINGS_PANEL.y + CLOSE_BUTTON.top,
    w: CLOSE_BUTTON.w,
    h: CLOSE_BUTTON.h,
  };
}


/** 详情区在弹窗坐标系里的矩形。 */
export function skillDetailRect(): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
} {
  return {
    x: SETTINGS_PANEL.x + SKILL_DETAIL.x,
    y: SETTINGS_PANEL.y + SKILL_DETAIL.top,
    w: SKILL_DETAIL.w,
    h: SKILL_DETAIL.h,
  };
}

/**
 * 鼠标点击滑块时，由**横坐标**反算出倍数。
 *
 * 轨道的可点区间与 `ScaleSlider` 里的一致（左右各让 4px、宽 `w-8`），
 * 所以点击位置与把手的视觉位置是对齐的 —— 点到哪里就跳到哪里。
 * 结果**钳到合法范围并对齐步长**（与键盘调值是同一套约束）。
 */
export function uiScaleFromPointer(px: number): number {
  const rect = uiScaleSliderRect();
  const trackX = rect.x + 4;
  const trackW = rect.w - 8;
  const t = trackW <= 0 ? 0 : (px - trackX) / trackW;
  const clamped = Math.min(1, Math.max(0, t));
  return clampUiScale(UI_SCALE_MIN + clamped * (UI_SCALE_MAX - UI_SCALE_MIN));
}

/**
 * 网格几何搬到了 `./keyGridLayout`（几何与交互解析是两件事，而
 * `logic.ts` 顶到了 700 行上限）。这里**转发**，外部 import 不变。
 */
export { KEY_GRID_CAPACITY, keyCellRect, keyGridMetrics, rowsCapacity };
export type { GridMetrics };
