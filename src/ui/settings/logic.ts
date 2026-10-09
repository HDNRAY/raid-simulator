/**
 * 设置界面的**纯逻辑**（不碰 Pixi）。
 *
 * ------------------------------------------------------------------
 * 为什么把判定逻辑抽出来
 * ------------------------------------------------------------------
 *
 * `SettingsPanel` 要构造 Pixi 对象，而 Pixi v8 在 jsdom 里不好跑
 * （需要真 canvas / WebGL）。如果判定逻辑留在类里，就只能写
 * "能构造、不报错"这种几乎没有信息的冒烟测试。
 *
 * 抽出来之后可以在 node 环境里精确测：
 *   - 点击命中了哪个区域
 *   - 改键是否冲突、冲突时该做什么
 *   - 键名怎么显示
 *   - 某个键该不该被弹窗消费掉
 *
 * 这个分工与 `DebugPanel` / `formatDebugValue` 一致：
 * **逻辑在 node 里测，绘制在浏览器里看**。
 */

import { LOGICAL } from '../layout';

/* ------------------------------------------------------------------ *
 * 几何
 * ------------------------------------------------------------------ */

export const SETTINGS_PANEL = {
  w: 640,
  /**
   * 高度按"能放下当前全部技能"定。
   *
   * 6 个技能 × 30px 行高 = 180px，加上 tab 栏、提示文字、
   * 恢复默认按钮与边距，360 是刚好留一点余量的值。
   * 若以后技能变多，`KEY_ROW_MAX` 会自动减少（而不是重叠），
   * 那时再考虑给表格加滚动。
   *
   * 演进 400 → **440**：格子从 44 加到 56（为了在技能名下放一行
   * 提示标签），400 高的面板只剩 3 行、容量掉到 9。440 能放 4 行、
   * 容量回到 12，与 `KEY_GRID_CAPACITY` 的下限一致。
   */
  h: 440,
  /** 居中 */
  get x(): number {
    return Math.round((LOGICAL.width - this.w) / 2);
  },
  get y(): number {
    return Math.round((LOGICAL.height - this.h) / 2);
  },
} as const;

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
export const KEY_GRID = {
  top: 88,
  cols: 3,
  cellW: 188,
  cellH: 56,
  gapX: 10,
  gapY: 8,
  inset: 16,
} as const;

/**
 * 底部两个元素的位置：**提示文字在上、按钮在下**，都由这两个常量定义。
 *
 * 踩过的坑：`RESET_BUTTON.bottom` 与 `KEY_GRID_CAPACITY` 里各写了一次
 * 底部偏移，算重了 —— 结果"恢复默认"按钮**压在提示文字上**。
 * 现在按钮的 top 只在这里定义一次，容量推导与绘制都读它。
 */
export const RESET_BUTTON = {
  w: 108,
  h: 24,
  x: 16,
  /** 距弹窗底部的距离 */
  bottom: 22,
} as const;

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

export const HINT_LINE = {
  height: 20,
  /** 与按钮之间的间隙 */
  gap: 8,
} as const;

/** 提示文字行的 y（相对弹窗顶部）。 */
export function hintLineY(): number {
  return SETTINGS_PANEL.h - RESET_BUTTON.bottom - RESET_BUTTON.h - HINT_LINE.gap - HINT_LINE.height;
}

/** 底部区域上沿：格子不能越过这条线。 */
export function bottomAreaTop(): number {
  return hintLineY();
}

/**
 * 一屏能显示多少个技能格 —— **由剩余空间推导，不是写死的**。
 *
 * 踩过的坑：早期写死行数，后来调整行高就直接压到了"恢复默认"
 * 按钮上 —— 那个位置点下去会命中按钮，玩家以为在改某个技能的键，
 * 实际按了恢复默认。现在从下往上留出按钮与提示文字的空间，
 * 剩下的高度才给格子用，调尺寸不会静默产生重叠。
 */
export const KEY_GRID_CAPACITY = (() => {
  const usable = bottomAreaTop() - KEY_GRID.top - 6;
  const rows = Math.max(
    1,
    Math.floor((usable + KEY_GRID.gapY) / (KEY_GRID.cellH + KEY_GRID.gapY)),
  );
  return rows * KEY_GRID.cols;
})();

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
export function keyCellRect(index: number): Rect {
  const col = index % KEY_GRID.cols;
  const row = Math.floor(index / KEY_GRID.cols);
  return {
    x: SETTINGS_PANEL.x + KEY_GRID.inset + col * (KEY_GRID.cellW + KEY_GRID.gapX),
    y: SETTINGS_PANEL.y + KEY_GRID.top + row * (KEY_GRID.cellH + KEY_GRID.gapY),
    w: KEY_GRID.cellW,
    h: KEY_GRID.cellH,
  };
}

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

