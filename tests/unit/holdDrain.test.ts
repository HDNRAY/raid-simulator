import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { holdDrainPerSecond } from '../../src/core/combat/holds';
import { ENERGY_PER_LOGIC_TICK, GUARD_HOLD_DRAIN_PER_SECOND } from '../../src/data/balance';
import {
  LOGIC_TICKS_PER_SECOND,
  TICKS_PER_LOGIC_TICK,
  TICKS_PER_SECOND,
} from '../../src/core/loopConstants';
import { GUARD } from '../../src/data/content';
import { DEFAULT_SLOTS, ViewAdapter } from '../../src/app/viewAdapter';
import { makeGoldenEngineOptions } from '../golden/fixtures';
import type { EventDef } from '../../src/core/types';

/**
 * 「按住」的**代价结算**（`holdDrain`）与它的**显示口径**。
 *
 * ==================================================================
 * ⚠️ 核心口径：按住消耗必须**高于回炁速度**（10 炁/秒）
 * ==================================================================
 *
 * 炁每个逻辑步自然回 1 点（`ENERGY_PER_LOGIC_TICK`）⇒ **10 炁/秒**。
 * 于是"按住「卸」"的**净**收支是 `GUARD_HOLD_DRAIN_PER_SECOND − 10`：
 *
 *   旧值 **3** → 净 **+7 炁/秒**：按住**免费，而且还在回炁** ✗
 *                （玩家最优解是一直按着，这条杠杆方向是反的）
 *   现值 **15** → 净 **−5 炁/秒**：按住终于有代价 ✓
 *
 * 本文件把"净 = 5"钉成断言：以后谁把它调回 ≤ 10，这条会红。
 *
 * ==================================================================
 * 这个文件防的是什么（历史：10 倍偏差）
 * ==================================================================
 *
 * 「卸」的代价曾经有两个各写各的口径：
 *
 *   显示：设置页把 `holdDrain.perLogicTick`（**每逻辑步**）直接当成
 *         "每秒"插进文案 → 玩家看到 "3 炁/秒"；
 *   实现：引擎每逻辑步真扣 3 点 → 实际 **30 炁/秒**。
 *
 * 于是设置页"看起来是对的"（3 就是那个数），而手感差了 10 倍。
 * 现在两边同源：引擎按 `perLogicTick` 扣，显示用
 * `core/combat/holds.ts` 的 `holdDrainPerSecond()` 乘回来 ——
 * 本文件把"显示的数 == 引擎一秒实扣的数"钉死。
 *
 * ==================================================================
 * ⚠️ 为什么 1.5 这种小数必须走欠账累加器
 * ==================================================================
 *
 * `changeResource` 结算是 `Math.round(before + delta)`：整数 `before`
 * 减 1.5 落在 `.5` 上，会被推回**只扣 1 点**（每步静默少扣 0.5，
 * 实际变成 10 炁/秒而不是 15）。所以引擎在 `activeHold.drainDebt` 上记
 * 1/1000 点的**整数欠账**，攒够 1 点才真扣 ——
 * "连续按住 1 秒 = 恰好 15 炁"，而每一步都参与结算（不是脉冲）。
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
  options: ReturnType<typeof makeGoldenEngineOptions> = makeGoldenEngineOptions(),
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

/**
 * 从 `start` 点炁开始按住「卸」`ticks` 个物理 tick 后的**剩余炁**。
 *
 * 与 `energyDrainedByHolding` 相反：这条**要**把自然回复算进去 ——
 * 净消耗 = 消耗 − 回复，只有看最终余额才测得出"净"。
 * `start` 刻意低于上限（默认 50），否则回复会被上限吃掉、净消耗看起来更大。
 */
function energyAfterHolding(ticks: number, start = 50): number {
  const options = makeGoldenEngineOptions();
  const playable = options.combatants[0]!;
  const engine = new BattleEngine({
    ...options,
    combatants: [
      { ...playable, resources: { ...playable.resources, energy: start } },
      options.combatants[1]!,
    ],
  });
  engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
  for (let t = 1; t < ticks; t += 1) engine.tick();
  return engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.energy;
}

/** 「卸」的按住代价（类型守卫，避免非空断言）。 */
function guardDrain(): { readonly resource: string; readonly perLogicTick: number } {
  const drain = GUARD.holdDrain;
  if (drain === undefined) throw new Error('「卸」必须带 holdDrain（它的 cost 是空的）');
  return drain;
}

/**
 * 标准夹具，但**清空 Boss 的行为**。
 *
 * ⚠️ 为什么"炁耗尽"那条必须用它：按住耗干要 **20 秒**，而黄金夹具的
 * 傲慢在这段时间里能把只会站桩按「卸」的玩家**打死**。战斗一结束
 * （`status !== 'running'`），`tick()` 直接返回 —— 按住状态被冻结在
 * 死前那一步，看起来像"没松开"，其实是**测试场景被 Boss 改写了**。
 * 这条测试要的是"资源耗尽"这一条路，不是"Boss 够不够狠"，所以把
 * Boss 的行为拿掉（它仍然是一场合法的战斗，只是不还手）。
 */
function quietEngineOptions(): ReturnType<typeof makeGoldenEngineOptions> {
  const options = makeGoldenEngineOptions();
  return {
    ...options,
    combatants: [options.combatants[0]!, { ...options.combatants[1]!, behaviors: [] }],
  };
}

