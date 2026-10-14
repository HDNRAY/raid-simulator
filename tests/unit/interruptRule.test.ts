import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { BOSS_HEAVY_ARMOR } from '../../src/data/bossPride';
import { logicMs } from '../../src/core/loopConstants';
import type { Combatant, SkillDef, StatKey } from '../../src/core/types';
import { makeCombatant, makeSkillDef } from './helpers';

/**
 * **打断规则：长读条 / 引导窗口 一律可打断 —— 除非目标处于「霸体」。**
 *
 * 用户原话（2026-10-14）：
 *
 * > 引导下技能 如果不是霸体 也是可以被打断的，后期可能根据 顺位加霸体
 *
 * ⚠️ **先说清今天的"引导"是什么**：`ChannelDef`（`durationMs` /
 * `tickIntervalMs`）**在战斗引擎里零消费者** —— `grep channel` 在
 * `core/combat/` 里一个分支都没有。所以"引导窗口"今天**就是一条长读条**
 * （「缚」= 2 秒读条，命中放在 `at: castTime`），而长读条**本来就**
 * 可打断、霸体**本来就**挡得住。
 *
 * ⇒ 所以这一组**不是新机制**，而是把那条规则**钉成契约**：以后谁给
 * "引导"加真正的实现（逐段结算那种），必须**保持**这两条性质。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

/** 一条"长读条"技能（= 今天的引导窗口：2 秒，走完才结算）。 */
function longCast(): SkillDef {
  return makeSkillDef({
    id: 'test-long-cast',
    nameKey: 'skill.attack.name',
    castTime: logicMs(20),
    interruptible: true,
    hits: [
      {
        at: logicMs(20),
        effects: [{ kind: 'damage', damage: { base: 1, canCrit: false, countsAsHit: true } }],
      },
    ],
  });
}

/** 打断技（凯丽「截」的骨架：一条 `interrupt` 效果）。 */
function kick(): SkillDef {
  return makeSkillDef({
    id: 'test-kick',
    nameKey: 'skill.attack.name',
    castTime: 0,
    hits: [{ at: 0, effects: [{ kind: 'interrupt' }] }],
  });
}

interface Harness {
  readonly engine: BattleEngine;
  readonly kindsOf: () => readonly string[];
  readonly bossCasting: () => boolean;
}

function harness(args: { readonly bossBuffs?: readonly (typeof BOSS_HEAVY_ARMOR)[] } = {}): Harness {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS, longCast(), kick()], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const bare = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 500, energy: 0, douqi: 0 },
    resources: { hp: 500, energy: 0, douqi: 0 },
  });
  const boss: Combatant = {
    ...bare,
    buffs: (args.bossBuffs ?? []).reduce(
      (c, def) => ({ ...c, buffs: applyBuff(c, def, 'boss', 0).buffs }),
      bare,
    ).buffs,
  };
  const engine = new BattleEngine({
    combatants: [
      makeCombatant({
        id: 'player',
        side: 'ally',
        caps: { hp: 200, energy: 200, douqi: 0 },
        resources: { hp: 200, energy: 200, douqi: 0 },
      }),
      boss,
    ],
    seed: 11,
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
  engine.drainEvents();

  return {
    engine,
    kindsOf: () => engine.drainEvents().map((e) => e.kind),
    bossCasting: () =>
      (engine.snapshot.combatants.find((c) => c.id === 'boss')?.casts.length ?? 0) > 0,
  };
}

describe('打断规则：长读条 / 引导窗口 可打断，**除非霸体**', () => {
  it('① **没有霸体** → 打断成功（发 `castInterrupted` + `interruptSuccess`，而且读条真的没了）', () => {
    const h = harness();
    /** Boss 起手那条长读条。 */
    h.engine.tick([{ type: 'useSkill', skillId: 'test-long-cast', atTick: 0 }], 'boss');
    h.engine.drainEvents();
    expect(h.bossCasting(), '先确认它真的在读条').toBe(true);

    /** 读条中途挨一记打断。 */
    for (let i = 0; i < 5; i += 1) h.engine.tick([]);
    h.engine.tick([{ type: 'useSkill', skillId: 'test-kick', atTick: h.engine.snapshot.tick }], 'player');
    const kinds = h.kindsOf();

    expect(kinds, '应当发中断事件').toContain('castInterrupted');
    expect(kinds, '应当发打断成功事件').toContain('interruptSuccess');
    expect(h.bossCasting(), '读条应该被清掉').toBe(false);
  });

  it('② **有霸体** → 打不断（发 `interruptImmune`，读条**还在**）', () => {
    const h = harness({ bossBuffs: [BOSS_HEAVY_ARMOR] });
    h.engine.tick([{ type: 'useSkill', skillId: 'test-long-cast', atTick: 0 }], 'boss');
    h.engine.drainEvents();
    expect(h.bossCasting(), '先确认它真的在读条').toBe(true);

    for (let i = 0; i < 5; i += 1) h.engine.tick([]);
    h.engine.tick([{ type: 'useSkill', skillId: 'test-kick', atTick: h.engine.snapshot.tick }], 'player');
    const kinds = h.kindsOf();

    expect(kinds, '应当发"霸体挡住了"').toContain('interruptImmune');
    expect(kinds, '不该发打断成功').not.toContain('interruptSuccess');
    expect(h.bossCasting(), '霸体在读条应当还在').toBe(true);
  });

  it('⚠️ 「缚」就是今天"引导"的形状：**一条长读条**且**可打断**', () => {
    /**
     * 判据从内容取（不写死秒数）：
     *   - 它的可打断标记是 `true`
     *   - 而且它**没有** `channel` 之外的第二种表达 —— 它是读条，不是新机制
     * ⚠️ 所以"引导不可打断"这种说法今天**不成立**：只要没有霸体就能断。
     */
    const bind = ALL_SKILLS.find((s) => s.id === 'lust-bind');
    expect(bind, '「缚」要在技能表里').toBeDefined();
    expect(bind?.kind).toBe('activeSkill');
    if (bind?.kind !== 'activeSkill') throw new Error('绑不是主动技能');
    expect(bind.interruptible, '「缚」必须可打断').toBe(true);
    /**
     * ⚠️ 它**没有 `hits`**（`hits: []` 是有意的：这一招只有荆棘、没有伤害）——
     * 而**读条照走**（`castStarted` / 读条条 / 可打断），那正是玩家看到的东西。
     * 所以"引导窗口"在引擎里就**只是那条读条**，别的什么都没有。
     */
    expect(bind.hits, '「缚」没有命中段（只有荆棘）').toEqual([]);
    expect(bind.castTime, '它的"引导时长"就是读条时长').toBeGreaterThan(0);
    /** 荆棘挂在 `castStart`（读条一开始就生效，不是命中那一刻）。 */
    expect(bind.abilities[0]?.kind).toBe('grant');
    expect(bind.abilities[0]?.kind === 'grant' ? bind.abilities[0].on : undefined).toBe('castStart');
  });
});
