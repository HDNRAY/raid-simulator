/**
 * **打断一个正在读条的技能** —— 唯一一份实现。
 *
 * 两个调用点：
 *   1. `hitResolution` 的 `interrupt` 效果（「破」「截」、Boss 的打断招）
 *   2. `triggerContext.dealDamageFromTrigger` 的 `interrupt` 效果
 *      （炁机「一击破势」："「击」命中时打断"）
 *
 * ⚠️ **为什么抽出来**：第 2 个调用点原先**只处理伤害**（`effect.kind !== 'damage'
 * → continue`），所以写在触发器 `deal` 里的 `interrupt` 会**静默无效** ✗ ——
 * 内容合法、校验通过、什么也不发生。把算法收成一份，两个入口就都对了。
 *
 * ⚠️ `onSuccess` 的链式结算仍留在 `hitResolution`（那是"命中管线"的职责）；
 * 这里只负责"该打断的都打断掉，并把事件发全"。
 */

import type { Combatant } from '../types';
import type { EventDef } from '../events';
import type { CastInstance } from '../types';
import { aggregateFlags } from '../buffs';

export interface InterruptArgs {
  readonly tick: number;
  /** 被打断的目标（读条在它身上）。 */
  readonly target: Combatant;
  /** 发起打断的人。 */
  readonly actorId: string;
  /** 打断者用的招式（没有就不写这个键）。 */
  readonly skillId?: string;
  /** `true` = 不看可打断性（「破」/「一击破势」的语义）。 */
  readonly force: boolean;
  readonly replace: (next: Combatant) => void;
  readonly push: (event: EventDef) => void;
}

/** @returns 真的打断到了吗（有读条被摘掉 = `true`） */
export function interruptCasts(args: InterruptArgs): boolean {
  const { target } = args;
  /**
   * **霸体（`interruptImmune`）拦截一切打断，包括强制打断。**
   *
   * 需求：所有 Boss 招式默认都能被打断 / 闪避 / 卸力，除非 Boss 处于霸体
   * 状态 —— 霸体由一个有 CD 的招式给自己挂上。
   *
   * 这里刻意**不看 `force`**：`force` 的语义是"无视技能的可打断标记"，
   * 但霸体是**更上层的状态**，它必须连强制打断也挡住。
   *
   * 踩过的坑：`BuffFlags.interruptImmune` 早就定义了、`aggregateFlags`
   * 也一直在算它，但**没有任何地方读它** —— 一个"看起来支持但实际不生效"
   * 的字段。接上它比新造一个 flag 好：语义更准，而且不用动数据模型。
   */
  if (aggregateFlags(target).interruptImmune) {
    args.push({
      kind: 'interruptImmune',
      tick: args.tick,
      targetId: target.id,
      skillId: target.casts[0]?.skillId ?? '',
    });
    return false;
  }

  if (target.casts.length === 0) return false;

  /**
   * `force: true` 时**不看可打断性**（「破」的语义：可以打断任何技能）。
   * 默认仍尊重目标技能的可打断性。
   */
  const interrupted = args.force
    ? [...target.casts]
    : target.casts.filter((c: CastInstance) => c.interruptible);
  if (interrupted.length === 0) return false;

  const interruptedIds = new Set(interrupted.map((c: CastInstance) => c.skillId));
  args.replace({
    ...target,
    casts: target.casts.filter((c: CastInstance) => !interruptedIds.has(c.skillId)),
  });
  for (const cast of interrupted) {
    args.push({
      kind: 'castInterrupted',
      tick: args.tick,
      sourceId: target.id,
      skillId: cast.skillId,
      reason: 'interrupted',
    });
    args.push({
      kind: 'interruptSuccess',
      tick: args.tick,
      sourceId: args.actorId,
      targetId: target.id,
      skillId: cast.skillId,
      ...(args.skillId === undefined ? {} : { sourceSkillId: args.skillId }),
    });
  }
  return true;
}
