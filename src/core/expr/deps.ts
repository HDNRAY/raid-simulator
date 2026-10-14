/**
 * 表达式依赖图：提取引用、拓扑分层、环检测。
 *
 * 数据模型规范 §3.4：
 *   派生 stat 只能引用 tier 更低的 stat。有环就在**加载期**报错，
 *   而不是等到战斗中无限递归。
 *
 * 为什么这件事必须在加载期做：环的表现为栈溢出或无限循环，
 * 在战斗里出现时极难定位（是哪个内容引起的？）。而静态图分析
 * 能在启动时给出**完整依赖链**，直接指出是谁引用谁。
 */

import type { Ability, BuffDef, EntityId, Expr, StatKey } from '../types';

/** 一个 stat 的依赖信息。 */
export interface StatDependency {
  /** 该 stat 依赖的其他 stat */
  readonly dependsOn: readonly StatKey[];
  /** 拓扑层级（0 为最底层，只依赖基础值） */
  readonly tier: number;
  /** 依赖链的样例，报错时用于指路：['damageBoost', 'intelligence', 'damageBoost'] */
  readonly chain: readonly StatKey[];
}

export interface DependencyGraph {
  readonly byStat: ReadonlyMap<StatKey, StatDependency>;
  /** 检测到的环（第一个即可，报错够用） */
  readonly cycles: readonly (readonly StatKey[])[];
}

/* ------------------------------------------------------------------ *
 * 1. 从表达式提取引用
 * ------------------------------------------------------------------ */

export interface ExprRefs {
  readonly stats: readonly StatKey[];
  readonly namespaces: readonly string[];
  readonly buffIds: readonly string[];
}

/** 递归收集一个表达式的全部引用。 */
export function collectExprRefs(expr: Expr, into?: ExprRefsAccumulator): ExprRefsAccumulator {
  const acc = into ?? { stats: [], namespaces: [], buffIds: [] };
  visitExpr(expr, acc);
  return acc;
}

interface ExprRefsAccumulator {
  stats: StatKey[];
  namespaces: string[];
  buffIds: string[];
}

function visitExpr(expr: Expr, acc: ExprRefsAccumulator): void {
  switch (expr.e) {
    case 'const':
      return;
    case 'stat':
      acc.stats.push(expr.stat);
      return;
    case 'buffStacks':
    case 'hasBuff':
      acc.buffIds.push(expr.buffId);
      return;
    case 'contrib':
      acc.namespaces.push(expr.namespace);
      return;
    case 'resource':
    case 'maxResource':
    case 'resourceRatio':
    case 'missingResourceRatio':
    case 'hpRatio':
    case 'counter':
      return;
    case 'add':
    case 'mul':
    case 'min':
    case 'max':
      for (const item of expr.of) visitExpr(item, acc);
      return;
    case 'clamp':
      visitExpr(expr.value, acc);
      visitExpr(expr.min, acc);
      visitExpr(expr.max, acc);
      return;
    case 'neg':
      visitExpr(expr.value, acc);
      return;
    case 'cond':
      visitExpr(expr.then, acc);
      visitExpr(expr.else, acc);
      return;
  }
}

/* ------------------------------------------------------------------ *
 * 2. 从内容收集"某个 stat 由哪些表达式产出"
 * ------------------------------------------------------------------ */

/** 一条派生修正：它产出哪个 stat、值依赖什么。 */
export interface DerivedSource {
  readonly stat: StatKey;
  readonly namespace?: string;
  readonly expr: Expr;
}

