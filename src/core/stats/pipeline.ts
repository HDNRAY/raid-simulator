/**
 * 修正树与属性结算。
 *
 * 数据模型规范 §5.3 的 8 个阶段。**顺序是不变量**：改了顺序就会改变
 * 战斗结果，黄金重放测试会立刻发现。
 *
 * ------------------------------------------------------------------
 * 动态重算怎么落地（规范 §7.2 规则 6）
 * ------------------------------------------------------------------
 *
 * 这里**没有任何数值快照**。修正存的是 `number | Expr`，
 * 派生修正每次结算都重新求值。于是：
 *
 *   智力 +50 的 buff 消失
 *     → 修正池里少了一条 modifier
 *     → 重算时 damageBoost 的派生表达式读到新的智力
 *     → 依赖它的 buff（contrib 引用命名空间）也跟着变
 *
 * 关键实现：`statValue(stat)` 是**惰性且带记忆**的递归函数 ——
 * 派生表达式引用别的 stat 时直接递归进去。所以：
 *   - 不需要预先拓扑排序（M1-2 的 tier 只用于加载期校验）
 *   - `contrib` 引用命名空间时同样递归求解，天然支持跨来源引用
 *   - 环会被 `resolving` 集合兜住（加载期应该已经挡住，这里只是保险）
 *
 * ------------------------------------------------------------------
 * 表达式求值只有一份实现
 * ------------------------------------------------------------------
 *
 * 本模块**不重新实现表达式求值**，而是把 `EvalContext` 接到
 * `expr/eval.ts` 的 `evalExpr` 上。理由很简单：
 * 两套求值实现必然会在某个边界上不一致（这正是时间表示踩过的坑）。
 */

import { kahanSum } from '../numeric';
import { evalExpr, type EvalContext } from '../expr/eval';
import type { Condition, Expr, ResourceKey, StatKey, StatModifier, Who } from '../types';
import { STAT_RULES } from './aggregate';

/** 累加桶：把一批修正按 op 归入各层。 */
interface Accumulators {
  addSum: number;
  percentSum: number;
  multProduct: number;
  override: number | undefined;
  maxValue: number | undefined;
  flat: Provenance[];
  derived: Provenance[];
}

/** 溯源条目：某个 stat 的某个来源贡献了多少。 */
export interface Provenance {
  readonly sourceKey: string;
  readonly namespace?: string;
  readonly value: number;
}

/**
 * 一个 stat 的结算明细（开发模式下构建，用于 UI 与调试）。
 *
 * `flat` / `derived` 是**必须**有的：玩家对"我的属性从哪来的"有强需求，
 * 而且测试可以直接断言"某来源贡献了某值"而不是只断言总数。
 */
export interface StatBreakdown {
  readonly base: number;
  /** 加法层之和 */
  readonly add: number;
  /** 派生层（每个派生来源一条） */
  readonly derived: readonly Provenance[];
  /** 百分比层之和 */
  readonly percentSum: number;
  /** 乘法层之积 */
  readonly multProduct: number;
  readonly override?: number;
  readonly max?: number;
  /** 非表达式修正的来源明细 */
  readonly flat: readonly Provenance[];
  readonly final: number;
}

export interface StatsResult {
  readonly values: Readonly<Record<StatKey, number>>;
  readonly breakdown?: Readonly<Partial<Record<StatKey, StatBreakdown>>>;
}

export interface ComputeStatsOptions {
  /** 基础值（来自内容定义）。缺省为 0。 */
  readonly base?: Partial<Record<StatKey, number>>;
  /**
   * 修正池。调用方负责把内容（装备 / 天赋 / buff）**展开**成扁平数组 ——
   * 本模块只做结算，不关心"这条修正是从哪件装备来的"。
   */
  readonly modifiers: readonly StatModifier[];
  /** 是否构建溯源明细。生产环境应为 false（避免每 tick 建大对象）。 */
  readonly wantBreakdown?: boolean;
  /**
   * 层数查询（`perStackAdd` 用）。
   *
   * 参数是修正的 `namespace ?? sourceKey` —— 约定内容作者用 namespace
   * 标记"这条修正属于哪个 buff"，于是层数能对上。
   */
  readonly stackCount?: (key: string) => number;
  /** 条件求值（`modifier.when` 与条件表达式用）。 */
  readonly evaluateCondition?: (condition: Condition) => boolean;
  /** 资源读取（表达式可能引用资源）。不提供时资源类节点返回 0。 */
  readonly resourceAccess?: {
    getResource(who: Who, resource: ResourceKey): number;
    getMaxResource(who: Who, resource: ResourceKey): number;
    getBuffStacks(who: Who, buffId: string): number;
    getCounter(pool: string, counter: string): number;
  };
}

