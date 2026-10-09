# Raid Simulator — 数据模型规范

> 状态：待评审
> 日期：2026-10-09
> 范围：核心数据模型（Item / Skill / Effect / Buff / Debuff / Modifier / Expr / Condition / Trigger）
> 前置阅读：`2026-10-09-architecture.md`

---

## 0. 本规范要解决的问题

旧项目（2021 版）的根本缺陷不是"逻辑和 UI 混在一起"——那只是症状。真正的病因是**数据模型无法表达"被动效果"**：

```ts
// 旧项目的全部表达能力
export interface Talent {
    id: string,
    name: string,
    icon?: string,
    costs: any,      // ← 从来没有被实现过
    effects: any     // ← 从来没有被实现过
}
```

`Talent` 是个空壳。旧项目里所有内容都必须是"主动技能"，效果必须写在扁平的
`Effect { type, value }` 里。所以：

- 装备被动加属性 —— 表达不了
- "根据智力增伤" —— 只能硬写进某个主动技能的 `value` 函数里
- "暴击后增伤翻倍 10 秒" —— 表达不了（没有事件监听概念）
- 被动天赋 —— 不存在

**新模型的设计目标**：

| # | 目标 | 验收方式 |
|---|---|---|
| G1 | 一个内容件可以同时带"永久修正 / 派生修正 / 事件触发"三种能力 | 熵之钟走查（§9）能完整表达 |
| G2 | 新增一类增伤机制**不需要改 schema** | §10 的 6 种增伤全部用现有 schema 表达 |
| G3 | 修正是**动态重算**的，不是快照 | 智力变化后 buff 数值跟着变化（§9.3） |
| G4 | 同内容可持有多份，效果可叠多层 | `instanceId` + `maxStacks`（§8） |
| G5 | 内容可授予主动技能 | `SkillSource` + 技能栏解析（§7） |
| G6 | 内容作者写的每个值都可在 UI 里溯源 | `StatBreakdown` provenance（§5.4） |
| G7 | 非法内容在**加载期**报错，不在战斗中崩溃 | content validation（§11） |

---

## 1. 分层总览

```
ContentDef      内容定义（不可变、可在构建期校验、可序列化为 JSON/TS）
      │  一个内容件 = 一个 abilities: Ability[]
      ▼
Ability         能力：内容件的原子单位，有 5 种发射方式（§2）
      │
      ├─ modifier  → StatModifier → 进入修正池 → 参与 StatPipeline 结算（§5）
      ├─ derived   → Expr         → 动态求值 → 进入修正池
      ├─ trigger   → Hook + Condition → 产出新的 Ability[]（可嵌套）
      ├─ grant     → BuffDef      → 产生 BuffInstance（§6）
      └─ deal      → Damage/Heal  → 直接结算
      │
      ▼
BattleState     运行时状态（每 tick 变化）
      │  Combatant { stats, resources, buffs[], cooldowns, casts[], gauge }
      ▼
EventDef[]      离散事件流 → 渲染层 / 日志 / 飘字（§12）
```

**不变式**：`ContentDef` 永远不可变；运行时的可变量全部放在 `BattleState` 里。
这一条让"回放"和"存档"变成同一件事——存 `BattleState` 即可。

---

## 2. Ability：唯一的原子单位

`Ability` 是**可辨识联合（discriminated union）**，`kind` 是判别式。

```ts
type Ability =
  | ModifierAbility
  | DerivedAbility
  | TriggerAbility
  | GrantAbility
  | DealAbility
  | GrantSkillAbility
  | ConsumeAbility;

/** 永久修正：内容被持有时立即生效，直到被移除 */
interface ModifierAbility {
  kind: 'modifier';
  modifier: StatModifier;
}

/** 派生修正：值是表达式的函数，每次重算时重新求值（G3：动态） */
interface DerivedAbility {
  kind: 'derived';
  /** 产出修正的目标 stat / op / source */
  modifier: Omit<StatModifier, 'value'>;
  /** 值由表达式给出 */
  value: Expr;
}

/** 触发器：监听 Hook，条件满足时发射 then 里的能力（可嵌套） */
interface TriggerAbility {
  kind: 'trigger';
  trigger: TriggerDef;
}

/** 授予 buff：内容被持有/技能命中等时刻挂上 buff */
interface GrantAbility {
  kind: 'grant';
  buff: BuffDef;
  target: TargetRule;
}

/** 直接结算伤害/治疗：主动技能的 hits 里用，也可作为独立 ability 使用 */
interface DealAbility {
  kind: 'deal';
  target: TargetRule;
  hit: HitDef;
}

/** 授予技能：装备/天赋/buff 把一个主动技能给到技能书（G5） */
interface GrantSkillAbility {
  kind: 'grantSkill';
  skillId: SkillId;
  /** 是否需要玩家手动挂到技能栏 */
  autoEquip?: boolean;
}

/**
 * 消耗：使用次数、充能 — 走**统一的资源模型**，不是独立机制。
 * 见 §2.2。
 */
interface ConsumeAbility {
  kind: 'consume';
  /** 从哪个池子扣。'self' 与 'item:<instanceId>' 都合法 */
  pool: ResourcePoolRef;
  resource: ResourceKey;
  amount: number | Expr;
}

type ResourcePoolRef =
  | { kind: 'combatant'; combatantId: CombatantId }
  | { kind: 'entity'; entityInstanceId: string }   // 内容实例自己的资源池
  | { kind: 'encounter' };                          // 整场战斗共享
```

### 2.1 为什么是这 6 种，而且可以继续加

判定标准只有一条：**这个能力是"持续存在"还是"在某一刻发生"？**

- 持续存在 → `modifier` / `derived`
- 在某一刻发生 → `trigger` / `grant` / `deal` / `grantSkill`

一个具体的增伤机制，永远是这两类的组合。所以**新机制通常不需要新的 `kind`**，
只需要新的 `StatKey`、新的 `Expr` 节点、或新的 `Hook`（§10 会验证这一点）。

如果确实需要新 `kind`（例如"换装时触发"），追加一个新变体 + 注册一个 handler 即可：

```ts
// core/abilities/registry.ts
const ABILITY_HANDLERS: Record<Ability['kind'], AbilityHandler> = {
  modifier: applyModifier,
  derived: applyDerived,
  trigger: registerTrigger,
  grant: applyGrant,
  deal: applyDeal,
  grantSkill: applyGrantSkill,
  consume: applyConsume,
};
```

**旧内容不需要迁移**——这是"开放扩展"的具体含义。

### 2.2 使用次数与消耗品：统一资源模型

需求里提到"消耗品"和"有使用次数的奇物"。**不要为它们加 `maxUses` 字段**——
那是把同一件事实现两遍。使用次数就是**资源**，只是池子挂在内容实例上而不是角色上。

```ts
/** 任何实例都可以有自己的资源池 */
interface ResourcePool {
  hp?: number; mp?: number; energy?: number; fury?: number;
  /** 自定义离散资源：使用次数、充能、弹药、封印数…… 全部走这里 */
  counters: Record<string, { current: number; max: number }>;
}

interface GameEntityInstance {
  instanceId: string;
  defId: EntityId;
  /** 内容实例自己的资源池 —— 使用次数/充能住在这里（G4：可持有多份） */
  pool: ResourcePool;
  /** 每个技能独立冷却（旧项目缺这个：多个物品共享冷却会互相打架） */
  cooldowns: Record<SkillId, number>;
  equippedAt?: number;
}
```

于是：

