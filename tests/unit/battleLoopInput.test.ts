import { describe, expect, it } from 'vitest';
import { BattleLoop } from '../../src/app/battleLoop';
import type { InputSource } from '../../src/input/keyboard';
import type { Action } from '../../src/core/actions';
import type { EventDef } from '../../src/core/events';
import { makeGoldenEngineOptions } from '../golden/fixtures';
import { slotsFromBindings } from '../../src/app/derivedSlots';

/**
 * 一个**会同时 drain + isHeld 的假输入源**。
 *
 * ⚠️ 这正是那个 bug 的复现条件：`drain()` 报"这一 tick 按下了技能"，
 * 而 `isHeld()` 同时报"这个键还按着" —— 于是 `repeatHeld` 会在**同一份
 * tick 前状态**上再补一发 `useSkill`。真键盘与触屏都是这个形态。
 */
function heldInputSource(skillId: string): InputSource {
  const key = 'q';
  /**
   * ⚠️ 复现条件：**`drain()` 每 tick 都投递"按下"，同时 `isHeld` 一直为真**
   * —— 也就是"手指还按在按钮上"的真实形态。实测到的 Action 序列正是
   * `["hold:attack", "useSkill:attack"]`（第一个来自 `drain`，第二个来自
   * `repeatHeld` 用同一份 tick 前状态补发）。
   *
   * ⚠️ 我先后写错过两版假输入，都是**撤掉修复测试仍过**（假通过）：
   *   1. `isHeld` 永远为真、`drain` 只投一次 → 测的是"持续连发"，不是这个 bug
   *   2. `isHeld` 用计数器，被 `repeatHeld` 一次调用就消耗掉 → **从来没补发过**
   * 所以这条测试的正确性靠"**撤掉修复必须挂**"来证明（见提交说明）。
   */
  return {
    drain: (): readonly Action[] => [{ type: 'useSkill', skillId, atTick: 0 }],
    isHeld: (k: string): boolean => k === key,
    skillForKey: (k: string): string | undefined => (k === key ? skillId : undefined),
    bindings: () => [{ key, skillId }],
    setBindings: () => undefined,
    capture: () => undefined,
    dispose: () => undefined,
  };
}

function makeLoop(input: InputSource): BattleLoop {
  return new BattleLoop({
    engineOptions: makeGoldenEngineOptions(),
    bindings: [{ key: 'q', skillId: 'attack' }],
    slots: slotsFromBindings([{ key: 'q', skillId: 'attack' }]),
    translate: (key) => key,
    stopOnEnd: false,
    input,
  });
}

/**
 * ⚠️⚠️ **这不是那个 bug 的回归测试 —— 它抓不到"撤掉修复"的情况。**
 *
 * 我花了 4 轮试图构造一个"撤掉修复就会挂"的测试，全部失败：
 * `BattleLoop.step()` 是私有方法，而驱动真实引擎要跨过
 * `isUsable`（读 tick 前快照）与 `consume`（排空事件）的时序 ——
 * 我试过"isHeld 永远为真"、"isHeld 用计数器"、"drain 每 tick 投递"、
 * "窃听 drainEvents"，四种假输入源都**撤掉修复仍然通过**。
 *
 * **为什么不能就这么算数**：仓库里已经有过一次"看起来已验证、实际没修好"
 * —— 一条只断言 `input.drain()` 的测试（注释里明说"这里不驱动真实引擎"）
 * 让我以为修好了，实际没有。我不想再制造第二条。
 *
 * 所以这个文件只做一件事：**断言"两路输入合并不产生重复动作"这个不变量
 * 在当前实现下成立**。真正的证据在别处：
 *   - 调研 agent 在浏览器里 patch 真实引擎，逐 tick 采到了
 *     `["hold:attack","useSkill:attack"]` → 1 rejected[casting]（修前）
 *   - 并模拟同样的修法后验证 `skillRejected: []`（修后）
 * 要补一个真正的回归测试，需要先给 `BattleLoop` 加一个**测试用的驱动入口**
 * （例如允许注入"本 tick 的输入"并暴露 step），那是独立的一小步工作。
 */
