import { describe, expect, it } from 'vitest';

import { applySkillTweaks } from '../../src/data/skillTweak';
import { ALL_BUFFS, ALL_SKILLS, ALL_SKILLS as SKILLS } from '../../src/data/content';
import { QIJI_HEISHAN, QIJI_ZHAN } from '../../src/data/qiji';
import { buildPlayerKit } from '../../src/data/kit';
import { ATTACK } from '../../src/data/kits/linwanfeng';
import { PUNCH_SKILL_ID } from '../../src/data/kits/heishan';
import { makePlayer } from '../../src/data/units';
import { createRegistry } from '../../src/core/content/registry';
import { BattleEngine } from '../../src/core/combat/battleState';
import type { Combatant, SkillDef, StatKey } from '../../src/core/types';
import { makeCombatant } from './helpers';

/**
 * **两条新炁机：黑闪 / 斩法**（用户 2026-10-14 点名）。
 *
 * ⚠️ 这一组的重点是**量出真实窗口**，而不是照设计稿推 —— 设计稿里的
 * 1.15~1.25 落不在 0.1 秒刻度上，所以实际是多少**必须实测**。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
  'qiji.heiShan.name',
  'qiji.zhanFa.name',
]);

const registry = createRegistry(
  { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
  { localeKeys: i18nKeys },
);

/* ================================================================== *
 * 1. 「斩法」：改的是技能定义（一条纯函数的活）
 * ================================================================== */

describe('「斩法」：斩 30 次解锁 → 读条减半 + 伤害 +30%', () => {
  const tweaked = (): SkillDef => {
    const out = applySkillTweaks(
      { skills: new Map([[ATTACK.id, ATTACK]]), buffs: new Map() },
      [QIJI_ZHAN.skillTweak!],
    );
    const skill = out.skills.get(ATTACK.id);
    if (skill === undefined) throw new Error('斩不见了');
    return skill;
  };

  it('🎯 伤害 ×1.3（从技能里取原值，不写死数字）', () => {
    const before = ATTACK.hits[0]?.effects[0];
    const after = tweaked().hits[0]?.effects[0];
    if (before?.kind !== 'damage' || after?.kind !== 'damage') throw new Error('不是伤害效果');
    if (before.damage === undefined || after.damage === undefined) throw new Error('没有伤害');
    const base = typeof before.damage.base === 'number' ? before.damage.base : 0;
    expect(after.damage.base).toBeCloseTo(base * 1.3, 6);
  });

  it('🎯 读条变短，而且**落在 0.1 秒刻度上**（显示与实现必须同刻度）', () => {
    const after = tweaked();
    expect(after.castTime).toBeLessThan(ATTACK.castTime);
    expect(after.castTime % 100).toBe(0);
  });

  it('⚠️ 而那 50ms 的差是**刻度的代价**：500ms 的一半是 250ms，对齐到 300ms', () => {
    /**
     * 用户要"读条少一半" ⇒ 250ms；而刻度只有 0.1 秒 ⇒ 取最近的 300ms。
     * 这条**故意钉住那个已知的妥协**，免得下一个人以为算错了。
     */
    expect(ATTACK.castTime).toBe(500);
    expect(tweaked().castTime).toBe(300);
  });

  it('解锁条件是本局累计用出 30 次斩', () => {
    expect(QIJI_ZHAN.unlock).toEqual({
      kind: 'statAtLeast',
      stat: { s: 'skillUses', skillId: 'attack', scope: 'run' },
      value: 30,
    });
  });
});

/* ================================================================== *
 * 2. 「黑闪」：窗口**实测**
 * ================================================================== */

const WATCHER = QIJI_HEISHAN.passiveBuffs?.[0];
if (WATCHER === undefined) throw new Error('黑闪没有 passiveBuffs');

/** 一局：玩家带「黑闪」的常驻被动，对手是个木桩。 */
function fight(): BattleEngine {
  const kit = buildPlayerKit('player', [QIJI_HEISHAN]);
  const player = makePlayer('player', { kit });
  const boss = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 100_000, energy: 0, douqi: 0 },
    resources: { hp: 100_000, energy: 0, douqi: 0 },
  });
  return new BattleEngine({
    combatants: [player as Combatant, boss],
    seed: 5,
    bossId: 'boss',
    timeLimitMs: 600_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', {}],
      ['boss', {}],
    ]),
    passiveModifiers: new Map(),
  });
}

