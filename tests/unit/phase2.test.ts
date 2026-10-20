import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { BOSS_POOL } from '../../src/data/roster';
import { PHASE2_GATE, WHISPER_PHASE2, WHISPER_POOL } from '../../src/data/whispers';
import { makeBoss, makePlayer } from '../../src/data/units';
import { whisperCombatants } from '../../src/app/whisperApply';
import type { BattleEngine as Engine } from '../../src/core/combat/battleState';
import type { Combatant, StatKey } from '../../src/core/types';

/**
 * **「恶魔低语·二阶段」**（2026-10-20）。
 *
 * 设计口径（`docs/specs/2026-10-15-difficulty-curve.md` §1）：
 * 每层抽 1 条低语，抽到「二阶段」的那一层，Boss 在 **40% 血**时换形态；
 * 没抽到就**永远不换**。7 个 Boss 各写自己的题。
 *
 * 这里钉两件事：
 *   1. **结构**：7 个 Boss 的二阶段能力都守在 `PHASE2_GATE` 后面（没抽到 = 不生效）
 *   2. **行为**：跨过 40% 血真的会切（抽到）/ 真的不切（没抽到）
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

const phase2Whisper = WHISPER_POOL.find((w) => w.id === 'phase2');

describe('「恶魔低语」· 二阶段（池子与开关）', () => {
  it('池子正好 **6 条**（一局打满 7 层不重复），二阶段是其中一条', () => {
    expect(WHISPER_POOL.map((w) => w.id).sort()).toEqual(
      ['blunt', 'cutDouqi', 'enrage', 'mend', 'phase2', 'slowBreath'].sort(),
    );
  });

  it('「二阶段」挂的是那条**隐藏标记**（不是形态本身 —— 形态是各 Boss 自己的内容）', () => {
    expect(phase2Whisper?.apply.kind).toBe('bossBuff');
    const apply = phase2Whisper?.apply;
    if (apply?.kind !== 'bossBuff') return;
    expect(apply.buff.id).toBe(WHISPER_PHASE2.id);
    expect(apply.buff.hidden).toBe(true);
  });

  it('**7 个 Boss 都写了 40% 的开关**，而且能力全守在 `PHASE2_GATE` 后面', () => {
    for (const entry of BOSS_POOL) {
      /**
       * ⚠️ 7 个 Boss **全都**在 `onHpBelow` 上开二阶段（2026-10-20 起）。
       * 暴怒额外把"怒火清零"那一条也加了 `notHasBuff(wrath-phase2)`。
       */
      const boss = makeBoss(entry.id);
      const switchBehavior = boss.behaviors.find((b) => b.kind === 'onHpBelow');
      expect(switchBehavior, `${entry.id} 缺二阶段开关`).toBeDefined();
      if (switchBehavior?.kind !== 'onHpBelow') continue;
      expect(switchBehavior.ratio, entry.id).toBeCloseTo(0.4, 6);
      expect(switchBehavior.then.length, `${entry.id} 的开关里没有能力`).toBeGreaterThan(0);
      for (const ability of switchBehavior.then) {
        /**
         * ⚠️ 每个 Boss 的题不同（挂形态 / 催眠 / 偷缠……），但**门禁相同**：
         * 全是 `PHASE2_GATE`（`hasBuff(whisper-phase2)`）。
         */
        expect(ability.when, `${entry.id} 有一条能力没守门禁`).toEqual(PHASE2_GATE);
      }
    }
  });
});

/* ================================================================== *
 * 行为：跨过 40% 血到底切不切
 * ================================================================== */

interface Probe {
  readonly engine: Engine;
  /** 把 Boss 打到跨过 40%，返回它此刻身上的 buff id。 */
  readonly crossWith: (skillId?: string) => readonly string[];
  readonly playerBuffs: () => readonly string[];
}

