import { describe, expect, it } from 'vitest';

import type { Combatant } from '../../../src/core/types';
import type { GameEntity } from '../../../src/core/types/skills';
import type { QijiCategory, QijiEntity, QijiUnlock } from '../../../src/core/types/qiji';

/**
 * `core/types/qiji.ts` 的形状测试。
 *
 * ==================================================================
 * 这个文件在测什么（不是"再抄一遍类型"）
 * ==================================================================
 *
 * 类型本身在编译期就检查过了，但有两件事**只有运行期能测**，
 * 各自对应一个具体的失败模式：
 *
 *   1. **`QijiEntity` 真的满足 `GameEntity`**。这是 §5.1 选"继承"而不是
 *      "另起一套"的全部理由；而 `kind` 那个字段恰好是这条继承关系里
 *      唯一有陷阱的地方（见 `QijiEntity.kind` 的说明）。
 *   2. **`QijiUnlock` 的形状能进 JSON**（它将来要写进 `data/qiji.ts`
 *      的内容表、要被校验器读、要能作为存档的一部分）。
 *
 * ⚠️ 本文件不重复 `unlock.test.ts` / `stats.test.ts` 的判定与统计：
 * 那些是 `core/run/` 的关注点，这里只管**类型这一层**。
 *
 * ⚠️ 这里**曾经**有 6 条测"`RunCounter` 封闭联合与 `RUN_COUNTERS`
 * 运行期清单一致"的用例 —— 那个联合已随 §5.2 的方向修正删除
 * （原因见 `QijiUnlock` 的注释："只能数技能使用次数"）。取而代之的是
 * **开放的** `BattleStatQuery`，它的运行期清单（`SKILL_STAT_IDS` /
 * `isSkillStatId`）在自己的模块里，由 `stats.test.ts` 覆盖。
 * 那 6 条用例**不是白写的**：它们测的正是"闭集与运行期清单会漂"这个病，
 * 所以那个病是真的 —— 只是现在用"开放查询 + 内容数据"规避掉了它。
 */

describe('QijiEntity —— 真的满足 GameEntity（§5.1 选继承的全部理由）', () => {
  /**
   * 一个最小但**完整**的炁机。`category: 'generic'` 对应 §5.4 的通用炁机
   * （`unlock: always`）—— 用它而不是 offense，因为"通用炁机"是 P0 唯一
   * 有完整语义的一种（兜底池）。
   */
  const VITALITY: QijiEntity = {
    id: 'vitality',
    /**
     * ⚠️ **P3 起这里填 `'qiji'`**（原先填 `'passive'`）。
     *
     * P0 时 `'qiji'` 还不在 `EntityKind` 里，只能填一个别的 kind —— 那是
     * **用假值绕过类型**。P3 把 `'qiji'` 加进了联合（W8 的类型那一半），
     * 所以现在填真值；`QijiEntity.kind` 也跟着收窄成 `'qiji'`。
     */
    kind: 'qiji',
    nameKey: 'qiji.vitality.name',
    descKey: 'qiji.vitality.desc',
    icon: 'char_guard',
    category: 'generic',
    rarity: 'common',
    unlock: { kind: 'always', of: [] },
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
      { kind: 'statAtLeast', stat: { s: 'skillInterrupts', skillId: 'jie', scope: 'run' }, value: 3 },
      { kind: 'all', of: [{ kind: 'always', of: [] }] },
      { kind: 'any', of: [{ kind: 'always', of: [] }] },
      { kind: 'not', of: { kind: 'statAtLeast', stat: { s: 'dodges', scope: 'run' }, value: 2 } },
    ];
    expect(all).toHaveLength(5);
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
  });

  it('⚠️ 用户点名的两个例子都能写成一条**内容数据**（不进 core 的类型表）', () => {
    // 这是"条件写在内容数据里"的可执行证据：
    //   例 1「某个技能造成伤害数」→ skillDamage
    //   例 2「同时用了 n 次 a 和 m 次 b」→ all + 两条 skillUses
    // 两者都只需要拼现有成员，**没有往 core 加任何东西**。
    const damageBased: QijiUnlock = {
      kind: 'statAtLeast',
      stat: { s: 'skillDamage', skillId: 'jie', scope: 'battle' },
      value: 300,
    };
    const combo: QijiUnlock = {
      kind: 'all',
      of: [
        { kind: 'statAtLeast', stat: { s: 'skillUses', skillId: 'jie', scope: 'battle' }, value: 3 },
        { kind: 'statAtLeast', stat: { s: 'skillUses', skillId: 'break', scope: 'battle' }, value: 2 },
      ],
    };
    expect(JSON.parse(JSON.stringify([damageBased, combo]))).toEqual([damageBased, combo]);
  });

  it('炁机整体可 JSON 往返（内容将来要被校验器/注册表读，必须先能序列化）', () => {
    expect(JSON.parse(JSON.stringify(VITALITY))).toEqual(VITALITY);
  });
});

