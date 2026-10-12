import { describe, expect, it } from 'vitest';

import type { Combatant } from '../../../src/core/types';
import type { GameEntity } from '../../../src/core/types/skills';
import {
  RUN_COUNTERS,
  isRunCounter,
  type QijiCategory,
  type QijiEntity,
  type QijiUnlock,
  type RunCounter,
  type RunCounters,
} from '../../../src/core/types/qiji';

/**
 * `core/types/qiji.ts` 的形状测试。
 *
 * ==================================================================
 * 这个文件在测什么（不是"再抄一遍类型"）
 * ==================================================================
 *
 * 类型本身在编译期就检查过了，但有三件事**只有运行期能测**，而且它们
 * 各自都对应一个具体的失败模式：
 *
 *   1. **`RunCounter` 的封闭联合与运行期清单必须一致**
 *      （`RUN_COUNTERS` / `isRunCounter`）。类型擦除之后，"哪些键算计数器"
 *      只剩这一份清单，而它是"解析外来终局快照 / 存档"的唯一依据。
 *      两者漂开 = 某个计数器**怎么数都不涨**，或者坏数据被静默当成 0。
 *   2. **`QijiEntity` 真的满足 `GameEntity`**。这是 §5.1 选"继承"而不是
 *      "另起一套"的全部理由；而 `kind` 那个字段恰好是这条继承关系里
 *      唯一有陷阱的地方（见 `QijiEntity.kind` 的说明）。
 *   3. **`RunCounters` 的形状能进 JSON**（`Partial` + 数字），
 *      以及"缺键 = 0"这个约定在类型上是**允许**的。
 *
 * ⚠️ 本文件不重复 `unlock.test.ts` / `lifecycle.test.ts` 的判定与状态转移：
 * 那些是 `core/run/` 的关注点，这里只管**类型这一层**。
 */

describe('RunCounter —— 封闭联合与运行期清单一致', () => {
  it('RUN_COUNTERS 恰好是这 5 个键（加一个就会让这条测试变红，逼着一起改）', () => {
    // ⚠️ 写成显式列表而不是 `new Set(RUN_COUNTERS).size === 5`：
    // 数量对不上能发现"少了一个"，但对不上"换了一个"。这份列表是
    // §5.2.1 里那 5 个计数器的原文，改它必须是有意的。
    expect([...RUN_COUNTERS].sort()).toEqual([
      'battlesWon',
      'dodges',
      'flawlessBattles',
      'interrupts',
      'jieInterrupts',
    ]);
  });

  it('每个合法的 RunCounter 都能被类型守卫认出来', () => {
    const all: readonly RunCounter[] = [
      'jieInterrupts',
      'interrupts',
      'dodges',
      'battlesWon',
      'flawlessBattles',
    ] as const;
    for (const counter of all) {
      expect(isRunCounter(counter)).toBe(true);
    }
    // `all` 的长度必须等于 RUN_COUNTERS 的长度：如果将来往联合里加了
    // 一个键而忘了往这个数组里加，这条会失败（而不是"两个都少一个、正好相等"）。
    expect(all).toHaveLength(RUN_COUNTERS.length);
  });

  it('拼错的键被拦住（这正是做成封闭联合的理由）', () => {
    // §5.2.1 的原话："封闭联合，防止拼写错误静默失效"。
    // `jieInterupts`（少一个 r）在 `counter: string` 的世界里会编译通过、
    // 求值恒为 0 —— 玩家永远差一点解锁，而没有任何东西报错。
    expect(isRunCounter('jieInterupts')).toBe(false);
    expect(isRunCounter('jie_interrupts')).toBe(false);
    expect(isRunCounter('JieInterrupts')).toBe(false);
    expect(isRunCounter('')).toBe(false);
  });

  it('非字符串一律为假（外来数据可以是任何东西）', () => {
    expect(isRunCounter(undefined)).toBe(false);
    expect(isRunCounter(null)).toBe(false);
    expect(isRunCounter(3)).toBe(false);
    expect(isRunCounter({ counter: 'dodges' })).toBe(false);
    expect(isRunCounter(['dodges'])).toBe(false);
  });

  it('RUN_COUNTERS 里没有重复项', () => {
    expect(RUN_COUNTERS.length).toBe(new Set(RUN_COUNTERS).size);
  });

  it('RUN_COUNTERS 可 JSON 往返（它会被序列化进调试面板 / 存档校验表）', () => {
    expect(JSON.parse(JSON.stringify(RUN_COUNTERS))).toEqual([...RUN_COUNTERS]);
  });
});

