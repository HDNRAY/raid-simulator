import { describe, expect, it } from 'vitest';
import {
  DELAY_UNIT_TICKS,
  frameAtProgress,
  loopProgress,
  loopTicks,
  totalWeight,
} from '../../src/render/spriteAnim';

/**
 * **帧选择规则**（玩家拍板）。
 *
 * 原话："**读条时间 = 播放时长，无论原来动作多少帧，都在读条时间内播完。
 * 这样美术就没有影响之前的交互。**"
 *
 * 所以这里**没有时钟、没有状态机**：全是 `(帧权重, 进度) → 帧号` 的纯函数。
 * 攻击动画的进度来自快照的 `cast.progress`，idle 的进度来自引擎 tick。
 */

/** 「傲慢」的攻击：16 帧、delay 全 2（`manifest.json` 的实测值）。 */
const PRIDE_ATTACK = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
/** 「暴食」的攻击：最后一帧 delay=8 —— 原版刻意"停一拍"。 */
const GLUTTONY_ATTACK = [2, 2, 2, 4, 2, 8];

describe('frameAtProgress：按 delay 加权，不是等分', () => {
  it('权重相等时就是等分（16 帧 → 每帧占 1/16）', () => {
    expect(frameAtProgress(PRIDE_ATTACK, 0)).toBe(0);
    /** p = 0.5 → 第 8 帧（0 起）。 */
    expect(frameAtProgress(PRIDE_ATTACK, 0.5)).toBe(8);
    expect(frameAtProgress(PRIDE_ATTACK, 0.999)).toBe(15);
  });

  it('⚠️ 权重不等时按权重切（暴食最后一张 delay=8 占 40% 的读条）', () => {
    /**
     * 累计边界 = [2,4,6,10,12,20] / 20 =
     * [0.1, 0.2, 0.3, 0.5, 0.6, 1.0]
     */
    expect(frameAtProgress(GLUTTONY_ATTACK, 0)).toBe(0);
    expect(frameAtProgress(GLUTTONY_ATTACK, 0.099)).toBe(0);
    expect(frameAtProgress(GLUTTONY_ATTACK, 0.1)).toBe(1);
    expect(frameAtProgress(GLUTTONY_ATTACK, 0.299)).toBe(2);
    /** 第 4 帧 delay=4 → 占 0.3..0.5（比邻居宽一倍）。 */
    expect(frameAtProgress(GLUTTONY_ATTACK, 0.35)).toBe(3);
    /** 最后一帧 delay=8 → 占 0.6..1.0。 */
    expect(frameAtProgress(GLUTTONY_ATTACK, 0.6)).toBe(5);
    expect(frameAtProgress(GLUTTONY_ATTACK, 0.99)).toBe(5);
  });

  it('【关键】同样的进度、不同权重 → 不同帧（证明"不是等分"）', () => {
    /** p = 0.15：等分下是第 2 帧(2/16=0.125)，加权下还在第 1 帧。 */
    expect(frameAtProgress(PRIDE_ATTACK, 0.15)).toBe(2);
    expect(frameAtProgress(GLUTTONY_ATTACK, 0.15)).toBe(1);
  });

  it('读条结束（p=1）画最后一帧，不会越界', () => {
    expect(frameAtProgress(GLUTTONY_ATTACK, 1)).toBe(5);
    expect(frameAtProgress(GLUTTONY_ATTACK, 99)).toBe(5);
  });

  it('边界情况：空 / 单帧 / 权重全 0 / NaN', () => {
    /** 单帧：「暴食」「懒惰」的 idle 原版就只有 1 帧 —— 照实静止。 */
    expect(frameAtProgress([2], 0.5)).toBe(0);
    expect(frameAtProgress([], 0.5)).toBe(0);
    /** 权重全 0：退化成等分（比"永远第 0 帧"有用）。 */
    expect(frameAtProgress([0, 0, 0, 0], 0.5)).toBe(2);
    expect(frameAtProgress([0, 0, 0, 0], 0.99)).toBe(3);
    /** 非法进度按 0 处理（NaN 安全）。 */
    expect(frameAtProgress(PRIDE_ATTACK, Number.NaN)).toBe(0);
    expect(frameAtProgress(PRIDE_ATTACK, -1)).toBe(0);
  });

  it('权重里的非法值不会把帧号算飞（负数按 0）', () => {
    expect(frameAtProgress([2, -5, 2], 0.5)).toBe(2);
    expect(totalWeight([2, -5, 2])).toBe(4);
  });
});

describe('idle：用引擎 tick 循环（同一 tick 结果相同）', () => {
  it('循环长度 = Σdelay × DELAY_UNIT_TICKS', () => {
    expect(loopTicks([2, 2, 2, 2])).toBe(8 * DELAY_UNIT_TICKS);
    expect(loopTicks([2])).toBe(2 * DELAY_UNIT_TICKS);
    expect(loopTicks([])).toBe(0);
  });

  it('idle 会往前走，并在一个循环后**回绕**', () => {
    const weights = [2, 2, 2, 2];
    const ticks = loopTicks(weights);
    expect(frameAtProgress(weights, loopProgress(weights, 0))).toBe(0);
    expect(frameAtProgress(weights, loopProgress(weights, ticks / 4))).toBe(1);
    expect(frameAtProgress(weights, loopProgress(weights, ticks / 2))).toBe(2);
    /** 回绕：tick = 一个循环之后又回到第 0 帧（不是停住）。 */
    expect(frameAtProgress(weights, loopProgress(weights, ticks))).toBe(0);
    expect(frameAtProgress(weights, loopProgress(weights, ticks + ticks / 4))).toBe(1);
  });

  it('同一 tick 反复调用结果相同（渲染层是快照的纯函数）', () => {
    const weights = [2, 2, 2, 2];
    expect(loopProgress(weights, 7)).toBe(loopProgress(weights, 7));
  });

  it('单帧 idle 永远第 0 帧，且不会除以 0', () => {
    expect(frameAtProgress([2], loopProgress([2], 12345))).toBe(0);
    expect(loopProgress([], 12345)).toBe(0);
  });

  it('负 tick 也安全（重开一局理论上有过 tick 倒退）', () => {
    expect(loopProgress([2, 2, 2, 2], -3)).toBeGreaterThanOrEqual(0);
    expect(loopProgress([2, 2, 2, 2], -3)).toBeLessThan(1);
  });
});