describe('两路输入合并不产生重复动作（不变量）', () => {
  it('按住期间不出现 casting 拒绝', () => {
    const loop = makeLoop(heldInputSource('attack'));
    /**
     * 驱动几帧。`advance` 每帧会跑若干 tick —— 关键是**任何一个 tick 里
     * 都不能出现两次 attack**。
     */
    let now = 0;
    for (let i = 0; i < 6; i += 1) {
      now += 20;
      loop.frame(now);
    }
    /**
     * ⚠️ 判据不是"有没有被拒"，而是**看引擎事件里 skillRejected 的
     * `casting` 次数** —— 那正是玩家看到「攻 · 正在施放中」的来源。
     */
    const rejected = loop.engineState
      .drainEvents()
      .filter((e) => e.kind === 'skillRejected' && e.reason === 'casting');
    expect(rejected).toHaveLength(0);
  });

  it('瞬发技能一个 tick 不双扣资源', () => {
    /**
     * ⚠️ 这条比"少一句提示"更严重：重复投递对**瞬发**技能会让**两个都成功**
     * —— 实测「破」一个 tick 内出过两条 `energy:-10`、两次 `interruptSuccess`。
     * 而「破」不会产生 `casting` 拒绝，所以上一条测不出它。
     *
     * ⚠️ 为什么不能看"期末能量差"：能量每逻辑步**回满**
     * （`ENERGY_PER_LOGIC_TICK`），差值会被回复抵消。所以这里**窃听**
     * 引擎的 `drainEvents` —— 自己收走事件，`battleLoop` 拿到空数组。
     */
    const seen: { tick: number; resource: string; delta: number }[] = [];
    let ticks = 0;
    const input: InputSource = {
      drain: (): readonly Action[] =>
        ticks === 0 ? [{ type: 'useSkill', skillId: 'break', atTick: 0 }] : [],
      /** 同时报"还按着" —— 这就是触发重复的条件 */
      isHeld: (k: string): boolean => k === 'q',
      skillForKey: (k: string): string | undefined => (k === 'q' ? 'break' : undefined),
      bindings: () => [{ key: 'q', skillId: 'break' }],
      setBindings: () => undefined,
      capture: () => undefined,
      dispose: () => undefined,
    };
    const loop = new BattleLoop({
      engineOptions: makeGoldenEngineOptions(),
      bindings: [{ key: 'q', skillId: 'break' }],
      slots: slotsFromBindings([{ key: 'q', skillId: 'break' }]),
      translate: (key) => key,
      stopOnEnd: false,
      input,
    });
    const engine = loop.engineState;
    const realDrain = engine.drainEvents.bind(engine);
    engine.drainEvents = (): readonly EventDef[] => {
      for (const e of realDrain()) {
        if (e.kind === 'resourceChanged') {
          seen.push({ tick: e.tick, resource: e.resource, delta: e.delta });
        }
      }
      return [];
    };

    let now = 1000;
    for (let i = 0; i < 4; i += 1) {
      now += 200;
      loop.frame(now);
      ticks += 1;
    }

    const spent = seen.filter((e) => e.resource === 'energy' && e.delta < 0);
    /**
     * ⚠️ 判据：**同一个 tick 里不能有两次扣同一个技能的资源**。
     * 「破」的代价是 10 —— 若同 tick 投递两次就会出现两条 `-10`
     * （这正是实测到的"一次按键扣两份"）。
     */
    const perTick = new Map<number, number>();
    for (const e of spent) perTick.set(e.tick, (perTick.get(e.tick) ?? 0) + 1);
    for (const [tick, count] of perTick) {
      expect(count, `tick ${tick} 扣了 ${count} 次资源`).toBeLessThanOrEqual(1);
    }
    expect(spent.length).toBeGreaterThan(0);
  });
});
