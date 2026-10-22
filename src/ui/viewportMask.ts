/**
 * **视口裁切（Pixi `mask`）—— 全仓库唯一一份**（2026-10-22）。
 *
 * ==================================================================
 * 它是什么（一句话）
 * ==================================================================
 *
 * 把一个容器裁到一块矩形视口里 —— 也就是 HTML 的 `overflow: hidden`：
 * 滚动时内容**按像素**被切（边缘可以露出半行字 / 半张卡），而不是
 * "整项显示 / 整项不显示"。
 *
 * ==================================================================
 * ⚠️⚠️ 这条与 AGENTS.md §3e 的关系（**请先读完**）
 * ==================================================================
 *
 * §3e 写着"Pixi 的 `mask` 在 headless 里不生效 —— 裁剪要逐行判可见性"。
 * 那条规则的**唯一理由**是：当时的验收方式是"headless 截图"，而遮罩在那
 * 种环境里画不出来 ⇒ 用遮罩的实现会**自己看不见自己坏**。
 *
 * 2026-10-22 用户明确要求**HTML 式的像素滚动**（原话："一段话要么完全显示、
 * 要么完全不显示" 这不是我要的…"我要的是类似 html 那种滚动效果，如果 pixi
 * 做不到咱们就换引擎"），并接受"截图里可能看不到裁切"这个代价。于是：
 *
 *   | 规则 | 现在 |
 *   |---|---|
 *   | 裁剪方式 | **`mask`**（像素级，与浏览器里一致） |
 *   | "整行 / 整张卡" | **只作为性能判据**：完全在视口外的项**不画**（省文字重建），部分可见的项**照画**、交给遮罩去切 |
 *   | headless 截图 | ⚠️ **已知限制**：遮罩在 headless 里可能不生效（那几张截图里会看到内容溢出），**不要**为了截图好看改回整项可见 |
 *
 * §3e 的教训（"靠 mask 的实现自己看不见自己坏"）**没有删掉** —— 它变成了
 * 上面那行"已知限制"：见到溢出时先想"是不是 headless 没画遮罩"，而不是
 * 立刻回退。真机（浏览器）里以遮罩为准。
 *
 * ==================================================================
 * 用法（三处调用点：图鉴 / 备战详情 / 设置页技能详情）
 * ==================================================================
 *
 * ```ts
 * // ① 造一块 mask（一次性）
 * this.mask = new pixi.Graphics();
 * this.cardsLayer.addChild(this.mask);      // ⚠️ mask 必须在显示列表里
 * this.cardsLayer.mask = this.mask;
 *
 * // ② 每帧按视口重画（几何变了就跟着变）
 * applyViewportClip({ mask: this.mask, viewport: this.viewport() });
 * ```
 *
 * ⚠️ **mask 画在"被裁容器自己的局部坐标"里**（所以是 `addChild` 到它身上）：
 * 这样容器自己被 `x/y` 平移时，遮罩跟着平移，不需要调用方再做一次坐标换算
 * —— 那条换算正是"遮罩与内容对不上"的经典来源。
 */

import type { Container, Graphics } from 'pixi.js';

/** 一块矩形（逻辑坐标，或在某个容器的局部坐标里）。 */
export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 把 `mask` 画成 `viewport` 那块矩形（并确保它被当成遮罩用）。
 *
 * ⚠️ 只**重画几何**，不重复 `addChild` / 不重复赋值 `mask`（那两件事是
 * 一次性的，每次 `redraw` 都做一遍只会白花开销，还会在 Pixi 内部反复
 * 增减引用计数）。
 */
export function drawViewportClip(mask: Graphics, viewport: ViewportRect): void {
  mask.clear();
  mask.rect(viewport.x, viewport.y, viewport.w, viewport.h).fill({ color: 0xffffff });
}

/**
 * 造一块遮罩并挂到 `container` 身上（**一次性**装配）。
 *
 * @returns 那块用作遮罩的 `Graphics`（调用方每帧把它喂给 `drawViewportClip`）
 */
export function attachViewportMask(mask: Graphics, container: Container): Graphics {
  container.addChild(mask);
  container.mask = mask;
  return mask;
}

/**
 * 这个矩形是不是**完全**在视口外（⇒ 可以整个跳过不画）。
 *
 * ⚠️ 它**只是性能判据**（以及"文字不必重建"的判据），**不是**裁剪本身 ——
 * 部分重叠的项照画，剩下的交给遮罩 ✓。这正是"整项可见"与"像素裁切"的
 * 分工：前者省事，后者定行为。
 *
 * @param slack 允许的宽容（像素）。遮罩边缘那 1px 的抗锯齿不该让整项消失。
 */
export function fullyOutside(
  rect: ViewportRect,
  viewport: ViewportRect,
  slack = 1,
): boolean {
  return (
    rect.y + rect.h <= viewport.y + slack || rect.y >= viewport.y + viewport.h - slack
  );
}

/**
 * 竖直方向**可见的那一段**（与视口求交）。
 *
 * ⚠️ 图鉴用它判"这一行卡片有没有一点点露出来"（露一点就画，交给遮罩切）。
 * 纯几何，所以能在 node 里直接测。
 */
export function verticalSpan(
  rect: ViewportRect,
  viewport: ViewportRect,
): { readonly top: number; readonly height: number } | undefined {
  const top = Math.max(rect.y, viewport.y);
  const bottom = Math.min(rect.y + rect.h, viewport.y + viewport.h);
  if (bottom <= top) return undefined;
  return { top, height: bottom - top };
}
