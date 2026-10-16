/**
 * **把「恶魔低语」挂到这一场上**（2026-10-16）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 三个消费者要**同一份答案**：
 *   - `app/battleSetup.ts`   开战斗时真的挂上去
 *   - `app/phaseFlow.ts`     确认屏要显示"这一层是哪条"
 *   - 以后的日志 / 结算屏
 *
 * 而"哪一层抽到哪条"是**纯函数**（`core/run/whispers.ts`）—— 所以这里
 * 只做两件事：**把 RunState 翻译成一条低语**，以及**把那条低语挂成
 * 两个 Combatant 上的东西**。两件事都是纯的，都能单测。
 *
 * ⚠️ 不缓存：每次调用都重算（`RunState` 是活的对象，`position` 一场一变）。
 * 缓存会多一个"哪一份是真的"的真相源，而这点计算量可以忽略 ——
 * 与 `battleSeedOf` 每次现读同一条理由。
 */

import { applyBuff } from '../core/buffs';
import { whisperAt } from '../core/run/whispers';
import type { RunState } from '../core/run/index';
import { WHISPER_POOL, type WhisperDef } from '../data/whispers';
import type { Combatant } from '../core/types';

/** 这一层（`run.position`）抽到的低语；第 1 层恒为 `undefined`（纯净）。 */
export function whisperForRun(
  run: Pick<RunState, 'runSeed' | 'position' | 'order'>,
): WhisperDef | undefined {
  return whisperAt({
    pool: WHISPER_POOL,
    runSeed: run.runSeed,
    length: run.order.length,
    position: run.position,
  });
}

/**
 * 把这一层的低语挂到双方身上。
 *
 * ⚠️ **「狂暴」不在这里**：它没有 buff，而是"**不裁掉** Boss 自己那条
 * `enrage` 行为" —— 所以它由 `makeBoss(id, { enrage })` 处理（见
 * `data/units.ts` 的 `behaviorsForBattle`）。这里返回原样即可。
 */
export function whisperCombatants(args: {
  readonly player: Combatant;
  readonly boss: Combatant;
  readonly whisper: WhisperDef | undefined;
}): { readonly player: Combatant; readonly boss: Combatant } {
  const whisper = args.whisper;
  if (whisper === undefined) return { player: args.player, boss: args.boss };

  const apply = whisper.apply;
  if (apply.kind === 'bossBuff') {
    return { player: args.player, boss: withBuff(args.boss, apply.buff) };
  }
  if (apply.kind === 'playerBuff') {
    return { player: withBuff(args.player, apply.buff), boss: args.boss };
  }
  return { player: args.player, boss: args.boss };
}

/**
 * 开战前挂一条**常驻** buff（tick 0、来源是自己）。
 *
 * ⚠️ 走 `applyBuff` 而不是手拼 `BuffInstance`：`def` 要一起带上
 * （`aggregateFlags` / `computeStatsFor` 都读 `buff.def`），
 * 手拼一个"看起来对"的实例正是这类 bug 的来源。
 */
function withBuff(combatant: Combatant, buff: Parameters<typeof applyBuff>[1]): Combatant {
  return { ...combatant, buffs: applyBuff(combatant, buff, combatant.id, 0).buffs };
}
