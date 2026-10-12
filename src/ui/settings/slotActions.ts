/**
 * 触屏键位的**两步交互判定**（纯函数）—— 点/按一个技能时该做什么。
 *
 * ==================================================================
 * 交互（用户 2026-10-12 定案）
 * ==================================================================
 *
 * 用户原话："点键位 =》 点技能 =》 绑定这个技能到这个键位"。
 *
 * ```
 * ① 点一个键位（右下角的模拟键位）→ 它进入"选中"状态
 * ② 点一个技能                      → 绑到这个键位
 * ```
 *
 * 三条细分规则（都在这里判，**鼠标与键盘共用同一份**）：
 *
 *   | 情况 | 结果 |
 *   |---|---|
 *   | 技能**已经在别的键位** | 两个键位**交换**（谁都不消失） |
 *   | 键位上有别的技能 | 那个技能被**顶掉**（它不再是触屏按钮） |
 *   | 技能**已经在这个键位** | **取下**它（`clearTouchSlot`）—— 见下 |
 *   | 再点一次已选中的键位 | **取消选中**（`resolveSlotTap`） |
 *
 * ⚠️ **"清空某个键位"为什么是这样定的**：它是唯一不需要新 UI 的写法 ——
 * "把 A 绑到已经放着 A 的键位"本身是**空操作**，所以那个空操作可以
 * 拿来表达"取下"。于是触屏（手指）与键盘（方向键 + Enter）走的是
 * **同一句操作**，不必再加一个「清空」按钮（面板右下角已经没有地方了，
 * 而多一个按钮就多一条只有鼠标能走的路）。
 *
 * ⚠️ 判定放在这里而不是 `panelDispatch` / `SettingsPanel` 里各写一遍：
 * 两处各写一遍必然漂成"鼠标能换位、键盘只能顶掉"这类不一致，
 * 而那种不一致在截图上看不出来。
 */

/** 点了某个键位（或在键位区按 Enter）之后：选中它 / 取消选中。 */
export type SlotTapAction =
  | { readonly kind: 'selectSlot'; readonly index: number }
  | { readonly kind: 'deselectSlot' };

/** 在键位已选中的前提下，激活一个技能：绑上去，或（它本来就在那儿）取下。 */
export type SlotBindAction =
  | { readonly kind: 'assignTouchSlot'; readonly slot: number; readonly skillId: string }
  | { readonly kind: 'clearTouchSlot'; readonly slot: number };

/**
 * 点一个键位。
 *
 * ⚠️ **再点一次已选中的键位 = 取消选中**（而不是清空它）：
 * 手指在预览上误触时不该丢东西；"清空"由"点它已有的技能"表达
 * （见 `resolveSlotBind`），那是一个更明确的操作。
 */
export function resolveSlotTap(
  selectedSlot: number | undefined,
  index: number,
): SlotTapAction {
  return selectedSlot === index ? { kind: 'deselectSlot' } : { kind: 'selectSlot', index };
}

/**
 * 把 `skillId` 绑到 `slot`。
 *
 * ⚠️ **它已经在这个键位上 → 取下**（这是"清空某个键位"的唯一入口）。
 */
export function resolveSlotBind(
  slot: number,
  slotSkillIds: readonly string[],
  skillId: string,
): SlotBindAction {
  const occupant = slotSkillIds[slot] ?? '';
  return occupant === skillId
    ? { kind: 'clearTouchSlot', slot }
    : { kind: 'assignTouchSlot', slot, skillId };
}
