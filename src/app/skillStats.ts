/**
 * **技能的"结构化数值"**（2026-10-22，用户："boss详情里，技能有显示 cd和读条时间吗，
 * 我希望显示，结构化显示，可以有不同颜色"）。
 *
 * ==================================================================
 * 它是什么（一句话）
 * ==================================================================
 *
 * 把一个 `SkillDef` 的**前摇 / 冷却 / 代价**抽成**三个槽位**（`DetailStat`），
 * 交给详情面板单独画一行 —— 数字从内容来，**不是**从说明文案里抓。
 *
 * ⚠️ **为什么不让说明文案顺手把这些数写出来**：说明是散文（"0.8 秒前摇，
 * 造成 20 点伤害，冷却 3 秒、可打断"），改一次平衡就得改文案；而结构化这一行
 * 是**从 `castTime` / `cooldown` / `cost` 直接算的**，改数值它自动跟着变 ✓。
 *
 * ⚠️ 分工（这一轮之后）：**数值看这一行，说明看正文**。正文里的数字仍留着
 * （那是散文，读起来才顺），但**唯一真相是这一行** —— 两者不一致时以它为准。
 *
 * ⚠️ 0 值**不显示**（`castTime === 0` 的瞬发技能不写"前摇 0 秒"，
 * 没有冷却的不写"冷却 0 秒"）：那不是信息，是噪声。
 */

import type { SkillDef } from '../core/types';
import { displaySeconds } from './displayTime';

/** 结构化数值的三种槽位（每一种在图上有自己的颜色，见 `ui/detailStats`）。 */
export type SkillStatKind = 'cast' | 'cooldown' | 'cost';

/** 一条结构化数值。 */
export interface SkillStat {
  readonly kind: SkillStatKind;
  /** `cast` / `cooldown` 用：秒数（已折到 0.1 秒刻度）。 */
  readonly seconds?: number;
  /** `cost` 用：资源名（`energy` / `douqi`）。 */
  readonly resourceKey?: string;
  /** `cost` 用：数量（已按显示刻度）。 */
  readonly amount?: number;
}

/**
 * 一个技能的结构化数值（顺序固定：前摇 → 冷却 → 代价）。
 *
 * ⚠️ 只有**主动技能**有这些字段（`SkillDef` 的联合里被动技能没有 `castTime`）
 * ⇒ 被动技能返回空数组，详情面板那一行自然不画 ✓。
 */
export function skillStatsOf(skill: SkillDef): readonly SkillStat[] {
  if (skill.kind !== 'activeSkill') return [];
  const out: SkillStat[] = [];
  if (skill.castTime > 0) {
    out.push({ kind: 'cast', seconds: displaySeconds(skill.castTime) });
  }
  if (skill.cooldown > 0) {
    out.push({ kind: 'cooldown', seconds: displaySeconds(skill.cooldown) });
  }
  for (const cost of skill.cost ?? []) {
    /**
     * ⚠️ `cost.value` 的类型是 `number | Expr`（允许写成表达式）。详情区是
     * **静态显示**，表达式没法在这里求值（要战斗状态）⇒ 只显示字面量；
     * 表达式那种今天没有内容用（全部是 `S(n)`），真出现时这一行缺席比
     * 显示一个假的数字好。
     */
    if (typeof cost.value !== 'number' || cost.value <= 0) continue;
    out.push({ kind: 'cost', resourceKey: String(cost.resource), amount: cost.value });
  }
  return out;
}
