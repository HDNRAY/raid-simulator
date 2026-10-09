/**
 * 引擎的数据模型类型定义。
 *
 * **本文件只允许出现类型，不允许有任何运行时实现。**
 * 这样做的目的：M1-1 的验收标准就是"tsc 通过"——
 * 编译器会把类型之间的不一致全部暴露出来（比写实现时才发现便宜得多）。
 *
 * 规范的权威版本在 docs/specs/2026-10-09-data-model.md，
 * 这里落地时如与规范冲突，以本文件为准并回头修订规范。
 *
 * 分层（数据模型规范 §1）：
 *   内容定义（不可变）  GameEntity / SkillDef / BuffDef / Ability[]
 *   运行时状态（可变）  BattleState / Combatant / BuffInstance
 *   事件（只读输出）    EventDef / Hook
 */

/* ================================================================== *
 * 1. 基础标识
 * ================================================================== */

/**
 * 文案 key。
 *
 * **由 core 自己定义，而不是从 i18n 层 import** —— 这是 lint 约束（C1/I3）
 * 逼出来的正确分层：接口的形状由**消费者**声明，实现方负责满足它。
 * i18n 层有一个编译期断言证明 `MessageKey` 满足这个形状，
 * 所以内容作者写错 key 仍然会在编译期被拒。
 *
 * 引擎只**持有** key，不解析、不碰文案（i18n 规范 §2）。
 */
export type LocaleKey = string;

export type CombatantId = string;
export type EntityId = string;
export type SkillId = string;
export type BuffId = string;
export type ModifierNamespace = string;

export type Side = 'ally' | 'enemy';

/* ================================================================== *
 * 2. 资源
 * ================================================================== */

/** 具名资源。有上限、会回复的那几种。 */
/**
 * 具名资源。
 *
 * 只有两种玩家资源：**精力**（短循环、衰减快，用于常规技能）
 * 与**斗炁**（积攒型，用于高威力技能）。
 * 刻意不做"魔法值"——多一种资源只会让 UI 与循环都更啰嗦。
 */
export type ResourceKey = 'hp' | 'energy' | 'douqi';

/**
 * 离散计数器（使用次数、充能、弹药……）。
 *
 * 使用次数做成资源而不是独立字段（数据模型规范 §2.2）：
 * "用 1 次的药水"就是 `uses: { current: 1, max: 1 }`，
 * 于是消耗、回复、UI 显示、事件全部复用同一套机制。
 */
export interface Counter {
  readonly current: number;
  readonly max: number;
}

/** 任何实例都可以有自己的资源池。 */
export interface ResourcePool {
  readonly hp?: number;
  readonly energy?: number;
  readonly douqi?: number;
  /** 自定义离散资源，键名由内容作者定义（'uses' / 'charges' / 'ammo' …） */
  readonly counters?: Readonly<Record<string, Counter>>;
}

/** 资源池的引用：角色的 / 内容实例自己的 / 整场共享的。 */
export type ResourcePoolRef =
  | { readonly kind: 'combatant'; readonly combatantId: CombatantId }
  | { readonly kind: 'entity'; readonly entityInstanceId: string }
  | { readonly kind: 'encounter' };

/* ================================================================== *
 * 3. 属性与修正
 * ================================================================== */

/** 主属性 */
export type PrimaryStat = 'strength' | 'agility' | 'intelligence' | 'spirit';

/** 全部可被修正的属性。 */
export type StatKey =
  | PrimaryStat
  // 资源上限 / 回复
  | 'maxHp'
  | 'maxEnergy'
  | 'maxDouqi'
  | 'hpRegen'
  | 'energyRegen'
  | 'douqiRegen'
  // 次级属性
  | 'critChance'
  | 'critDamage'
  | 'haste'
  | 'armor'
  | 'tenacity'
  | 'castSpeed'
  | 'cooldownRate'
  // 伤害 / 治疗修饰
  | 'damageBoost'
  | 'damageMult'
  | 'physicalBoost'
  | 'spellBoost'
  | 'dotBoost'
  | 'directBoost'
  | 'critDamageBoost'
  | 'armorPen'
  | 'vulnerability'
  | 'damageTakenMult'
  | 'healingBoost'
  | 'shieldBoost';

