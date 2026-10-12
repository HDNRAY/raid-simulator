import { describe, expect, it } from 'vitest';

import type { EventDef } from '../../../src/core/events';
import {
  EMPTY_BATTLE_STATS,
  mergeAllBattleStats,
  mergeBattleStats,
  reduceBattleStats,
  type BattleStatsScope,
} from '../../../src/core/run/stats';

/**
 * `stats.ts` 的单测 —— **造数那一半**（`Q-a` 拆出来的）。
 *
 * ⚠️ 所有用例都**直接喂事件数组**，**不起引擎**：
 *   - `reduceBattleStats` 的入参就是一个 `readonly EventDef[]`（纯函数）
 *   - 所以"统计算得对不对"与"引擎怎么跑"完全解耦 —— 引擎的行为变化
 *     不会让这些用例变成噪音
 *
 * ⚠️ **读数**（"某个查询是几"）的用例在 `query.test.ts` —— 与本文件
 * 对应源码的同一个切法。本文件里**不出现** `readBattleStat`，
 * 于是"归约错了"与"查询错了"不会混在一次失败里。
 *
 * ⚠️ 事件里的 `skillId` 用**真的技能 id**（`jie` / `break` / `dodge`），
 * 而不是 `'a'` / `'b'`：用户要问的正是"用**截**打断了几次"，
 * 而 `sourceSkillId` vs `skillId` 的区别就是靠这个区分的。
 */

const PLAYER = 'player';
const BOSS = 'meiichiro';

/** 「截」（打断）、「破」（强制打断）、「闪」（闪避）—— 见 `data/content.ts`。 */
const JIE = 'jie';
const BREAK = 'break';
const DODGE = 'dodge';

/**
 * 归约的视角。⚠️ `outcome` 与 `flawless` 是**必填**的（`Q-b`）——
 * 少传一个就编译不过，所以测试里也得写出来。
 */
const SCOPE = { actorId: PLAYER, outcome: 'victory', flawless: false } as const;

/** 只想改一个字段时用（避免每个用例都写全）。 */
function scope(patch: Partial<BattleStatsScope> = {}): BattleStatsScope {
  return { ...SCOPE, ...patch };
}

/** 造一个 `damage` 事件（默认是玩家打的）。 */
function damage(skillId: string, amount: number, tick = 1, sourceId = PLAYER): EventDef {
  return {
    kind: 'damage',
    tick,
    sourceId,
    targetId: sourceId === PLAYER ? BOSS : PLAYER,
    amount,
    crit: false,
    absorbed: 0,
    thinned: 0,
    overkill: 0,
    skillId,
  };
}

function skillUsed(skillId: string, tick = 1, sourceId = PLAYER): EventDef {
  return { kind: 'skillUsed', tick, sourceId, skillId };
}

/** `interruptSuccess`：`skillId` 是**被打断的读条**，`sourceSkillId` 是**打断者的招**。 */
function interrupt(
  sourceSkillId: string | undefined,
  interrupted = 'boss-cleave',
  tick = 1,
): EventDef {
  return {
    kind: 'interruptSuccess',
    tick,
    sourceId: PLAYER,
    targetId: BOSS,
    skillId: interrupted,
    ...(sourceSkillId === undefined ? {} : { sourceSkillId }),
  };
}

function avoided(reason: 'dodged' | 'immune', tick = 1): EventDef {
  return { kind: 'avoided', tick, sourceId: BOSS, targetId: PLAYER, skillId: 'boss-cleave', reason };
}

function encounterEnd(result: 'victory' | 'defeat', tick = 100): EventDef {
  return { kind: 'encounterEnd', tick, result, reason: 'hpZero' };
}

describe('reduceBattleStats —— 用户点名的两个例子', () => {
  it('例 1：「某个技能造成伤害数」= `damage` 事件按 skillId **求和**', () => {
    // ⚠️ 关键是"求和"而不是"计数"：3 次截分别打 10 / 12 / 8，
    // 答案必须是 30，而不是 3。这正是"计数器"做不到的那件事
    // （第一版的 RunCounter 里根本没有伤害维度）。
    const events: readonly EventDef[] = [
      skillUsed(JIE, 1),
      damage(JIE, 10, 2),
      damage(JIE, 12, 5),
      damage(JIE, 8, 9),
      skillUsed(DODGE, 10),
      damage(DODGE, 1, 11),
    ];
    const stats = reduceBattleStats(events, SCOPE);
    expect(stats.skillDamage[JIE]).toBe(30);
    expect(stats.skillDamage[DODGE]).toBe(1);
  });

  it('例 1 的对照：伤害与命中是**两个**维度（30 伤害 / 3 次命中）', () => {
    const stats = reduceBattleStats(
      [damage(JIE, 10, 2), damage(JIE, 12, 5), damage(JIE, 8, 9)],
      SCOPE,
    );
    expect(stats.skillDamage[JIE]).toBe(30);
    expect(stats.skillHits[JIE]).toBe(3);
    // 两个维度独立：改伤害不改命中
    expect(stats.skillDamage[JIE]).not.toBe(stats.skillHits[JIE]);
  });

  it('例 2：「一场战斗同时用了 n 次 a 和 m 次 b」', () => {
    const events: readonly EventDef[] = [
      skillUsed(JIE, 1),
      skillUsed(JIE, 20),
      skillUsed(JIE, 40),
      skillUsed(BREAK, 60),
      skillUsed(BREAK, 80),
    ];
    const stats = reduceBattleStats(events, SCOPE);
    expect(stats.skillUses[JIE]).toBe(3);
    expect(stats.skillUses[BREAK]).toBe(2);
  });
});

