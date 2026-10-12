import { describe, expect, it } from 'vitest';

import type { EventDef } from '../../../src/core/events';
import type { QijiEntity, QijiUnlock } from '../../../src/core/types/qiji';
import {
  evalUnlock,
  isUnlocked,
  maxStacksOf,
  nextCandidates,
  stacksOf,
  unlockedIds,
  unlockProgress,
} from '../../../src/core/run/unlock';
import { reduceBattleStats, type BattleStats } from '../../../src/core/run/stats';

/**
 * 解锁判定 + 候选生成的单测。
 *
 * ⚠️ 这些用例**从事件数组造统计**（不起引擎），然后求值条件。
 * 第一版的形状是"喂计数器的数字"（`{ jieInterrupts: 3 }`），
 * §5.2 的方向修正之后不再有计数器 —— 统计是事件流的只读派生，
 * 所以这里也照"喂事件"的形状写，与 `lifecycle.test.ts` 一致。
 *
 * 炁机用**最小的假对象**：判定只读 `id` / `unlock` / `maxStacks`，
 * 所以不必给每个假炁机补齐 `nameKey` / `icon` / `abilities` / `category`。
 */

const PLAYER = 'player';
const JIE = 'jie';
const BREAK = 'break';

function used(skillId: string, tick = 1, sourceId = PLAYER): EventDef {
  return { kind: 'skillUsed', tick, sourceId, skillId };
}

function dmg(skillId: string, amount: number, tick = 1, sourceId = PLAYER): EventDef {
  return {
    kind: 'damage',
    tick,
    sourceId,
    targetId: sourceId === PLAYER ? 'meiichiro' : PLAYER,
    amount,
    crit: false,
    absorbed: 0,
    thinned: 0,
    overkill: 0,
    skillId,
  };
}

function interrupted(sourceSkillId: string, tick = 1): EventDef {
  return {
    kind: 'interruptSuccess',
    tick,
    sourceId: PLAYER,
    targetId: 'meiichiro',
    skillId: 'boss-cleave',
    sourceSkillId,
  };
}

function dodged(tick = 1): EventDef {
  return {
    kind: 'avoided',
    tick,
    sourceId: 'meiichiro',
    targetId: PLAYER,
    skillId: 'boss-cleave',
    reason: 'dodged',
  };
}

/** 从一个事件数组造一份统计（默认当"整局"，因为它就是累加容器）。 */
function statsOf(events: readonly EventDef[]): BattleStats {
  return reduceBattleStats(events, { actorId: PLAYER, outcome: 'victory', flawless: false });
}

/** 造 n 条"用 `skillId` 打断成功"的事件。 */
function interrupts(skillId: string, n: number): EventDef[] {
  return Array.from({ length: n }, (_, i) => interrupted(skillId, i + 1));
}

/** 造 n 条"用 `skillId` 出手"的事件。 */
function uses(skillId: string, n: number): EventDef[] {
  return Array.from({ length: n }, (_, i) => used(skillId, i + 1));
}

/** 造 n 条真闪避。 */
function dodges(n: number): EventDef[] {
  return Array.from({ length: n }, (_, i) => dodged(i + 1));
}

/**
 * "整局"求值：`battleStats` 与 `runStats` 传同一份（在结算那一刻
 * 它们本来就是同一份东西，见 `lifecycle.ts` 的 `unlockStatsOf` 说明）。
 */
function statsFor(events: readonly EventDef[]): { battleStats: BattleStats; runStats: BattleStats } {
  const stats = statsOf(events);
  return { battleStats: stats, runStats: stats };
}

function evalRun(unlock: QijiUnlock, events: readonly EventDef[]): boolean {
  return evalUnlock(unlock, statsFor(events));
}

function qiji(id: string, unlock: QijiUnlock, maxStacks?: number): QijiEntity {
  return {
    id,
    // ⚠️ P0 只能用 `GameEntity['kind']` 里已有的值：`'qiji'` 还不在
    // `EntityKind` 里（**W8**，P6 才做）。详见 `QijiEntity.kind` 的说明。
    kind: 'passive',
    nameKey: `qiji.${id}.name`,
    descKey: `qiji.${id}.desc`,
    icon: 'char_break',
    category: 'offense',
    unlock,
    abilities: [],
    ...(maxStacks === undefined ? {} : { maxStacks }),
  };
}

const ALWAYS: QijiUnlock = { kind: 'always', of: [] };

