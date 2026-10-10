/** 效果与伤害（`Effect` / `DamageSpec` / `HitDef`）。 */

import type { BuffId, SkillId } from './ids';
import type { ResourceKey } from './resources';
import type { Condition, Expr, StatKey, Who } from './stats';
import type { BuffDef } from './buffs';

/* ================================================================== *
 * 6. 效果与伤害
 * ================================================================== */

/** 属性缩放项。 */
export interface ScalingTerm {
  readonly stat: StatKey;
  readonly ratio: number;
  readonly who?: Who;
}

/**
 * 伤害/治疗的数值定义。
 *
 * 结构化而不是函数（同 Expr 的理由）：可序列化、可测试、
 * 能被 UI 解释、能算得出"这一下为什么是这个数"。
 */
export interface DamageSpec {
  readonly base: number | Expr;
  readonly scaling?: readonly ScalingTerm[];
  readonly canCrit: boolean;
  /** 是否触发 onHitDealt / onCritDealt 等 hook */
  readonly countsAsHit: boolean;
  /** 固定伤害：忽略增伤与减伤（"真实伤害"机制） */
  readonly ignoreModifiers?: boolean;
  /** 目标侧是否可闪避 */
  readonly avoidable?: boolean;
}

export type EffectKind =
  | 'damage'
  | 'heal'
  | 'grantBuff'
  | 'removeBuff'
  | 'resource'
  | 'interrupt'
  | 'dispel'
  | 'applyDebuffStack'
  /**
   * 调整某个技能的冷却（负数为退还）。⚠️ 直接改 `combatant.cooldowns`
   * 而不是挂 buff —— 后者会让冷却状态分裂成两处，UI 显示不对。
   */
  | 'cooldown'
  /**
   * **眩晕**：目标在 buff 持续时间内**完全不能行动**。
   *
   * 语义等价于"挂一个带 `flags.actionLock` 的 buff"，并**打断当前施法**。
   *
   * ⚠️ 为什么单独一个 `kind` 而不是让内容直接写 `grantBuff` + `interrupt`：
   *   - "眩晕"是一个**玩家会认得的机制**，内容里应该一眼看出是它，
   *     而不是两行需要推理的 buff 字段
   *   - 它保证了"挂 buff"与"打扰断"**永远同时发生** —— 分成两条效果时
   *     很容易只写一条，那就会出现"不能动但读条还在走"这种半晕状态
   *
   * 用的是现成的 `actionLock`（施法门禁的**第一优先级**，拒绝原因
   * `locked`），**没有新造输入状态**。
   */
  | 'stun';

/** 效果 = 一次结算里发生的事。技能 `hits[].effects` 与独立 ability 共用它。 */
export interface Effect {
  readonly kind: EffectKind;
  /** damage / heal 用 */
  readonly damage?: DamageSpec;
  /** grantBuff / removeBuff 用 */
  readonly buff?: BuffDef;
  readonly buffId?: BuffId;
  /** resource 用 */
  readonly resource?: { readonly key: ResourceKey; readonly delta: number | Expr };
  /**
   * `kind: 'cooldown'` 用：调整**哪个**技能的冷却（不填 = 当前技能自己，
   * 那是「截」"成功不进 CD"的用法；填了供"被控时加 CD"用）。
   */
  readonly skillId?: SkillId;
  /** `kind: 'cooldown'` 用：加/减多少毫秒（负数 = 退还）。 */
  readonly cooldownMs?: number;
  /**
   * **只在"这个效果真的生效了"时，再结算这些效果**（需求：「截」的
   * "如果成功，不进入 cd"）。
   *
   * ⚠️ 需要它是因为 `interrupt` 可能什么都没打断（目标没读条 / 带
   * `interruptImmune`），而技能**先扣 CD 再结算命中** —— "成功才退 CD"
   * 只能等运行期知道结果之后决定，静态的 `abilities` 表达不了。
   */
  readonly onSuccess?: readonly Effect[];
  /** 不填则取所在 ability / hit 的目标 */
  readonly target?: TargetRule;
  readonly when?: Condition;
  /**
   * 仅 `interrupt` 用：**强制打断，不看 `interruptible`**。
   *
   * 「破」的语义是"打断任何技能"（需求明确），所以它是真打断而不是
   * 只对可打断技能生效。默认 false，即尊重目标技能的可打断性。
   */
  readonly force?: boolean;
}

/** 目标的解析规则。 */
export type TargetRule =
  | { readonly mode: 'self' }
  | { readonly mode: 'primaryEnemy' }
  | { readonly mode: 'allEnemies' }
  | { readonly mode: 'allAllies' }
  | { readonly mode: 'lowestHpAlly'; readonly ratio: number }
  | { readonly mode: 'owner' };

/** 一段命中。多段攻击 = 多个 HitDef。 */
export interface HitDef {
  /** 相对技能开始的毫秒偏移 = hit frame */
  readonly at: number;
  readonly effects: readonly Effect[];
  /** 该段是否可被闪避 */
  readonly avoidable?: boolean;
}