describe('按住「卸」：每逻辑步记欠账，攒够 1 点才扣', () => {
  it('连续按住 1 秒 = **恰好** 15 炁（不是"扣了"，是精确等于）', () => {
    expect(energyDrainedByHolding(TICKS_PER_SECOND)).toBe(GUARD_HOLD_DRAIN_PER_SECOND);
    expect(GUARD_HOLD_DRAIN_PER_SECOND).toBe(15);
  });

  it('连续按住 2 秒 = 30 炁（跨秒不漂）', () => {
    expect(energyDrainedByHolding(2 * TICKS_PER_SECOND)).toBe(2 * GUARD_HOLD_DRAIN_PER_SECOND);
  });

  /**
   * ⚠️ 分步验证 + **舍入方向**：欠账是"攒够整点才扣"，所以
   * `0.5 秒 = 7.5 炁` 实际扣 **7**（向下取整，`floor`），
   * 那 0.5 点留在欠账里、下一步继续攒 —— 不是"四舍五入成 8"。
   *
   * 1.5/步 的累计序列：1.5 → 3 → 4.5 → 6 → 7.5 → 9 → 10.5 → 12 → 13.5 → 15，
   * 逐项 floor 之后是 1 → 3 → 4 → 6 → 7 → 9 → 10 → 12 → 13 → 15。
   */
  it('分步：1.5/步 不会被 `Math.round` 每步吃掉（舍入方向 = 向下取整）', () => {
    const afterSteps = (steps: number): number =>
      energyDrainedByHolding(steps * TICKS_PER_LOGIC_TICK);
    expect(afterSteps(1)).toBe(1); // 欠 1.5 → 扣 1，余 0.5
    expect(afterSteps(2)).toBe(3); // 累计 3.0
    expect(afterSteps(3)).toBe(4); // 累计 4.5 → floor 4
    expect(afterSteps(4)).toBe(6); // 累计 6.0
    expect(afterSteps(5)).toBe(7); // 累计 7.5 → floor 7
    expect(afterSteps(6)).toBe(9); // 累计 9.0
    expect(afterSteps(7)).toBe(10); // 累计 10.5
    expect(afterSteps(10)).toBe(15); // 累计 15.0，余 0
  });

  it('欠账随按住清零：两段各 0.5 秒只扣 14（每段按住各向下取整）', () => {
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
    drainHold(TICKS_PER_SECOND / 2 - 1); // 第一段：5 个逻辑步 → 7 点
    engine.tick([{ type: 'releaseSkill', skillId: 'guard', atTick: 0 }]);
    collectDrain(engine.drainEvents(), total);
    engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
    collectDrain(engine.drainEvents(), total);
    drainHold(TICKS_PER_SECOND / 2); // 第二段：5 个逻辑步 → 7 点
    expect(total.total).toBe(14);
  });
});

describe('⚠️ 新口径核心：「卸」的净消耗必须为正（高于回炁速度）', () => {
  it('净 = 15 − 10 = **5 炁/秒**（谁把它调回 ≤ 10，这条会红）', () => {
    const regenPerSecond = ENERGY_PER_LOGIC_TICK * LOGIC_TICKS_PER_SECOND;
    expect(regenPerSecond, '炁的自然回复速度').toBe(10);
    expect(
      GUARD_HOLD_DRAIN_PER_SECOND,
      '按住消耗必须严格高于回炁速度，否则按住免费还回炁',
    ).toBeGreaterThan(regenPerSecond);
    expect(GUARD_HOLD_DRAIN_PER_SECOND - regenPerSecond).toBe(5);
  });

  it('实测：从非满炁按住 1 秒，净掉 **5 点**（回复 10、消耗 15）', () => {
    const start = 50;
    const net = start - energyAfterHolding(TICKS_PER_SECOND, start);
    expect(net).toBe(
      GUARD_HOLD_DRAIN_PER_SECOND - ENERGY_PER_LOGIC_TICK * LOGIC_TICKS_PER_SECOND,
    );
    expect(net).toBe(5);
  });
});

describe('按住「卸」：资源不足则自动松开', () => {
  /**
   * ⚠️ 现在用**真实的炁**构造 —— 15 > 10（净 −5/秒）之后"按住把炁耗干"
   * 才**真的可达**：满炁 100 撑 `100 / 5 = 20 秒 = 200 个逻辑步`。
   *
   * 旧值 3 炁/秒（净 **+7**）时这里**永远耗不干**炁，所以上一版只好换成
   * 一个不回复的资源（`douqi`）去伪造那个分支 —— 那是被数值逼出来的
   * 假场景。现在这条测试和真实机制一致，并且顺便证明
   * "炁耗尽 → 自动松开"是可达的。
   */
  it('炁真的会被按住耗干 → 自动松开 + 报 `cost`', () => {
    const engine = new BattleEngine(quietEngineOptions());
    engine.tick([{ type: 'hold', skillId: 'guard', atTick: 0 }]);
    engine.drainEvents();
    const seen: EventDef[] = [];
    /**
     * 跑到第 200 个逻辑步（= 1200 tick）：那一步回炁后只剩 1 点，
     * 而欠账攒够了 2 点 → 付不出 → 自动松开。
     */
    for (let t = 1; t < 200 * TICKS_PER_LOGIC_TICK; t += 1) {
      engine.tick();
      seen.push(...engine.drainEvents());
    }
    /** ⚠️ 先确认战斗还在进行 —— 否则"没松开"可能只是战斗早就结束了。 */
    expect(engine.snapshot.status, '战斗必须仍在进行').toBe('running');
    const after = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    expect(after.activeHold, '炁耗尽后必须自动松开').toBeUndefined();
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
    expect(shown).toBe(15);
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
