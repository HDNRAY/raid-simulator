/** Boss 行为（数组模型，双方共用）。 */

import type { SkillId } from './ids';
import type { Condition, Who } from './stats';
import type { Ability } from './abilities';

/* ================================================================== *
 * 11. Boss 行为（数组模型，双方共用）
 * ================================================================== */

/** 轮转步骤：按顺序尝试，第一个条件满足的被执行。 */
export interface RotationStep {
  readonly skillId: SkillId;
  readonly when?: Condition;
  /** 相对上一次的间隔（ms） */
  readonly gapMs?: number;
}

/**
 * 加权随机轮转的步骤：**顺序不表示任何优先级**，只有权重。
 *
 * ⚠️ 与 `RotationStep` 刻意分成两个类型，而不是给它加一个可选 `weight`：
 * 顺序轮转里"顺序即优先级"，而随机轮转的顺序**什么都不表示** ——
 * 两者语义相反，共用一个类型会让"这条为什么排第一"变成一个无法回答的
 * 问题，也会诱导作者把重要的技能放前面（那对随机轮转毫无作用）。
 *
 * ⚠️ 也因此**没有 `gapMs`**：间隔是整条轮转共用的（见
 * `weightedRotation.gapMs`），因为它的语义是"两刀之间至少隔多久" ——
 * 那是全场属性，不是单技能属性。
 */
export interface WeightedRotationStep {
  readonly skillId: SkillId;
  /** 相对权重（正数）。候选集里按它加权抽取。 */
  readonly weight: number;
  /** 不成立时**不进候选集**（于是也不消耗随机数）。 */
  readonly when?: Condition;
}

/**
 * Boss 行为：**"每一招怎么打"由行为数组决定，"遇到什么条件换招"由条件
 * 数组决定** —— 两者分开，所以同一个行为能被多个条件复用。
 */
export type Behavior =
  | { readonly kind: 'timeLimit'; readonly ms: number }
  /** 超时狂暴的**便利写法**（等价于"到点授予一个增伤 buff"） */
  | { readonly kind: 'enrage'; readonly atMs: number; readonly dmgMult: number }
  | { readonly kind: 'opener'; readonly skillId: SkillId; readonly delayMs: number }
  | {
      readonly kind: 'rotation';
      /**
       * 步骤按顺序尝试，第一个 `when` 满足且冷却好的被执行。
       * **换招就是在这个数组里写不同 `when` 的步骤。**
       */
      readonly steps: readonly RotationStep[];
    }
  /**
   * **加权随机轮转**：从"冷却已好 + 条件成立"的候选集里按权重抽一个。
   *
   * ==================================================================
   * 为什么是**新的** kind，而不是把 `rotation` 改成随机的
   * ==================================================================
   *
   * `rotation` 的"顺序即优先级"是「色欲」整段注释在解释的语义
   * （长 CD 的招排前面，否则填充技会把它饿死）。把共享引擎改成随机
   * 等于**同时改两个 Boss 的强度**，风险不成比例 —— 所以随机是
   * 「傲慢」显式选择的一种行为（设计 §Q2）。
   *
   * 两条内建规则（都不是可选项）：
   *   - 同一个技能**不连续两次**（否则"连着 4 次 60"是 3 刀打死 100 血
   *     的不可玩局面）。⚠️ 只防连续，不做"必须轮换" —— 那会退化成
   *     固定顺序，把"随机"这个设计目标毁掉
   *   - 候选集为空时**不消耗随机数**（与 `rollChance` 的短路原则一致）
   */
  | {
      readonly kind: 'weightedRotation';
      readonly steps: readonly WeightedRotationStep[];
      /** 两刀之间至少隔多久（ms）。与单技能冷却分开：它管"两刀之间"。 */
      readonly gapMs?: number;
    }
  /**
   * 血量降到阈值以下时执行一串**能力**。
   *
   * `then` 用 `Ability` 而不是嵌套 `Behavior`：这样"授予 buff"
   * "改属性""给资源"全部复用既有能力系统，不必为每种嵌套再写一遍执行代码。
   * 阶段转换就是这里 `grant` 一个阶段 buff。
   */
  | {
      readonly kind: 'onHpBelow';
      readonly ratio: number;
      readonly who?: Who;
      readonly then: readonly Ability[];
    }
  | { readonly kind: 'interruptible'; readonly skillIds: readonly SkillId[] };