| 需求 | 表达 |
|---|---|
| 消耗品（用 1 次消失） | `counters: { uses: { current: 1, max: 1 } }` + skill `cost: [{ pool:'entity:id', resource:'uses', value:1 }]` |
| 3 次使用次数的奇物 | `counters: { uses: { current: 3, max: 3 } }` |
| 每 30 秒回 1 次使用次数 | buff `triggers: [{ on:'onTick', cooldownMs:30000, then:[{ kind:'resource', pool:..., resource:'uses', delta:+1 }] }]` |
| 多充能技能（2 层充能） | `ResourcePool.counters.charges` + `SkillDef.charges.rechargeMs` |
| 法力/怒气消耗 | `pool: { kind:'combatant', combatantId:'player' }, resource:'mp'` |

**收益**：`Cost` 类型、资源条 UI、资源回复、`resourceChanged` 事件——全部复用，
零新机制。"使用次数用完了"和"法力不够"在 UI 上是同一个组件。

**注意 `counters` 而不是给 `ResourcePool` 加具名字段**：这样内容作者可以定义
任意名字的离散资源（`'ammo'`、`'seals'`、`'comboPoints'`），不需要改类型。


---

## 3. 表达式系统（G2 的核心）

### 3.1 问题

"根据属性增伤"如果写成硬编码公式，那么：

- 换成"根据暴击率增伤" → 改代码
- 换成"根据已损失血量增伤" → 改代码
- 换成"根据目标身上 debuff 数量增伤" → 改代码

**所以值不能是 `number | Function`，必须是结构化表达式。** 旧项目的
`EffectValueFunction = (props) => number` 是不可序列化的（存不了档、测不了、
内容作者改不了），必须替换。

### 3.2 定义

```ts
type Expr =
  // —— 字面量 ——
  | { e: 'const'; value: number }

  // —— 引用：谁 / 哪个属性 / 哪个资源 ——
  | { e: 'stat'; who: Who; stat: StatKey }
  | { e: 'resource'; who: Who; resource: ResourceKey }
  | { e: 'maxResource'; who: Who; resource: ResourceKey }
  | { e: 'resourceRatio'; who: Who; resource: ResourceKey }     // 当前/上限
  | { e: 'missingResourceRatio'; who: Who; resource: ResourceKey } // 1 - ratio
  | { e: 'buffStacks'; who: Who; buffId: BuffId }
  | { e: 'hasBuff'; who: Who; buffId: BuffId }                   // → 0 | 1
  // 注意：没有 distance。本作没有位移与空间模型（见 §3.5）

  // —— 跨来源引用（解决"值不是写死的"问题）——
  | { e: 'contrib'; namespace: ModifierNamespace; fallback?: number }

  // —— 算术 ——
  | { e: 'add'; of: Expr[] }
  | { e: 'mul'; of: Expr[] }
  | { e: 'min'; of: Expr[] }
  | { e: 'max'; of: Expr[] }
  | { e: 'clamp'; value: Expr; min: Expr; max: Expr }
  | { e: 'neg'; value: Expr }
  | { e: 'cond'; if: Condition; then: Expr; else: Expr };

type Who = 'self' | 'target' | 'caster' | 'source';

/** 修正来源命名空间：让一个修正的值可以被别处引用，且能动态重算 */
type ModifierNamespace = string;   // 如 'entropy-clock.potential'
```

### 3.3 为什么 `contrib` 是关键（而不是引用"某个 ability 的 index"）

你的奇物效果 3 是"暴击后，增伤效果翻倍"。这里有三种可能的实现，只有一种是对的：

| 写法 | 问题 |
|---|---|
| buff 里写死 `+10%` | 智力改了，buff 不会跟着变 → 违反 G3 |
| buff 引用 `item.abilities[1]` | 内容作者改一下数组顺序就崩了；无法表达"引用别的装备的加成" |
| buff 引用**命名空间** `'entropy-clock.potential'` | ✅ 稳定、可跨来源引用、动态重算、可以有多份贡献累加 |

**命名空间由一个内容件声明，其他内容可以引用它。** 这打开了大量组合：

```ts
// 奇物 A 声明 potential 命名空间
{ kind: 'derived', namespace: 'entropy-clock.potential',
  modifier: { stat: 'damageBoost', op: 'addPercent',
              sourceKey: 'entity.entropyClock.sources.potential' },
  value: { e: 'mul', of: [{ e: 'const', value: 0.10 },
                           { e: 'stat', who: 'self', stat: 'intelligence' }] } }

// 天赋 B 引用它："势能类效果再提升 50%"
{ kind: 'derived',
  modifier: { stat: 'damageBoost', op: 'addPercent',
              sourceKey: 'talent.resonance.name' },
  value: { e: 'mul', of: [{ e: 'contrib', namespace: 'entropy-clock.potential' },
                          { e: 'const', value: 0.5 }] } }
```

`contrib` 求和同一命名空间下的**所有**贡献。所以"装两个奇物"也能正确工作。

### 3.4 求值顺序与循环依赖（G7）

表达式靠引用形成依赖图。**加载期用拓扑排序算出 `statTier`，有环直接报错**：

```
statTier(damageBoost) = 1 + max(statTier(dep) for dep in refs)
```

规则：**派生 stat 只能引用 tier 更低的 stat。** 遇到环（A 依赖 B，B 依赖 A）：

```
[content] ✗ 循环依赖: damageBoost → intelligence → damageBoost
           (entropy-clock.potential ↔ talent.resonance)
```

### 3.5 没有空间维度

本作**没有位移、没有坐标、没有朝向**。"闪避"是一个给自己挂短时无敌 buff 的技能，
不是一次位移。所以：

- `Expr` 里没有 `distance` 节点
- `TargetRule` 里没有距离类目标选择
- `SkillDef` 里没有范围/半径

如果以后要做"带位置的副本"（俯视角 + 地面标记那一版），
**受影响的范围是**：`Expr`（加 `distance`）、`TargetRule`（加范围选择）、
`BattleState`（加 `positions`）、渲染层（加坐标与相机）。
**`Ability` / `StatModifier` / `BuffDef` / `Condition` 全部不受影响**——
因为战斗数值模型与空间是正交的，这是分层的价值。

**加载期失败，而不是战斗中栈溢出。** 这是 G7 的落地方式。

---

## 4. 条件模型

`Condition` 是唯一一套判定语法，被 `when` / `requires` / `trigger.filter` / 目标选择全部复用。

```ts
type Condition =
  | { kind: 'always' }
  | { kind: 'hasBuff';    who?: Who; buffId: BuffId; minStacks?: number }
  | { kind: 'notHasBuff'; who?: Who; buffId: BuffId }
  | { kind: 'buffExpiring'; who?: Who; buffId: BuffId; withinMs: number }
  | { kind: 'hpBelow';      who?: Who; ratio: number }
  | { kind: 'hpAbove';      who?: Who; ratio: number }
  | { kind: 'resourceAbove'; resource: ResourceKey; value: number }
  | { kind: 'resourceBelow'; resource: ResourceKey; value: number }
  | { kind: 'statAbove';    stat: StatKey; value: number }
  | { kind: 'isCasting' }                       // 派生/打断判定用
  | { kind: 'phase';        phase: number }
  | { kind: 'targetCount';  side: Side; op: CompareOp; value: number }
  | { kind: 'lastHitWasCrit' }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  | { kind: 'not'; of: Condition };
```

`who` 默认 `'self'`。`Who` 与 `Expr` 共用（§3.2）。

**注意 `buffExpiring`**：这个条件让"在 buff 快结束时做出特殊操作"成为纯数据，
不需要任何引擎改动。它是可扩展性设计的一个自检点——如果这套模型够一般，
那么"提前 0.5 秒内续 buff 有额外奖励"这种机制应该零代码可表达。它能。

