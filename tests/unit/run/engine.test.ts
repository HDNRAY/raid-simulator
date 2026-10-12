import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../../src/core/combat/battleState';
import { REPLAY_FORMAT_VERSION } from '../../../src/core/run';
import { reduceBattleStats } from '../../../src/core/run/stats';
import { makeGoldenEngineOptions } from '../../golden/fixtures';

/**
 * **真引擎**的端到端：证明 `③`（`interruptSuccess.sourceSkillId`）在真实
 * 战斗里真的被 emit 出来。
 *
 * ==================================================================
 * 为什么这一条必须存在（而不能只留手工构造事件的用例）
 * ==================================================================
 *
 * `stats.test.ts` / `query.test.ts` 都是**手工构造事件**（那是对的：
 * 归约器与查询要能脱离引擎单测）。但手工构造有一个盲区 —— 它
 * **证明不了"引擎真的会填这个字段"**：若 `hitResolution.ts` 的两个 emit
 * 点少写一处，那些用例照样全绿，而真实游戏里"用截打断 3 次"
 * 永远解锁不了。所以这里开真引擎跑一场。
 *
 * 场景照抄 `tests/golden/bossArmor.test.ts` 的"没有霸体时「破」能打断
 * Boss 的任意招式"：让 Boss 起「呵斥」（中刀、不带霸体），
 * 然后玩家用「破」打断。
 */

/** 让 Boss 起「呵斥」（中刀 —— 它是「破」/「截」的靶子），返回引擎。 */
function bossCastingRebuke(): BattleEngine {
  const e = new BattleEngine(makeGoldenEngineOptions());
  e.tick([], 'meiichiro');
  e.drainEvents();
  e.tick([{ type: 'useSkill', skillId: 'boss-rebuke', atTick: e.snapshot.tick }], 'meiichiro');
  e.drainEvents();
  return e;
}

describe('③ 端到端：真实战斗里 `interruptSuccess` 真的带 `sourceSkillId`', () => {
  it('玩家用「破」打断 Boss 的「呵斥」→ 事件带 `sourceSkillId: "break"`', () => {
    const e = bossCastingRebuke();
    e.tick([{ type: 'useSkill', skillId: 'break', atTick: e.snapshot.tick }]);
    const events = e.drainEvents();

    const interrupts = events.filter((ev) => ev.kind === 'interruptSuccess');
    expect(interrupts.length).toBeGreaterThan(0);
    for (const ev of interrupts) {
      // ⚠️ `skillId` 是**被打断的读条**（Boss 的招），`sourceSkillId` 才是
      // **打断者用的招**（玩家的「破」）。这条断言把两者的区别钉死 ——
      // 少了 `sourceSkillId` 的话，"用截打断"与"用破打断"无法区分。
      expect(ev.skillId).not.toBe('break');
      expect(ev.sourceSkillId).toBe('break');
    }

    // 归约器真的从**真实事件**里读出了这个数
    const stats = reduceBattleStats(events, {
      actorId: 'player',
      outcome: 'victory',
      flawless: false,
    });
    expect(stats.skillInterrupts['break']).toBeGreaterThan(0);
    expect(stats.skillInterrupts['jie'] ?? 0).toBe(0);
  });

  it('「截」也走同一个 emit 点（它就是用户要的"成功使用 3 次截"）', () => {
    // ⚠️ 「截」的 `onSuccess` 要退 CD + 挂派生窗口，是最忙的一条打断路径，
    // 所以单独覆盖一次（两个 emit 点里它走的是"打断分支 + onSuccess 递归"）。
    const e = bossCastingRebuke();
    e.tick([{ type: 'useSkill', skillId: 'jie', atTick: e.snapshot.tick }]);
    const events = e.drainEvents();

    const interrupts = events.filter((ev) => ev.kind === 'interruptSuccess');
    expect(interrupts.length).toBeGreaterThan(0);
    expect(interrupts.every((ev) => ev.sourceSkillId === 'jie')).toBe(true);

    const stats = reduceBattleStats(events, {
      actorId: 'player',
      outcome: 'victory',
      flawless: false,
    });
    // 这一条就是用户要的"成功使用 3 次截"的**单场版本**
    expect(stats.skillInterrupts['jie']).toBe(interrupts.length);
  });

  it('打断被霸体挡下时**没有** `interruptSuccess`（所以也不会被数进去）', () => {
    // 反向验证：`interruptImmune` 与 `interruptSuccess` 是两件事。
    // 若归约把"试图打断"也算成功，"用截打断 3 次"就会被霸体刷出来。
    const base = makeGoldenEngineOptions();
    const e = new BattleEngine({
      ...base,
      combatants: [base.combatants[0]!, { ...base.combatants[1]!, behaviors: [] }],
    });
    e.tick();
    e.drainEvents();
    // Boss 起「碾压」：起手挂霸体 + 开始读条
    e.tick([{ type: 'useSkill', skillId: 'boss-heavy', atTick: e.snapshot.tick }], 'meiichiro');
    e.drainEvents();

    e.tick([{ type: 'useSkill', skillId: 'jie', atTick: e.snapshot.tick }]);
    const events = e.drainEvents();

    expect(events.some((ev) => ev.kind === 'interruptImmune')).toBe(true);
    expect(events.some((ev) => ev.kind === 'interruptSuccess')).toBe(false);
    const stats = reduceBattleStats(events, {
      actorId: 'player',
      outcome: 'victory',
      flawless: false,
    });
    expect(stats.skillInterrupts).toEqual({});
  });
});