/** 一局：Boss 停在 42% 血、玩家用「劈」把它打过 40%。 */
function probe(args: { readonly bossId: string; readonly withWhisper: boolean }): Probe {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  /**
   * ⚠️ 玩家必须有**缠**：「劈」（45 点，一记就能从 42% 打过 40%）的代价是缠，
   * 而 `makePlayer` 开局缠为 0 ⇒ 技能会被 `skillRejected: cost` 拒掉，
   * 于是 Boss 的血**一点没掉**、`onHpBelow` 也就永远不触发（第一版就是这么假的）。
   */
  const player0 = makePlayer('player');
  const applied = whisperCombatants({
    player: { ...player0, resources: { ...player0.resources, douqi: 100 } },
    boss: makeBoss(args.bossId),
    whisper: args.withWhisper ? phase2Whisper : undefined,
  });
  const maxHp = applied.boss.caps.hp;
  /**
   * ⚠️ **只留二阶段那条开关**（去掉轮转 / 狂暴）：
   * Boss 自己的招会干扰"跨 40%"这件事 —— 实测「暴食」用「啃噬·血」给自己
   * 套了吸收盾，玩家那一记「劈」被盾吃掉，血量压根没掉（也没有 `damage`
   * 事件），于是开关永远不触发。这一条评的是**开关**，不是它的轮转。
   */
  const boss: Combatant = {
    ...applied.boss,
    behaviors: applied.boss.behaviors.filter(
      (b) => b.kind !== 'rotation' && b.kind !== 'weightedRotation' && b.kind !== 'enrage',
    ),
    resources: { ...applied.boss.resources, hp: Math.ceil(maxHp * 0.42) },
  };
  const engine = new BattleEngine({
    combatants: [applied.player, boss],
    seed: 20261020,
    bossId: args.bossId,
    timeLimitMs: 600_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', {}],
      [args.bossId, {}],
    ]),
    passiveModifiers: new Map(),
  });
  engine.drainEvents();
  const buffsOf = (id: string): readonly string[] =>
    (engine.snapshot.combatants.find((c) => c.id === id)?.buffs ?? []).map((b) => b.defId);

  return {
    engine,
    crossWith: (skillId = 'pi') => {
      /** 「劈」45 点：从 42% 一记打过 40% ✓ */
      engine.tick([{ type: 'useSkill', skillId, atTick: engine.snapshot.tick }], 'player');
      /** ⚠️ 「劈」是**读条技能**（0.6 秒 = 36 tick）：必须等它结算完。 */
      for (let i = 0; i < 120; i += 1) {
        engine.tick([]);
        engine.drainEvents();
      }
      return buffsOf(args.bossId);
    },
    playerBuffs: () => buffsOf('player'),
  };
}

describe('「恶魔低语」· 二阶段（跨过 40% 会切 / 没抽到不切）', () => {
  it('贪婪：抽到 ⇒ 40% 之后挂上「无餍」（霸体）；没抽到 ⇒ 什么都没有', () => {
    const on = probe({ bossId: 'greed', withWhisper: true }).crossWith();
    expect(on).toContain('greed-phase2');
    const off = probe({ bossId: 'greed', withWhisper: false }).crossWith();
    expect(off).not.toContain('greed-phase2');
  });

  it('傲慢：抽到 ⇒ 挂「狂傲」；没抽到 ⇒ 没有', () => {
    expect(probe({ bossId: 'meiichiro', withWhisper: true }).crossWith()).toContain('pride-phase2');
    expect(probe({ bossId: 'meiichiro', withWhisper: false }).crossWith()).not.toContain(
      'pride-phase2',
    );
  });

  it('色欲 / 嫉妒 / 暴食：抽到 ⇒ 各自挂上自己的形态', () => {
    for (const [bossId, form] of [
      ['lust', 'lust-phase2'],
      ['envy', 'jealousy-phase2'],
      ['gluttony', 'gluttony-phase2'],
    ] as const) {
      expect(probe({ bossId, withWhisper: true }).crossWith(), bossId).toContain(form);
      expect(probe({ bossId, withWhisper: false }).crossWith(), bossId).not.toContain(form);
    }
  });

  it('懒惰：抽到 ⇒ 「挣扎减半」标记 + 当场被睡；没抽到 ⇒ 那个标记永远不出现', () => {
    /**
     * ⚠️ 判据只用 `lazy-deep-sleep`（**只有二阶段的开关才会挂它**）：
     * 「睡眠」本身是懒惰的常规招，它自己也会放 —— 拿"被睡"当判据会假阳性
     * （第一版就踩了）。
     */
    const on = probe({ bossId: 'sloth', withWhisper: true });
    on.crossWith();
    expect(on.playerBuffs(), '抽到二阶段 ⇒ 挂上"挣扎减半"标记').toContain('lazy-deep-sleep');
    expect(on.playerBuffs(), '并且当场被睡').toContain('lazy-sleep');

    const off = probe({ bossId: 'sloth', withWhisper: false });
    off.crossWith();
    expect(off.playerBuffs()).not.toContain('lazy-deep-sleep');
  });
});
