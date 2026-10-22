/**
 * **消耗式护盾的扣层**（2026-10-22，黛玄的「盾」）。
 *
 * 从 `hitResolution.ts` 拆出来的（那个文件加完这一块到了 746 行 ✗，
 * AGENTS.md §3 的上限是 700 —— 按"先拆 util、不压注释"的规矩切一块出来）。
 *
 * ⚠️ 判据本身（"这一击要不要被盾吃掉"）仍在 `hitResolution` 里 ——
 * 它必须和 `unavoidable` / `invulnerable` / `guardBlocked` 挨着，才能一眼看懂
 * 四者的优先级。这里只负责**把层数减一**这一件机械的事。
 */

import type { Combatant } from '../types';

/**
 * 扣掉一层"消耗式护盾"（`BuffFlags.negateHits`）。
 *
 * 只减**提供它的那一条 buff** 的层数（第一条带 `negateHits` 的实例）；
 * 减到 0 就把这条 buff 摘掉 —— "盾 2 层"被两次命中打光后自然消失 ✓。
 *
 * ⚠️ **不修改入参**（返回新的 `buffs` 列表）：这个仓库的引擎状态更新一律
 * 走 `replaceCombatant`，就地改 `target.buffs` 会绕过事件与克隆语义。
 */
export function consumeNegateCharge(target: Combatant): {
  readonly buffs: Combatant['buffs'];
  /** 扣的是哪条 buff（`undefined` = 没有可扣的，调用方不该走到这里）。 */
  readonly buffId: string | undefined;
} {
  const index = target.buffs.findIndex((buff) => (buff.def?.flags?.negateHits ?? 0) > 0);
  const buff = target.buffs[index];
  if (buff === undefined) return { buffs: target.buffs, buffId: undefined };
  const buffs =
    buff.stacks > 1
      ? target.buffs.map((each, i) => (i === index ? { ...each, stacks: each.stacks - 1 } : each))
      : target.buffs.filter((_each, i) => i !== index);
  return { buffs, buffId: buff.defId };
}
