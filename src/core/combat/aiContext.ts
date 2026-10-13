/**
 * **AI 阶段的上下文装配** —— `BattleEngine` 把它的能力借给 `runAi` 的那一份。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3：横向切割，不压注释）
 * ==================================================================
 *
 * `battleState.ts` 顶在 700 行上限上。这一块是**纯装配**：它把引擎的状态
 * 与几个回调拼成 `AiContext`，没有一行判定 —— 而"AI 需要哪几个能力"这件事
 * 与 tick 管线、施法流程、命中结算都无关。切出来之后：
 *
 *   - `battleState.ts` 少 30 行（它本来就只是在"转发"）
 *   - 这一份装配能被单独读懂，不必在 700 行的类里找它
 *
 * ⚠️ 注释整段搬过来（AGENTS §3：抽取时连带注释一起搬，不留摘要）——
 * 下面 `updateAiState` 那一段记着一个**真 bug** 的成因，压掉它下一个人
 * 会重踩（"引擎自己的 `aiState` 永远是空的"）。
 */

import { runAbilities, type AbilitiesContext, type AiContext } from './runAi';
import type { AiState } from '../ai';
import type { Action, BattleState, BuffDef, Combatant, EventDef, SkillDef } from '../types';

/** 造一个 `AiContext` 需要的引擎能力（全部由 `BattleEngine` 提供）。 */
export interface AiContextDeps {
  readonly state: Pick<BattleState, 'tick' | 'startedAtTick' | 'combatants'>;
  readonly events: EventDef[];
  readonly aiState: AiState;
  readonly buffs: ReadonlyMap<string, BuffDef>;
  readonly skills: ReadonlyMap<string, SkillDef>;
  /** 没有 AI 的场合（测试 / 静止截图场景）这里是 `undefined`。 */
  readonly bossId: string | undefined;
  readonly current: (id: string) => Combatant;
  readonly replaceCombatant: (updated: Combatant) => void;
  readonly opponentOf: (id: string) => Combatant | undefined;
  readonly applyEnrage: (boss: Combatant) => void;
  /** 能力执行器的上下文（`runAbilities` 要它）。 */
  readonly abilitiesContext: () => AbilitiesContext;
  readonly applyActions: (actions: readonly Action[], actorId: string) => void;
  /**
   * AI 决策后把新状态**写回引擎**。
   *
   * ⚠️ 这个回调的存在本身就是一个 bug 的修复（由来见 `buildAiContext`
   * 的注释），所以它是**必填**而不是可选的。
   */
  readonly updateAiState: (next: AiState) => void;
}

/**
 * 造 `AiContext`。
 *
 * ⚠️ 每次调 `runAi` 都现造一个普通对象（状态不在这里持有）——
 * 所以"推进后的 AI 状态"必须走 `updateAiState` 写回引擎：
 *
 * > 原先这里是 `aiState: AiState`，`runAi` 直接给它赋值
 * > （`ctx.aiState = decision.nextState`）。但 `ctx` 是**每次调用新建的
 * > 一个普通对象**，所以那次赋值只改了一个立刻被丢弃的对象 ——
 * > 引擎自己的 `this.aiState` **永远是空的**。
 * >
 * > 症状（改造「傲慢」时暴露）：`lastUsedAt` 恒为 `{}`，于是
 * > `gapMs` 完全失效、"同招不连发"的保底失效 —— Boss 按**冷却**而不是
 * > `gapMs` 出招（实测 2 秒一刀，而不是 4 秒）。
 */
export function buildAiContext(d: AiContextDeps): AiContext {
  return {
    state: d.state,
    events: d.events,
    tick: d.state.tick,
    combatants: d.state.combatants,
    aiState: d.aiState,
    updateAiState: d.updateAiState,
    buffs: d.buffs,
    skills: d.skills,
    options: {
      ...(d.bossId === undefined ? {} : { bossId: d.bossId }),
      skills: d.skills,
    },
    current: d.current,
    replaceCombatant: d.replaceCombatant,
    opponentOf: d.opponentOf,
    applyEnrage: d.applyEnrage,
    runAbilities: (actorId, abilities) => runAbilities(d.abilitiesContext(), actorId, abilities),
    applyActions: d.applyActions,
  };
}