---

## 5. 修正与属性结算

### 5.1 StatModifier

```ts
type StatKey =
  // 主属性
  | 'strength' | 'agility' | 'intelligence' | 'spirit'
  // 资源上限
  | 'maxHp' | 'maxMp' | 'maxEnergy' | 'maxFury'
  // 资源回复（每秒）
  | 'hpRegen' | 'mpRegen' | 'energyRegen' | 'furyRegen'
  // 次级属性
  | 'critChance' | 'critDamage' | 'haste' | 'armor' | 'tenacity'
  | 'castSpeed' | 'cooldownRate'
  // 伤害 / 治疗修饰（可扩展，见 §10）
  | 'damageBoost'          // 全局增伤（加法百分比聚合）
  | 'damageMult'           // 全局增伤（乘法聚合）
  | 'physicalBoost' | 'spellBoost'
  | 'dotBoost' | 'directBoost'
  | 'critDamageBoost'
  | 'armorPen' | 'vulnerability'   // 目标侧
  | 'damageTakenMult' | 'healingBoost' | 'shieldBoost';

type Op =
  | 'add'          // 加法层
  | 'mult'         // 乘法层
  | 'addPercent'   // 百分比分量层
  | 'max'          // 只取最大值（不叠加）
  | 'setOverride'  // 覆盖层
  | 'perStackAdd'; // 按 buff 层数 × value 累加

interface StatModifier {
  stat: StatKey;
  op: Op;
  /** 可为表达式 → 动态重算（G3） */
  value: number | Expr;
  /** 来源标记的 i18n key（必须填）。溯源面板要显示它，所以是 key 而非文案 */
  sourceKey: string;
  /** 命名空间：让本修正可被 contrib 引用（§3.3） */
  namespace?: ModifierNamespace;
  /** 条件修正：不满足则整条不生效 */
  when?: Condition;
  /** 稀有度/层级，用于 UI 分组（可选） */
  tier?: 'base' | 'talent' | 'item' | 'buff' | 'debuff' | 'temp';
}
```

### 5.2 每个 stat 的聚合规则（数据，不是代码分支）

| stat | 聚合 | 上限 |
|---|---|---|
| `strength` / `agility` / `intelligence` / `spirit` | 加法层求和 | — |
| `maxHp` / `maxMp` / `maxEnergy` / `maxFury` | 加法层求和 | — |
| `critChance` | 加法层求和 | 1.0 |
| `critDamage` | 加法层求和 | — |
| `critDamageBoost` | **乘法层相乘** | — |
| `haste` | 加法层求和 | 0.5 |
| `castSpeed` / `cooldownRate` | 乘法层相乘 | — |
| `armor` | 加法层求和 | — |
| `damageBoost` | **百分比层相加**（`Σ`） | — |
| `damageMult` | **乘法层相乘**（`∏`） | — |
| `physicalBoost` / `spellBoost` | 百分比层相加 | — |
| `dotBoost` / `directBoost` | 百分比层相加 | — |
| `vulnerability`（目标） | 百分比层相加 | — |
| `damageTakenMult` | 乘法层相乘 | — |
| `armorPen` | 加法层求和 | 1.0 |

**为什么 `damageBoost` 必须相加而不是相乘**：两个 `+10%` 相乘是 `+21%`，
玩家永远算不清自己的伤害，数值也会失控。相加是 `+20%`，直觉正确、可加、可预测。

**但 `damageMult` 故意做成相乘**，因为有些机制表达的就是"最终伤害 ×2"。
两种语义**都由数据选择**，引擎不猜。

**聚合必须用 Kahan 补偿求和**（`core/numeric.ts`），不能写裸的 `reduce`：
   - 误差从 O(N·ε) 降到 O(1)；
   - 更重要的是**结果对修正数组的顺序不敏感** —— 否则黄金重放测试
     会因为"同一批修正换个顺序"而随机通过。
   - 连乘（`damageMult`）按 `sourceKey` 排序后连乘，同样为了可复现。

**生命与资源是整数**，公式内部按 float 算、只在写回状态时取整，
且只能通过 `roundStat` / `roundDamage`。理由与完整数值纪律见
[架构规范 §12](2026-10-09-architecture.md)。

### 5.3 结算算法

```
computeStats(state, combatant) -> { stats, breakdown }

阶段 0  base       从 ContentDef 的基础值出发
阶段 1  加法层      Σ (op: add | perStackAdd)   →  力量 10 + 2 + 3 = 15
阶段 2  派生层      按 statTier 升序求值 op: addPercent 的 Expr
                    求值时若引用其他 stat，读的是"已完成阶段 0-2 的当前值"
阶段 3  百分比层    (1 + Σ op: addPercent)
阶段 4  乘法层      ∏ (op: mult)
阶段 5  覆盖层      最后应用 op: setOverride
阶段 6  最大值层    op: max 取最大值
阶段 7  钳制        clamp 到 §5.2 的合法范围
```

**顺序是不变量**，写进测试。任何阶段顺序变化都会让战斗结果变化，golden test 会立刻红。

### 5.4 溯源（G6）

引擎不仅返回数值，还返回每个 stat 的**构成明细**：

```ts
type StatBreakdown = Record<StatKey, Array<{
  sourceKey: string;          // 'entity.entropyClock.sources.potential'（i18n key）
  namespace?: ModifierNamespace;
  op: Op;
  value: number;              // 求值后的实际值
  tier: string;
  /** 该修正是否因 when 条件不满足而被跳过 */
  skipped?: boolean;
}>>;
```

用途：

1. **调试面板**：悬停力量 → 看到 `10 + 2 + 3 = 15`，各项的标签由 `sourceKey` 查 i18n 得到
2. **属性面板 UI**：MMO 玩家对"我的属性从哪来的"有强需求
3. **测试断言**：可以直接断言"某来源贡献了某值"，而不是断言一个总数

`breakdown` 是开发模式下才计算的（`import.meta.env.DEV`），生产构建剔除，
避免每 tick 建大对象。**但是它的存在会强制我们不做快照式实现**——这是好事。

---

## 6. Buff / Debuff

### 6.1 定义

**Buff 和 Debuff 是同一件事**，`polarity` 区分。旧项目把它们分成两种类型
（`buff` / `debuff`）是多余的——一个"受到更多伤害"的效果，从施加者角度看是 debuff，
从目标角度看只是一条 `vulnerability` 修正。**修正本身没有正负，只有方向。**