/** 「截」成功打断 3 次（§5.2 的例子：`jieDeriveStrike`）。 */
const JIE_3: QijiUnlock = {
  kind: 'statAtLeast',
  stat: { s: 'skillInterrupts', skillId: JIE, scope: 'run' },
  value: 3,
};

/** 「截」造成 100 伤害（用户点名的第一条要求）。 */
const JIE_DAMAGE_100: QijiUnlock = {
  kind: 'statAtLeast',
  stat: { s: 'skillDamage', skillId: JIE, scope: 'battle' },
  value: 100,
};

describe('evalUnlock —— 叶子条件', () => {
  it('always 恒真（连一个事件都没有也真）', () => {
    expect(evalRun(ALWAYS, [])).toBe(true);
    expect(evalRun(ALWAYS, [used(JIE, 1)])).toBe(true);
  });

  it('statAtLeast 是 >= 而不是 >（第 3 次打断就该解锁）', () => {
    expect(evalRun(JIE_3, [])).toBe(false);
    expect(evalRun(JIE_3, interrupts(JIE, 2))).toBe(false);
    expect(evalRun(JIE_3, interrupts(JIE, 3))).toBe(true);
    expect(evalRun(JIE_3, interrupts(JIE, 4))).toBe(true);
  });

  it('没数到的维度 = 0：value 为 0 的条件恒真', () => {
    const zero: QijiUnlock = {
      kind: 'statAtLeast',
      stat: { s: 'dodges', scope: 'run' },
      value: 0,
    };
    expect(evalRun(zero, [])).toBe(true);
  });

  it('⚠️ **按技能分开**：「破」打断 3 次**不会**解锁要求「截」的条件', () => {
    // 这是本形状相对第一版（封闭计数器联合）最关键的差别：
    // 旧形状里两者都是同一个 `interrupts`，所以这条断言当时**写不出来**。
    expect(evalRun(JIE_3, interrupts(BREAK, 3))).toBe(false);
    expect(evalRun(JIE_3, interrupts(JIE, 3))).toBe(true);
  });

  it('⚠️ 用户点名的第一条：某个技能造成伤害数（**求和**，不是次数）', () => {
    // 3 次截打 40 / 40 / 40 = 120 >= 100 → 真
    expect(evalRun(JIE_DAMAGE_100, [dmg(JIE, 40, 1), dmg(JIE, 40, 2), dmg(JIE, 40, 3)])).toBe(true);
    // 只有 2 次（80 伤害）→ 假。**若把伤害退化成计数**，3 次就变成 3 < 100 → 这里会假
    expect(evalRun(JIE_DAMAGE_100, [dmg(JIE, 40, 1), dmg(JIE, 40, 2)])).toBe(false);
  });

  it('维度互相独立（数「闪避」不会顺带解锁「截」）', () => {
    const dodgeUnlock: QijiUnlock = {
      kind: 'statAtLeast',
      stat: { s: 'dodges', scope: 'run' },
      value: 3,
    };
    expect(evalRun(dodgeUnlock, interrupts(JIE, 10))).toBe(false);
    expect(evalRun(dodgeUnlock, dodges(3))).toBe(true);
  });

  it('⚠️ 作用域独立：`scope: battle` 与 `scope: run` 是两个答案', () => {
    /**
     * 造一份"整局 3 次打断、但这一场只有 1 次"的局面。
     *
     * ⚠️ 这条用例是"scope 不会被静默搞错"的行为证据：
     * 两个条件的**唯一**差别是 `scope`，而它们对同一份统计给出不同答案。
     * 若实现把 `scope: 'battle'` 当成 run 处理（或反之），
     * 两条断言里必然有一条失败。
     */
    const runStats = statsOf([...interrupts(JIE, 2), ...interrupts(JIE, 1)]);
    // 这一场（假设只有 1 次）：手工造一份单场统计
    const battleStats = statsOf(interrupts(JIE, 1));
    const battleScope: QijiUnlock = {
      kind: 'statAtLeast',
      stat: { s: 'skillInterrupts', skillId: JIE, scope: 'battle' },
      value: 3,
    };
    const runScope: QijiUnlock = {
      kind: 'statAtLeast',
      stat: { s: 'skillInterrupts', skillId: JIE, scope: 'run' },
      value: 3,
    };
    const stats = { battleStats, runStats };
    expect(evalUnlock(battleScope, stats)).toBe(false);
    expect(evalUnlock(runScope, stats)).toBe(true);
  });
});

