/**
 * 时间与数值纪律。
 *
 * 这个文件回答一个问题：**时间到底用什么类型表示？**
 *
 * ------------------------------------------------------------------
 * 走过的弯路（记录下来，避免以后有人重走）
 * ------------------------------------------------------------------
 *
 * 1. **浮点累积**：`let t = 0; t += dt; if (t >= nextAt) {...}`。
 *    误差 O(N·ε)，5 分钟就偏若干毫秒；更糟的是
 *    `60 * (1000/60) = 1000.0000000000001` 而逐帧累加得
 *    `999.9999999999999`，于是"喂 60 帧"只推进 59 tick。
 *
 * 2. **给浮点比较加 1e-9 容差**：治症状。换个帧率或抖动模式又错。
 *
 * 3. **整数纳秒 + 债务累加**：脱离了浮点，但
 *    `NS_PER_TICK` 只能取 `16666667`（真实值 16666666.67），
 *    于是"债务攒够 N 个 tick"与"`ticksAt` 说到了 N 个 tick"
 *    用了两套不同的舍入，**必然差 1 tick**，而且差值随时间增长。
 *
 * ------------------------------------------------------------------
 * 最终方案
 * ------------------------------------------------------------------
 *
 * 关键认识：**tick 数不该由"攒了多少时间"推导，而该由真实时间直接算出。**
 * 真实时间是唯一真相源，于是不存在两套算法不一致的可能。
 *
 *   targetTick = ticksAt(realNow)        // 唯一真相源
 *   steps      = targetTick - tick       // 这一帧补几步
 *
 * 为了避免第 3 条那个"整数除不尽"的问题，时间单位取**皮秒**：
 *
 *   PS_PER_TICK = 1e12 / 60 = 16666666666.67  →  取整 16666666667
 *
 * 皮秒下每 tick 的相对表示误差是 2e-11（纳秒下是 2e-8），
 * `ticksAt` 用 round（容差半个 tick ≈ 8.3ms），所有整数量都精确：
 * 1000ms = 60、5000ms = 300、5 分钟 = 18000。
 *
 * 代价：皮秒的安全整数范围是 9e15 ps ≈ **2.5 小时**。
 * 所以时钟内部只保存**帧间隔级别的短时差**，绝不保存绝对时间。
 */

/**
 * 每秒 tick 数。**这是唯一的步长定义**，其余都由它派生。
 *
 * 先把频率定成整数，再派生每 tick 的时长 —— 反过来（先定 DT = 1000/60）
 * 会让"60Hz"变成一个无法精确表示的数，波及所有涉及"每秒多少次"的地方。
 */
export const TICKS_PER_SECOND = 60;

/** 1 毫秒 = 1e9 皮秒。 */
export const PS_PER_MS = 1_000_000_000;

/**
 * 每 tick 的皮秒数（整数）。
 *
 * 取皮秒而不是纳秒，是为了让"每 tick 时长"的相对表示误差小到
 * 可以忽略（2e-11），从而所有整秒/整毫秒处的 tick 数都精确。
 */
export const PS_PER_TICK = Math.round(1_000_000_000_000 / TICKS_PER_SECOND);

/** 每 tick 的毫秒数。仅用于展示与公式（`value * MS_PER_TICK`），**不要用来累积**。 */
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

/** 兼容别名：公式里大量引用 `DT`。强调：**不允许用它累加**。 */
export const DT = MS_PER_TICK;

/** 单帧最多补多少 tick。防止标签页休眠后回来一次性补几千 tick（死亡螺旋）。 */
export const MAX_CATCHUP_TICKS = 5;

/** 同上，毫秒表示（展示用）。 */
export const MAX_CATCHUP_MS = MAX_CATCHUP_TICKS * MS_PER_TICK;

/* ------------------------------------------------------------------ *
 * 换算
 * ------------------------------------------------------------------ */

/**
 * 毫秒 → 整数皮秒。
 *
 * `Math.round` 而不是 `Math.floor`：浏览器的时间戳是亚毫秒精度的小数，
 * 取整到皮秒后 floor 会引入系统性的向下偏置。
 */
export function msToPs(ms: number): number {
  return Math.round(ms * PS_PER_MS);
}

/** 整数皮秒 → 毫秒（展示用，会带小数）。 */
export function psToMs(ps: number): number {
  return ps / PS_PER_MS;
}

