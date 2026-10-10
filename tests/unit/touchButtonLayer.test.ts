import { describe, expect, it } from 'vitest';
import {
  TOUCH_ARC_CENTER,
  TOUCH_BUTTON_CAPACITY,
  TOUCH_BUTTON_DIAMETER,
  TOUCH_BUTTON_GAP,
  touchButtonCenter,
} from '../../src/render/touchButtonLayer';

/**
 * 双弧几何的**可执行约束**。
 *
 * 这些数字是暴力搜索 46080 组参数后定下来的（见
 * `docs/plans/2026-10-10-m8-mobile.md` §2.2b）。这里把它们钉住，
 * 免得以后有人"顺手调一下半径"就撞出重叠或越界。
 */
describe('双弧按钮几何', () => {
  const R = TOUCH_BUTTON_DIAMETER / 2;
  const centers = Array.from({ length: TOUCH_BUTTON_CAPACITY }, (_, i) => {
    const c = touchButtonCenter(i);
    if (c === undefined) throw new Error(`第 ${i} 个按钮没有位置（容量算错了）`);
    return c;
  });

  it('容量是 7（内弧 3 + 外弧 4）', () => {
    expect(TOUCH_BUTTON_CAPACITY).toBe(7);
  });

  it('超出容量的返回 undefined（调用方据此跳过，而不是画重叠）', () => {
    expect(touchButtonCenter(TOUCH_BUTTON_CAPACITY)).toBeUndefined();
    expect(touchButtonCenter(99)).toBeUndefined();
  });

  it('所有按钮都在 960×540 画布内', () => {
    for (const c of centers) {
      expect(c.x - R).toBeGreaterThanOrEqual(0);
      expect(c.x + R).toBeLessThanOrEqual(960);
      expect(c.y - R).toBeGreaterThanOrEqual(0);
      expect(c.y + R).toBeLessThanOrEqual(540);
    }
  });

  it('【关键】不与左侧信息柱（日志/玩家）重叠', () => {
    /**
     * 左侧那一列最宽到 `x ≈ 288`（设置按钮右缘）。
     * 双弧必须完全在它右边。
     */
    for (const c of centers) {
      expect(c.x - R).toBeGreaterThan(300);
    }
  });

  it('【关键】不压 Boss 区（顶栏 + buff 条，y < 64）', () => {
    for (const c of centers) {
      expect(c.y - R).toBeGreaterThan(70);
    }
  });

  it('【关键】任意两个按钮不重叠（圆心距 ≥ 直径 + 间隔）', () => {
    for (let i = 0; i < centers.length; i += 1) {
      for (let j = i + 1; j < centers.length; j += 1) {
        const a = centers[i]!;
        const b = centers[j]!;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        expect(dist).toBeGreaterThanOrEqual(TOUCH_BUTTON_DIAMETER + TOUCH_BUTTON_GAP);
      }
    }
  });

  it('内弧（前 3 个）比外弧（后 4 个）**离圆心更近** —— 拇指优先', () => {
    const distOf = (c: { x: number; y: number }): number =>
      Math.hypot(c.x - TOUCH_ARC_CENTER.x, c.y - TOUCH_ARC_CENTER.y);
    const innerMax = Math.max(...centers.slice(0, 3).map(distOf));
    const outerMin = Math.min(...centers.slice(3).map(distOf));
    expect(innerMax).toBeLessThan(outerMin);
  });

  it('内弧按钮在画布右下角区域（不是散在中间）', () => {
    for (const c of centers) {
      expect(c.x).toBeGreaterThan(600);
      expect(c.y).toBeGreaterThan(280);
    }
  });
});
