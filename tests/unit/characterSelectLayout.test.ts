import { describe, expect, it } from 'vitest';

import {
  CHARACTER_CARD_LAYOUT,
  characterCardHotRect,
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

  it('**底边对齐在同一条线上**（展开向上长、收起向下缩）', () => {
    for (const col of characterSelectColumns(3)) {
      for (const progress of [0, 0.3, 1]) {
        const rect = characterCardRect(col, progress);
        expect(rect.y + rect.h).toBe(CHARACTER_CARD_LAYOUT.bottomY);
      }
    }
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
  it('命中区 = 展开后的整块（底边对齐、高 = 详情高）', () => {
    const col = characterSelectColumns(3)[1];
    if (col === undefined) return;
    const hot = characterCardHotRect(col);
    expect(hot.h).toBe(CHARACTER_CARD_LAYOUT.fullH);
    expect(hot.y + hot.h).toBe(CHARACTER_CARD_LAYOUT.bottomY);
    /** 包含收起的短条（短条在底部）。 */
    expect(hot.y).toBeLessThanOrEqual(CHARACTER_CARD_LAYOUT.bottomY - CHARACTER_CARD_LAYOUT.barH);
  });

  it('`characterSelectCardRects` 与命中区**同一份**（渲染/点选不会漂）', () => {
    const cols = characterSelectColumns(3);
    const rects = characterSelectCardRects(3);
    expect(rects).toEqual(cols.map((col) => characterCardHotRect(col)));
  });

  it('`hitAreas` 只列三张卡（选角色屏没有「开始」键）', () => {
    const areas = characterSelectHitAreas([{ id: 'player' }, { id: 'kaili' }, { id: 'daixuan' }]);
    expect(areas.map((area) => area.id)).toEqual(['player', 'kaili', 'daixuan']);
  });
});
