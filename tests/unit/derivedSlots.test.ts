import { describe, expect, it } from 'vitest';
import { deriveSlots } from '../../src/app/derivedSlots';
import { slotsFromBindings } from '../../src/app/derivedSlots';
import { makeSkillDef } from './helpers';
import type { SkillDef } from '../../src/core/types';

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
