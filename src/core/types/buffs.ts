/** Buff / Debuff —— 与修正器同模型，`polarity` 只影响 UI 颜色。 */

import type { BuffId, CombatantId, LocaleKey, SkillId } from './ids';
import type { StatModifier } from './stats';
import type { SkillTag, TriggerDef } from './triggers';

/* ================================================================== *
 * 4. Buff / Debuff
 * ================================================================== */

/**
 * Buff 与 Debuff 是**同一个模型**，`polarity` 只影响 UI 颜色。
 *
 * 理由：一个"受到更多伤害"的效果，从施加者看是 debuff，
 * 从目标看只是一条 `vulnerability` 修正。修正本身没有正负，只有方向。
 */
export type Polarity = 'buff' | 'debuff' | 'neutral';

/** 叠层规则。默认 `refresh`。 */
export type StackingRule =
  | { readonly mode: 'refresh' }
  | { readonly mode: 'stack'; readonly max: number }
  | { readonly mode: 'stackRefresh'; readonly max: number }
  | { readonly mode: 'independent'; readonly max: number }
  | { readonly mode: 'replace' }
  | { readonly mode: 'extend'; readonly maxDurationMs: number };

/**
 * 判定旗标。闪避/卸力/限制/派生**全部落在数据上**，零新引擎机制：
 * `invulnerable` · `damageReduce` · `damageThreshold` · `restrictToTags` ·
 * `comboWindow`。
 */
export interface BuffFlags {
  readonly invulnerable?: boolean;
  readonly damageReduce?: number;
  /**
   * **阈值抵消**（林晚风「卸」）。
   *
   * ==================================================================
   * 这是"判定层"的第三种形态，前两种都已在引擎里
   * ==================================================================
   *
   * | flag | 语义 | 已有实现 |
   * |---|---|---|
   * | `invulnerable` | **整击作废**（伤害与效果一起丢） | ✓ `avoided` 通路 |
   * | `damageReduce` | **按比例**减（乘法） | ✓ `computeDamage` |
   * | `damageThreshold`（本字段） | **≤N 整击作废；>N 平减 N 点** | 🆕 2026-10-12 |
   *
   * 所以它不是"又一套防御系统"：**两半都复用已有通路** ——
   * `≤N` 那一半走 `invulnerable` 用的同一条 `avoided` 判定
   * （因此"连眩晕这类效果一起免"是**天然**的，不是新写的），
   * `>N` 那一半接在 `damageReduce` 旁边做一次**平减**。
   *
   * ⚠️ **判据是"这一击的伤害值"**，由 `computeDamage` 先算出
   * `preBlock`（含增伤/易伤/暴击，不含防御侧减免）再与它比较。
   * 多段攻击**每段各判一次**。
   *
   * ⚠️ 值必须来自 `data/balance.ts` 的具名常量（`GUARD_THRESHOLD`），
   * 不要在内容里散落魔法数 —— 用户明确说这个数会来回调（15 → 10）。
   *
   * ⚠️ 多个来源**取最大值**（与 `damageReduce` 同一条理由：
   * 相加会越过"完全免疫"，而且玩家无法预期）。
   */
  readonly damageThreshold?: number;
  readonly ccImmune?: boolean;
  readonly interruptImmune?: boolean;
  /**
   * 派生窗口：**只有这个 buff 在时，列表里的技能才被激活**（与
   * `restrictToTags` 方向相反，见本接口头部）。
   */
  readonly comboWindow?: readonly SkillId[];
  /**
   * **这次派生是从哪个技能来的** —— UI 靠它把派生技画在原技能上方。
   *
   * ⚠️ 记在 buff 上而不是技能的静态字段：同一个派生技可能由多个源
   * 技能派生，而"后派生的顶掉先派生的"意味着**源是动态的** ——
   * buff 刷新时 flags 一起被覆盖，顶掉是天然的。
   */
  readonly comboWindowSource?: SkillId;
  /** 动作锁：期间不能施放任何技能（施法僵直） */
  readonly actionLock?: boolean;
  /**
   * **技能 tag 白名单（限制）**：期间**只能**施放带这些 tag 之一的技能，
   * 多个来源取并集。见 `KNOCKDOWN`（「倒地」）。
   *
   * ⚠️ 与「派生」是**两种机制**：限制是**负向、排除、全局**
   * （"除了白名单都不行"），派生是**正向、激活、单技**
   * （"只有 buff 在时这个技能才被激活"）。
   */
  readonly restrictToTags?: readonly SkillTag[];
}

