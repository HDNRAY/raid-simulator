/**
 * AI 轮转 + 能力的通用执行器。
 *
 * ==================================================================
 * 为什么从 `battleState.ts` 里搬出来
 * ==================================================================
 *
 * `battleState.ts` 超过 700 行（AGENTS.md §3）。这两块约 105 行，
 * 是**决策**而不是**状态**：
 *
 *   runAi         问 AI 该出什么招，然后把它当普通输入走 `applyActions`
 *   runAbilities  按数据驱动执行 `Ability[]`（新增一种阶段效果
 *                 不需要改引擎 —— 这是"内容优先"的落点）
 *
 * ⚠️ `aiState`（已用过的 opener、各技能上次施放 tick、阶段、狂暴）
 * **仍然是引擎的字段**：它必须随战斗一起持久、可重放。这里只是把
 * "怎么决策"借出去。
 */

import type { Ability, Combatant, EventDef, SkillDef } from '../types';
import { decide, type AiState, type AiView } from '../ai';
import { changeResource } from './index';
import { applyBuff } from '../buffs';

/** AI 决策需要的引擎能力。 */
export interface AiContext {
  readonly state: {
    readonly tick: number;
    readonly startedAtTick: number;
    readonly combatants: readonly Combatant[];
  };
  readonly events: EventDef[];
  readonly tick: number;
  readonly combatants: readonly Combatant[];
  /** ⚠️ 可变：AI 要记住"已经用过的 opener / 各技能上次施放 tick" */
  aiState: AiState;
  readonly options: {
    readonly bossId?: string;
    readonly skills: ReadonlyMap<string, SkillDef>;
  };
  /** 把 AI 选出的技能当**普通输入**执行（可重放的关键） */
  applyActions(actions: readonly import('../types').Action[], actorId?: string): void;
  readonly buffs: ReadonlyMap<string, import('../types').BuffDef>;
  readonly skills: ReadonlyMap<string, SkillDef>;
  current(id: string): Combatant;
  replaceCombatant(updated: Combatant): void;
  opponentOf(id: string): Combatant | undefined;
  applyEnrage(boss: Combatant): void;
  /** ⚠️ `runAi` 要执行内容声明的能力（`onHpBelow` 的 then） */
  runAbilities: (actorId: string, abilities: readonly Ability[]) => void;
}

/** 能力执行器需要的引擎能力。 */
export interface AbilitiesContext {
  readonly tick: number;
  /** 全部战斗者（`runAbilities` 要按 id 遍历） */
  readonly combatants: readonly Combatant[];
  readonly buffs: ReadonlyMap<string, import('../types').BuffDef>;
  readonly skills: ReadonlyMap<string, SkillDef>;
  readonly events: EventDef[];
  current(id: string): Combatant;
  replaceCombatant(updated: Combatant): void;
  opponentOf(id: string): Combatant | undefined;
}

  /**
   * 执行一串能力（`onHpBelow.then` 用）。
   *
   * 这是"内容组合能力"的入口：`grant` / `modifier` / `resource` 全部走
   * 既有实现，所以**新增一种阶段效果不需要改引擎**。
   */
export function runAbilities(
  ctx: AbilitiesContext,
  actorId: string,
  abilities: readonly Ability[],
): void {
    for (const ability of abilities) {
      const actor = ctx.current(actorId);
      if (!actor) return;
      const opponent = ctx.opponentOf(actorId);
      const targetIdOf = (mode: string): string =>
        mode === 'self' ? actorId : (opponent?.id ?? actorId);

      if (ability.kind === 'grant') {
        const targetId = targetIdOf(ability.target.mode);
        const target = ctx.current(targetId);
        const applied = applyBuff(target, ability.buff, actorId, ctx.tick);
        ctx.replaceCombatant({ ...target, buffs: applied.buffs });
        ctx.events.push({
          kind: 'buffApplied',
          tick: ctx.tick,
          targetId,
          buffId: ability.buff.id,
          stacks: applied.stacks,
          sourceId: actorId,
        });
        continue;
      }

      if (ability.kind === 'resource') {
        const delta = typeof ability.delta === 'number' ? ability.delta : 0;
        if (delta !== 0) {
          const targetId = targetIdOf(ability.target.mode);
          const result = changeResource(
            ctx.current(targetId),
            ability.resource,
            delta,
            ctx.tick,
          );
          ctx.replaceCombatant(result.combatant);
          ctx.events.push(...result.events);
        }
        continue;
      }

      if (ability.kind === 'trigger') {
        // onHpBelow 里嵌 trigger 没有明确语义，直接执行它的 then
        for (const then of ability.trigger.then) runAbilities(ctx, actorId, [then]);
      }
    }
  }

  /**
   * 让 AI 决策并应用它的动作。
   *
   * 位置很关键：在"玩家动作生效"之后、"读条推进"之前 ——
   * 于是 Boss 的动作也享受**同一套**门禁与消耗，
   * 而不是绕过引擎直接改状态。
   */
export function runAi(
  ctx: AiContext,
): void {
    const bossId = ctx.options.bossId;
    if (!bossId) return;
    /**
     * ⚠️ **必须从工作副本读**，不能读 `ctx.state.combatants`。
     *
     * 引擎在 `beginWork()` **之后**才调用 `runAi()`，而且同一个 tick 里
     * 玩家的动作已经写进了工作副本（`replaceCombatant`）。
     * 读 state 会拿到**上一 tick 的冷却**，于是 AI 以为技能好了、
     * 真的去放，却被闸门按当前副本挡下 —— 表现为
     * 「Boss 明明在冷却、却反复尝试并刷出『冷却中』」。
     *
     * `ctx.current()` 是 work-aware 的（先查工作副本、没有才回落
     * state），与闸门读的是同一份数据。
     */
    const self = ctx.current(bossId);
    if (!self.alive) return;
    const opponent = ctx.opponentOf(bossId);
    if (!opponent) return;

    const view: AiView = {
      self,
      opponent,
      tick: ctx.state.tick,
      elapsedMs: (ctx.state.tick - ctx.state.startedAtTick) * (1000 / 60),
      skillOf: (id: string) => ctx.options.skills.get(id),
      isReady: (id: string) => (self.cooldowns[id] ?? 0) <= ctx.state.tick,
      canAct: self.casts.length === 0,
    };

    const decision = decide(view, self.behaviors, ctx.aiState);
    ctx.aiState = decision.nextState;

    /**
     * AI 层事件 → 实际效果。
     *
     * 只有两种，都是"执行一串能力/挂一个 buff"，
     * **没有"阶段"这类引擎概念**。
     */
    for (const event of decision.events) {
      if (event.kind === 'thresholdReached') {
        // 血量阈值被跨过：执行内容声明的能力（通常是授予阶段 buff）
        runAbilities(ctx, bossId, event.abilities);
        ctx.events.push({
          kind: 'behaviorTriggered',
          tick: ctx.state.tick,
          bossId,
          kindName: `onHpBelow#${event.index}`,
        });
      } else {
        ctx.applyEnrage(self);
      }
    }

    if (decision.actions.length > 0) ctx.applyActions(decision.actions, bossId);
  }
