import { describe, expect, it } from 'vitest';

import {
  EXPAND_DURATION_MS,
  easeOutCubic,
  expandAnimating,
  initialExpand,
  lerpRect,
  retarget,
  stepExpand,
} from '../../src/ui/expandTween';

/**
 * **可打断的展开 / 收起**（2026-10-21）。
 *
 * 用户原话："展开和收起都有动画，然后如果**快速 展开和收起，动画会被中断
 * 并朝反状态运行**。"
 *
 * 这里钉的就是那三件事：恒定速度、到边界停住、**打断后从当前进度往回跑**。
 */
describe('展开动画：可以被中断，并且从当前进度朝反方向跑', () => {
  it('从 0 展开：按时间线性推进（`dt` 越大走得越多）', () => {
    let s = retarget(initialExpand(), 1);
    s = stepExpand(s, EXPAND_DURATION_MS / 2);
    expect(s.progress).toBeCloseTo(0.5, 5);
    s = stepExpand(s, EXPAND_DURATION_MS / 2);
    expect(s.progress).toBe(1);
  });

  it('到目标就停住（不会越界）', () => {
    const s = stepExpand(retarget(initialExpand(), 1), EXPAND_DURATION_MS * 5);
    expect(s.progress).toBe(1);
    expect(expandAnimating(s)).toBe(false);
  });

  it('⚠️ **半路改方向**：值不动、从当前进度往回跑（不是跳回 1、也不是从 0 重来）', () => {
    let s = stepExpand(retarget(initialExpand(), 1), EXPAND_DURATION_MS / 2);
    expect(s.progress).toBeCloseTo(0.5, 5);

    s = retarget(s, 0);
    /** 目标变了，但进度原封不动。 */
    expect(s.progress).toBeCloseTo(0.5, 5);
    expect(s.target).toBe(0);

    s = stepExpand(s, EXPAND_DURATION_MS / 4);
    expect(s.progress).toBeCloseTo(0.25, 5);
  });

  it('⚠️ 反复打断：每次都从**当时**的进度换向（这就是"朝反状态运行"）', () => {
    let s = retarget(initialExpand(), 1);
    s = stepExpand(s, 50); // → 0.227
    s = retarget(s, 0);
    s = stepExpand(s, 25); // → 0.113
    s = retarget(s, 1);
    s = stepExpand(s, 50); // → 0.34
    expect(s.progress).toBeCloseTo(50 / EXPAND_DURATION_MS + 25 / EXPAND_DURATION_MS, 5);
    expect(s.target).toBe(1);
  });

  it('已经在目标上时，`retarget` 返回同一个对象（不产生多余的状态变化）', () => {
    const s = initialExpand();
    expect(retarget(s, 0)).toBe(s);
  });

  it('缓动只影响视觉：`easeOutCubic(0)=0`、`1=1`、中段更快地靠近 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    /** 越界会夹住（负的 dt / 浮点误差不该让矩形翻出去）。 */
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('矩形插值（"卡片 → 详情面板"的形状）', () => {
  it('两端正好是起点 / 终点', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 100, y: 50, w: 200, h: 100 };
    expect(lerpRect(a, b, 0)).toEqual(a);
    expect(lerpRect(a, b, 1)).toEqual(b);
  });

  it('中点是两个方向的中间（宽高一起插值）', () => {
    const mid = lerpRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 50, w: 210, h: 110 }, 0.5);
    expect(mid).toEqual({ x: 50, y: 25, w: 110, h: 60 });
  });
});
