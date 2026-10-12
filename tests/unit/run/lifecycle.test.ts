import { describe, expect, it } from 'vitest';

import type { QijiEntity, QijiUnlock, RunCounters } from '../../../src/core/types/qiji';
import {
  advanceRun,
  battleRecordOf,
  dropRunProgress,
  startRun,
  withCounters,
  withRunSeed,
  withUnlocked,
} from '../../../src/core/run/lifecycle';
import { MAX_RUN_POSITION, counterValue, fillCounters, runLengthOf, tierForPosition } from '../../../src/core/run/types';
import { battleSeed, shuffle } from '../../../src/core/run/shuffle';

/**
 * 生命周期的单测（P0 验收第二条的**状态转移那一半**）。
 *
 * ⚠️ 每一场战斗都是**直接喂数字**：`advanceRun(state, { outcome, counters })`。
 * 这里没有 `BattleEngine`、没有 `Action`、没有 tick —— P0 的接口就是
 * "接收这些数字"，所以测试也照这个形状写。自己造一个假的战斗内计数器
 * 会让测试**通过**而接口**接不上引擎**。
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

/** 一局肉鸽的起点：真的走 `shuffle` 定顺序（与 P2 的 app 层同一条路）。 */
function openingRun(runSeed: number, playerId = 'player') {
  return startRun({ runSeed, playerId, order: shuffle(BOSSES, runSeed) });
}

/** 最小假炁机（判定只读 `id` / `unlock` / `maxStacks`，见 unlock.test.ts）。 */
function qiji(id: string, unlock: QijiUnlock, maxStacks?: number): QijiEntity {
  return {
    id,
    kind: 'passive',
    nameKey: `qiji.${id}.name`,
    icon: 'char_break',
    category: 'offense',
    unlock,
    abilities: [],
    ...(maxStacks === undefined ? {} : { maxStacks }),
  };
}

const ALWAYS: QijiUnlock = { kind: 'always', of: [] };

describe('startRun —— 开局', () => {
  it('position = 1，counters / unlocked / chosen 都是空的', () => {
    const run = openingRun(1234);
    expect(run.position).toBe(1);
    expect(run.status).toBe('active');
    expect(run.counters).toEqual({});
    expect(run.unlocked).toEqual([]);
    expect(run.chosen).toEqual([]);
    expect(run.playerId).toBe('player');
    expect(run.runSeed).toBe(1234);
  });

  it('order 就是洗出来的顺序（同一 runSeed 与 shuffle 一致）', () => {
    expect(openingRun(99).order).toEqual(shuffle(BOSSES, 99));
  });

  it('order 是**拷贝**：改外部数组不会影响状态', () => {
    const source = [...BOSSES];
    const run = startRun({ runSeed: 1, playerId: 'player', order: source });
    source.reverse();
    expect(run.order).toEqual(BOSSES);
  });

  it('runSeed 规范化成 uint32', () => {
    expect(startRun({ runSeed: -1, playerId: 'player', order: [] }).runSeed).toBe(4294967295);
    expect(startRun({ runSeed: 2 ** 32 + 7, playerId: 'player', order: [] }).runSeed).toBe(7);
  });

  it('label 可选，且**总是**占一个键（值可能是 undefined）', () => {
    expect(startRun({ runSeed: 1, playerId: 'player', order: [] }).label).toBeUndefined();
    expect(startRun({ runSeed: 1, playerId: 'player', order: [], label: '?order=k1,k2' }).label).toBe(
      '?order=k1,k2',
    );
    // 键**在**（而不是缺）：这一条是 JSON 往返能 `toEqual` 的前提，
    // 见 lifecycle.ts 的 startRun 注释。
    expect(Object.keys(startRun({ runSeed: 1, playerId: 'player', order: [] }))).toContain('label');
  });
});

