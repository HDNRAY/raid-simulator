/**
 * 每个 tick 的**收尾流程**：buff 过期 → 资源回复 → 时限 → 死亡判定。
 *
 * ==================================================================
 * 为什么从 `battleState.ts` 里搬出来
 * ==================================================================
 *
 * `battleState.ts` 顶在 AGENTS.md §3 的 700 行上限上（加「傲慢」的
 * `aiRngSeed` 之后更紧）。这四步是**流程**而不是**状态**：它们读引擎的
 * 能力（当前战斗者、属性、事件缓冲），按固定顺序做四件事，自己不留字段。
 *
 * ⚠️ **不要**因为"看起来像四个函数"就把它们拆到不同文件：它们的
 * **顺序**是一个不变量（`battleState.ts` 顶部的 tick 管线注释），
 * 分开之后"谁先谁后"就没有单一位置可以读了。
 *
 * ⚠️ 事件**仍然由引擎持有**（`this.events` 是状态），这里只是把
 * "什么时候算过期、回复多少、算不算结束"借出去。
 */

import type { Combatant, EventDef } from '../types';
import { expireBuffs as expireBuffInstances } from '../buffs';
import type { MutableCombatant } from './battleStateTypes';
import { regenerate } from './index';
import { deathEvent, timeoutEvent } from './encounterEnd';

/** 收尾流程需要的能力。 */
export interface UpkeepContext {
  readonly tick: number;
  readonly startedAtTick: number;
  readonly timeLimitMs: number | undefined;
  readonly combatants: readonly Combatant[];
  /** 引擎当前 tick 的工作副本（`mutableAll()`） */
  mutableAll(): readonly MutableCombatant[];
  /** 引擎的 `replaceCombatant`（写回工作副本） */
  replaceCombatant(updated: Combatant): void;
  /** 引擎的 `statsOf` */
  statsOf(id: string): Readonly<Record<string, number>>;
  /** 引擎的事件缓冲（**可变**：流程要往里记事件） */
  readonly events: EventDef[];
  /** 把战斗结果写回引擎的 state（引擎负责那一次 `{...state}`） */
  end(result: 'victory' | 'defeat', reason: 'timeout' | 'hpZero'): void;
}

/** buff 到点过期 → 记 `buffExpired`。 */
export function expireBuffs(ctx: UpkeepContext): void {
  for (const combatant of ctx.mutableAll()) {
    const { buffs, expired } = expireBuffInstances(combatant.buffs, ctx.tick);
    if (expired.length === 0) continue;
    ctx.replaceCombatant({ ...combatant, buffs });
    for (const buffId of expired) {
      ctx.events.push({
        kind: 'buffExpired',
        tick: ctx.tick,
        targetId: combatant.id,
        buffId,
        stacks: 0,
        sourceId: combatant.id,
      });
    }
  }
}

/** 资源自然回复（炁 / 缠）。回复量由属性层决定，这里只做接线。 */
export function regenerateResources(ctx: UpkeepContext): void {
  for (const combatant of ctx.mutableAll()) {
    const result = regenerate(combatant, ctx.statsOf(combatant.id), ctx.tick);
    /**
     * ⚠️ 判据是"**状态变了**"（对象引用变了），**不是**"有事件"。
     *
     * 踩过的坑（2026-10-14，「懒惰」的"每秒回 1 点"）：生命回复的小数
     * **欠账**（`regenDebt`）在"还没攒够 1 个整点"时**一条事件都不产生**
     * —— 于是原来那句 `if (result.events.length > 0)` 会把欠账**整个丢掉**，
     * 表现为"`hpRegen` 写了但永远不回血"。
     *
     * `regenerate` 每次都会返回**新的对象**（即使只改了欠账），所以引用
     * 比较正好是"这一步它动过没有"的判据；没动时（没有回复来源）
     * `regenerate` 会原样返回入参，这里也就不会多写一次。
     */
    if (result.combatant !== combatant || result.events.length > 0) {
      ctx.replaceCombatant(result.combatant);
      ctx.events.push(...result.events);
    }
  }
}

/**
 * 时限到 → 判负。
 *
 * 返回是否结束，让调用点保持"先问、再改"的形状：没有超时就**不要**
 * 白白展开一次 `{...state}`。
 */
export function checkTimeLimit(ctx: UpkeepContext): boolean {
  const event = timeoutEvent({
    timeLimitMs: ctx.timeLimitMs,
    tick: ctx.tick,
    startedAtTick: ctx.startedAtTick,
  });
  if (event === undefined) return false;
  ctx.events.push(event);
  ctx.end('defeat', 'timeout');
  return true;
}

/** 有人死了 → 结算（谁死了决定胜负）。 */
export function checkDeaths(ctx: UpkeepContext): boolean {
  const event = deathEvent(ctx.combatants, ctx.tick);
  if (event === undefined) return false;
  ctx.events.push(event);
  ctx.end(event.result, 'hpZero');
  return true;
}