```ts
type Polarity = 'buff' | 'debuff' | 'neutral';

interface BuffDef {
  id: BuffId;
  /** 显示名的 i18n key（见 i18n 规范 §5 命名规则） */
  nameKey: string;
  icon: string;
  polarity: Polarity;              // 仅影响 UI 颜色，不影响逻辑
  duration: number;                // ms；Infinity 表示永久
  maxStacks: number;               // 1 = 不可叠层
  /** 层数变化时的行为 */
  stacking: StackingRule;
  /** 声明式修正：交给 StatPipeline 统一结算 */
  modifiers?: StatModifier[];
  /** 判定旗标：hit 结算时检查（闪避/格挡/派生/GCD 全靠这个） */
  flags?: BuffFlags;
  /** 触发钩子：buff 自身也能监听事件 */
  triggers?: TriggerDef[];
  /** 视觉表现提示：渲染层据此播放特效 */
  vfx?: { aura?: string; onApply?: string; onExpire?: string };
  /** 是否可被驱散/偷取 */
  dispellable?: boolean;
  /** 不可覆盖的标签，用于互斥（例如同类姿态只能有一个） */
  tags?: string[];
}

/** 叠层规则 */
type StackingRule =
  | { mode: 'refresh' }                                    // 刷新时长，层数不变（默认）
  | { mode: 'stack'; max: number }                          // 加层，上限 max
  | { mode: 'stackRefresh'; max: number }                   // 加层 + 刷新时长
  | { mode: 'independent'; max: number }                    // 各自独立计时（同 buffId 多实例）
  | { mode: 'replace' }                                     // 新顶替旧
  | { mode: 'extend'; maxDurationMs: number };              // 时长叠加

/** 判定旗标 —— "闪避/格挡/派生/GCD"全部落在这里，零新引擎机制 */
interface BuffFlags {
  invulnerable?: boolean;          // 该次伤害完全免疫
  damageReduce?: number;           // 减伤百分比（精防就是更高的这个值）
  ccImmune?: boolean;
  interruptImmune?: boolean;       // 前摇不可打断
  /** 派生窗口：在此期间这些技能可用 */
  comboWindow?: SkillId[];
  /** 若为 true，则本 buff 期间不允许 GCD 类技能（极少用） */
  blocksGcd?: boolean;
  /** 动作锁：本 buff 期间不能施放任何技能（僵直） */
  actionLock?: boolean;
}

interface TriggerDef {
  on: Hook;
  filter?: HookFilter;
  when?: Condition;
  cooldownMs?: number;             // 内置 CD，防抖
  chance?: number;                 // 触发概率（走种子化 RNG）
  maxTriggersPerTick?: number;
  /** 每次战斗最多触发次数 */
  maxTriggersPerEncounter?: number;
  then: Ability[];                 // 可嵌套（buff 授予 buff）
}
```

### 6.2 运行时实例

```ts
interface BuffInstance {
  instanceId: string;      // 唯一（G4：同内容可持有多份）
  defId: BuffId;
  stacks: number;
  appliedAt: number;       // 施放时刻（ms，战斗内相对时间）
  expiresAt: number;       // 绝对过期时刻（Infinity = 永久）
  sourceId: CombatantId;   // 谁给的
  /** 每次 trigger 的内置 CD 记录 */
  triggerCooldowns: Record<string, number>;
  /** 剩余触发次数 */
  triggerCounts: Record<string, number>;
}
```

**关键**：`BuffInstance` 只存**实例状态**，不存数值快照。
buff 上的 `modifiers` 里的 `Expr` 每次 `computeStats` 时重新求值（G3）。
这就是"动态重算"的落地方式——**没有任何地方存快照**。

### 6.3 为什么判定窗口做成 buff 是对的

需求里提到"闪避、防御技能、派生、不占 GCD 的技能"。这四件事看起来是四种机制：

| 机制 | 实现（`BuffDef` 参数） |
|---|---|
| 闪避 | `duration: 300, flags: { invulnerable: true }` |
| 格挡 | `duration: 1500, flags: { damageReduce: 0.6 }` |
| 精防（完美格挡） | 额外的 `duration: 200, flags: { damageReduce: 0.9 }`，由 `buffExpiring` / 独立 buff 触发 |
| 技能派生 | 技能 A `then: [{ kind:'grant', buff: { id:'combo_window', duration:1500, flags:{ comboWindow:['arc'] } } }]`；技能 B `requires: [{ kind:'hasBuff', buffId:'combo_window' }]` |
| GCD | 施放后挂 `gcd` buff `duration: 300`；`gcd: true` 的技能 `requires: [{ kind:'notHasBuff', buffId:'gcd' }]` |
| 不占 GCD | 该技能 `gcd: false`，不检查 `gcd` buff |
| 施法僵直 | `actionLock: true` |

**没有一条需要新引擎机制。** 这是数据模型一般性的最有说服力的证据。

---

## 7. 技能与技能书（G5）

### 7.1 SkillDef

```ts
interface SkillDef extends GameEntity {
  id: SkillId;
  nameKey: string;
  icon: string;
  type: 'active' | 'passive';

  // —— 主动技能字段（type: 'active' 时必需）——
  castTime: number;              // 0 = 瞬发
  channel?: { durationMs: number; tickIntervalMs: number };  // 引导技（可选）
  cooldown: number;              // 0 = 无 CD
  charges?: { max: number; rechargeMs: number };             // 多充能（可选）
  gcd: boolean;                  // 默认 true；不占 GCD 显式写 false
  cost: Cost[];
  targeting: TargetRule;
  requires?: Condition[];        // 派生/前置条件
  hits: HitDef[];
  tags: SkillTag[];              // 'melee' | 'spell' | 'dot' | 'defensive' | 'movement' | 'interrupt'
  school: School;                // 'physical' | 'fire' | 'water' | ...
  /** 施法过程是否可被打断 */
  interruptible: boolean;

  // —— 被动技能字段（type: 'passive'）——
  // 能力全部写在继承来的 abilities[] 里，不需要额外字段。
  // 这就是"被动技能是一等公民"的落地方式。
}

interface HitDef {
  /** 相对技能开始的毫秒偏移 = hit frame。多段攻击 = 多个 HitDef */
  at: number;
  /** 命中判定：目标侧是否无敌/减伤由引擎在此时刻检查 */
  effects: Effect[];
  /** 该段是否可被闪避（有些技能"无法闪避"） */
  avoidable?: boolean;
}

/**
 * 效果 = 一次 deal 里发生的事。
 * 技能 hits[].effects 和 DealAbility.hit.effects 用的是**同一个类型**——
 * 只有一个规范化表示，不存在"技能里的效果"和"独立效果"两套 schema。
 */
interface Effect {
  kind: 'damage' | 'heal' | 'grantBuff' | 'removeBuff' | 'resource' | 'interrupt'
      | 'dispel' | 'applyDebuffStack' | 'gauge';
  /** damage / heal 用 */
  damage?: DamageSpec;
  /** grantBuff / removeBuff / applyDebuffStack 用 */
  buff?: BuffDef;
  buffId?: BuffId;
  /** resource 用 */
  resource?: { key: ResourceKey; delta: number | Expr };
  /** 效果自己的目标（不填则取 HitDef 所在 ability 的 target） */
  target?: TargetRule;
  /** 效果自身的条件 */
  when?: Condition;
}

interface DamageSpec {
  base: number | Expr;              // 基础值
  /** 属性缩放：Σ stat × ratio */
  scaling?: Array<{ stat: StatKey; ratio: number; who?: Who }>;
  school: School;
  /** 结算链开关 */
  canCrit: boolean;
  /** 是否触发 onHitDealt / onCritDealt 等 hook */
  countsAsHit: boolean;
  /** 固定伤害：忽略增伤与减伤（用于"真实伤害"机制） */
  ignoreModifiers?: boolean;
  /** 目标侧是否可闪避 */
  avoidable?: boolean;
}

interface Cost {
  resource: ResourceKey;
  value: number | Expr;
  /** 不足时是否可施放（例如血量代价） */
  allowOverdraft?: boolean;
}

type TargetRule =
  | { mode: 'self' }
  | { mode: 'primaryEnemy' }        // 当前目标
  | { mode: 'allEnemies' }
  | { mode: 'allAllies' }
  | { mode: 'lowestHpAlly'; ratio: number }
  | { mode: 'nearestEnemy'; maxDistance?: number };
```

### 7.2 技能来源与技能书（G5 的核心）

装备/天赋/buff 都能授予技能，所以技能栏必须是**动态解析的视图**，不是静态数组。

