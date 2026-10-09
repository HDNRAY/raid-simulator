/**
 * 种子化随机数发生器。
 *
 * 为什么不用 `Math.random`（architecture 规范 §2.1 的 C2 约束）：
 *   状态里只要有一次真随机，整场战斗就无法重放、无法存档、无法用黄金测试
 *   回归。所以随机数必须是**状态的一部分**，随快照一起被序列化和哈希。
 *
 * 算法是 mulberry32：状态就是一个 uint32，质量足够游戏数值用，
 * 且天然满足 C5（可结构化克隆、可哈希）。
 */

/** RNG 状态。作为 BattleState 的一部分被保存与哈希。 */
export interface RngState {
  /** uint32 */
  readonly seed: number;
}

/** 创建初始状态。同一个 seed 必然产生同一条随机序列。 */
export function createRng(seed: number): RngState {
  // 强制成 uint32，避免负数/小数进来后行为不确定
  return { seed: seed >>> 0 };
}

/**
 * 推进一次随机。**纯函数**：返回新状态与 [0, 1) 的值，不修改入参。
 *
 * 返回新状态而不是原地修改，是为了让"是否消耗了随机数"在代码里显式可见 ——
 * 原地修改会让调用顺序影响结果却看不出来。
 */
export function nextRandom(state: RngState): { state: RngState; value: number } {
  let t = (state.seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: { seed: t }, value };
}

/** 便捷封装：只要值，不要新状态（用于不关心里程碑的场合，如纯展示）。 */
export function randomValue(state: RngState): number {
  return nextRandom(state).value;
}

/** [min, max) 区间的浮点数。 */
export function randomRange(
  state: RngState,
  min: number,
  max: number,
): { state: RngState; value: number } {
  const r = nextRandom(state);
  return { state: r.state, value: min + r.value * (max - min) };
}

/** [0, max) 区间的整数。 */
export function randomInt(
  state: RngState,
  maxExclusive: number,
): { state: RngState; value: number } {
  const r = nextRandom(state);
  return { state: r.state, value: Math.floor(r.value * maxExclusive) };
}

/**
 * 概率判定。`chance <= 0` 时**不消耗随机数**（性能 + 不扰动序列），
 * 这一点很重要：否则给某个技能加上 `chance: 0` 会改变整场战斗的其他随机结果。
 */
export function rollChance(
  state: RngState,
  chance: number,
): { state: RngState; success: boolean } {
  if (chance <= 0) return { state, success: false };
  if (chance >= 1) return { state, success: true };
  const r = nextRandom(state);
  return { state: r.state, success: r.value < chance };
}
