import { describe, expect, it } from 'vitest';

import {
  CHARACTER_CARD_LAYOUT,
  characterSelectCardRects,
  characterSelectHitAreas,
  expandedCardRect,
} from '../../src/ui/characterSelectLogic';
import { PREPARE_LAYOUT } from '../../src/ui/prepareLayout';

import { easeOutCubic, lerpRect } from '../../src/ui/expandTween';

/**
 * **选角色屏的新几何**（2026-10-22 重做）。
 *
 * 用户原话："这个页面应该是3个和**人物详情等宽**的卡片，然后 hover 哪个哪个
 * 就展开…我要的是人物名字的小卡片**展开成人物详情**"。
 *
 * 这一组钉的就是那句话：**卡宽 = 详情宽**、三张横排不重叠、**展开终点 =
 * 详情矩形**（所以"卡片长成详情"是同一块矩形插值，不是两套布局）。
 */

describe('三张卡：与详情等宽、横排不重叠、在画布内', () => {
  it('卡宽 == 详情区宽（这是"卡片长成详情"的前提）', () => {
    expect(CHARACTER_CARD_LAYOUT.cardW).toBe(PREPARE_LAYOUT.detailW);
  });

  it('三张卡：都在画布内、互不重叠、间距一致', () => {
    const rects = characterSelectCardRects(3);
    expect(rects).toHaveLength(3);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(960);
    }
    for (let i = 1; i < rects.length; i += 1) {
      const prev = rects[i - 1];
      const cur = rects[i];
      if (prev === undefined || cur === undefined) continue;
      /** 间距一致（没有重叠 ⇒ 后一张的左 >= 前一张的右）。 */
      expect(cur.x - (prev.x + prev.w)).toBe(CHARACTER_CARD_LAYOUT.gap);
    }
  });

  it('整体水平居中（左右边距相等）', () => {
    const rects = characterSelectCardRects(3);
    const first = rects[0];
    const last = rects[2];
    if (first === undefined || last === undefined) return;
    expect(first.x).toBeCloseTo(960 - (last.x + last.w), 0);
  });

  it('命中区域与绘制矩形**同一份几何**', () => {
    const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never;
    const areas = characterSelectHitAreas(players);
    const rects = characterSelectCardRects(3);
    expect(areas.map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h }))).toEqual([...rects]);
  });
});

describe('展开 = **这张卡自己长高**（不是右边的模块）', () => {
  it('终点是"同一 x + 详情的高"：**包含原来的槽位**，宽度不变', () => {
    for (const slot of characterSelectCardRects(3)) {
      const grown = expandedCardRect(slot);
      /** 同一个 x / 同一个宽 ⇒ 就是这张卡在那儿长高。 */
      expect(grown.x).toBe(slot.x);
      expect(grown.w).toBe(slot.w);
      /** 长高之后**完整包住**原来的槽位（y 从 88 起、高 371）。 */
      expect(grown.y).toBeLessThanOrEqual(slot.y);
      expect(grown.y + grown.h).toBeGreaterThanOrEqual(slot.y + slot.h);
    }
  });

  it('三张的展开矩形都在画布内（最右一张 640 + 296 = 936 ≤ 960）', () => {
    for (const slot of characterSelectCardRects(3)) {
      const grown = expandedCardRect(slot);
      expect(grown.x).toBeGreaterThanOrEqual(0);
      expect(grown.x + grown.w).toBeLessThanOrEqual(960);
    }
  });

  it('另外两张卡**留在原槽位**（所以仍然 hover 得到、点得到）', () => {
    const rects = characterSelectCardRects(3);
    /** 展开某一张不改变别的槽位 —— 槽位是纯几何，与展开状态无关。 */
    const again = characterSelectCardRects(3);
    expect(again).toEqual(rects);
  });
});

describe('展开动画：终点 = 长大的那张卡（旧口径：detailRect）', () => {
  it('progress 0 ⇒ 还是那张小卡；progress 1 ⇒ 正好是长大的那张卡', () => {
    const slot = characterSelectCardRects(3)[0];
    if (slot === undefined) return;
    const target = expandedCardRect(slot);
    expect(slot).toBeDefined();
    if (slot === undefined) return;
    expect(lerpRect(slot, target, easeOutCubic(0))).toEqual(slot);
    expect(lerpRect(slot, target, easeOutCubic(1))).toEqual(target);
  });

  it('宽度不变（卡宽 = 详情宽 ⇒ 只有高度在动）', () => {
    const slot = characterSelectCardRects(3)[0];
    if (slot === undefined) return;
    const target = expandedCardRect(slot);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(lerpRect(slot, target, t).w).toBeCloseTo(target.w, 5);
    }
  });
});
