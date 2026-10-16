import { describe, expect, it } from 'vitest';

import { drawWhispers, whisperAt } from '../../src/core/run/whispers';

/**
 * 「恶魔低语」的**抽取**（2026-10-16）。
 *
 * 钉的是**机制**（第 1 层纯净 / 不放回 / 顺序随机 / 同种子同结果），
 * 不是某一局的答案 —— 池子会长大、条目会改，写死答案的用例会天天红。
 */

const POOL = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

describe('「恶魔低语」抽取', () => {
  it('第 1 层**纯净**（什么都不挂），第 2 层起每层一条', () => {
    const plan = drawWhispers({ pool: POOL, runSeed: 1, length: 7 });
    expect(plan).toHaveLength(7);
    expect(plan[0]).toBeUndefined();
    for (const entry of plan.slice(1)) expect(entry).toBeDefined();
  });

  it('一轮之内**不重复**（池子够大时）', () => {
    const plan = drawWhispers({ pool: POOL, runSeed: 20261016, length: 7 });
    const drawn = plan.slice(1);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('**同一个种子**逐位相同（可复现 / 可回放）', () => {
    const a = drawWhispers({ pool: POOL, runSeed: 777, length: 7 });
    const b = drawWhispers({ pool: POOL, runSeed: 777, length: 7 });
    expect(a).toEqual(b);
  });

  it('**顺序是随机的**：不同种子给出不同排列（至少不是恒等顺序）', () => {
    const orders = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        drawWhispers({ pool: POOL, runSeed: seed, length: 7 }).slice(1).join(''),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('池子**不够发满**时再洗一轮（不让某一层空着）', () => {
    const plan = drawWhispers({ pool: ['x', 'y'], runSeed: 5, length: 7 });
    expect(plan.slice(1).every((entry) => entry !== undefined)).toBe(true);
    /** 只有两个候选 ⇒ 必然出现重复，但**每层都有**。 */
    expect(new Set(plan.slice(1)).size).toBe(2);
  });

  it('`whisperAt` 与整张表一致（按层取用）', () => {
    const args = { pool: POOL, runSeed: 99, length: 7 };
    const plan = drawWhispers(args);
    for (let position = 1; position <= 7; position += 1) {
      expect(whisperAt({ ...args, position })).toEqual(plan[position - 1]);
    }
    expect(whisperAt({ ...args, position: 0 })).toBeUndefined();
    expect(whisperAt({ ...args, position: 99 })).toBeUndefined();
  });
});