describe('withCounters —— 累加（唯一的写入路径）', () => {
  it('加的不是覆盖', () => {
    const run = openingRun(1);
    const once = withCounters(run, { jieInterrupts: 1 });
    const twice = withCounters(once, { jieInterrupts: 2 });
    expect(counterValue(twice.counters, 'jieInterrupts')).toBe(3);
    // 入参没被改（纯函数）
    expect(run.counters).toEqual({});
  });

  it('多个计数器互不干扰', () => {
    const run = withCounters(openingRun(1), { jieInterrupts: 2, dodges: 1 });
    const next = withCounters(run, { dodges: 4, interrupts: 1 });
    expect(fillCounters(next.counters)).toEqual({
      jieInterrupts: 2,
      interrupts: 1,
      dodges: 5,
      battlesWon: 0,
      flawlessBattles: 0,
    });
  });

  it('⚠️ 不认识的键被忽略，而不是抛错（引擎将来会加计数器）', () => {
    const run = withCounters(openingRun(1), { jieInterrupts: 1, somethingNew: 99 });
    expect(run.counters).toEqual({ jieInterrupts: 1 });
  });

  it('0 值与不存在的键不写进结果（状态保持紧凑）', () => {
    expect(withCounters(openingRun(1), { jieInterrupts: 0 }).counters).toEqual({});
    expect(withCounters(openingRun(1), {}).counters).toEqual({});
  });

  it('计数可以是负数（不拦 —— 那是内容或引擎的问题，不该在这一层猜）', () => {
    const run = withCounters(withCounters(openingRun(1), { dodges: 3 }), { dodges: -1 });
    expect(counterValue(run.counters, 'dodges')).toBe(2);
  });
});

describe('withUnlocked —— 只增不减', () => {
  const POOL: readonly QijiEntity[] = [
    qiji('vitality', ALWAYS),
    qiji('jieDeriveStrike', { kind: 'counterAtLeast', counter: 'jieInterrupts', value: 3 }),
  ];

  it('按 pool 的顺序追加新解锁的 id', () => {
    const run = withUnlocked(withCounters(openingRun(1), { jieInterrupts: 3 }), POOL);
    expect(run.unlocked).toEqual(['vitality', 'jieDeriveStrike']);
  });

  it('已经解锁的不重复追加', () => {
    const first = withUnlocked(openingRun(1), POOL);
    const second = withUnlocked(first, POOL);
    expect(second.unlocked).toEqual(['vitality']);
    // 没有新解锁时返回**同一个对象**（省一次无意义的拷贝）
    expect(second).toBe(first);
  });

  it('解锁不回缩：计数被清零也留着（"曾经解锁过"）', () => {
    const unlocked = withUnlocked(withCounters(openingRun(1), { jieInterrupts: 3 }), POOL);
    // 直接构造一个"计数不够了"的状态
    const rolledBack = { ...unlocked, counters: {} satisfies RunCounters };
    expect(withUnlocked(rolledBack, POOL).unlocked).toEqual(['vitality', 'jieDeriveStrike']);
  });
});

