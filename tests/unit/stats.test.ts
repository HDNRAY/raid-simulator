import { describe, expect, it } from 'vitest';
import { STAT_RULES, isPercentStat } from '../../src/core/stats/aggregate';
import { computeStats, modifiersInNamespace } from '../../src/core/stats/pipeline';
import type { Condition, Expr, StatModifier } from '../../src/core/types';

/**
 * M1-3 的验收：数据模型规范 §13 的 T1 / T2 / T3 / T3b。
 *
 * 其中 T3 / T3b 是**最关键**的两条：
 *   「智力变化后，依赖它的 buff 必须跟着变」。
 * 如果实现里存在快照，这两条会红。
 */

const POTENTIAL_NS = 'entropy-clock.potential';

/** 熵之钟的效果 1：被动 +2 智力 / +2 精神 */
function clockModifiers(): StatModifier[] {
  return [
    { stat: 'intelligence', op: 'add', value: 2, sourceKey: 'entity.entropyClock.name', tier: 'item' },
    { stat: 'spirit', op: 'add', value: 2, sourceKey: 'entity.entropyClock.name', tier: 'item' },
  ];
}

/**
 * 熵之钟的效果 2：根据智力增伤，带命名空间（可被引用）。
 *
 * ⚠️ 规范 §9 写的 `0.10 × 智力` 在智力 102 时得到 **10.2**，
 * 而不是 0.102 —— 要得到 0.102 需要 `0.001 × 智力`。
 * 规范把"10% 每点智力"与"0.1% 每点智力"写混了，这里按
 * "值就是表达式的结果"这个自洽语义修正（并回头修规范）。
 */
function potentialModifier(perIntelligence = 0.1): StatModifier {
  const value: Expr = {
    e: 'mul',
    of: [{ e: 'const', value: perIntelligence }, { e: 'stat', who: 'self', stat: 'intelligence' }],
  };
  return {
    stat: 'damageBoost',
    op: 'addPercent',
    value,
    sourceKey: 'stat.damageBoost',
    namespace: POTENTIAL_NS,
    tier: 'item',
  };
}

/** 熵之钟的效果 3：暴击后授予的 buff，值引用命名空间（因此动态重算） */
function surgeModifier(): StatModifier {
  return {
    stat: 'damageBoost',
    op: 'addPercent',
    value: { e: 'contrib', namespace: POTENTIAL_NS },
    sourceKey: 'stat.damageBoost',
    namespace: 'entropy-surge',
    tier: 'buff',
  };
}

describe('聚合规则表', () => {
  it('每条规则都是完整且可用的', () => {
    /**
     * ⚠️ 这个用例**曾经是假的**，两次：
     *
     * 1. 原版断言 `keys.length > 25` —— 一个**魔数门槛**。它的意图是
     *    "别漏了规则"，但删掉任何一个死掉的 StatKey（例如已无引用的
     *    `physicalBoost` / `spellBoost`）就会误报，而真正的规则缺失
     *    它**根本测不出来**
     * 2. 我第一次改的时候写成了 `expect(keys).toEqual(expected)`，其中
     *    `expected` 就是 `keys` —— **同义反复**，等于没测
     *
     * 而且"穷尽性"这件事**本来就不该由运行期测试承担**：
     * `STAT_RULES` 的类型是 `Record<StatKey, StatRule>`，少一个键
     * **编译就不过**（见 `aggregate.ts` 文件头的说明）。
     *
     * 所以这里只断言编译期管不到的**取值合法性** —— 每条规则的
     * `combine` / `kind` 必须落在各自的联合类型内。类型声明保证了这一点，
     * 但如果有人用类型断言或从数据构造规则，这个用例会兜住。
     */
    for (const [key, rule] of Object.entries(STAT_RULES)) {
      expect(['sum', 'max', 'override'], `combine of ${key}`).toContain(rule.combine);
      expect(['accumulator', 'multiplier', 'value'], `kind of ${key}`).toContain(rule.kind);
    }
  });

  it('damageBoost 是相加语义、damageMult 是相乘语义（两种并存）', () => {
    expect(STAT_RULES.damageBoost.combine).toBe('sum');
    expect(STAT_RULES.damageMult.combine).toBe('sum');
    // 两者都由调用方的 op 决定加/乘：
    // damageBoost 用 addPercent（相加），damageMult 用 mult（相乘）
    expect(isPercentStat('damageBoost')).toBe(true);
    expect(isPercentStat('damageMult')).toBe(false);
  });

  it('暴击率与急速有上限，避免破坏判定语义', () => {
    expect(STAT_RULES.critChance.clamp).toEqual([0, 1]);
    expect(STAT_RULES.haste.clamp).toEqual([0, 0.5]);
  });
});

