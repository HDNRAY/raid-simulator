/** 技能定义与内容基类（`Cost` / `GameEntity` / `SkillDef`）。 */

import type { EntityId, LocaleKey, SkillId } from './ids';
import type { ResourceKey, ResourcePool } from './resources';
import type { Condition, Expr } from './stats';
import type { Ability } from './abilities';
import type { HintTag, SkillTag } from './triggers';
import type { HitDef, TargetRule } from './effects';

/* ================================================================== *
 * 8. 技能
 * ================================================================== */

export interface Cost {
  readonly resource: ResourceKey | string;
  readonly value: number | Expr;
  /** 资源不足时是否仍可施放（血量代价这类） */
  readonly allowOverdraft?: boolean;
}

/** 引导技能：持续施法，按间隔跳。 */
export interface ChannelDef {
  readonly durationMs: number;
  readonly tickIntervalMs: number;
}

/** 多充能技能。 */
export interface ChargesDef {
  readonly max: number;
  readonly rechargeMs: number;
}

/* ================================================================== *
 * 9. GameEntity —— 一切内容的公共基类
 * ================================================================== */

export type EntityKind =
  | 'equipment'
  | 'consumable'
  | 'passive'
  | 'buffTemplate'
  | 'activeSkill'
  | 'encounter';

export type EquipSlot = 'weapon' | 'armor' | 'trinket' | 'relic' | 'relic2';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/**
 * 一切可持有 / 可使用内容的公共基类。
 *
 * 叫 `GameEntity` 而不是 `AbilitySource`：内容还要表达"它是什么"、
 * "能不能持有"、"能不能使用"、"有没有使用次数"，不只是"能力的容器"。
 */
export interface GameEntity {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly nameKey: LocaleKey;
  readonly icon: string;
  readonly descKey?: LocaleKey;
  readonly abilities: readonly Ability[];
  /** 自己的资源池：使用次数、充能住这里 */
  readonly pool?: ResourcePool;
  readonly rarity?: Rarity;
  readonly requires?: readonly Condition[];
  /**
   * 玩法提示标签（显示在读条/技能格上）。
   *
   * ⚠️ 与 `SkillDef.tags`（机械分类）是**两个字段、两套取值，都要维护**
   * —— 理由见 `HintTag` / `SkillTag` 的说明。
   * ⚠️ 这里曾有个无类型约束的 `tags?: readonly string[]`（零消费者），
   * 已按"死值先删"删除。
   */
  readonly hintTags?: readonly HintTag[];
}

export interface EquipmentEntity extends GameEntity {
  readonly kind: 'equipment';
  readonly slot: EquipSlot;
  /** 可同时装备多份 */
  readonly multiEquip?: boolean;
  /** 授予的主动技能（规范化后变成 grantSkill ability） */
  readonly grantsSkills?: readonly SkillId[];
}

export interface ConsumableEntity extends GameEntity {
  readonly kind: 'consumable';
  readonly destroyOnEmpty: boolean;
  readonly cooldownMs: number;
}

export interface PassiveEntity extends GameEntity {
  readonly kind: 'passive';
  /** 主动天赋本质上就是一个技能，引用之 */
  readonly skillId?: SkillId;
}

/**
 * 主动 / 被动技能定义。
 *
 * **被动技能是一等公民**：就是 `kind: 'passive'` 的实体，
 * 效果写在继承来的 `abilities` 里，不需要额外字段。
 * （旧项目的 `Talent` 是个 `costs: any, effects: any` 的空壳，
 * 所以"被动技能"从来无法表达。）
 */
export interface SkillDef extends GameEntity {
  readonly kind: 'activeSkill' | 'passive';
  /** 0 = 瞬发 */
  readonly castTime: number;
  readonly channel?: ChannelDef;
  /** 0 = 无 CD */
  readonly cooldown: number;
  readonly charges?: ChargesDef;
  readonly cost: readonly Cost[];
  /**
   * 「按住」技能：按住期间**每个逻辑步**扣一次资源。
   *
   * 用于「防」这类持续防御 —— 它的代价不是"施放一次"而是"一直按着"。
   * 资源耗尽或松手都会让效果中止（引擎在 `holdTick` / `releaseKey` 处理）。
   *
   * 资源量用**内部刻度**（已乘 `DISPLAY_SCALE`）。
   */
  readonly holdDrain?: {
    readonly resource: ResourceKey | string;
    readonly perLogicTick: number;
  };
  readonly targeting: TargetRule;
  readonly hits: readonly HitDef[];
  readonly tags: readonly SkillTag[];
  readonly interruptible: boolean;
}
