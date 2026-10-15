import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { LAZY_SLEEP, LAZY_SLEEP_SKILL } from '../../src/data/lazyBoss';
import type { Combatant, SkillDef, StatKey } from '../../src/core/types';
import { logicMs } from '../../src/core/loopConstants';
import { makeCombatant, makeSkillDef } from './helpers';

/**
 * **「睡眠」的挣扎机制**（用户 2026-10-14 定死的口径）：
 *
 * > 按技能 = 挣扎：**扣资源** + **睡眠减 3 秒**，但技能本身
 * > **不生效**（无伤害 / 无 buff / 不进 CD）
 *
 * 三条各自都会"静默坏掉"，所以每条都要钉：
 *   1. **能按**（动作锁被 `movesWhileLocked` 放行）—— 坏了的表现是"按键没反应"
 *   2. **减 3 秒**（`sleepReduceMs`）—— 坏了的表现是"睡满 10 秒，按键无效"
 *   3. **不生效**（提前返回）—— 坏了的表现是"睡着还能打伤害"（最坏的一条）
 *
 * ⚠️ 数值（3 秒 / 代价）一律**从内容里取**，不在这里钉死。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

/** 玩家的一条"要花 20 炁、打 30 伤害"的招（代价与伤害都可断言）。 */
const COST = 20;
const DAMAGE = 30;

function playerSkill(): SkillDef {
  return makeSkillDef({
    id: 'test-heavy',
    nameKey: 'skill.attack.name',
    castTime: 0,
    cooldown: logicMs(6),
    cost: [{ resource: 'energy', value: COST }],
    hits: [
      {
        at: 0,
        effects: [{ kind: 'damage', damage: { base: DAMAGE, canCrit: false, countsAsHit: true } }],
      },
    ],
  });
}

interface Harness {
  readonly engine: BattleEngine;
  readonly player: () => Combatant | undefined;
  readonly boss: () => Combatant | undefined;
  press: () => void;
}