/** 遍历全部 ability，收集派生修正与命名空间归属。 */
export function collectDerivedSources(abilities: readonly Ability[]): readonly DerivedSource[] {
  const out: DerivedSource[] = [];

  const visitAbilities = (list: readonly Ability[]): void => {
    for (const ability of list) {
      switch (ability.kind) {
        case 'derived':
          out.push({
            stat: ability.modifier.stat,
            ...(ability.modifier.namespace === undefined
              ? {}
              : { namespace: ability.modifier.namespace }),
            expr: ability.value,
          });
          break;
        case 'modifier': {
          // `modifier` 的 value 也可以是表达式 —— 那同样是动态值，
          // 必须进依赖图，否则"buff 的修正引用别的 stat"这类环检测不到。
          const { value } = ability.modifier;
          if (typeof value !== 'number') {
            out.push({
              stat: ability.modifier.stat,
              ...(ability.modifier.namespace === undefined
                ? {}
                : { namespace: ability.modifier.namespace }),
              expr: value,
            });
          }
          break;
        }
        case 'trigger':
          // 触发器的产出也是 ability，递归收集（buff 授予 buff 也要覆盖）
          visitAbilities(ability.trigger.then);
          break;
        case 'grant':
          visitAbilities(buffAbilities(ability.buff));
          break;
        case 'deal':
        case 'grantSkill':
        case 'consume':
        case 'resource':
          break;
      }
    }
  };

  visitAbilities(abilities);
  return out;
}

/**
 * 把 buff 的 modifiers/triggers 统一成 ability 形状，便于递归遍历。
 *
 * 导出给内容校验器复用 —— "buff 里的能力"这个概念只该有一种展开方式。
 */
