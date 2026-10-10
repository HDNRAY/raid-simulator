/**
 * **战斗结束的判定**：超时 / 死亡。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 两者都是"读当前状态 → 可能写入结束状态与事件"的纯逻辑，与战斗状态机的
 * 其余部分没有交集（不碰工作副本、不碰 buff、不碰结算）。抽出来之后
 * `battleState.ts` 少两块，而"什么情况算打完"这条规则集中在一处。
 *
 * ⚠️ 都以 `Combatant` / `EventDef` 为参数，**不依赖引擎实例** —— 所以
 * 不引入任何新的桥接代码（这正是它比"抽 buff 过期"更划算的原因：
 * 后者要 `mutableAll` / `replaceCombatant` 一堆转发）。
 */

import type { Combatant, EncounterEndEvent } from '../types';

/** 超时判定要用的时间刻度（逻辑步 0.1s = 6 tick）。 */
const MS_PER_TICK = 1000 / 60;

export interface TimeLimitInput {
  readonly timeLimitMs: number | undefined;
  readonly tick: number;
  readonly startedAtTick: number;
}

/**
 * 超时了吗？（`timeLimitMs` 未设置时**永不超时**）
 *
 * @returns 结束事件；`undefined` 表示还没到
 */
export function timeoutEvent(input: TimeLimitInput): EncounterEndEvent | undefined {
  const { timeLimitMs, tick, startedAtTick } = input;
  if (timeLimitMs === undefined) return undefined;
  if ((tick - startedAtTick) * MS_PER_TICK < timeLimitMs) return undefined;
  return { kind: 'encounterEnd', tick, result: 'defeat', reason: 'timeout' };
}

/**
 * 有单位死亡吗？
 *
 * ⚠️ 双方同时死亡时判**失败**（玩家先倒下）：`playerDead` 优先。
 * 这条不写清楚会让"同归于尽"的结果取决于数组顺序。
 *
 * @returns 结束事件；`undefined` 表示双方都还活着
 */
export function deathEvent(
  combatants: readonly Combatant[],
  tick: number,
): EncounterEndEvent | undefined {
  const dead = combatants.filter((c) => !c.alive);
  if (dead.length === 0) return undefined;
  const playerDead = dead.some((c) => c.side === 'ally');
  const bossDead = dead.some((c) => c.side === 'enemy');
  if (!playerDead && !bossDead) return undefined;
  return {
    kind: 'encounterEnd',
    tick,
    result: playerDead ? 'defeat' : 'victory',
    reason: 'hpZero',
  };
}
