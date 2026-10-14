/**
 * **一 tick 收尾的后半段**：buff 过期 → 资源回复 → 按住消耗 → buff 钩子派发。
 *
 * ==================================================================
 * 这个文件是什么（一句话）
 * ==================================================================
 *
 * 它按固定顺序把"这一 tick 结束前必须做的事"跑完 —— 自己**不留任何状态**，
 * 状态由引擎通过 `RunUpkeepContext` 借给它（与 `encounterLifecycle.ts` 的
 * 同名说明同一条：状态永远只有一个写入者）。
 *
 * ==================================================================
 * 为什么单独一个文件（横向切割，不是压注释）
 * ==================================================================
 *
 * 本轮加"buff 消费机制"时 `battleState.ts` 到了 **746 行**，超过 AGENTS.md §3
 * 的 700 行。按那一条纪律（**先拆 util / 横向切割，不许删注释**），
 * 把"每个 tick 的收尾"这一整块切出来：
 *
 *   `encounterLifecycle.ts`  过期 / 回复 / 时限 / 死亡（第 3-4、6 步）
 *   本文件                    收尾的顺序与入口（第 3-5c 步）
 *   `consumeHandler.ts`       消费（第 2c 步，它读事件、要趁事件还新鲜）
 *
 * ⚠️ 三者都属于"tick 的收尾流程"，共同的不变量是**顺序**。顺序写在
 * `runUpkeep` 里（那一个入口按序调用），而不是散在引擎的方法定义顺序里 ——
 * 后者读起来像"碰巧这样排"，前者是"这里就是判据"。
 */

import { expireBuffs, regenerateResources, type UpkeepContext } from './encounterLifecycle';
import { tickHolds, type HoldsContext } from './holds';
import type { BuffHookDispatch, BuffHookName } from './buffHookDispatch';
import type { HitPayload } from './hitResolution';
import type { EventDef } from '../types';

/** 收尾流程需要的引擎能力。 */
export interface RunUpkeepContext extends UpkeepContext {
  /** 按住型技能的持续消耗（`battleState.holds()`）。 */
  readonly holds: HoldsContext;
  /** buff 钩子派发器（引擎持有，游标是它的状态）。 */
  readonly buffHooks: BuffHookDispatch;
  /**
   * 把一次 buff 钩子交给触发器引擎。
   *
   * ⚠️ 由引擎注入而不是在这里 import 触发器引擎：跑触发器需要
   * `HitResolutionContext`（一份更宽的能力），而这个模块只该知道
   * "有一个 hook 要派发"。注入也让引擎每次现取 ctx（避免把工作副本 /
   * 事件数组钉在一个长期引用上）。
   */
  onBuffHook(ownerId: string, hook: BuffHookName, payload: HitPayload): void;
  /**
   * 把一次 `onTick` 钩子交给触发器引擎（每个**活着**的战斗者一次）。
   *
   * ⚠️ 为什么需要它：「贪婪」的「弱点」被动是**按时间**来的
   * （"随机 3–5 秒一次"），而不是"挨打时"。没有这个钩子就只能挂在
   * `onHitTaken` 上 —— 那会让节拍取决于玩家打得多快，而不是时钟。
   *
   * ⚠️ 触发器的间隔由它自己的 `cooldownMs` / `cooldownRangeMs` 管，
   * 所以这里**每逻辑步**都调是安全的（没到点的那一步什么都不做）。
   */
  onTick(ownerId: string): void;
}

/**
 * **tick 收尾**：按固定顺序跑完四件事。
 *
 * ==================================================================
 * 顺序是不变量（改了会改变战斗结果，黄金重放会立刻发现）
 * ==================================================================
 *
 *   1. `expireBuffs`        到点的 buff 先消失（于是下面的钩子能看到"结束"）
 *   2. `regenerateResources` 资源自然回复（每逻辑步一次）
 *   3. `tickHolds`          按住型的持续消耗（每逻辑步一次）
 *   4. `dispatchBuffHooks`  把本 tick 的 buff 增删事件派发成触发器
 *
 * 第 4 步必须**在 `commitWork` 之前**：触发器会挂 buff / 改资源，那些改动
 * 也要随工作副本一起提交，否则就是"事件发了但状态没变"（引擎里踩过 5 次
 * 的那个 bug 类）。
 *
 * ⚠️ 消费（第 2c 步）**不在**这里：它读的是"这一 tick 打出来 / 挨到 /
 * 闪掉 / 挡下了什么"，而那是命中结算刚落下的证据 —— 早于自然过期、
 * 也早于资源回复，所以它由引擎在 `advanceCasts` 之后直接调
 * `settleConsumableBuffs`（见 `consumeHandler.ts`）。
 */
export function runUpkeep(ctx: RunUpkeepContext, events: readonly EventDef[]): void {
  expireBuffs(ctx);
  regenerateResources(ctx);
  tickHolds(ctx.holds);
  ctx.buffHooks.drain(events, (ownerId, hook, payload) => {
    ctx.onBuffHook(ownerId, hook, payload);
  });

  /**
   * 第 5 步：`onTick`（按时间来的触发器）。
   *
   * ⚠️ 顺序放在 buff 钩子**之后**：先让"这个 buff 过期了 / 挂上了"派发完，
   * 再问"有谁按时间要出手"。反过来会让同一 tick 里刚过期的触发器和
   * tick 钩子抢同一份状态。
   *
   * ⚠️ 只遍历**活着**的人：死亡之后还触发会产出"死人打我"的事件
   * （`alive` 是引擎裁决战斗结束的判据，不该被绕过）。
   */
  for (const combatant of ctx.combatants) {
    if (!combatant.alive) continue;
    ctx.onTick(combatant.id);
  }
}
