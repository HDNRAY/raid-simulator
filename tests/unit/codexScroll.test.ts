import { describe, expect, it } from 'vitest';

import { clampScrollOffset, maxScrollOffset } from '../../src/ui/codexLogic';
import { fullyOutside, verticalSpan } from '../../src/ui/viewportMask';

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

describe('裁切：像素级（遮罩切），几何只判"要不要画"', () => {
  /**
   * ⚠️ 2026-10-22 口径变更：**边缘那一行不是"藏起来"，是被遮罩切一半**。
   *
   * 所以这里不再算"可见子矩形"（`visiblePartOf` 已删）—— 只钉两件事：
   *   ① 完全在视口外 ⇒ **不画**（性能判据）
   *   ② 部分可见 ⇒ **照画**（交给 `mask` 切）
   */
  const viewport = { x: 0, y: 100, w: 300, h: 200 };
  const card = { x: 10, y: 0, w: 100, h: 80 };

  it('完全在视口上方 ⇒ 不画', () => {
    expect(fullyOutside({ ...card, y: 0 }, viewport)).toBe(true);
  });

  it('完全在视口下方 ⇒ 不画', () => {
    expect(fullyOutside({ ...card, y: 320 }, viewport)).toBe(true);
  });

  it('完全在视口内 ⇒ 画', () => {
    expect(fullyOutside({ ...card, y: 120 }, viewport)).toBe(false);
  });

  it('⚠️ 上边缘跨过视口顶 ⇒ **照画**（遮罩会切掉上半截 = 半张卡）', () => {
    expect(fullyOutside({ ...card, y: 60 }, viewport)).toBe(false);
    expect(verticalSpan({ ...card, y: 60 }, viewport)).toEqual({ top: 100, height: 40 });
  });

  it('⚠️ 下边缘跨过视口底 ⇒ **照画**（遮罩切掉下半截）', () => {
    expect(fullyOutside({ ...card, y: 260 }, viewport)).toBe(false);
    expect(verticalSpan({ ...card, y: 260 }, viewport)).toEqual({ top: 260, height: 40 });
  });
});
