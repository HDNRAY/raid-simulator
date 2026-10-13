/**
 * **输入归属的**唯一判据 —— "现在哪一层在接收键盘 / 指针"。
 *
 * ==================================================================
 * 为什么单独一个文件（这是本仓库第 N 次同一类 bug）
 * ==================================================================
 *
 * `phase` 的**显隐**早就收口到 `game.ts` 的 `applyPhase`（唯一写入点），
 * 但**输入归属**没收口 —— 每个模块各自拿 `phase` / `settingsOpen()` /
 * `finished` 拼判据。于是每加一个"某一层里的子模式"就漏一处：
 *
 *   - 复盘面板（`ui/LogReviewPanel`）是 **`battle` 相位里的子模式**
 *     （一局结束仍然停在 `phase === 'battle'`，见 `phaseLogic.Phase`：
 *     刻意不新增 `'result'`）。而 `settingsKeys` 的
 *     `acceptsKeyboardFocus` 原先只看 `state.phase === 'battle'` ——
 *     于是复盘开着时它**先把 `↑` 吃掉**去点亮设置按钮，复盘**收不到**
 *     上下键。用户原话："对局结束看日志时，键盘上下键无效，会选中设置按钮"。
 *   - 同一类还有指针：`canvasInput` 判"结算中点屏幕 = 离开战斗"时
 *     同样只看 `phase === 'battle'`，于是**触屏点复盘面板也会离开战斗**
 *     （复盘抢不到那次手势）。
 *
 * ==================================================================
 * 与 `phaseLogic.ts` 的分工
 * ==================================================================
 *
 * 那边是"**这个相位**下 `Esc` / 返回箭头意味着什么"；这边是
 * "**这个时刻**这一下输入归谁"。后者比 `phase` 多两件事：
 * **设置面板开着没有**、**复盘开着没有** —— 也就是"子模式"。
 * 分开一个文件是为了让这份清单能独立被读懂与单测（AGENTS.md §3
 * "一个文件一句话说清它是什么"）。
 *
 * ⚠️ **纯函数，不碰 DOM / Pixi / i18n** —— 所以能在 node 里直接测。
 * ⚠️ 所有"这个键归谁 / 这个点击归谁"的地方都必须问这里，不许各自
 * 再拼一遍判据（那正是这次的根因）。
 */

import type { Phase } from './phaseLogic';

/**
 * 当前**在接收输入的那一层**。
 *
 * ⚠️ 它不是 `Phase` 的别名：`battle` 相位里还住着两个子模式
 * （`settings` / `review`），所以输入层比相位**多两档**。
 */
export type InputLayer = Phase | 'settings' | 'review';

/**
 * 判据要读的全部状态。
 *
 * ⚠️ 刻意**不含** `Phase` 以外的界面细节：这里只回答"谁在接收输入"，
 * 不回答"谁能看到什么"（那是 `applyPhase` 的事）。
 */
export interface InputLayerSnapshot {
  /** 当前相位（`phaseLogic.Phase`）。 */
  readonly phase: Phase;
  /** 设置面板是否打开（它是**独占键盘 / 指针**的弹窗）。 */
  readonly settingsOpen: boolean;
  /** 复盘面板是否开着（一局结束后的全屏战报）。 */
  readonly reviewOpen: boolean;
}

/**
 * **谁在接收输入** —— 一个地方回答。
 *
 * 优先级（自上而下，先命中的赢）：
 *
 * | 序 | 层 | 条件 | 为什么在这个位置 |
 * |---|---|---|---|
 * | 1 | `settings` | 面板打开 | 它是**模态弹窗**，盖在一切之上（连齿轮都藏了） |
 * | 2 | `review` | 复盘开着 | 复盘**也是全屏模态**，且它是 `battle` 里的子模式 —— 必须早于 `phase` 判 |
 * | 3 | `battle` / `home` / `characterSelect` / `prepare` | 落到当前相位 | 上面两层都不在时的正常路由 |
 *
 * ⚠️ **`review` 必须排在 `battle` 之前**：这就是本次 bug 的全部 ——
 * 复盘开着时 `phase` 仍是 `battle`，谁先看 `phase` 谁就把 `↑↓` 判给了战斗层。
 *
 * ⚠️ 新加"子模式"时**只需要改这一张表**，而不是去 `settingsKeys` /
 * `canvasInput` / `loopWiring` 各补一次判据 —— 那三处各补一次，
 * 漏一处的样子就是这次的"某个键被别的层吃掉"。
 */
