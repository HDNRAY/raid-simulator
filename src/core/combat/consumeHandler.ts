/**
 * **buff 消费的接线**：把"该消费谁"（`consume.ts` 的判定）落到战斗状态上。
 *
 * ==================================================================
 * 为什么单独一个文件（而不是写在 `battleState.ts` 的 tick 里）
 * ==================================================================
 *
 * `battleState.ts` 顶在 AGENTS.md §3 的 700 行上限上（它已经拆出
 * `castPipeline` / `hitResolution` / `stats` / `holds` / `runAi` /
 * `battleStateTypes` / `comboWindowHandler`）。本轮给 tick 加"消费"
 * 这一步时它到了 **746 行** —— 按那一条纪律（**先横向切割、不许压注释**），
 * 把这一整块切出来，而不是把注释删掉挤回上限。
 *
 * 切法与前一个先例 `comboWindowHandler.ts` 完全一致：
 *
 *   `buffs/consume.ts`（纯）   事件 + buff 定义 → 该不该消费、消费几层
 *   本文件（要引擎能力）       把结论写回战斗者 + 发事件
 *
 * ==================================================================
 * ⚠️ 空操作保证（这是黄金重放逐位不变的结构性理由）
 * ==================================================================
 *
 * 只有当某个战斗者身上的 buff **声明了 `consume`** 时才会走到 `applyConsume`。
 * 而"有没有声明"可以直接从 `def` 读（它随实例一起在状态里）——
 * 所以没有消费类 buff 的内容**一条分支都不进、一条事件都不产生**，
 * 连 `consumeFactsFor` 都不调（那一层是 O(事件数) 的扫描）。
 */

import { applyConsume, consumeFactsFor } from '../buffs';
import type { BuffDef, BuffInstance, Combatant, EventDef } from '../types';
import type { MutableCombatant } from './battleStateTypes';

/** 消费接线需要的引擎能力。 */
export interface ConsumeHandlerContext {
  /** 这一 tick 的工作副本单位（引擎的 `mutableAll()`）。 */
  readonly combatants: readonly MutableCombatant[];
  /** 当前 tick（写进事件；**也是"只看这一 tick 的事件"的判据**）。 */
  readonly tick: number;
  /** 事件出口（既读已发生的，也写消费产生的新事件）。 */
  readonly events: EventDef[];
  /** 内容注册表里的 buff 定义（`combatant.buffs[].def` 缺失时的兜底）。 */
  readonly buffs: ReadonlyMap<string, BuffDef>;
  /** 写回一个战斗者（引擎的 `replaceCombatant`）。 */
  replaceCombatant(updated: Combatant): void;
}

/**
 * **消费机制**：按每个 buff 自己的 `consume.on` 消费掉该消费的 buff。
 * 每 tick 调一次（引擎 tick 管线的第 2c 步）。
 *
 * 位置是**命中结算之后、自然过期之前**：
 *   - 在命中之后：判据是"这一 tick 真的打出来 / 挨到 / 闪掉 / 挡下了什么"，
 *     而那是 `resolveHit` 刚写进事件流的事实
 *   - 在过期之前：先消费掉就不必再判一次过期（消费完的实例已经不在
 *     列表里了），而且事件顺序读起来是"用掉了 → （若还有）没到点"
 *
 * ⚠️ 起点必须是**工作副本**（引擎的 `mutableAll()`）：这一 tick 内 `castPipeline` /
 * `hitResolution` 挂上的 buff 也在里面。读 `state` 会拿到 tick 开始前的
 * 那份 —— 那正是 `comboWindowHandler.ts` 记过的"挂上又立刻消失"的
 * 那个 bug 形状。
 *
 * @returns 真的被消费掉的 buff 实例数（便于测试与诊断）
 */
export function settleConsumableBuffs(ctx: ConsumeHandlerContext): number {
  let consumed = 0;

  for (const combatant of ctx.combatants) {
    /**
     * ⚠️ 先问"它身上有没有声明消费的 buff"，再算事实。
     *
     * 不这么写的话，每 tick 每个单位都要扫一遍事件流 —— 而绝大多数
     * 内容（含黄金夹具）**一个消费 buff 都没有**，那次扫描纯属浪费，
     * 也让"空操作"这件事从"读得出来"变成"要跑一遍才知道"。
     */
    if (!combatant.buffs.some((buff: BuffInstance) => buff.def?.consume !== undefined)) continue;

    const facts = consumeFactsFor(combatant, ctx.events, ctx.tick);
    const result = applyConsume(combatant, ctx.buffs, facts);
    if (result.expired.length === 0 && result.stackChanged.length === 0) continue;

    ctx.replaceCombatant({ ...combatant, buffs: result.buffs });
    consumed += result.expired.length;

    /**
     * ⚠️ 消费掉 = 发 `buffExpired`（与"到点过期"**同一个事件**）。
     *
     * 不为它新造事件类型：对 UI / 日志 / `onBuffExpired` 触发器来说，
     * "用掉了"与"到点了"都是"这个 buff 结束了" —— 而造第二种事件会让
     * 每一个消费者都要学会处理它（第一个漏掉的就是日志：词条会消失）。
     * "是这一条触发消耗的"由 `consume.on` 的声明本身表达，不需要运行期
     * 再记一份（那会是第二份真相）。
     */
    for (const buff of result.expired) {
      ctx.events.push({
        kind: 'buffExpired',
        tick: ctx.tick,
        targetId: combatant.id,
        buffId: buff.defId,
        stacks: 0,
        sourceId: combatant.id,
      });
    }
    /** 部分消费（`consume.stacks`）只是掉层，实例还在 → `buffStackChanged`。 */
    for (const buff of result.stackChanged) {
      ctx.events.push({
        kind: 'buffStackChanged',
        tick: ctx.tick,
        targetId: combatant.id,
        buffId: buff.defId,
        stacks: buff.stacks,
        sourceId: combatant.id,
      });
    }
  }

  return consumed;
}
