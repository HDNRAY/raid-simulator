import { describe, expect, it } from 'vitest';
import { deriveSlots } from '../../src/app/derivedSlots';
import { slotsFromBindings } from '../../src/app/derivedSlots';
import { makeSkillDef } from './helpers';
import type { SkillDef } from '../../src/core/types';
import { createRegistry } from '../../src/core/content/registry';
import { EMPTY_COMBATANT, type BattleSnapshotView } from '../../src/render/viewModel';

/** 有名字的构造器：把"构造出来的 buff 列表"写在名字上（AGENTS.md §1）。 */
function buffsOf(...defIds: readonly string[]): Array<{ defId: string }> {
  return defIds.map((defId) => ({ defId }));
}

/** 带派生窗口源的 buff。 */
function comboBuff(sourceSkillId: string): {
  defId: string;
  def: { flags: { comboWindowSource: string } };
} {
  return { defId: 'combo-window', def: { flags: { comboWindowSource: sourceSkillId } } };
}

const BASE = slotsFromBindings([
  { key: 'q', skillId: 'attack' },
  { key: 'r', skillId: 'break' },
]);

const strike = makeSkillDef({
  id: 'strike',
  requires: [{ kind: 'hasBuff', who: 'self', buffId: 'combo-window' }],
});
const plain = makeSkillDef({ id: 'attack' });
const skills = new Map<string, SkillDef>([
  ['attack', plain],
  ['break', makeSkillDef({ id: 'break' })],
  ['strike', strike],
]);

describe('派生技的槽位推导', () => {
  it('没有派生窗口时：槽位就是基础的，且没有派生技', () => {
    const r = deriveSlots(BASE, buffsOf('guard-reduce'), skills);
    expect(r.derived).toBeUndefined();
    expect(r.slots).toEqual(BASE);
  });

  it('【关键】窗口开了 → 派生技插入槽位，且**借用源技能的 key**', () => {
    const r = deriveSlots(BASE, [comboBuff('break')], skills);
    expect(r.derived).toEqual({ skillId: 'strike', sourceSkillId: 'break' });
    const derivedSlot = r.slots.find((s) => s.skillId === 'strike');
    expect(derivedSlot).toBeDefined();
    /**
     * ⚠️ 这正是"画在原技能上方"的前提：派生槽位的 `key` 必须等于
     * 源技能的 key，渲染层才能据此找到源槽位。
     */
    expect(derivedSlot?.key).toBe('r');
    expect(r.slots).toHaveLength(BASE.length + 1);
  });

  it('【关键】派生技的可用性按 `requires` 判 —— 没有 buff 就不出现', () => {
    // 有窗口 buff，但把"击"的 requires 换成一个不满足的条件
    const unmet = new Map<string, SkillDef>([
      ['attack', plain],
      [
        'strike',
        makeSkillDef({
          id: 'strike',
          requires: [{ kind: 'hasBuff', who: 'self', buffId: 'something-else' }],
        }),
      ],
    ]);
    const r = deriveSlots(BASE, [comboBuff('break')], unmet);
    expect(r.derived).toBeUndefined();
    expect(r.slots).toEqual(BASE);
  });

  it('【关键】只有**玩家**技能会被当派生技 —— Boss 技能不混进来', () => {
    const withBoss = new Map<string, SkillDef>([
      ['attack', plain],
      [
        'boss-sweep',
        makeSkillDef({
          id: 'boss-sweep',
          requires: [{ kind: 'hasBuff', who: 'self', buffId: 'combo-window' }],
        }),
      ],
    ]);
    const r = deriveSlots(BASE, [comboBuff('break')], withBoss);
    expect(r.derived).toBeUndefined();
  });

  it('【关键】源技能不在绑定表里 → 不插槽位（无处可画）', () => {
    /**
     * 例如窗口由「闪」派生，但「闪」默认没有键、不上场 ——
     * 这时派生技没有"原技能的上方"可画，就不该出现。
     */
    const r = deriveSlots(BASE, [comboBuff('flash')], skills);
    expect(r.derived).toBeUndefined();
    expect(r.slots).toEqual(BASE);
  });

  it('后派生的顶掉先派生的（源随 buff 变化）', () => {
    const first = deriveSlots(BASE, [comboBuff('break')], skills);
    const second = deriveSlots(BASE, [comboBuff('attack')], skills);
    expect(first.derived?.sourceSkillId).toBe('break');
    expect(second.derived?.sourceSkillId).toBe('attack');
    // 同一个派生技，但挂到了另一个源下面
    expect(second.slots.find((s) => s.skillId === 'strike')?.key).toBe('q');
  });
});

