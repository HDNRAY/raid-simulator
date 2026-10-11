/**
 * **帧选择**：把"读条进度"（idle 则是引擎 tick）映射成"该画第几帧"。
 *
 * ==================================================================
 * 核心规则（玩家拍板）
 * ==================================================================
 *
 * 原话："**读条时间 = 播放时长，无论原来动作多少帧，都在读条时间内播完。
 * 这样美术就没有影响之前的交互。**"
 *
 * 所以动画**不是**独立时钟，而是**读条的视觉表现**：
 *
 *   - 从 `castStart` 开始播（不是"命中时"）
 *   - **播放总时长 = 该次施放的 `castTime`**，多少帧都塞得进去
 *   - 伤害仍在**读条结束**结算 —— 机制侧一行都不用改
 *   - 玩家与 Boss 同一套规则
 *
 * 于是本文件是**纯函数**：给 (帧权重, 进度) 就出帧号。渲染层只负责把
 * 那一帧的纹理塞进 Sprite —— 没有计时器、没有 setInterval、没有累加器
 * （渲染层必须是快照的纯函数，见架构规范 C3）。
 *
 * ==================================================================
 * 帧的分配按 `delays` **加权**，不等分
 * ==================================================================
 *
 * 原版给每帧单独设了停留时间（`manifest.json` 的 `delays`）。等比缩放到
 * 读条时长时按权重分配，**"哪一帧该停久"的相对节奏就保住了** ——
 * 例如「暴食」的攻击帧最后一张 delay 是 8（其余 2），缩放后它仍然
 * 停得最久，那是打击感所在；等分会把它抹平。
 *
 * 旁证（这条规则顺带白送的观感）：「傲慢」攻击 16 帧、delay 全 2，
 * Σdelay = 32 → 原版 1600ms。它的三把刀读条是 1000 / 1500 / 2000ms，
 * 缩放比 0.63× / 0.94× / 1.25× —— **慢刀动画播得慢、快刀播得快**，
 * 等于给"快慢刀"多加了一层可读性。这是有意保留的效果。
 */

/** 一段动画的每帧权重（`manifest.json` 的 `delays`，原样收着）。 */
export type FrameWeights = readonly number[];

/**
 * 原版 delay 的 1 个单位 = 多少 tick。
 *
 * 依据（可复核）：「傲慢」攻击 16 帧、`delays` 全 2 → Σ = 32，而原版这一段
 * 是 1600ms（≈50ms/单位）。本作 tick 是 60Hz，50ms = 3 tick。
 *
 * ⚠️ 它**只影响 idle 的循环速度**：攻击动画按"读条进度"归一化，
 * 与绝对时长无关（见文件头）。所以这个数不会影响任何机制，
 * 只是"待机看起来多快"。观感不对时改这一个数。
 */
export const DELAY_UNIT_TICKS = 3;

/** 权重总和；非法值按 0 计。 */
export function totalWeight(weights: FrameWeights): number {
  let total = 0;
  for (const w of weights) total += Number.isFinite(w) ? Math.max(0, w) : 0;
  return total;
}

/** 进度夹在 [0,1]；非有限值当 0（NaN 安全）。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 进度 → 帧序号（**按权重分配**）。
 *
 * 规则（与玩家给的公式一致）：取最大的 `i`，使
 * `(Σ_{j<i} delays[j]) / W <= p`。
 *
 * 边界：
 *   - 空权重 → 0（调用方本来就不该走到这里，兜底而已）
 *   - 单帧 → 0（「暴食」/「懒惰」的 idle 只有 1 帧，原版就没做待机动画）
 *   - 权重全 0 / 非法 → **退化成等分**（比"永远第 0 帧"有用）
 *   - `p = 1` → 最后一帧（不是越界的第 n 帧）
 */
export function frameAtProgress(weights: FrameWeights, progress: number): number {
  const n = weights.length;
  if (n <= 1) return 0;
  const p = clamp01(progress);
  const total = totalWeight(weights);
  if (total <= 0) return Math.min(n - 1, Math.floor(p * n));
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const w = Math.max(0, weights[i] ?? 0);
    if (p < (acc + w) / total) return i;
    acc += w;
  }
  return n - 1;
}

/**
 * idle 的循环进度：引擎 tick → [0,1)。
 *
 * idle **没有读条可挂**，所以它仍然需要一个时间来源 —— 用**引擎 tick**
 * （快照里的 `view.tick`）而不是 `performance.now()`：
 *   - 暂停 / 结算时 tick 不走，待机自然冻住（不会在结算面板背后继续抽动）
 *   - 顿帧时引擎会补跑 tick，动画跟着走，与战斗时间线一致
 *
 * ⚠️ 这是"从快照推导"而不是"自己攒时间"：同一 tick 反复调用结果相同。
 */
export function loopProgress(weights: FrameWeights, tick: number): number {
  const ticks = loopTicks(weights);
  if (ticks <= 0) return 0;
  const at = ((Math.floor(tick) % ticks) + ticks) % ticks;
  return at / ticks;
}

/** idle 一个循环要多少 tick（0 = 没有权重可用）。 */
export function loopTicks(weights: FrameWeights): number {
  const total = totalWeight(weights);
  return total <= 0 ? 0 : Math.max(1, Math.round(total * DELAY_UNIT_TICKS));
}