/**
 * 计算全部属性。
 *
 * 返回全新的 plain object，不修改任何输入。
 */
export function computeStats(options: ComputeStatsOptions): StatsResult {
  const {
    base = {},
    modifiers,
    wantBreakdown = false,
    stackCount,
    evaluateCondition,
    resourceAccess,
  } = options;

  /* ---------- 整理：按 stat 分组，过滤掉条件不满足的 ---------- */
  const modsByStat = new Map<StatKey, StatModifier[]>();
  /** 命名空间 → 属于它的修正（`contrib` 要在这里求和） */
  const modsByNamespace = new Map<string, StatModifier[]>();

  for (const modifier of modifiers) {
    if (modifier.when && evaluateCondition && !evaluateCondition(modifier.when)) continue;

    let list = modsByStat.get(modifier.stat);
    if (!list) {
      list = [];
      modsByStat.set(modifier.stat, list);
    }
    list.push(modifier);

    if (modifier.namespace) {
      let nsList = modsByNamespace.get(modifier.namespace);
      if (!nsList) {
        nsList = [];
        modsByNamespace.set(modifier.namespace, nsList);
      }
      nsList.push(modifier);
    }
  }

  /* ---------- 惰性求解 ---------- */
  const statCache = new Map<StatKey, number>();
  const namespaceCache = new Map<string, number>();
  /** 正在求解中的 key（stat 与 `ns:<namespace>`），用于兜住环 */
  const resolving = new Set<string>();

  /** 命名空间当前值 = 其中所有修正之和（各自重新求值 → 动态重算）。 */
  const namespaceValue = (namespace: string): number => {
    const cached = namespaceCache.get(namespace);
    if (cached !== undefined) return cached;
    const key = `ns:${namespace}`;
    if (resolving.has(key)) return 0;

    const list = modsByNamespace.get(namespace);
    if (!list || list.length === 0) {
      namespaceCache.set(namespace, 0);
      return 0;
    }

    resolving.add(key);
    const parts: number[] = [];
    for (const modifier of list) parts.push(modifierValue(modifier));
    resolving.delete(key);

    const total = kahanSum(parts);
    namespaceCache.set(namespace, total);
    return total;
  };

  /** 一条修正的当前数值（表达式 → 求值；数字 → 原值）。 */
  const modifierValue = (modifier: StatModifier): number => {
    if (typeof modifier.value === 'number') {
      return modifier.op === 'perStackAdd'
        ? modifier.value * (stackCount?.(modifier.namespace ?? modifier.sourceKey) ?? 1)
        : modifier.value;
    }
    return evalExpr(modifier.value, ctx);
  };

  /**
   * 某个 stat 的当前值（已完成阶段 0-3 的值）。
   *
   * 派生表达式引用别的 stat 时读的就是它 —— 这样派生之间可以互相引用，
   * 而且每次都重新求值，所以是"动态重算"。
   */
  const statValue = (stat: StatKey): number => {
    const cached = statCache.get(stat);
    if (cached !== undefined) return cached;
    if (resolving.has(stat)) {
      // 运行时环兜底：加载期校验本该挡住。返回基础值而不是爆栈。
      return base[stat] ?? 0;
    }

    resolving.add(stat);
    const list = modsByStat.get(stat) ?? [];
    const parts = accumulate(stat, list);
    resolving.delete(stat);

    const value = finalize(stat, parts);
    statCache.set(stat, value);
    return value;
  };

  /** 把一批修正按 op 累加进各个桶。 */
  const accumulate = (stat: StatKey, list: readonly StatModifier[]): Accumulators => {
    const acc: Accumulators = {
      addSum: 0,
      percentSum: 0,
      multProduct: 1,
      override: undefined,
      maxValue: undefined,
      flat: [],
      derived: [],
    };

    for (const modifier of list) {
      const value = modifierValue(modifier);
      const entry: Provenance = {
        sourceKey: modifier.sourceKey,
        ...(modifier.namespace === undefined ? {} : { namespace: modifier.namespace }),
        value,
      };

      switch (modifier.op) {
        case 'add':
        case 'perStackAdd':
          acc.addSum += value;
          acc.flat.push(entry);
          break;
        case 'addPercent':
          acc.percentSum += value;
          if (typeof modifier.value === 'number') acc.flat.push(entry);
          else acc.derived.push(entry);
          break;
        case 'mult':
          acc.multProduct *= value;
          acc.flat.push(entry);
          break;
        case 'setOverride':
          acc.override = value;
          acc.flat.push(entry);
          break;
        case 'max':
          acc.maxValue = acc.maxValue === undefined ? value : Math.max(acc.maxValue, value);
          acc.flat.push(entry);
          break;
      }
    }

    void stat;
    return acc;
  };

  /**
   * 按 stat 的**语义分类**组装最终值。
   *
   * 这是 M1-3 踩过的坑：最初对所有 stat 都用
   * `(base + add) × (1 + percent) × mult`，于是 `damageBoost` 的
   * `+10%` 变成 `0 × 1.1 = 0` —— 百分比乘在了 0 上。
   *
   * 正确的分叉（见 aggregate.ts 的 `Kind`）：
   *   accumulator  `base + add + Σpercent`      ← +10% 就直接得到 0.1
   *   multiplier   `(base || 1) + add` 然后 ×(1+Σpercent)×mult
   *   value        `base + add`（覆盖/最大值/钳制）
   */
  const finalize = (stat: StatKey, acc: Accumulators): number => {
    const rule = STAT_RULES[stat];
    const baseValue = base[stat] ?? 0;

    let value: number;
    switch (rule.kind) {
      case 'accumulator':
        // 百分比类贡献直接累加；`mult` 型（少见）仍然相乘
        value = baseValue + acc.addSum + acc.percentSum;
        value *= acc.multProduct;
        break;
      case 'multiplier': {
        // 基值语义是 1：加法型贡献按 `1 + Σ`，乘法型贡献按 ∏
        const base1 = baseValue === 0 ? 1 : baseValue;
        value = base1 + acc.addSum;
        value *= 1 + acc.percentSum;
        value *= acc.multProduct;
        break;
      }
      case 'value':
        value = baseValue + acc.addSum;
        value *= acc.multProduct;
        value += acc.percentSum;
        break;
    }

    if (acc.override !== undefined) value = acc.override;
    if (acc.maxValue !== undefined) value = Math.max(value, acc.maxValue);
    return clampRule(stat, value);
  };

  /** 表达式求值上下文：把修正树的能力暴露给 `evalExpr`。 */
  const ctx: EvalContext = {
    getStat: (_who, stat) => statValue(stat),
    getResource: (who, resource) => resourceAccess?.getResource(who, resource) ?? 0,
    getMaxResource: (who, resource) => resourceAccess?.getMaxResource(who, resource) ?? 0,
    getBuffStacks: (who, buffId) => resourceAccess?.getBuffStacks(who, buffId) ?? 0,
    getCounter: (pool, counter) => resourceAccess?.getCounter(pool, counter) ?? 0,
    getContribution: (namespace) => namespaceValue(namespace),
    evaluateCondition: (condition) => evaluateCondition?.(condition) ?? condition.kind === 'always',
  };

  /* ---------- 组装最终值（含覆盖 / 最大值 / 钳制） ---------- */
  const values = {} as Record<StatKey, number>;
  const breakdown: Partial<Record<StatKey, StatBreakdown>> = {};

  for (const stat of Object.keys(STAT_RULES) as StatKey[]) {
    const list = modsByStat.get(stat) ?? [];
    const acc = accumulate(stat, list);
    const final = finalize(stat, acc);
    values[stat] = final;

    if (wantBreakdown) {
      breakdown[stat] = {
        base: base[stat] ?? 0,
        add: acc.addSum,
        derived: acc.derived,
        percentSum: acc.percentSum,
        multProduct: acc.multProduct,
        ...(acc.override === undefined ? {} : { override: acc.override }),
        ...(acc.maxValue === undefined ? {} : { max: acc.maxValue }),
        flat: acc.flat,
        final,
      };
    }
  }

  return wantBreakdown ? { values, breakdown } : { values };
}

/* ------------------------------------------------------------------ *
 * 辅助
 * ------------------------------------------------------------------ */

/** 对规则表里的范围做钳制（并保证结果是有限数）。 */
function clampRule(stat: StatKey, value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rule = STAT_RULES[stat];
  if (!rule.clamp) return value;
  const [min, max] = rule.clamp;
  return value < min ? min : value > max ? max : value;
}

/** 从修正池里筛出属于某个命名空间的那些（供内容层做校验与展开）。 */
export function modifiersInNamespace(
  modifiers: readonly StatModifier[],
  namespace: string,
): readonly StatModifier[] {
  return modifiers.filter((m) => m.namespace === namespace);
}

/** 类型导出，便于测试断言溯源结构。 */
export type { Expr };
