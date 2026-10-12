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
 *                     所以**技能栏的槽位顺序不变**。
 *   换位（「按键」页上改键时点另一格）—— 交换两个**位置**上的技能。
 *                     绑定表顺序变了，所以**技能栏槽位跟着变**。
 *
 * ==================================================================
 * ⚠️ 两者都**只动键位表**，不碰触屏按钮（2026-10-12）
 * ==================================================================
 *
 * 原先「换位」存在的理由是"触屏按钮顺序 = 绑定表里有键的技能的顺序"。
 * 用户推翻了那条派生（AGENTS.md §3b 的作废标注）：触屏按钮有自己的集合
 * 与自己的存储键，「触屏」页增删它。所以这里的两件事现在统属于
 * **键盘那一条线** —— 触屏按钮要走 `input/touchLayout.ts` 的
 * `toggleTouchButtonId`，不经过本文件。
 */

import { applyRebind, swapSlotSkills } from '../ui/settings/logic';
import type { KeyBinding } from '../input/keyboard';

/**
 * 键盘改键：把 `skillId` 绑到 `key`。
 *
 * ⚠️ **被顶掉的技能走"两位互换"，不是解绑。**
 *
 * 一个键只能绑一个技能，所以改键必然顶掉旧占用者（策略见
 * `applyRebind`）。但**解绑的代价是致命的**：没键的技能不上**技能栏**
 * （`slotsFromBindings` 只取 `key !== ''`），于是改一次键就**少一个格子**
 * —— 实测「避」这样消失后，倒地（`restrictToTags: ['dodge']`）
 * 就没有出路了。
 *
 * ⚠️ 这段理由原先写的是"触屏按钮会少一个"（`touchButtonsFromBindings`）。
 * 2026-10-12 之后触屏按钮**不再**由键位表派生（AGENTS.md §3b 的作废标注），
 * 所以换位的受益者只剩**技能栏** —— 结论不变，只是理由换了地方。
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

/**
 * 换位：交换两个按钮位上的技能（**键位表**的换位，见文件头）。
 *
 * ⚠️ 名字里的"slot"指**技能栏槽位**，不是触屏按钮位 —— 2026-10-12 之后
 * 触屏按钮不再来自这张表（那是被推翻的派生）。
 */
export function swapSlots(
  bindings: readonly KeyBinding[],
  from: number,
  to: number,
): readonly KeyBinding[] {
  return swapSlotSkills(bindings, from, to);
}