/**
 * 修正的运算方式。
 *
 * `damageBoost` 用 `addPercent`（相加）：两个 +10% 得到 +20%，
 * 玩家算得清、数值不失控。`damageMult` 用 `mult`（相乘）：
 * 表达"最终伤害 ×2"这种语义。**两种都由数据选，引擎不猜。**
 */
export type Op =
  | 'add'
  | 'mult'
  | 'addPercent'
  | 'max'
  | 'setOverride'
  | 'perStackAdd';

/** 修正的来源层级（用于 UI 分组与排序）。 */
export type ModifierTier = 'base' | 'talent' | 'item' | 'buff' | 'debuff' | 'temp';

/** 表达式的求值对象。 */
export type Who = 'self' | 'target' | 'caster' | 'source';

/* ------------------------------------------------------------------ *
 * 3.1 表达式
 * ------------------------------------------------------------------ */

/**
 * 结构化表达式。
 *
 * 为什么不用 `number | ((ctx) => number)`（旧项目的做法）：
 * 函数**无法序列化** —— 存不了档、测不了、内容作者改不了，
 * 而且不可能做到"动态重算"。所以值是数据结构。
 */
export type Expr =
  | { readonly e: 'const'; readonly value: number }
  | { readonly e: 'stat'; readonly who: Who; readonly stat: StatKey }
  | { readonly e: 'resource'; readonly who: Who; readonly resource: ResourceKey }
  | { readonly e: 'maxResource'; readonly who: Who; readonly resource: ResourceKey }
  | { readonly e: 'resourceRatio'; readonly who: Who; readonly resource: ResourceKey }
  | { readonly e: 'missingResourceRatio'; readonly who: Who; readonly resource: ResourceKey }
  | { readonly e: 'buffStacks'; readonly who: Who; readonly buffId: BuffId }
  | { readonly e: 'hasBuff'; readonly who: Who; readonly buffId: BuffId }
  | { readonly e: 'counter'; readonly ref: ResourcePoolRef; readonly counter: string }
  /**
   * 引用某个**命名空间**下所有修正的当前值之和。
   *
   * 这是"值不是写死的"的关键机制：暴击触发的 buff 要提供
   * "和某件装备当前增伤一样多"时，引用命名空间而不是写常量，
   * 也而不是引用数组下标（后者会被内容调整顺序破坏）。
   */
  | { readonly e: 'contrib'; readonly namespace: ModifierNamespace; readonly fallback?: number }
  | { readonly e: 'add'; readonly of: readonly Expr[] }
  | { readonly e: 'mul'; readonly of: readonly Expr[] }
  | { readonly e: 'min'; readonly of: readonly Expr[] }
  | { readonly e: 'max'; readonly of: readonly Expr[] }
  | { readonly e: 'clamp'; readonly value: Expr; readonly min: Expr; readonly max: Expr }
  | { readonly e: 'neg'; readonly value: Expr }
  | { readonly e: 'cond'; readonly if: Condition; readonly then: Expr; readonly else: Expr };

/* ------------------------------------------------------------------ *
 * 3.2 条件
 * ------------------------------------------------------------------ */

export type CompareOp = '>' | '<' | '===' | '>=' | '<=';

/**
 * 唯一的判定语法，被 `when` / `requires` / `trigger.filter` 全部复用。
 *
 * 它的"一般性"有个可自检的点：如果要新增一种机制（比如
 * "buff 在 0.5 秒内即将过期"），应当是加一个 Condition 变体，
 * **而不是在引擎里加一个特判分支**。`buffExpiring` 就是这样一个例子。
 */
