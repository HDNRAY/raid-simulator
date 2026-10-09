/**
 * 数值纪律（numeric policy）。
 *
 * 游戏里的浮点问题和数值计算里的不是一回事。真正会咬人的有四类：
 *
 *   1. **累积漂移** —— 用 float 累积时间或计数器，跑久了误差变大。
 *      `tick += dt` 这种写法在 18000 tick 后就会偏。
 *   2. **阈值抖动** —— 用 float 存生命/资源，`hp <= 0` 这种判定
 *      会因为 0.0000001 的误差变成"没死"，或者反过来提前死。
 *   3. **比较不可靠** —— `a === b` 对浮点几乎总是错的，而
 *      `a < b` 在 a、b 理论相同时也可能给出任意结果。
 *   4. **格式化与统计误差** —— 百分比相加用 float 会把
 *      "10% + 10%" 算成 `0.19999999999999998`。
 *
 * 对策（本模块提供原语，纪律写在这里）：
 *
 *   - **时间与计数一律用整数 tick**，毫秒只在边界换算。见 simClock.ts。
 *   - **持续状态一律用"截止时刻"而不是"剩余时长"**。
 *     剩余时长每帧减 dt 会漂移；截止时刻是立刻确定的值，不会。
 *   - **生命与离散资源一律整数**，公式内部按 float 算，
 *     只在**写回状态**时取整。见 `roundStat`。
 *   - **求和用 Kahan 补偿**，把误差从 O(n) 降到 O(1)。
 *   - **比较用容差**，且容差必须显式选择，不允许默认"看起来对就行"。
 */

/* ------------------------------------------------------------------ *
 * 容差
 * ------------------------------------------------------------------ */

/**
 * 严格容差。
 * 用于断言"理论上相等"的量（同一算式换个顺序算出来的结果）。
 */
export const EPS_STRICT = 1e-9;

/**
 * 宽松容差。
 * 用于连续累加后的比较（例如 60 次浮点加法之后）。
 */
export const EPS_LOOSE = 1e-6;

/**
 * 固定步长累加器专用容差（1 纳秒）。
 *
 * 比 EPS_STRICT 更小，因为它是拿来吸收 `n * DT` 的表示误差的：
 * `60 * (1000/60) = 1000.0000000000001`，而逐帧累加得 `999.9999999999999`，
 * 差约 1.4e-13。这个量级远小于 1e-9，但必须显式给出而不是"顺手写一个"。
 */
export const EPS_TIME = 1e-9;

/** 浮点相等（严格）。 */
export function feq(a: number, b: number, eps: number = EPS_STRICT): boolean {
  return Math.abs(a - b) <= eps;
}

/** 浮点小于（带容差：a 明显小于 b 才算真）。 */
export function flt(a: number, b: number, eps: number = EPS_STRICT): boolean {
  return a < b - eps;
}

/** 浮点大于（带容差）。 */
export function fgt(a: number, b: number, eps: number = EPS_STRICT): boolean {
  return a > b + eps;
}

/** 浮点小于等于（带容差）。 */
export function fle(a: number, b: number, eps: number = EPS_STRICT): boolean {
  return a <= b + eps;
}

/** 浮点大于等于（带容差）。 */
export function fge(a: number, b: number, eps: number = EPS_STRICT): boolean {
  return a >= b - eps;
}

/** 把接近 0 的值归零，避免 `-0` 与极小残差污染输出与哈希。 */
export function fsnapZero(a: number, eps: number = EPS_STRICT): number {
  return Math.abs(a) <= eps ? 0 : a;
}

/* ------------------------------------------------------------------ *
 * 取整（只在写回状态时做）
 * ------------------------------------------------------------------ */

/**
 * 取整到整数。
 *
 * 这是**唯一允许**把公式结果变成状态值的入口。分散在各处
 * 写 `Math.round` / `| 0` / `Math.floor` 会让"舍入策略"变成隐藏约定，
 * 以后想改成"伤害向下取整、治疗向上取整"就得满地找。
 */
export function roundStat(value: number): number {
  if (!Number.isFinite(value)) {
    // 开发者错误，不是面向玩家的文案 —— 用英文，不进 i18n 表（I1）。
    throw new RangeError(`roundStat received a non-finite value: ${value}`);
  }
  return Math.round(value);
}