/**
 * 一个只有 `skills: []` 的快照桩。
 *
 * ⚠️ 用**有名字的构造器**而不是 `as unknown as`（AGENTS.md §1）——
 * 它把"这是一份刻意做得最小的桩"写在了名字上，而且只有这一处。
 */
const emptySnapshot: BattleSnapshotView = {
  tick: 0,
  status: 'running',
  enraged: false,
  // 玩家/ Boss 的字段这条测试用不到，留空对象即可（只读不写）
  player: EMPTY_COMBATANT,
  boss: EMPTY_COMBATANT,
  skills: [],
  floatingText: [],
  playerFlash: 0,
  bossFlash: 0,
  spellSeq: 0,
};

describe('设置页要能看到「闪避」tag（用户报告）', () => {
  /**
   * 需求（用户报告）："之前说 给 闪 和 避 加tag，我在设置里看不到啊"
   *
   * **根因**：`dodge` 当初只加成了**机械 `SkillTag`**，而设置页的
   * 详情区只显示 **`hintTags`（玩法提示）** —— 两者在 `core/types.ts`
   * 里是**刻意分开**的，所以 `dodge` 从来没进过 UI。
   */
  it('机械 tag 走白名单进设置页，且只挑玩家看得懂的', async () => {
    const { buildKeyRows } = await import('../../src/app/keyRows');
    const dodge = makeSkillDef({ id: 'dodge', tags: ['defensive', 'dodge'] });
    const attack = makeSkillDef({ id: 'attack', tags: ['melee'] });
    /**
     * ⚠️ 依赖项**按真实形状构造**（不是类型断言）—— AGENTS.md §1 禁止
     * `as unknown as`，而且这条测试要验的正是"真实注册表里的技能怎么会
     * 传到行数据"，用假形状就验不到接线。
     */
    const rows = buildKeyRows({
      bindings: [
        { key: 'a', skillId: 'dodge' },
        { key: 'q', skillId: 'attack' },
      ],
      /**
       * ⚠️ 用**真实**的 `createRegistry`（校验关掉，测试不需要文案 key）——
       * 比造一个假注册表更接近实际，也不用类型断言。
       * ⚠️ 它现在会被喂**技能全集**（不再是绑定表）：否则没绑键的技能
       * （如「截」）在设置页根本不出现。
       */
      registry: createRegistry(
        { entities: [], skills: [attack, dodge], buffs: [] },
        { validate: false },
      ),
      // 空快照即可：这条测试只关心 tag，不关心代价/冷却
      snapshotOf: () => emptySnapshot,
      translate: (key: string) => key,
    });
    const dodgeRow = rows.find((r) => r.skillId === 'dodge');
    const attackRow = rows.find((r) => r.skillId === 'attack');
    // 「避」带 dodge → 要显示
    expect(dodgeRow?.mechanicTags).toEqual(['dodge']);
    /**
     * ⚠️ `melee` 是给引擎看的（触发器的 filter），**不显示给玩家** ——
     * 全画出来只会增加噪音。所以「斩」没有 mechanicTags。
     */
    expect(attackRow?.mechanicTags).toBeUndefined();
  });
});
