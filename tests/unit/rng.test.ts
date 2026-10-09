import { describe, expect, it } from 'vitest';
import {
  createRng,
  nextRandom,
  randomInt,
  randomRange,
  rollChance,
  type RngState,
} from '../../src/core/rng';

/** 取 n 个随机数，方便断言序列。 */
function take(state: RngState, n: number): { state: RngState; values: number[] } {
  const values: number[] = [];
  let s = state;
  for (let i = 0; i < n; i += 1) {
    const r = nextRandom(s);
    s = r.state;
    values.push(r.value);
  }
  return { state: s, values };
}

describe('createRng', () => {
  it('把 seed 规范化成 uint32', () => {
    expect(createRng(1).seed).toBe(1);
    expect(createRng(-1).seed).toBe(4294967295);
    expect(createRng(1.7).seed).toBe(1);
    expect(createRng(2 ** 32 + 5).seed).toBe(5);
  });
});

describe('确定性（这是整个模块存在的理由）', () => {
  it('同一个 seed 产生同一条序列', () => {
    const a = take(createRng(12345), 200).values;
    const b = take(createRng(12345), 200).values;
    expect(a).toEqual(b);
  });

  it('不同 seed 产生不同序列', () => {
    const a = take(createRng(1), 50).values;
    const b = take(createRng(2), 50).values;
    expect(a).not.toEqual(b);
  });

  it('从中途状态继续与从头走到同一位置结果一致（状态可保存/恢复）', () => {
    const start = createRng(999);

    // 一次走 100 步
    const straight = take(start, 100);

    // 分两段：先 40 步，把状态存起来，再走 60 步
    const first = take(start, 40);
    const resumed = take(first.state, 60);

    expect(resumed.values).toEqual(straight.values.slice(40));
    expect(resumed.state).toEqual(straight.state);
  });

  it('nextRandom 不修改入参（纯函数）', () => {
    const s = createRng(42);
    const frozen = { ...s };
    nextRandom(s);
    expect(s).toEqual(frozen);
  });

  it('状态可 JSON 往返（满足 C5：可结构化克隆、可哈希）', () => {
    const s = take(createRng(7), 10).state;
    expect(structuredClone(s)).toEqual(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('值域', () => {
  it('值落在 [0, 1)', () => {
    const { values } = take(createRng(2026), 5000);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('分布大致均匀（10 个桶各占约 10%）', () => {
    const { values } = take(createRng(1), 100_000);
    const buckets = new Array<number>(10).fill(0);
    for (const v of values) {
      const i = Math.min(9, Math.floor(v * 10));
      buckets[i] = (buckets[i] ?? 0) + 1;
    }
    for (const count of buckets) {
      // 每个桶期望 10000，允许 ±8%
      expect(count).toBeGreaterThan(9200);
      expect(count).toBeLessThan(10800);
    }
  });
});

describe('randomRange / randomInt', () => {
  it('randomRange 落在 [min, max)', () => {
    let s = createRng(5);
    for (let i = 0; i < 1000; i += 1) {
      const r = randomRange(s, -10, 10);
      s = r.state;
      expect(r.value).toBeGreaterThanOrEqual(-10);
      expect(r.value).toBeLessThan(10);
    }
  });

  it('randomInt 落在 [0, max)', () => {
    let s = createRng(6);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) {
      const r = randomInt(s, 6);
      s = r.state;
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(6);
      seen.add(r.value);
    }
    expect(seen.size).toBe(6);
  });
});

describe('rollChance', () => {
  it('chance <= 0 必然失败，且不消耗随机数', () => {
    const s = createRng(11);
    const r = rollChance(s, 0);
    expect(r.success).toBe(false);
    expect(r.state).toBe(s); // 同一个对象引用，证明没推进
  });

  it('chance >= 1 必然成功，且不消耗随机数', () => {
    const s = createRng(11);
    const r = rollChance(s, 1);
    expect(r.success).toBe(true);
    expect(r.state).toBe(s);
  });

  it('chance = 0.5 的成功率接近 50%', () => {
    let s = createRng(20261009);
    let hits = 0;
    const n = 20_000;
    for (let i = 0; i < n; i += 1) {
      const r = rollChance(s, 0.5);
      s = r.state;
      if (r.success) hits += 1;
    }
    expect(hits / n).toBeGreaterThan(0.49);
    expect(hits / n).toBeLessThan(0.51);
  });

  it('给技能加一个 chance: 0 的判定不会扰动其他随机结果', () => {
    // 这是 rollChance 短路的实际价值：内容改动不该改变既有战斗的随机序列
    const base = createRng(31337);
    const withNoopRoll = rollChance(base, 0).state;
    expect(take(base, 5).values).toEqual(take(withNoopRoll, 5).values);
  });
});
