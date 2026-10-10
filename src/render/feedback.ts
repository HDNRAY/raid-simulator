/**
 * **受击反馈的统一模型**。
 *
 * ==================================================================
 * 设计：把「事件」翻译成「强度 → 四通道」
 * ==================================================================
 *
 * 需求："玩家闪避（有了），防御（目前有一个变矮），但是受击，被眩晕，
 * 和 boss 受击，都没啥好的反馈，我需要一个**统一的设计**。"
 *
 * 原先每个状态各写各的：闪避改 `playerRoot.x`、防御改 `base` 偏移、
 * 受击改 `flash` —— 加一种状态就要再想一遍该动什么。这里把它统一成：
 *
 *     引擎事件 → 强度 I（0..1） → 四通道
 *
 * | 通道 | 手段 | 表达 |
 * |---|---|---|
 * | 色 | `tint` | 状态类别（无敌 / 防御 / 晕） |
 * | 位 | 节点 x / y | 受力方向、位移 |
 * | 时 | 顿帧 | **打击感**（`hitStopMs`） |
 * | 形 | 挤压 | 姿态变化 |
 *
 * 每个反馈声明"用哪几个通道 + 强度多少"，而不是各写各的。
 *
 * ==================================================================
 * ⚠️ 强度用**比例**而不是档位
 * ==================================================================
 *
 * `I = 实际伤害 ÷ 该角色的最大生命`，于是暴击自然更重，不需要为
 * "重击"单独写一套反馈，也不用在加技能时手动归类。
 * 代价是数值改动会连带改变观感 —— 这是有意的权衡：本作伤害数值本来就
 * 是平衡的核心杠杆，"重击看起来就该重"。
 *
 * 所有系数都在本文件顶部，**调手感只改这里**。
 */

/** 一帧的反馈状态（渲染层只读它，不自己判断事件）。 */
export interface FeedbackState {
  /**
   * 顿帧剩余毫秒。
   *
   * ⚠️ 主循环要读它并**暂停推进**（见 `battleLoop`）—— 这是四个通道里
   * 唯一会改时间轴的，也是打击感最强的。触屏上会短暂冻结按钮响应，
   * 所以时长上限刻意压在 70ms 以内。
   */
  readonly hitStopMs: number;
  /** 反冲位移（px，正 = 向右）。带过冲回弹。 */
  readonly recoilX: number;
  /** 纵向挤压系数（1 = 原样，<1 = 压扁）。 */
  readonly squashY: number;
}

/** 没有反馈时的静止状态（数值全为中性）。 */
export const IDLE_FEEDBACK: FeedbackState = { hitStopMs: 0, recoilX: 0, squashY: 1 };

/* ------------------------------------------------------------------ *
 * 可调参数（调手感只改这一段）
 * ------------------------------------------------------------------ */

/**
 * 顿帧时长。
 *
 * 上限 70ms 是**刻意**的：再长在触屏上会让"按键没反应"的感觉出现。
 * 基准 25ms 对应一次普通命中 —— 刚好能感觉到"卡了一下"。
 */
const HIT_STOP_BASE_MS = 25;
const HIT_STOP_SCALE_MS = 45;

/** 反冲幅度：基准 4px + 强度部分 10px。 */
const RECOIL_BASE_PX = 4;
const RECOIL_SCALE_PX = 10;

/**
 * 过冲深度（回弹幅度）：0.1 表示回弹到峰值的 -10%。
 *
 * ⚠️ 这个数直接决定曲线：`rest<0.4` 段从 `1` 降到 `-OVERSHOOT`，
 * 之后线性归位到 0。改动它要连测试里的探针点一起看。
 */
const OVERSHOOT = 0.1;

/** 挤压深度：强度 1 时压到 88%。 */
const SQUASH_MIN = 0.88;


/* ------------------------------------------------------------------ *
 * 强度
 * ------------------------------------------------------------------ */

/**
 * 把一次伤害换算成 0..1 的强度。
 *
 * ⚠️ `maxHp <= 0` 时返回 0 而不是 `Infinity` —— 除零会在渲染层变成
 * `NaN`，而 `NaN` 传给 Pixi 的 `x`/`scale` 会让节点**整个消失**
 * （不是显示错，是不显示）。这是"任何时刻都要有可见的东西"那条约束。
 */
export function damageIntensity(amount: number, maxHp: number): number {
  if (!(maxHp > 0) || !(amount > 0)) return 0;
  return Math.min(1, amount / maxHp);
}

/** 由强度算出四个通道。`crit` 额外加成（暴击该更重）。 */
export function feedbackForDamage(intensity: number, crit = false): FeedbackState {
  const i = clamp01(intensity * (crit ? 1.35 : 1));
  return {
    hitStopMs: Math.round(HIT_STOP_BASE_MS + HIT_STOP_SCALE_MS * i),
    recoilX: RECOIL_BASE_PX + RECOIL_SCALE_PX * i,
    squashY: 1 - (1 - SQUASH_MIN) * i,
  };
}

/** 眩晕：只有形态通道（缓慢摇摆），**没有**顿帧和反冲。 */
export function feedbackForStun(): FeedbackState {
  return { hitStopMs: 0, recoilX: 0, squashY: 1 };
}

/* ------------------------------------------------------------------ *
 * 衰减
 * ------------------------------------------------------------------ */

/**
 * 反冲的时间曲线：**冲出去 → 过冲回弹 → 归位**。
 *
 * 三段线性（`1 → -OVERSHOOT → -0.2·OVERSHOOT → 0`）而非正弦，因为
 * **第一段必须够快**：反冲要"脆"，慢了就变成"慢慢飘过去"。
 *
 * ⚠️ 峰值在 25%、**过冲在 60%**。第一版把过冲段写成
 * `1 → (1+OVERSHOOT)` 线性下降，结果 60% 处才降到 -0.2·OVERSHOOT
 * —— 也就是"还没回弹就结束了"，中段看不到负值。测试当场抓出来的。
 *
 * @param progress 0 → 1 的归一化进度
 */
export function recoilCurve(progress: number): number {
  const p = clamp01(progress);
  const PEAK = 0.25;
  if (p < PEAK) return p / PEAK;
  const rest = (p - PEAK) / (1 - PEAK);
  /**
   * 两段拼出"1 → -0.1 → 0"：
   *   rest<0.4：`1 → -0.10`（这一段要陡，才"脆"）
   *   rest≥0.4：`-0.10 → 0`（缓慢归位）
   */
  if (rest < 0.4) return 1 - (1 + OVERSHOOT) * (rest / 0.4);
  return -OVERSHOOT * (1 - (rest - 0.4) / 0.6);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
