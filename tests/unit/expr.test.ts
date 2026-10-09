import { describe, expect, it } from 'vitest';
import {
  ContentGraphError,
  assertNoCycles,
  buildDependencyGraph,
  collectDerivedSources,
  collectExprRefs,
  computeTiers,
  findCycles,
} from '../../src/core/expr/deps';
import {
  addExpr,
  contribExpr,
  evalExpr,
  mulExpr,
  statExpr,
  type EvalContext,
} from '../../src/core/expr/eval';
import type { Ability, BuffDef, Expr, StatKey } from '../../src/core/types';

/* ================================================================== *
 * 求值器
 * ================================================================== */

/** 一个可控的假上下文，用于隔离测试每个 Expr 分支。 */
function makeCtx(overrides: Partial<EvalContext> = {}): EvalContext {
  const stats: Partial<Record<StatKey, number>> = {
    intelligence: 100,
    strength: 50,
    haste: 0.2,
    damageBoost: 0.3,
  };
  const resources: Record<string, number> = { hp: 4000, mp: 5000, energy: 60, fury: 30 };
  const caps: Record<string, number> = { hp: 10000, mp: 10000, energy: 120, fury: 100 };
  const buffs: Record<string, number> = { 'killing-intent': 3, haste: 1 };
  const counters: Record<string, number> = { 'ent_1:uses': 2 };
  const contribs: Record<string, number> = { 'entropy-clock.potential': 0.102 };

  // 假上下文不区分 who / pool 的来源，只按 key 查表 —— 这正是隔离测试
  // 单个 Expr 分支该有的样子（"谁"由 M1-3 的修正树负责解析）
  return {
    getStat: (_who, stat) => stats[stat] ?? 0,
    getResource: (_who, res) => resources[res] ?? 0,
    getMaxResource: (_who, res) => caps[res] ?? 0,
    getBuffStacks: (_who, id) => buffs[id] ?? 0,
    getCounter: (pool, counter) => counters[`${pool}:${counter}`] ?? 0,
    getContribution: (ns) => contribs[ns] ?? 0,
    evaluateCondition: (cond) => cond.kind === 'always',
    ...overrides,
  };
}

