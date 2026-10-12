import { describe, expect, it } from 'vitest';
import { BattleEngine, type CreateBattleOptions } from '../../src/core/combat/battleState';
import { holdDrainPerSecond } from '../../src/core/combat/holds';
import { GUARD_HOLD_DRAIN_PER_SECOND } from '../../src/data/balance';
import { LOGIC_TICKS_PER_SECOND, TICKS_PER_LOGIC_TICK, TICKS_PER_SECOND } from '../../src/core/loopConstants';
import { GUARD } from '../../src/data/content';
import { DEFAULT_SLOTS, ViewAdapter } from '../../src/app/viewAdapter';
import { makeGoldenEngineOptions } from '../golden/fixtures';
import type { EventDef } from '../../src/core/types';

/**
 * 「按住」的**代价结算**（`holdDrain`）与它的**显示口径**。
 *
 * ==================================================================
 * 这个文件防的是什么（这一次踩的坑）
 * ==================================================================
 *
 * 「卸」的代价曾经有两个各写各的口径：
 *
 *   显示：设置页把 `holdDrain.perLogicTick`（**每逻辑步**）直接当成
 *         "每秒"插进文案 → 玩家看到 "3 炁/秒"；
 *   实现：引擎每逻辑步真扣 3 点 → 实际 **30 炁/秒**。
 *
 * 于是设置页"看起来是对的"（3 就是用户要的 3），而手感差了 10 倍。
 * 现在两边同源：引擎按 `perLogicTick` 扣，显示用
 * `core/combat/holds.ts` 的 `holdDrainPerSecond()` 乘回来 ——
 * 本文件把"显示的数 == 引擎一秒实扣的数"钉死。
 *
 * ==================================================================
 * ⚠️ 为什么不能直接把 0.3 交给 `changeResource`
 * ==================================================================
 *
 * `changeResource` 结算是 `Math.round(before + delta)`：每步扣 0.3 会被
 * 舍回原值，**一点炁都不扣**（一次静默不生效）。所以引擎在
 * `activeHold.drainDebt` 上记整数欠账，攒够 1 点才真扣 ——
 * "连续按住 1 秒 = 恰好 3 炁"，而每一步都参与结算（不是脉冲）。
 *
 * 从 `tests/golden/encounter.test.ts` 搬来：那边是"一整场遭遇战"的集成
 * 测试，而这里是**一个机制 + 它的显示口径**，混在一起会让两边都读不清
 * （那个文件也已经贴到 700 行上限）。
 */

/** 从事件流里把"被扣掉的炁"加起来。 */
function collectDrain(events: readonly EventDef[], into: { total: number }): void {
  for (const event of events) {
    if (
      event.kind === 'resourceChanged' &&
      event.resource === 'energy' &&
      event.delta < 0
    ) {
      into.total += -event.delta;
    }
  }
}

/**
 * 按住「卸」`ticks` 个物理 tick，返回这期间**实际扣掉的炁**。
 *
 * ⚠️ 用事件求和，不用"前后资源差"：炁每个逻辑步还自然回 1 点
 * （`ENERGY_PER_LOGIC_TICK`），起始又是满的 —— 相减会被回复和上限
 * 抵成 0，什么都测不出来。这场里没有别的炁支出，所以负的
 * `resourceChanged` 只可能来自按住消耗。
 */
function energyDrainedByHolding(
  ticks: number,
  options: CreateBattleOptions = makeGoldenEngineOptions(),
): number {
  const engine = new BattleEngine(options);
  const total = { total: 0 };
  engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
  collectDrain(engine.drainEvents(), total);
  for (let t = 1; t < ticks; t += 1) {
    engine.tick();
    collectDrain(engine.drainEvents(), total);
  }
  return total.total;
}

/** 「卸」的按住代价（类型守卫，避免非空断言）。 */
function guardDrain(): { readonly resource: string; readonly perLogicTick: number } {
  const drain = GUARD.holdDrain;
  if (drain === undefined) throw new Error('「卸」必须带 holdDrain（它的 cost 是空的）');
  return drain;
}

