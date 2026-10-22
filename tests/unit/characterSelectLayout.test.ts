import { describe, expect, it } from 'vitest';

import {
  CHARACTER_CARD_LAYOUT,
  characterCardRect,
  characterSelectCardRects,
  characterSelectColumns,
  characterSelectHitAreas,
} from '../../src/ui/characterSelectLogic';
import { PREPARE_LAYOUT } from '../../src/ui/prepareLayout';
import { easeInOutCubic } from '../../src/ui/expandTween';

/**
 * **选角色屏的几何**（2026-10-22 第三次重做）。
 *
 * 用户原话："本来就是 **3 张 人物详情卡**，只是**没有选中的时候收起来**，
 * 另外**收起来也是要有动画的**！" + "展开是向上长、收起是向下缩（这样切换时
 * 整排不会上下跳）" + "**动画速度记得要用曲线**"。
 *
 * 这一组钉的就是那三句：**卡宽 = 详情宽**、**底边对齐**、**高度按进度插值**、
 * **命中区与动画无关**。
 */

describe('三张"详情卡"：等宽、横排、底边对齐', () => {
  it('卡宽 == 详情区宽（"我就是详情卡"的前提）', () => {
    expect(CHARACTER_CARD_LAYOUT.w).toBe(PREPARE_LAYOUT.detailW);
  });

  it('展开高 == 详情区高（内容原样铺满，不用缩放）', () => {
    expect(CHARACTER_CARD_LAYOUT.fullH).toBe(PREPARE_LAYOUT.detailH);
  });

  it('三列：都在画布内、互不重叠、间距一致、整体居中', () => {
    const cols = characterSelectColumns(3);
    expect(cols).toHaveLength(3);
    for (const col of cols) {
      expect(col.x).toBeGreaterThanOrEqual(0);
      expect(col.x + col.w).toBeLessThanOrEqual(960);
    }
    for (let i = 1; i < cols.length; i += 1) {
      const prev = cols[i - 1];
      const cur = cols[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur.x - (prev.x + prev.w)).toBe(CHARACTER_CARD_LAYOUT.gap);
    }
    const first = cols[0];
    const last = cols[cols.length - 1];
    if (first !== undefined && last !== undefined) {
      expect(first.x).toBe(960 - (last.x + last.w));
    }
  });

  it('⚠️ **每张卡各自垂直居中**（中心线不动 ⇒ 切换时整排不跳）', () => {
    for (const col of characterSelectColumns(3)) {
      for (const progress of [0, 0.3, 1]) {
        const rect = characterCardRect(col, progress);
        const center = rect.y + rect.h / 2;
        expect(Math.abs(center - CHARACTER_CARD_LAYOUT.centerY)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('收起的两张短条**同高对齐**（都居中 ⇒ 顶边/底边一致）', () => {
    const rects = characterSelectColumns(3).map((col) => characterCardRect(col, 0));
    const ys = new Set(rects.map((rect) => rect.y));
    expect(ys.size).toBe(1);
  });
});

describe('高度按进度插值：收起 = 短条，展开 = 详情高', () => {
  it('progress 0 ⇒ 短条高，progress 1 ⇒ 详情高', () => {
    const col = characterSelectColumns(3)[0];
    if (col === undefined) return;
    expect(characterCardRect(col, 0).h).toBe(CHARACTER_CARD_LAYOUT.barH);
    expect(characterCardRect(col, 1).h).toBe(CHARACTER_CARD_LAYOUT.fullH);
  });

  it('⚠️ 动画量走**曲线**：前 1/4 只走了不到线性的四分之一', () => {
    const col = characterSelectColumns(3)[0];
    if (col === undefined) return;
    const quarter = easeInOutCubic(0.25);
    /** 曲线两端平缓 ⇒ 明显小于线性。 */
    expect(quarter).toBeLessThan(0.25);
    const span = CHARACTER_CARD_LAYOUT.fullH - CHARACTER_CARD_LAYOUT.barH;
    expect(characterCardRect(col, quarter).h).toBeLessThan(
      Math.round(CHARACTER_CARD_LAYOUT.barH + span * 0.25),
    );
    /** 中点：曲线关于 0.5 对称 ⇒ 正好走过一半。 */
    expect(characterCardRect(col, easeInOutCubic(0.5)).h).toBe(
      Math.round((CHARACTER_CARD_LAYOUT.barH + CHARACTER_CARD_LAYOUT.fullH) / 2),
    );
  });

  it('进度夹在 [0,1]（越界不会把卡片拉坏）', () => {
    const col = characterSelectColumns(3)[0];
    if (col === undefined) return;
    expect(characterCardRect(col, -1).h).toBe(CHARACTER_CARD_LAYOUT.barH);
    expect(characterCardRect(col, 2).h).toBe(CHARACTER_CARD_LAYOUT.fullH);
  });
});

describe('命中区：与动画无关、且包含收起态', () => {
  /**
   * ⚠️ 2026-10-22 用户报的 bug："鼠标 hover 展开的范围比未展开卡片的范围
   * 大多了" ⇒ 命中区**必须跟着这一张当前的矩形**（收起就是那条短条）。
   */
  it('命中区 = **当前进度**对应的矩形（p = 0 / 0.5 / 1）', () => {
    const cols = characterSelectColumns(3);
    for (const p of [0, 0.5, 1]) {
      const rects = characterSelectCardRects(3, () => p);
      rects.forEach((rect, index) => {
        const col = cols[index];
        expect(col).toBeDefined();
        if (col === undefined) return;
        expect(rect).toEqual(characterCardRect(col, p));
      });
    }
  });

  it('收起时命中区就是那条 96 高的短条（不会再"远处也能展开"）', () => {
    const rects = characterSelectCardRects(3, () => 0);
    for (const rect of rects) {
      expect(rect.h).toBe(CHARACTER_CARD_LAYOUT.barH);
      /** 短条上方 100px 处**不在**命中区里。 */
      const above = rect.y - 100;
      expect(above >= rect.y && above <= rect.y + rect.h).toBe(false);
    }
  });

  it('展开时命中区 = 长大后的卡（整块可滚轮 / 拖拽）', () => {
    const rects = characterSelectCardRects(3, () => 1);
    for (const rect of rects) expect(rect.h).toBe(CHARACTER_CARD_LAYOUT.fullH);
  });

  it('`characterSelectCardRects` 与 `characterSelectHitAreas` **同一份**（渲染/点选不会漂）', () => {
    const rects = characterSelectCardRects(3, (i) => i / 10);
    const areas = characterSelectHitAreas(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      (i) => i / 10,
    );
    expect(areas.map((area) => ({ x: area.x, y: area.y, w: area.w, h: area.h }))).toEqual([...rects]);
  });

  it('`hitAreas` 只列三张卡（选角色屏没有「开始」键）', () => {
    const areas = characterSelectHitAreas([{ id: 'player' }, { id: 'kaili' }, { id: 'daixuan' }]);
    expect(areas.map((area) => area.id)).toEqual(['player', 'kaili', 'daixuan']);
  });
});
