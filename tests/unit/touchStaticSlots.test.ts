/**
 * **触屏按钮的"额外槽位"**（`app/touchStaticSlots.ts`）。
 *
 * ==================================================================
 * 这个文件防的是什么（实测踩到的空圆）
 * ==================================================================
 *
 * 玩家在「触屏」页放上一个**没绑键**的技能（这正是这次要解开的死结），
 * 回战斗一看：按钮的**圈出来了，但一个字都没有** —— 像坏了。
 *
 * 根因：按钮上的文字来自快照的 `skills`，而那张表只包含**上了技能栏**的
 * 技能（`slotsFromBindings` 过滤空键）。没绑键的技能根本不在里面，
 * 于是 `TouchButtonLayer.applySlot(undefined)` 把字全清空。
 *
 * 修法就是把缺的补上（补的那一份是 `BattleLoop.slotViewOf` 现造的**真**
 * 槽位，不是近似值 —— 见模块头的说明，这里只测"合并"这件事）。
 */

import { describe, expect, it } from 'vitest';
import { withStaticSlots } from '../../src/app/touchStaticSlots';
import { EMPTY_SNAPSHOT } from '../../src/render/viewModel';
import type { BattleSnapshotView, SkillSlotView } from '../../src/render/viewModel';

/** 造一份"上了一个技能栏槽位"的快照（本测试只关心 `skills`）。 */
function viewWithSkills(skills: readonly SkillSlotView[]): BattleSnapshotView {
  return { ...EMPTY_SNAPSHOT, skills };
}

function slotOf(skillId: string, index = 0): SkillSlotView {
  return {
    index,
    key: 'q',
    skillId,
    nameKey: 'stat.strength',
    icon: 'icon',
    usable: true,
    cooldownRatio: 0,
    cooldownSec: 0,
    skillCdSec: 0,
    comboReady: false,
  };
}

describe('withStaticSlots：把按钮上"快照没有"的技能补进快照', () => {
  it('【关键】没绑键的技能（快照里没有）会被补上 —— 否则按钮是空圆', () => {
    const view = viewWithSkills([slotOf('guard')]);
    const out = withStaticSlots(view, ['guard', 'attack'], (id, i) => slotOf(id, i));
    expect(out.skills.map((s) => s.skillId)).toEqual(['guard', 'attack']);
    /** 补进来的槽位要有名字（按钮靠它画字）。 */
    expect(out.skills[1]?.nameKey).toBe('stat.strength');
  });

  it('【关键】什么都不缺时**返回原对象**（每帧都会跑，不该产生垃圾）', () => {
    const view = viewWithSkills([slotOf('guard')]);
    expect(withStaticSlots(view, ['guard'], (id, i) => slotOf(id, i))).toBe(view);
    expect(withStaticSlots(view, [], (id, i) => slotOf(id, i))).toBe(view);
  });

  it('拿不到槽位时保持原样（不编一个空槽位）', () => {
    const view = viewWithSkills([slotOf('guard')]);
    expect(withStaticSlots(view, ['ghost'], () => undefined)).toBe(view);
  });

  it('不改原快照的 `skills`（纯函数）', () => {
    const view = viewWithSkills([slotOf('guard')]);
    const before = view.skills;
    withStaticSlots(view, ['attack'], (id, i) => slotOf(id, i));
    expect(view.skills).toBe(before);
    expect(view.skills).toHaveLength(1);
  });

  it('空技能 id 被忽略（坏数据不该造出一个没有技能的按钮）', () => {
    const view = viewWithSkills([]);
    expect(withStaticSlots(view, [''], (id, i) => slotOf(id, i))).toBe(view);
  });

  it('多个缺失按顺序补，下标从现有槽位数接着排', () => {
    const view = viewWithSkills([slotOf('guard')]);
    const seen: number[] = [];
    const out = withStaticSlots(view, ['a', 'b'], (id, i) => {
      seen.push(i);
      return slotOf(id, i);
    });
    expect(seen).toEqual([1, 2]);
    expect(out.skills.map((s) => s.skillId)).toEqual(['guard', 'a', 'b']);
  });
});
