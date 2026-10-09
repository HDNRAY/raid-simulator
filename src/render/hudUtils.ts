/**
 * HUD 的共享小工具。
 *
 * 抽出来的原因：多个**帧部件**都要它们（顶栏要 `formatClockSafe`、
 * 玩家面板要 `display`、Boss 血条要 `percentOf`）。如果这些函数留在
 * `BattleScene.ts`，部件就会反向 import 主模块 —— 那是环。
 */

import { DISPLAY_SCALE } from '../data/balance';

export function formatClockSafe(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}
/**
 * 内部刻度 → 展示刻度。
 *
 * 内容是"100 血 / 10 伤害"这种可读的小整数，但内部按 10 倍刻度存储
 * （见 `data/content.ts` 顶部说明）。UI 必须显示展示刻度，
 * 否则玩家会看到 1000 血、100 伤害这种大数字。
 */
export function display(internal: number): number {
  return Math.round(internal / DISPLAY_SCALE);
}
export function percentOf(resource: { current: number; cap: number }): number {
  if (!Number.isFinite(resource.cap) || resource.cap <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((resource.current / resource.cap) * 100)));
}