/** 造一局：玩家**已经睡着**（睡眠挂在 (startTick, startTick + 10 秒] 上）。 */
function sleepingHarness(startTick = 0, energy = 100): Harness {
  const skill = playerSkill();
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS, skill], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const bare = makeCombatant({
    id: 'player',
    side: 'ally',
    /**
     * ⚠️ 炁的**上限跟着参数走**：睡眠现在是"每按一次 **−1 秒**"（2026-10-15
     * 从 3 秒改），10 秒的睡眠**要按 10 次** ⇒ 每次都要付代价，上限 100
     * 会在醒来之前就付不出来。
     */
    caps: { hp: 200, energy: Math.max(100, energy), douqi: 0 },
    resources: { hp: 200, energy, douqi: 0 },
  });
  const player: Combatant = { ...bare, buffs: applyBuff(bare, LAZY_SLEEP, 'boss', startTick).buffs };
  const engine = new BattleEngine({
    combatants: [
      player,
      makeCombatant({
        id: 'boss',
        side: 'enemy',
        caps: { hp: 500, energy: 0, douqi: 0 },
        resources: { hp: 500, energy: 0, douqi: 0 },
      }),
    ],
    seed: 7,
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
  /** 推进到 `startTick`，让睡眠"正在生效"。 */
  for (let i = 0; i < startTick; i += 1) engine.tick([]);
  engine.drainEvents();

  return {
    engine,
    player: () => engine.snapshot.combatants.find((c) => c.id === 'player'),
    boss: () => engine.snapshot.combatants.find((c) => c.id === 'boss'),
    press: () => {
      engine.tick([{ type: 'useSkill', skillId: skill.id, atTick: engine.snapshot.tick }], 'player');
      engine.drainEvents();
    },
  };
}

/** 睡眠还剩多少秒（按 tick 换算，够断言用）。 */
function sleepSecondsLeft(h: Harness): number {
  const buff = h.player()?.buffs.find((b) => b.defId === LAZY_SLEEP.id);
  if (buff === undefined) return 0;
  return (buff.expiresAtTick - h.engine.snapshot.tick) / 60;
}

describe('「睡眠」：按技能 = 挣扎（扣资源 + 减 3 秒，技能本身不生效）', () => {
  it('🔑 睡着时**按键不会没反应**（动作锁被放行）', () => {
    const h = sleepingHarness(10);
    expect(h.player()?.buffs.some((b) => b.defId === LAZY_SLEEP.id), '先确认它在睡').toBe(true);

    const energyBefore = h.player()?.resources.energy ?? -1;
    h.press();
    expect(h.player()?.resources.energy, '代价照扣 —— 说明这一招真的被受理了').toBeLessThan(
      energyBefore,
    );
  });

  it('🎯 按一次 = 睡眠**减 1 秒**（用户 2026-10-15 从 3 秒改）', () => {
    const h = sleepingHarness(10);
    const before = sleepSecondsLeft(h);

    h.press();

    const after = sleepSecondsLeft(h);
    /**
     * ⚠️ 用户改这条的背景（原话）："睡眠后按技能减的从3秒减到1秒
     * （**这个要检查一下 我昨天玩的时候感觉 按2下就醒了**）"。
     */
    expect(after, '按一次应该少 1 秒').toBeLessThanOrEqual(before - 1 + 0.2);
    expect(after, '但不是"按一下立刻醒"').toBeGreaterThan(0);
  });

  it('⚠️ **按技能不造成效果**：没有伤害、没有使用次数，但**进 CD**', () => {
    const h = sleepingHarness(10);
    const bossHpBefore = h.boss()?.resources.hp ?? -1;
    const cdBefore = h.player()?.cooldowns['test-heavy'];
    const usesBefore = h.player()?.uses['test-heavy'] ?? 0;

    h.press();

    expect(h.boss()?.resources.hp, '睡着还能打伤害是最坏的一条').toBe(bossHpBefore);
    expect(h.player()?.uses['test-heavy'] ?? 0, '不计使用次数').toBe(usesBefore);
    /**
     * ⚠️ **CD 要进**（用户 2026-10-14："睡眠时按技能要进 cd"）。
     * 它同时是"不能靠狂按无限挣扎"的那条约束：你只能按**已经就绪**的技能。
     */
    expect(
      h.player()?.cooldowns['test-heavy'],
      '睡着了也要进 CD',
    ).not.toBe(cdBefore);
  });

  it('一直按（按 CD 的节奏）→ 会醒；醒着时技能**照常全额生效**', () => {
    /**
     * ⚠️ **"按几次"取决于那个技能自己的 CD** —— 睡眠期间你只能按
     * **已经就绪**的技能，所以"最快多久醒"= 拿就绪的技能狂按。
     *
     * ⚠️ 而且**睡眠自己每秒也在走**（`expiresAtTick` 是绝对 tick），
     * 所以"10 秒 ÷ 3 秒 = 4 次"只在"瞬间按完 4 次"时成立。这里让引擎
     * 真的走时间（每 tick 都试一次按键），验的是"**会醒**"，不是某个次数。
     */
    /** ⚠️ 炁给足：1 秒/次 ⇒ 10 秒要按 10 次，每次都要付代价（见夹具的说明）。 */
    const h = sleepingHarness(10, 400);
    for (let i = 0; i < 10 * 60; i += 1) {
      h.press();
      if (!h.player()?.buffs.some((b) => b.defId === LAZY_SLEEP.id)) break;
    }
    expect(h.player()?.buffs.some((b) => b.defId === LAZY_SLEEP.id), '一直按应该会醒').toBe(
      false,
    );

    /**
     * ⚠️ 醒了之后这一招必须"正常"：有伤害、有 CD。
     * 但要先**等它自己那 0.6 秒 CD 走完** —— 睡着时按的那几下同样进了 CD
     * （那正是用户要的），所以刚醒时它是冷却中的。
     */
    while ((h.player()?.cooldowns['test-heavy'] ?? 0) > h.engine.snapshot.tick) h.engine.tick([]);
    h.engine.drainEvents();

    const bossHpBefore = h.boss()?.resources.hp ?? -1;
    h.press();
    expect(h.boss()?.resources.hp, '醒了就该打出伤害').toBeLessThan(bossHpBefore);
    expect(h.player()?.cooldowns['test-heavy'], '醒了就该进 CD').toBeDefined();
  });

  it('🎯 **睡眠中受伤 → 立即醒**（用户 2026-10-15："睡眠中收到伤害立即醒"）', () => {
    /**
     * 判据：挨一下打之后睡眠**就没了**（不必等它自然走完，也不必按技能）。
     * ⚠️ 用户同时留了一句设计约束："（**以后设计延迟自伤技能**）" ——
     * 延迟自伤会把你打醒，以后做那类技能要考虑这一点。
     */
    const h = sleepingHarness(10);
    expect(
      h.player()?.buffs.some((b) => b.defId === LAZY_SLEEP.id),
      '先确认真的睡着了',
    ).toBe(true);

    /** 让 Boss 打玩家一下（用引擎自己的伤害通路，而不是手改 buffs）。 */
    h.engine.tick(
      [{ type: 'useSkill', skillId: 'lazy-blunt', atTick: h.engine.snapshot.tick }],
      'boss',
    );
    for (let i = 0; i < 70; i += 1) h.engine.tick([]);
    h.engine.drainEvents();

    expect(
      h.player()?.buffs.some((b) => b.defId === LAZY_SLEEP.id),
      '挨打之后应当醒了',
    ).toBe(false);
  });

  it('🎯 **无法被闪避**，但**可以被打断**（用户："睡眠技能无法被闪避 可以被打断"）', () => {
    /**
     * 两半都要钉：
     *   ① **无敌窗口（闪避）盖不住它** —— 走 `HitDef.avoidable === false`
     *   ② **但打断照样有效** —— `interruptible: true` 没动
     *
     * ⚠️ ① 那条是**接上了一个声明很久却没人读的字段**
     * （`HitDef.avoidable`），不是新造 flag。
     */
    const sleepHit = LAZY_SLEEP_SKILL.hits[0];
    expect(sleepHit?.avoidable, '睡眠那一段必须是必中').toBe(false);
    expect(LAZY_SLEEP_SKILL.interruptible, '但仍然可以被中断').toBe(true);
  });

  it('资源不够时**付不出代价** → 这一招被拒（也就减不了睡眠）', () => {
    /** ⚠️ 炁要**一开始**就给不够（10 < 代价 20）：中途改状态会被工作副本覆盖。 */
    const h = sleepingHarness(10, 10);
    const before = sleepSecondsLeft(h);
    h.press();
    /**
     * ⚠️ 容差 = 一个 tick（1/60 秒）：`press()` 里引擎会推进一格，
     * 而"还剩多久"是拿 `expiresAtTick − 当前 tick` 算的。
     * 这里要证的是"**没有被减掉 3 秒**"，一个 tick 的误差不影响判据。
     */
    expect(sleepSecondsLeft(h), '付不起就不该减睡眠').toBeCloseTo(before, 1);
  });
});