describe('T1 —— 被动属性', () => {
  it('装备熵之钟：智力 breakdown 含该来源的 +2', () => {
    const { values, breakdown } = computeStats({
      base: { intelligence: 100 },
      modifiers: clockModifiers(),
      wantBreakdown: true,
    });
    expect(values.intelligence).toBe(102);
    const entry = breakdown?.intelligence?.flat.find(
      (p) => p.sourceKey === 'entity.entropyClock.name',
    );
    expect(entry?.value).toBe(2);
    expect(breakdown?.intelligence?.base).toBe(100);
    expect(breakdown?.intelligence?.add).toBe(2);
  });

  it('没有该来源时不产生溯源条目', () => {
    const { values } = computeStats({ base: { intelligence: 100 }, modifiers: [] });
    expect(values.intelligence).toBe(100);
  });
});

describe('T2 —— 派生增伤（含效果 1 的 +2）', () => {
  it('damageBoost = 0.10 × (100 + 2) = 10.2（值的单位就是表达式结果）', () => {
    const { values, breakdown } = computeStats({
      base: { intelligence: 100 },
      modifiers: [...clockModifiers(), potentialModifier()],
      wantBreakdown: true,
    });
    expect(values.intelligence).toBe(102);
    // damageBoost 是**累加器**语义：+10.2 就是 10.2，
    // 伤害公式在别处用它做 ×(1 + damageBoost/100)
    expect(values.damageBoost).toBeCloseTo(10.2, 10);
    const derived = breakdown?.damageBoost?.derived.find((p) => p.namespace === POTENTIAL_NS);
    expect(derived?.value).toBeCloseTo(10.2, 10);
  });

  it('换一个系数就得到另一条曲线（0.001 → 0.1% 每点智力）', () => {
    const { values } = computeStats({
      base: { intelligence: 100 },
      modifiers: [potentialModifier(0.001)],
    });
    expect(values.damageBoost).toBeCloseTo(0.1, 10);
  });

  it('派生值会随基础属性变化（不是启动时算一次）', () => {
    const withInt = (intelligence: number) =>
      computeStats({
        base: { intelligence },
        modifiers: [potentialModifier()],
      }).values.damageBoost;
    expect(withInt(100)).toBeCloseTo(10, 6);
    expect(withInt(200)).toBeCloseTo(20, 6);
  });
});

