import { describe, expect, it } from 'vitest';

import type { QijiEntity, QijiUnlock, RunCounters } from '../../../src/core/types/qiji';
import {
  evalUnlock,
  isUnlocked,
  maxStacksOf,
  nextCandidates,
  stacksOf,
  unlockedIds,
  unlockProgress,
} from '../../../src/core/run/unlock';

/**
 * 解锁判定 + 候选生成的单测（P0 验收第二条的**判定那一半**）。
 *
 * ⚠️ 这些用例**直接喂数字**（`{ jieInterrupts: 3 }`），**不造假的
 * 战斗内计数器** —— 计数由引擎（W1 / W3，P1）产生，P0 只累加。
 * 一条"为了跑通测试自己写个小计数器"的测试会掩盖"接口形状接不上引擎"
 * 这件事，而那正是 P0 唯一要定死的东西。
 *
 * 炁机用**最小的假对象**：判定只读 `id` / `unlock` / `maxStacks`，
 * 所以不必给每个假炁机补齐 `nameKey` / `icon` / `abilities` / `category`。
 * `kind` 填 `'passive'`（而不是 `'qiji'`）—— `'qiji'` 还不在
 * `EntityKind` 里（**W8**，P6 才做），这一点写在 `QijiEntity.kind` 的说明里。
 */
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

/** 「截」成功 3 次（§5.2 的例子：`jieDeriveStrike`）。 */
const JIE_3: QijiUnlock = { kind: 'counterAtLeast', counter: 'jieInterrupts', value: 3 };

describe('evalUnlock —— 叶子条件', () => {
  it('always 恒真（连 0 计数也真）', () => {
    expect(evalUnlock(ALWAYS, {})).toBe(true);
    expect(evalUnlock(ALWAYS, { jieInterrupts: 0 })).toBe(true);
  });

  it('counterAtLeast 是 >= 而不是 >（第 3 次就该解锁）', () => {
    expect(evalUnlock(JIE_3, {})).toBe(false);
    expect(evalUnlock(JIE_3, { jieInterrupts: 2 })).toBe(false);
    expect(evalUnlock(JIE_3, { jieInterrupts: 3 })).toBe(true);
    expect(evalUnlock(JIE_3, { jieInterrupts: 4 })).toBe(true);
  });

  it('缺键等于 0：value 为 0 的条件恒真，且不需要键存在', () => {
    const zero: QijiUnlock = { kind: 'counterAtLeast', counter: 'dodges', value: 0 };
    expect(evalUnlock(zero, {})).toBe(true);
  });

  it('四个计数器互相独立（数「闪避」不会顺带解锁「截」）', () => {
    const dodges: QijiUnlock = { kind: 'counterAtLeast', counter: 'dodges', value: 3 };
    expect(evalUnlock(dodges, { jieInterrupts: 10 })).toBe(false);
    expect(evalUnlock(dodges, { dodges: 3 })).toBe(true);
  });
});

describe('evalUnlock —— 组合子', () => {
  it('all：全部满足才真', () => {
    const both: QijiUnlock = {
      kind: 'all',
      of: [JIE_3, { kind: 'counterAtLeast', counter: 'dodges', value: 2 }],
    };
    expect(evalUnlock(both, { jieInterrupts: 3 })).toBe(false);
    expect(evalUnlock(both, { dodges: 2 })).toBe(false);
    expect(evalUnlock(both, { jieInterrupts: 3, dodges: 2 })).toBe(true);
  });

  it('any：任一项满足就真', () => {
    const either: QijiUnlock = {
      kind: 'any',
      of: [JIE_3, { kind: 'counterAtLeast', counter: 'dodges', value: 2 }],
    };
    expect(evalUnlock(either, {})).toBe(false);
    expect(evalUnlock(either, { dodges: 2 })).toBe(true);
    expect(evalUnlock(either, { jieInterrupts: 3 })).toBe(true);
  });

  it('not：取反', () => {
    const notJie: QijiUnlock = { kind: 'not', of: JIE_3 };
    expect(evalUnlock(notJie, { jieInterrupts: 2 })).toBe(true);
    expect(evalUnlock(notJie, { jieInterrupts: 3 })).toBe(false);
  });

  it('⚠️ 空 all 恒真、空 any 恒假（全称 / 存在量词的取值，写死以免被"顺手改对"）', () => {
    expect(evalUnlock({ kind: 'all', of: [] }, {})).toBe(true);
    expect(evalUnlock({ kind: 'any', of: [] }, {})).toBe(false);
  });

  it('嵌套组合（all 里套 any 与 not）', () => {
    const nested: QijiUnlock = {
      kind: 'all',
      of: [
        { kind: 'not', of: { kind: 'counterAtLeast', counter: 'dodges', value: 5 } },
        { kind: 'any', of: [JIE_3, { kind: 'counterAtLeast', counter: 'interrupts', value: 10 }] },
      ],
    };
    expect(evalUnlock(nested, { jieInterrupts: 3 })).toBe(true);
    expect(evalUnlock(nested, { interrupts: 10 })).toBe(true);
    expect(evalUnlock(nested, { jieInterrupts: 2 })).toBe(false);
    // 闪避到 5 之后，第一个 not 不再满足 → 整体假
    expect(evalUnlock(nested, { jieInterrupts: 9, dodges: 5 })).toBe(false);
  });
});

