import { describe, expect, it } from 'vitest';

import type { EventDef } from '../../../src/core/events';
import { outcomeOf } from '../../../src/core/run/outcome';

/**
 * `outcome.ts` 的单测 —— 这一场**打完了没有 / 谁赢了**。
 *
 * ==================================================================
 * ⚠️ 为什么一个"没有消费者"的函数也要单测
 * ==================================================================
 *
 * `outcomeOf` 目前在 `core/` 里**没有消费者**（它是 P2/P3 的 app 入口，
 * 见它自己的注释）。这种函数最容易被当成"写在那里、没人验证"的东西 ——
 * 而**零消费者 + 零测试覆盖**正是这一整轮在清的那类东西：它看起来像
 * 基础设施，于是下一个人会**信任**它（顺手依赖），却在它坏掉时没有任何
 * 反馈（没有消费者去失败）。
 *
 * 所以这两条用例的作用不是"覆盖一个热路径"，而是**把这个叶子的行为
 * 钉住** —— 让"它现在到底是什么语义"变成一个可执行的断言，
 * 而不是靠读一遍实现去猜。
 *
 * 单测放在本文件（而不是塞进 `stats.test.ts` / `query.test.ts`）：
 * 与源码的切法一致（`outcome.ts` 是独立叶子），于是"这个叶子坏了"
 * 会在一个**名字对应**的文件里失败。
 */

/** 造一个 `encounterEnd` 事件。 */
function encounterEnd(result: 'victory' | 'defeat', tick = 100): EventDef {
  return { kind: 'encounterEnd', tick, result, reason: 'hpZero' };
}

/** 造一个与结果无关的噪声事件（用来证明"不只看有没有事件"）。 */
function someDamage(tick = 1): EventDef {
  return {
    kind: 'damage',
    tick,
    sourceId: 'player',
    targetId: 'meiichiro',
    amount: 10,
    crit: false,
    absorbed: 0,
    overkill: 0,
    skillId: 'jie',
  };
}

describe('outcomeOf —— 从事件流取这一场的结果', () => {
  it('含 `encounterEnd` → 取到它的 `result`（胜 / 负都取对）', () => {
    expect(outcomeOf([someDamage(1), encounterEnd('victory', 500)])).toBe('victory');
    expect(outcomeOf([someDamage(1), encounterEnd('defeat', 500)])).toBe('defeat');
    // 只有 `encounterEnd` 一个事件也行
    expect(outcomeOf([encounterEnd('victory')])).toBe('victory');
  });

  it('空数组 / 不含 `encounterEnd` → `undefined`（= 还没打完）', () => {
    expect(outcomeOf([])).toBeUndefined();
    expect(outcomeOf([someDamage(1)])).toBeUndefined();
    // 有别的"看起来像结束"的事件也不算 —— 唯一的判据是 `encounterEnd`
    const death: EventDef = { kind: 'death', tick: 2, targetId: 'meiichiro' };
    expect(outcomeOf([death])).toBeUndefined();
  });
});