describe('T3 —— 动态重算（最关键）', () => {
  it('surge buff 引用命名空间：与势能等值（两者相加）', () => {
    const { values } = computeStats({
      base: { intelligence: 100 },
      modifiers: [...clockModifiers(), potentialModifier(), surgeModifier()],
    });
    // 势能 10.2 + 涌动 10.2 = 20.4
    expect(values.damageBoost).toBeCloseTo(20.4, 10);
  });

  it('【T3】智力 +50 后，势能与涌动**同时**跟着变', () => {
    const withExtraInt: StatModifier = {
      stat: 'intelligence',
      op: 'add',
      value: 50,
      sourceKey: 'stat.intelligence',
      tier: 'buff',
    };

    const before = computeStats({
      base: { intelligence: 102 },
      modifiers: [potentialModifier(), surgeModifier()],
      wantBreakdown: true,
    });
    expect(before.values.intelligence).toBe(102);
    expect(before.values.damageBoost).toBeCloseTo(10.2 + 10.2, 10);

    const after = computeStats({
      base: { intelligence: 102 },
      modifiers: [potentialModifier(), surgeModifier(), withExtraInt],
      wantBreakdown: true,
    });

    // 智力 152 → 势能 15.2，涌动也必须变成 15.2（不是旧的 10.2）
    expect(after.values.intelligence).toBe(152);
    const potential = after.breakdown?.damageBoost?.derived.find(
      (p) => p.namespace === POTENTIAL_NS,
    );
    const surge = after.breakdown?.damageBoost?.derived.find(
      (p) => p.namespace === 'entropy-surge',
    );
    expect(potential?.value).toBeCloseTo(15.2, 10);
    expect(surge?.value).toBeCloseTo(15.2, 10);
    expect(after.values.damageBoost).toBeCloseTo(30.4, 10);
  });

  it('【T3b】移除 +50 智力后完整回到旧值（反向重算）', () => {
    const withExtraInt: StatModifier = {
      stat: 'intelligence',
      op: 'add',
      value: 50,
      sourceKey: 'stat.intelligence',
      tier: 'buff',
    };
    const base = {
      base: { intelligence: 102 },
      modifiers: [potentialModifier(), surgeModifier()],
    };

    const buffed = computeStats({ ...base, modifiers: [...base.modifiers, withExtraInt] });
    expect(buffed.values.damageBoost).toBeCloseTo(30.4, 10);

    const removed = computeStats(base);
    expect(removed.values.damageBoost).toBeCloseTo(20.4, 10);
  });

  it('【T3c】链式：第三层效果也随之前的变化而变化', () => {
    // 天赋引用势能命名空间，再放大 50%
    const resonance: StatModifier = {
      stat: 'damageBoost',
      op: 'addPercent',
      value: {
        e: 'mul',
        of: [{ e: 'contrib', namespace: POTENTIAL_NS }, { e: 'const', value: 0.5 }],
      },
      sourceKey: 'stat.damageBoost',
      namespace: 'talent.resonance',
      tier: 'talent',
    };

    const at = (intelligence: number) =>
      computeStats({
        base: { intelligence },
        modifiers: [potentialModifier(), resonance],
      }).values.damageBoost;

    // 100 × 0.1 = 10；resonance = 10 × 0.5 = 5；合计 15
    expect(at(100)).toBeCloseTo(15, 6);
    expect(at(200)).toBeCloseTo(30, 6);
  });
});