describe('③ 为什么 `REPLAY_FORMAT_VERSION` **不用** +1（把依据钉成断言）', () => {
  /**
   * 结论：`sourceSkillId` 是**观测字段**，不动确定性语义 → 版本号保持 2。
   *
   * 判据来自 `src/core/run.ts` 的原文："改动引擎的**确定性语义**时必须 +1"。
   * 逐条核实：
   *
   *   1. **它不参与任何判定**。`core/` 里唯一会消费事件的引擎侧代码是
   *      `combat/buffHookDispatch.ts` 的 `drain`，而它只认
   *      `buffApplied` / `buffExpired` 两种 kind（下面第 1 条断言）。
   *      没有任何分支读 `interruptSuccess`，更不读它的字段。
   *   2. **事件流不进 `BattleState`**（下面第 2 条断言：`snapshot` 里没有
   *      事件字段）。所以"多一个事件字段"不可能改变下一次 tick 的输入。
   *   3. **黄金重放覆盖的事件是逐位相同的**：
   *      `tests/golden/replay.test.ts` 全绿，且 `RunOutcome` 里没有事件
   *      （它只有 status / endReason / ticks / finalRngSeed / combatants）。
   *   4. `run.ts` 自己的注释里，v1→v2 的**先例**正是"新增了第二条随机流
   *      与加权随机轮转"——那才叫确定性语义改变（同一份 seed+输入会得到
   *      完全不同的结果）。加一个只被输出侧读的字段不是那一类。
   */
  it('引擎侧唯一消费事件的代码只认 `buffApplied` / `buffExpired`（不认打断事件）', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/combat/buffHookDispatch.ts', 'utf8');
    // 只认这两种 kind
    expect(source).toContain("event.kind === 'buffApplied'");
    expect(source).toContain("event.kind === 'buffExpired'");
    // 完全不认打断事件 —— 所以给 interruptSuccess 加字段没有消费者
    expect(source).not.toContain('interruptSuccess');
  });

  it('`BattleState`（快照）里没有事件流 —— 事件是**输出**，不是状态', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/types/runtime.ts', 'utf8');
    const battleState = source.slice(source.indexOf('export interface BattleState'));
    expect(battleState).not.toContain('events');
    expect(battleState).not.toContain('EventDef');
  });

  it('版本号仍然是 2（黄金重放的断言也没动）', () => {
    expect(REPLAY_FORMAT_VERSION).toBe(2);
  });
});
