import { describe, expect, it } from 'vitest';

import {
  clampScrollOffset,
  maxScrollOffset,
  visiblePartOf,
} from '../../src/ui/codexLogic';

/**
 * **图鉴滚动**（2026-10-22，用户："图鉴应该支持 滚动，如果 pixi 不支持显示行的
 * 一半，我考虑换一个库"）。
 *
 * 结论：Pixi **能**做 —— 但不是靠 `mask`（它在 headless 里不生效，
 * AGENTS §3e），而是靠**几何求交**：只画卡片落在视口里的那一段。
 * 所以"显示行的一半"是算出来的，这也是下面 `visiblePartOf` 钉的东西。
 */

describe('滚动范围的上下界', () => {
  it('内容比视口矮 ⇒ 不能滚', () => {
    expect(maxScrollOffset(300, 400)).toBe(0);
  });

  it('内容比视口高 ⇒ 上界 = 差值', () => {
    expect(maxScrollOffset(900, 400)).toBe(500);
  });

  it('偏移夹在 [0, 上界]（滚轮 / 拖拽 / 键盘共用这一处）', () => {
    expect(clampScrollOffset(-50, 500)).toBe(0);
    expect(clampScrollOffset(200, 500)).toBe(200);
    expect(clampScrollOffset(9999, 500)).toBe(500);
    expect(clampScrollOffset(Number.NaN, 500)).toBe(0);
  });
});

describe('可见部分：**能显示半张卡**', () => {
  const viewport = { top: 100, height: 200 };
  const card = { x: 10, y: 0, w: 100, h: 80 };

  it('完全在视口上方 ⇒ 不画', () => {
    expect(visiblePartOf({ ...card, y: 0 }, viewport)).toBeUndefined();
  });

  it('完全在视口下方 ⇒ 不画', () => {
    expect(visiblePartOf({ ...card, y: 320 }, viewport)).toBeUndefined();
  });

  it('完全在视口内 ⇒ 原样', () => {
    expect(visiblePartOf({ ...card, y: 120 }, viewport)).toEqual({ x: 10, y: 120, w: 100, h: 80 });
  });

  it('⚠️ 上边缘被切 ⇒ 只画下半截（这就是"半张卡"）', () => {
    expect(visiblePartOf({ ...card, y: 60 }, viewport)).toEqual({ x: 10, y: 100, w: 100, h: 40 });
  });

  it('⚠️ 下边缘被切 ⇒ 只画上半截', () => {
    expect(visiblePartOf({ ...card, y: 260 }, viewport)).toEqual({ x: 10, y: 260, w: 100, h: 40 });
  });
});
