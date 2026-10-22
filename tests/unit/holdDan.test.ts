import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { makeBoss, makePlayer } from '../../src/data/units';
import { TICKS_PER_SECOND } from '../../src/core/loopConstants';
import type { Combatant, EventDef, StatKey } from '../../src/core/types';

/**
 * **按住「弹」必须真的扣炁**（2026-10-22 用户线上实测的 bug）。
 *
 * 用户原话：
 * > 按住「弹」，**炁没有减少**
 *
 * ==================================================================
 * 根因（两处叠在一起）
 * ==================================================================
 *
 * 1. `startHold` 用"**身上有没有它授予的 buff**"判断"施放是否成功" ——
 *    而技能自带的 `abilities` 要到同一 tick 的**后段**才落地：
 *    在这一步查 buff 必然查不到 ⇒ 直接 `return` ⇒ `activeHold` 从未写下
 *    ⇒ `tickHolds` 没有可扣的东西 ⇒ 按住跟点一下没区别（而且**静默**）。
 * 2. 同一处还会把"此刻读到的那份 combatant"整对象写回：
 *    那时 buff 还没挂上 ⇒ 写回**抹掉**了随后挂上的节奏 buff
 *    ⇒ 「弹」连伤害都没了。
 *
 * ==================================================================
 * 修法（两处）
 * ==================================================================
 *
 * - `startHold` **只记一个"按住请求"**（`requestHold`），判据改成
 *   "这一发有没有 `skillRejected`"（拒绝事件在门禁处同步发出 ✓）；
 * - `tickHolds`（upkeep 阶段，状态已稳定）把请求**提升**成 `activeHold`
 *   ⇒ 既不会抹掉 buff，也不会漏掉按住；
 * - 顺带修掉 `tick()` 里写死的 `actorId ?? 'player'`：出战单位的 id 是
 *   **角色 id**（`makePlayer('daixuan')` ⇒ `'daixuan'`），写死 `'player'`
 *   会让黛玄的写入落到一个不存在的 id 上（`current()` 退化到临时副本）。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

/** 一局：黛玄 vs 不还手的暴怒（它的被动 buff 与「弹」无关）。 */
function battle(): BattleEngine {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const boss0 = makeBoss('wrath');
  const engine = new BattleEngine({
    combatants: [makePlayer('daixuan'), { ...boss0, behaviors: [] }],
    seed: 20261022,
    bossId: 'wrath',
    timeLimitMs: 600_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['daixuan', {}],
      ['wrath', {}],
    ]),
    passiveModifiers: new Map(),
  });
  engine.drainEvents();
  return engine;
}

function allyOf(engine: BattleEngine): Combatant {
  const ally = engine.snapshot.combatants.find((c) => c.side === 'ally');
  if (ally === undefined) throw new Error('没有我方单位');
  return ally;
}

/** 把一批事件里"被扣掉的炁"累加进来（自然回复是正数，不会混进来）。 */
function collectEnergySpent(events: readonly EventDef[]): number {
  let spent = 0;
  for (const event of events) {
    if (event.kind === 'resourceChanged' && event.resource === 'energy' && event.delta < 0) {
      spent += -event.delta;
    }
  }
  return spent;
}

/** 按住 `skillId` 跑 `ticks` 个物理 tick，返回这段里扣掉的炁。 */
function holdAndSpend(engine: BattleEngine, skillId: string, ticks: number): number {
  engine.tick([{ type: 'hold', skillId, atTick: 0 }]);
  let spent = collectEnergySpent(engine.drainEvents());
  for (let t = 1; t < ticks; t += 1) {
    engine.tick();
    spent += collectEnergySpent(engine.drainEvents());
  }
  return spent;
}

describe('按住「弹」：炁必须真的下降（回归：2026-10-22"炁没减少"）', () => {
  it('按住 1 秒 ⇒ 扣掉的炁 > 0（不是"点了没反应"）', () => {
    const engine = battle();
    const spent = holdAndSpend(engine, 'dan', TICKS_PER_SECOND);
    expect(spent).toBeGreaterThan(0);
  });

  it('按住 2 秒扣的炁 ≈ 2 × 1 秒（持续扣，不是只扣一下）', () => {
    const one = holdAndSpend(battle(), 'dan', TICKS_PER_SECOND);
    const two = holdAndSpend(battle(), 'dan', 2 * TICKS_PER_SECOND);
    /** 允许 1 点误差：欠账累加器按整点结算，边界那一步可能差一次。 */
    expect(Math.abs(two - 2 * one)).toBeLessThanOrEqual(2);
  });

  /**
   * ⚠️ 这条是"另一处根因"的守卫：修 `activeHold` 时曾经把节奏 buff
   * **抹掉**（按住有炁开销、但打不到人 ✗）。所以这里同时钉住"有伤害"。
   */
  it('按住期间「弹」的节奏 buff 仍在 ⇒ 真的在打人', () => {
    const engine = battle();
    const before = engine.snapshot.combatants.find((c) => c.side === 'enemy')?.resources.hp ?? 0;
    engine.tick([{ type: 'hold', skillId: 'dan', atTick: 0 }]);
    engine.drainEvents();
    for (let t = 1; t < 2 * TICKS_PER_SECOND; t += 1) {
      engine.tick();
      engine.drainEvents();
    }
    const after = engine.snapshot.combatants.find((c) => c.side === 'enemy')?.resources.hp ?? 0;
    expect(after).toBeLessThan(before);
    expect(allyOf(engine).buffs.some((b) => b.defId === 'daixuan-tan-rhythm')).toBe(true);
  });

  it('松开之后不再扣炁', () => {
    const engine = battle();
    holdAndSpend(engine, 'dan', TICKS_PER_SECOND / 2);
    engine.tick([{ type: 'releaseSkill', skillId: 'dan', atTick: 0 }]);
    let spent = collectEnergySpent(engine.drainEvents());
    for (let t = 0; t < TICKS_PER_SECOND; t += 1) {
      engine.tick();
      spent += collectEnergySpent(engine.drainEvents());
    }
    expect(spent).toBe(0);
    /** 松开也把节奏 buff 摘掉（否则松手后还在打人 ✗）。 */
    expect(allyOf(engine).buffs.some((b) => b.defId === 'daixuan-tan-rhythm')).toBe(false);
  });
});