describe('unlockProgress —— 给 QijiSelect 的"2/3"', () => {
  it('叶子条件报"已满足到几 / 要求几"', () => {
    expect(unlockProgress(JIE_3, {})).toEqual({ complete: false, current: 0, required: 3, items: [] });
    expect(unlockProgress(JIE_3, { jieInterrupts: 2 })).toEqual({
      complete: false,
      current: 2,
      required: 3,
      items: [],
    });
    expect(unlockProgress(JIE_3, { jieInterrupts: 3 }).complete).toBe(true);
    // 超过要求值时 current 照实报（不是被截到 required）—— 文案层要能看出"够了多少"
    expect(unlockProgress(JIE_3, { jieInterrupts: 5 }).current).toBe(5);
  });

  it('always 报 1/1 且 complete', () => {
    expect(unlockProgress(ALWAYS, {})).toEqual({ complete: true, current: 1, required: 1, items: [] });
  });

  it('组合条件数的是**叶子条件**个数（嵌套一层不会看起来要求更少）', () => {
    // 平铺：2 个叶子。嵌套一层：**还是** 2 个叶子（不是"1 个直接子条件"）。
    // 若 `required` 数的是直接子条件，一个"截3 + all[闪避2]"会报 2，
    // 而一个"截3 + 闪避2"也报 2 —— 但两者的实际工作量一样，所以
    // 前者必须也报 3（叶子数），否则卡片会显示"2/2 完成了"而其实还差一件。
    const flat: QijiUnlock = {
      kind: 'all',
      of: [JIE_3, { kind: 'counterAtLeast', counter: 'dodges', value: 2 }],
    };
    const doublyNested: QijiUnlock = {
      kind: 'all',
      of: [JIE_3, { kind: 'all', of: [JIE_3] }],
    };
    expect(unlockProgress(flat, {}).required).toBe(2);
    expect(unlockProgress(doublyNested, {}).required).toBe(2);
    // 直接子条件只有 1 个，但叶子有 2 个
    expect(unlockProgress(doublyNested, {}).items).toHaveLength(2);
    expect(unlockProgress(doublyNested, {}).items[1]?.required).toBe(1);
  });

  it('组合条件的 current = 已满足的叶子数', () => {
    const both: QijiUnlock = {
      kind: 'all',
      of: [JIE_3, { kind: 'counterAtLeast', counter: 'dodges', value: 2 }],
    };
    const progress = unlockProgress(both, { jieInterrupts: 3 });
    expect(progress.current).toBe(1);
    expect(progress.required).toBe(2);
    expect(progress.complete).toBe(false);
  });

  it('complete 与 evalUnlock 永远一致（同一个真相源，抽查一批输入）', () => {
    const conditions: readonly QijiUnlock[] = [
      ALWAYS,
      JIE_3,
      { kind: 'all', of: [] },
      { kind: 'any', of: [] },
      { kind: 'not', of: JIE_3 },
      { kind: 'all', of: [JIE_3, { kind: 'any', of: [{ kind: 'counterAtLeast', counter: 'dodges', value: 1 }] }] },
    ];
    const counterSets: readonly RunCounters[] = [
      {},
      { jieInterrupts: 1 },
      { jieInterrupts: 3 },
      { jieInterrupts: 3, dodges: 1 },
      { dodges: 4 },
    ];
    for (const condition of conditions) {
      for (const counters of counterSets) {
        expect(unlockProgress(condition, counters).complete).toBe(evalUnlock(condition, counters));
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
    expect(isUnlocked(strike, {})).toBe(false);
    expect(isUnlocked(strike, { jieInterrupts: 3 })).toBe(true);
  });

  it('unlockedIds 按 pool 的顺序给出 id（顺序确定，便于 diff 与截图）', () => {
    expect(unlockedIds(POOL, {})).toEqual(['vitality', 'breath']);
    expect(unlockedIds(POOL, { jieInterrupts: 3 })).toEqual(['vitality', 'breath', 'jieDeriveStrike']);
  });
});

describe('nextCandidates —— 每场战斗后的候选生成', () => {
  const POOL: readonly QijiEntity[] = [
    qiji('vitality', ALWAYS, 3),
    qiji('breath', ALWAYS, 2),
    qiji('jieDeriveStrike', JIE_3),
  ];

  it('开局：只有 always 的在候选里', () => {
    const candidates = nextCandidates(POOL, {}, []);
    expect(candidates.map((c) => c.qiji.id)).toEqual(['vitality', 'breath']);
  });

  it('喂了 3 次截之后，机制炁机进候选（这就是"喂终局快照 → 解锁"）', () => {
    const candidates = nextCandidates(POOL, { jieInterrupts: 3 }, []);
    expect(candidates.map((c) => c.qiji.id)).toEqual(['vitality', 'breath', 'jieDeriveStrike']);
  });

  it('差一次就不进候选（边界 2 vs 3）', () => {
    expect(nextCandidates(POOL, { jieInterrupts: 2 }, []).map((c) => c.qiji.id)).toEqual([
      'vitality',
      'breath',
    ]);
  });

  it('候选顺序 = pool 的顺序（不按解锁时间、不随机）', () => {
    // 顺序变了 = `QijiSelect` 的默认光标落在别的东西上，截图也会跟着变。
    const reversed = [...POOL].reverse();
    expect(nextCandidates(reversed, { jieInterrupts: 3 }, []).map((c) => c.qiji.id)).toEqual([
      'jieDeriveStrike',
      'breath',
      'vitality',
    ]);
  });

  it('已叠满的从候选里消失（maxStacks 默认 1）', () => {
    const chosen = [{ qijiId: 'vitality', stacks: 3 }];
    expect(nextCandidates(POOL, {}, chosen).map((c) => c.qiji.id)).toEqual(['breath']);
  });

  it('remainingStacks 反映还能选几次', () => {
    const candidates = nextCandidates(POOL, {}, [{ qijiId: 'vitality', stacks: 2 }]);
    const vitality = candidates.find((c) => c.qiji.id === 'vitality');
    expect(vitality?.remainingStacks).toBe(1);
    // 没选过的按上限
    expect(candidates.find((c) => c.qiji.id === 'breath')?.remainingStacks).toBe(2);
    // 默认上限 1
    expect(nextCandidates(POOL, { jieInterrupts: 3 }, []).find((c) => c.qiji.id === 'jieDeriveStrike')?.remainingStacks).toBe(1);
  });

  it('解锁了但叠满 → 不出现（两个条件都要满足才进候选）', () => {
    const chosen = [{ qijiId: 'vitality', stacks: 3 }, { qijiId: 'jieDeriveStrike', stacks: 1 }];
    expect(nextCandidates(POOL, { jieInterrupts: 9 }, chosen).map((c) => c.qiji.id)).toEqual(['breath']);
  });

  it('P0 的兜底保证：候选永不为空（只要池子里有 always 的通用炁机）', () => {
    // §5.4 / §12 决议 #12："已解锁只有 1 个时跳过选择屏"不会发生。
    // 这条把那个保证写成一个**可失败的**断言：池子里只要有 always，
    // 无论计数器多难看、选了多少次，候选都还有东西。
    const generic = [qiji('vitality', ALWAYS, 3), qiji('breath', ALWAYS, 2)];
    let chosen: { qijiId: string; stacks: number }[] = [];
    for (let round = 0; round < 5; round += 1) {
      const candidates = nextCandidates(generic, {}, chosen);
      expect(candidates.length).toBeGreaterThan(0);
      const first = candidates[0];
      if (first === undefined) break;
      const stacks = stacksOf(chosen, first.qiji.id) + 1;
      chosen = [...chosen.filter((c) => c.qijiId !== first.qiji.id), { qijiId: first.qiji.id, stacks }];
    }
    // 5 次之后（生命 3 + 炁回复 2 = 5 层全满）候选才可能空
    expect(nextCandidates(generic, {}, chosen)).toEqual([]);
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