describe('EntityKind 的现状（P3 起 `"qiji"` 进了联合 —— 但 W8 只做了一半）', () => {
  it('`"qiji"` **已经**是合法的 EntityKind（W8 的类型那一半）', () => {
    /**
     * ⚠️ 这条测试在 P0/P2 断言的是**相反的事实**（"`"qiji"` 还不能用，
     * 那是 W8、P6 才做"），而且它当时就写明了改法：
     *
     *   > 做 W8 时：把 `'qiji'` 加进 `EntityKind`、把这里的断言改成
     *   > `toContain('qiji')`、把 `QijiEntity.kind` 收窄成 `'qiji'`
     *   > —— 三处一起，编译器会逼着全部发生。
     *
     * P3 需要 `QijiEntity.kind` 收窄（否则 `data/qiji.ts` 只能填假值），
     * 于是这三处在同一轮里一起改了。
     *
     * ⚠️ **但 W8 的另一半仍然没做**（P6）：校验器不认识 `kind: 'qiji'`
     * 的实体、注册表也没有它的位置。所以 `QIJI_ENTITY_VALIDATED` 仍是
     * `false`，而 `data/qiji.ts` 的内容**不进 `ContentBundle.entities`**。
     */
    const kinds: readonly GameEntity['kind'][] = [
      'equipment',
      'consumable',
      'passive',
      'buffTemplate',
      'activeSkill',
      'qiji',
      'encounter',
    ];
    expect(kinds).toContain('qiji');
    expect(kinds).toHaveLength(7);
  });
});

describe('core/types/index.ts 转发了 qiji（import 那条路可用）', () => {
  it('`QIJI_ENTITY_VALIDATED` 能从 `core/types` 整体导入拿到', async () => {
    // ⚠️ 运行期只能验证**值**（类型是编译期的，若 `index.ts` 忘了转发
    // `./qiji`，`tsc` 会在上面那条 `import type { QijiEntity }` 上报错）。
    const types = await import('../../../src/core/types');
    expect(types.QIJI_ENTITY_VALIDATED).toBe(false);
  });

  it('`Combatant.counters`（引擎的离散计数器，仍在）与炁机类型可以同时导入', () => {
    /**
     * ⚠️ 这里刻意把两个**不同**的 "counter" 概念放在一起：
     *   - `Combatant.counters`：引擎里 `ResourcePool.counters` 的
     *     离散资源（使用次数 / 充能），**仍在**（它属于战斗内状态）
     *   - 一局肉鸽的解锁条件：**已经不是**计数器了，而是对事件流
     *     统计的查询（`QijiUnlock` + `BattleStatQuery`）
     *
     * 这个用例证明"删掉 `RunCounter` 之后没有把引擎那份一起删掉"，
     * 也证明两者不会在 `core/types` 的转发面撞名。
     */
    const combatantShape = (c: Pick<Combatant, 'id' | 'counters'>): string => c.id;
    expect(combatantShape({ id: 'player', counters: {} })).toBe('player');
  });
});
