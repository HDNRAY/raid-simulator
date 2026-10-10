/**
 * **受击反馈的追踪器**（跨帧状态 + 老化）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 反馈这件事有三块知识，原先会全塞进 `viewAdapter.ts`（它已经贴着
 * 700 行上限）：
 *
 *   1. **通道怎么算** —— 纯函数，在 `render/feedback.ts`
 *   2. **跨帧怎么老化** —— 就是本文件
 *   3. **什么时候触发** —— 适配器的事件分支（读 `damage` / `avoided`）
 *
 * 分开之后每一块都能单独测：曲线测 `feedback.ts`，老化测本文件，
 * 事件接线留给集成测试。
 *
 * ==================================================================
 * ⚠️ 按**帧**老化，不按毫秒
 * ==================================================================
 *
 * 曲线（`recoilCurve`）的横轴是 0..1 的归一化进度，而推进它的是帧数。
 * 用毫秒会让同一段曲线在不同帧率下快慢不同；用帧则观感一致 ——
 * 代价是"15 帧"在 30fps 机器上是 0.5 秒、60fps 上是 0.25 秒，
 * 但那种机器本来就整体慢，相对节奏是对的。
 */

import {
  IDLE_FEEDBACK,
  damageIntensity,
  feedbackForDamage,
  recoilCurve,
  type FeedbackState,
} from '../render/feedback';

/** 受击反馈持续多少帧（≈0.25 秒 @60fps）。 */
export const HIT_FEEDBACK_FRAMES = 15;

/** 一次受击的原始记录（"发生了什么"，不含"现在该显示什么"）。 */
interface HitRecord {
  readonly intensity: number;
  readonly crit: boolean;
}

/**
 * 追踪两个角色各自的受击反馈。
 *
 * 用法：事件发生时 `note(target, amount, maxHp, crit)`，
 * 每帧末尾 `advance()`，取值时 `of(target)`。
 */
export class HitFeedbackTracker {
  private readonly records = new Map<string, HitRecord>();
  private readonly ages = new Map<string, number>();

  /**
   * 记一次受击。
   *
   * ⚠️ 用**比例**（`amount / maxHp`）当强度，所以暴击与重击自然更重，
   * 不需要为它们单独写一套反馈。见 `render/feedback.ts` 的说明。
   */
  note(targetId: string, amount: number, maxHp: number, crit = false): void {
    this.records.set(targetId, {
      intensity: damageIntensity(amount, maxHp),
      crit,
    });
    this.ages.set(targetId, 0);
  }

  /**
   * 每帧推进一步。过期的记录会被清掉（避免一直算）。
   *
   * ⚠️ 老化**先于**取值：`note` 时 age=0，若此时就取值，`recoilCurve(0)`
   * 是 0 —— 会看到"受击那一帧完全没反应"。推进到 1 之后才开始有形变。
   */
  advance(): void {
    for (const [id, age] of this.ages) {
      const next = age + 1;
      if (next > HIT_FEEDBACK_FRAMES) {
        this.ages.delete(id);
        this.records.delete(id);
      } else {
        this.ages.set(id, next);
      }
    }
  }

  /** 取某个角色这一帧该显示的反馈。没有受击时为中性状态。 */
  of(targetId: string): FeedbackState {
    const record = this.records.get(targetId);
    if (record === undefined) return IDLE_FEEDBACK;
    /**
     * 分母是 `FRAMES + 1`：age 从 1 走到 `FRAMES + 1`，于是进度**终点
     * 精确落在 1**（`recoilCurve(1) === 0`），角色一定能归位。
     */
    const progress = (this.ages.get(targetId) ?? 0) / (HIT_FEEDBACK_FRAMES + 1);
    const peak = feedbackForDamage(record.intensity, record.crit);
    return {
      /**
       * 顿帧**不做衰减曲线** —— 它要么在这一击的瞬间生效（让主循环
       * 暂停一下），要么不生效。给它一条曲线反而会让"卡顿"变成
       * "变慢"，那是两回事。
       */
      hitStopMs: peak.hitStopMs,
      recoilX: Math.round(peak.recoilX * recoilCurve(progress)),
      squashY: peak.squashY,
    };
  }
}