```ts
type SkillOrigin =
  | { kind: 'innate' }                                     // 角色自带
  | { kind: 'talent'; talentId: EntityId }
  | { kind: 'item'; entityInstanceId: string; entityId: EntityId }
  | { kind: 'buff'; buffId: BuffId };

interface KnownSkill {
  skillId: SkillId;
  origin: SkillOrigin;
  /** 优先级：数字大的赢（innate 100 > talent 60 > item 40 > buff 20） */
  priority: number;
}

interface SkillBook {
  known: KnownSkill[];
  /** 技能栏：key → skillId 的绑定；槽不影响"是否可用"，只影响"哪个键" */
  bar: Array<{ index: number; key: string; skillId: SkillId | null }>;
  barSlotCount: number;             // 技能栏容量，超出部分进技能书
}
```

**解析规则（明确写死，避免歧义）**：

1. 同一 `skillId` 被多个来源授予 → 取 `priority` 最高者的 `origin`（用于 UI 显示来源）。
2. 来源消失（卸下装备 / buff 过期）→ 该技能从 `known` 移除；**技能栏绑定保留但不生效**
   （不自动清空槽位，避免玩家换装后要重新摆一遍）。
3. 技能栏容量不足 → 溢出的技能仍在 `known` 里，可在技能书页查看但不能上栏。
4. **正在施法/引导时来源消失** → **立即中断该次施法**，
   发 `castInterrupted(reason: 'sourceLost')`，**不返还已扣资源**（资源在施加时已扣）。
   理由：来源消失意味着技能已不存在，让它继续打出 hit frame 会与规则 2 冲突。
5. 修改技能栏是本模型里**唯一允许"直接改状态"的操作**，但它同样通过 `Action`
   走，因此可重放。
6. **任何影响属性的变化（buff 施加/消失/叠层、装备变更）必须标记 `statsDirty`，
   触发整棵派生属性树重算**，而不是只更新被直接改动的那一个 stat。
   理由见 §15 的规则 6：去掉 `+50 智力` 后，依赖智力的势能、依赖势能的涌动 buff、
   以及最终伤害全部需要跟着变，只改 `intelligence` 会算错。

### 7.3 GameEntity：一切内容的公共基类

`AbilitySource` 这个名字太窄——它暗示"内容只是能力的容器"。但内容还要表达：
**它是什么**（装备/消耗品/天赋/奇物）、**能不能持有**、**能不能使用**、
**有没有使用次数**。所以改名为 `GameEntity`。

```ts
/**
 * 一切可持有/可使用内容的公共基类。
 * Item / Talent / Buff / Consumable 都是 GameEntity 的特化。
 */
interface GameEntity {
  id: EntityId;
  /** 类型标签：决定 UI 分组、能否装备、能否主动使用 */
  kind: EntityKind;
  /** 显示名的 i18n key。引擎与内容数据里零文案（i18n 规范 §2） */
  nameKey: string;
  icon: string;
  /** 描述的 i18n key，可选 */
  descKey?: string;
  abilities: Ability[];          // ← 一切效果都挂在这里
  /** 自己的资源池：使用次数、充能住这里（§2.2） */
  pool?: ResourcePool;
  /** 稀有度（UI 染色用） */
  rarity?: Rarity;
  /** 需求条件：等级、前置装备、已解锁 */
  requires?: Condition[];
  /** 标签：用于互斥与查询，如 'relic' | 'potion' | 'stance' */
  tags?: string[];
}

type EntityKind =
  | 'equipment'      // 可装备，永久生效（奇物属于这类，slot 决定位置）
  | 'consumable'     // 可主动使用，用完消耗（药水/卷轴）
  | 'passive'        // 不可装备、自动生效（天赋/被动技能）
  | 'buffTemplate'   // 只能被 grant，玩家不能直接持有
  | 'activeSkill'    // 主动技能（进技能书）
  | 'encounter';     // 关卡定义

/** 装备类特化 */
interface EquipmentEntity extends GameEntity {
  kind: 'equipment';
  slot: EquipSlot;
  /** 是否可同时装备多个（G4） */
  multiEquip?: boolean;
  /** 授予的主动技能（便利写法，规范化后变成 grantSkill ability） */
  grantsSkills?: SkillId[];
  /** 施法/使用时是否消耗一件（消耗品行为） */
  consumedOnUse?: boolean;
}

interface ConsumableEntity extends GameEntity {
  kind: 'consumable';
  /** 使用后是否从背包移除 */
  destroyOnEmpty: boolean;
  /** 使用是否占 GCD */
  gcd: boolean;
  cooldownMs: number;
}

type EquipSlot = 'weapon' | 'armor' | 'trinket' | 'relic' | 'relic2';
type EntityId = string;
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
```

**"奇物可以提供被动效果"** —— 这已经是默认行为：`EquipmentEntity.abilities`
里的 `modifier` / `derived` / `trigger` **全部是永久生效**的（直到卸下）。
不需要额外的"被动效果"字段——**被动就是"装备期间一直存在的 ability"**。

**`kind` 与 `EntityKind` 是否重复？** 不重复：`GameEntity.kind` 是内容分类（UI 用），
`Ability.kind` 是能力的发射方式（引擎用）。两者正交。

### 7.4 天赋与主动技能

```ts
/** 天赋 / 被动技能：和主动技能同一 schema，只是 type: 'passive' */
interface TalentEntity extends GameEntity {
  kind: 'passive';
  /** 主动天赋本质上就是一个 SkillDef，引用之 */
  skillId?: SkillId;
}

interface ActiveSkillEntity extends GameEntity {
  kind: 'activeSkill';
  skillId: SkillId;
}
```

**统一的技能定义见 §7.1。** 关键点：**被动技能是一等公民**——
它就是 `SkillDef { type: 'passive' }`，效果写在继承来的 `abilities[]` 里。
旧项目没有这个能力（`Talent` 是空壳），新模型从第一天就支持。

---

## 8. 多实例与叠层（G4）

### 8.1 内容实例

```ts
interface GameEntityInstance {
  instanceId: string;      // 唯一，如 'ent_7'（G4：同内容可持有多份）
  defId: EntityId;
  /** 内容实例自己的资源池：使用次数、充能（§2.2） */
  pool: ResourcePool;
  /** 每个实例独立的技能冷却（旧项目缺这个：多个物品共享冷却会互相打架） */
  cooldowns: Record<SkillId, number>;
  /** 附魔/词条等随机化的运行时变体，MVP 留空（仅装备类可用） */
  affixes?: AffixInstance[];
  equippedAt?: number;
}

interface Loadout {
  items: GameEntityInstance[];              // 可含同 defId 的多份（multiEquip）
  talents: EntityId[];
  skillBar: SkillBook['bar'];
}
```

**同一个 `defId` 装两份**：两条 `GameEntityInstance` → 两份 `modifier` 贡献 → 加法层自然累加。
命名空间 `contrib` 也会累加。**不需要任何特判。**

### 8.2 buff 叠层

由 `BuffDef.stacking` 决定（§6.1）。默认 `{ mode: 'refresh' }`。

`perStackAdd` 这个 op 让"每层 +X"成为纯数据：

```ts
modifiers: [{ stat: 'damageBoost', op: 'perStackAdd', value: 0.05, source: '杀意' }]
// 3 层 → +15%
```

`buffStacks` 表达式让别的效果也能读层数：

```ts
value: { e: 'mul', of: [{ e: 'buffStacks', who:'self', buffId:'killing-intent' },
                        { e: 'const', value: 0.05 }] }
```

**两者都行，取决于是否需要被 `contrib` 引用。** 一般用 `perStackAdd`（更声明式）。

---

## 9. 走查：熵之钟（你的例子）

### 9.1 定义

需求原文：