export type Condition =
  | { readonly kind: 'always' }
  | { readonly kind: 'hasBuff'; readonly who?: Who; readonly buffId: BuffId; readonly minStacks?: number }
  | { readonly kind: 'notHasBuff'; readonly who?: Who; readonly buffId: BuffId }
  | { readonly kind: 'buffExpiring'; readonly who?: Who; readonly buffId: BuffId; readonly withinMs: number }
  | { readonly kind: 'hpBelow'; readonly who?: Who; readonly ratio: number }
  | { readonly kind: 'hpAbove'; readonly who?: Who; readonly ratio: number }
  | { readonly kind: 'resourceAbove'; readonly who?: Who; readonly resource: ResourceKey; readonly value: number }
  | { readonly kind: 'resourceBelow'; readonly who?: Who; readonly resource: ResourceKey; readonly value: number }
  | { readonly kind: 'statAbove'; readonly who?: Who; readonly stat: StatKey; readonly value: number }
  | { readonly kind: 'isCasting'; readonly who?: Who }
  | { readonly kind: 'phase'; readonly phase: number }
  | { readonly kind: 'targetCount'; readonly side: Side; readonly op: CompareOp; readonly value: number }
  | { readonly kind: 'lastHitWasCrit' }
  | { readonly kind: 'all'; readonly of: readonly Condition[] }
  | { readonly kind: 'any'; readonly of: readonly Condition[] }
  | { readonly kind: 'not'; readonly of: Condition };

/* ------------------------------------------------------------------ *
 * 3.3 修正
 * ------------------------------------------------------------------ */

export interface StatModifier {
  readonly stat: StatKey;
  readonly op: Op;
  /** 可为表达式 → 动态重算。**不允许是函数**（不可序列化）。 */
  readonly value: number | Expr;
  /** 来源的 i18n key。溯源面板要显示它，所以是 key 而不是文案。 */
  readonly sourceKey: LocaleKey;
  /** 命名空间：让本修正可被 `contrib` 引用。 */
  readonly namespace?: ModifierNamespace;
  /** 条件修正：不满足则整条不生效。 */
  readonly when?: Condition;
  readonly tier?: ModifierTier;
}

/** 某个 stat 的结算构成明细（开发模式下构建）。 */
export interface StatBreakdownEntry {
  readonly sourceKey: LocaleKey;
  readonly namespace?: ModifierNamespace;
  readonly op: Op;
  /** 求值后的实际值 */
  readonly value: number;
  readonly tier: ModifierTier;
  /** 因 `when` 不满足而被跳过 */
  readonly skipped?: boolean;
}

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
 * 判定旗标。
 *
 * **闪避 / 格挡 / 派生 / GCD 全部落在这里，零新引擎机制**：
 *   闪避   duration:300  + invulnerable
 *   格挡   duration:1500 + damageReduce:0.6
 *   精防   再叠一层更短、减伤更高的（不需要单独的"精防"概念）
 *   派生   技能 A 挂 comboWindow buff；技能 B 的 requires 检查它
 *   GCD    施放后挂 gcd buff；gcd:true 的技能 requires notHasBuff('gcd')
 */
