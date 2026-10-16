import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { WHISPER_MEND, WHISPER_POOL } from '../../src/data/whispers';
import { WHISPER_MEND_HEAL } from '../../src/data/balance';
import { makeBoss, makePlayer } from '../../src/data/units';
import { whisperCombatants } from '../../src/app/whisperApply';
import type { Combatant, EventDef, StatKey } from '../../src/core/types';

/**
 * 「恶魔低语」·「**自愈**」读条（2026-10-16）。
 *
 * 用户原话："回血读条 这个先实现，然后我们来想二阶段的事情"。
 *
 * 这一条的全部内容就是一句：**不打断就回一截血**。所以这里钉两件事：
 *
 *   1. 它**真的会读条**（不是"挂了 buff 但引擎不认识那条技能"那种静默无效）
 *   2. 读条走完 → 回血；**被打断 → 一点血都不回**
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

/** Boss 开局不满血（不满才看得出"回了一截"）。 */
const BOSS_START_HP = 200;
/** 读条 2.0 秒 = 120 tick；这里给足余量。 */
const TICKS = 60 * 6;

interface Harness {
  readonly engine: BattleEngine;
  readonly bossHp: () => number;
  /** 跑 `ticks` 帧并收集事件。 */
  readonly run: (ticks: number) => readonly EventDef[];
  readonly interrupt: () => readonly EventDef[];
}

function harness(): Harness {
  const whisper = WHISPER_POOL.find((w) => w.id === 'mend');
  expect(whisper, '池子里该有「自愈」').toBeDefined();

  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  /**
   * ⚠️ `noAi: true`（清空 Boss 自己的行为）之后**只**挂低语那一条行为 ——
   * 否则它自己的轮转（`敛财` 每层回血、`掠夺` 打人）会把"回了一截"的读数
   * 搅浑。这样这一场里它**只会**读「自愈」。
   */
  const applied = whisperCombatants({
    player: makePlayer('kaili'),
    boss: makeBoss('greed', { noAi: true }),
    whisper,
  });
  const boss: Combatant = {
    ...applied.boss,
    resources: { ...applied.boss.resources, hp: BOSS_START_HP },
  };

  const engine = new BattleEngine({
    combatants: [applied.player, boss],
    seed: 20261016,
    bossId: 'greed',
    timeLimitMs: 600_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([['player', {}], ['greed', {}]]),
    passiveModifiers: new Map(),
  });
  engine.drainEvents();

  const run = (ticks: number): readonly EventDef[] => {
    const out: EventDef[] = [];
    for (let i = 0; i < ticks; i += 1) {
      engine.tick([]);
      out.push(...engine.drainEvents());
    }
    return out;
  };

  return {
    engine,
    bossHp: () =>
      engine.snapshot.combatants.find((c) => c.id === 'greed')?.resources.hp ?? -1,
    run,
    /** 玩家用「截」打断它（瞬时、`force: true`）。 */
    interrupt: () => {
      engine.tick(
        [{ type: 'useSkill', skillId: 'jie', atTick: engine.snapshot.tick }],
        'player',
      );
      return engine.drainEvents();
    },
  };
}

describe('「恶魔低语」·「自愈」读条', () => {
  it('它**真的会读**这一招（技能在注册表里 —— 不是静默无效）', () => {
    const h = harness();
    const events = h.run(30);
    const started = events.filter(
      (e) => e.kind === 'castStarted' && 'skillId' in e && e.skillId === WHISPER_MEND.id,
    );
    expect(started.length, '开局就该开始读「自愈」').toBeGreaterThan(0);
  });

  it('读条走完 → **回一截血**（数值从 `balance` 取，不写死）', () => {
    const h = harness();
    h.run(TICKS);
    expect(h.bossHp(), '不满血的 Boss 读完条该回血').toBe(BOSS_START_HP + WHISPER_MEND_HEAL);
  });

  it('⚠️ **打断它 → 一点血都不回**（这一条低语的全部内容）', () => {
    const h = harness();
    /** 先把读条推进半秒，再打断。 */
    h.run(30);
    const kinds = h.interrupt().map((e) => e.kind);
    expect(kinds, '应当发中断事件').toContain('castInterrupted');
    h.run(TICKS);
    expect(h.bossHp(), '被打断 ⇒ 不回血').toBe(BOSS_START_HP);
  });
});
