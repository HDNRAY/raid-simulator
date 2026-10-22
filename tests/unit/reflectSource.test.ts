import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { LogFormatter } from '../../src/app/logFormat';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { LUST_BIND_THORNS } from '../../src/data/lustBoss';
import { makeBoss, makePlayer } from '../../src/data/units';
import { applyBuff } from '../../src/core/buffs';
import { translator } from '../../src/i18n/translator';
import { TICKS_PER_SECOND } from '../../src/core/loopConstants';
import type { Combatant, StatKey } from '../../src/core/types';

/**
 * **反伤的"来源"必须是玩家读得懂的名字**（2026-10-22 用户线上实测）。
 *
 * 用户原话：
 * > log 一直显示 **8 点反伤，未知来源**
 *
 * ==================================================================
 * 为什么会"未知"
 * ==================================================================
 *
 * 反伤走 `applyDamage(..., skillId: '')` —— `''` 的语义是"**不是技能打的**"
 * （触发器 / 荆棘都一样）。日志按 `skillId` 去招式表查名字 ⇒ 查不到 ⇒
 * 兜底成 `log.unknownSource`（"未知来源"）✗。
 *
 * 玩家真正要的是"**被什么弹的**"：「缚」的荆棘（受伤的 50%）还是
 * 「污堕印记」（固定 18）。所以事件上补一个**纯观测**字段
 * `damage.reflectBuffId`，日志优先用它取 buff 名。
 *
 * ==================================================================
 * 8 点是怎么来的（对得上用户看到的那条）
 * ==================================================================
 *
 * 色欲的「缚」给 `reflectFraction: 0.5`；玩家一拳 16 点 ⇒ 反弹
 * `round(16 × 0.5) = 8` ✓ —— 正是"8 点反伤"。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

function battle(player: Combatant, bossExtraBuffs: readonly (typeof ALL_BUFFS)[number][] = []): BattleEngine {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const boss0 = makeBoss('lust');
  let boss: Combatant = { ...boss0, behaviors: [] };
  for (const def of bossExtraBuffs) {
    boss = { ...boss, buffs: applyBuff(boss, def, boss.id, 0).buffs };
  }
  const engine = new BattleEngine({
    combatants: [player, boss],
    seed: 20261022,
    bossId: 'lust',
    timeLimitMs: 600_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      [player.id, {}],
      [boss.id, {}],
    ]),
    passiveModifiers: new Map(),
  });
  engine.drainEvents();
  return engine;
}

describe('荆棘反伤：日志说得出"是被什么弹的"', () => {
  it('「缚」的荆棘：反伤事件带上 `reflectBuffId`，日志里出现荆棘的名字', () => {
    const player = makePlayer('player');
    const engine = battle(player, [LUST_BIND_THORNS]);
    /** 玩家用「斩」打它一下 —— 50% 会弹回来。 */
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    const events = [...engine.drainEvents()];
    /** 「斩」是**读条**技能 ⇒ 命中在后面的 tick 里结算，事件要跨 tick 收集。 */
    for (let t = 0; t < TICKS_PER_SECOND; t += 1) {
      engine.tick();
      events.push(...engine.drainEvents());
    }
    const reflect = events.find((e) => e.kind === 'damage' && e.reflect === true);
    expect(reflect).toBeDefined();
    if (reflect?.kind !== 'damage') throw new Error('没有反伤事件');
    expect(reflect.sourceBuffId).toBe(LUST_BIND_THORNS.id);
  });

  it('没有 buff 来源时**不写** `unknownSource`，而是"受到 N 点反伤"', () => {
    const formatter = new LogFormatter({ combatantNameKey: () => 'roster.linWanfeng.name' });
    formatter.consume([
      {
        kind: 'damage',
        tick: 1,
        sourceId: 'player',
        targetId: 'player',
        amount: 8,
        crit: false,
        absorbed: 0,
        thinned: 0,
        overkill: 0,
        skillId: '',
        reflect: true,
      },
    ]);
    const entry = formatter.all()[0];
    if (entry === undefined) throw new Error('没有日志条目');
    /** 不再走兜底 key（那是"我不知道"） */
    expect(entry.key).toBe('log.reflectShort');
    const params = entry.params ?? {};
    const text = translator.t(entry.key as never, {
      actor: translator.t(String(params['actor']) as never),
      amount: params['amount'] as number,
    });
    expect(text).not.toContain('未知');
    expect(text).toContain('8');
  });

  it('有 buff 来源时日志里是 buff 名（不是"未知来源"）', () => {
    const formatter = new LogFormatter({
      buffNameKeys: new Map([[LUST_BIND_THORNS.id, 'lust.bind.name']]),
      combatantNameKey: () => 'roster.linWanfeng.name',
    });
    formatter.consume([
      {
        kind: 'damage',
        tick: 1,
        sourceId: 'player',
        targetId: 'player',
        amount: 8,
        crit: false,
        absorbed: 0,
        thinned: 0,
        overkill: 0,
        skillId: '',
        reflect: true,
        sourceBuffId: LUST_BIND_THORNS.id,
      },
    ]);
    const entry = formatter.all()[0];
    if (entry === undefined) throw new Error('没有日志条目');
    expect(entry.key).toBe('log.reflect');
    const params = entry.params ?? {};
    /** 来源是**buff 名字的 key**（日志层不碰文案，渲染层再翻） */
    expect(params['skill']).toBe('lust.bind.name');
    const text = translator.t(entry.key as never, {
      actor: translator.t(String(params['actor']) as never),
      skill: translator.t(String(params['skill']) as never),
      amount: params['amount'] as number,
    });
    expect(text).not.toContain('未知');
    expect(text).toContain('缚');
  });
});