export interface BuffFlags {
  readonly invulnerable?: boolean;
  readonly damageReduce?: number;
  readonly ccImmune?: boolean;
  readonly interruptImmune?: boolean;
  /** 派生窗口：在此期间这些技能可用 */
  readonly comboWindow?: readonly SkillId[];
  readonly blocksGcd?: boolean;
  /** 动作锁：期间不能施放任何技能（施法僵直） */
  readonly actionLock?: boolean;
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

/* ================================================================== *
 * 5. 触发与事件
 * ================================================================== */

/** 快通道：给触发器用。只带最小载荷，渲染层不消费。 */
export type Hook =
  | 'onCastStart'
  | 'onCastFinish'
  | 'onCastInterrupted'
  | 'onInterruptSuccess'
  | 'onHitDealt'
  | 'onHitTaken'
  | 'onCritDealt'
  | 'onCritTaken'
  | 'onAvoided'
  | 'onKill'
  | 'onBuffApplied'
  | 'onBuffExpired'
  | 'onBuffStackChanged'
  | 'onResourceSpent'
  | 'onResourceGained'
  | 'onLowHp'
  | 'onDamagedBelow'
  | 'onHealed'
  | 'onTick'
  | 'onEncounterStart'
  | 'onEncounterEnd'
  | 'onPhaseChange';

export type SkillTag = 'melee' | 'spell' | 'dot' | 'defensive' | 'movement' | 'interrupt';
export type School = 'physical' | 'fire' | 'water' | 'arcane';

export type HookFilter =
  | { readonly by: 'self' }
  | { readonly by: 'other' }
  | { readonly by: 'skill'; readonly skillId?: SkillId; readonly tag?: SkillTag }
  | { readonly by: 'school'; readonly school: School }
  | { readonly by: 'buff'; readonly buffId: BuffId };

export interface TriggerDef {
  readonly on: Hook;
  readonly filter?: HookFilter;
  readonly when?: Condition;
  /** 内置 CD（ms），防抖 */
  readonly cooldownMs?: number;
  /** 触发概率，走种子化 RNG */
  readonly chance?: number;
  readonly maxTriggersPerTick?: number;
  /** 整场战斗最多触发次数 */
  readonly maxTriggersPerEncounter?: number;
  /** 产出：又是 ability，天然可嵌套（buff 授予 buff） */
  readonly then: readonly Ability[];
}

/* ================================================================== *
 * 6. 效果与伤害
 * ================================================================== */

/** 属性缩放项。 */
export interface ScalingTerm {
  readonly stat: StatKey;
  readonly ratio: number;
  readonly who?: Who;
}

/**
 * 伤害/治疗的数值定义。
 *
 * 结构化而不是函数（同 Expr 的理由）：可序列化、可测试、
 * 能被 UI 解释、能算得出"这一下为什么是这个数"。
 */
export interface DamageSpec {
  readonly base: number | Expr;
  readonly scaling?: readonly ScalingTerm[];
  readonly school: School;
  readonly canCrit: boolean;
  /** 是否触发 onHitDealt / onCritDealt 等 hook */
  readonly countsAsHit: boolean;
  /** 固定伤害：忽略增伤与减伤（"真实伤害"机制） */
  readonly ignoreModifiers?: boolean;
  /** 目标侧是否可闪避 */
  readonly avoidable?: boolean;
}

export type EffectKind =
  | 'damage'
  | 'heal'
  | 'grantBuff'
  | 'removeBuff'
  | 'resource'
  | 'interrupt'
  | 'dispel'
  | 'applyDebuffStack';

/** 效果 = 一次结算里发生的事。技能 `hits[].effects` 与独立 ability 共用它。 */
export interface Effect {
  readonly kind: EffectKind;
  /** damage / heal 用 */
  readonly damage?: DamageSpec;
  /** grantBuff / removeBuff 用 */
  readonly buff?: BuffDef;
  readonly buffId?: BuffId;
  /** resource 用 */
  readonly resource?: { readonly key: ResourceKey; readonly delta: number | Expr };
  /** 不填则取所在 ability / hit 的目标 */
  readonly target?: TargetRule;
  readonly when?: Condition;
}

/** 目标的解析规则。 */
export type TargetRule =
  | { readonly mode: 'self' }
  | { readonly mode: 'primaryEnemy' }
  | { readonly mode: 'allEnemies' }
  | { readonly mode: 'allAllies' }
  | { readonly mode: 'lowestHpAlly'; readonly ratio: number }
  | { readonly mode: 'owner' };

/** 一段命中。多段攻击 = 多个 HitDef。 */
export interface HitDef {
  /** 相对技能开始的毫秒偏移 = hit frame */
  readonly at: number;
  readonly effects: readonly Effect[];
  /** 该段是否可被闪避 */
  readonly avoidable?: boolean;
}

/* ================================================================== *
 * 7. Ability —— 唯一的原子单位
 * ================================================================== */

export interface ModifierAbility {
  readonly kind: 'modifier';
  readonly modifier: StatModifier;
}

export interface DerivedAbility {
  readonly kind: 'derived';
  readonly modifier: Omit<StatModifier, 'value'>;
  readonly value: Expr;
}

export interface TriggerAbility {
  readonly kind: 'trigger';
  readonly trigger: TriggerDef;
}

export interface GrantAbility {
  readonly kind: 'grant';
  readonly buff: BuffDef;
  readonly target: TargetRule;
}

export interface DealAbility {
  readonly kind: 'deal';
  readonly target: TargetRule;
  readonly hit: HitDef;
}

export interface GrantSkillAbility {
  readonly kind: 'grantSkill';
  readonly skillId: SkillId;
  readonly autoEquip?: boolean;
}

/**
 * 增减资源。
 *
 * 为什么需要它（而不是用 modifier 加 `douqiRegen`）：
 * "产生 12 点斗炁"是**一次性**的资源变动，而 `douqiRegen` 修正表达的是
 * **持续回复速率**。两者语义不同 —— 用后者表达前者会变成"每秒 12 点"
 * 而不是"这一次 12 点"。
 *
 * 这是本引擎唯一为"资源"单独开口的能力类型，因为资源变动确实是
 * 与"修正 / 触发 / 授予"并列的第五种基本发生方式。
 */
export interface ResourceAbility {
  readonly kind: 'resource';
  readonly target: TargetRule;
  readonly resource: ResourceKey | string;
  readonly delta: number | Expr;
}

/** 从某个池子扣资源（使用次数、充能、法力都走它）。 */
export interface ConsumeAbility {
  readonly kind: 'consume';
  readonly pool: ResourcePoolRef;
  readonly resource: ResourceKey | string;
  readonly amount: number | Expr;
}

/**
 * 能力的五种发射方式（+ 授予技能 + 消耗，共 7 个变体）。
 *
 * 判定标准只有一条：**这个能力是"持续存在"还是"在某一刻发生"？**
 *   持续存在 → modifier / derived
 *   某一刻发生 → trigger / grant / deal / grantSkill / consume
 *
 * 一个具体的机制永远是这两类的组合。所以新增增伤类型通常
 * **不需要新的 kind**，只需要新的 StatKey / Expr 节点 / Hook。
 */
export type Ability =
  | ModifierAbility
  | DerivedAbility
  | TriggerAbility
  | GrantAbility
  | DealAbility
  | GrantSkillAbility
  | ConsumeAbility
  | ResourceAbility;

export type AbilityKind = Ability['kind'];

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
  readonly tags?: readonly string[];
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
  readonly gcd: boolean;
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
  /** 默认 true；不占 GCD 的技能显式写 false */
  readonly gcd: boolean;
  readonly cost: readonly Cost[];
  readonly targeting: TargetRule;
  readonly hits: readonly HitDef[];
  readonly tags: readonly SkillTag[];
  readonly school: School;
  readonly interruptible: boolean;
}