describe('reduceBattleStats —— 按技能分开（第一版做不到的那件事）', () => {
  it('用「截」打断与用「破」打断是**两个不同的数**', () => {
    // ⚠️ 这是 ③（`sourceSkillId`）存在的**唯一理由**：
    // 这四条事件的 `skillId`（被打断的读条）**只有两种**，
    // 而 `sourceSkillId` 才是打断者用的招。若归约器读 `skillId`，
    // `jie` 与 `break` 都会是 0，而 `boss-cleave` / `boss-slam` 各是 2。
    const events: readonly EventDef[] = [
      interrupt(JIE, 'boss-cleave', 1),
      interrupt(JIE, 'boss-slam', 2),
      interrupt(BREAK, 'boss-cleave', 3),
      interrupt(BREAK, 'boss-slam', 4),
    ];
    const stats = reduceBattleStats(events, SCOPE);
    expect(stats.skillInterrupts[JIE]).toBe(2);
    expect(stats.skillInterrupts[BREAK]).toBe(2);
    // 对照：被打断的招（`skillId`）**不该**出现在这张表里
    expect(stats.skillInterrupts['boss-cleave']).toBeUndefined();
    expect(stats.skillInterrupts['boss-slam']).toBeUndefined();
  });

  it('没有 `sourceSkillId` 的打断**不记**（来源不是技能）', () => {
    // 记进 `''` 会让"非技能的打断"与"某个 id 恰好是空串的技能"混在一起
    const stats = reduceBattleStats([interrupt(undefined, 'boss-cleave', 1)], SCOPE);
    expect(stats.skillInterrupts).toEqual({});
  });

  it('打断**只数成功的**（`interruptSuccess` 一条一个）', () => {
    const stats = reduceBattleStats(
      [interrupt(JIE, 'a', 1), interrupt(JIE, 'b', 2), interrupt(JIE, 'c', 3)],
      SCOPE,
    );
    expect(stats.skillInterrupts[JIE]).toBe(3);
  });
});

describe('reduceBattleStats —— 视角（只用"我方"的事件）', () => {
  it('Boss 造成的伤害**不算**进玩家的技能伤害', () => {
    // ⚠️ 这条防的是"两边都用同一个 skillId"时把 Boss 的伤害算进玩家的招。
    const events: readonly EventDef[] = [
      damage(JIE, 30, 1, PLAYER),
      damage(JIE, 999, 2, BOSS), // Boss 也有一招叫 jie（派生技同名时就是这样）
    ];
    const stats = reduceBattleStats(events, SCOPE);
    expect(stats.skillDamage[JIE]).toBe(30);
    expect(stats.skillHits[JIE]).toBe(1);
  });

  it('Boss 的技能使用**不算**进玩家的使用次数', () => {
    const stats = reduceBattleStats([skillUsed(JIE, 1, PLAYER), skillUsed(JIE, 2, BOSS)], SCOPE);
    expect(stats.skillUses[JIE]).toBe(1);
  });

  it('玩家**挨打**的事件不算闪避；Boss 闪掉了玩家的招也不算玩家的闪避', () => {
    const bossAvoid: EventDef = {
      kind: 'avoided',
      tick: 1,
      sourceId: PLAYER,
      targetId: BOSS,
      skillId: JIE,
      reason: 'dodged',
    };
    // bossAvoid 的 `targetId` 是 BOSS，所以不算玩家的闪避
    expect(reduceBattleStats([bossAvoid], SCOPE).dodges).toEqual({});
    expect(reduceBattleStats([avoided('dodged')], SCOPE).dodges).toEqual({ dodged: 1 });
  });

  it('换一个视角（actorId = Boss）就统计 Boss 的', () => {
    const events: readonly EventDef[] = [damage(JIE, 30, 1, PLAYER), damage(BREAK, 7, 2, BOSS)];
    expect(reduceBattleStats(events, scope({ actorId: BOSS })).skillDamage).toEqual({ [BREAK]: 7 });
  });
});