export type SettingsTab = 'general' | 'keys';

export type ClickTarget =
  | { readonly kind: 'outside' }
  | { readonly kind: 'tab'; readonly tab: SettingsTab }
  | { readonly kind: 'resetKeys' }
  | { readonly kind: 'keyRow'; readonly skillId: string }
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
    readonly rowSkillIds: readonly string[];
  },
): ClickTarget {
  if (!insidePanel(px, py)) return { kind: 'outside' };

  const tabs: readonly SettingsTab[] = ['general', 'keys'];
  for (const [i, tab] of tabs.entries()) {
    if (contains(tabRect(i), px, py)) return { kind: 'tab', tab };
  }

  if (options.tab === 'keys') {
    if (contains(resetButtonRect(), px, py)) return { kind: 'resetKeys' };
    for (const [i, skillId] of options.rowSkillIds.entries()) {
      if (i >= KEY_GRID_CAPACITY) break;
      if (contains(keyCellRect(i), px, py)) return { kind: 'keyRow', skillId };
    }
  }

  return { kind: 'none' };
}

/* ------------------------------------------------------------------ *
 * 改键
 * ------------------------------------------------------------------ */

export interface RebindResult {
  readonly bindings: readonly { readonly key: string; readonly skillId: string }[];
  /** 改键失败的原因；成功时为 undefined */
  readonly error?: 'conflict';
  /** 被顶掉绑定的技能（成功时可能有） */
  readonly unbound?: string;
}

export const EMPTY_KEY = '';

/**
 * 把一个技能改绑到某个键。
 *
 * ------------------------------------------------------------------
 * 冲突策略：**顶掉旧占用者，而不是拒绝**
 * ------------------------------------------------------------------
 *
 * 两种做法都常见。选"顶掉"的理由：玩家改键的意图很明确
 * （"我要让闪避是这个键"），如果因为冲突被拒绝，他还得先去把
 * 旧技能改成别的键、再回来改这个 —— 两次操作做一件事。
 *
 * 但**同一个技能内部**的冲突要拒绝：那是"列表里出现两个相同按键"
 * 这种真错误（例如内容里写错了默认键位）。
 */
export function applyRebind(
  bindings: readonly { readonly key: string; readonly skillId: string }[],
  skillId: string,
  key: string,
): RebindResult {
  if (bindings.some((b) => b.skillId === skillId && b.key === key)) {
    // 已经是这个键了，无事发生
    return { bindings };
  }

  const previous = bindings.find((b) => b.skillId === skillId);
  const next = bindings.map((b) => {
    if (b.skillId === skillId) return { ...b, key };
    // 顶掉占用同一个键的其它技能
    if (b.key === key) return { ...b, key: EMPTY_KEY };
    return b;
  });

  const unbound = previous?.key;
  return unbound === undefined ? { bindings: next } : { bindings: next, unbound };
}

/* ------------------------------------------------------------------ *
 * 键名显示
 * ------------------------------------------------------------------ */

/**
 * 键名怎么显示。
 *
 * 单字符大写（`q` → `Q`，与技能栏上的提示一致）；
 * 组合键原样保留（`shift+1` 全大写会读成 `SHIFT+1`，太吵）。
 */
