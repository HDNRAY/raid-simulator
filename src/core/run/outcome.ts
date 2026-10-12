/**
 * 从事件流里取"这一场**打完了没有 / 谁赢了**"。
 *
 * ==================================================================
 * ⚠️ 为什么这是一个**单独的叶子文件**（而不是塞进 `stats.ts` 或 `query.ts`）
 * ==================================================================
 *
 * `Q-a` 把原来的 `stats.ts`（514 行）按职责拆成三块：
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | `stats.ts` | **归约**：`EventDef[]` → `BattleStats`，以及累加 |
 * | `query.ts` | **查询**：`BattleStatQuery` 的联合与求值（把查询翻译成数字） |
 * | `outcome.ts` | 这一场**打完了没有 / 谁赢了**（本文件） |
 *
 * 前两者**互相需要对方的类型**：`query.ts` 要 `BattleStats`（查询的目标），
 * 而 `stats.ts` 要 `BattleOutcomeRecord`（逐场结果的记录形状）。
 * 把它们放在两个文件里会形成 `stats → query → stats` 的**类型环** ——
 * `import type` 在编译期擦除、运行期没有环，所以技术上可行
 * （仓库里 `events.ts` 的反向 `import type` 是先例），但**读代码的人
 * 每次都要确认"这个环是安全的"**，而这个确认成本是无谓的。
 *
 * 所以把两边都要的那个**小**类型（`BattleOutcomeRecord`）与产生它的纯函数
 * 提到一个**谁都不依赖**的叶子里。于是依赖方向是单向的、可一眼看完的：
 *
 * ```text
 *   outcome.ts            （叶子：只 import EventDef）
 *      ↑            ↑
 *   stats.ts     query.ts   （兄弟：都不 import 对方）
 *      ↑            ↑
 *        unlock.ts / lifecycle.ts / record.ts
 * ```
 *
 * ⚠️ 这也是"**用一句话说清它是什么**"那条判据的直接产物：`outcome.ts`
 * 的一句话里没有"和"。
 */

import type { EventDef } from '../events';

/**
 * 一场战斗在整局统计里的记录。
 *
 * ⚠️ 它**同时**被两个方向消费：
 *   - `stats.ts` 的 `mergeBattleStats` 累加它（拼接）
 *   - `query.ts` 的 `battlesWon` / `flawlessBattles` 过滤它
 * 而 `RunRecord.battles`（`core/run/types.ts` 的记录形状）与它是
 * **同一个事实的两种描述** —— 由 `record.ts` 的 `parseRecordedRun`
 * 做长度 / 次序 / 胜负 / 满血的**对账**（见那里的说明）。
 */
export interface BattleOutcomeRecord {
  readonly won: boolean;
  readonly flawless: boolean;
}

/**
 * 这一场的结果。`undefined` = **还没打完**（没有 `encounterEnd` 事件）。
 *
 * ⚠️ 只认 `encounterEnd` 的 `result`，**不**看"谁的血先归零"之类的推演：
 * 引擎已经把判定做完了（超时 / 死亡 / 狂暴都由
 * `core/combat/encounterEnd.ts` 定），这里再推一遍就是**第二份判据**，
 * 而两份判据必然漂。
 */
export function outcomeOf(events: readonly EventDef[]): 'victory' | 'defeat' | undefined {
  for (const event of events) {
    if (event.kind === 'encounterEnd') return event.result;
  }
  return undefined;
}
