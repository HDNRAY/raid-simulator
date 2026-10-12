/**
 * **buff 钩子的派发**：把 `buffApplied` / `buffExpired` 事件变成
 * `onBuffApplied` / `onBuffExpired` 触发器。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 从 `battleState.ts` 横向切出来的（AGENTS.md §3 的 700 行上限）：
 * "buff 事件 → 钩子"是一块自成一体的逻辑，只依赖事件流与一个派发回调，
 * 不需要引擎的其它能力。它是**流程**，不是**状态**（状态只有游标一个整数，
 * 见 `BuffHookDispatch`）。
 *
 * ==================================================================
 * 为什么用"扫事件"而不是在每个挂 buff 的地方各调一次
 * ==================================================================
 *
 * 引擎里挂 / 摘 buff 的地方有近十处（`hitResolution` 的 grantBuff /
 * removeBuff / stun、`castPipeline` 的多个 grant 分支、`runAi` 的
 * `onHpBelow.then`、`triggerContext` 的触发器授予、`encounterLifecycle`
 * 的过期…）。逐处插一行"记得派发"的结果必然是**漏掉某一处**，而漏掉的
 * 表现又是静默的（那条链永远不触发）—— 正是这次要根除的病。
 *
 * `buffApplied` / `buffExpired` 事件是**所有**这些路径的共同产物，所以以
 * 事件为准：任何路径挂了 buff，钩子都会响，将来新增路径也不例外。
 *
 * ==================================================================
 * 为什么不会无限递归
 * ==================================================================
 *
 * 触发器可以再挂 buff（`grantBuffFromTrigger`）→ 又产生事件 → 又派发。
 * 内容是可能写出这种环的（"挂 A 时再挂 A"）。`triggers.ts` 的
 * `DEPTH_LIMIT` 管不到这里（每次派发的 `payload` 都是新的），所以本循环
 * 自带**硬上限**：够正常内容用，任何环都会被截断而不是卡死。
 *
 * ⚠️ 确定性：上限是固定常数、循环按事件顺序推进、不读时间 / 随机 ——
 * 与引擎的其它部分一样可逐位重放。
 */

import type { EventDef } from '../types';
import type { HitPayload } from './hitResolution';

/**
 * 一次 `drain` 最多处理多少个 buff 事件。
 *
 * 取 64 的理由：正常一 tick 的 buff 增删远小于它（一次施法几条），
 * 而"内容是环"时它保证**截断而不是卡死**。
 */
export const BUFF_HOOK_LIMIT = 64;

/** 本模块会派发的两个 hook。 */
export type BuffHookName = 'onBuffApplied' | 'onBuffExpired';

/** 派发回调：由引擎提供（它才知道怎么跑触发器）。 */
export type BuffHookSink = (
  ownerId: string,
  hook: BuffHookName,
  payload: HitPayload,
) => void;

/**
 * buff 钩子的派发器。
 *
 * ⚠️ 唯一的字段是**游标**：`events` 里已经处理到哪个位置。它必须跨 tick
 * 保持，并在事件数组被清空时 `reset()` —— 否则游标会指向已经不存在的下标。
 */
export class BuffHookDispatch {
  private cursor = 0;

  /** 事件数组被清空时调用（见 `BattleEngine.drainEvents`）。 */
  reset(): void {
    this.cursor = 0;
  }

  /**
   * 处理 `events` 里**尚未处理过**的 buff 事件。
   *
   * 回调可能往 `events` 里追加新事件（触发器又挂 buff），本循环会一并
   * 处理到上限为止 —— 所以"环"是被截断，不是被忽略。
   */
  drain(events: readonly EventDef[], sink: BuffHookSink): void {
    let processed = 0;
    while (this.cursor < events.length && processed < BUFF_HOOK_LIMIT) {
      const event = events[this.cursor];
      this.cursor += 1;
      processed += 1;
      if (event === undefined) continue;
      if (event.kind === 'buffApplied') {
        sink(event.targetId, 'onBuffApplied', { sourceId: event.sourceId });
      } else if (event.kind === 'buffExpired') {
        sink(event.targetId, 'onBuffExpired', { sourceId: event.sourceId });
      }
    }
  }
}
