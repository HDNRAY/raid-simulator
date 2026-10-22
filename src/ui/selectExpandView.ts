/**
 * **"小卡长大成详情"时，详情面板怎么摆、怎么裁**（2026-10-22）。
 *
 * 从 `CharacterSelectScreen.redraw` 里抽出来的（那边一度 730 行，AGENTS §3
 * 的上限 700）：它是一段**自成一体的几何 + 遮罩**，与"选谁 / 键位 / 指针"
 * 都无关，只回答一件事 —— 详情面板此刻应该画在哪、露多少。
 *
 * ==================================================================
 * 两个坐标系的换算（这就是为什么值得单独一个函数）
 * ==================================================================
 *
 * ```
 *   详情面板内部：按 `detailRect()`（x624 y88 296×371）排版 —— 固定
 *   屏幕上它该在：正在长大的那张卡（`expandedCardRect(slot)`）
 * ```
 *
 * 所以：
 *
 *   - **位置** = `grown − detailRect()` 的左上角差（**平移，不缩放**：
 *     卡片与详情的**宽度恒等 296** ⇒ 字号/行距原样）
 *   - **遮罩**在面板的**局部坐标**里 ⇒ 左上角仍是 `detailRect()` 的左上角，
 *     只有**高度**跟着 `grown.h` 走（96 → 371）。收起时高度回到 96 ⇒
 *     正文被裁光 ✓（"收起过程中还露字"就是这个 bug 的另一半）
 *
 * ⚠️ 遮罩用仓库唯一那份 `viewportMask`（`attachViewportMask` /
 * `drawViewportClip`），不另写一份。
 */

import type { Container, Graphics } from 'pixi.js';
import { detailRect } from './prepareGeometry';
import { expandedCardRect, type CharacterCardRect } from './characterSelectLogic';
import { easeOutCubic, lerpRect } from './expandTween';
import { drawViewportClip } from './viewportMask';

/**
 * 把详情面板挪到"长大的那张卡"上，并按卡的大小重画遮罩。
 *
 * @param slot 正在长大的那张卡的**槽位**（`characterSelectCardRects` 的结果）
 */
export function placeExpandedPanel(args: {
  readonly panel: Container;
  readonly mask: Graphics;
  readonly slot: CharacterCardRect;
  /**
   * 这一帧的展开进度（0..1）。
   *
   * ⚠️ **必须传进度**：第一版直接用了"长大后的最终矩形"⇒ 遮罩在动画开始的
   * 那一帧就已经是终点大小，于是**正文画到了还没长大的卡片外面**（用户看
   * 中途帧一眼就看出"字浮在框外"✗）。现在位置与遮罩都跟着**插值**走。
   */
  readonly progress: number;
}): void {
  const base = detailRect();
  const grown = lerpRect(args.slot, expandedCardRect(args.slot), easeOutCubic(args.progress));
  args.panel.x = grown.x - base.x;
  args.panel.y = grown.y - base.y;
  /** ⚠️ **每帧**重画：高度随动画变，收起时回到 96 ⇒ 正文自然裁光。 */
  drawViewportClip(args.mask, { x: base.x, y: base.y, w: grown.w, h: grown.h });
}
