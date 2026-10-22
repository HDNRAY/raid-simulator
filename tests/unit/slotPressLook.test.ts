import { describe, expect, it } from 'vitest';
import { holdingPulse, NO_PRESS, slotVisualOf } from '../../src/render/slotLook';
import { PALETTE } from '../../src/render/theme';
import { BLOCK_KEYS, type SkillSlotView } from '../../src/render/viewModel';

/**
 * **按下 / 按住**的视觉判据（2026-10-22，用户："按住「弹」……按钮也没有按住的
 * 视觉反馈，按了一下，和按住，都需要有，其他技能也是一样"）。
 *
 * ⚠️ 这里钉的是**机制**（优先级、色相切换、按住条的呼吸），不是具体色值 ——
 * 色号来自 `PALETTE.slot`，改配色不该让这里红。
 */
function slot(over: Partial<SkillSlotView> = {}): SkillSlotView {
  return {
    index: 0,
    key: 'q',
    skillId: 'dan',
    nameKey: 'skill.dan.name',
    icon: '',
    usable: true,
    cooldownRatio: 0,
    cooldownSec: 0,
    skillCdSec: 0,
    comboReady: false,
    ...over,
  };
}

describe('slotVisualOf：按下 / 按住', () => {
  it('没按 ⇒ 常态（不亮）', () => {
    const v = slotVisualOf(slot(), NO_PRESS);
    expect(v.pressed).toBe(false);
    expect(v.holding).toBe(false);
    expect(v.fill).toBe(PALETTE.slot.ready);
  });

  it('**按下** ⇒ 底色换亮石板、描边换焦点色（冷白，与常态一眼可分）', () => {
    const v = slotVisualOf(slot(), { pressed: true, holding: false });
    expect(v.pressed).toBe(true);
    expect(v.holding).toBe(false);
    expect(v.fill).toBe(PALETTE.slot.readyLine);
    expect(v.line).toBe(PALETTE.focus);
  });

  it('**按住** ⇒ 与按下同一档底色，但标记 holding（画法多一条底部条）', () => {
    const v = slotVisualOf(slot(), { pressed: true, holding: true });
    expect(v.holding).toBe(true);
    expect(v.fill).toBe(PALETTE.slot.readyLine);
  });

  it('⚠️ 优先级：**不可用 > 按住 > 按下** —— 冷却中的格子按住也不亮', () => {
    const cooling = slot({ usable: false, cooldownRatio: 0.5 });
    const v = slotVisualOf(cooling, { pressed: true, holding: true });
    expect(v.pressed).toBe(false);
    expect(v.holding).toBe(false);
    expect(v.fill).toBe(PALETTE.slot.ready);
  });

  it('⚠️ 买不起的格子同样不亮（按不动的一格变亮 = 骗玩家）', () => {
    const poor = slot({ usable: false, blockedKey: BLOCK_KEYS.cost });
    const v = slotVisualOf(poor, { pressed: true, holding: true });
    expect(v.pressed).toBe(false);
    expect(v.fill).toBe(PALETTE.slot.blocked);
  });

  it('快照里没有这一格 ⇒ 最暗那档，且不带按下反馈', () => {
    const v = slotVisualOf(undefined, { pressed: true, holding: true });
    expect(v.fill).toBe(PALETTE.slot.blocked);
    expect(v.pressed).toBe(false);
  });
});

describe('holdingPulse：按住时的呼吸（用战斗 tick，不用墙钟）', () => {
  it('取值恒在 0.7..1 之间，且 1 秒（10 tick）一个周期', () => {
    for (let tick = 0; tick < 40; tick += 1) {
      const a = holdingPulse(tick);
      expect(a).toBeGreaterThanOrEqual(0.7);
      expect(a).toBeLessThanOrEqual(1);
    }
    /** 周期 10 tick ⇒ 0 与 10 同值、5 处最小 */
    expect(holdingPulse(0)).toBeCloseTo(holdingPulse(10), 6);
    expect(holdingPulse(5)).toBeLessThan(holdingPulse(0));
  });
});
