import { describe, expect, it } from 'vitest';

import { battleSeed, shuffle } from '../../../src/core/run/shuffle';

/**
 * 种子化洗牌的单测。
 *
 * 本文件覆盖 P0 验收里的**第一条**（"同一 `runSeed` → 同一顺序"）
 * 与用户点名的**两条反向验证**：
 *   - 同一个 `runSeed` 跑两次 → **完全相同**的顺序数组（`toEqual`）
 *   - **不同种子会不同**（否则"永远返回固定顺序"的实现也能过第一条）
 *
 * ⚠️ 用**真的 Boss 名单**（`data/roster.ts` 的 7 个 id）而不是
 * `['a','b','c']`：洗牌要证明的性质之一是"7 个 Boss 的一个排列"，
 * 而用字母表会让"排列里有重复 / 丢了一个"这类 bug 看起来更像巧合。
 * 刻意**不 import** `roster.ts`：那会把 `core/run` 的测试拖进 `data/`
 * 这一层，而这里要证明的只是洗牌本身（名单是内容，P0 不碰）。
 */
const BOSSES: readonly string[] = [
  'meiichiro',
  'lust',
  'envy',
  'gluttony',
  'wrath',
  'sloth',
  'greed',
];

/** 排序后的副本，用来断言"洗牌只换位置、不增删元素"。 */
function sorted(items: readonly string[]): string[] {
  return [...items].sort();
}

describe('shuffle —— 同一 runSeed 必然同一顺序（验收 1）', () => {
  it('同一个 runSeed 跑两次得到完全相同的顺序数组', () => {
    const first = shuffle(BOSSES, 20261012);
    const second = shuffle(BOSSES, 20261012);
    // ⚠️ `toEqual` 而不是"长度一样 / 集合一样"：顺序**就是**这个函数的
    // 全部产出，任何"差不多"的断言都放过"偶尔换了一下"的 bug。
    expect(second).toEqual(first);
    expect(first).toHaveLength(BOSSES.length);
  });

  it('同一 runSeed 的确定性覆盖每一个种子（不是只对某一个种子成立）', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      expect(shuffle(BOSSES, seed)).toEqual(shuffle(BOSSES, seed));
    }
  });

  it('洗牌只重排、不增删元素（7 个 Boss 的一个排列）', () => {
    const shuffled = shuffle(BOSSES, 777);
    expect(sorted(shuffled)).toEqual(sorted(BOSSES));
    // 排列 = 每个元素恰好出现一次，所以没有重复
    expect(new Set(shuffled).size).toBe(BOSSES.length);
  });

  it('负数 / 小数 / 超 uint32 的 runSeed 也不会产生不确定的顺序', () => {
    // 理由：`createRng` 会把种子规范化成 uint32，所以这些"非法但可能
    // 从别处传进来"的值必须是**确定的**，而不是 NaN 一路传到 Math.floor。
    expect(shuffle(BOSSES, -1)).toEqual(shuffle(BOSSES, 4294967295));
    expect(shuffle(BOSSES, 1.7)).toEqual(shuffle(BOSSES, 1));
    expect(shuffle(BOSSES, 2 ** 32 + 5)).toEqual(shuffle(BOSSES, 5));
  });
});

describe('shuffle —— 不同种子必须给出不同顺序（反向验证 2）', () => {
  it('不同 runSeed 产生的顺序不全都一样', () => {
    // ⚠️ 这条是"永远返回固定顺序"的实现的杀手：只断言"同种子同结果"
    // 的话，`return [...items]`（原样返回）也能通过。
    const orders = new Set<string>();
    for (let seed = 0; seed < 50; seed += 1) {
      orders.add(shuffle(BOSSES, seed).join(','));
    }
    // 7! = 5040 种排列，抽 50 个种子时重复很多次才可疑
    expect(orders.size).toBeGreaterThan(40);
  });

  it('两个只有 1 个 Boss 的池子的极端情形（顺序只能相同）', () => {
    // 记录下来：**这个用例不是**"不同种子必不同"的反例，而是说
    // 那条性质只在池子足够大时才成立 —— 所以下面的种子对枚举
    // 用的是 2 个元素的池子，并允许极少数碰撞。
    expect(shuffle(['meiichiro'], 1)).toEqual(['meiichiro']);
    expect(shuffle(['meiichiro'], 2)).toEqual(['meiichiro']);
  });

  it('种子对枚举：绝大多数 (seedA, seedB) 给出不同顺序', () => {
    /**
     * ⚠️ 这条用例的第一版**写错了**，记在这里以免下次又这么写。
     *
     * 原写法：枚举 0..19 的 380 个有序种子对，断言"顺序相同"的对数 < 140，
     * 依据是"2 元素池子下相同概率 1/2 → 期望约 190 对"。
     *
     * 那个依据是错的：**这些对并不独立**。380 个有序对背后只有 20 个
     * **不同的种子**（= 20 个不同的顺序），而 `a,b` 与 `b,a` 总会给出
     * 同一个顺序 —— 所以"相同"的对数**必然**至少是
     * `Σ_k c_k²  − 380 ≈ (380²/20) − 380 = 6840` … 实测 182。
     * 换句话说，这个断言测的是"20 个种子里大约有几个落在这个顺序上"，
     * 而不是"种子有没有用"。
     *
     * 正确的问法是：**这些种子一共产生了多少种不同的顺序**。
     * 一个"永远返回固定顺序"的实现只会有 1 种；真正洗牌的会有很多种。
     */
    const pool = BOSSES.slice(0, 2); // 2 个元素 → 2 种可能的排列
    const orders = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      orders.add(shuffle(pool, seed).join(','));
    }
    // 2 元素池子的上界就是 2；20 个种子里两种都该出现
    expect(orders.size).toBe(2);
  });

  it('4 元素池子：0..99 这 100 个种子产出**全部 24 种**排列', () => {
    /**
     * 这是"洗牌真的在洗"的**最强**一条（而且是不依赖概率阈值的）：
     * 4! = 24 种排列全都出现，说明洗牌不是"只交换相邻两项"、
     * 也不是"只换前几个位置"这类**有结构缺陷**的实现。
     *
     * 实测：种子 0..70 就覆盖了全部 24 种（`tests` 里写 100 是留余量，
     * 不是恰好在边界上）—— 留余量的理由是这个数会随 `core/rng.ts` 的
     * 算法改动而变，而"改 RNG"本来就会让黄金基线一起变，那时这条
     * 测试的位置不该成为额外的障碍。
     */
    const pool = ['a', 'b', 'c', 'd'];
    const orders = new Set<string>();
    for (let seed = 0; seed < 100; seed += 1) {
      orders.add(shuffle(pool, seed).join(','));
    }
    expect(orders.size).toBe(24);
  });

  it('种子只差 1 时也应当改变顺序（否则 7 个位置会抽到一样的顺序）', () => {
    let changed = 0;
    for (let seed = 0; seed < 100; seed += 1) {
      if (shuffle(BOSSES, seed).join(',') !== shuffle(BOSSES, seed + 1).join(',')) changed += 1;
    }
    // 相邻种子**必然**不同（mulberry32 的第一步就改变状态），所以这里是 100。
    // 写成 `> 90` 而不是 `toBe(100)` 是为了不在"某个种子下巧合相同"时
    // 给出一个难以理解的失败；但 90 已经足以拦住"种子没被真正用上"。
    expect(changed).toBeGreaterThan(90);
  });
});

