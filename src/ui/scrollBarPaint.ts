/**
 * **画一条滚动条**（2026-10-22）—— 全仓库唯一一份"画"。
 *
 * ==================================================================
 * 为什么加它（用户问的原话）
 * ==================================================================
 *
 * > 图鉴的滚动条与设置/备战详情是不是同一个组件？
 *
 * 实情是：**几何只有一份**（`ui/scrollWindow.scrollBarGeometry`），但**画**
 * 是各屏自己画的（图鉴画在自己的 `Graphics` 上、详情区画在
 * `DetailViewport.drawScrollBar` 里）。两份"画"不会算错，却会**长得不一样**
 * （粗细 / 颜色 / 圆角 / 是否画轨道各写一遍）。
 *
 * 所以这里把"画"也收成一处：入参是一块矩形视口 + 滚动状态，内部**只调**
 * `scrollBarGeometry` 那唯一一份几何 ✓（`tests/unit/lintRules.test.ts` 有
 * 源码扫描守着"不许出现第二份比例算法"，本文件当然也不自己乘）。
 *
 * ⚠️ 它**不碰任何屏的状态**（不认识 offset / 内容高）：那些由调用方摊平成
 * "视口多高、还能滚多少、现在滚到哪"三个数传进来。
 */

import type { Graphics } from 'pixi.js';
import { PALETTE } from '../render/theme';
import { scrollBarGeometry } from './scrollWindow';

export interface ScrollBarPaint {
  /** 画在哪块 `Graphics` 上（调用方自己 `clear()` 之后的那个）。 */
  readonly gfx: Graphics;
  /** 轨道的位置与长度（**竖条**：x 是条的中线，top 是上端，len 是长度）。 */
  readonly track: { readonly x: number; readonly top: number; readonly len: number };
  /** 视口有多高（像素）。 */
  readonly viewportPx: number;
  /** 还能滚多少（像素；`0` ⇒ 不画）。 */
  readonly maxScrollPx: number;
  /** 现在滚到哪（像素）。 */
  readonly scrollPx: number;
  /** 条的粗细（默认 3）。 */
  readonly width?: number;
  /**
   * 滑块的**最小长度**（像素/单位；默认交给 `scrollBarGeometry` 的 24）。
   *
   * ⚠️ 加这个参数是为了让「设置页技能详情」那条**行式**滚动条也能用同一份
   * 画笔：它原来的最小长度是 20，而 `scrollBarGeometry` 的缺省是 24。
   * 与其让它在调用点自己算一遍（那正是"第二份画法"的来源），不如把差异
   * 收进画笔的**参数**里。
   */
  readonly minLengthPx?: number;
}

/**
 * 画滚动条：**轨道 + 滑块**。
 *
 * @returns 有没有画（`false` = 内容不足一屏，什么都没画 —— 调用方不必再判）
 */
export function paintScrollBar(p: ScrollBarPaint): boolean {
  if (!(p.maxScrollPx > 0)) return false;
  const width = p.width ?? 3;
  const thumb = scrollBarGeometry({
    viewportPx: p.viewportPx,
    maxScrollPx: p.maxScrollPx,
    scrollPx: p.scrollPx,
    trackLenPx: p.track.len,
    ...(p.minLengthPx === undefined ? {} : { minLengthPx: p.minLengthPx }),
  });
  p.gfx
    .roundRect(p.track.x, p.track.top, width, p.track.len, width / 2)
    .fill({ color: PALETTE.panelLine, alpha: 0.35 });
  p.gfx
    .roundRect(p.track.x, p.track.top + thumb.offset, width, thumb.length, width / 2)
    .fill({ color: PALETTE.textDim, alpha: 0.9 });
  return true;
}