describe('advanceRun —— 一场战斗之后', () => {
  it('胜：position + 1，battlesWon + 1，状态仍是 active', () => {
    const next = advanceRun(openingRun(7), { outcome: 'victory', counters: {} });
    expect(next.position).toBe(2);
    expect(next.status).toBe('active');
    expect(counterValue(next.counters, 'battlesWon')).toBe(1);
  });

  it('负：status = defeat，**position 不动**（= 死在第几场）', () => {
    const run = advanceRun(openingRun(7), { outcome: 'victory', counters: {} });
    expect(run.position).toBe(2);
    const dead = advanceRun(run, { outcome: 'defeat', counters: {} });
    expect(dead.status).toBe('defeat');
    expect(dead.position).toBe(2); // 死在第二场
    // 输了不加 battlesWon
    expect(counterValue(dead.counters, 'battlesWon')).toBe(1);
  });

  it('喂终局快照里的计数被累加（且不认识的键被忽略）', () => {
    const next = advanceRun(openingRun(7), {
      outcome: 'victory',
      counters: { jieInterrupts: 2, dodges: 1, notACounter: 5 },
    });
    expect(fillCounters(next.counters)).toEqual({
      jieInterrupts: 2,
      interrupts: 0,
      dodges: 1,
      battlesWon: 1,
      flawlessBattles: 0,
    });
  });

  it('⚠️ 先累加、后判定解锁（这一场刚数够的截，这一场结束就能选）', () => {
    const pool = [
      qiji('jieDeriveStrike', { kind: 'counterAtLeast', counter: 'jieInterrupts', value: 3 }),
    ];
    let run = openingRun(7);
    run = advanceRun(run, { outcome: 'victory', counters: { jieInterrupts: 2 } }, pool);
    expect(run.unlocked).toEqual([]);
    run = advanceRun(run, { outcome: 'victory', counters: { jieInterrupts: 1 } }, pool);
    // 若顺序反了（先判定后累加），这里会是 []，而且**永远**差一场
    expect(run.unlocked).toEqual(['jieDeriveStrike']);
  });

  it('失败那一场里的计数也会被累加（输了不等于白打）', () => {
    const run = advanceRun(openingRun(7), {
      outcome: 'defeat',
      counters: { dodges: 4, jieInterrupts: 1 },
    });
    expect(counterValue(run.counters, 'dodges')).toBe(4);
    expect(counterValue(run.counters, 'jieInterrupts')).toBe(1);
  });

  it('满编：打赢 `order` 的最后一个（第 7 场）→ status = victory，position 停在 len + 1', () => {
    let run = openingRun(7);
    for (let i = 0; i < MAX_RUN_POSITION - 1; i += 1) {
      run = advanceRun(run, { outcome: 'victory', counters: {} });
      expect(run.status).toBe('active');
    }
    expect(run.position).toBe(MAX_RUN_POSITION);
    const finished = advanceRun(run, { outcome: 'victory', counters: {} });
    expect(finished.status).toBe('victory');
    expect(finished.position).toBe(MAX_RUN_POSITION + 1);
    expect(counterValue(finished.counters, 'battlesWon')).toBe(MAX_RUN_POSITION);
  });

  it('⚠️ 开发期短局（order 只有 2 个）：打完第 2 场就通关（不是打到第 7 场）', () => {
    /**
     * ⚠️ 这条用例**改过一次**，它原来叫"开发期短局（order 只有 2 个）
     * 也能通关"而正文断言的是 `status === 'active'` —— **名字与断言
     * 相反**（当时的实现拿 `MAX_RUN_POSITION` 当通关判据，于是 2 个
     * Boss 的局永远通不了关）。现在判据是 `order.length`，名字与断言一致。
     *
     * 为什么必须是这样：用户的原话是"目前是 7 个 boss"+"还剩的 5 个
     * boss 慢慢加呗" —— **7 是终点、`order.length` 是现实**，所以今天
     * 这一局必须能打完（§2.3 的"一局肉鸽的场数等于 `BOSS_POOL.length`"）。
     */
    const short = startRun({ runSeed: 5, playerId: 'player', order: BOSSES.slice(0, 2) });
    const afterFirst = advanceRun(short, { outcome: 'victory', counters: {} });
    expect(afterFirst.position).toBe(2);
    expect(afterFirst.status).toBe('active');
    const afterSecond = advanceRun(afterFirst, { outcome: 'victory', counters: {} });
    // 通关：position = len + 1 = 3（而不是"停在 active 等一个不存在的第 3 场"）
    expect(afterSecond.status).toBe('victory');
    expect(afterSecond.position).toBe(3);
    expect(counterValue(afterSecond.counters, 'battlesWon')).toBe(2);
  });

  it('⚠️ 单场的一局（order 只有 1 个）：打完第 1 场就通关', () => {
    // §6.1 的表里 `len = 1` 那一行："单场即终局"（档位 T7）。
    const single = startRun({ runSeed: 5, playerId: 'player', order: ['meiichiro'] });
    const done = advanceRun(single, { outcome: 'victory', counters: {} });
    expect(done.status).toBe('victory');
    expect(done.position).toBe(2);
  });

  it('通不了关的那一侧：输了就是输了（短局最后一场输 = defeat，不是 victory）', () => {
    // 防"通关判据写成 `position >= 1`"这种把什么都判成通关的实现。
    const short = startRun({ runSeed: 5, playerId: 'player', order: BOSSES.slice(0, 2) });
    const afterFirst = advanceRun(short, { outcome: 'victory', counters: {} });
    const lost = advanceRun(afterFirst, { outcome: 'defeat', counters: {} });
    expect(lost.status).toBe('defeat');
    expect(lost.position).toBe(2);
  });

  it('⚠️ 已经结束的一局肉鸽再被推进 → 抛错（不静默忽略）', () => {
    const dead = advanceRun(openingRun(7), { outcome: 'defeat', counters: {} });
    expect(() => advanceRun(dead, { outcome: 'victory', counters: {} })).toThrow(/finished run/);
    // 报错信息用英文（i18n 规范 I1：开发者错误不本地化）
    expect(() => advanceRun(dead, { outcome: 'victory', counters: {} })).toThrow(/status=defeat/);
  });

  it('order 为空（还没定顺序）→ 抛错', () => {
    const empty = startRun({ runSeed: 1, playerId: 'player', order: [] });
    expect(() => advanceRun(empty, { outcome: 'victory', counters: {} })).toThrow(/no boss order/);
  });

  it('纯函数：入参状态没被改', () => {
    const run = openingRun(7);
    const frozen = structuredClone(run);
    advanceRun(run, { outcome: 'victory', counters: { jieInterrupts: 1 } });
    expect(run).toEqual(frozen);
  });
});

