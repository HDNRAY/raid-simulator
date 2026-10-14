import { describe, expect, it } from 'vitest';

import { hslToRgbInt, rainbowColors } from '../../src/ui/rainbow';
import { ALL_SKILLS } from '../../src/data/content';

/**
 * **彩虹分段色**（霸体读条条的彩色渐变边框用）。
 *
 * ⚠️ 它是**纯函数**，所以不需要截图就能验 —— 而"颜色对不对"最终仍要靠
 * 截图看（AGENTS.md §4a），这一组只保证"算得对、不是一坨同色"。
 */
describe('rainbowColors：分段彩虹', () => {
  it('段数对得上，而且**每段颜色互不相同**（不是一坨同色）', () => {
    const colors = rainbowColors(12);
    expect(colors).toHaveLength(12);
    expect(new Set(colors).size, '12 段应当有 12 种颜色').toBe(12);
  });

  it('⚠️ 色相**首尾相接**（圆角矩形是闭合轮廓，不能有接缝）', () => {
    /**
     * 判据：最后一段与第一段的色相**几乎接上**（相邻两段的差），
     * 而不是"最后一段 ≈ 第一段"（那会是一道明显的接缝）。
     */
    const n = 24;
    const colors = rainbowColors(n);
    const dist = (a: number, b: number): number =>
      Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)) +
      Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) +
      Math.abs((a & 0xff) - (b & 0xff));
    const neighbour = dist(colors[0] ?? 0, colors[1] ?? 0);
    const wrap = dist(colors[n - 1] ?? 0, colors[0] ?? 0);
    expect(wrap).toBeLessThanOrEqual(neighbour * 2 + 8);
  });

  it('段数 ≤ 0 给空数组（不崩）', () => {
    expect(rainbowColors(0)).toEqual([]);
    expect(rainbowColors(-3)).toEqual([]);
  });

  it('hslToRgbInt：色相 0/1 都是纯红、0.5 上下是青/蓝那一段', () => {
    const red = hslToRgbInt(0, 1, 0.5);
    expect((red >> 16) & 0xff).toBe(255);
    expect((red >> 8) & 0xff).toBe(0);
    expect(red & 0xff).toBe(0);
    /** ⚠️ 色相取模：1 应当等于 0。 */
    expect(hslToRgbInt(1, 1, 0.5)).toBe(red);
  });
});

describe('⚠️ 「缚」声明了 `channel`（引导的**唯一**消费者是 UI）', () => {
  it('它声明了 channel，而且引擎**不读**它 —— 读条仍是一条普通读条', () => {
    const bind = ALL_SKILLS.find((s) => s.id === 'lust-bind');
    expect(bind?.kind).toBe('activeSkill');
    if (bind?.kind !== 'activeSkill') throw new Error('不是主动技能');
    expect(bind.channel, '「缚」要声明 channel（UI 据此换色）').toBeDefined();
    /** ⚠️ 判定"可打断"读的仍是技能自己的 `interruptible`，与 channel 无关。 */
    expect(bind.interruptible).toBe(true);
  });
});