/* ================================================================== *
 * 10. 实例与装备方案
 * ================================================================== */

export interface GameEntityInstance {
  readonly instanceId: string;
  readonly defId: EntityId;
  /** 内容实例自己的资源池（使用次数、充能） */
  readonly pool: ResourcePool;
  /**
   * 每个实例独立的技能冷却。
   *
   * 旧项目把冷却存在角色身上，于是**两个物品共享同一个技能冷却会互相打架**
   * （装两件同样有主动技能的奇物，按一个另一边也进 CD）。
   */
  readonly cooldowns: Record<SkillId, number>;
  /** 附魔 / 词条等随机化变体（仅装备类） */
  readonly affixes?: readonly string[];
  readonly equippedAt?: number;
}

/** 技能来源，用于 UI 显示"这个技能是哪来的"。 */
export type SkillOrigin =
  | { readonly kind: 'innate' }
  | { readonly kind: 'talent'; readonly talentId: EntityId }
  | { readonly kind: 'item'; readonly entityInstanceId: string; readonly entityId: EntityId }
  | { readonly kind: 'buff'; readonly buffId: BuffId };

export interface KnownSkill {
  readonly skillId: SkillId;
  readonly origin: SkillOrigin;
  /** 数字大的赢（innate 100 > talent 60 > item 40 > buff 20） */
  readonly priority: number;
}

export interface SkillBarSlot {
  readonly index: number;
  readonly key: string;
  readonly skillId: SkillId | null;
}

export interface SkillBook {
  readonly known: readonly KnownSkill[];
  readonly bar: readonly SkillBarSlot[];
  readonly barSlotCount: number;
}

