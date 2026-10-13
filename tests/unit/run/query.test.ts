import { describe, expect, it } from 'vitest';

import type { EventDef } from '../../../src/core/events';
import {
  SKILL_STAT_IDS,
  isSkillStatId,
  readBattleStat,
  skillStatValue,
  statProgress,
  sumCounts,
  type BattleStatQuery,
} from '../../../src/core/run/query';
import {
  EMPTY_BATTLE_STATS,
  mergeBattleStats,
  reduceBattleStats,
  type BattleStats,
  type BattleStatsScope,
} from '../../../src/core/run/stats';

/**
 * `query.ts` 的单测 —— **读数那一半**（`Q-a` 拆出来的）。
 *
 * 与 `stats.test.ts` 的分工就是源码的分工：
 *   - 那边测"**造数**"（`EventDef[]` → `BattleStats`）
 *   - 这边测"**读数**"（`BattleStatQuery` → 数字，以及作用域 / 缺键 / 抛错）
 *
 * ⚠️ 本文件里出现 `reduceBattleStats` 是**造夹具**（要有一份统计才能读它），
 * 而 `stats.test.ts` 里**不出现** `readBattleStat` —— 单向的依赖让
 * "归约错了"必然在那边失败、不会在这边伪装成"查询错了"。
 */

const PLAYER = 'player';
const BOSS = 'meiichiro';
const JIE = 'jie';
const BREAK = 'break';

const SCOPE: BattleStatsScope = { actorId: PLAYER, outcome: 'victory', flawless: false };

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

function skillUsed(skillId: string, tick = 1): EventDef {
  return { kind: 'skillUsed', tick, sourceId: PLAYER, skillId };
}

function interrupt(sourceSkillId: string, tick = 1): EventDef {
  return {
    kind: 'interruptSuccess',
    tick,
    sourceId: PLAYER,
    targetId: BOSS,
    skillId: 'boss-cleave',
    sourceSkillId,
  };
}

function avoided(reason: 'dodged' | 'immune', tick = 1): EventDef {
  return { kind: 'avoided', tick, sourceId: BOSS, targetId: PLAYER, skillId: 'boss-cleave', reason };
}

/** 造一份统计（默认单场视角）。 */
function statsOf(events: readonly EventDef[], scope: BattleStatsScope = SCOPE): BattleStats {
  return reduceBattleStats(events, scope);
}

/** 造一份"若干场"的整局统计（`battles` 是唯一的骨架）。 */
function runWith(results: readonly { won: boolean; flawless: boolean }[]): BattleStats {
  return results.reduce(
    (acc, r) => mergeBattleStats(acc, { ...EMPTY_BATTLE_STATS, battles: [r] }),
    EMPTY_BATTLE_STATS,
  );
}