describe('evalUnlock —— 组合子', () => {
  /** 「闪」成功 2 次。 */
  const DODGES_2: QijiUnlock = {
    kind: 'statAtLeast',
    stat: { s: 'dodges', scope: 'run' },
    value: 2,
  };

  it('all：全部满足才真', () => {
    const both: QijiUnlock = { kind: 'all', of: [JIE_3, DODGES_2] };
    expect(evalRun(both, interrupts(JIE, 3))).toBe(false);
    expect(evalRun(both, dodges(2))).toBe(false);
    expect(evalRun(both, [...interrupts(JIE, 3), ...dodges(2)])).toBe(true);
  });

  it('any：任一项满足就真', () => {
    const either: QijiUnlock = { kind: 'any', of: [JIE_3, DODGES_2] };
    expect(evalRun(either, [])).toBe(false);
    expect(evalRun(either, dodges(2))).toBe(true);
    expect(evalRun(either, interrupts(JIE, 3))).toBe(true);
  });

  it('not：取反', () => {
    const notJie: QijiUnlock = { kind: 'not', of: JIE_3 };
    expect(evalRun(notJie, interrupts(JIE, 2))).toBe(true);
    expect(evalRun(notJie, interrupts(JIE, 3))).toBe(false);
  });

  it('⚠️ 空 all 恒真、空 any 恒假（全称 / 存在量词的取值，写死以免被"顺手改对"）', () => {
    expect(evalRun({ kind: 'all', of: [] }, [])).toBe(true);
    expect(evalRun({ kind: 'any', of: [] }, [])).toBe(false);
  });

  it('⚠️ 用户点名的第二条的**组合**版：同时用了 3 次截与 2 次破', () => {
    // "一场战斗同时用了 n 次 a 和 m 次 b" —— 用 `all` + 两条 skillUses 查询表达。
    const combo: QijiUnlock = {
      kind: 'all',
      of: [
        { kind: 'statAtLeast', stat: { s: 'skillUses', skillId: JIE, scope: 'battle' }, value: 3 },
        { kind: 'statAtLeast', stat: { s: 'skillUses', skillId: BREAK, scope: 'battle' }, value: 2 },
      ],
    };
    expect(evalRun(combo, [...uses(JIE, 3), ...uses(BREAK, 1)])).toBe(false);
    expect(evalRun(combo, [...uses(JIE, 2), ...uses(BREAK, 2)])).toBe(false);
    expect(evalRun(combo, [...uses(JIE, 3), ...uses(BREAK, 2)])).toBe(true);
  });

  it('嵌套组合（all 里套 any 与 not）', () => {
    const dodge5: QijiUnlock = {
      kind: 'statAtLeast',
      stat: { s: 'dodges', scope: 'run' },
      value: 5,
    };
    const break10: QijiUnlock = {
      kind: 'statAtLeast',
      stat: { s: 'skillUses', skillId: BREAK, scope: 'run' },
      value: 10,
    };
    const nested: QijiUnlock = {
      kind: 'all',
      of: [{ kind: 'not', of: dodge5 }, { kind: 'any', of: [JIE_3, break10] }],
    };
    expect(evalRun(nested, interrupts(JIE, 3))).toBe(true);
    expect(evalRun(nested, uses(BREAK, 10))).toBe(true);
    expect(evalRun(nested, interrupts(JIE, 2))).toBe(false);
    // 闪避到 5 之后，第一个 not 不再满足 → 整体假
    expect(evalRun(nested, [...interrupts(JIE, 9), ...dodges(5)])).toBe(false);
  });
});