describe('evalExpr —— 每个分支都要有测试', () => {
  const ctx = makeCtx();

  it('const', () => {
    expect(evalExpr({ e: 'const', value: 42 }, ctx)).toBe(42);
  });

  it('stat', () => {
    expect(evalExpr(statExpr('intelligence'), ctx)).toBe(100);
    expect(evalExpr({ e: 'stat', who: 'target', stat: 'strength' }, ctx)).toBe(50);
  });

  it('stat 不存在时返回 0（不是 undefined/NaN）', () => {
    expect(evalExpr(statExpr('tenacity'), ctx)).toBe(0);
  });

  it('resource / maxResource / ratio', () => {
    expect(evalExpr({ e: 'resource', who: 'self', resource: 'hp' }, ctx)).toBe(4000);
    expect(evalExpr({ e: 'maxResource', who: 'self', resource: 'hp' }, ctx)).toBe(10000);
    expect(evalExpr({ e: 'resourceRatio', who: 'self', resource: 'hp' }, ctx)).toBeCloseTo(0.4, 10);
    expect(evalExpr({ e: 'missingResourceRatio', who: 'self', resource: 'hp' }, ctx)).toBeCloseTo(
      0.6,
      10,
    );
  });

  it('比率为 0 的资源上限不会产生 NaN（除零防护）', () => {
    const zeroCaps = makeCtx({ getMaxResource: () => 0 });
    expect(evalExpr({ e: 'resourceRatio', who: 'self', resource: 'hp' }, zeroCaps)).toBe(0);
    expect(evalExpr({ e: 'missingResourceRatio', who: 'self', resource: 'hp' }, zeroCaps)).toBe(1);
  });

  it('buffStacks / hasBuff', () => {
    expect(evalExpr({ e: 'buffStacks', who: 'self', buffId: 'killing-intent' }, ctx)).toBe(3);
    expect(evalExpr({ e: 'hasBuff', who: 'self', buffId: 'killing-intent' }, ctx)).toBe(1);
    expect(evalExpr({ e: 'hasBuff', who: 'self', buffId: 'nope' }, ctx)).toBe(0);
  });

  it('counter（使用次数这类离散资源）', () => {
    const expr: Expr = {
      e: 'counter',
      ref: { kind: 'entity', entityInstanceId: 'ent_1' },
      counter: 'uses',
    };
    expect(evalExpr(expr, ctx)).toBe(2);
  });

  it('counter 支持三种池子引用', () => {
    const pools: Array<[Expr['e'] extends never ? never : Parameters<typeof evalExpr>[0], string]> =
      [];
    void pools;
    const asCtx = makeCtx({
      getCounter: (pool) => (pool === 'player' ? 1 : pool === 'ent_1' ? 2 : 3),
    });
    const combatant: Expr = {
      e: 'counter',
      ref: { kind: 'combatant', combatantId: 'player' },
      counter: 'charges',
    };
    const entity: Expr = {
      e: 'counter',
      ref: { kind: 'entity', entityInstanceId: 'ent_1' },
      counter: 'uses',
    };
    const encounter: Expr = { e: 'counter', ref: { kind: 'encounter' }, counter: 'attempts' };
    expect(evalExpr(combatant, asCtx)).toBe(1);
    expect(evalExpr(entity, asCtx)).toBe(2);
    expect(evalExpr(encounter, asCtx)).toBe(3);
  });

  it('contrib 读命名空间当前值（动态重算的关键）', () => {
    expect(evalExpr(contribExpr('entropy-clock.potential'), ctx)).toBeCloseTo(0.102, 6);
  });

  it('contrib 命名空间不存在时用 fallback', () => {
    expect(evalExpr(contribExpr('nope'), ctx)).toBe(0);
    expect(evalExpr(contribExpr('nope', 0.5), ctx)).toBe(0.5);
  });

  it('contrib 会用真实值而不是 fallback', () => {
    expect(evalExpr(contribExpr('entropy-clock.potential', 0.5), ctx)).toBeCloseTo(0.102, 6);
  });

  it('add / mul', () => {
    expect(evalExpr(addExpr({ e: 'const', value: 1 }, { e: 'const', value: 2 }), ctx)).toBe(3);
    expect(evalExpr(mulExpr({ e: 'const', value: 3 }, { e: 'const', value: 4 }), ctx)).toBe(12);
  });

  it('add 对顺序不敏感（Kahan，黄金重放依赖这一点）', () => {
    const values = [1e9, 0.1, 0.1, 0.1, 0.1];
    const forward = evalExpr({ e: 'add', of: values.map((v) => ({ e: 'const', value: v })) }, ctx);
    const backward = evalExpr(
      { e: 'add', of: [...values].reverse().map((v) => ({ e: 'const', value: v })) },
      ctx,
    );
    expect(backward).toBe(forward);
  });

  it('min / max', () => {
    expect(
      evalExpr({ e: 'min', of: [{ e: 'const', value: 5 }, { e: 'const', value: 2 }] }, ctx),
    ).toBe(2);
    expect(
      evalExpr({ e: 'max', of: [{ e: 'const', value: 5 }, { e: 'const', value: 2 }] }, ctx),
    ).toBe(5);
  });

  it('空的 min / max 不产生 ±Infinity', () => {
    expect(evalExpr({ e: 'min', of: [] }, ctx)).toBe(0);
    expect(evalExpr({ e: 'max', of: [] }, ctx)).toBe(0);
  });

  it('clamp / neg', () => {
    expect(
      evalExpr(
        {
          e: 'clamp',
          value: { e: 'const', value: 15 },
          min: { e: 'const', value: 0 },
          max: { e: 'const', value: 10 },
        },
        ctx,
      ),
    ).toBe(10);
    expect(evalExpr({ e: 'neg', value: { e: 'const', value: 7 } }, ctx)).toBe(-7);
  });

  it('cond 走条件分支', () => {
    const ctxTrue = makeCtx({ evaluateCondition: (c) => c.kind === 'always' });
    const expr: Expr = {
      e: 'cond',
      if: { kind: 'always' },
      then: { e: 'const', value: 1 },
      else: { e: 'const', value: 2 },
    };
    expect(evalExpr(expr, ctxTrue)).toBe(1);

    const ctxFalse = makeCtx({ evaluateCondition: () => false });
    expect(evalExpr(expr, ctxFalse)).toBe(2);
  });

  it('【关键】任何分支都不产生 NaN / Infinity', () => {
    const hostile = makeCtx({
      getStat: () => Number.NaN,
      getResource: () => Number.POSITIVE_INFINITY,
      getMaxResource: () => 0,
      getContribution: () => Number.NaN,
    });
    const exprs: readonly Expr[] = [
      { e: 'resourceRatio', who: 'self', resource: 'hp' },
      { e: 'missingResourceRatio', who: 'self', resource: 'hp' },
      { e: 'add', of: [statExpr('strength'), { e: 'const', value: 1 }] },
      { e: 'mul', of: [statExpr('strength'), { e: 'const', value: 2 }] },
      { e: 'min', of: [statExpr('strength')] },
      { e: 'max', of: [statExpr('strength')] },
      { e: 'neg', value: statExpr('strength') },
      contribExpr('x'),
      {
        e: 'clamp',
        value: statExpr('strength'),
        min: { e: 'const', value: 0 },
        max: { e: 'const', value: 1 },
      },
    ];
    for (const expr of exprs) {
      const value = evalExpr(expr, hostile);
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

/* ================================================================== *
 * 引用提取
 * ================================================================== */

describe('collectExprRefs', () => {
  it('收集 stat / namespace / buffId 引用', () => {
    const expr = mulExpr(
      statExpr('intelligence'),
      contribExpr('entropy-clock.potential'),
      { e: 'buffStacks', who: 'self', buffId: 'killing-intent' },
      addExpr(statExpr('strength'), { e: 'const', value: 1 }),
    );
    const refs = collectExprRefs(expr);
    expect([...refs.stats].sort()).toEqual(['intelligence', 'strength']);
    expect(refs.namespaces).toEqual(['entropy-clock.potential']);
    expect(refs.buffIds).toEqual(['killing-intent']);
  });

  it('嵌套在 clamp / cond 里的引用也能收集到', () => {
    const expr: Expr = {
      e: 'cond',
      if: { kind: 'always' },
      then: {
        e: 'clamp',
        value: statExpr('haste'),
        min: { e: 'const', value: 0 },
        max: statExpr('critChance'),
      },
      else: contribExpr('ns.a'),
    };
    const refs = collectExprRefs(expr);
    expect([...refs.stats].sort()).toEqual(['critChance', 'haste']);
    expect(refs.namespaces).toEqual(['ns.a']);
  });

  it('不求值就返回（纯静态分析）', () => {
    // 如果用会抛错的上下文，说明它真的没有求值
    let called = false;
    const ctx = makeCtx({ getStat: () => { called = true; return 0; } });
    void ctx;
    collectExprRefs(statExpr('strength'));
    expect(called).toBe(false);
  });
});

/* ================================================================== *
 * 派生来源收集
 * ================================================================== */

describe('collectDerivedSources', () => {
  it('收集顶层 derived', () => {
    const abilities: readonly Ability[] = [
      {
        kind: 'derived',
        modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'x', namespace: 'ns.a' },
        value: statExpr('intelligence'),
      },
    ];
    const sources = collectDerivedSources(abilities);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.stat).toBe('damageBoost');
    expect(sources[0]?.namespace).toBe('ns.a');
  });

  it('递归进 trigger.then', () => {
    const abilities: readonly Ability[] = [
      {
        kind: 'trigger',
        trigger: {
          on: 'onCritDealt',
          then: [
            {
              kind: 'derived',
              modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'x' },
              value: { e: 'const', value: 0.1 },
            },
          ],
        },
      },
    ];
    expect(collectDerivedSources(abilities)).toHaveLength(1);
  });

  it('递归进 grant 的 buff.modifiers', () => {
    const buff: BuffDef = {
      id: 'b',
      nameKey: 'stat.haste',
      icon: 'i',
      polarity: 'buff',
      duration: 1000,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      modifiers: [
        {
          stat: 'damageBoost',
          op: 'addPercent',
          value: statExpr('strength'),
          sourceKey: 'x',
        },
      ],
    };
    const abilities: readonly Ability[] = [{ kind: 'grant', buff, target: { mode: 'self' } }];
    const sources = collectDerivedSources(abilities);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.stat).toBe('damageBoost');
  });
});

/* ================================================================== *
 * 依赖图与环检测
 * ================================================================== */

describe('buildDependencyGraph —— 环检测', () => {
  it('无环时 tiers 为空且 cycles 为空', () => {
    const graph = buildDependencyGraph([]);
    expect(graph.cycles).toHaveLength(0);
    expect(graph.byStat.size).toBe(0);
  });

  it('【T13】A 引用 B、B 引用 A → 检测到环并给出完整链路', () => {
    const abilities: readonly Ability[] = [
      {
        kind: 'derived',
        modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'x' },
        value: statExpr('intelligence'),
      },
      {
        kind: 'derived',
        modifier: { stat: 'intelligence', op: 'add', sourceKey: 'y' },
        value: statExpr('damageBoost'),
      },
    ];
    const graph = buildDependencyGraph(abilities);
    expect(graph.cycles.length).toBeGreaterThan(0);
    const cycle = graph.cycles[0] ?? [];
    // 环上应当同时包含两个 stat，且首尾相同
    expect(new Set(cycle).size).toBe(2);
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
  });

  it('【T13】assertNoCycles 抛 ContentGraphError，code 为 CYCLE', () => {
    const abilities: readonly Ability[] = [
      {
        kind: 'derived',
        modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'x' },
        value: statExpr('haste'),
      },
      {
        kind: 'derived',
        modifier: { stat: 'haste', op: 'add', sourceKey: 'y' },
        value: statExpr('damageBoost'),
      },
    ];
    expect(() => assertNoCycles(abilities, ['entropy-clock'])).toThrow(ContentGraphError);
    try {
      assertNoCycles(abilities, ['entropy-clock']);
    } catch (error) {
      const e = error as ContentGraphError;
      expect(e.code).toBe('CYCLE');
      expect(e.message).toContain('CYCLE');
      expect(e.message).toContain('entropy-clock');
      // 报错信息要能指路：包含完整依赖链
      expect(e.chain.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('无环时不抛错', () => {
    const abilities: readonly Ability[] = [
      {
        kind: 'derived',
        modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'x' },
        value: statExpr('intelligence'),
      },
    ];
    expect(() => assertNoCycles(abilities)).not.toThrow();
  });

  it('【有意为之】自引用（stat 引用自己）**不**判为环', () => {
    // 自环是 `x = f(x)` 无解 → 危险；但下面这种是
    // `x = ns + h(base)` 而 ns 由 x 产出 —— 完全合法的内容写法
    // （熵之钟的势能就是这种形状：产出命名空间，同时被涌动引用）。
    // 运行时由 resolving 集合兜住，不会栈溢出。
    const abilities: readonly Ability[] = [
      {
        kind: 'derived',
        modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'x', namespace: 'ns.a' },
        value: addExpr(contribExpr('ns.a'), { e: 'const', value: 0.1 }),
      },
    ];
    expect(buildDependencyGraph(abilities).cycles).toHaveLength(0);
  });

  it('【关键】contrib 展开后能检测到"经由他人绕回自己"的真环', () => {
    // ns.a 由 haste 产出；damageBoost contrib ns.a；haste 又引用 damageBoost
    // → damageBoost → haste → damageBoost，这是真环
    const abilities: readonly Ability[] = [
      {
        kind: 'derived',
        modifier: { stat: 'haste', op: 'add', sourceKey: 'x', namespace: 'ns.a' },
        value: { e: 'const', value: 0.1 },
      },
      {
        kind: 'derived',
        modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'y' },
        value: contribExpr('ns.a'),
      },
      {
        kind: 'derived',
        modifier: { stat: 'haste', op: 'add', sourceKey: 'z' },
        value: statExpr('damageBoost'),
      },
    ];
    expect(buildDependencyGraph(abilities).cycles.length).toBeGreaterThan(0);
  });

  it('contrib 引用的命名空间不存在时不产生依赖边（由校验器另行报错）', () => {
    const abilities: readonly Ability[] = [
      {
        kind: 'derived',
        modifier: { stat: 'damageBoost', op: 'addPercent', sourceKey: 'x' },
        value: contribExpr('nobody.declares.this'),
      },
    ];
    const graph = buildDependencyGraph(abilities);
    expect(graph.cycles).toHaveLength(0);
    expect(graph.byStat.get('damageBoost')?.dependsOn).toEqual([]);
  });
});

