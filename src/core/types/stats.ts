/** 属性、修正器与表达式。 */

import type { BuffId, LocaleKey, ModifierNamespace, Side } from './ids';
import type { ResourceKey, ResourcePoolRef } from './resources';

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
  | {
      readonly e: 'stat';
      readonly who: Who;
      readonly stat: StatKey;
      /**
       * 把这个属性乘一个倍数。缺省 = 1（原有行为）。
       *
       * ⚠️ 它存在的理由只有一个：**把"比率"写成"百分点"**。
       * `damageTakenMult` 这类属性是 **1 = 基准**（0.5 表示减半），
       * 而内容作者读它时想的是"百分比"（+30% 要写 1.3）。
       * 所以 `{ e:'stat', stat:'damageTakenMult', scale:100 }` 读出来
       * 是 **130**，可以直接减 100 得到"高出的那 30 点"。
       *
       * 它**不是**给"顺手乘一下"用的 —— 那种事该写 `mul`。
       */
      readonly scale?: number;
    }
  | { readonly e: 'resource'; readonly who: Who; readonly resource: ResourceKey }
  | { readonly e: 'maxResource'; readonly who: Who; readonly resource: ResourceKey }
  | { readonly e: 'resourceRatio'; readonly who: Who; readonly resource: ResourceKey }
  | { readonly e: 'missingResourceRatio'; readonly who: Who; readonly resource: ResourceKey }
  /**
   * **生命百分比**。
   *
   * ⚠️ 为什么不复用 `resourceRatio { resource: 'hp' }`：两者**能**算出同一个
   * 数，但"血量百分比"是本仓库里出现频率最高的一种读法（差值 / 门槛 /
   * 描述文案都在用），把它写成 `resourceRatio` 会让**每次读它的人都要
   * 多看一眼"hp 是不是也是一个 resource"**。语义入口清晰比少一个联合成员
   * 重要 —— 这与 `hpBelow` / `hpAbove` 单独存在（而不是塞进
   * `resourceBelow`）是同一条惯例。
   */
  | { readonly e: 'hpRatio'; readonly who: Who }
  | { readonly e: 'buffStacks'; readonly who: Who; readonly buffId: BuffId }
  | { readonly e: 'hasBuff'; readonly who: Who; readonly buffId: BuffId }
  /**
   * 读内容实例的离散计数器（使用次数 / 充能）。
   *
   * ⚠️ **引擎尚未实现（2026-10-12 核对）**：没有任何写入者会写
   * `Combatant.counters`，战斗路径的求值上下文把 `getCounter`
   * 实现成 `() => 0`。**类型保留**（这是设计过的能力），但内容里写它
   * 会被 `validate.ts` 的 `COUNTER_UNIMPLEMENTED` 拦下 —— 否则作者会
   * **静默拿到 0**（不是报错，是算错，最坏的一种）。
   * 实现之后把那条校验删掉即可。
   */
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
