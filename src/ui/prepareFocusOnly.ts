/**
 * **只移动焦点**（白框）：把光标放到某一项上，**不改"已选"**（黄底）。
 *
 * 用户 2026-10-22："自由模式里 角色和 boss 的 hover 和选择又绑定在一起了 ···
 * 白框和黄底 都由 hover 决定了" ⇒ 悬停**只能动白框**；提交仍然是
 * `prepareLogic.pickOption` / `pickQiji`（点击 / `Enter` 才调）。
 *
 * ⚠️ 为什么单独一个文件：`prepareLogic.ts` 已经在 700 行上下（AGENTS §3），
 * 而这是自成一体的一个小函数（纯、可测），搬出来不影响那台状态机。
 */

import type { PrepareOption, PrepareSelection } from './prepareLogic';
import { withFocus } from './prepareLogic';

export function focusOnly(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  kind: 'player' | 'boss' | 'qiji',
  id: string,
): PrepareSelection {
  const list = kind === 'player' ? players : kind === 'boss' ? bosses : undefined;
  if (list !== undefined && !list.some((e) => e.id === id)) return sel;
  const cursor =
    kind === 'player'
      ? { ...sel.cursor, playerId: id }
      : kind === 'boss'
        ? { ...sel.cursor, bossId: id }
        : { ...sel.cursor, qijiId: id };
  if (cursor.playerId === sel.cursor.playerId
    && cursor.bossId === sel.cursor.bossId
    && cursor.qijiId === sel.cursor.qijiId
    && sel.focus === kind) {
    return sel;
  }
  return withFocus({ ...sel, cursor }, kind);
}

