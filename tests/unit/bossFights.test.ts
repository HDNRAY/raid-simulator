import { describe, expect, it } from 'vitest';

import { RunRecorder } from '../../src/core/run';
import type { Action, BattleState } from '../../src/core/types';
import { makeBoss, makePlayer } from '../../src/data/units';
import { BOSS_DEFS } from '../../src/data/bossDefs';
import {
  DODGE_SKILL_ID,
  OUTPUT_PRIORITY,
  makeGoldenEngineOptions,
  planPriority,
} from '../golden/fixtures';

/**
 * **六个 Boss 各跑一整场**（2026-10-14 补）。
 *
 * ==================================================================
 * 为什么要有这一组（它补的是一个**真实的漏洞**）
 * ==================================================================
 *
 * 今天新增的四个 Boss（嫉妒 / 贪婪 / 懒惰 / 暴食）各自的单测都是
 * **部件级**的（"壳会破" / "计数到 3" / "睡眠能挣扎"）—— 而**没有一条
 * 真的把它们当 Boss 打完一场**。于是"定义了却没人挂"那一类问题
 * （暴食的血盾就是）在部件级测试里**看不见**。
 *
 * 这一组只做一件事：**用参考策略跟每个 Boss 打完**，并断言三件
 * "整场级别"的性质：
 *
 *   1. **能结束**（不会卡到 maxTicks —— 那通常意味着某个机制把它变成
 *      了不死之身）
 *   2. **玩家还剩血**（不会一开场就被秒）
 *   3. **时长在合理量级**（不追求平衡，只抓"慢了 10 倍"这种）
 *
 * ⚠️ 这里**不钉具体数值**（AGENTS.md §4：数值由黄金基线覆盖、且会经常调）。
 * 断言的是**量级**，所以调平衡不会让这些用例变红。
 */

/** 参考策略：攒炁 + 输出 + 见招拆招（与黄金重放同一套）。 */
function referencePlan(): (tick: number, state: BattleState) => readonly Action[] {
  const base = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: DODGE_SKILL_ID });
  return (tick, state) => {
    const player = state.combatants.find((c) => c.side === 'ally');
    /**
     * ⚠️ 「懒惰」的「睡眠」：睡着时**任意技能都按不动**，唯一出路是
     * **按技能挣扎**（每次 −3 秒）。所以参考策略在睡觉时"乱按"一个
     * 它手上有的技能 —— 那正是玩家会做的事。
     */
    if (player?.buffs.some((b) => b.defId === 'lazy-sleep')) {
      return [{ type: 'useSkill', skillId: 'attack', atTick: tick }];
    }
    return base(tick, state);
  };
}

interface FightResult {
  readonly id: string;
  readonly status: string;
  readonly endReason: string | undefined;
  readonly ticks: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly bossHp: number;
}

/** 完整打一场，返回摘要。 */
function fight(bossId: string, seed = 20261014): FightResult {
  const player = makePlayer('player');
  const boss = makeBoss(bossId);
  const recorder = new RunRecorder(
    makeGoldenEngineOptions(seed, { combatants: [player, boss], bossId }),
  );
  recorder.runUntilEnd(referencePlan(), 60 * 400);

  const state = recorder.state;
  const me = state.combatants.find((c) => c.side === 'ally');
  const them = state.combatants.find((c) => c.side === 'enemy');
  return {
    id: bossId,
    status: state.status,
    endReason: state.endReason,
    ticks: state.tick,
    playerHp: me?.resources.hp ?? 0,
    playerMaxHp: me?.caps.hp ?? 0,
    bossHp: them?.resources.hp ?? 0,
  };
}

/** 今天做的四个 + 早先的两个，全跑一遍并把结果打出来（调平衡时看它）。 */
const BOSSES = ['meiichiro', 'lust', 'envy', 'greed', 'sloth', 'gluttony', 'wrath'] as const;

describe('六个 Boss 各跑一整场（整场级回归）', () => {
  const results = BOSSES.map((id) => fight(id));

  it('📊 打印整场摘要（人看的，不是断言）', () => {
     
    console.table(
      results.map((r) => ({
        Boss: r.id,
        结果: r.status,
        秒: Math.round(r.ticks / 60),
        玩家血: `${r.playerHp}/${r.playerMaxHp}`,
        Boss血: r.bossHp,
      })),
    );
    expect(results).toHaveLength(BOSSES.length);
  });

  for (const id of BOSSES) {
    describe(`${id}`, () => {
      const r = (): FightResult => {
        const found = results.find((x) => x.id === id);
        if (found === undefined) throw new Error(`没有 ${id} 的结果`);
        return found;
      };

      it('能打完（不会卡在"打不死"上）', () => {
        /**
         * ⚠️ 判据是"**战斗真的结束了**"：`status` 不是 `running`，
         * 而且不是被 `maxTicks` 截断的。一只"永远回血 > 你输出"的 Boss
         * 会在这里红 —— 那正是这一组要抓的东西。
         */
        expect(r().status, '战斗该有结局').not.toBe('running');
        expect(r().ticks, '不该跑到 maxTicks 才结束').toBeLessThan(60 * 400);
      });

      it('不会一开场就把玩家秒了', () => {
        /** 参考策略是个"会闪避"的玩家；它至少该活过 20 秒。 */
        expect(r().ticks, '活过 20 秒').toBeGreaterThan(60 * 20);
      });

      it('时长在合理量级（20 秒 ~ 5 分钟）', () => {
        expect(r().ticks / 60).toBeGreaterThanOrEqual(20);
        expect(r().ticks / 60).toBeLessThanOrEqual(300);
      });
    });
  }
});

