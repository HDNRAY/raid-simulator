import { describe, expect, it } from 'vitest';

import {
  CHARACTER_CARD_LAYOUT,
  characterSelectCardRects,
  characterSelectHitAreas,
} from '../../src/ui/characterSelectLogic';
import { PREPARE_LAYOUT } from '../../src/ui/prepareLayout';
import { detailRect } from '../../src/ui/prepareGeometry';
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

describe('展开动画：终点就是详情矩形', () => {
  it('progress 0 ⇒ 还是那张小卡；progress 1 ⇒ 正好是 detailRect', () => {
    const slot = characterSelectCardRects(3)[0];
    const target = detailRect();
    expect(slot).toBeDefined();
    if (slot === undefined) return;
    expect(lerpRect(slot, target, easeOutCubic(0))).toEqual(slot);
    expect(lerpRect(slot, target, easeOutCubic(1))).toEqual(target);
  });

  it('宽度不变（卡宽 = 详情宽 ⇒ 只有位置与高度在动）', () => {
    const slot = characterSelectCardRects(3)[0];
    const target = detailRect();
    if (slot === undefined) return;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(lerpRect(slot, target, t).w).toBeCloseTo(target.w, 5);
    }
  });
});
