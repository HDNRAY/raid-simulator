/** 技能定义与内容基类（`Cost` / `GameEntity` / `SkillDef`）。 */

import type { EntityId, LocaleKey, SkillId } from './ids';
import type { ResourceKey, ResourcePool } from './resources';
import type { Condition, Expr } from './stats';
import type { Ability } from './abilities';
import type { SkillTag } from './triggers';
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
  /**
   * 自己的资源池（使用次数、充能住这里）。
   *
   * ⚠️ **引擎尚未实现**：计数器没有任何写入者，读 `Expr.counter` 的
   * `getCounter` 是 `() => 0` 的桩 —— 写了 `pool.counters` 不会有运行期
   * 效果，而内容里用 `Expr.counter` 会被校验器拒（`COUNTER_UNIMPLEMENTED`）。
   * 见 `resources.ts` 里 `Counter` / `ResourcePool` 的说明。
   */
  readonly pool?: ResourcePool;
  readonly rarity?: Rarity;
  readonly requires?: readonly Condition[];
  /**
   * ⚠️ 这里**曾经**有个 `hintTags?: readonly HintTag[]`（手写玩法提示），
   * 已**整个删除**。
   *
   * 删它的理由与上面那个 `tags?: readonly string[]` 一样（"死值先删"），
   * 但更硬：它是一份**与效果冗余**的数据，于是必然漂 ——
   *   - 漏标：「碾压」会倒地、「魅惑」会眩晕，都没写
   *   - 错标：「魅惑」根本没有伤害，却写着「高伤」
   *
   * 现在提示**全部从技能自己的声明推导**（`app/skillHints.ts`）：
   * 打断看 `interrupt` 效果、控制看 debuff 的 `flags`、霸体看
   * `interruptImmune`、高伤按伤害阈值。**没有第二份数据要同步。**
   */
}

export interface EquipmentEntity extends GameEntity {
  readonly kind: 'equipment';
  readonly slot: EquipSlot;
  /** 可同时装备多份 */
  readonly multiEquip?: boolean;
  /**
   * 授予的主动技能。
   *
   * ⚠️ **引擎目前没有消费者，本字段是设计稿。** 它说"规范化后变成
   * grantSkill ability"，而那条规范化**从来没有实现**：`grantSkill`
   * 这个 kind 有类型、有校验，但没有任何执行点（见
   * `abilities.ts` 里 `GrantSkillAbility` 的说明）；装备系统整体
   * 也还没接线（见 `loadout.ts` 的 `Loadout`）。
   *
   * 唯一读它的是内容校验器：检查这里引用的技能 id 存在
   * （`validate.ts` 里的 `grantsSkills`）。**别以为写了它就装上了技能。**
   *
   * ⚠️ 而 `grantSkill` ability 本身会被 `ABILITY_UNIMPLEMENTED` 拒绝
   * （它没有执行点），所以要写这条设计稿只能显式 `{ strict: false }`。
   */
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
   * 「按住」技能：按住期间**每个逻辑步**扣 `perLogicTick` 点资源。
   *
   * 用于「卸」这类持续防御 —— 它的代价不是"施放一次"而是"一直按着"。
   * 资源耗尽或松手都会让效果中止（引擎在 `tickHolds` / `endHold` 处理）。
   *
   * ⚠️ `perLogicTick` **允许是小数**（「卸」= 1.5 = 15 炁/秒 ÷ 10 步）。
   * 界面写的是"每秒多少"，换算由 `core/combat/holds.ts` 的
   * `holdDrainPerSecond()` 单向提供；别在显示处自己 `* 10`。
   *
   * ⚠️ 小数代价**不能**直接进 `changeResource`（`Math.round` 会把每步的
   * 小数部分舍掉，静默少扣）；引擎用整数欠账累加器结算，所以
   * "按住 1 秒 = 恰好 15 炁"。
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
