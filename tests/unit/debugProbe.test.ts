/**
 * 战斗探针（`app/debugProbe.ts`）的**投影契约**。
 *
 * ==================================================================
 * 这条测试在守什么
 * ==================================================================
 *
 * e2e 删掉之后，`window.__raidBattle.probe()` 是"战斗里到底发生了什么"的
 * **唯一出口** —— 所有验证都读它。所以它自己的读数必须是**活读数**：
 * 一个原样透出引擎内部字段（而不是"当前值"）的字段会让人对着正确的引擎
 * 得出错误的结论。
 *
 * 实测发生过：`playerCooldowns` 原先透出引擎里的绝对 `readyAt` tick，
 * 一次施放之后那个数字就**不再变化**，而 `tick` 在涨 —— 拿它写战斗策略的
 * agent 因此以为"冷却没有在走"。所以这里钉住**"推进 N tick 后冷却读数
 * 恰好小 N"**：老实现下这个差是 0，测试会红。
 *
 * ⚠️ 另外两条同样是"读数可信"的前提：
 *   - 探针**只读**（不推进 tick、不改变引擎状态、不消费事件）
 *   - 渲染视图来源的字段在 `act()` 之后是**新视图**，不是上一帧的
 *
 * 判据与 `debugProbe.ts` 文件头那张"来源 / 刷新时机"表同源。
 */

import { describe, expect, it } from 'vitest';
import { BattleLoop } from '../../src/app/battleLoop';
import { buildProbe, emptyProbe } from '../../src/app/debugProbe';
import type { InputSource } from '../../src/input/keyboard';
import type { Action } from '../../src/core/actions';
import { FIXED_SEED, makeGoldenEngineOptions } from '../golden/fixtures';
import { slotsFromBindings } from '../../src/app/derivedSlots';

/**
 * 什么都不按的输入源：注入的动作与它无关，避免真实按键干扰断言。
 *
 * ⚠️ 与 `battleLoopInject.test.ts` 的同名工具同源（测试之间不互相 import，
 * 所以各留一份；形状由 `InputSource` 约束，漂了会编译不过）。
 */
function idleInput(): InputSource {
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

/** 走 `debugApiSetup` 里 `probe` 的**同一条**取数路径（活引擎 + 当前视图）。 */
function probeOf(loop: BattleLoop) {
  return buildProbe(loop.engineState, loop.snapshot, 0, []);
}

/**
 * 推进 N 个逻辑 tick。
 *
 * ⚠️ 用 `injectActions` 而不是直接戳引擎 —— 这是调试脚本 `act()` 的**唯一**
 * 落点，测试要覆盖的就是它。`attack` 的代价与冷却都是 0，重复注入会被门禁
 * 拒绝但**照样推进 tick**，所以拿它当"空转"。
 */
function advance(loop: BattleLoop, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    loop.injectActions([
      { type: 'useSkill', skillId: 'attack', atTick: loop.engineState.snapshot.tick },
    ]);
  }
}

