/** 运行时状态（施放、战斗者、战斗状态）。 */

import type { CombatantId, LocaleKey, Side, SkillId } from './ids';
import type { Counter, ResourceKey } from './resources';
import type { PrimaryStat } from './stats';
import type { BuffInstance } from './buffs';
import type { Behavior } from './behavior';

/* ================================================================== *
 * 12. 运行时状态
 * ================================================================== */

/** 一个读条实例。Boss 可以同时读两个，所以是数组。 */
export interface CastInstance {
  readonly skillId: SkillId;
  /** 开始读条的 tick */
  readonly startedAtTick: number;
  /** 需要的读条时长（已受急速影响） */
  readonly castTimeMs: number;
  /** 已经结算到第几段 hit */
  readonly resolvedHits: number;
  readonly interruptible: boolean;
}

/**
 * 战斗单位。**没有"玩家"和"Boss"之分**——两边是同一个结构。
 * 区别只有输入来源：玩家是键盘，Boss 是行为数组。
 */
export interface Combatant {
  readonly id: CombatantId;
  readonly nameKey: LocaleKey;
  readonly side: Side;
  /** 资源上限 */
  readonly caps: Record<ResourceKey, number>;
  /** 当前资源。**整数**（见架构规范 §12：整数生命消灭了一整类判定 bug） */
  readonly resources: Record<ResourceKey, number>;
  /** 离散计数器 */
  readonly counters: Record<string, Counter>;
  /** 基础主属性 */
  readonly basePrimary: Record<PrimaryStat, number>;
  /** buff 实例 */
  readonly buffs: readonly BuffInstance[];
  /** 每个技能的下次可用 tick */
  readonly cooldowns: Record<SkillId, number>;
  /** 冷却中（受急速影响的绝对 tick） */
  readonly casts: readonly CastInstance[];
  /** 整场战斗的技能使用次数统计 */
  readonly uses: Record<SkillId, number>;
  /**
   * 当前按住不放的技能（「防」这类）。
   *
   * 为什么放进状态而不是只靠输入层记：**按住是一个持续的状态**，
   * 它每个逻辑步都要扣资源，而且必须可重放（重放时按下/松开
   * 是通过 Action 重现的，状态本身要能被检查）。
   */
  readonly activeHold?: { readonly skillId: SkillId } | undefined;
  readonly behaviors: readonly Behavior[];
  readonly alive: boolean;
}

/** 战斗阶段 / 结果。 */
export type EncounterStatus = 'idle' | 'running' | 'victory' | 'defeat';

export type EndReason = 'hpZero' | 'timeout' | 'enrage';

/**
 * 整场战斗的完整状态。
 *
 * **硬约束（C5）**：必须是可结构化克隆、可哈希的 plain object ——
 * 不许有 Map/Set/类实例/函数。旧项目在 `overTimeEffects[].caster`
 * 里直接存对象引用，导致循环引用、无法序列化。
 */
export interface BattleState {
  /** 已推进的 tick 数（整数，唯一的时间真相源） */
  readonly tick: number;
  /** 随机数状态（必须在状态里，否则无法重放） */
  readonly rngSeed: number;
  /**
   * **AI 自己的随机流**（与 `rngSeed` 平级）。
   *
   * 随机选招（`weightedRotation`）消耗的是它，而不是玩家的 `rngSeed`
   * —— 理由见 `AiState.aiRngSeed`：两条流分开之后，"玩家侧的黄金基线
   * 是否被动过"从"要重新标定才不会错"变成**结构上不可能**。
   *
   * ⚠️ 可选（`?`）是为了让"只关心玩家随机"的构造方（测试、工具）不必
   * 写它；**引擎自己总是**写这个字段，所以 `snapshot` 里读到的永远有值。
   */
  readonly aiRngSeed?: number;
  readonly status: EncounterStatus;
  readonly combatants: readonly Combatant[];
  /** 战斗开始 tick */
  readonly startedAtTick: number;
  /** 普通攻击 / 技能的充能记录：技能 → 已恢复的充能数 */
  readonly charges: Record<SkillId, { readonly current: number; readonly nextRechargeTick: number }>;
  readonly endReason?: EndReason;
}