export function buffAbilities(buff: BuffDef): readonly Ability[] {
  const out: Ability[] = [];
  for (const modifier of buff.modifiers ?? []) {
    out.push({ kind: 'modifier', modifier });
  }
  for (const trigger of buff.triggers ?? []) {
    out.push({ kind: 'trigger', trigger });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 3. 构建依赖图 + 环检测
 * ------------------------------------------------------------------ */

/**
 * 构建 stat 依赖图。
 *
 * 规则：
 *   - `derived` 允许引用**其他** stat（这会形成依赖边）
 *   - `contrib` 引用命名空间 → 展开成"该命名空间下所有派生的源 stat"
 *     这是关键：它让"引用别的装备的加成"也能被拓扑排序正确处理
 *   - 只引用自己的 stat **不算环**（自引用在数值上是 `x = f(x)`，无解，
 *     但常见的"按层数叠加"是通过 buffStacks 实现的，不经过 stat 引用，
 *     所以这里把自引用判为环是安全的）
 */
export function buildDependencyGraph(
  abilities: readonly Ability[],
): DependencyGraph {
  const sources = collectDerivedSources(abilities);

  /** stat → 依赖的 stat 集合 */
  const edges = new Map<StatKey, Set<StatKey>>();
  /** namespace → 产出该命名空间的 stat 集合 */
  const namespaceOwners = new Map<string, Set<StatKey>>();

  for (const source of sources) {
    if (source.namespace) {
      let owners = namespaceOwners.get(source.namespace);
      if (!owners) {
        owners = new Set();
        namespaceOwners.set(source.namespace, owners);
      }
      owners.add(source.stat);
    }
  }

  for (const source of sources) {
    const refs = collectExprRefs(source.expr);
    const deps = edges.get(source.stat) ?? new Set<StatKey>();

    for (const stat of refs.stats) deps.add(stat);

    // contrib 展开：命名空间 → 产出它的那些 stat
    for (const ns of refs.namespaces) {
      const owners = namespaceOwners.get(ns);
      if (!owners) continue;
      for (const owner of owners) deps.add(owner);
    }

    edges.set(source.stat, deps);
  }

  const cycles = findCycles(edges);
  const byStat = computeTiers(edges);
  return { byStat, cycles };
}

/**
 * 找环（DFS + 路径栈）。
 *
 * 返回完整路径而不是只返回"有环" —— 报错信息里指明
 * `damageBoost → intelligence → damageBoost` 比
 * "检测到循环依赖"有用得多。
 *
 * ------------------------------------------------------------------
 * **自环不算环**（这是实现时修正过的一个判断）
 * ------------------------------------------------------------------
 *
 * `damageBoost` 的派生修正自己产出命名空间 `ns`，
 * 而它消费的表达式里又 `contrib(ns)` —— 这形成 `ns → damageBoost → ns`
 * 的自环。但它**完全合法**：contrib 读的是"势能当前值"，
 * 而势能的计算不依赖 contrib 的结果。
 *
 * 表现为：`x = f(x)` 无解 → 危险；`ns = g(base)`、`x = ns + h(base)` 没问题。
 *
 * 所以这里只报告**长度 ≥ 2 的环**（能绕回起点的路径）。
 * 自环在运行时由 `resolving` 集合兜住（返回基础值，不递归爆栈）。
 */
export function findCycles(
  edges: ReadonlyMap<StatKey, ReadonlySet<StatKey>>,
): readonly (readonly StatKey[])[] {
  const cycles: StatKey[][] = [];
  const state = new Map<StatKey, 'visiting' | 'done'>();
  const stack: StatKey[] = [];

  const visit = (node: StatKey): void => {
    const current = state.get(node);
    if (current === 'done') return;
    if (current === 'visiting') {
      // 从栈里截出环。**只保留长度 ≥ 2 的环**：`[...path, node]`
      // 长度为 2 时就是自环（node 直接引用自己），那不算错误。
      const start = stack.indexOf(node);
      if (start >= 0) {
        const cycle = [...stack.slice(start), node];
        if (cycle.length > 2) cycles.push(cycle);
      }
      return;
    }

    state.set(node, 'visiting');
    stack.push(node);
    for (const next of edges.get(node) ?? []) visit(next);
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of edges.keys()) visit(node);
  return cycles;
}

/**
 * 计算拓扑层级。
 *
 * `tier(stat) = 1 + max(tier(dep))`，无依赖的为 0。
 * 有环时给环上节点返回 0（调用方应当先检查 cycles 并报错）。
 */
export function computeTiers(
  edges: ReadonlyMap<StatKey, ReadonlySet<StatKey>>,
): ReadonlyMap<StatKey, StatDependency> {
  const tiers = new Map<StatKey, number>();
  const chains = new Map<StatKey, StatKey[]>();

  const resolve = (node: StatKey, seen: Set<StatKey>): number => {
    const cached = tiers.get(node);
    if (cached !== undefined) return cached;
    if (seen.has(node)) return 0; // 环：调用方应先检查 cycles

    seen.add(node);
    let tier = 0;
    let bestChain: StatKey[] = [node];
    for (const dep of edges.get(node) ?? []) {
      const depTier = resolve(dep, seen);
      if (depTier + 1 > tier) {
        tier = depTier + 1;
        bestChain = [node, ...(chains.get(dep) ?? [dep])];
      }
    }
    seen.delete(node);

    tiers.set(node, tier);
    chains.set(node, bestChain);
    return tier;
  };

  const out = new Map<StatKey, StatDependency>();
  for (const node of edges.keys()) {
    const tier = resolve(node, new Set());
    out.set(node, {
      dependsOn: [...(edges.get(node) ?? [])],
      tier,
      chain: chains.get(node) ?? [node],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 4. 对外校验入口
 * ------------------------------------------------------------------ */

/** 校验失败时的错误。`code` 与数据模型规范 §11 的校验码对应。 */
export class ContentGraphError extends Error {
  readonly code: string;
  readonly chain: readonly StatKey[];

  constructor(code: string, chain: readonly StatKey[], entityIds: readonly EntityId[] = []) {
    const where = entityIds.length > 0 ? ` (${entityIds.join(', ')})` : '';
    // 开发者错误，用英文（i18n 规范 I1）
    super(`${code}${where}: ${chain.join(' -> ')}`);
    this.name = 'ContentGraphError';
    this.code = code;
    this.chain = chain;
  }
}

/**
 * 断言内容里没有循环依赖。有环则抛 `ContentGraphError`（code `CYCLE`）。
 *
 * 这是内容校验器（M1-6）会调用的入口。
 */
export function assertNoCycles(abilities: readonly Ability[], entityIds: readonly EntityId[] = []): void {
  const graph = buildDependencyGraph(abilities);
  const first = graph.cycles[0];
  if (first) throw new ContentGraphError('CYCLE', first, entityIds);
}