describe('按住「卸」：每逻辑步记欠账，攒够 1 点才扣', () => {
  it('连续按住 1 秒 = **恰好** 3 炁（不是"扣了"，是精确等于）', () => {
    expect(energyDrainedByHolding(TICKS_PER_SECOND)).toBe(GUARD_HOLD_DRAIN_PER_SECOND);
    expect(GUARD_HOLD_DRAIN_PER_SECOND).toBe(3);
  });

  it('连续按住 2 秒 = 6 炁（跨秒不漂）', () => {
    expect(energyDrainedByHolding(2 * TICKS_PER_SECOND)).toBe(2 * GUARD_HOLD_DRAIN_PER_SECOND);
  });

  /**
   * ⚠️ 分步验证 + **舍入方向**：欠账是"攒够整点才扣"，所以
   * `0.5 秒 = 1.5 炁` 实际扣 **1**（向下取整，`floor`），
   * 那 0.5 点留在欠账里、下一步继续攒 —— 不是"四舍五入成 2"。
   */
  it('分步：0.3/步 不会被 `Math.round` 每步吃掉（舍入方向 = 向下取整）', () => {
    const afterSteps = (steps: number): number =>
      energyDrainedByHolding(steps * TICKS_PER_LOGIC_TICK);
    expect(afterSteps(1)).toBe(0); // 欠 0.3，不够 1 点
    expect(afterSteps(3)).toBe(0); // 欠 0.9
    expect(afterSteps(4)).toBe(1); // 欠 1.2 → 扣 1，余 0.2
    expect(afterSteps(5)).toBe(1); // 累计 1.5 → 仍是 1（floor）
    expect(afterSteps(7)).toBe(2); // 累计 2.1
    expect(afterSteps(10)).toBe(3); // 累计 3.0，余 0
  });

  it('欠账随按住清零：两段各 0.5 秒只扣 2（每段按住各向下取整）', () => {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const total = { total: 0 };
    const drainHold = (ticks: number): void => {
      for (let t = 0; t < ticks; t += 1) {
        engine.tick();
        collectDrain(engine.drainEvents(), total);
      }
    };
    engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
    collectDrain(engine.drainEvents(), total);
    drainHold(TICKS_PER_SECOND / 2 - 1); // 第一段：5 个逻辑步 → 1 点
    engine.tick([{ type: 'releaseSkill', skillId: 'guard', atTick: 0 }]);
    collectDrain(engine.drainEvents(), total);
    engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
    collectDrain(engine.drainEvents(), total);
    drainHold(TICKS_PER_SECOND / 2); // 第二段：5 个逻辑步 → 1 点
    expect(total.total).toBe(2);
  });
});

describe('按住「卸」：资源不足则自动松开', () => {
  /**
   * ⚠️ 这里**换一个不自然回复的资源**（`douqi`）来测"耗尽"那条路。
   *
   * 炁每个逻辑步回 1 点，而「卸」每逻辑步只扣 0.3 —— 净 **+0.7/步**。
   * 也就是说**炁永远不会被「卸」按住耗光**（这是当前数值的一个真实结论，
   * 见 §"没搞定/可疑"）：用炁根本构造不出耗尽。
   */
  function withGuardDrain(resource: string, perLogicTick: number, start: number): CreateBattleOptions {
    const options = makeGoldenEngineOptions();
    const skills = new Map(options.skills);
    const guard = skills.get('guard');
    if (!guard) throw new Error('missing guard');
    skills.set('guard', { ...guard, holdDrain: { resource, perLogicTick } });
    const playable = options.combatants[0]!;
    return {
      ...options,
      skills,
      combatants: [
        { ...playable, resources: { ...playable.resources, [resource]: start } },
        options.combatants[1]!,
      ],
    };
  }

  it('攒够一整点却付不出 → 松开 + 报 `cost`', () => {
    // 每步欠 2 点、起始只有 5 点：第 3 步要付第 3 个 2 点时付不出。
    const engine = new BattleEngine(withGuardDrain('douqi', 2, 5));
    engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
    engine.drainEvents();
    const seen: EventDef[] = [];
    for (let t = 0; t < 12 * TICKS_PER_LOGIC_TICK; t += 1) {
      engine.tick();
      seen.push(...engine.drainEvents());
    }
    const after = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    expect(after.activeHold).toBeUndefined();
    expect(after.buffs.some((b) => b.defId === 'guard')).toBe(false);
    expect(seen.some((e) => e.kind === 'skillRejected' && e.reason === 'cost')).toBe(true);
  });
});

describe('按住代价：显示与实现同源', () => {
  it('设置页的换算 = 引擎一秒实扣的炁（同一个 `perLogicTick`）', () => {
    const shown = holdDrainPerSecond(guardDrain());
    const drained = energyDrainedByHolding(TICKS_PER_SECOND);
    expect(shown).toBe(GUARD_HOLD_DRAIN_PER_SECOND);
    expect(drained).toBe(GUARD_HOLD_DRAIN_PER_SECOND);
    expect(shown).toBe(drained);
  });

  it('换算就是"每逻辑步 × 每秒的逻辑步数"，没有第二个常数', () => {
    expect(LOGIC_TICKS_PER_SECOND).toBe(TICKS_PER_SECOND / TICKS_PER_LOGIC_TICK);
    expect(guardDrain().perLogicTick).toBe(
      GUARD_HOLD_DRAIN_PER_SECOND / LOGIC_TICKS_PER_SECOND,
    );
  });

  it('技能栏的 `/s` 代价也走同一个换算（曾经显示 3/s 而实际 30/s）', () => {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const view = new ViewAdapter(makeGoldenEngineOptions().skills).build(
      engine,
      DEFAULT_SLOTS,
      { timeLimitMs: 180_000 },
    );
    const guard = view.skills.find((s) => s.skillId === 'guard');
    expect(guard?.cost).toEqual({
      resource: 'energy',
      value: GUARD_HOLD_DRAIN_PER_SECOND,
      suffix: '/s',
    });
  });
});