describe('「弹」的伤害：日志里必须点名「弹」，而且**不是反伤**', () => {
  it('按住「弹」时的节奏伤害：日志出现「弹」造成 N 点伤害（reflect=false）', () => {
    const player = makePlayer('daixuan');
    const engine = battle(player);
    /** 按住 1 秒 —— 节奏 buff 每 300ms 打一次。 */
    engine.tick([{ type: 'hold', skillId: 'dan', atTick: 0 }]);
    const events = [...engine.drainEvents()];
    for (let t = 1; t < TICKS_PER_SECOND; t += 1) {
      engine.tick();
      events.push(...engine.drainEvents());
    }
    const hits = events.filter(
      (e): e is Extract<typeof e, { kind: 'damage' }> => e.kind === 'damage' && e.amount > 0,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      /** ⚠️ 触发器产出的伤害**不是**反伤（2026-10-22 前一律标成反伤 ✗） */
      expect(hit.reflect).not.toBe(true);
      /** 来源要说得出是「弹」的节奏 buff —— 否则日志只能写"未知来源" ✗ */
      expect(hit.sourceBuffId).toBe('daixuan-tan-rhythm');
    }
  });

  it('日志渲染：点名「弹」，不含"未知来源"、不含"反伤"', () => {
    const formatter = new LogFormatter({
      buffNameKeys: new Map([['daixuan-tan-rhythm', 'skill.dan.name']]),
      combatantNameKey: (id) => (id === 'wrath' ? 'wrath.name' : 'roster.daixuan.name'),
    });
    formatter.consume([
      {
        kind: 'damage',
        tick: 1,
        sourceId: 'daixuan',
        targetId: 'wrath',
        amount: 8,
        crit: false,
        absorbed: 0,
        thinned: 0,
        overkill: 0,
        skillId: '',
        sourceBuffId: 'daixuan-tan-rhythm',
      },
    ]);
    const entry = formatter.all()[0];
    if (entry === undefined) throw new Error('没有日志条目');
    expect(entry.key).toBe('log.buffDamage');
    const params = entry.params ?? {};
    expect(params['skill']).toBe('skill.dan.name');
    const text = translator.t(entry.key as never, {
      actor: translator.t(String(params['actor']) as never),
      target: translator.t(String(params['target']) as never),
      skill: translator.t(String(params['skill']) as never),
      amount: params['amount'] as number,
    });
    expect(text).toContain('弹');
    expect(text).not.toContain('未知');
    expect(text).not.toContain('反伤');
  });
});