/** buff 的视觉提示，渲染层据此播特效。 */
export interface BuffVfx {
  readonly aura?: string;
  readonly onApply?: string;
  readonly onExpire?: string;
}

export interface BuffDef {
  readonly id: BuffId;
  readonly nameKey: LocaleKey;
  readonly icon: string;
  readonly polarity: Polarity;
  /**
   * 图标占位颜色（0xRRGGBB）。
   *
   * 当前美术素材是**单色方块占位**，所以这个值就是玩家看到的东西。
   * 不做成"按 polarity 自动推导"是因为内容作者需要区分同极性的
   * 不同 buff（例如"无敌"要橙、"急速"要青）。
   */
  readonly color?: number;
  /**
   * 隐藏：**不在 UI 的 buff 条上显示图标**。
   *
   * 用于引擎内部标记（公共冷却、Boss 前摇）—— 它们不是"玩家应该看到的
   * 增益/减益"，而是引擎状态，UI 已经用别的方式表达
   * （按钮变灰、预警条）。不隐藏就会在图标条上挂一串无意义的灰块。
   */
  readonly hidden?: boolean;
  /** ms。`Number.POSITIVE_INFINITY` 表示永久。 */
  readonly duration: number;
  readonly maxStacks: number;
  readonly stacking: StackingRule;
  readonly modifiers?: readonly StatModifier[];
  readonly flags?: BuffFlags;
  /**
   * 伤害倍率（乘在最终伤害上）。狂暴这类"整体变强"用它。
   *
   * 放在 buff 上而不是写成一条 `damageMult` 修正，是因为它表达的是
   * "这个单位的输出整体 ×N"，与"某条修正贡献多少"不是一回事 ——
   * 后者参与修正池聚合，前者是一个整体开关。
   */
  readonly damageMultBoost?: number;
  readonly triggers?: readonly TriggerDef[];
  readonly vfx?: BuffVfx;
  readonly dispellable?: boolean;
  /** 互斥标签：同标签的 buff 只能存在一个 */
  readonly tags?: readonly string[];
}

/** 运行时 buff 实例。**只存实例状态，不存数值快照。** */
export interface BuffInstance {
  /** 唯一。同一 `defId` 可以有多份（G4）。 */
  readonly instanceId: string;
  readonly defId: BuffId;
  /**
   * 内容定义（不可变，可安全共享引用）。
   *
   * 为什么不只存 `defId`：引擎需要一个 defId → BuffDef 的解析途径。
   * 内容**定义**是不可变对象，引用它不会破坏"状态可结构化克隆"
   * （结构化克隆会复制它），也不会破坏可哈希性（哈希看的是值）。
   * 数值仍然**不在**这里 —— 派生值每次重新求值。
   */
  readonly def?: BuffDef;
  readonly stacks: number;
  /** 施加时刻（tick） */
  readonly appliedAtTick: number;
  /** 过期时刻（tick，绝对）。`Infinity` 表示永久。 */
  readonly expiresAtTick: number;
  readonly sourceId: CombatantId;
  /** 每个 trigger 的内置 CD 记录：triggerKey → 下次可用 tick */
  readonly triggerCooldowns: Record<string, number>;
  /** 剩余触发次数：triggerKey → 剩余 */
  readonly triggerCounts: Record<string, number>;
}
