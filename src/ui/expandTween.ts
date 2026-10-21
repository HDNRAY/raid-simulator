/**
 * **可打断的展开 / 收起动画**（2026-10-21）。
 *
 * 用户原话：
 * > 选人 能不能做点效果，选中的展开（动画）成详情的样子，移开会收起。
 * > 展开和收起都有动画，然后如果 **快速 展开和收起，动画会被中断 并朝反状态运行**。
 *
 * ==================================================================
 * 为什么不是一个"从 0 到 1 的补间"
 * ==================================================================
 *
 * 最常见的写法是"开始播放：`elapsed / duration`"。它在**打断**下是错的：
 * 收起时若还按 `elapsed` 算，画面会**跳回 1** 再往下走（跳一下 ✗），
 * 或者从 0 重新长出来（根本没收 ✗）。
 *
 * 所以这里把动画存成"**一个值 + 一个目标**"，每帧按**恒速**朝目标走
 * （`stepExpand`）。目标随时可以改（`retarget`），**值不动** ⇒ 从**当前
 * 进度**朝反方向跑 ✓ —— 这正是用户要的"中断并朝反状态运行"。
 *
 * ⚠️ 恒速而不是缓动：打断后速度必须**连续**（缓动曲线在中间接上会突然
 * 变快/变慢，看起来像卡了一下）。视觉上的"缓"由调用方在**画的时候**
 * 对 progress 做一次 `easeOutCubic` ✓ —— 那是纯视觉的，不影响运动本身。
 */

/** 一次展开 / 收起的时长（毫秒）。 */
export const EXPAND_DURATION_MS = 220;

/** 动画状态：`progress` 0（收起）→ 1（展开）。 */
export interface ExpandState {
  readonly progress: number;
  /** 正往哪儿走：1 = 展开，0 = 收起。 */
  readonly target: 0 | 1;
}

/** 初始状态：收起，且已经停在目标上（没有动画在跑）。 */
export function initialExpand(): ExpandState {
  return { progress: 0, target: 0 };
}

/**
 * 改目标（不改变当前进度）。
 *
 * ⚠️ 这就是"打断"的全部实现：**值不动、只换方向**。所以
 * `0.4 →(retarget 0)` 之后第一帧是 `0.4 - step`，**不是**从 1 或 0 开始。
 */
export function retarget(state: ExpandState, target: 0 | 1): ExpandState {
  return state.target === target ? state : { progress: state.progress, target };
}

/** 推进一帧（恒速；到目标就停住）。`dtMs` 为负按 0 处理。 */
export function stepExpand(
  state: ExpandState,
  dtMs: number,
  durationMs: number = EXPAND_DURATION_MS,
): ExpandState {
  if (state.progress === state.target) return state;
  const duration = Math.max(1, durationMs);
  const delta = Math.max(0, dtMs) / duration;
  const next = state.progress + (state.target === 1 ? delta : -delta);
  const clamped = next <= 0 ? 0 : next >= 1 ? 1 : next;
  return { progress: clamped, target: state.target };
}

/** 动画还在跑吗（`true` ⇒ 调用方每帧都要重画）。 */
export function expandAnimating(state: ExpandState): boolean {
  return state.progress !== state.target;
}

/** 视觉缓动（`easeOutCubic`）：只在**画**的时候用，不参与运动本身。 */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/** 一个矩形（逻辑坐标）。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 两个矩形之间按 `t`（0..1）插值 —— 展开的"形状"就是它。 */
export function lerpRect(from: Rect, to: Rect, t: number): Rect {
  const k = Math.min(1, Math.max(0, t));
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    w: from.w + (to.w - from.w) * k,
    h: from.h + (to.h - from.h) * k,
  };
}