export interface Loadout {
  readonly items: readonly GameEntityInstance[];
  readonly talents: readonly EntityId[];
  readonly skillBar: readonly SkillBarSlot[];
  readonly barSlotCount: number;
}

/* ================================================================== *
 * 11. Boss 行为（数组模型，双方共用）
 * ================================================================== */

/** 轮转步骤：按顺序尝试，第一个条件满足的被执行。 */
export interface RotationStep {
  readonly skillId: SkillId;
  readonly when?: Condition;
  /** 相对上一次的间隔（ms） */
  readonly gapMs?: number;
}

export type Behavior =
  | { readonly kind: 'phases'; readonly at: readonly number[] }
  | { readonly kind: 'timeLimit'; readonly ms: number }
  | { readonly kind: 'enrage'; readonly atMs: number; readonly dmgMult: number }
  | { readonly kind: 'opener'; readonly skillId: SkillId; readonly delayMs: number }
  | { readonly kind: 'rotation'; readonly steps: readonly RotationStep[] }
  | { readonly kind: 'onHpBelow'; readonly ratio: number; readonly then: readonly Behavior[] }
  | { readonly kind: 'interruptible'; readonly skillIds: readonly SkillId[] };

/* ================================================================== *
 * 12. 运行时状态
 * ================================================================== */

/** 一个读条实例。Boss 可以同时读两个，所以是数组。 */
export interface CastInstance {
  readonly skillId: SkillId;
  /** 开始读条的 tick */
  readonly startedAtTick: number;
  /** 需要的读条时长（已受急速影响） */
  readonly castTimeMs: number;
  /** 已经结算到第几段 hit */
  readonly resolvedHits: number;
  readonly interruptible: boolean;
}

/**
 * 战斗单位。**没有"玩家"和"Boss"之分**——两边是同一个结构。
 * 区别只有输入来源：玩家是键盘，Boss 是行为数组。
 */
export interface Combatant {
  readonly id: CombatantId;
  readonly nameKey: LocaleKey;
  readonly side: Side;
  /** 资源上限 */
  readonly caps: Record<ResourceKey, number>;
  /** 当前资源。**整数**（见架构规范 §12：整数生命消灭了一整类判定 bug） */
  readonly resources: Record<ResourceKey, number>;
  /** 离散计数器 */
  readonly counters: Record<string, Counter>;
  /** 基础主属性 */
  readonly basePrimary: Record<PrimaryStat, number>;
  /** buff 实例 */
  readonly buffs: readonly BuffInstance[];
  /** 每个技能的下次可用 tick */
  readonly cooldowns: Record<SkillId, number>;
  /** 冷却中（受急速影响的绝对 tick） */
  readonly casts: readonly CastInstance[];
  /** 整场战斗的技能使用次数统计 */
  readonly uses: Record<SkillId, number>;
  readonly behaviors: readonly Behavior[];
  readonly alive: boolean;
}

/** 战斗阶段 / 结果。 */
export type EncounterStatus = 'idle' | 'running' | 'victory' | 'defeat';

export type EndReason = 'hpZero' | 'timeout' | 'enrage';

/**
 * 整场战斗的完整状态。
 *
 * **硬约束（C5）**：必须是可结构化克隆、可哈希的 plain object ——
 * 不许有 Map/Set/类实例/函数。旧项目在 `overTimeEffects[].caster`
 * 里直接存对象引用，导致循环引用、无法序列化。
 */
export interface BattleState {
  /** 已推进的 tick 数（整数，唯一的时间真相源） */
  readonly tick: number;
  /** 随机数状态（必须在状态里，否则无法重放） */
  readonly rngSeed: number;
  readonly status: EncounterStatus;
  readonly combatants: readonly Combatant[];
  /** Boss 行为用到的阶段计数 */
  readonly phase: number;
  /** 战斗开始 tick */
  readonly startedAtTick: number;
  /** 普通攻击 / 技能的充能记录：技能 → 已恢复的充能数 */
  readonly charges: Record<SkillId, { readonly current: number; readonly nextRechargeTick: number }>;
  readonly endReason?: EndReason;
}