/**
 * 从真实时间算出"应该已经推进了多少 tick"。
 *
 * **这是时间→tick 的唯一入口。** `frameOf`、`quantizeToFrame`、
 * `FixedLoop.tickAt`、`SimClock.advance` 全部走它 ——
 * 只要有一条路径自己算，就会出现"时钟说 60、量化说 59"的自相矛盾
 * （这正是之前那个 1 tick 系统性差的成因）。
 *
 * 用 round：容差为半个 tick（约 8.3ms）。这不是"掩盖误差"，
 * 而是明确把精度预算花在**整数 tick 数正确**上 ——
 * 玩家感知的是 60Hz 手感，不是纳秒级等价。
 */
export function ticksAt(realNowMs: number): number {
  return Math.round((realNowMs * PS_PER_MS) / PS_PER_TICK);
}

/**
 * **精确**的 tick 边界时间：第 `tick` 个 tick 结束时的毫秒数。
 *
 * 需要构造"恰好落在边界上"的时间戳时必须用它，而不是 `tick * MS_PER_TICK`：
 * 后者是浮点乘法，`60 * MS_PER_TICK = 1000.0000000000001`，
 * 与 `ticksAt` 认定的边界不是同一个数。
 */
export function exactTickMs(tick: number): number {
  return (tick * PS_PER_TICK) / PS_PER_MS;
}

/** tick 序号 → 该 tick 结束时的模拟时间（毫秒）。等同 exactTickMs。 */
export function tickToMs(tick: number): number {
  return exactTickMs(tick);
}

/* ------------------------------------------------------------------ *
 * 逻辑步长（0.1 秒）
 * ------------------------------------------------------------------ *
 *
 * 引擎内部仍然按 60Hz 推进（渲染需要 60fps），但**游戏逻辑**用
 * 0.1 秒作为最小单位：
 *
 *   - 公共冷却 = 0.5 秒 = 5 个逻辑步
 *   - 「闪」的无敌窗口 = 0.5 秒 = 5 个逻辑步
 *   - 「卸」每 0.1 秒扣一次炁（`holdDrain`，见 `data/balance.ts`）
 *
 * 为什么不让引擎直接跑 10Hz：那样渲染插值粒度太粗，60fps 的画面
 * 会明显卡顿。所以分成"物理 tick 60Hz / 逻辑步长 0.1s"两层，
 * 由这个常量把两者连起来。
 *
 * 这样做的好处：**内容里不会出现脏数字**。
 * 直接以 60Hz 写 0.5 秒会得到 30 tick，而写 0.15 秒会得到 9 tick
 * （其实是 0.15 秒）；以 0.1s 为单位写就永远是 5、10、15 这种整数。
 */
export const LOGIC_TICK_MS = 100;

/** 一个逻辑步等于多少个物理 tick。必须是整数（100ms / 16.67ms ≈ 6）。 */
export const TICKS_PER_LOGIC_TICK = LOGIC_TICK_MS / MS_PER_TICK;

/**
 * 每秒有多少个逻辑步（= 10）。
 *
 * ⚠️ **按住消耗的"每步 ↔ 每秒"换算就用它**，不要在显示处写 `* 10`：
 * 引擎按逻辑步扣（`holdDrain.perLogicTick`），而设置页 / 技能栏写的是
 * "每秒多少"。两处各写一个换算，就又会变成"两份真相"——这次那个
 * 10 倍偏差正是这么来的（见 `docs/specs/2026-10-12-player-kits.md` §9）。
 */
export const LOGIC_TICKS_PER_SECOND = TICKS_PER_SECOND / TICKS_PER_LOGIC_TICK;

/**
 * 把逻辑步数换算成物理 tick 数。
 *
 * 只接受整数逻辑步 —— 传小数说明内容作者想表达比 0.1 秒更细的时长，
 * 那超出了本作的逻辑精度（开发期直接抛错，比静默取整好）。
 */
export function logicTicks(steps: number): number {
  if (!Number.isInteger(steps) || steps < 0) {
    throw new Error(
      `logicTicks expects a non-negative integer number of 0.1s steps, got ${steps}`,
    );
  }
  return Math.round(steps * TICKS_PER_LOGIC_TICK);
}

/** 逻辑步数 → 毫秒。 */
export function logicMs(steps: number): number {
  return steps * LOGIC_TICK_MS;
}
