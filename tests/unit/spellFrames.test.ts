import { describe, expect, it } from 'vitest';

import type { SpellFrameGeometry } from '../../src/render/spellFrames';
import {
  nextSpellGroup,
  spellFrameAtElapsed,
  spellFrameGroupCount,
  spellFrameGroupStarts,
} from '../../src/render/spellFrames';

/**
 * **法术动画的帧组**（2026-10-22，圣光弹 `FDOTHER_028`）。
 *
 * ⚠️ 测试**不读** `public/fd2/`（那是 gitignore 的素材，CI 上没有）。
 * 这里用**合成数据**复刻 028 的几何模式（4 组 × 8 帧、每组第 3 帧回到 41×41），
 * 钉的是"**怎么切组**"这条算术，不是某个素材文件。
 */

/** 028 的 (w,h) 模式：2 帧光带 + 6 帧膨胀星爆。 */
const ONE_GROUP: readonly SpellFrameGeometry[] = [
  { x: 0, y: 0, width: 122, height: 42 },
  { x: 0, y: 0, width: 250, height: 128 },
  { x: 0, y: 0, width: 41, height: 41 },
  { x: 0, y: 0, width: 85, height: 63 },
  { x: 0, y: 0, width: 113, height: 90 },
  { x: 0, y: 0, width: 122, height: 98 },
  { x: 0, y: 0, width: 131, height: 102 },
  { x: 0, y: 0, width: 143, height: 111 },
];

const FOUR_GROUPS = [...ONE_GROUP, ...ONE_GROUP, ...ONE_GROUP, ...ONE_GROUP];

describe('帧组切分（按几何周期，不硬编码）', () => {
  it('4 组 × 8 帧 ⇒ 起点是 0/8/16/24', () => {
    expect([...spellFrameGroupStarts(FOUR_GROUPS)]).toEqual([0, 8, 16, 24]);
    expect(spellFrameGroupCount(FOUR_GROUPS)).toBe(4);
  });

  it('单组（没有周期）⇒ 只有起点 0', () => {
    expect([...spellFrameGroupStarts(ONE_GROUP)]).toEqual([0]);
    expect(spellFrameGroupCount(ONE_GROUP)).toBe(1);
  });

  it('尾部多两帧（不整除）⇒ 仍然是 4 组，**尾巴归最后一组**', () => {
    /**
     * ⚠️ 判据是"每组都从**最小的一帧**开始膨胀"，不是"整段严格周期性重复"
     * —— 所以尾巴帧不会把分组搞坏（第一版用严格周期，在真实素材上一条都
     * 匹配不上，因为四组之间有 2~6 像素的差）。
     */
    const tail = ONE_GROUP.slice(0, 2);
    const ragged = [...FOUR_GROUPS, ...tail];
    expect([...spellFrameGroupStarts(ragged)]).toEqual([0, 8, 16, 24]);
  });

  it('⚠️ 真实素材的形态（四组只差几个像素）也能切出来', () => {
    /** 复刻 028：四组的 (w,h) 各差 2 像素 —— 严格相等会全部匹配不上。 */
    const withJitter = [
      ...ONE_GROUP,
      ...ONE_GROUP.map((f) => ({ x: 0, y: 0, width: f.width, height: f.height - 2 })),
      ...ONE_GROUP.map((f) => ({ x: 0, y: 0, width: f.width, height: f.height + 4 })),
      ...ONE_GROUP.map((f) => ({ x: 0, y: 0, width: f.width, height: f.height - 6 })),
    ];
    expect([...spellFrameGroupStarts(withJitter)]).toEqual([0, 8, 16, 24]);
  });

  it('空 / 单帧的边界', () => {
    expect([...spellFrameGroupStarts([])]).toEqual([]);
    expect(spellFrameGroupCount([])).toBe(1);
    const single = ONE_GROUP[0];
    expect(single).toBeDefined();
    expect(single === undefined ? [] : [...spellFrameGroupStarts([single])]).toEqual([0]);
  });
});

describe('每次伤害播下一组（用户："按顺序"）', () => {
  it('第一次是第 0 组，之后 +1，到末尾回到 0', () => {
    expect(nextSpellGroup(undefined, 4)).toBe(0);
    expect(nextSpellGroup(0, 4)).toBe(1);
    expect(nextSpellGroup(3, 4)).toBe(0);
  });
});

describe('组内按 delay 加权取帧', () => {
  it('全 1 的 delay ⇒ 每 1 个时间单位换一帧', () => {
    const delays = [1, 1, 1];
    expect(spellFrameAtElapsed(delays, 0)).toBe(0);
    expect(spellFrameAtElapsed(delays, 1.5)).toBe(1);
    expect(spellFrameAtElapsed(delays, 2.5)).toBe(2);
    /** 超过末尾 ⇒ 停在最后一帧（不越界）。 */
    expect(spellFrameAtElapsed(delays, 999)).toBe(2);
  });

  it('某帧 delay 更长 ⇒ 它会多停一会儿', () => {
    const delays = [1, 3, 1];
    expect(spellFrameAtElapsed(delays, 0.5)).toBe(0);
    expect(spellFrameAtElapsed(delays, 1.5)).toBe(1);
    expect(spellFrameAtElapsed(delays, 3.5)).toBe(1);
    expect(spellFrameAtElapsed(delays, 4.5)).toBe(2);
  });
});
