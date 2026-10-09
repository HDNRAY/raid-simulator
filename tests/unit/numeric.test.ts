import { describe, expect, it } from 'vitest';
import {
  EPS_LOOSE,
  EPS_STRICT,
  KahanSum,
  assertFinite,
  clamp,
  feq,
  fge,
  fgt,
  fle,
  flt,
  fsnapZero,
  kahanSum,
  kahanSumPercent,
  productOrdered,
  ratio,
  roundDamage,
  roundNonNegative,
  roundStat,
  safeDiv,
} from '../../src/core/numeric';

describe('容差比较', () => {
  it('feq 接受表示误差范围内的相等', () => {
    // 经典例子：0.1 + 0.2 !== 0.3
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(feq(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('feq 拒绝真的不相等', () => {
    expect(feq(0.1, 0.2)).toBe(false);
    expect(feq(1, 1.001)).toBe(false);
  });

  it('flt / fgt / fle / fge 在理论相同时也稳定', () => {
    const a = 0.1 + 0.2; // 0.30000000000000004
    const b = 0.3;
    // 朴素比较会给出 a > b，带容差则两者都不成立
    expect(a > b).toBe(true);
    expect(fgt(a, b)).toBe(false);
    expect(flt(a, b)).toBe(false);
    expect(fge(a, b)).toBe(true);
    expect(fle(a, b)).toBe(true);
  });

  it('flt / fgt 对明显差异正常判定', () => {
    expect(flt(1, 2)).toBe(true);
    expect(fgt(2, 1)).toBe(true);
    expect(flt(2, 1)).toBe(false);
    expect(fgt(1, 2)).toBe(false);
  });

  it('EPS_LOOSE 比 EPS_STRICT 宽松', () => {
    expect(EPS_LOOSE).toBeGreaterThan(EPS_STRICT);
    expect(feq(1, 1 + EPS_STRICT * 10, EPS_LOOSE)).toBe(true);
    expect(feq(1, 1 + EPS_STRICT * 10, EPS_STRICT)).toBe(false);
  });

  it('fsnapZero 把极小残差归零，避免 -0 污染哈希', () => {
    expect(fsnapZero(0)).toBe(0);
    expect(fsnapZero(-0)).toBe(0);
    expect(fsnapZero(1e-15)).toBe(0);
    expect(fsnapZero(1e-15 * -1)).toBe(0);
    expect(fsnapZero(0.5)).toBe(0.5);
    // 归零后不应该是 -0（Object.is(-0, 0) 为 false，会破坏哈希稳定性）
    expect(Object.is(fsnapZero(-1e-15), 0)).toBe(true);
  });
});

describe('取整', () => {
  it('roundStat 四舍五入且拒绝非有限值', () => {
    expect(roundStat(1.4)).toBe(1);
    expect(roundStat(1.5)).toBe(2);
    expect(roundStat(-1.5)).toBe(-1);
    expect(() => roundStat(Number.NaN)).toThrow(RangeError);
    expect(() => roundStat(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('roundDamage 向下取整（保守，不凭空放大伤害）', () => {
    expect(roundDamage(1.9)).toBe(1);
    expect(roundDamage(1.0)).toBe(1);
    expect(roundDamage(0.5)).toBe(0);
    // 与 roundStat 的差异正是它存在的理由
    expect(roundStat(0.5)).toBe(1);
    expect(roundDamage(0.5)).toBe(0);
  });

  it('roundNonNegative 保证非负', () => {
    expect(roundNonNegative(-5)).toBe(0);
    expect(roundNonNegative(2.6)).toBe(3);
  });
});

describe('KahanSum —— 修正聚合的核心', () => {
  it('空集合求和为 0', () => {
    const s = new KahanSum();
    expect(s.total).toBe(0);
    expect(s.count).toBe(0);
  });

  it('count 正确记录加入次数', () => {
    const s = new KahanSum();
    s.add(1);
    s.add(2);
    s.add(3);
    expect(s.count).toBe(3);
    expect(s.total).toBe(6);
  });

  it('【关键】在一大数上累加很多小数时不丢精度', () => {
    // 朴素加法会把这些小量全部吃掉，因为 1e16 + 1 === 1e16
    const values = [1e16, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const naive = values.reduce((a, b) => a + b, 0);
    const exact = 1e16 + 9;

    expect(naive).toBe(1e16); // 朴素加法：小量被完全吞掉

    const kahan = new KahanSum();
    for (const v of values) kahan.add(v);
    expect(kahan.total).toBeCloseTo(exact, -1); // Kahan 保住了大部分
    expect(kahan.total).toBeGreaterThan(naive);
  });

  it('【关键】小数累加到大量上时远优于朴素加法（Kahan 的真正价值）', () => {
    // 这正是引擎里会遇到的形态：在一大堆既有修正之上，逐条累加小修正。
    // 朴素加法会把小于 ULP 的小量直接吞掉，误差 O(N·ε) 且随 N 增长。
    const base = 1e9;
    const n = 1000;

    let naive = base;
    const kahan = new KahanSum();
    kahan.add(base);
    for (let i = 0; i < n; i += 1) {
      naive += 0.1;
      kahan.add(0.1);
    }

    const exact = base + n * 0.1; // 1e9 + 100
    const naiveError = Math.abs(naive - exact);
    const kahanError = Math.abs(kahan.total - exact);

    // Kahan 的误差应当明显小于朴素（通常是数量级差距）
    expect(kahanError).toBeLessThan(naiveError);
    expect(kahanError).toBeLessThan(1e-3);
  });

  it('【关键】同量级百分比的求和完全不受顺序影响', () => {
    // 这是引擎里真正会遇到的形态：一堆 +x% 修正相加。
    // 同量级时误差不会累积成灾难性抵消，顺序应当完全无关。
    const percents = [
      0.1, 0.05, 0.07, 0.03, 0.02, 0.11, 0.09, 0.04, 0.06, 0.08,
      0.13, 0.12, 0.15, 0.01, 0.14, 0.16, 0.17, 0.18, 0.19, 0.2,
    ];
    const forward = kahanSumPercent(percents);
    const backward = kahanSumPercent([...percents].reverse());
    expect(backward).toBe(forward);
  });

  it('kahanSum 与逐个 add 等价', () => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5];
    const s = new KahanSum();
    for (const v of values) s.add(v);
    expect(kahanSum(values)).toBe(s.total);
  });

  it('kahanSumPercent 比朴素相加更接近真值', () => {
    // 30 个 0.1 相加：真值 3，朴素得 2.9999999999999996
    const values = Array.from({ length: 30 }, () => 0.1);
    const naive = values.reduce((a, b) => a + b, 0);
    const kahan = kahanSumPercent(values);
    expect(kahan).toBeCloseTo(3, 10);
    expect(Math.abs(kahan - 3)).toBeLessThanOrEqual(Math.abs(naive - 3));
  });

  it('productOrdered 按给定顺序连乘（顺序由调用方固定以保证可复现）', () => {
    expect(productOrdered([2, 3, 4])).toBeCloseTo(24, 10);
    expect(productOrdered([1.1, 1.1])).toBeCloseTo(1.21, 10);
    expect(productOrdered([])).toBe(1);
  });
});

describe('安全除法与钳制', () => {
  it('safeDiv 不产生 Infinity / NaN', () => {
    expect(safeDiv(1, 2)).toBe(0.5);
    expect(safeDiv(1, 0)).toBe(0);
    expect(safeDiv(1, 0, -1)).toBe(-1);
    expect(safeDiv(0, 0)).toBe(0);
    expect(Number.isFinite(safeDiv(1, Number.POSITIVE_INFINITY))).toBe(true);
  });

  it('clamp 把 NaN 收成下界（NaN 会让 `hp <= 0` 判定失效，必须挡在门口）', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
  });

  it('ratio 处理除零并钳到 [0,1]', () => {
    expect(ratio(50, 100)).toBe(0.5);
    expect(ratio(150, 100)).toBe(1);
    expect(ratio(-10, 100)).toBe(0);
    expect(ratio(1, 0)).toBe(0);
    expect(ratio(1, -5)).toBe(0);
  });
});

describe('不变量断言', () => {
  it('assertFinite 放行有限值', () => {
    expect(assertFinite(1.5, 'damage')).toBe(1.5);
    expect(assertFinite(0, 'damage')).toBe(0);
  });

  it('assertFinite 对 NaN / Infinity 抛错并带上标签', () => {
    expect(() => assertFinite(Number.NaN, 'damage')).toThrow(/damage/);
    expect(() => assertFinite(Number.POSITIVE_INFINITY, 'hp')).toThrow(/hp/);
  });
});