/* ================================================================== *
 * 13. 事件（慢通道，给渲染层 / 日志）
 * ================================================================== */

export type SkillRejectReason =
  | 'gcd'
  | 'cooldown'
  | 'cost'
  | 'casting'
  | 'condition'
  | 'locked'
  | 'target';

export type EventDef =
  | {
      readonly kind: 'damage';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly targetId: CombatantId;
      readonly amount: number;
      readonly crit: boolean;
      readonly school: School;
      readonly absorbed: number;
      readonly overkill: number;
    }
  | {
      readonly kind: 'heal';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly targetId: CombatantId;
      readonly amount: number;
      readonly crit: boolean;
      readonly overheal: number;
    }
  /** 闪避成功必须有独立事件，否则玩家不知道躲掉了 */
  | {
      readonly kind: 'avoided';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly targetId: CombatantId;
      readonly skillId: SkillId;
      readonly reason: 'dodged' | 'immune';
    }
  | {
      readonly kind: 'buffApplied' | 'buffExpired' | 'buffRefreshed' | 'buffStackChanged';
      readonly tick: number;
      readonly targetId: CombatantId;
      readonly buffId: BuffId;
      readonly stacks: number;
      readonly sourceId: CombatantId;
    }
  | {
      readonly kind: 'castStarted' | 'castFinished' | 'castInterrupted';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly skillId: SkillId;
      readonly reason?: 'interrupted' | 'sourceLost' | 'death';
    }
  | {
      readonly kind: 'interruptSuccess';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly targetId: CombatantId;
      readonly skillId: SkillId;
    }
  | {
      readonly kind: 'resourceChanged';
      readonly tick: number;
      readonly targetId: CombatantId;
      readonly resource: ResourceKey | string;
      readonly delta: number;
      readonly current: number;
    }
  | { readonly kind: 'skillUsed'; readonly tick: number; readonly sourceId: CombatantId; readonly skillId: SkillId }
  /**
   * 施放被拒绝。
   *
   * 玩家按键没反应时必须能知道原因（GCD？CD？资源？条件？被锁？），
   * 渲染层才能给出正确反馈。旧项目这里只写了一句"我还不能使用这个技能"。
   */
  | {
      readonly kind: 'skillRejected';
      readonly tick: number;
      readonly sourceId: CombatantId;
      readonly skillId: SkillId;
      readonly reason: SkillRejectReason;
    }
  | { readonly kind: 'phaseChanged'; readonly tick: number; readonly phase: number; readonly bossId: CombatantId }
  | { readonly kind: 'enrageStarted'; readonly tick: number; readonly bossId: CombatantId }
  | { readonly kind: 'death'; readonly tick: number; readonly targetId: CombatantId }
  | {
      readonly kind: 'encounterEnd';
      readonly tick: number;
      readonly result: 'victory' | 'defeat';
      readonly reason: EndReason;
    };

export type EventKind = EventDef['kind'];

/* ================================================================== *
 * 14. 输入（唯一入口，可录制可重放）
 * ================================================================== */

export type Action =
  | { readonly type: 'useSkill'; readonly skillId: SkillId; readonly atTick: number }
  | { readonly type: 'releaseKey'; readonly key: string; readonly atTick: number }
  | { readonly type: 'setTarget'; readonly targetId: CombatantId; readonly atTick: number }
  | { readonly type: 'cancelCast'; readonly atTick: number }
  | { readonly type: 'pause'; readonly atTick: number }
  | { readonly type: 'resume'; readonly atTick: number }
  | { readonly type: 'restart'; readonly seed: number; readonly atTick: number };

export type ActionType = Action['type'];

/* ================================================================== *
 * 15. 关卡定义
 * ================================================================== */

export interface EncounterDef {
  readonly id: EntityId;
  readonly nameKey: LocaleKey;
  readonly player: Loadout;
  readonly boss: Loadout & { readonly behaviors: readonly Behavior[] };
  readonly victory: readonly Condition[];
  readonly defeat: readonly Condition[];
  readonly timeLimitMs?: number;
}
