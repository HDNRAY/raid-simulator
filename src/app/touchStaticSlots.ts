/**
 * **触屏按钮的"额外槽位"**：把按钮上那些**没上技能栏**的技能补进快照。
 *
 * ==================================================================
 * 为什么需要它（2026-10-12 实测踩到）
 * ==================================================================
 *
 * 触屏按钮可以放**任何可选技能**，包括"没绑键、因此没上技能栏"的那些 ——
 * 那正是这次要解开的死结：以前没绑键的技能在触屏上根本没有按钮。
 *
 * 但按钮上的**字 / 代价 / 冷却**由 `TouchButtonLayer.update(view)` 从
 * `view.skills` 里按 `skillId` 查，而 `view.skills` 只包含**上了技能栏**的
 * 技能（`slotsFromBindings` 过滤掉空键）。于是新放上去的按钮是一个
 * **空圆**：实测截图里「斩」的那个圈是黑的，一个字都没有 ——
 * 看起来像坏了，而它其实按得动。
 *
 * 所以这里把它补进 `view.skills` 再交给按钮层。
 *
 * ⚠️ 补的那一份**不是**"静态近似"，而是 `BattleLoop.slotViewOf` 现造的
 * 真槽位（与技能栏同一条构造路径：冷却、资源够不够、代价、固有 CD）。
 * 复制一套近似值会漂成"按钮亮着、按下去没反应"—— 本仓库最忌讳的
 * 静默无效。
 *
 * ⚠️ 桌面技能栏**不会**因此多出格子：它的槽位来自绑定表，而本函数
 * 只把结果喂给触屏按钮层（`TouchButtonLayer`），不碰技能栏。
 */

import type { BattleSnapshotView, SkillSlotView } from '../render/viewModel';

/**
 * 把"按钮上有、快照里没有"的技能补进快照的 `skills` 里。
 *
 * @param needed 当前按钮上的技能 id（`TouchLayout.current()` 的顺序）
 * @param slotOf 现造一个槽位（`BattleLoop.slotViewOf`）；拿不到定义时返回
 *   `undefined` —— 那就保持空，与原来的行为一致
 *
 * ⚠️ **没缺就不新建对象**：这个函数每帧都会跑，全量复制 `skills` 数组会
 * 让每一帧都产生垃圾（而绝大多数帧什么都不缺）。
 */
export function withStaticSlots(
  view: BattleSnapshotView,
  needed: readonly string[],
  slotOf: (skillId: string, index: number) => SkillSlotView | undefined,
): BattleSnapshotView {
  const missing = needed.filter(
    (id) => id !== '' && !view.skills.some((slot) => slot.skillId === id),
  );
  if (missing.length === 0) return view;

  const extra: SkillSlotView[] = [];
  for (const [i, id] of missing.entries()) {
    const slot = slotOf(id, view.skills.length + i);
    if (slot !== undefined) extra.push(slot);
  }
  if (extra.length === 0) return view;
  return { ...view, skills: [...view.skills, ...extra] };
}