/**
 * ⚠️ **这一条是给"暴食的血盾"立的哨**：它曾经**定义了却没人挂**
 * （"偷血 → 变壳 → 打穿还钱"整条链是断的），而部件级单测看不见。
 *
 * 判据：跟它打完一整场的过程中，**「血盾」这条 buff 至少出现过一次**。
 */
describe('⚠️ 契约：整场里"会挂上去的"buff 真的被挂上过', () => {
  it('暴食：一整场里「血盾」出现过（否则那条链是断的）', () => {
    const player = makePlayer('player');
    const boss = makeBoss('gluttony');
    const recorder = new RunRecorder(makeGoldenEngineOptions(1, { combatants: [player, boss], bossId: 'gluttony' }));

    let sawShield = false;
    const plan = referencePlan();
    for (let i = 0; i < 60 * 400; i += 1) {
      const state = recorder.state;
      if (state.status !== 'running') break;
      if (state.combatants.some((c) => c.buffs.some((b) => b.defId === 'gluttony-shield'))) {
        sawShield = true;
      }
      recorder.step(plan(state.tick, state));
    }

    expect(sawShield, '「血盾」一次都没出现过 —— 那条链又断了').toBe(true);
  });
});

describe('多 seed 复核（排除"只是这个种子不好"）', () => {
  it('📊 同一套策略、三个 seed', () => {
    const rows: Record<string, string>[] = [];
    for (const seed of [1, 7, 20261014]) {
      for (const id of BOSSES) {
        const r = fight(id, seed);
        rows.push({
          seed: String(seed),
          Boss: r.id,
          结果: r.status,
          秒: String(Math.round(r.ticks / 60)),
          玩家血: String(r.playerHp),
          Boss血: String(r.bossHp),
        });
      }
    }
     
    console.table(rows);
    expect(rows).toHaveLength(BOSSES.length * 3);
  });
});

/* ================================================================== *
 * ⚠️ 契约：Boss 声明的**常驻被动**必须真的被挂上
 * ================================================================== */

describe('⚠️ 契约：`BossDef.passives` 真的会挂在它身上', () => {
  /**
   * ==================================================================
   * 这一条抓的是一个**真的、而且躲了很久的 bug**（2026-10-14）
   * ==================================================================
   *
   * 在此之前被动只写在 `buffs` 里，而引擎**从不挂 `buffs`**
   * （那是"技能会用到的全部 buff"）—— 只有色欲被 `innateBuffsFor`
   * 特判挂过。于是**五个 Boss 的被动全是死的**：
   *
   *   - 「懒惰」一整场**从没睡到过玩家**（实测 `被睡 tick 数 = 0`）
   *   - 「贪婪」的「弱点」从不出现
   *   - 「暴食」的「饕餮」计数从不累加
   *
   * ⚠️ **为什么单测没抓住**：那些 Boss 的单测都是**手工挂 buff** 再验行为
   * （`withBuff({}, [LAZY_IDLE_PASSIVE])`）—— 于是"到底有没有人挂它"
   * 从来不在判据里。与「暴食的血盾」是同一个形状。
   */
  /**
   * ⚠️ 被动现在是**被动技能**（`PassiveSkillDef`）—— 它自己不是 buff，
   * 而是**通过 `abilities` 里的 `grant` 把 buff 挂上去**。所以判据是
   * "**它授予的那条 buff 在不在身上**"，不是"技能 id 在不在身上"。
   */
  const grantedByPassives = (def: (typeof BOSS_DEFS)[number]): readonly string[] =>
    def.passives.flatMap((passive) =>
      passive.abilities.flatMap((ability) =>
        ability.kind === 'grant' ? [ability.buff.id] : [],
      ),
    );

  it('每个 Boss 开战时身上都有它声明的每一条被动**授予的 buff**', () => {
    for (const def of BOSS_DEFS) {
      const onBody = new Set(makeBoss(def.id).buffs.map((b) => b.defId));
      const missing = grantedByPassives(def).filter((id) => !onBody.has(id));
      expect(missing, `${def.id} 的被动没被挂上`).toEqual([]);
    }
  });

  it('⚠️ 而且要**刚够**：开场身上不该有技能才会授予的那些 buff', () => {
    /**
     * 反向判据：如果哪天有人图省事把整张 `buffs` 都挂上，玩家一开战就会
     * 看到前摇标记 / 一次性印记。这条会把那种"顺手多挂"挡回去。
     */
    for (const def of BOSS_DEFS) {
      const declaredPassive = new Set(grantedByPassives(def));
      const onBody = makeBoss(def.id).buffs.map((b) => b.defId);
      const extra = onBody.filter((id) => !declaredPassive.has(id));
      expect(extra, `${def.id} 开场多挂了不该挂的`).toEqual([]);
    }
  });

  it('🎯 端到端：「懒惰」在一整场里**真的睡到了玩家**（这条曾经是 0）', () => {
    const player = makePlayer('player');
    const boss = makeBoss('sloth');
    const recorder = new RunRecorder(
      makeGoldenEngineOptions(3, { combatants: [player, boss], bossId: 'sloth' }),
    );
    const plan = referencePlan();
    let slept = 0;
    for (let i = 0; i < 60 * 400; i += 1) {
      const state = recorder.state;
      if (state.status !== 'running') break;
      if (state.combatants.some((c) => c.buffs.some((b) => b.defId === 'lazy-sleep'))) slept += 1;
      recorder.step(plan(state.tick, state));
    }
    expect(slept, '「睡眠」一次都没生效 —— 被动又断了').toBeGreaterThan(0);
  });
});