describe('readBattleStat —— 技能级维度', () => {
  it('四个维度各读各的（同一份统计、四个数）', () => {
    const stats = statsOf([
      skillUsed(JIE, 1),
      skillUsed(JIE, 2),
      damage(JIE, 10, 3),
      damage(JIE, 20, 4),
      interrupt(JIE, 5),
    ]);
    const at = (s: 'skillUses' | 'skillDamage' | 'skillHits' | 'skillInterrupts') =>
      readBattleStat({ s, skillId: JIE, scope: 'battle' }, stats, undefined);
    expect(at('skillUses')).toBe(2);
    expect(at('skillDamage')).toBe(30);
    expect(at('skillHits')).toBe(2);
    expect(at('skillInterrupts')).toBe(1);
  });

  it('没见过的技能 id → 0（缺键）', () => {
    const stats = statsOf([damage(JIE, 5, 1)]);
    for (const s of SKILL_STAT_IDS) {
      expect(readBattleStat({ s, skillId: 'nope', scope: 'battle' }, stats, undefined)).toBe(0);
    }
  });

  it('空统计 → 全 0（不是 undefined / NaN）', () => {
    for (const s of SKILL_STAT_IDS) {
      const value = readBattleStat({ s, skillId: JIE, scope: 'battle' }, EMPTY_BATTLE_STATS, undefined);
      expect(value).toBe(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('readBattleStat —— 作用域（⚠️ 本文件存在的核心理由）', () => {
  const battle = statsOf([skillUsed(JIE, 1)]);
  const run = mergeBattleStats(battle, statsOf([skillUsed(JIE, 1)]));

  it('⚠️ 单场作用域与整局作用域是**两个**数（同一份数据、两个答案）', () => {
    // 这是"scope 必须是查询的一部分"的可执行证据：
    // 这一场用了 1 次截，整局一共 2 次。
    expect(readBattleStat({ s: 'skillUses', skillId: JIE, scope: 'battle' }, battle, run)).toBe(1);
    expect(readBattleStat({ s: 'skillUses', skillId: JIE, scope: 'run' }, battle, run)).toBe(2);
  });

  it('缺 `runStats` 而又问 `scope: run` → **抛错**（不静默回落到 battle）', () => {
    // ⚠️ 这条是"作用域不会被静默搞错"的唯一保障：静默回落会让
    // "整局累计"读到这一场的数，而那看起来完全正常（只是偏小）。
    expect(() =>
      readBattleStat({ s: 'skillUses', skillId: JIE, scope: 'run' }, battle, undefined),
    ).toThrow(/scope 'run' requires runStats/);
  });

  it('缺 `battleStats` 而又问 `scope: battle` → **抛错**', () => {
    expect(() =>
      readBattleStat({ s: 'skillUses', skillId: JIE, scope: 'battle' }, undefined, run),
    ).toThrow(/scope 'battle' requires battleStats/);
  });

  it('同一份统计同时当两份传也照常工作（lifecycle 的结算判定就是这么用的）', () => {
    expect(readBattleStat({ s: 'skillUses', skillId: JIE, scope: 'battle' }, battle, battle)).toBe(1);
    expect(readBattleStat({ s: 'skillUses', skillId: JIE, scope: 'run' }, battle, battle)).toBe(1);
  });

  it('⚠️ 两份传同一个值时 battle / run 读到**相同**的数（这是有意的，不是 bug）', () => {
    /**
     * `lifecycle.ts` 的 `unlockStatsOf` 就是这么传的：在**结算那一刻**，
     * 这一场的统计已经被 `mergeBattleStats` 并进整局了，所以两份是同一个
     * 对象。后果：现在写 `scope:'battle'` 与 `scope:'run'` 的炁机**行为相同**。
     *
     * 这条用例把这个"会让人困惑"的事实**钉成断言**（而不是让它藏在注释里）：
     * 它现在是**有意**的（§5.2："这一场结束后用累计值判定"），
     * 而分叉点在 P3 的卡片文案与将来的战斗内判定（见 `query.ts` 的文件头）。
     *
     * ⚠️ 如果有一天这条断言失败了，说明"结算时两份不再相同" ——
     * 那是一次**语义变更**，该去改 `unlockStatsOf` 与文档，而不是改这条断言。
     */
    const same = mergeBattleStats(statsOf([skillUsed(JIE, 1)]), statsOf([skillUsed(JIE, 1)]));
    const q = (scope: 'battle' | 'run'): BattleStatQuery => ({ s: 'skillUses', skillId: JIE, scope });
    expect(readBattleStat(q('battle'), same, same)).toBe(2);
    expect(readBattleStat(q('run'), same, same)).toBe(2);
  });
});

describe('readBattleStat —— 闪避的语义（`Q-c`）', () => {
  it('`dodges` **只数 `dodged`**，不数 `immune`', () => {
    // `immune` 是"这一下打不动我"（机制免疫，不用玩家做任何事），
    // 不是"成功闪避"。数进去会让"闪避流"的进度在挨机制时白涨。
    const stats = statsOf([avoided('dodged'), avoided('dodged'), avoided('immune')]);
    expect(readBattleStat({ s: 'dodges', scope: 'battle' }, stats, undefined)).toBe(2);
  });

  it('⚠️ `immune` 在归约里存着，但**没有查询能拿到它** —— 这是"死值先删"的边界', () => {
    // 将来要数免疫：加一个 `{ s: 'immunes' }`，**不要**改 `dodges` 的语义
    // （那会让已经写好的炁机数字突然变大）。
    const stats = statsOf([avoided('immune')]);
    expect(stats.dodges['immune']).toBe(1);
    expect(readBattleStat({ s: 'dodges', scope: 'battle' }, stats, undefined)).toBe(0);
    // 所有现有查询里没有一个会读到它
    for (const s of SKILL_STAT_IDS) {
      expect(readBattleStat({ s, skillId: 'immune', scope: 'battle' }, stats, undefined)).toBe(0);
    }
  });

  it('`dodges` 也遵守作用域（整局累计）', () => {
    const b1 = statsOf([avoided('dodged')]);
    const run = mergeBattleStats(b1, statsOf([avoided('dodged'), avoided('dodged')]));
    expect(readBattleStat({ s: 'dodges', scope: 'battle' }, b1, run)).toBe(1);
    expect(readBattleStat({ s: 'dodges', scope: 'run' }, b1, run)).toBe(3);
  });
});

describe('readBattleStat —— battlesWon / flawlessBattles（从逐场结果过滤）', () => {
  it('整局：赢了几场 / 满血赢了几场', () => {
    const run = runWith([
      { won: true, flawless: true },
      { won: true, flawless: false },
      { won: true, flawless: false },
      { won: false, flawless: false },
    ]);
    expect(readBattleStat({ s: 'battlesWon', scope: 'run' }, undefined, run)).toBe(3);
    expect(readBattleStat({ s: 'flawlessBattles', scope: 'run' }, undefined, run)).toBe(1);
  });

  it('单场：这一场赢了吗（0 / 1）—— 同一个查询、另一个作用域', () => {
    const win = runWith([{ won: true, flawless: false }]);
    const lose = runWith([{ won: false, flawless: false }]);
    expect(readBattleStat({ s: 'battlesWon', scope: 'battle' }, win, undefined)).toBe(1);
    expect(readBattleStat({ s: 'battlesWon', scope: 'battle' }, lose, undefined)).toBe(0);
    expect(readBattleStat({ s: 'flawlessBattles', scope: 'battle' }, win, undefined)).toBe(0);
  });

  it('⚠️ 不是"计数器"：3 场赢 2 场读出 2，而**不是** 1 或 3', () => {
    // 一个"用布尔取或"或"取最近一场"的实现会给出 1 / 0。
    const run = runWith([
      { won: true, flawless: false },
      { won: false, flawless: false },
      { won: true, flawless: false },
    ]);
    expect(readBattleStat({ s: 'battlesWon', scope: 'run' }, undefined, run)).toBe(2);
  });

  it('`battles` 缺失时按 0（还没打过）', () => {
    expect(readBattleStat({ s: 'battlesWon', scope: 'run' }, undefined, EMPTY_BATTLE_STATS)).toBe(0);
    expect(
      readBattleStat({ s: 'flawlessBattles', scope: 'run' }, undefined, EMPTY_BATTLE_STATS),
    ).toBe(0);
  });
});

describe('statProgress —— 给 QijiSelect 的"2/3"', () => {
  it('与 `readBattleStat` 同源（进度条那个数不是第二份实现）', () => {
    const stats = statsOf([interrupt(JIE, 1), interrupt(JIE, 2)]);
    const q: BattleStatQuery = { s: 'skillInterrupts', skillId: JIE, scope: 'battle' };
    expect(statProgress(q, stats, undefined)).toBe(readBattleStat(q, stats, undefined));
    expect(statProgress(q, stats, undefined)).toBe(2);
  });

  it('⚠️ 伤害条件的进度是**伤害值**，不是次数', () => {
    // 这正是"skillDamage 退化成计数"会被抓住的地方：次数永远是 [0, 3]，
    // 而 120 伤害必须报 120。
    const stats = statsOf([damage(JIE, 40, 1), damage(JIE, 40, 2)]);
    expect(statProgress({ s: 'skillDamage', skillId: JIE, scope: 'battle' }, stats, undefined)).toBe(80);
  });

  it('缺那份统计时同样抛错（不静默返回 0 —— 0 会让卡片显示"0/3"而其实没读到）', () => {
    expect(() =>
      statProgress({ s: 'skillUses', skillId: JIE, scope: 'run' }, undefined, undefined),
    ).toThrow(/requires runStats/);
  });
});

describe('sumCounts / skillStatValue —— 派生量现算', () => {
  it('`sumCounts` 求一张表的总和（"总伤害"不另存一份）', () => {
    const stats = statsOf([damage(JIE, 10, 1), damage(BREAK, 5, 2)]);
    expect(sumCounts(stats.skillDamage)).toBe(15);
    expect(sumCounts(stats.skillHits)).toBe(2);
    expect(sumCounts(stats.skillUses)).toBe(0);
  });

  it('`skillStatValue` 缺键 = 0', () => {
    expect(skillStatValue({ a: 1 }, 'b')).toBe(0);
    expect(skillStatValue({}, 'a')).toBe(0);
    expect(skillStatValue({ a: 1 }, 'a')).toBe(1);
  });

  it('空表求和 = 0', () => {
    expect(sumCounts({})).toBe(0);
  });

  it('`skillStatValue` 把缺键与显式的 0 都当 0（不区分）', () => {
    // 记录一下这个约定：缺键与 0 不可区分。现在没差别（没有负数计数器），
    // 将来若引入"可以是负数的计数"，这里要重新想。
    expect(skillStatValue({}, 'a')).toBe(skillStatValue({ a: 0 }, 'a'));
  });
});

describe('SkillStatId 的联合与运行期清单一致', () => {
  /**
   * ⚠️ **5 个维度**（P3 加了 `skillAvoids`）。
   *
   * `skillAvoids` 与另外四个的区别写在 `query.ts` 的类型注释里：
   * 它按 `avoided.viaBuffId` 分（"是哪个 buff 挡下的"），而不是按技能 id。
   * 这一条断言的作用是"加维度必须同时改这里"—— 而它**已经**在 P3 生效过一次
   * （加 `skillAvoids` 时这条先红，逼着人确认"运行期清单与联合一致"）。
   */
  it('5 个维度，恰好是这 5 个', () => {
    expect([...SKILL_STAT_IDS].sort()).toEqual([
      'skillAvoids',
      'skillDamage',
      'skillHits',
      'skillInterrupts',
      'skillUses',
    ]);
  });

  it('每个合法维度都被守卫认出来；拼错的被拦住', () => {
    for (const id of SKILL_STAT_IDS) expect(isSkillStatId(id)).toBe(true);
    expect(isSkillStatId('skillDamages')).toBe(false);
    expect(isSkillStatId('skilldamage')).toBe(false);
    expect(isSkillStatId('')).toBe(false);
    expect(isSkillStatId(3)).toBe(false);
    expect(isSkillStatId(undefined)).toBe(false);
  });

  it('没有重复项', () => {
    expect(SKILL_STAT_IDS.length).toBe(new Set(SKILL_STAT_IDS).size);
  });

  it('⚠️ 每个运行期清单里的 id 都真的能读（清单与 `readSkillCounts` 的 switch 一致）', () => {
    // 若往 `SkillStatId` 加了成员却忘了在 `readSkillCounts` 里加分支，
    // `readBattleStat` 会返回 `undefined`（不是数字）—— 这条会抓到。
    const stats = statsOf([]);
    for (const s of SKILL_STAT_IDS) {
      const value = readBattleStat({ s, skillId: JIE, scope: 'battle' }, stats, undefined);
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