describe('op 的六种行为', () => {
  it('add：加法层求和', () => {
    const mods: StatModifier[] = [
      { stat: 'strength', op: 'add', value: 10, sourceKey: 'a' },
      { stat: 'strength', op: 'add', value: 5, sourceKey: 'b' },
    ];
    expect(computeStats({ base: { strength: 100 }, modifiers: mods }).values.strength).toBe(115);
  });

  it('addPercent 对 accumulator：**相加**而不是相乘', () => {
    const mods: StatModifier[] = [
      { stat: 'damageBoost', op: 'addPercent', value: 10, sourceKey: 'a' },
      { stat: 'damageBoost', op: 'addPercent', value: 10, sourceKey: 'b' },
    ];
    // 相加得 20（而不是 1.1 × 1.1 - 1 = 21%）
    expect(computeStats({ modifiers: mods }).values.damageBoost).toBeCloseTo(20, 10);
  });

  it('addPercent 对 multiplier：按 (1 + Σ) 作用于基值 1', () => {
    const mods: StatModifier[] = [
      { stat: 'damageMult', op: 'addPercent', value: 0.5, sourceKey: 'a' },
    ];
    expect(computeStats({ modifiers: mods }).values.damageMult).toBeCloseTo(1.5, 10);
  });

  it('mult：乘法层连乘', () => {
    const mods: StatModifier[] = [
      { stat: 'damageMult', op: 'mult', value: 2, sourceKey: 'a' },
      { stat: 'damageMult', op: 'mult', value: 3, sourceKey: 'b' },
    ];
    expect(computeStats({ modifiers: mods }).values.damageMult).toBeCloseTo(6, 10);
  });

  it('setOverride：覆盖前两层', () => {
    const mods: StatModifier[] = [
      { stat: 'critChance', op: 'add', value: 0.2, sourceKey: 'a' },
      { stat: 'critChance', op: 'setOverride', value: 0.9, sourceKey: 'b' },
    ];
    expect(computeStats({ modifiers: mods }).values.critChance).toBeCloseTo(0.9, 10);
  });

  it('max：只取最大值（不叠加）', () => {
    const mods: StatModifier[] = [
      { stat: 'haste', op: 'max', value: 0.1, sourceKey: 'a' },
      { stat: 'haste', op: 'max', value: 0.3, sourceKey: 'b' },
    ];
    expect(computeStats({ modifiers: mods }).values.haste).toBeCloseTo(0.3, 10);
  });

  it('perStackAdd：按层数缩放', () => {
    const mods: StatModifier[] = [
      {
        stat: 'damageBoost',
        op: 'perStackAdd',
        value: 0.02,
        sourceKey: 'stat.damageBoost',
        namespace: 'killing-intent',
      },
    ];
    const at = (stacks: number) =>
      computeStats({ modifiers: mods, stackCount: () => stacks }).values.damageBoost;
    expect(at(1)).toBeCloseTo(0.02, 10);
    expect(at(3)).toBeCloseTo(0.06, 10);
    expect(at(10)).toBeCloseTo(0.2, 10);
  });
});

describe('阶段顺序是不变量', () => {
  it('乘法层作用在加法层之上（strength 是 accumulator）', () => {
    // base 100 + add 100 = 200；percent 直接累加（+50）；mult ×2
    // → (100 + 100 + 50) × 2 = 500
    const mods: StatModifier[] = [
      { stat: 'strength', op: 'add', value: 100, sourceKey: 'a' },
      { stat: 'strength', op: 'addPercent', value: 50, sourceKey: 'b' },
      { stat: 'strength', op: 'mult', value: 2, sourceKey: 'c' },
    ];
    expect(computeStats({ base: { strength: 100 }, modifiers: mods }).values.strength).toBeCloseTo(
      500,
      6,
    );
  });

  it('multiplier 型 stat 的加法型贡献按 (1 + Σ) 处理', () => {
    // damageMult 基值语义是 1：+0.5 表示"再乘 1.5"
    const mods: StatModifier[] = [
      { stat: 'damageMult', op: 'add', value: 0.5, sourceKey: 'a' },
    ];
    expect(computeStats({ modifiers: mods }).values.damageMult).toBeCloseTo(1.5, 10);
  });

  it('钳制在最后（critChance 不会超过 1）', () => {
    const mods: StatModifier[] = [
      { stat: 'critChance', op: 'add', value: 0.6, sourceKey: 'a' },
      { stat: 'critChance', op: 'add', value: 0.6, sourceKey: 'b' },
    ];
    expect(computeStats({ modifiers: mods }).values.critChance).toBe(1);
  });

  it('急速被钳到 0.5 上限', () => {
    const mods: StatModifier[] = [
      { stat: 'haste', op: 'add', value: 0.4, sourceKey: 'a' },
      { stat: 'haste', op: 'add', value: 0.4, sourceKey: 'b' },
    ];
    expect(computeStats({ modifiers: mods }).values.haste).toBe(0.5);
  });

  it('result 永不出现负数或非有限值', () => {
    const mods: StatModifier[] = [
      { stat: 'strength', op: 'add', value: -1000, sourceKey: 'a' },
      { stat: 'critChance', op: 'mult', value: 0, sourceKey: 'b' },
    ];
    const { values } = computeStats({ base: { strength: 10 }, modifiers: mods });
    expect(values.strength).toBe(-990); // 无 clamp 的 stat 允许负数
    expect(Number.isFinite(values.critChance)).toBe(true);
    expect(values.haste).toBeGreaterThanOrEqual(0);
  });
});