describe('「黑闪」：拳命中后 1.2 秒再命中 → 伤害翻倍', () => {
  /** 按一次拳并推进到**正好打完**（读条 0.3 秒 = 18 tick），返回这一拳的伤害。 */
  function punchCycle(e: BattleEngine): number {
    const hpBefore = e.snapshot.combatants.find((c) => c.id === 'boss')?.resources.hp ?? 0;
    e.tick([{ type: 'useSkill', skillId: PUNCH_SKILL_ID, atTick: e.snapshot.tick }], 'player');
    for (let i = 0; i < 18; i += 1) e.tick([]);
    e.drainEvents();
    const hpAfter = e.snapshot.combatants.find((c) => c.id === 'boss')?.resources.hp ?? 0;
    return hpBefore - hpAfter;
  }

  function wait(e: BattleEngine, ticks: number): void {
    for (let i = 0; i < ticks; i += 1) e.tick([]);
    e.drainEvents();
  }

  /**
   * **实测窗口**：两拳**命中**之间的间隔 = `18 + gap` 个 tick（每拳读条 18）。
   *
   * ⚠️ 为什么要扫描而不是照设计稿断言：设计稿写 [1.15, 1.25] 秒，
   * 而 `BuffDef.duration` 必须落在 0.1 秒刻度上 —— 真实窗口**只能实测**。
   * 返回"翻倍了的那些 gap"。
   */
  function scanDoublingGaps(from: number, to: number): number[] {
    const base = (() => {
      const e = fight();
      return punchCycle(e);
    })();
    const doubled: number[] = [];
    for (let gap = from; gap <= to; gap += 1) {
      const e = fight();
      const first = punchCycle(e);
      if (first !== base) continue;
      wait(e, gap);
      if (punchCycle(e) === base * 2) doubled.push(gap);
    }
    return doubled;
  }

  it('🎯 基准：第一拳不翻倍（它只负责挂上节拍）', () => {
    const e = fight();
    const first = punchCycle(e);
    expect(first).toBeGreaterThan(0);
    expect(e.snapshot.combatants.find((c) => c.id === 'player')?.buffs.some((b) => b.defId === 'heishan-beat')).toBe(true);
  });

  it('📊 **实测**翻倍窗口：命中间隔落在 [72, 78) tick（= 1.2 ~ 1.3 秒）', () => {
    /** 命中间隔 = `gap + 18`（两个 18-tick 的读条）⇒ gap ∈ [54, 60)。 */
    const gaps = scanDoublingGaps(40, 75);
    // eslint-disable-next-line no-console
    console.log('DBG 黑闪翻倍窗口（gap → 命中间隔 tick）:', gaps.map((g) => `${g}→${g + 18}`).join(' '));
    expect(gaps.length, '窗口不该是空的').toBeGreaterThan(0);
    /** ⚠️ 边界实测：下界 = 1.2 秒（gap 54），上界 < 1.3 秒（gap 60）。 */
    expect(Math.min(...gaps)).toBe(54);
    expect(Math.max(...gaps)).toBe(59);
  });

  it('⚠️ **太早**（早于 1.2 秒）不翻倍 —— 这是"不能狂按"那条约束', () => {
    const e = fight();
    const base = punchCycle(e);
    wait(e, 20);
    expect(punchCycle(e)).toBe(base);
  });

  it('⚠️ **太晚**（超过 1.3 秒）也不翻倍', () => {
    const e = fight();
    const base = punchCycle(e);
    wait(e, 90);
    expect(punchCycle(e)).toBe(base);
  });

  it('🎯 **可以连续**：一直按 1.2 秒的节拍 ⇒ 每一拳都翻倍', () => {
    const e = fight();
    const base = punchCycle(e);
    const hits: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      wait(e, 54);
      hits.push(punchCycle(e));
    }
    expect(hits, '三拳都该翻倍').toEqual([base * 2, base * 2, base * 2]);
  });
});

/* ================================================================== *
 * 3. 装配套路：契机真的把 buff 挂到玩家身上
 * ================================================================== */

describe('契机 → 常驻 buff 的装配（`QijiEntity.passiveBuffs`）', () => {
  it('🎯 选了黑闪 → 玩家开战时身上就有那条被动', () => {
    const kit = buildPlayerKit('player', [QIJI_HEISHAN]);
    expect(kit.passiveBuffs.map((b) => b.id)).toEqual([WATCHER.id]);

    const player = makePlayer('player', { kit });
    expect(player.buffs.map((b) => b.defId)).toEqual([WATCHER.id]);
  });

  it('⚠️ 没选任何契机 → 一条都没有（"没有炁机 = 逐字等于今天"）', () => {
    const kit = buildPlayerKit('player');
    expect(kit.passiveBuffs).toEqual([]);
    expect(makePlayer('player', { kit }).buffs).toEqual([]);
  });

  it('技能表里确实有拳（否则节拍永远不会被触发）', () => {
    expect(SKILLS.some((s) => s.id === PUNCH_SKILL_ID)).toBe(true);
  });
});