describe('一局肉鸽打完：position 与 order 对得上', () => {
  it('每一场的 Boss 就是 order[position - 1]', () => {
    let run = openingRun(2026);
    for (let i = 0; i < MAX_RUN_POSITION; i += 1) {
      const bossId = run.order[run.position - 1];
      const record = battleRecordOf(run, battleSeed(run.runSeed, run.position), 'victory');
      expect(record.bossId).toBe(bossId);
      expect(record.position).toBe(run.position);
      run = advanceRun(run, { outcome: 'victory', counters: {} });
    }
    expect(run.status).toBe('victory');
  });

  it('全部 7 个 Boss 各打一次（顺序是一个排列）', () => {
    let run = openingRun(4242);
    const fought: string[] = [];
    for (let i = 0; i < MAX_RUN_POSITION; i += 1) {
      fought.push(battleRecordOf(run, 1, 'victory').bossId);
      run = advanceRun(run, { outcome: 'victory', counters: {} });
    }
    expect([...fought].sort()).toEqual([...BOSSES].sort());
  });

  it('position 超出 order 长度 → battleRecordOf 抛错（而不是记一个 undefined 的 boss）', () => {
    const short = startRun({ runSeed: 5, playerId: 'player', order: ['meiichiro'] });
    const after = advanceRun(short, { outcome: 'victory', counters: {} });
    expect(after.position).toBe(2);
    expect(() => battleRecordOf(after, 1, 'victory')).toThrow(/order has 1 entries/);
  });
});

describe('失败 = 全丢（§2.4 / §12 决议 #1）', () => {
  it('dropRunProgress 清空 counters / unlocked / chosen，回第 1 场', () => {
    let run = advanceRun(openingRun(7), { outcome: 'victory', counters: { jieInterrupts: 3 } }, [
      qiji('vitality', ALWAYS),
    ]);
    run = { ...run, chosen: [{ qijiId: 'vitality', stacks: 1 }] };
    const fresh = dropRunProgress(run);
    expect(fresh.position).toBe(1);
    expect(fresh.status).toBe('active');
    expect(fresh.counters).toEqual({});
    expect(fresh.unlocked).toEqual([]);
    expect(fresh.chosen).toEqual([]);
    // 种子 / 角色 / 顺序保留（"重开一局"由调用方决定要不要换种子）
    expect(fresh.runSeed).toBe(7);
    expect(fresh.playerId).toBe('player');
    expect(fresh.order).toEqual(run.order);
  });

  it('withRunSeed 换顺序并回到第 1 场', () => {
    const run = advanceRun(openingRun(7), { outcome: 'victory', counters: {} });
    const next = withRunSeed(run, shuffle(BOSSES, 8));
    expect(next.position).toBe(1);
    expect(next.status).toBe('active');
    expect(next.order).toEqual(shuffle(BOSSES, 8));
  });
});