describe('reduceBattleStats —— 闪避的两种 reason', () => {
  it('`dodged` 与 `immune` 分开计数', () => {
    const stats = reduceBattleStats(
      [avoided('dodged'), avoided('dodged'), avoided('immune')],
      SCOPE,
    );
    expect(stats.dodges).toEqual({ dodged: 2, immune: 1 });
  });

  it('`immune` 被归约收下（哪怕现在没有查询能拿到它）', () => {
    // 归约照收、查询不暴露 —— 这是"死值先删"的边界：
    // 删的是"没有读者的**接口**"，不是"事件里的事实"。
    expect(reduceBattleStats([avoided('immune')], SCOPE).dodges).toEqual({ immune: 1 });
  });
});

describe('reduceBattleStats —— 纯度与边界', () => {
  it('纯函数：同一份事件数组喂两次结果深度相等', () => {
    const events: readonly EventDef[] = [skillUsed(JIE, 1), damage(JIE, 5, 2), avoided('dodged', 3)];
    expect(reduceBattleStats(events, SCOPE)).toEqual(reduceBattleStats(events, SCOPE));
  });

  it('纯函数：入参数组没被改（不会被 push 新事件进去）', () => {
    const events: EventDef[] = [skillUsed(JIE, 1), damage(JIE, 5, 2)];
    const frozen = structuredClone(events);
    reduceBattleStats(events, SCOPE);
    expect(events).toEqual(frozen);
  });

  it('空事件数组 → 空统计（不是 undefined）', () => {
    const stats = reduceBattleStats([], SCOPE);
    expect(stats.skillUses).toEqual({});
    expect(stats.skillDamage).toEqual({});
    expect(stats.skillHits).toEqual({});
    expect(stats.skillInterrupts).toEqual({});
    expect(stats.dodges).toEqual({});
    expect(stats.ticks).toBe(0);
  });

  it('无关事件被忽略（不报错、也不污染任何维度）', () => {
    const events: readonly EventDef[] = [
      { kind: 'heal', tick: 1, sourceId: PLAYER, targetId: PLAYER, amount: 5, crit: false, overheal: 0 },
      { kind: 'death', tick: 2, targetId: BOSS },
      { kind: 'enrageStarted', tick: 3, bossId: BOSS },
      { kind: 'resourceChanged', tick: 4, targetId: PLAYER, resource: 'energy', delta: -5, current: 10 },
    ];
    const stats = reduceBattleStats(events, SCOPE);
    expect(stats.skillUses).toEqual({});
    expect(stats.skillDamage).toEqual({});
    expect(stats.dodges).toEqual({});
    // ticks 仍然要跟上（它是"这一场打了多久"）
    expect(stats.ticks).toBe(4);
  });

  it('`ticks` = 最后一个事件的 tick（不是事件条数）', () => {
    expect(reduceBattleStats([skillUsed(JIE, 7), skillUsed(JIE, 700)], SCOPE).ticks).toBe(700);
  });

  it('`skillId: ""`（触发器产出的反伤）记在空串键下，不特判、不丢', () => {
    const reflect: EventDef = {
      kind: 'damage',
      tick: 1,
      sourceId: PLAYER,
      targetId: BOSS,
      amount: 12,
      crit: false,
      absorbed: 0,
      thinned: 0,
      overkill: 0,
      skillId: '',
      reflect: true,
    };
    const stats = reduceBattleStats([reflect], SCOPE);
    expect(stats.skillDamage['']).toBe(12);
    // 真实技能 id 不会被它命中
    expect(stats.skillDamage[JIE]).toBeUndefined();
  });

  it('结果可 JSON 往返（要进 RunState / 存档）', () => {
    const stats = reduceBattleStats(
      [skillUsed(JIE, 1), damage(JIE, 5, 2), interrupt(JIE, 'x', 3), avoided('dodged', 4)],
      scope({ flawless: true }),
    );
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
    expect(structuredClone(stats)).toEqual(stats);
  });

  it('⚠️ 归约**不装** `battles`，也**没有**顶层 `flawless`（`Q-f` 删掉了它）', () => {
    // 单场的结果在 `scope.outcome` / `scope.flawless` 里，由调用方
    // （`lifecycle.ts` 的 `battleStatsFor`）决定要不要装进 `battles`。
    // 归约器自己不装 —— 它不知道"这是整局里的第几场"。
    const stats = reduceBattleStats([], scope({ outcome: 'defeat', flawless: true }));
    expect(stats.battles).toBeUndefined();
    expect('flawless' in stats).toBe(false);
  });

  it('`scope.outcome` / `scope.flawless` 不影响任何**技能级**维度', () => {
    // 它们只描述"这一场的结果"，不该漏进别处（漏了说明某个 case 写错了）
    const events: readonly EventDef[] = [damage(JIE, 5, 1)];
    const won = reduceBattleStats(events, scope({ outcome: 'victory', flawless: true }));
    const lost = reduceBattleStats(events, scope({ outcome: 'defeat', flawless: false }));
    expect(lost.skillDamage).toEqual(won.skillDamage);
    expect(lost.ticks).toBe(won.ticks);
  });

  it('`encounterEnd` 推进会 `ticks`，但归约器不在这里立"赢没赢"的结论', () => {
    const stats = reduceBattleStats([skillUsed(JIE, 1), encounterEnd('victory', 500)], SCOPE);
    expect(stats.ticks).toBe(500);
    expect(stats.battles).toBeUndefined();
  });
});