describe('buildProbe：读的是活状态', () => {
  it('冷却读数是剩余 tick，推进 N tick 后恰好小 N（不是原地不动的 readyAt）', () => {
    const loop = makeLoop();
    /** 「避」是林晚风唯一带冷却的技能（夹具与她 kit 同源）。 */
    loop.injectActions([{ type: 'useSkill', skillId: 'dodge', atTick: 0 }]);

    const before = probeOf(loop).playerCooldowns['dodge'] ?? 0;
    expect(before).toBeGreaterThan(0);

    advance(loop, 30);

    const after = probeOf(loop).playerCooldowns['dodge'] ?? 0;
    /**
     * ⚠️ 老实现原样透出 `readyAt`：`before - after` 是 **0** → 这一条会红。
     * 这正是"读旧值"的形状（值不动、而 tick 在涨）。
     */
    expect(before - after).toBe(30);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it('冷却走完归 0（不是负数），读数与当前 tick 同源', () => {
    const loop = makeLoop();
    loop.injectActions([{ type: 'useSkill', skillId: 'dodge', atTick: 0 }]);
    expect(probeOf(loop).playerCooldowns['dodge'] ?? 0).toBeGreaterThan(0);

    /** 推进超过冷却全长（夹具里「避」是 1000ms ≈ 60 tick）。 */
    advance(loop, 80);

    expect(probeOf(loop).playerCooldowns['dodge']).toBe(0);
    expect(probeOf(loop).tick).toBeGreaterThanOrEqual(80);
  });

  it('playerHpCap 是基线（整场不变），playerHp 是活读数', () => {
    const loop = makeLoop();
    const first = probeOf(loop);
    expect(first.playerHpCap).toBeGreaterThan(0);

    advance(loop, 150);

    const later = probeOf(loop);
    /** 基线：上限不变。 */
    expect(later.playerHpCap).toBe(first.playerHpCap);
    /** 活：Boss 打过来了（固定种子下是确定的）。 */
    expect(later.playerHp).toBeLessThan(first.playerHp);
  });

  it('seed 是基线读数、且就是夹具写进去的那个种子（B 的验收要用它）', () => {
    /**
     * ⚠️ 这条守的是"B（战斗种子从 run seed 派生）的验收**读得到种子**"。
     * 只读 `tick` / `hp` 证明不了两次运行是不是同一个种子（时钟兜底那条路
     * 也可能恰好同结果），而这个字段正是"是哪一支"的直接证据。
     */
    const loop = makeLoop();
    const first = probeOf(loop);
    expect(first.seed).toBe(FIXED_SEED);

    advance(loop, 30);

    /** 基线：整场不变（不是"当前 rng 状态"那种会随 tick 变的数）。 */
    expect(probeOf(loop).seed).toBe(FIXED_SEED);
  });

  it('渲染视图来源的字段在 act() 之后是新视图，不是上一帧的旧视图', () => {
    const loop = makeLoop();
    /**
     * ⚠️ 先**逼出一次视图构建**（缓存住），再让 `act()` 推进出飘字：
     * 若 `injectActions` 不作废缓存，下面读到的就是这一份 0 飘字的旧视图。
     */
    expect(loop.snapshot.floatingText).toHaveLength(0);

    advance(loop, 150);

    const now = probeOf(loop);
    expect(now.floatingCount).toBeGreaterThan(0);
    /** 读数必须等于**当前**视图，而不是缓存下来的那一帧。 */
    expect(now.floatingCount).toBe(loop.snapshot.floatingText.length);
  });
});

describe('buildProbe：只读（不推进 tick / 不改引擎 / 不消费事件）', () => {
  it('连读两次，引擎状态与事件消费者都不动', () => {
    const loop = makeLoop();
    loop.injectActions([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);

    const engineBefore = JSON.stringify(loop.engineState.snapshot);
    const eventsBefore = loop.battleEvents.length;
    const logBefore = loop.logEntries.length;
    /** 有事件才证明"没被探针消费掉"。 */
    expect(eventsBefore).toBeGreaterThan(0);

    const first = probeOf(loop);
    const second = probeOf(loop);

    expect(JSON.stringify(loop.engineState.snapshot)).toBe(engineBefore);
    expect(loop.battleEvents.length).toBe(eventsBefore);
    expect(loop.logEntries.length).toBe(logBefore);
    expect(second).toEqual(first);
  });
});

describe('emptyProbe：备战阶段（还没有战斗）', () => {
  it('给一份合法的零值快照，并用 -1 表示"没有这个值"', () => {
    const probe = emptyProbe(7, ['boom']);
    expect(probe).toEqual({
      seed: -1,
      tick: 0,
      status: 'idle',
      playerHp: -1,
      playerHpCap: -1,
      playerDouqi: -1,
      playerCooldowns: {},
      playerCasts: -1,
      bossHp: -1,
      bossHpCap: -1,
      bossCasts: -1,
      skillCount: 0,
      floatingCount: 0,
      frameCount: 7,
      errors: ['boom'],
    });
  });
});
