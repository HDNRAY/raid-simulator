import { describe, expect, it } from 'vitest';

import {
  fullyOutside,
  verticalSpan,
  type ViewportRect,
} from '../../src/ui/viewportMask';

/**
 * **视口裁切（Pixi `mask`）的几何**（2026-10-22）。
 *
 * 用户原话："我要的是类似 html 那种滚动效果" —— 也就是**按像素裁切**：
 * 边缘可以露出半行字 / 半张卡。
 *
 * 这里的三个纯函数是那条行为里**唯一能算的部分**：
 *   1. `drawViewportClip` 画出来的矩形（= 视口矩形本身，没有第二个来源）
 *   2. `fullyOutside` —— 完全在视口外 ⇒ 不画（**性能判据，不是裁剪**）
 *   3. `verticalSpan` —— 与视口求交的那一段（判"露没露出来"）
 *
 * ⚠️ 真正的裁切是 Pixi 的 `mask` 做的 —— 它在 headless 截图里可能不生效
 * （AGENTS §3e 的已知限制，见 `viewportMask` 文件头）。所以这里**不**断言
 * "画出来被切了"（那要真实渲染器），只断言喂给遮罩的几何是对的。
 */

const VIEWPORT: ViewportRect = { x: 100, y: 200, w: 300, h: 150 };

describe('fullyOutside：完全在视口外才跳过（部分可见照画）', () => {
  it('整张在视口上方 ⇒ 跳过', () => {
    expect(fullyOutside({ x: 100, y: 0, w: 50, h: 80 }, VIEWPORT)).toBe(true);
  });

  it('整张在视口下方 ⇒ 跳过', () => {
    expect(fullyOutside({ x: 100, y: 400, w: 50, h: 80 }, VIEWPORT)).toBe(true);
  });

  it('完全在视口内 ⇒ 不跳过', () => {
    expect(fullyOutside({ x: 110, y: 210, w: 50, h: 80 }, VIEWPORT)).toBe(false);
  });

  it('⚠️ 只露出**一行**（下缘跨过视口上沿）⇒ **不跳过**（交给遮罩切）', () => {
    expect(fullyOutside({ x: 100, y: 190, w: 50, h: 80 }, VIEWPORT)).toBe(false);
  });

  it('⚠️ 上缘在视口内、下缘在视口外 ⇒ 不跳过', () => {
    expect(fullyOutside({ x: 100, y: 330, w: 50, h: 80 }, VIEWPORT)).toBe(false);
  });

  it('刚好贴边（边界重合）⇒ 跳过（没有可见像素）', () => {
    expect(fullyOutside({ x: 100, y: 120, w: 50, h: 80 }, VIEWPORT)).toBe(true);
    expect(fullyOutside({ x: 100, y: 350, w: 50, h: 80 }, VIEWPORT)).toBe(true);
  });
});

describe('verticalSpan：与视口求交的那一段', () => {
  it('完全在里 ⇒ 原样', () => {
    expect(verticalSpan({ x: 0, y: 220, w: 10, h: 40 }, VIEWPORT)).toEqual({
      top: 220,
      height: 40,
    });
  });

  it('上缘被切 ⇒ 从视口顶开始', () => {
    expect(verticalSpan({ x: 0, y: 180, w: 10, h: 40 }, VIEWPORT)).toEqual({
      top: 200,
      height: 20,
    });
  });

  it('下缘被切 ⇒ 到视口底为止', () => {
    expect(verticalSpan({ x: 0, y: 330, w: 10, h: 40 }, VIEWPORT)).toEqual({
      top: 330,
      height: 20,
    });
  });

  it('完全在外 ⇒ undefined', () => {
    expect(verticalSpan({ x: 0, y: 0, w: 10, h: 40 }, VIEWPORT)).toBeUndefined();
    expect(verticalSpan({ x: 0, y: 400, w: 10, h: 40 }, VIEWPORT)).toBeUndefined();
  });
});