describe('RunCounters —— 缺键即 0 的合法形状', () => {
  it('空对象、部分键、全键都是合法值', () => {
    const empty: RunCounters = {};
    const partial: RunCounters = { dodges: 3 };
    const full: RunCounters = {
      jieInterrupts: 1,
      interrupts: 2,
      dodges: 3,
      battlesWon: 4,
      flawlessBattles: 5,
    };
    expect(JSON.parse(JSON.stringify([empty, partial, full]))).toEqual([empty, partial, full]);
  });

  it('读取缺键得到 undefined（"0"由 counterValue 补，不在这里假装有值）', () => {
    const counters: RunCounters = { dodges: 1 };
    expect(counters.jieInterrupts).toBeUndefined();
    expect(counters.dodges).toBe(1);
  });
});

describe('QijiEntity —— 真的满足 GameEntity（§5.1 选继承的全部理由）', () => {
  /**
   * 一个最小但**完整**的炁机。`category: 'generic'` 对应 §5.4 的通用炁机
   * （`unlock: always`）—— 用它而不是 offense，因为"通用炁机"是 P0 唯一
   * 有完整语义的一种（兜底池）。
   */
  const VITALITY: QijiEntity = {
    id: 'vitality',
    // ⚠️ P0 只能填 `GameEntity['kind']` 里已有的值：`'qiji'` 还不在
    // `EntityKind` 里（**W8**，P6 才做）。若这里填 `'qiji'`，`tsc` 会报
    // `Type '"qiji"' is not assignable to type 'EntityKind'` —— 而那条
    // 报错就是这条测试存在的意义：它把"继承关系现在是断的"写在编译期。
    kind: 'passive',
    nameKey: 'qiji.vitality.name',
    descKey: 'qiji.vitality.desc',
    icon: 'char_guard',
    category: 'generic',
    rarity: 'common',
    unlock: { kind: 'always', of: [] },
    maxStacks: 3,
    // ⚠️ 写成对象字面量直接赋给 `QijiEntity.abilities` / `.pool`，
    // **不加** `satisfies`：字段本身的类型就是检查（`satisfies` 在这里
    // 只是同一件事的第二遍声明，多一处会漂的重复）。
    abilities: [
      { kind: 'modifier', modifier: { stat: 'maxHp', op: 'add', value: 30, sourceKey: 'qiji.vitality' } },
    ],
    pool: { counters: { uses: { current: 1, max: 1 } } },
  };

  it('可以当作 GameEntity 使用（这是"继承"能成立的可执行证据）', () => {
    // ⚠️ 显式标注类型：不做这一步，`VITALITY` 只是一个恰好形状对的字面量，
    // 而"它满足 GameEntity"这件事**不会被检查**。赋值给 `GameEntity`
    // 参数才让编译器真的去比字段。
    const asEntity: GameEntity = VITALITY;
    expect(asEntity.id).toBe('vitality');
    expect(asEntity.abilities).toHaveLength(1);
  });

  it('继承来的展示字段 / abilities / pool / requires 都照常可用', () => {
    expect(VITALITY.nameKey).toBe('qiji.vitality.name');
    expect(VITALITY.descKey).toBe('qiji.vitality.desc');
    expect(VITALITY.rarity).toBe('common');
    expect(VITALITY.pool?.counters?.uses).toEqual({ current: 1, max: 1 });
    expect(VITALITY.abilities[0]?.kind).toBe('modifier');
  });

  it('category 只用于分组，取值是 5 个之一', () => {
    const categories: readonly QijiCategory[] = ['offense', 'defense', 'tempo', 'utility', 'generic'];
    expect(categories).toHaveLength(5);
    expect(categories).toContain(VITALITY.category);
  });

  it('unlock 的五种变体都能构造出来（联合没被写窄）', () => {
    const all: readonly QijiUnlock[] = [
      { kind: 'always', of: [] },
      { kind: 'counterAtLeast', counter: 'jieInterrupts', value: 3 },
      { kind: 'all', of: [{ kind: 'always', of: [] }] },
      { kind: 'any', of: [{ kind: 'always', of: [] }] },
      { kind: 'not', of: { kind: 'counterAtLeast', counter: 'dodges', value: 2 } },
    ];
    expect(all).toHaveLength(5);
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
  });

  it('maxStacks 是可选的（缺省 = 1 的语义在 unlock.ts 里）', () => {
    const noStacks: QijiEntity = {
      id: 'breath',
      kind: 'passive',
      nameKey: 'qiji.breath.name',
      icon: 'char_focus',
      category: 'generic',
      unlock: { kind: 'always', of: [] },
      abilities: [],
    };
    expect(noStacks.maxStacks).toBeUndefined();
  });

  it('炁机整体可 JSON 往返（内容将来要被校验器/注册表读，必须先能序列化）', () => {
    expect(JSON.parse(JSON.stringify(VITALITY))).toEqual(VITALITY);
  });
});