describe('shuffle —— 排列分布没有明显偏差', () => {
  it('7 个 Boss 的 3 个位置上有足够多的不同取值', () => {
    // 只测"每个位置的取值不总是同一个"：完整的多项分布检验（卡方）
    // 会让这条测试变慢且难读，而它要防的 bug（比如"只交换了相邻两项"）
    // 在"每个位置的取值集合足够大"这一条上就会暴露。
    const firstChoices = new Set<string>();
    const lastChoices = new Set<string>();
    for (let seed = 0; seed < 500; seed += 1) {
      const order = shuffle(BOSSES, seed);
      const first = order[0];
      const last = order[order.length - 1];
      if (first !== undefined) firstChoices.add(first);
      if (last !== undefined) lastChoices.add(last);
    }
    expect(firstChoices.size).toBe(BOSSES.length);
    expect(lastChoices.size).toBe(BOSSES.length);
  });
});

describe('shuffle —— 纯度', () => {
  it('不修改入参（返回新数组）', () => {
    const input = [...BOSSES];
    const frozen = [...input];
    const out = shuffle(input, 42);
    expect(input).toEqual(frozen);
    expect(out).not.toBe(input);
  });

  it('空数组与单元素数组原样返回', () => {
    expect(shuffle([], 5)).toEqual([]);
    expect(shuffle(['lust'], 5)).toEqual(['lust']);
  });
});

describe('battleSeed —— 每场战斗的种子独立派生', () => {
  it('同一个 (runSeed, position) 必然同一个种子（可重放的前提）', () => {
    for (let position = 1; position <= 7; position += 1) {
      expect(battleSeed(20261012, position)).toBe(battleSeed(20261012, position));
    }
  });

  it('同一个 runSeed 下，7 个位置的种子互不相同', () => {
    // ⚠️ 这条是"每场独立"的**核心**：共用同一个 seed 会让两个 Boss 的
    // 出招序列相关（同一个加权随机轮转在同样的种子里抽出同样的偏移），
    // 玩家会看到"换了 Boss 但节奏一模一样"。
    const seeds = new Set<number>();
    for (let position = 1; position <= 7; position += 1) {
      seeds.add(battleSeed(20261012, position));
    }
    expect(seeds.size).toBe(7);
  });

  it('不同 runSeed 的同一位置得到不同种子', () => {
    const seeds = new Set<number>();
    for (let runSeed = 0; runSeed < 100; runSeed += 1) {
      seeds.add(battleSeed(runSeed, 1));
    }
    expect(seeds.size).toBe(100);
  });

  it('不同的 (runSeed, position) 组合几乎不碰撞', () => {
    // 1000 个组合：`mix32` 的雪崩 + 再取一次 mulberry32，期望碰撞 ≈ 0
    // （生日界：1000²/2/2³² ≈ 0.0001）。给一个宽容的上界而不是 0 相等，
    // 因为"两个不同的组合撞上同一个 uint32"在数学上确实可能，
    // 而那不是 bug。
    const seen = new Set<number>();
    let total = 0;
    for (let runSeed = 0; runSeed < 100; runSeed += 1) {
      for (let position = 1; position <= 10; position += 1) {
        seen.add(battleSeed(runSeed, position));
        total += 1;
      }
    }
    expect(total).toBe(1000);
    expect(seen.size).toBeGreaterThanOrEqual(999);
  });

  it('结果落在 uint32 范围内（能直接当引擎的 seed 用）', () => {
    for (let position = 0; position < 20; position += 1) {
      const seed = battleSeed(12345, position);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });

  it('一个位置上的种子与那一局的 runSeed 不同（不是把种子原样传下去）', () => {
    // 若实现是 `return runSeed`（省事写法），"每场独立"就完全没实现，
    // 而"同种子同结果"那条依然会过。
    for (let position = 1; position <= 7; position += 1) {
      expect(battleSeed(20261012, position)).not.toBe(20261012);
    }
  });
});
