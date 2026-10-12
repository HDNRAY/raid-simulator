/**
 * **首页的纯逻辑**：两个入口 + 光标 + 命中区域。
 *
 * ==================================================================
 * 首页是什么（用户 2026-10-12 定的流程）
 * ==================================================================
 *
 * 用户原话："有一个**新的首页**，首页可以**选进入肉鸽模式，或者自由**，
 * 自由就回到我们现在的备战……然后进入肉鸽 才是**选角色**。"
 *
 * ```
 * 首页（默认入口）
 *   ├─ 「肉鸽模式」 → 选角色屏 → 一局肉鸽
 *   └─ 「自由模式」 → 备战界面（`PrepareScreen`）
 * ```
 *
 * ⚠️ **首页只是路由**：它不碰引擎、不碰 `RunState`，只回答"用户点了哪条路"。
 * 所以它现在是**安全的默认入口** —— 而"选角色屏直接当正门"不安全
 * （肉鸽那条路还不完整：炁机选择是 P3、强度曲线是 P4/P5）。
 *
 * ==================================================================
 * 为什么把这一小段抽出来（而不是留在 `HomeScreen` 里）
 * ==================================================================
 *
 * 与 `prepareLogic` 同一条理由（见那个文件头）：`HomeScreen` 要构造 Pixi
 * 对象，而 Pixi v8 在 jsdom 里不好跑。逻辑留在类里就只能写"能构造、
 * 不报错"的冒烟测试；抽出来之后可以在 node 里精确测：
 *   - 上下移动光标、到两端**停住**（不环绕；Tab 才环绕）
 *   - 命中测试落在哪一个按钮上（**渲染与测试共用同一份几何**）
 *
 * ⚠️ 命中区域也在这里算：两处各算一遍必然在改布局时错位，而错位的表现
 * 是"点击位置和看到的按钮对不上" —— 这与 `prepareLogic` 写下的教训同源。
 *
 * ==================================================================
 * ⚠️ 首页**没有**"光标 ≠ 选择"这一步
 * ==================================================================
 *
 * 备战 / 选角色是"从若干个选项里挑一个"（所以需要"方向键只动光标、
 * Enter 才确定"）。首页的两个按钮是**动作**（进入哪条路），不是选项：
 * 光标停在哪一个、按 Enter 就执行它。所以这里只有一个 `cursor`，
 * **没有** `selection` 字段 —— 多一个字段就会多一个可能与 `cursor`
 * 打架的真相源，而且它永远没有第二种取值。
 */

/** 首页的两个入口。 */
export type HomeAction = 'roguelike' | 'free';

/**
 * 按钮顺序（= 屏幕上的上下顺序 = 光标的移动顺序）。
 *
 * ⚠️ 顺序有意义：第一项就是**默认光标**所在（`createHomeState`），
 * 而肉鸽模式是主推的那条路 —— 用户描述的流程里它排在前面。
 */
export const HOME_ACTIONS: readonly HomeAction[] = ['roguelike', 'free'];

/** 首页布局（逻辑坐标系 960×540；数字与 `prepareLogic` 的布局表同源）。 */
export interface HomeLayout {
  readonly width: number;
  readonly height: number;
  /** 标题基线。 */
  readonly titleY: number;
  /** 第一个按钮的上边缘。 */
  readonly firstButtonY: number;
  readonly buttonW: number;
  readonly buttonH: number;
  /** 两个按钮之间的间距。 */
  readonly buttonGap: number;
  /** 操作提示的基线。 */
  readonly hintY: number;
  /** 页脚声明（第三方素材）的基线。 */
  readonly noticeY: number;
}

/**
 * 默认布局。
 *
 * ⚠️ 各值不是随手写的：`960×540` 是逻辑分辨率（`render/scaling.ts`），
 * 按钮宽度 320 是"够放两个 5 字以内的中文标签、又不至于像一条通栏"；
 * 页脚贴底（`height - 18`）与备战界面**同一处**，两个界面看起来是一套东西。
 */
export const HOME_LAYOUT: HomeLayout = {
  width: 960,
  height: 540,
  titleY: 138,
  firstButtonY: 248,
  buttonW: 320,
  buttonH: 56,
  buttonGap: 20,
  hintY: 436,
  noticeY: 522,
};

/** 一块可点区域（渲染与命中测试共用）。 */
export interface HomeHitArea {
  readonly action: HomeAction;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 当前布局下的可点区域（顺序与 `HOME_ACTIONS` 一致）。 */
export function homeHitAreas(L: HomeLayout = HOME_LAYOUT): readonly HomeHitArea[] {
  return HOME_ACTIONS.map((action, index) => ({
    action,
    x: Math.round((L.width - L.buttonW) / 2),
    y: L.firstButtonY + index * (L.buttonH + L.buttonGap),
    w: L.buttonW,
    h: L.buttonH,
  }));
}

/* ------------------------------------------------------------------ *
 * 光标
 * ------------------------------------------------------------------ */

/** 首页的界面状态：光标停在第几个按钮上。 */
export interface HomeState {
  /** `HOME_ACTIONS` 的下标。 */
  readonly cursor: number;
}

/** 初始状态：光标在**第一个**按钮（肉鸽模式）上。 */
export function createHomeState(): HomeState {
  return { cursor: 0 };
}

/**
 * 上下移动光标。
 *
 * `wrap` 为假（方向键）：两端**停住** —— 与备战界面一致，避免"按了没反应"
 * 被当成按键失效（`cycleCursor` 里记着这条教训）。
 * `wrap` 为真（Tab / Shift+Tab）：**环绕**（Tab 的通用语义）。
 *
 * `delta` 只取符号：一步一格，不做"一次跳两格"（首页只有两项，
 * 多跳没有意义，而且会让"按一下到底"这种边界行为变得难解释）。
 */
export function moveHomeCursor(state: HomeState, delta: number, wrap = false): HomeState {
  const count = HOME_ACTIONS.length;
  const step = delta >= 0 ? 1 : -1;
  const next = state.cursor + step;
  if (next >= 0 && next < count) return { cursor: next };
  if (!wrap) return state;
  return { cursor: (next + count) % count };
}

/** 光标停在哪一个入口上（下标越界时回落到第一项，不返回 `undefined`）。 */
export function homeActionAt(state: HomeState): HomeAction {
  const action = HOME_ACTIONS[state.cursor];
  return action ?? 'roguelike';
}

/**
 * 命中测试：逻辑坐标落在哪一个按钮上。
 *
 * 与渲染共用 `homeHitAreas`，所以"看到的位置"与"点得到的位置"不可能漂。
 */
export function homeActionAtPoint(
  px: number,
  py: number,
  L: HomeLayout = HOME_LAYOUT,
): HomeAction | undefined {
  for (const area of homeHitAreas(L)) {
    if (px < area.x || px > area.x + area.w) continue;
    if (py < area.y || py > area.y + area.h) continue;
    return area.action;
  }
  return undefined;
}
