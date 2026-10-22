/**
 * **主动技能在"读条完成"时移除 buff（可按层数减）** —— 2026-10-22 接上。
 *
 * ⚠️ 这一支原先**不存在**：`removeBuff` 只在 `runAi`（被动技能的能力数组）
 * 与 `triggers`（触发器）里有实现，而**主动技能的 `abilities`** 走
 * `castPipeline` 的那张分派表 ⇒ 写在那里会被**静默忽略** ✗
 * （黛玄的「冲」想"用掉一层窗口"就是撞上这个：类型合法、校验通过、行为没有）。
 *
 * ⚠️ 放在独立文件里而不是直接写进 `castPipeline` 的分派表：那个文件当时
 * **717 行**（AGENTS §3 的上限 700），而这一支自带一段"为什么需要它"的
 * 来历 —— 搬出去正好，注释跟着代码走。
 *
 * 语义与 `runAi` / `triggers` **逐字一致**（同一个 `reduceBuffStacks`）。
 */

import type { Combatant, EventDef } from '../types';
import { reduceBuffStacks } from './triggerContext';

export interface CastFinishRemoveBuffArgs {
  readonly tick: number;
  readonly target: Combatant;
  readonly buffId: string;
  readonly stacks: number | undefined;
  readonly actorId: string;
  readonly replace: (next: Combatant) => void;
  readonly push: (event: EventDef) => void;
}

export function castFinishRemoveBuff(args: CastFinishRemoveBuffArgs): void {
  const { target } = args;
  if (!target.buffs.some((b) => b.defId === args.buffId)) return;
  const { buffs, expired } = reduceBuffStacks(target.buffs, args.buffId, args.stacks);
  args.replace({ ...target, buffs });
  for (const id of expired) {
    args.push({
      kind: 'buffExpired',
      tick: args.tick,
      targetId: target.id,
      buffId: id,
      stacks: 0,
      sourceId: args.actorId,
    });
  }
}
