/**
 * 详情面板**顶栏与正文之间的那道分隔线**（2026-10-22 从 `prepareDetailPanel` 切出）。
 *
 * ⚠️ 为什么单独一个文件：`prepareDetailPanel.ts` 在 700 行上限附近，而"分隔线
 * 画在哪"是个**纯几何 + 一笔描边**的小知识 —— 切出来之后那个文件回到上限内，
 * 而这条坑（"画在 `bodyTop - 3` 会被正文墨迹压住"）跟着代码一起搬过来。
 *
 * ⚠️ 用户报的现象："确认出站里，低语的内容重叠了" —— 改前分隔线离正文只有
 * 3px，中文 15px 字的实际墨迹比行框高一截，看起来就是"横线从字里穿过去"。
 * 现在位置由 `separatorYOf` 给（与 `bodyTopOf` **同一份几何**），离正文 12px。
 */

import type { Graphics } from 'pixi.js';
import { PALETTE } from '../render/theme';
import { separatorYOf, type DetailKind, type DetailRect } from './prepareDetailMetrics';

/**
 * 画那条分隔线（顶栏与正文之间）。
 *
 * @param gfx 面板底板那一块（调用方每帧 `clear()` 过）
 * @param kind 详情类型（几何按类分：有头像 / 无头像顶栏高度不同）
 */
export function drawHeaderSeparator(
  gfx: Graphics,
  kind: DetailKind,
  rect: DetailRect,
  left: number,
  width: number,
): void {
  const y = separatorYOf(kind, rect);
  gfx.moveTo(left, y).lineTo(left + width, y)
    .stroke({ color: PALETTE.panelLine, width: 1, alpha: 0.6 });
}
