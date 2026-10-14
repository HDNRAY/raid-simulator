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
  /**
   * 本次决策**读**的 AI 状态（只读入口）。
   *
   * ⚠️ 推进后的状态必须走 `updateAiState` 写回引擎 —— 见那里的说明。
   */
  readonly aiState: AiState;
  /**
   * 把推进后的 AI 状态**写回引擎**。
   *
   * ==================================================================
   * ⚠️ 为什么需要这个回调（这是一个真 bug 的修复）
   * ==================================================================
   *
   * 原先这里是 `aiState: AiState`，`runAi` 直接给它赋值
   * （`ctx.aiState = decision.nextState`）。但 `ctx` 是**每次调用新建的
   * 一个普通对象**（`battleState.aiContext()`），所以那次赋值只改了一个
   * 立刻被丢弃的对象 —— 引擎自己的 `this.aiState` **永远是空的**。
   *
   * 症状（改造「傲慢」时暴露）：`lastUsedAt` 恒为 `{}`，于是
   *   - `gapMs` 完全失效（每次决策都以为"这个技能从没用过"）
   *   - "同招不连发"的保底失效
   * Boss 因此按**冷却**而不是 `gapMs` 出招（实测 2 秒一刀，而不是 4 秒）。
   *
   * 旧 Boss 掩盖了它：它的顺序轮转每次都返回 `steps[0]` 或同一个
   * "第一个可用"的招，**与 `lastUsedAt` 无关**；`triggeredThresholds`
   * 与 `enraged` 也被内容里的其它条件兜住了。随机轮转把这个必然失败
   * 的写入路径照了出来。
   */
  updateAiState(next: AiState): void;
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

      /**
       * 移除一个 buff（按 `defId`）—— `onHpBelow.then` 里也能用。
       * ⚠️ 与 `triggers.ts` 的同名分支是同一条语义（清零 / 摘掉），
       * 两处都要实现：`runAi` 走的是"能力数组"，而触发器有自己的执行器。
       */
      if (ability.kind === 'removeBuff') {
        const targetId = targetIdOf(ability.target.mode);
        const target = ctx.current(targetId);
        if (target.buffs.some((b) => b.defId === ability.buffId)) {
          ctx.replaceCombatant({
            ...target,
            buffs: target.buffs.filter((b) => b.defId !== ability.buffId),
          });
          ctx.events.push({
            kind: 'buffExpired',
            tick: ctx.tick,
            targetId,
            buffId: ability.buffId,
            stacks: 0,
            sourceId: actorId,
          });
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
    /**
     * ⚠️ **必须写回引擎**，不能只改 `ctx`：`ctx` 每次调用都是新建的
     * 临时对象（见 `updateAiState` 的说明）。
     *
     * 写回时机放在"事件与动作都执行之前"：万一下游抛错，状态也已经
     * 记下了这次决策，不会出现"招放出去了、但没人记得放过"的错位。
     */
    ctx.updateAiState(decision.nextState);

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
