import { describe, expect, it } from 'vitest';
import {
  IDLE_FEEDBACK,
  damageIntensity,
  feedbackForDamage,
  recoilCurve,
} from '../../src/render/feedback';
import { HitFeedbackTracker, HIT_FEEDBACK_FRAMES } from '../../src/app/hitFeedback';

/**
 * 受击反馈的统一模型。
 *
 * 需求："玩家闪避（有了），防御（目前有一个变矮），但是受击，被眩晕，
 * 和 boss 受击，都没啥好的反馈，我需要一个统一的设计。"
 */
describe('强度：用比例，不用档位', () => {
  it('普通伤害 = 伤害 ÷ 最大生命', () => {
    expect(damageIntensity(30, 120)).toBeCloseTo(0.25);
  });

  it('【关键】`maxHp = 0` 返回 0，**不是 NaN 或 Infinity**', () => {
    /**
     * ⚠️ 这是防御性断言，不是形式主义：`NaN` 传给 Pixi 的 `x` / `scale`
     * 会让节点**整个消失**（不是显示错，是不显示）。而那正是我刚修过的
     * "玩家看不到"那类 bug 的观感 —— 很难从画面上反推是数值问题。
     */
    expect(damageIntensity(10, 0)).toBe(0);
    expect(damageIntensity(10, -5)).toBe(0);
    expect(damageIntensity(0, 100)).toBe(0);
    expect(Number.isFinite(damageIntensity(10, 0))).toBe(true);
  });

  it('强度封顶 1（伤害超过最大生命时）', () => {
    expect(damageIntensity(500, 100)).toBe(1);
  });
});

describe('通道：伤害该产生哪些反馈', () => {
  it('强度越高，顿帧越长、反冲越远、压得越扁', () => {
    const light = feedbackForDamage(0.05);
    const heavy = feedbackForDamage(0.9);
    expect(heavy.hitStopMs).toBeGreaterThan(light.hitStopMs);
    expect(heavy.recoilX).toBeGreaterThan(light.recoilX);
    expect(heavy.squashY).toBeLessThan(light.squashY);
  });

  it('【关键】顿帧上限压在 70ms 以内（触屏上不能像"没反应"）', () => {
    const max = feedbackForDamage(1, true);
    expect(max.hitStopMs).toBeLessThanOrEqual(70);
    // 下限也要有感知（不能是 0，否则"顿帧"没发生）
    expect(feedbackForDamage(0).hitStopMs).toBeGreaterThan(0);
  });

  it('暴击比同强度非暴击更重', () => {
    expect(feedbackForDamage(0.3, true).hitStopMs).toBeGreaterThan(
      feedbackForDamage(0.3, false).hitStopMs,
    );
  });

  it('挤压不会压到 0（角色不能消失）', () => {
    for (const i of [0, 0.5, 1, 2]) {
      expect(feedbackForDamage(i).squashY).toBeGreaterThan(0.8);
    }
  });
});

describe('反冲曲线：先冲出去、过冲回弹、归位', () => {
  it('起点在 0，先到峰值 1', () => {
    expect(recoilCurve(0)).toBeCloseTo(0);
    expect(recoilCurve(0.25)).toBeCloseTo(1);
  });

  it('【关键】中段会**穿过零点回弹**（过冲），不是直接归零', () => {
    /**
     * 需求要的是"好的反馈" —— 直接归零看起来是"移过去又移回来"，
     * 有过冲才像"被打退、晃了一下"。
     * ⚠️ 探针点取 **0.6**（实测过冲最深在 rest=0.4，对应 p≈0.55；
     * 0.5 处曲线刚过零点、只有 +0.083）。第一版我随手取 0.5 断言，
     * 失败后才发现是**参数算错**而不是测试写错。
     */
    expect(recoilCurve(0.5)).toBeLessThan(0.2);
    expect(recoilCurve(0.6)).toBeLessThan(0);
  });

  it('终点回到 0（否则角色会停在偏移位置）', () => {
    expect(recoilCurve(1)).toBeCloseTo(0);
  });

  it('输入越界被钳住，不产生 NaN', () => {
    for (const p of [-1, 2, Number.NaN]) {
      expect(Number.isFinite(recoilCurve(p))).toBe(true);
    }
  });
});

describe('追踪器：按帧老化，两个角色互不干扰', () => {
  it('受击后取出反馈，老化完回到静止', () => {
    const t = new HitFeedbackTracker();
    t.note('boss', 30, 120);
    // ⚠️ 先推进一帧再取值 —— age=0 时 `recoilCurve(0)` 是 0（见 advance 的说明）
    t.advance();
    expect(t.of('boss').recoilX).toBeGreaterThan(0);
    for (let i = 0; i <= HIT_FEEDBACK_FRAMES; i += 1) t.advance();
    expect(t.of('boss')).toEqual(IDLE_FEEDBACK);
  });

  it('【关键】打 Boss 不会让玩家也抖 —— 强度按**目标**分别记', () => {
    const t = new HitFeedbackTracker();
    t.note('boss', 30, 120);
    t.advance();
    expect(t.of('player')).toEqual(IDLE_FEEDBACK);
    expect(t.of('boss').recoilX).toBeGreaterThan(0);
  });

  it('没受击过的角色一律静止（新 Boss / 换场景时不会残留）', () => {
    expect(new HitFeedbackTracker().of('anyone')).toEqual(IDLE_FEEDBACK);
  });
});