describe('unlockProgress —— 给 QijiSelect 的"2/3"', () => {
  const runStatsOf = (events: readonly EventDef[]) => {
    const stats = statsOf(events);
    return { battleStats: stats, runStats: stats };
  };

  it('叶子条件报"已满足到几 / 要求几"', () => {
    expect(unlockProgress(JIE_3, runStatsOf([]))).toEqual({
      complete: false,
      current: 0,
      required: 3,
      items: [],
    });
    expect(unlockProgress(JIE_3, runStatsOf(interrupts(JIE, 2)))).toEqual({
      complete: false,
      current: 2,
      required: 3,
      items: [],
    });
    expect(unlockProgress(JIE_3, runStatsOf(interrupts(JIE, 3))).complete).toBe(true);
    // 超过要求值时 current 照实报（不是被截到 required）—— 文案层要能看出"够了多少"
    expect(unlockProgress(JIE_3, runStatsOf(interrupts(JIE, 5))).current).toBe(5);
  });

  it('⚠️ 伤害条件的进度是**伤害值**，不是次数', () => {
    // 这正是"skillDamage 退化成计数"会被抓住的地方：次数永远是
    // [0, 3]，而 120 伤害必须报 120。
    const progress = unlockProgress(JIE_DAMAGE_100, runStatsOf([dmg(JIE, 40, 1), dmg(JIE, 40, 2)]));
    expect(progress.current).toBe(80);
    expect(progress.required).toBe(100);
    expect(progress.complete).toBe(false);
  });

  it('always 报 1/1 且 complete', () => {
    expect(unlockProgress(ALWAYS, runStatsOf([]))).toEqual({
      complete: true,
      current: 1,
      required: 1,
      items: [],
    });
  });

  it('组合条件数的是**叶子条件**个数（嵌套一层不会看起来要求更少）', () => {
    // 平铺：2 个叶子。嵌套一层：**还是** 2 个叶子（不是"1 个直接子条件"）。
    // 若 `required` 数的是直接子条件，一个"截3 + all[闪避2]"会报 2，
    // 而一个"截3 + 闪避2"也报 2 —— 但两者的实际工作量一样，所以
    // 前者必须也报 2（叶子数）。
    const flat: QijiUnlock = {
      kind: 'all',
      of: [
        JIE_3,
        { kind: 'statAtLeast', stat: { s: 'dodges', scope: 'run' }, value: 2 },
      ],
    };
    const nested: QijiUnlock = { kind: 'all', of: [JIE_3, { kind: 'all', of: [JIE_3] }] };
    expect(unlockProgress(flat, runStatsOf([])).required).toBe(2);
    expect(unlockProgress(nested, runStatsOf([])).required).toBe(2);
    expect(unlockProgress(nested, runStatsOf([])).items).toHaveLength(2);
    expect(unlockProgress(nested, runStatsOf([])).items[1]?.required).toBe(1);
  });

  it('组合条件的 current = 已满足的叶子数', () => {
    const both: QijiUnlock = {
      kind: 'all',
      of: [
        JIE_3,
        { kind: 'statAtLeast', stat: { s: 'dodges', scope: 'run' }, value: 2 },
      ],
    };
    const progress = unlockProgress(both, runStatsOf(interrupts(JIE, 3)));
    expect(progress.current).toBe(1);
    expect(progress.required).toBe(2);
    expect(progress.complete).toBe(false);
  });

  it('complete 与 evalUnlock 永远一致（同一个真相源，抽查一批输入）', () => {
    const conditions: readonly QijiUnlock[] = [
      ALWAYS,
      JIE_3,
      JIE_DAMAGE_100,
      { kind: 'all', of: [] },
      { kind: 'any', of: [] },
      { kind: 'not', of: JIE_3 },
      { kind: 'all', of: [JIE_3, { kind: 'any', of: [{ kind: 'statAtLeast', stat: { s: 'dodges', scope: 'run' }, value: 1 }] }] },
    ];
    const eventSets: readonly (readonly EventDef[])[] = [
      [],
      interrupts(JIE, 1),
      interrupts(JIE, 3),
      dodges(1),
      [...interrupts(JIE, 3), ...dodges(1)],
      [dmg(JIE, 200, 1)],
    ];
    for (const condition of conditions) {
      for (const events of eventSets) {
        const stats = runStatsOf(events);
        expect(unlockProgress(condition, stats).complete).toBe(evalUnlock(condition, stats));
      }
    }
  });
});

describe('isUnlocked / unlockedIds', () => {
  const POOL: readonly QijiEntity[] = [
    qiji('vitality', ALWAYS),
    qiji('breath', ALWAYS),
    qiji('jieDeriveStrike', JIE_3),
  ];

  it('isUnlocked 只读这个炁机自己的条件', () => {
    const strike = POOL[2];
    expect(strike).toBeDefined();
    if (strike === undefined) return;
    expect(isUnlocked(strike, statsFor([]))).toBe(false);
    expect(isUnlocked(strike, statsFor(interrupts(JIE, 3)))).toBe(true);
  });

  it('unlockedIds 按 pool 的顺序给出 id（顺序确定，便于 diff 与截图）', () => {
    expect(unlockedIds(POOL, statsFor([]))).toEqual(['vitality', 'breath']);
    expect(unlockedIds(POOL, statsFor(interrupts(JIE, 3)))).toEqual([
      'vitality',
      'breath',
      'jieDeriveStrike',
    ]);
  });
});

