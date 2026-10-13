/**
 * **派生窗口的结算**：判定（`./comboWindow.ts`）+ 改状态（本文件）。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.2（炁机接回派生）。
 *
 * ==================================================================
 * 为什么单独一个文件（而不是住在 `battleState.ts` 里）
 * ==================================================================
 *
 * `battleState.ts` 顶在 AGENTS.md §3 的 700 行上限上（它已经拆出
 * `castPipeline` / `hitResolution` / `stats` / `holds` / `runAi` /
 * `battleStateTypes`）。本轮加"接回派生"又要在 tick 里插一段 ——
 * 按那一条纪律，**先横向切割、不许压注释**。
 *
 * 切出来的这一块是一个完整的小职责："这一 tick 该开哪个窗口、怎么挂上去"。
 * 它与 `comboWindow.ts` 的分工是：
 *
 *   `comboWindow.ts`         纯判定：事件 → 要挂哪些 buff（可在 node 里单测）
 *   `comboWindowHandler.ts`  改状态：把那些 buff 真的挂到玩家身上（要引擎能力）
 *
 * ==================================================================
 * ⚠️ 它是空操作，除非这一局带了炁机
 * ==================================================================
 *
 * `windows` 为 `undefined` / 空数组时**立刻返回**，一条事件都不产生。
 * 单场 / 自由模式 / 黄金重放都不传 `comboWindows`，所以那些路径
 * **逐位不变**（"默认没有炁机"这条硬验收的落点）。
 */

import { applyBuff } from '../buffs';
import { comboWindowsFor } from './comboWindow';
import type { BuffDef, Combatant, EventDef } from '../types';
import type { ComboWindowSpec } from './comboWindow';
import type { MutableCombatant } from './battleStateTypes';

/**
 * 结算窗口需要的引擎能力。
 *
 * ⚠️ `current` 必须是**工作副本感知**的那个（tick 内的改动都还在 work 上）：
 * 读 `state` 会拿到这一 tick 开始前的那份 —— 那正是 `castPipeline` 里
 * "挂上 buff 又立刻消失"那个 bug 的形状。
 */
export interface ComboWindowHandlerContext {
  /** 这一局生效的窗口产出者（来自 `CreateBattleOptions.comboWindows`）。 */
  readonly windows: readonly ComboWindowSpec[] | undefined;
  /** 全部战斗者（用来找"我方"）。 */
  readonly combatants: readonly Combatant[];
  /** 当前 tick（写进 `buffApplied` 与 buff 的起算时刻）。 */
  readonly tick: number;
  /** 内容注册表里的 buff 定义。 */
  readonly buffs: ReadonlyMap<string, BuffDef>;
  /** 事件出口。 */
  readonly events: EventDef[];
  /** 取工作副本感知的战斗者。 */
  current(id: string): MutableCombatant;
  /** 写回一个战斗者。 */
  replaceCombatant(updated: Combatant): void;
}

/**
 * **这一 tick 的派生窗口结算**。每 tick 调一次（引擎的 tick 管线第 2b 步）。
 *
 * 顺序是刻意的：
 *   1. **找我方**（`side === 'ally'`）—— 窗口是给玩家用的，而事件流里
 *      既可能有玩家打断 Boss、也可能有 Boss 打断玩家。判据与
 *      `stats.ts` 的 `BattleStatsScope.actorId` 取"我方视角"是同一条。
 *   2. **判定**（`applyComboWindows` → `comboWindowsFor`，纯函数）
 *   3. **挂**（`applyBuff` + 写回 + `buffApplied` 事件）
 *
 * ⚠️ buff id 解析不到时 `applyComboWindows` **跳过**（不抛错）：
 * 它跑在每 tick 的热路径上，而"窗口没开"会由"派生技按不出来"表现出来 ——
 * 真正该报的错在内容校验 / 装配层（那时才有人能读报错）。
 *
 * @returns 实际开了几个（便于测试与诊断）
 */
export function settleComboWindows(ctx: ComboWindowHandlerContext): number {
  if (ctx.windows === undefined || ctx.windows.length === 0) return 0;
  const ally = ctx.combatants.find((c) => c.side === 'ally');
  if (ally === undefined) return 0;

  const opened = comboWindowsFor(ctx.events, ctx.windows);
  let count = 0;
  for (const buffId of opened) {
    if (ctx.buffs.get(buffId) === undefined) continue;
    grantBuff(ctx, ally.id, buffId);
    count += 1;
  }
  return count;
}

/** 挂一个 buff：`applyBuff` 算新的 buff 列表 → 写回 → 发 `buffApplied`。 */
function grantBuff(
  ctx: ComboWindowHandlerContext,
  targetId: string,
  buffId: string,
): void {
  const def = ctx.buffs.get(buffId);
  if (def === undefined) return;
  const target = ctx.current(targetId);
  const applied = applyBuff(target, def, targetId, ctx.tick);
  ctx.replaceCombatant({ ...target, buffs: applied.buffs });
  ctx.events.push({
    kind: 'buffApplied',
    tick: ctx.tick,
    targetId,
    buffId,
    stacks: applied.stacks,
    sourceId: targetId,
  });
}