export function activeInputLayer(s: InputLayerSnapshot): InputLayer {
  if (s.settingsOpen) return 'settings';
  if (s.reviewOpen) return 'review';
  return s.phase;
}

/**
 * 指针在画布上的位置（**逻辑坐标**，960×540）。
 *
 * ⚠️ 取逻辑坐标而不是 `clientX/clientY`：画布会被 letterbox 缩放，
 * 而 `canvasInput.ts` 已经是"CSS → 逻辑"的唯一换算点。把两个坐标系
 * 混用正是"命中判定与画出来的位置对不上"的来源。
 */
export interface LogicalPoint {
  readonly x: number;
  readonly y: number;
}

/** 一个矩形（逻辑坐标）。 */
export interface LogicalRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 这个点是否落在矩形内（含边界）。 */
export function pointInRect(p: LogicalPoint, r: LogicalRect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * 复盘**能不能滚** —— 内容多于一屏才算。
 *
 * ⚠️ 为什么它是"指针归属"的输入：内容装得下一屏时，**一次点按永远
 * 不会改变画面**（滚无可滚）。那时让复盘吃掉点击，就只是**吞掉**玩家
 * "点屏幕离开战斗 / 回结算"那一下 —— 触屏玩家于是**出不去复盘**
 * （AGENTS.md §3b"触屏与键盘功能必须对等"）。
 *
 * 键盘不受它影响：`↑↓` 在滚不动时只是**无害的空操作**，而复盘开着时
 * 它必须归复盘（否则就是用户在报的那个 bug）。
 */
export function reviewScrollable(total: number, rows: number): boolean {
  return total > rows;
}

/**
 * **这一下点击该不该由复盘面板吃掉**（点它 = 开始拖拽滚动）。
 *
 * 三个条件都要满足：
 *   1. 输入层是 `review`（设置面板开着时**不算** —— 它盖在上面）
 *   2. 点在复盘**可滚的那块**里（列表区；表头 / 页脚不在内 ——
 *      面板几乎占满屏幕，按整块算的话"面板外"只剩十几像素，手指点不到）
 *   3. 复盘**真的滚得动**（`canScroll`）—— 见 `reviewScrollable`
 *
 * ⚠️ 2 与 3 都是**触屏对等**的要求：键盘有 `Enter` / `Esc`，触屏只有
 * 点屏幕这一条路（`canvasInput` 的 `battleExitOnPointer`）。
 * 落在面板外 / 面板的头尾 / 滚不动时，那一下**故意不吃** —— 留给
 * "点屏幕离开战斗"，与结算面板的"点击屏幕再来一次"是同一条。
 */
export function reviewConsumesPointer(
  layer: InputLayer,
  p: LogicalPoint,
  bounds: LogicalRect,
  canScroll: boolean,
): boolean {
  return layer === 'review' && canScroll && pointInRect(p, bounds);
}

/**
 * 棋盘面（逻辑坐标）→ 第几行（可含小数）。
 *
 * 复盘拖拽滚动用：指针落在哪一行**由几何反推**，而不是让调用方抄一份
 * 行高。抄的那份会在布局调整后静默指到别处 —— 与"调试脚本别抄坐标"
 * 是同一条纪律。
 *
 * @param logicalY 逻辑 Y（画布 960×540，见 `render/scaling.ts`）
 * @param rowsTop 列表第一行的顶边（逻辑 Y）
 * @param rowH 行高（逻辑像素）
 */
export function reviewRowsAt(
  logicalY: number,
  rowsTop: number,
  rowH: number,
): number {
  return (logicalY - rowsTop) / rowH;
}

/**
 * 指针要转发给复盘面板的**四个动作** —— 也就是"复盘层拥有指针"时的全部契约。
 *
 * ⚠️ 只收**行**（不是 `clientX/clientY`）：坐标换算只该有一处
 * （`canvasInput` 已经做了 CSS → 逻辑），面板再自己摸一遍 `getBoundingClientRect`
 * 就会造出第二份几何真相 —— 两份在 letterbox 缩放下必然对不上。
 *
 * ⚠️ 刻意**不含** `scrollRows` / `pointerRatio`：那两个是"调试 / 验证"要读的，
 * 不是路由要调的。契约越小，"谁在消费指针"越清楚。
 */
export interface CanvasInputReviewSource {
  /** 复盘此刻是否在接收输入（= 画着且没被 `Space` 藏起来）。 */
  isOpen(): boolean;
  /**
   * 复盘**此刻滚不滚得动**（条目多于一屏）。
   *
   * ⚠️ 它是"点按该不该被吃掉"的第三个条件，见 `reviewConsumesPointer`：
   * 滚不动时那一下要留给"点屏幕离开战斗"，否则触屏玩家出不去复盘。
   */
  canScroll(): boolean;
  /** 复盘**可滚**的那块矩形（逻辑坐标；指针命中判定用）。 */
  bounds(): LogicalRect;
  /** 按下：在一次手势里开始滚动。 */
  pointerDown(pointerId: number, rows: number): void;
  /** 拖动：把这一行的位移折成滚动（零头由面板自己留着）。 */
  pointerMove(pointerId: number, rows: number): void;
  /** 松开 / 取消：结束滚动。 */
  pointerUp(pointerId: number): void;
}

/**
 * 一次**手势**的纵向位移算不算"拖动"（而不是"点了一下"）。
 *
 * ==================================================================
 * 为什么它是"指针归属"的一部分（2026-10-13）
 * ==================================================================
 *
 * 备战屏的卡片视口**能滚**时，按下那一下**不能**立刻判"点了哪张卡" ——
 * 那就变成了"想滚动却顺手改了炁机层数"。所以路由先把手势**占住**，等
 * **松手**再决定。而"决定"需要一条判据：位移超过 `slop` 是拖，否则是点。
 *
 * ⚠️ 旧代码只有"占住"，没有"松手再决定"：可滚区里**点一下完全没反应**
 * （`hitTest` 一次都不调）。今天三块都排得下（3 / 8 / 7 张）所以碰不到，
 * 一旦炁机或 Boss 涨到要滚，整块卡片区立刻点不动 —— 症状就是用户报的
 * 那个"点了没用"。
 *
 * ⚠️ **偏向"算点击"**（`slop` 取几个逻辑像素）：把按下的抖动误判成拖动，
 * 代价是"点了没反应"（这次要修的那个 bug）；反过来把极小的位移误判成
 * 点击，代价只是"少滚了一点点 / 顺带选了一张卡"。浏览器 / 系统的手势
 * 识别是同一条取舍。
 */
export function dragExceedsTapSlop(fromY: number, toY: number, slop: number): boolean {
  return Math.abs(toY - fromY) > slop;
}

/**
 * 这一下点击是否 = **"点屏幕离开战斗"**（一局已结束）。
 *
 * ⚠️ **不是** `phase === 'battle'`，也**不是** `layer === 'battle'`：
 *
 *   - 判 `phase === 'battle'`（原先那样）→ 复盘开着时那一下会**先**把玩家
 *     带离战斗，触屏的拖拽滚动永远开始不了
 *   - 判 `layer === 'battle'`（第一版修法）→ 复盘开着时那一下**永远不退出**，
 *     而复盘几乎占满屏幕、滚不动的局又很多 → **触屏玩家出不去复盘**
 *
 * 正确的读法是"**在战斗里，且这一下没有被复盘吃掉**"：
 *
 * | 输入层 | 复盘吃掉了吗 | 这一下 |
 * |---|---|---|
 * | `battle` | 否 | **离开战斗** |
 * | `review` | 否（滚不动 / 点在列表区外） | **离开战斗** |
 * | `review` | 是 | 滚日志（拖拽） |
 * | `settings` / 三个整屏界面 | — | 与战斗无关 |
 *
 * ⚠️ `reviewConsumed` 由调用方传"这一下到底有没有交给复盘"
 * （`reviewConsumesPointer` 的结果）—— 这里不自己再算一遍，
 * 否则就是"同一件事两份判据"。
 */
export function battleExitOnPointer(layer: InputLayer, reviewConsumed: boolean): boolean {
  return (layer === 'battle' || layer === 'review') && !reviewConsumed;
}