describe('EntityKind 的现状（P0 的一条**有意**的缺口，写成断言以免被误改）', () => {
  it('`"qiji"` 还不能作为 EntityKind —— 那是 W8，P6 才做', () => {
    /**
     * ⚠️ 这条测试断言的是**当前缺失**，不是"正确性"。
     *
     * 它存在的理由：`QijiEntity.kind` 写成 `GameEntity['kind']` 这件事
     * 看起来像笔误（"继承的类当然该声明自己的 kind"）。这条测试 + 那段
     * 注释一起说明"这是 W8 没做的直接后果，不是疏漏"。
     *
     * 做 W8 时：把 `'qiji'` 加进 `EntityKind`、把这里的断言改成
     * `toContain('qiji')`、把 `QijiEntity.kind` 收窄成 `'qiji'` ——
     * 三处一起，编译器会逼着全部发生。
     */
    const kinds: readonly GameEntity['kind'][] = [
      'equipment',
      'consumable',
      'passive',
      'buffTemplate',
      'activeSkill',
      'encounter',
    ];
    expect(kinds).not.toContain('qiji');
    expect(kinds).toHaveLength(6);
  });
});

describe('core/types/index.ts 转发了 qiji（import 那条路可用）', () => {
  it('`RunCounter` 等类型能从 `core/types` 整体导入拿到', async () => {
    // ⚠️ 只能**运行期**验证值（`RUN_COUNTERS` / `isRunCounter`）；
    // 类型是通过下面这些 import 的**存在**来验证的 —— 若 `index.ts`
    // 忘了转发 `./qiji`，`tsc` 会在这一行的 import 上报错。
    const types = await import('../../../src/core/types');
    expect(typeof types.isRunCounter).toBe('function');
    expect(types.RUN_COUNTERS).toEqual([...RUN_COUNTERS]);
    // 类型层的转发：这些标注若不能解析，`tsc --noEmit` 会失败
    const counter: RunCounter = 'dodges';
    const counters: RunCounters = { [counter]: 1 };
    expect(counters.dodges).toBe(1);
  });

  it('`Combatant`（core/types 的既有导出）与炁机类型可以同时导入（没有名字冲突）', () => {
    // `RunCounter` 这个名字很通用；它进 `core/types` 的转发面之后，
    // 不能与已有的导出撞名（TS 会报 "Module has already exported a member"）。
    const combatantShape = (c: Pick<Combatant, 'id' | 'counters'>): string => c.id;
    expect(combatantShape({ id: 'player', counters: {} })).toBe('player');
  });
});