/**
 * ------------------------------------------------------------------
 * 通关判据为什么是 `order.length`（这一段曾经写的是"P0 的已知缺口"）
 * ------------------------------------------------------------------
 *
 * §2.3 有两句话在开发期**互相矛盾**：
 *   - "一局肉鸽的场数等于 `BOSS_POOL.length`"（今天 `len = 2`）
 *   - §12 决议 #7："固定 7 场"
 *
 * 第一版按后者实现（`position > MAX_RUN_POSITION` → 通关），于是
 * **2 个 Boss 的局永远通不了关**：打完第 2 场仍停在 `active`，
 * 而第 3 场根本没得打。这是荒谬的，也被用户的话否掉 ——
 * "目前是 7 个 boss" + "还剩的 5 个 boss 慢慢加呗"：
 * **7 是终点、`len` 是现实**，所以今天这一局必须能打完。
 *
 * 现在的实现：通关判据 = 打完 `order` 的最后一个（`advanceRun` 读
 * `runLengthOf(state)`）。`MAX_RUN_POSITION = 7` **保留**，但它只表示
 * "满编时的长度"与"强度档的上界"（见 `tierForPosition`），
 * **不参与通关判定**。
 *
 * §6.1 的取档公式 `ceil(k * 7 / len)` 本来就是为"开发期子集"准备的 ——
 * 它是这条结论的旁证：位置的上界一直是 `len`，从来不是 7。
 */

describe('runLengthOf —— "这一局几场"只有一处定义', () => {
  it('就是 order.length（空 order 是 0，表示"顺序还没定"）', () => {
    expect(runLengthOf(openingRun(1))).toBe(BOSSES.length);
    expect(runLengthOf(startRun({ runSeed: 1, playerId: 'player', order: [] }))).toBe(0);
    expect(runLengthOf(startRun({ runSeed: 1, playerId: 'player', order: ['a', 'b'] }))).toBe(2);
  });

  it('满编时等于 MAX_RUN_POSITION（这正是那个常量的含义）', () => {
    expect(runLengthOf(openingRun(1))).toBe(MAX_RUN_POSITION);
  });
});

