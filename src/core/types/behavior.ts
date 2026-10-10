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