describe('nextCandidates —— 每场战斗后的候选生成', () => {
  const POOL: readonly QijiEntity[] = [
    qiji('vitality', ALWAYS, 3),
    qiji('breath', ALWAYS, 2),
    qiji('jieDeriveStrike', JIE_3),
  ];

  it('开局：只有 always 的在候选里', () => {
    const candidates = nextCandidates(POOL, statsFor([]), []);
    expect(candidates.map((c) => c.qiji.id)).toEqual(['vitality', 'breath']);
  });

  it('喂了"3 次截打断"的事件之后，机制炁机进候选（这就是"喂事件流 → 解锁"）', () => {
    const candidates = nextCandidates(POOL, statsFor(interrupts(JIE, 3)), []);
    expect(candidates.map((c) => c.qiji.id)).toEqual(['vitality', 'breath', 'jieDeriveStrike']);
  });

  it('差一次就不进候选（边界 2 vs 3）', () => {
    expect(nextCandidates(POOL, statsFor(interrupts(JIE, 2)), []).map((c) => c.qiji.id)).toEqual([
      'vitality',
      'breath',
    ]);
  });

  it('候选顺序 = pool 的顺序（不按解锁时间、不随机）', () => {
    // 顺序变了 = `QijiSelect` 的默认光标落在别的东西上，截图也会跟着变。
    const reversed = [...POOL].reverse();
    expect(nextCandidates(reversed, statsFor(interrupts(JIE, 3)), []).map((c) => c.qiji.id)).toEqual([
      'jieDeriveStrike',
      'breath',
      'vitality',
    ]);
  });

  it('已叠满的从候选里消失（maxStacks 默认 1）', () => {
    const chosen = [{ qijiId: 'vitality', stacks: 3 }];
    expect(nextCandidates(POOL, statsFor([]), chosen).map((c) => c.qiji.id)).toEqual(['breath']);
  });

  it('remainingStacks 反映还能选几次', () => {
    const candidates = nextCandidates(POOL, statsFor([]), [{ qijiId: 'vitality', stacks: 2 }]);
    const vitality = candidates.find((c) => c.qiji.id === 'vitality');
    expect(vitality?.remainingStacks).toBe(1);
    // 没选过的按上限
    expect(candidates.find((c) => c.qiji.id === 'breath')?.remainingStacks).toBe(2);
    // 默认上限 1
    expect(
      nextCandidates(POOL, statsFor(interrupts(JIE, 3)), []).find(
        (c) => c.qiji.id === 'jieDeriveStrike',
      )?.remainingStacks,
    ).toBe(1);
  });

  it('解锁了但叠满 → 不出现（两个条件都要满足才进候选）', () => {
    const chosen = [{ qijiId: 'vitality', stacks: 3 }, { qijiId: 'jieDeriveStrike', stacks: 1 }];
    expect(nextCandidates(POOL, statsFor(interrupts(JIE, 9)), chosen).map((c) => c.qiji.id)).toEqual([
      'breath',
    ]);
  });

  it('P0 的兜底保证：候选永不为空（只要池子里有 always 的通用炁机）', () => {
    // §5.4 / §12 决议 #12："已解锁只有 1 个时跳过选择屏"不会发生。
    // 这条把那个保证写成一个**可失败的**断言：池子里只要有 always，
    // 无论计数器多难看、选了多少次，候选都还有东西。
    const generic = [qiji('vitality', ALWAYS, 3), qiji('breath', ALWAYS, 2)];
    let chosen: { qijiId: string; stacks: number }[] = [];
    for (let round = 0; round < 5; round += 1) {
      const candidates = nextCandidates(generic, statsFor([]), chosen);
      expect(candidates.length).toBeGreaterThan(0);
      const first = candidates[0];
      if (first === undefined) break;
      const stacks = stacksOf(chosen, first.qiji.id) + 1;
      chosen = [...chosen.filter((c) => c.qijiId !== first.qiji.id), { qijiId: first.qiji.id, stacks }];
    }
    // 5 次之后（生命 3 + 炁回复 2 = 5 层全满）候选才可能空
    expect(nextCandidates(generic, statsFor([]), chosen)).toEqual([]);
  });
});

describe('maxStacksOf / stacksOf', () => {
  it('默认 1 层', () => {
    expect(maxStacksOf(qiji('a', ALWAYS))).toBe(1);
    expect(maxStacksOf(qiji('a', ALWAYS, 3))).toBe(3);
  });

  it('没选过 = 0；选了多层照实报', () => {
    expect(stacksOf([], 'vitality')).toBe(0);
    expect(stacksOf([{ qijiId: 'vitality', stacks: 2 }], 'vitality')).toBe(2);
    expect(stacksOf([{ qijiId: 'vitality', stacks: 2 }], 'breath')).toBe(0);
  });
});