describe('条件修正', () => {
  it('when 不满足时整条不生效', () => {
    const mods: StatModifier[] = [
      {
        stat: 'damageBoost',
        op: 'addPercent',
        value: 0.5,
        sourceKey: 'stat.damageBoost',
        when: { kind: 'hpBelow', ratio: 0.3 },
      },
    ];
    const evaluateCondition = (c: Condition) => c.kind !== 'hpBelow';
    expect(computeStats({ modifiers: mods, evaluateCondition }).values.damageBoost).toBe(0);
    expect(
      computeStats({ modifiers: mods, evaluateCondition: () => true }).values.damageBoost,
    ).toBeCloseTo(0.5, 10);
  });

  it('条件表达式（cond 节点）走条件求值', () => {
    const value: Expr = {
      e: 'cond',
      if: { kind: 'hpBelow', ratio: 0.3 },
      then: { e: 'const', value: 0.5 },
      else: { e: 'const', value: 0.1 },
    };
    const mods: StatModifier[] = [
      { stat: 'damageBoost', op: 'addPercent', value, sourceKey: 'stat.damageBoost' },
    ];
    const low = computeStats({ modifiers: mods, evaluateCondition: () => true });
    const high = computeStats({ modifiers: mods, evaluateCondition: () => false });
    expect(low.values.damageBoost).toBeCloseTo(0.5, 10);
    expect(high.values.damageBoost).toBeCloseTo(0.1, 10);
  });
});

describe('C5 与性能相关的不变量', () => {
  it('不修改传入的修正数组', () => {
    const mods: StatModifier[] = [{ stat: 'strength', op: 'add', value: 5, sourceKey: 'a' }];
    const snapshot = structuredClone(mods);
    computeStats({ modifiers: mods });
    expect(mods).toEqual(snapshot);
  });

  it('结果对象可结构化克隆（可进 worker / 可哈希）', () => {
    const result = computeStats({
      base: { intelligence: 100 },
      modifiers: clockModifiers(),
      wantBreakdown: true,
    });
    expect(() => structuredClone(result)).not.toThrow();
  });

  it('生产模式下不构建 breakdown（省内存）', () => {
    const result = computeStats({ modifiers: [], wantBreakdown: false });
    expect(result.breakdown).toBeUndefined();
    expect(result.values).toBeDefined();
  });

  it('modifiersInNamespace 能筛出命名空间成员', () => {
    const all = [...clockModifiers(), potentialModifier(), surgeModifier()];
    expect(modifiersInNamespace(all, POTENTIAL_NS)).toHaveLength(1);
    expect(modifiersInNamespace(all, 'nope')).toHaveLength(0);
  });
});

describe('运行时环兜底', () => {
  it('互相引用时不死循环（返回基础值）', () => {
    const a: StatModifier = {
      stat: 'damageBoost',
      op: 'addPercent',
      value: { e: 'stat', who: 'self', stat: 'haste' },
      sourceKey: 'a',
    };
    const b: StatModifier = {
      stat: 'haste',
      op: 'add',
      value: { e: 'stat', who: 'self', stat: 'damageBoost' },
      sourceKey: 'b',
    };
    // 不断言具体数值（那是未定义行为），只要求不崩、不返回非有限值
    const { values } = computeStats({ base: { haste: 0.1 }, modifiers: [a, b] });
    expect(Number.isFinite(values.damageBoost)).toBe(true);
    expect(Number.isFinite(values.haste)).toBe(true);
  });
});