> 我有一个奇物，3 个效果：
> 1. 被动加了 2 点属性
> 2. 根据属性增伤的效果
> 3. 暴击后，增伤效果翻倍持续 10s

```ts
export const ENTROPY_CLOCK: EquipmentEntity = {
  id: 'entropy-clock',
  nameKey: 'entity.entropyClock.name',
  descKey: 'entity.entropyClock.desc',
  icon: 'relic_entropy',
  slot: 'relic',
  rarity: 'legendary',
  abilities: [
    // ── 效果 1：被动 +2 属性 ──────────────────────────────────
    { kind: 'modifier',
      modifier: { stat: 'intelligence', op: 'add', value: 2,
                  sourceKey: 'entity.entropyClock.name', tier: 'item' } },
    { kind: 'modifier',
      modifier: { stat: 'spirit', op: 'add', value: 2,
                  sourceKey: 'entity.entropyClock.name', tier: 'item' } },

    // ── 效果 2：根据属性增伤（动态、可被引用） ────────────────
    { kind: 'derived',
      modifier: { stat: 'damageBoost', op: 'addPercent',
                  sourceKey: 'entity.entropyClock.sources.potential',
                  namespace: 'entropy-clock.potential',
                  tier: 'item' },
      value: { e: 'mul', of: [
        { e: 'const', value: 0.10 },
        { e: 'stat', who: 'self', stat: 'intelligence' },
      ] } },

    // ── 效果 3：暴击后，效果 2 翻倍，持续 10s ─────────────────
    { kind: 'trigger',
      trigger: {
        on: 'onCritDealt',
        filter: { by: 'self' },
        cooldownMs: 0,                       // 暴击必触发，无内置 CD
        then: [
          { kind: 'grant',
            target: { mode: 'self' },
            buff: {
              id: 'entropy-surge',
              nameKey: 'buff.entropySurge.name',
              icon: 'buff_surge',
              polarity: 'buff',
              duration: 10_000,
              maxStacks: 1,
              stacking: { mode: 'refresh' },
              modifiers: [{
                stat: 'damageBoost',
                op: 'addPercent',
                // 关键：不是写死的 10%，而是"引用势能命名空间的当前值"
                value: { e: 'contrib', namespace: 'entropy-clock.potential' },
                sourceKey: 'entity.entropyClock.sources.surge',
                tier: 'buff',
              }],
            } },
        ],
      } },
  ],
};
```

### 9.2 结算验证

设 `baseIntelligence = 100`，基础伤害 1000，无暴击。

| 阶段 | 计算 | 结果 |
|---|---|---|
| 智力 | `100 (base) + 2 (熵之钟) = 102` | **102** |
| 势能 `entropy-clock.potential` | `0.10 × 102` | **+10.2%** |
| 总 `damageBoost` | `10.2%`（只有势能） | **+10.2%** |
| 伤害 | `1000 × (1 + 0.102) = 1102` | **1102** |

暴击触发后，`entropy-surge` 生效：

| 阶段 | 计算 | 结果 |
|---|---|---|
| `entropy-surge` 的 modifier | `contrib('entropy-clock.potential') = 0.102` | **+10.2%** |
| 总 `damageBoost` | `10.2% (势能) + 10.2% (涌动)` | **+20.4%** |
| 伤害 | `1000 × 1.204 = 1204` | **1204** |

### 9.3 动态重算验证（G3）

现在给玩家挂一个 `+50 智力` 的 buff，**势能和涌动必须同时跟着变**：

| 项 | 变化前 | 变化后 |
|---|---|---|
| 智力 | 102 | **152** |
| 势能 | 10.2% | `0.10 × 152` = **15.2%** |
| 涌动（`contrib`） | 10.2% | **15.2%** ← 自动跟随，因为它是引用不是快照 |
| 总 `damageBoost` | 20.4% | **30.4%** |
| 伤害 | 1204 | **1304** |

**这就是"动态重算"的可测试定义**：`intelligence` 变了，涌动的贡献必须在
**同一次伤害结算内**反映出来。测试用例 §13 T3 直接断言这个数。

如果当初把涌动写成 `value: 0.102` 的常量，这里会停在 1204，测试立刻红。

### 9.4 "翻倍"的两种语义都被支持

你原话是"增伤效果翻倍"。有两种合理理解，**都在同一 schema 内**：

| 语义 | 写法 | 智力 152 时的总增伤 |
|---|---|---|
| **本条来源翻倍**（推荐） | 上面 §9.1 的 `contrib` 写法 | `15.2% + 15.2% = 30.4%` |
| **全局伤害翻倍** | `modifier: { stat: 'damageMult', op: 'mult', value: 2 }` | `(1 + 0.152) × 2 = 2.304 → +130.4%` |

内容作者选哪一种，**由数据决定，引擎不猜**。这正是"结构化修正"相对
"硬编码公式"的价值。

---

## 10. 可扩展性验证（G2）

这是本规范最重要的自检。下面 6 种增伤机制，**必须能用现有 schema 表达，
且不新增任何 `kind`、不改任何引擎代码**。如果哪一条表达不了，说明模型设计失败。

| # | 机制 | 表达方式 | 需要新东西吗 |
|---|---|---|---|
| 1 | 全局增伤 +10%（可叠多条） | `{ stat:'damageBoost', op:'addPercent', value:0.10 }` | 否 |
| 2 | 最终伤害 ×1.5 | `{ stat:'damageMult', op:'mult', value:1.5 }` | 否 |
| 3 | 目标血量低于 30% 时增伤 50% | 同上 + `when: { kind:'hpBelow', who:'target', ratio:0.30 }` | 否（复用 Condition） |
| 4 | 增伤等于已损失生命值比例 × 40% | `value: { e:'mul', of:[ {e:'missingResourceRatio',who:'self',resource:'hp'}, {e:'const',value:0.40} ] }` | 否（新 Expr **节点类型已存在**） |
| 5 | 每次命中 +2% 增伤，可叠 10 层 | buff `stacking:{mode:'stack',max:10}` + `{ stat:'damageBoost', op:'perStackAdd', value:0.02 }` | 否 |
| 6 | 无视 20% 护甲 | `{ stat:'armorPen', op:'add', value:0.20 }` | 否（`armorPen` 已在 StatKey 里） |
| 7 | 暴击伤害提升 30% | `{ stat:'critDamageBoost', op:'mult', value:1.30 }` | 否 |
| 8 | 施放技能后 5 秒内下次普攻增伤 200% | trigger `onCastFinish` → grant buff（含 `when` 限定 skill tag）+ 该 buff 上一段 combo 逻辑 | 否 |

**唯一需要"新增"的是新 stat 名（例如加一个 `bleedBoost`）。**
新 stat = 一行 `StatKey` 联合类型 + 一行聚合规则表。**这不算 schema 迁移**，
而且旧内容完全不受影响。

### 10.1 什么情况才需要改 schema

诚实列出**已知会逼我们扩展**的场景，以及预判的扩展点：

| 场景 | 需要的扩展 | 是否破坏旧内容 |
|---|---|---|
| 引导技能（持续施法，每 0.5s 一跳） | `SkillDef.channel` 字段已预留 | 否 |
| 多充能技能（2 层充能，各自回复） | `SkillDef.charges` 已预留 | 否 |
| 需要"距离"的机制 | `Expr` 已有 `distance` 节点（恒 0），`TargetRule.maxDistance` 已留 | 否 |
| 装备词条随机（Roguelike 掉落） | `GameEntityInstance.affixes` 已预留；需要 `AffixDef` 定义 | 否（新增定义类型，不改 Ability） |
| 护盾（吸收伤害的独立资源） | 新增 `Effect.kind: 'shield'` + `Combatant.shields[]` | 否（追加 union 分支） |
| 召唤物 | 新增 `Combatant.ownerId: CombatantId` + `summon` 能力 | 否 |