describe('tierForPosition —— §6.1 的取档公式（k 的上界是 len，不是 7）', () => {
  it('满编 len = 7：一位置一档 T1..T7', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((k) => tierForPosition(k, 7))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('§6.1 取档表：公式算出来的每一行都对得上（**其中 len = 3 那行文档算错了**）', () => {
    /**
     * 文档 §6.1 给了一张表：
     *   7 → T1 T2 T3 T4 T5 T6 T7
     *   3 → T2 T5 T7   ← ⚠️ **这一格是错的**
     *   2 → T4 T7
     *   1 → T7
     *
     * 但文档**同一节**把公式写死了：`档位 = ceil(k * 7 / len)`。
     * 代入 `len = 3, k = 1` 得 `ceil(7/3) = 3` → **T3**，不是 T2
     * （`ceil(2*7/3) = 5`、`ceil(3*7/3) = 7` 与表一致）。
     *
     * 所以矛盾只在"第一个位置"那一格，而**公式才是权威**，因为：
     *   1. 公式是文档显式给出的判据，表只是它的示例
     *   2. 公式满足文档自己写的两条不变量（"第一个位置一定是最软档、
     *      最后一个位置一定是最硬档"）
     *   3. T2 那个值**不可能**由公式产生：`ceil(k*7/3)` 的取值只有
     *      {3, 5, 7}，T2 不在其中 —— 即"照表实现"根本无法用公式表达，
     *      只能写一条特判，而那正是要避免的东西
     *
     * 这里按**公式**断言，并把这一格的不同写出来，免得下一个人以为
     * 实现算错了。**已作为文档问题上报**（要改的是文档那一格）。
     */
    expect([1, 2, 3].map((k) => tierForPosition(k, 3))).toEqual([3, 5, 7]);
    expect([1, 2].map((k) => tierForPosition(k, 2))).toEqual([4, 7]);
    expect([tierForPosition(1, 1)]).toEqual([7]);
    // 文档没列、但公式直接给出的行（一并钉住，免得只有 4 个 len 被覆盖）
    expect([1, 2, 3, 4].map((k) => tierForPosition(k, 4))).toEqual([2, 4, 6, 7]);
    expect([1, 2, 3, 4, 5].map((k) => tierForPosition(k, 5))).toEqual([2, 3, 5, 6, 7]);
  });

  it('⚠️ 不变量：第一个位置一定最软、最后一个位置一定最硬（任何 len 都成立）', () => {
    // 这条是整个"强度曲线"设计的可执行版本。若公式写错（例如
    // 忘了 clamp、或者把 k 从 0 起算），"越后越难"会**静默**失效 ——
    // 表现为"第 1 场和第 5 场一样难"，而截图里看不出来。
    for (let len = 1; len <= MAX_RUN_POSITION; len += 1) {
      const tiers = Array.from({ length: len }, (_, i) => tierForPosition(i + 1, len));
      expect(tiers[0]).toBeLessThanOrEqual(tiers[len - 1] ?? 0);
      expect(tiers[len - 1]).toBe(MAX_RUN_POSITION); // 最后一个位置恒为终局档
      // 档位单调不减（越后越难）
      for (let i = 1; i < len; i += 1) {
        expect(tiers[i]).toBeGreaterThanOrEqual(tiers[i - 1] ?? 0);
      }
    }
  });

  it('len = 2（今天的现实）：第 1 场是基准档 T4、第 2 场是终局档 T7', () => {
    // T4 故意是"今天的值 ×1.0"（§6.2），所以开发期第一场 = 现在的难度。
    expect(tierForPosition(1, 2)).toBe(4);
    expect(tierForPosition(2, 2)).toBe(7);
  });

  it('k 超出 1..len 时夹到边界（不抛错 —— 通关那一刻 position = len + 1）', () => {
    expect(tierForPosition(0, 3)).toBe(tierForPosition(1, 3));
    expect(tierForPosition(-5, 3)).toBe(tierForPosition(1, 3));
    expect(tierForPosition(99, 3)).toBe(tierForPosition(3, 3));
    expect(tierForPosition(1.9, 3)).toBe(tierForPosition(1, 3));
  });

  it('不传 runLength 时按满编 7 算（调用方不必知道这个默认值）', () => {
    expect(tierForPosition(1)).toBe(tierForPosition(1, MAX_RUN_POSITION));
    expect(tierForPosition(7)).toBe(7);
  });

  it('runLength = 0 / 负数时不崩（退化成终局档，而不是 NaN）', () => {
    // 调用方可能是"还没定顺序就开始画预览"的 UI。返回 NaN 会让
    // 档位查表得到 undefined，错误离原因很远。
    expect(tierForPosition(1, 0)).toBe(MAX_RUN_POSITION);
    expect(tierForPosition(1, -3)).toBe(MAX_RUN_POSITION);
    expect(Number.isInteger(tierForPosition(1, 0))).toBe(true);
  });

  it('任何输入都返回 1..MAX_RUN_POSITION 的整数（能直接当档号查表）', () => {
    for (let len = 0; len <= 10; len += 1) {
      for (let k = -2; k <= 12; k += 1) {
        const tier = tierForPosition(k, len);
        expect(Number.isInteger(tier)).toBe(true);
        expect(tier).toBeGreaterThanOrEqual(1);
        expect(tier).toBeLessThanOrEqual(MAX_RUN_POSITION);
      }
    }
  });
});