export function keyLabel(key: string, unboundText: string): string {
  if (key === EMPTY_KEY) return unboundText;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/* ------------------------------------------------------------------ *
 * 键盘导航
 * ------------------------------------------------------------------ */

/**
 * 键盘焦点位置。
 *
 * 用一个**线性游标**而不是"tab 索引 + 列 + 行"三件套：箭头键的处理
 * 只需要"往哪个方向找下一个"，而线性游标把这个逻辑收敛成一次
 * 索引运算，顺便让"Tab 也能切换"变得免费。
 */
export type SettingsFocus =
  | { readonly zone: 'tabs'; readonly index: number }
  | { readonly zone: 'grid'; readonly index: number }
  | { readonly zone: 'slider' }
  | { readonly zone: 'reset' };

/** 初始焦点：按键 tab 的第一个技能格（最常改的东西）。 */
export const INITIAL_FOCUS: SettingsFocus = { zone: 'grid', index: 0 };

export const TAB_COUNT = 2;

/**
 * 方向键移动后的新焦点。
 *
 * `cellCount` 是**当前可见**的技能格数量 —— 焦点不会跑到看不见的格子上。
 */
export function moveFocus(
  focus: SettingsFocus,
  direction: 'up' | 'down' | 'left' | 'right',
  cellCount: number,
  /**
   * 当前页有没有 UI 缩放 slider（只有「通用」页有）。
   *
   * 不把它写死是因为**焦点模型不该知道 tab 的语义** ——
   * 调用方说"这页有什么"，模型只负责在它们之间走。
   */
  hasSlider = false,
  /** 当前页有没有技能格（只有「按键」页有）。 */
  hasGrid = true,
): SettingsFocus {
  /** 通用页的纵向顺序：tabs → slider → reset */
  const downFromTabs: SettingsFocus = hasGrid
    ? { zone: 'grid', index: 0 }
    : hasSlider
      ? { zone: 'slider' }
      : { zone: 'reset' };

  if (focus.zone === 'tabs') {
    // tab 行是横向的一排
    if (direction === 'left') {
      return { zone: 'tabs', index: (focus.index + TAB_COUNT - 1) % TAB_COUNT };
    }
    if (direction === 'right') {
      return { zone: 'tabs', index: (focus.index + 1) % TAB_COUNT };
    }
    return downFromTabs;
  }

  if (focus.zone === 'slider') {
    // slider **不吃上下**：上下是"离开这一行"，左右留给调用方当调节键
    if (direction === 'down') return { zone: 'reset' };
    if (direction === 'up' || direction === 'left' || direction === 'right') {
      return { zone: 'tabs', index: 0 };
    }
    return focus;
  }

  if (focus.zone === 'reset') {
    if (direction === 'up' || direction === 'left') {
      if (hasGrid) {
        return cellCount > 0 ? { zone: 'grid', index: cellCount - 1 } : { zone: 'tabs', index: 0 };
      }
      return hasSlider ? { zone: 'slider' } : { zone: 'tabs', index: 0 };
    }
    return focus;
  }

  // 网格：左右在同一行内移动，上下按列移动；越界则换区
  const index = focus.index;
  const col = index % KEY_GRID.cols;
  const row = Math.floor(index / KEY_GRID.cols);
  const rows = Math.max(1, Math.ceil(cellCount / KEY_GRID.cols));

  const clampToCell = (i: number): SettingsFocus =>
    i >= 0 && i < cellCount ? { zone: 'grid', index: i } : focus;

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
        if (next < cellCount) return { zone: 'grid', index: next };
      }
      return { zone: 'reset' };
    }
  }
}

/** Tab / Shift+Tab 在较大区域之间切换（无障碍习惯用 Tab，所以也支持）。 */
export function cycleZone(
  focus: SettingsFocus,
  cellCount: number,
  back = false,
  hasSlider = false,
): SettingsFocus {
  /** Tab 顺序跟着"这一页实际有什么"走 —— 见 `moveFocus` 的同名参数说明 */
  const usable: SettingsFocus['zone'][] = ['tabs'];
  if (cellCount > 0) usable.push('grid');
  if (hasSlider) usable.push('slider');
  usable.push('reset');
  const current = usable.indexOf(focus.zone);
  const step = back ? -1 : 1;
  const next = usable[(current + step + usable.length) % usable.length]!;
  if (next === 'grid') {
    const index = focus.zone === 'grid' ? focus.index : 0;
    return { zone: 'grid', index: Math.min(index, Math.max(0, cellCount - 1)) };
  }
  if (next === 'slider') return { zone: 'slider' };
  if (next === 'tabs') return { zone: 'tabs', index: 0 };
  return { zone: 'reset' };
}

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

  const arrow = ARROWS[key];
  if (arrow) return { kind: 'move', direction: arrow };
  if (key === 'tab') return { kind: 'cycle', back: false };
  if (key === 'shift+tab') return { kind: 'cycle', back: true };
  if (key === 'enter' || key === ' ') return { kind: 'activate' };
  if (key === 'escape') return { kind: 'closePanel' };
  return { kind: 'ignore' };
}

/** 激活当前焦点时的动作。 */
export type ActivateAction =
  | { readonly kind: 'switchTab'; readonly tab: SettingsTab }
  | { readonly kind: 'startCapture'; readonly skillId: string }
  | { readonly kind: 'resetKeys' }
  | { readonly kind: 'none' };

export function resolveActivate(
  focus: SettingsFocus,
  rowSkillIds: readonly string[],
): ActivateAction {
  if (focus.zone === 'tabs') {
    return { kind: 'switchTab', tab: focus.index === 0 ? 'general' : 'keys' };
  }
  if (focus.zone === 'reset') return { kind: 'resetKeys' };
  // slider 没有"激活"动作 —— 它的变化由左右方向键直接完成
  // （见 SettingsPanel 里 `move` 分支对 slider 的专门处理）
  if (focus.zone === 'slider') return { kind: 'none' };
  const skillId = rowSkillIds[focus.index];
  return skillId === undefined ? { kind: 'none' } : { kind: 'startCapture', skillId };
}