**设计原则**：宁可现在预留一个字段，也不要为了"以后可能要用"提前实现。
预留字段（`channel` / `charges`）只是类型声明，
**零实现成本**，但能避免以后改 schema 时波及所有内容文件。

---

## 11. 内容校验（G7）

所有 `ContentDef` 在**加载期**进入校验器。任一失败 → 构建/启动即失败，
**绝不允许带着非法数据进战斗**。

```ts
interface ValidationIssue {
  severity: 'error' | 'warning';
  path: string;             // 'entropy-clock.abilities[1].value'
  message: string;
  code: ValidationCode;
}
```

校验项：

| code | 检查 | 级别 |
|---|---|---|
| `CYCLE` | 派生 stat 的依赖图有环 | error |
| `DANGLING_REF` | `contrib` 引用了不存在的命名空间 | error |
| `MISSING_BUFF` | `buffId` / `skillId` 不存在 | error |
| `MISSING_SOURCE` | `StatModifier.sourceKey` 为空 | error |
| `BAD_TIER` | 派生 stat 引用了 tier 相同或更高的 stat | error |
| `DUP_ID` | 内容 id 重复 | error |
| `HIT_ORDER` | `hits[].at` 未按升序 / 有重复 | error |
| `ZERO_DURATION` | `duration <= 0` 的 buff | error |
| `GCD_LOOP` | 技能 `requires` 里既要求有 gcd 又 `gcd: true`（自锁死） | error |
| `SLOT_FULL` | 技能栏容量 < 授予技能数 | warning |
| `UNCAPPED_STACK` | `stacking.mode:'stack'` 但 `max` 未设 | error |
| `UNREACHABLE` | 技能 `requires` 条件永不可能满足 | warning |
| `MISSING_LOCALE_KEY` | `nameKey`/`descKey`/`sourceKey` 在 catalog 里不存在 | error |
| `KEY_ID_MISMATCH` | `entity.entropyClock.*` 存在但 `id !== 'entropy-clock'` | error |
| `LOCALE_PARITY` | 非基准语言的 key 集合与基准不一致 | error |
| `PLACEHOLDER_MISMATCH` | 同一 key 在不同语言里的 `{placeholder}` 集合不同 | error |
| `EMPTY_STRING` | 某个 i18n key 的值是空串 | error |
| `HARDCODED_TEXT` | 内容定义里出现了 `name`/`description`/`source` 等文案字段 | error |

> i18n 相关的校验细节见 [i18n 规范](2026-10-09-i18n.md) §6。

**`GCD_LOOP` 值得单独说**：派生的经典错误是自己把自己锁死。
加载期静态图分析能抓到它，比在战斗里 debug"为什么按键没反应"便宜得多。

---

## 12. 事件与钩子

```ts
// —— 慢通道：给渲染层/日志/飘字。每 tick 收集一次，有结构、可序列化 ——
type EventDef =
  | { kind:'damage';   sourceId:CombatantId; targetId:CombatantId; amount:number;
      crit:boolean; school:School; absorbed:number; overkill:number }
  | { kind:'heal';     sourceId:CombatantId; targetId:CombatantId; amount:number; crit:boolean }
  | { kind:'miss';     sourceId:CombatantId; targetId:CombatantId;
      reason:'invulnerable'|'dodged' }                    // 闪避成功必须有独立事件
  | { kind:'avoided';  sourceId:CombatantId; targetId:CombatantId; skillId:SkillId;
      reason:'dodged'|'immune' }
  | { kind:'buffApplied'|'buffExpired'|'buffStackChanged'|'buffRefreshed';
      targetId:CombatantId; buffId:BuffId; stacks:number; sourceId:CombatantId }
  | { kind:'castStarted'|'castFinished'|'castInterrupted';
      sourceId:CombatantId; skillId:SkillId }
  | { kind:'interruptSuccess'; sourceId:CombatantId; targetId:CombatantId; skillId:SkillId }
  | { kind:'resourceChanged'; targetId:CombatantId; resource:ResourceKey; delta:number; current:number }
  | { kind:'cooldownTriggered'; sourceId:CombatantId; skillId:SkillId }
  | { kind:'skillUsed'; sourceId:CombatantId; skillId:SkillId }   // 含被拒绝的施放尝试
  | { kind:'skillRejected'; sourceId:CombatantId; skillId:SkillId;
      reason:'gcd'|'cooldown'|'cost'|'casting'|'condition'|'locked' }
  | { kind:'phaseChanged'; phase:number; bossId:CombatantId }
  | { kind:'enrageStarted'; bossId:CombatantId }
  | { kind:'death'; targetId:CombatantId }
  | { kind:'encounterEnd'; result:'victory'|'defeat';
      reason:'hpZero'|'timeout'|'enrage' };

// —— 快通道：给触发器。只带最小载荷，渲染层不消费 ——
type Hook =
  | 'onCastStart' | 'onCastFinish' | 'onCastInterrupted' | 'onInterruptSuccess'
  | 'onHitDealt' | 'onHitTaken' | 'onCritDealt' | 'onCritTaken'
  | 'onAvoided'          // 成功闪避
  | 'onKill'
  | 'onBuffApplied' | 'onBuffExpired' | 'onBuffStackChanged'
  | 'onResourceSpent' | 'onResourceGained'
  | 'onLowHp' | 'onDamagedBelow' | 'onHealed'
  | 'onTick' | 'onEncounterStart' | 'onEncounterEnd' | 'onPhaseChange';

type HookFilter =
  | { by:'self' } | { by:'other' }
  | { by:'skill'; skillId?:SkillId; tag?:SkillTag }
  | { by:'school'; school:School }
  | { by:'buff'; buffId:BuffId };
```

**`skillRejected` 很重要**：玩家按键没反应时，必须能知道原因（GCD？CD？资源？
条件不满足？被锁？），渲染层才能给出正确反馈（提示文字 + 技能格抖动）。
旧项目这里只 `dispatch(addLog(...))` 一句"我还不能使用这个技能"，太粗糙。

---

## 13. 验收测试

模型能否成立，由这些测试证明。**这些测试先于实现写。**

### T1 — 被动属性（§9 效果 1）
```
GIVEN 装备 entropy-clock
THEN computeStats(intelligence) 的 breakdown 含
     { source:'熵之钟', op:'add', value:2 }
AND  intelligence === base + 2
```

### T2 — 派生增伤（§9 效果 2）
```
GIVEN 装备 entropy-clock, intelligence = 100
THEN damageBoost === 0.10 × 102 = 0.102     (注意含效果 1 的 +2)
AND  breakdown 含 { sourceKey:'entity.entropyClock.sources.potential',
                     namespace:'entropy-clock.potential' }
```

### T3 — 动态重算（G3，最关键）
```
GIVEN entropy-surge 生效, intelligence = 100
WHEN  智力增加 50
THEN damageBoost === 0.152 (势能) + 0.152 (涌动) = 0.304
AND  entropy-surge 的贡献 === 0.152     ← 不是 0.102
```
**这条测试如果红了，说明实现里存在快照，必须修。**

### T4 — 暴击触发（§9 效果 3）
```
GIVEN 无 entropy-surge
WHEN  一次暴击命中
THEN 事件流含 buffApplied(buffId:'entropy-surge', duration:10000)
AND  damageBoost 立即从 0.102 变为 0.204
```