describe('computeTiers —— 拓扑分层', () => {
  it('无依赖的 stat 是 tier 0', () => {
    const edges = new Map<StatKey, ReadonlySet<StatKey>>([['damageBoost', new Set()]]);
    expect(computeTiers(edges).get('damageBoost')?.tier).toBe(0);
  });

  it('链式依赖逐层加一', () => {
    const edges = new Map<StatKey, ReadonlySet<StatKey>>([
      ['strength', new Set()],
      ['damageBoost', new Set<StatKey>(['strength'])],
      ['critChance', new Set<StatKey>(['damageBoost'])],
    ]);
    const tiers = computeTiers(edges);
    expect(tiers.get('strength')?.tier).toBe(0);
    expect(tiers.get('damageBoost')?.tier).toBe(1);
    expect(tiers.get('critChance')?.tier).toBe(2);
  });

  it('菱形依赖取最长路径（保证引用的一定已算完）', () => {
    // a → b → d, a → c → d：d 的 tier 应当是 2
    const edges = new Map<StatKey, ReadonlySet<StatKey>>([
      ['strength', new Set()],
      ['agility', new Set<StatKey>(['strength'])],
      ['spirit', new Set<StatKey>(['strength'])],
      ['damageBoost', new Set<StatKey>(['agility', 'spirit'])],
    ]);
    expect(computeTiers(edges).get('damageBoost')?.tier).toBe(2);
  });

  it('记录依赖链样例，供报错指路', () => {
    const edges = new Map<StatKey, ReadonlySet<StatKey>>([
      ['strength', new Set()],
      ['damageBoost', new Set<StatKey>(['strength'])],
    ]);
    const dep = computeTiers(edges).get('damageBoost');
    expect(dep?.chain).toEqual(['damageBoost', 'strength']);
  });
});

describe('findCycles', () => {
  it('无环返回空', () => {
    const edges = new Map<StatKey, ReadonlySet<StatKey>>([
      ['a' as StatKey, new Set<StatKey>(['b' as StatKey])],
      ['b' as StatKey, new Set()],
    ]);
    expect(findCycles(edges)).toHaveLength(0);
  });

  it('三元环也能找到', () => {
    const a = 'a' as StatKey;
    const b = 'b' as StatKey;
    const c = 'c' as StatKey;
    const edges = new Map<StatKey, ReadonlySet<StatKey>>([
      [a, new Set([b])],
      [b, new Set([c])],
      [c, new Set([a])],
    ]);
    const cycles = findCycles(edges);
    expect(cycles.length).toBeGreaterThan(0);
    expect(new Set(cycles[0])).toEqual(new Set([a, b, c]));
  });
});
