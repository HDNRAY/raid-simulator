/**
 * 输入 —— 引擎的**唯一入口**（可录制、可重放）。
 *
 * ==================================================================
 * 为什么是一个独立文件
 * ==================================================================
 *
 * `types.ts` 超过 700 行（AGENTS.md §3）。这一段是**干净的叶子**：
 * 它只依赖两个标识类型（`SkillId` / `CombatantId`），而 `types.ts` 里
 * 只有运行时状态（12 段）引用它。
 *
 * 输入本来就该单独一层：架构规范 §2.1 的数据流是
 *   **Action[] → sim → Snapshot/EventDef[] → renderer**
 * 它是链路的**起点**，独立成文件正好对应这个位置。
 */

import type { CombatantId, SkillId } from './types/ids';

export type Action =
  | { readonly type: 'useSkill'; readonly skillId: SkillId; readonly atTick: number }
  /**
   * 按住不放：施放一个"按住型"技能，并保持它。
   *
   * 与 `useSkill` 的区别：按住型技能在松开前一直是生效状态，
   * 引擎按逻辑步扣 `holdDrain`；`useSkill` 是"点一下"的语义。
   */
  | { readonly type: 'hold'; readonly skillId: SkillId; readonly atTick: number }
  | { readonly type: 'releaseKey'; readonly key: string; readonly atTick: number }
  | { readonly type: 'releaseSkill'; readonly skillId: SkillId; readonly atTick: number }
  | { readonly type: 'setTarget'; readonly targetId: CombatantId; readonly atTick: number }
  | { readonly type: 'cancelCast'; readonly atTick: number }
  | { readonly type: 'pause'; readonly atTick: number }
  | { readonly type: 'resume'; readonly atTick: number }
  | { readonly type: 'restart'; readonly seed: number; readonly atTick: number };

export type ActionType = Action['type'];