describe('mergeBattleStats —— 整局累加（scope: run 的落点）', () => {
  /** 三场战斗：第 1 场用 2 次截、第 2 场 1 次、第 3 场 3 次。 */
  function threeBattles() {
    const b1 = reduceBattleStats([skillUsed(JIE, 1), skillUsed(JIE, 2), damage(JIE, 10, 3)], SCOPE);
    const b2 = reduceBattleStats([skillUsed(JIE, 1), damage(JIE, 20, 2)], SCOPE);
    const b3 = reduceBattleStats(
      [skillUsed(JIE, 1), skillUsed(JIE, 2), skillUsed(JIE, 3), damage(JIE, 30, 4)],
      SCOPE,
    );
    return { b1, b2, b3 };
  }

  it('逐字段相加（使用次数 / 伤害 / 命中）', () => {
    const { b1, b2, b3 } = threeBattles();
    const run = mergeAllBattleStats([b1, b2, b3]);
    expect(run.skillUses[JIE]).toBe(6);
    expect(run.skillDamage[JIE]).toBe(60);
    expect(run.skillHits[JIE]).toBe(3);
  });

  it('`ticks` 相加（整局总时长）', () => {
    const a = reduceBattleStats([skillUsed(JIE, 10)], SCOPE);
    const b = reduceBattleStats([skillUsed(JIE, 25)], SCOPE);
    expect(mergeBattleStats(a, b).ticks).toBe(35);
  });

  it('空数组累加 → EMPTY_BATTLE_STATS', () => {
    expect(mergeAllBattleStats([])).toEqual(EMPTY_BATTLE_STATS);
  });

  it('累加是纯函数（两份入参都没被改）', () => {
    const a = reduceBattleStats([skillUsed(JIE, 1)], SCOPE);
    const b = reduceBattleStats([skillUsed(JIE, 2)], SCOPE);
    const frozenA = structuredClone(a);
    const frozenB = structuredClone(b);
    mergeBattleStats(a, b);
    expect(a).toEqual(frozenA);
    expect(b).toEqual(frozenB);
  });

  it('不同技能各自累加，不会串', () => {
    const a = reduceBattleStats([skillUsed(JIE, 1), skillUsed(BREAK, 2)], SCOPE);
    const b = reduceBattleStats([skillUsed(BREAK, 3), skillUsed(DODGE, 4)], SCOPE);
    const run = mergeBattleStats(a, b);
    expect(run.skillUses[JIE]).toBe(1);
    expect(run.skillUses[BREAK]).toBe(2);
    expect(run.skillUses[DODGE]).toBe(1);
  });

  it('⚠️ `battles` 是**拼接**（顺序即时间顺序），不是"取最近一场"', () => {
    const withBattles = (battles: readonly { readonly won: boolean; readonly flawless: boolean }[]) => ({
      ...EMPTY_BATTLE_STATS,
      battles,
    });

    const acc = mergeBattleStats(
      withBattles([{ won: true, flawless: true }]),
      withBattles([{ won: false, flawless: false }]),
    );
    expect(acc.battles).toEqual([
      { won: true, flawless: true },
      { won: false, flawless: false },
    ]);
    // 长度 = 场数（可校验：`record.ts` 会与 `RunRecord.battles` 对账）
    expect(acc.battles).toHaveLength(2);
  });

  it('累加不含顶层 `flawless`（`Q-f`：逐场的在 `battles` 里）', () => {
    const acc = mergeBattleStats(
      { ...EMPTY_BATTLE_STATS, battles: [{ won: true, flawless: true }] },
      EMPTY_BATTLE_STATS,
    );
    expect('flawless' in acc).toBe(false);
  });

  it('整局统计可 JSON 往返', () => {
    const run = mergeBattleStats(
      { ...EMPTY_BATTLE_STATS, battles: [{ won: true, flawless: true }] },
      reduceBattleStats([damage(JIE, 5, 1)], SCOPE),
    );
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });
});
