/**
 * 种子化洗牌 —— **`core/run/` 里唯一的随机消费者**。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §7。
 *
 * ==================================================================
 * ⚠️ 为什么必须是"一局肉鸽自己的随机流"
 * ==================================================================
 *
 * 一局肉鸽的随机（Boss 顺序、每场的种子）**绝不能**去消耗
 * `BattleState.rngSeed` / `aiRngSeed`。理由不是洁癖，是**结构性保护**：
 *
 *   若洗牌消耗了 `BattleState.rngSeed`，它会**同时改变玩家侧的所有概率
 *   判定**，`tests/golden/replay.test.ts` 会因此在"没人碰过战斗逻辑"的
 *   情况下变红 —— 那种红会让人去怀疑平衡改动，而不是怀疑这里。
 *
 * 仓库里已有同源教训：`aiRngSeed` 与 `rngSeed` 分开之后（`core/types/runtime.ts`），
 * "玩家侧的黄金基线是否被动过"从"要重新标定才不会错"变成**结构上不可能**。
 * 本文件就是同一条纪律的第二次落地：**独立的种子，独立的流。**
 *
 * 于是这一层的两个入口都只接受一个 `runSeed`：
 *   - `startRun(runSeed, …)`（`lifecycle.ts`）：由 **app 层**生成并传入
 *     （`Date.now() >>> 0`）。`core/` 里**不许**有
 *     `Date.now` / `Math.random`（lint C2）。
 *   - `shuffle(items, runSeed)`：Boss 顺序的洗牌，**纯函数**。
 *   - `battleSeed(runSeed, position)`：**一场战斗的种子**，也是**纯函数**。
 *     生产路径就是它 —— `app/battleSetup.ts` 的 `battleSeedOf` 从
 *     `RunState` 取 `(runSeed, position)` 调它。⚠️ 这一点**曾经不是真的**：
 *     当时线上给战斗种子的是 `Date.now() >>> 0`（自由模式那条路现在仍是
 *     时钟），而本文件与 `RunBattleRecord.seed` 的注释早就写着"由
 *     `battleSeed` 派生" —— 约定在、接线没做。2026-10-13 接上了
 *     （沿革见 `app/urlParams.ts` 的 `runSeed`）。
 *     ⚠️ 自由模式 / 直接单场**没有一局肉鸽**，取不到 `runSeed`，所以那条路
 *     仍然用时钟 —— 黄金夹具走的正是它（见 `app/battleSetup.ts` 的
 *     `battleSeedOf`），于是基线不动。
 *
 * 随机数走**已有的** `core/rng.ts`（mulberry32），不另起一套 —— 重复实现
 * 一个 RNG 会让"同种子同结果"这条验收变成两份各自可能漂的实现。
 */

import { createRng, randomInt, type RngState } from '../rng';

/**
 * Fisher–Yates 洗牌，种子化、纯函数。
 *
 * ==================================================================
 * 为什么是 Fisher–Yates，而不是 `sort(() => rng() - 0.5)`
 * ==================================================================
 *
 * 后者是最常见的"看似随机"写法，但它有**分布偏差**（比较器不许有
 * 随机性，`sort` 的实现细节会决定哪些排列根本出不来），而且不同引擎
 * 的排序算法不同 —— 那意味着"同一 `runSeed` → 同一顺序"这条验收
 * 在换一个运行时之后可能悄悄不成立。Fisher–Yates 是 O(n)、无偏、
 * 且**只依赖我们自己推进的随机状态**，所以上面那条验收是**结构上**
 * 成立的，不是"我们测过几个种子"。
 *
 * 从后往前换（`i` 从 `n-1` 到 1）而不是从前往后：两种写法都对，但
 * "从后往前"的循环上界就是 `i + 1`，少一次 `+1` 的思考成本，也不会
 * 写出 `randomInt(state, n - i) + i` 那种容易差一的变体。
 *
 * 入参**不被修改**（返回新数组）：`RunState` 里的 `order` 是 readonly，
 * 原地洗牌会让"谁改了顺序"变得不可见，也会让测试里两个引用同一个
 * 数组的断言互相污染。
 *
 * @param items 要洗牌的**副本来源**（可以是 readonly）
 * @param runSeed 一局肉鸽的种子（uint32；负数 / 小数会被 `createRng` 规范化）
 */
export function shuffle<T>(items: readonly T[], runSeed: number): T[] {
  const out = [...items];
  const count = out.length;
  if (count <= 1) return out;

  let state: RngState = createRng(runSeed);
  for (let i = count - 1; i > 0; i -= 1) {
    const draw = randomInt(state, i + 1);
    state = draw.state;
    // `noUncheckedIndexedAccess` 下这两个都是 `T | undefined` —— 循环不变量
    // 保证了它们存在（i < count 且 j <= i），所以用显式的存在性检查而不是
    // 类型断言（AGENTS.md §1：不许 `as any` / `as unknown as`）。
    const a = out[i];
    const b = out[draw.value];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[draw.value] = a;
  }
  return out;
}

/**
 * 混一个 uint32 的位（splitmix32 的 finalizer）。
 *
 * 用途见 `battleSeed`：把"一局肉鸽的种子 + 第几场"混成一个**看不出
 * 规律**的战斗种子。
 */
function mix32(value: number): number {
  let t = (value + 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
  return (t ^ (t >>> 15)) >>> 0;
}

/**
 * 一局肉鸽里**第 `position` 场战斗**的种子。纯函数，每场独立。
 *
 * ==================================================================
 * ⚠️ 为什么不是 `rngSeed + position`，也不是"继续用同一个流"
 * ==================================================================
 *
 * - **共用同一个 seed**（7 场都用 `runSeed`）：两个 Boss 的出招序列会
 *   相关 —— 同一个加权随机轮转在同样的种子下会抽出同样的偏移，玩家会
 *   看到"换了 Boss 但出招节奏一模一样"。§7.1 写死要每场独立。
 * - **`runSeed + position`**：虽然数值上不同，但相邻种子的 mulberry32
 *   序列高度相关（种子只差 1），而且 `runSeed+1` 会与"另一个 runSeed
 *   的第 0 场"撞上。这里要防的是"两个不同的 (runSeed, position) 得到
 *   同一个战斗种子"，那样两场战斗会完全一致。
 * - **`mix32`**：先把两个整数混成"雪崩"后的 uint32，再取一次
 *   `randomInt`。前一步保证不同输入极少碰撞，后一步保证输出是
 *   mulberry32 真正会产生的值（而不是把 `mix32` 的输出直接当种子 ——
 *   那样 `battleSeed(1,1)`、`battleSeed(1,2)` 之间只剩 mix32 的质量，
 *   而它**不是**一个 RNG，只是一个混淆函数）。
 *
 * `position` 从 1 开始（第几场）。传 0 或负数会被 `createRng` 规范化，
 * 但**不要依赖它** —— `assertPosition` 那样的边界检查在调用侧
 * （`lifecycle.ts` 才认识 `position` 的语义）。
 */
export function battleSeed(runSeed: number, position: number): number {
  const combined = (Math.imul(runSeed >>> 0, 0x9e3779b1) + Math.imul(position | 0, 0x85ebca6b)) >>> 0;
  return randomInt(createRng(mix32(combined)), 0x100000000).value;
}