### T5 — 叠层（G4）
```
GIVEN buff 'killing-intent' stacking={mode:'stack',max:10},
      modifier={stat:'damageBoost',op:'perStackAdd',value:0.02}
WHEN  触发 3 次
THEN  stacks === 3 AND damageBoost 贡献 === 0.06
WHEN  再触发 9 次
THEN  stacks === 10 (钳制) AND 贡献 === 0.20
```

### T6 — 多份同内容（G4）
```
GIVEN 装备两份 entropy-clock（multiEquip）
THEN  intelligence === base + 4
AND   damageBoost === 2 × (0.10 × (base+4))
```

### T7 — 装备授予技能（G5）
```
GIVEN 装备 item 'war-banner' (grantsSkills: ['rally'])
THEN  skillBook.known 含 { skillId:'rally', origin:{kind:'item',...} }
WHEN  卸下该装备
THEN  skillBook.known 不含 'rally'
AND   技能栏绑定位仍存在但标记为不可用
```

### T8 — 判定窗口（§6.3）
```
GIVEN player 有 buff { duration:300, flags:{invulnerable:true} }
WHEN  boss hit frame 落在 [appliedAt, appliedAt+300) 内
THEN 事件流含 miss(reason:'invulnerable') AND hp 不变
WHEN  hit frame 落在 appliedAt+301
THEN  正常结算伤害
AND   边界值 300 与 301 都单独断言（一帧之差）
```

### T9 — 派生技能（§6.3）
```
GIVEN 无 combo_window
WHEN  尝试施放技能 'arc' (requires hasBuff combo_window)
THEN  skillRejected(reason:'condition')
WHEN  先施放 'slash'（授予 combo_window 1500ms）
AND   立即施放 'arc'
THEN  成功，事件流含 skillUsed('arc')
```

### T10 — GCD（§6.3）
```
GIVEN 技能 'slash' gcd:true, 技能 'dodge' gcd:false
WHEN  施放 'slash'
THEN  300ms 内施放 'slash' → skillRejected(reason:'gcd')
AND   300ms 内施放 'dodge' → 成功
```

### T11 — 阶段切换（Boss 行为）
```
GIVEN boss behaviors 含 { kind:'phases', at:[0.5] }
WHEN  boss.hp 降到 50% 以下
THEN 事件流含 phaseChanged(phase:2)（仅一次，不重复触发）
```

### T12 — 狂暴
```
GIVEN behaviors 含 { kind:'enrage', atMs:180000, dmgMult:2 }
WHEN  战斗进行到 180s
THEN 事件流含 enrageStarted
AND   boss 后续伤害 ×2
```

### T13 — 循环依赖在加载期报错（G7）
```
GIVEN 内容 A 的 derived stat 引用 B，B 的 derived 引用 A
WHEN  loadContent(...)
THEN  抛出错误，code === 'CYCLE'
AND   错误信息包含完整依赖链
```

### T14 — Golden Replay（回归防线）
```
GIVEN 固定 seed + 一段录制好的 Action 序列
WHEN  run(seed, actions)
THEN  最终 BattleState 的哈希 === 录制的哈希
```
**这是整个项目最重要的测试。** 任何数值、顺序、公式的改动都会让它红。

---

## 14. 目录结构（本规范相关部分）

```
src/
  core/                       # ← 零依赖纯 TS，可在 Node 里跑
    types.ts                  # 本规范 §2-§7 的全部类型
    expr/
      eval.ts                 # Expr 求值器
      deps.ts                 # 依赖图 + 拓扑排序 + 环检测（§3.4）
    stats/
      pipeline.ts             # §5.3 的 8 阶段结算
      aggregate.ts            # §5.2 聚合规则表
      breakdown.ts            # §5.4 溯源
    abilities/
      registry.ts             # kind → handler（§2.1）
      modifier.ts derived.ts trigger.ts grant.ts deal.ts grantSkill.ts
    buffs/
      apply.ts expire.ts stack.ts resolve.ts
    skills/
      cast.ts cooldown.ts cost.ts book.ts     # book.ts = §7.2 技能书解析
    combat/
      hit.ts                  # hit frame 判定（§6.3 的 buff flags 检查）
      damage.ts heal.ts
    content/
      validate.ts             # §11 校验器
      normalize.ts            # 便利字段 → 统一 ability 表示
  data/                       # 内容：纯数据，不含逻辑
    items/  skills/  talents/  buffs/  encounters/
```

**硬约束（lint 强制）**：`core/` 不许 import 任何 `pixi` / DOM / `app` / `ui` / `render`。
理由见 `2026-10-09-architecture.md` §2。

---

## 15. 决议记录

| # | 议题 | 结论 |
|---|---|---|
| 1 | `damageBoost` 加法聚合 / `damageMult` 乘法聚合 | ✅ **认可**（2026-10-09）。两种语义并存，由数据选 |
| 2 | `contrib` 命名空间引用（而非数组下标） | ✅ **认可** |
| 3 | Buff/Debuff 合并为一个模型（`polarity` 区分） | ✅ **认可** |
| 4 | 施法中途技能来源消失的行为 | ❌ **反对**"让该次施法完成"。改为 §7.2 新规则 4（见下） |
| 5 | 预留字段（`channel` / `charges`） | ✅ 仅保留这两个。`distance` **删除**（本作无位移，见 §3.5）；`affixes` 下沉到 `GameEntityInstance` |
| 6 | `AbilitySource` → `GameEntity` | ✅ **改名**。新增 `EntityKind`、消耗品、使用次数（§2.2、§7.3） |
| 7 | 属性溯源（`StatBreakdown`） | ✅ **必须有**。buff 消失后重算全部受影响派生属性（§5.4、§7.2 规则 6） |

### 7.2 规则 4（修订版）

> **技能来源在施法/引导过程中消失 → 立即中断该次施法**，
> 发 `castInterrupted(reason: 'sourceLost')`，**不返还已消耗的资源**（资源在施加时已扣）。

理由：来源消失意味着这个技能已经不存在了，让它继续打出 hit frame 会与
"技能栏绑定保留但不生效"的规则冲突，产生"卸了装备还能打出伤害"的观感 bug。

同时新增一条对属性溯源的要求（§7.2 规则 6）：

> **任何影响属性的状态变化（buff 消失/施加、层数变化、装备变更）都必须标记
> `statsDirty`，而不是只更新被直接改动的那个 stat。**
>
> 反例：`+50 智力` 的 buff 消失时，如果只把 `intelligence` 减回去，
> 那么依赖智力的 `damageBoost`（势能）、依赖势能的涌动 buff、依赖它们的最终伤害
> **全都算错**。所以**移除一个 modifier 后必须重算整棵派生树**。
>
> 这是"属性溯源必须有"的真实原因——它决定了重算的**范围**，
> 而不是只提供 UI 展示。测试 T3 与新增的 T3b 覆盖这一条。

### i18n 验收测试

细节见 [i18n 规范](2026-10-09-i18n.md) §9。

```
I18N-T1  catalog 扁平化后每条 key 都能被 t() 取到，且值非空
I18N-T2  所有 data/ 内容通过校验（无 MISSING_LOCALE_KEY / KEY_ID_MISMATCH）
I18N-T3  同一 key 在基准语言里唯一（扁平化时检测重复）
I18N-T4  带占位符的 key：t('x', {name:'a'}) 正确替换，缺失参数时抛错
I18N-T5  number/percent/duration 的输出与预期字符串一致
I18N-T6  ORPHAN_LOCALE_KEY 检测能找出刻意插入的孤立 key
I18N-T7  lint I1 实测：src/ 里写一行含中文的字符串字面量 → 报错
```
