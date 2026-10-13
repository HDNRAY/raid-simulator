/**
 * **开一场战斗需要的输入**（`new BattleEngine(options)` 的那个 options）。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3：横向切割，不压注释）
 * ==================================================================
 *
 * 它是"**引擎的输入契约**"：内容层（`app/battleSetup.ts`）按它组装，
 * 引擎按它读。而 `battleState.ts`（引擎的状态机）顶在 700 行上限上 ——
 * 契约与实现是两件事，分开之后：
 *
 *   - 读"引擎需要什么"不必翻 700 行的类
 *   - 加一个输入字段只动这里 + 消费点，不会在类定义里插一段
 *
 * ⚠️ 字段的注释**整段搬过来**（AGENTS §3）：下面 `comboWindows` 那一段
 * 记着"默认没有炁机 = 完全空操作"这条硬验收，压掉它下一个人会把
 * "单场路径不许变"重新踩一遍。
 */

import type { Combatant, BuffDef, SkillDef, StatKey, StatModifier } from '../types';
import type { ComboWindowSpec } from './comboWindow';

/** 起一局战斗需要的输入。 */
export interface CreateBattleOptions {
  readonly combatants: readonly Combatant[];
  readonly seed: number;
  /** 时间限制（ms）。超时判负。 */
  readonly timeLimitMs?: number;
  /** 谁是 Boss（AI 驱动方）。不给则没有 AI。 */
  readonly bossId?: string;
  readonly buffs: ReadonlyMap<string, BuffDef>;
  readonly skills: ReadonlyMap<string, SkillDef>;
  /** 每个 combatant 的基础属性（内容定义） */
  readonly baseStats: ReadonlyMap<string, Partial<Record<StatKey, number>>>;
  /** 每个 combatant 身上的被动修正（装备 / 天赋） */
  readonly passiveModifiers: ReadonlyMap<string, readonly StatModifier[]>;
  /**
   * **派生窗口的产出者**（肉鸽的炁机接回「击」用的，见 `./comboWindow.ts`）。
   *
   * ⚠️ 不传 = 没有窗口产出者 = **完全的空操作**（每 tick 一个判断都不做）。
   * 单场 / 自由模式 / 黄金重放都不传它，所以那些路径**逐位不变**。
   */
  readonly comboWindows?: readonly ComboWindowSpec[];
}
