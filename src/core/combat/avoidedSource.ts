/**
 * `avoided` 事件的**"是谁挡下的"** —— 判定侧的小工具（纯函数）。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.2（炁机接回派生）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `hitResolution.ts` 顶在 AGENTS.md §3 的 700 行上限上（它已经拆出
 * `castPipeline` / `damage` / `stats` 等）。本轮要给 `avoided` 事件补一个
 * `viaBuffId`（炁机靠它区分"这次是「卸」挡的还是「闪」挡的"）——
 * 按那一条纪律：**先横向切割、不许压注释**。
 *
 * 切出来的这一块是一个完整的小职责，而且它**不需要任何引擎能力**：
 * 输入是"挨打者的 buff 列表 + 一次 applyDamage 的事件"，输出是
 * "哪个 buff + 补好字段的事件数组"。所以它能直接单测。
 *
 * ==================================================================
 * ⚠️ `viaBuffId` 是**观测字段**，不参与判定
 * ==================================================================
 *
 * 挡没挡住是 `hitResolution` 里早就定好的（`invulnerable` / 阈值），
 * 本文件只回答"是哪**一个** buff"。所以它不动确定性语义、
 * 不动 `REPLAY_FORMAT_VERSION`（与 `interruptSuccess.sourceSkillId`
 * 同一条纪律，见 §7.2）。
 */

import type { BuffInstance, Combatant, EventDef } from '../types';

/**
 * **是哪个 buff 挡下了这一击**。
 *
 * 两个来源与 `avoided` 的判据一一对应：
 *   - `invulnerable`：取**第一个**挂着的。无敌是布尔量（多个之间没有强弱），
 *     而"哪一个"只用来区分「闪」与「避」—— 它们属于不同角色、
 *     不会同时挂在同一个人身上。
 *   - `damageThreshold`：取**最大**的那个。`aggregateFlags` 取最大值，
 *     判据必须同源，否则"谁挡的"会指向一个阈值更低的 buff。
 *
 * 找不到就返回 `undefined`（事件里那个键不写）—— 与
 * `interruptSuccess.sourceSkillId` 同一条约定：`''` 会与"id 恰好是空串"
 * 混淆，所以宁可缺键。
 */
export function blockBuffIdOf(target: Combatant): string | undefined {
  const buffs: readonly BuffInstance[] = target.buffs;

  const invulnerable = buffs.find((b) => b.def?.flags?.invulnerable === true);
  if (invulnerable !== undefined) return invulnerable.defId;

  let best: BuffInstance | undefined;
  let bestThreshold = Number.NEGATIVE_INFINITY;
  for (const buff of buffs) {
    const threshold = buff.def?.flags?.damageThreshold;
    if (threshold === undefined) continue;
    if (threshold > bestThreshold) {
      best = buff;
      bestThreshold = threshold;
    }
  }
  return best?.defId;
}

/**
 * 给 `applyDamage` 产出的 `avoided` 事件补上 `viaBuffId`。
 *
 * ⚠️ 为什么是"事后补"而不是"传参进去"：`applyDamage` 是**通用**的伤害结算
 * （触发器反伤 / DoT 都走它），它不该知道"谁挡下的"—— 那是命中判定
 * （`hitResolution`）的知识。补的动作只碰 `avoided` 一种事件，别的原样返回。
 *
 * ⚠️ 返回**新数组**（不改入参）：`applyDamage` 的返回值可能被调用方留着
 * （`applied.combatant` 就来自同一个对象）。
 */
export function withViaBuffId(
  events: readonly EventDef[],
  viaBuffId: string | undefined,
): readonly EventDef[] {
  if (viaBuffId === undefined) return events;
  return events.map((event) => (event.kind === 'avoided' ? { ...event, viaBuffId } : event));
}