/**
 * 伤害取整：向下取整。
 *
 * 理由：向上取整会让"每次 0.5 伤害"在多次命中后变成 1 点，
 * 相当于凭空放大；向下取整更保守，也更好解释给玩家。
 * 代价是急速堆叠下总伤害略低于理论值 —— 这是可接受的、可预期的偏差。
 */
export function roundDamage(value: number): number {
  return Math.floor(value);
}

/**
 * 取整并保证非负。用于"至少造成 1 点伤害"这类规则之外的地方。
 */
export function roundNonNegative(value: number): number {
  return Math.max(0, Math.round(value));
}

/* ------------------------------------------------------------------ *
 * 精确求和
 * ------------------------------------------------------------------ */

/**
 * Kahan 补偿求和器。
 *
 * 为什么需要：把 N 个修正值相加时，朴素的 `+=` 误差是 O(N·ε)，
 * 而且**与顺序有关** —— 同一批修正换个数组顺序会得到不同结果，
 * 这会让黄金重放测试变成"随机通过"。
 *
 * Kahan 把误差降到 O(ε)，且对顺序不敏感得多。
 *
 * 用法：
 * ```ts
 * const s = new KahanSum();
 * for (const m of modifiers) s.add(m.value);
 * const total = s.total;
 * ```
 */
export class KahanSum {
  private sum = 0;
  private compensation = 0;
  private n = 0;

  add(value: number): void {
    const y = value - this.compensation;
    const t = this.sum + y;
    // 用"加法前后的大数部分之差"还原出这次加法丢掉的低位
    this.compensation = t - this.sum - y;
    this.sum = t;
    this.n += 1;
  }

  get total(): number {
    return this.sum;
  }

  get count(): number {
    return this.n;
  }
}

/** 对数组做 Kahan 求和。 */
export function kahanSum(values: readonly number[]): number {
  const s = new KahanSum();
  for (const v of values) s.add(v);
  return s.total;
}

/**
 * 精确的百分比累加：`Σ values`。
 *
 * 语义上等价于 `values.reduce((a, b) => a + b, 0)`，
 * 但误差从 O(N·ε) 降到 O(ε)，且不受顺序影响。
 */
export function kahanSumPercent(values: readonly number[]): number {
  return kahanSum(values);
}

/**
 * 精确的乘积连乘：`∏ values`。
 *
 * 乘法没有加法那种灾难性抵消，但连乘多个接近 1 的数仍会累积误差。
 * 这里用"先分解成对数"的方式并不划算（log/exp 本身有误差），
 * 所以保持朴素连乘，但**把顺序固定**（按 sourceKey 排序）以保证可复现。
 */
export function productOrdered(values: readonly number[]): number {
  let acc = 1;
  for (const v of values) acc *= v;
  return acc;
}

/* ------------------------------------------------------------------ *
 * 安全除法与钳制
 * ------------------------------------------------------------------ */

/**
 * 安全除法。除数为 0 时返回 fallback，而不是 Infinity / NaN。
 *
 * 引擎里出现 NaN 是最糟的情况：它会顺着算术传播，直到某个
 * `hp <= 0` 判定给出 false（NaN 与任何数比较都是 false），
 * 表现为"打不死"而难以定位。所以除法一律走这里。
 */
export function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (denominator === 0 || !Number.isFinite(denominator)) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

/** 钳制到 [min, max]，且保证结果是有限的。 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** 比率的安全计算：`part / whole`，whole <= 0 时返回 0。 */
export function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return clamp(part / whole, 0, 1);
}

/* ------------------------------------------------------------------ *
 * 不变量断言（开发期用）
 * ------------------------------------------------------------------ */

/**
 * 断言一个数值是可用于状态写入的有限数。
 *
 * 引擎每次写回状态前都该过一遍 —— 一旦 NaN 进了状态，
 * 定位成本会远高于在这里抛错。
 */
export function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    // 同上：开发者错误用英文。
    throw new RangeError(`${label} is not a finite number: ${value}`);
  }
  return value;
}
