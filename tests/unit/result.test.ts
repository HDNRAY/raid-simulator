import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { ViewAdapter, DEFAULT_SLOTS } from '../../src/app/viewAdapter';
import { makeGoldenEngineOptions, planPriority, OUTPUT_PRIORITY } from '../golden/fixtures';
import type { Combatant } from '../../src/core/types';

/**
 * 结算界面（M6 的收尾）。
 *
 * 为什么用单元测试而不是截图验证：headless Chrome 在模拟输入期间
 * 会停掉 rAF（frameCount 冻结、无异常），所以"打到战斗结束再截图"
 * 在这套验证环境里不可靠。而结算逻辑本身是纯计算 ——
 * 直接构造一个已结束的战斗来验证它更精确，也更快。
 */

/** ViewAdapter 只关心技能定义（buff 定义由引擎提供）。 */
function adapter(): ViewAdapter {
  return new ViewAdapter(makeGoldenEngineOptions().skills);
}

describe('战斗结算', () => {
  it('战斗进行中没有结算信息', () => {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const view = adapter().build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 });
    expect(view.result).toBeUndefined();
    expect(view.status).toBe('running');
  });

  it('战斗结束后有结算信息，且胜负与 status 一致', () => {
    const a = adapter();
    const engine2 = new BattleEngine(makeGoldenEngineOptions());
    const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
    for (let i = 0; i < 60 * 200; i += 1) {
      if (engine2.snapshot.status !== 'running') break;
      engine2.tick(plan(engine2.snapshot.tick, engine2.snapshot));
      a.consume(engine2.drainEvents(), engine2.snapshot.tick);
    }
    const view = a.build(engine2, DEFAULT_SLOTS, { timeLimitMs: 180_000 });
    const result = view.result;
    expect(result).toBeDefined();
    if (!result) return;
    expect(result.victory).toBe(view.status === 'victory');
    expect(result.titleKey).toBe(result.victory ? 'screen.victory' : 'screen.defeat');
    expect(Number(result.seconds)).toBeGreaterThan(0);
  });

  it('累计伤害与 Boss 掉的血量一致（无护盾/治疗时）', () => {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const a = adapter();
    const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
    const cap = engine.snapshot.combatants.find((c) => c.side === 'enemy')!.caps.hp;
    for (let i = 0; i < 60 * 200; i += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick(plan(engine.snapshot.tick, engine.snapshot));
      a.consume(engine.drainEvents(), engine.snapshot.tick);
    }
    const view = a.build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 });
    const result = view.result!;
    const bossHp = engine.snapshot.combatants.find((c) => c.side === 'enemy')!.resources.hp;
    // Boss 死了 → 累计伤害至少等于它的血上限（可能略多，因为最后一击会溢出）
    expect(result.totalDamage).toBeGreaterThanOrEqual(cap - bossHp - 1);
    expect(result.totalDamage).toBeGreaterThan(0);
  });

  it('DPS 与用时/总伤害自洽', () => {
    const engine = new BattleEngine(makeGoldenEngineOptions());
    const a = adapter();
    const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' });
    for (let i = 0; i < 60 * 200; i += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick(plan(engine.snapshot.tick, engine.snapshot));
      a.consume(engine.drainEvents(), engine.snapshot.tick);
    }
    const result = a.build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 }).result!;
    const expected = Math.round(result.totalDamage / Number(result.seconds));
    expect(Math.abs(result.dps - expected)).toBeLessThanOrEqual(1);
  });

  it('超时结束的结算原因正确', () => {
    const options = makeGoldenEngineOptions(1, { timeLimitMs: 60 });
    const engine = new BattleEngine(options);
    const a = adapter();
    for (let i = 0; i < 200; i += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick();
      a.consume(engine.drainEvents(), engine.snapshot.tick);
    }
    const view = a.build(engine, DEFAULT_SLOTS, { timeLimitMs: 60 });
    expect(view.status).toBe('defeat');
    expect(view.result?.reasonKey).toBe('screen.defeatedByTimeout');
    expect(view.result?.victory).toBe(false);
  });

  it('玩家阵亡的结算原因正确', () => {
    // 给 Boss 极高伤害，让玩家必死
    const options = makeGoldenEngineOptions();
    const player = options.combatants[0]!;
    const weakPlayer: Combatant = { ...player, caps: { ...player.caps, hp: 1 }, resources: { ...player.resources, hp: 1 } };
    const engine = new BattleEngine({ ...options, combatants: [weakPlayer, options.combatants[1]!] });
    const a = adapter();
    for (let i = 0; i < 60 * 40; i += 1) {
      if (engine.snapshot.status !== 'running') break;
      engine.tick();
      a.consume(engine.drainEvents(), engine.snapshot.tick);
    }
    const view = a.build(engine, DEFAULT_SLOTS, { timeLimitMs: 180_000 });
    expect(view.status).toBe('defeat');
    expect(view.result?.reasonKey).toBe('screen.defeatedByDeath');
  });
});
