/**
 * **键位表的变更操作**（改键 / 换位）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这两件事原先内联在 `main.ts` 的 `onRebind` 里，而触屏又要一条
 * "换位置"的路 —— 两处逻辑、两个文件（`main.ts` 与 `SettingsPanel.ts`）
 * 都贴着 700 行上限。抽出来之后：
 *   - `main.ts` 只剩一行接线
 *   - `SettingsPanel` 不用知道"键位表怎么变"，只负责发指令
 *   - 两个函数都是**纯函数**，可以单独测
 *
 * ==================================================================
 * ⚠️ 「改键」与「换位」是两件事，别混
 * ==================================================================
 *
 *   改键（键盘用）  —— 把技能 X 绑到键 k。**不改变绑定表顺序**，
 *                     所以**触屏按钮顺序不变**。
 *   换位（触屏用）  —— 交换两个**位置**上的技能。绑定表顺序变了，
 *                     所以**按钮顺序跟着变**。这才是"选 slot 再选技能
 *                     换 slot"要的效果。
 */

import { applyRebind, swapSlotSkills } from '../ui/settings/logic';
import type { KeyBinding } from '../input/keyboard';

/**
 * 键盘改键：把 `skillId` 绑到 `key`。
 *
 * ⚠️ **被顶掉的技能走"两位互换"，不是解绑。**
 *
 * 一个键只能绑一个技能，所以改键必然顶掉旧占用者（策略见
 * `applyRebind`）。但**解绑的代价在触屏上是致命的**：没键的技能不出现在
 * 触屏按钮上（`touchButtonsFromBindings` 只取 `key !== ''`），于是改一次
 * 键就**少一个按钮** —— 实测「避」这样消失后，倒地
 * （`restrictToTags: ['dodge']`）就没有出路了。
 *
 * 所以：X 拿走 k，原来的占用者拿到 X 的旧键。
 */
export function rebindWithSwap(
  bindings: readonly KeyBinding[],
  skillId: string,
  key: string,
): readonly KeyBinding[] {
  const first = applyRebind(bindings, skillId, key);
  const previousKey = bindings.find((b) => b.skillId === skillId)?.key;
  const victim = first.unbound === undefined ? undefined : bindings.find((b) => b.key === key);
  if (victim === undefined || previousKey === undefined || previousKey === '') {
    return first.bindings;
  }
  return applyRebind(first.bindings, victim.skillId, previousKey).bindings;
}

/** 触屏换位：交换两个按钮位上的技能。 */
export function swapSlots(
  bindings: readonly KeyBinding[],
  from: number,
  to: number,
): readonly KeyBinding[] {
  return swapSlotSkills(bindings, from, to);
}
