import { describe, expect, it } from 'vitest';
import { BattleLoop } from '../../src/app/battleLoop';
import type { InputSource } from '../../src/input/keyboard';
import type { Action } from '../../src/core/actions';
import { makeGoldenEngineOptions } from '../golden/fixtures';
import { slotsFromBindings } from '../../src/app/derivedSlots';

/**
 * `BattleLoop.injectActions` 是 `window.__raidBattle.act()` 的**唯一**落点。
 *
 * ==================================================================
 * 这条测试在守什么（老写法为什么会挂）
 * ==================================================================
 *
 * `act()` 原先自己 `engineState.tick(...)` 之后再 `engineState.drainEvents()`
 * —— 那一步 drain 把**本 tick 的全部事件排空后丢掉**：引擎状态确实变了
 * （读条挂上、冷却跳），但日志 / 飘字 / 肉鸽事件流一个字都收不到。
 * 症状是"静默无效"：不报错、结果不对，验证脚本读到与渲染层对不上的读数。
 *
 * 所以断言分两层：
 *   1. **引擎状态**变了（读条挂上）—— 老写法也满足；
 *   2. **事件进了消费者**（`battleEvents` 有 `skillUsed` / `castStarted`，
 *      日志有对应的行）—— 老写法**不满足**。这一层才是回归价值。
 *
 * 判据与 `battleLoop.ts` 的 `injectActions` 文件说明同源。
 */
function idleInput(): InputSource {
  /** 什么都不按的输入源：注入的动作与它无关，避免真实按键干扰断言。 */
  return {
    drain: (): readonly Action[] => [],
    isHeld: () => false,
    skillForKey: () => undefined,
    bindings: () => [],
    setBindings: () => undefined,
    capture: () => undefined,
    dispose: () => undefined,
  };
}

function makeLoop(): BattleLoop {
  return new BattleLoop({
    engineOptions: makeGoldenEngineOptions(),
    bindings: [{ key: 'q', skillId: 'attack' }],
    slots: slotsFromBindings([{ key: 'q', skillId: 'attack' }]),
    translate: (key) => key,
    stopOnEnd: false,
    input: idleInput(),
  });
}

describe('BattleLoop.injectActions（act 的合法注入点）', () => {
  it('注入的动作推进引擎，且事件进入消费者（不再被 drain 丢掉）', () => {
    const loop = makeLoop();
    const before = loop.engineState.snapshot;
    const allyBefore = before.combatants.find((c) => c.side === 'ally');
    expect(allyBefore?.casts ?? []).toHaveLength(0);
    expect(loop.battleEvents).toHaveLength(0);

    /** 「斩」有 0.5 秒读条 —— 注入后应当**立刻**挂上读条（与按键同路）。 */
    loop.injectActions([{ type: 'useSkill', skillId: 'attack', atTick: before.tick }]);

    const after = loop.engineState.snapshot;
    const allyAfter = after.combatants.find((c) => c.side === 'ally');
    /** 1) 引擎状态确实变了。 */
    expect(allyAfter?.casts.map((c) => c.skillId)).toEqual(['attack']);

    /**
     * 2) 【关键】本 tick 的事件没有被排空丢弃 —— 这正是老 `act()` 丢的东西。
     */
    const kinds = loop.battleEvents.map((e) => e.kind);
    expect(kinds).toContain('castStarted');
    expect(kinds).toContain('skillUsed');
    /** 3) 日志消费者也看到了（「斩」→ 一条日志行）。 */
    expect(loop.logEntries.some((e) => e.key === 'log.skillUsed')).toBe(true);
  });

  it('显式执行者（给 Boss 发招）也走同一条 drain，事件不丢', () => {
    const loop = makeLoop();
    const boss = loop.engineState.snapshot.combatants.find((c) => c.side === 'enemy');
    const skillId = [...loop.engineState.skillIds].find(
      (id) => {
        const s = loop.engineState.skillOf(id);
        return s !== undefined && s.kind === 'activeSkill' && s.castTime === 0;
      },
    );
    expect(boss).toBeDefined();
    expect(skillId).toBeDefined();

    loop.injectActions([{ type: 'useSkill', skillId: skillId ?? '', atTick: 0 }], boss?.id);

    /** Boss 动了 → 它的技能事件同样进了这一场的事件流。 */
    const used = loop.battleEvents.filter((e) => e.kind === 'skillUsed');
    expect(used.length).toBeGreaterThan(0);
    expect(used[0]?.sourceId).toBe(boss?.id);
  });

  it('空数组是无害空操作（不推进 tick）', () => {
    const loop = makeLoop();
    const tick = loop.engineState.snapshot.tick;
    loop.injectActions([]);
    expect(loop.engineState.snapshot.tick).toBe(tick);
  });
});
