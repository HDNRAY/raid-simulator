/**
 * 设置页「按键」列表**只列玩家技能**。
 *
 * ==================================================================
 * 这个测试防的是什么（真实踩过的坑）
 * ==================================================================
 *
 * 玩家反馈："按键设置里出现了 boss 的技能"。
 *
 * 根因：过滤条件是 `!sk.id.startsWith('boss-')` —— 靠 **id 前缀**猜归属。
 * 而「色欲」的技能 id 是 `lust-hum` / `lust-entangle` / `lust-charm`，
 * **不以 `boss-` 开头**，于是全部漏过，Boss 的招被列进了玩家的按键设置。
 *
 * ⚠️ 同一个前缀约定还被 `derivedSlots.ts`（派生槽）和
 * `viewModel.test.ts`（读条时长护栏）依赖，它们**同时**对色欲失效。
 * 后者的后果更隐蔽：色欲的招**从来没被那条护栏检查过**。
 *
 * 所以判据换成结构性的 `PLAYER_SKILL_IDS`。这个文件把那条坑钉住 ——
 * 这类 bug 不会自己暴露，只会静默多出几行 UI。
 */
import { describe, expect, it } from 'vitest';
import { ALL_SKILLS, PLAYER_SKILL_IDS, PLAYER_SKILLS } from '../../src/data/content';
import { LUST_SKILLS } from '../../src/data/lustBoss';
import { PRIDE_SKILLS } from '../../src/data/bossPride';
import { isBindablePlayerSkill } from '../../src/app/keyRows';

describe('按键设置只列玩家技能', () => {
  it('两个 Boss 的技能都不该可绑键', () => {
    const bosses = [
      ...LUST_SKILLS.map((s) => ({ who: '色欲', skill: s })),
      ...PRIDE_SKILLS.map((s) => ({ who: '傲慢', skill: s })),
    ];

    const leaked = bosses
      .filter(({ skill }) => isBindablePlayerSkill(skill))
      .map(({ who, skill }) => `${who}/${skill.id}`);

    expect(leaked).toEqual([]);
  });

  /**
   * ⚠️ 这条是**故意**断言"色欲的 id 不以 `boss-` 开头"的。
   *
   * 它记录的是**当初为什么前缀判据不够用**。如果有一天有人把色欲的 id
   * 改成了 `boss-*`，这条会失败 —— 那正是提醒他"前缀约定本来就不该用"
   * 的时机，而不是让这个坑悄悄消失、下次换个 Boss 再踩一遍。
   */
  it('回归：色欲的 id 不以 boss- 开头 —— 所以按前缀过滤必然漏掉它们', () => {
    expect(LUST_SKILLS.length).toBeGreaterThan(0);
    expect(LUST_SKILLS.every((s) => !s.id.startsWith('boss-'))).toBe(true);
  });

  it('派生技（带 requires）不列 —— 它靠派生出现，不由玩家直接按', () => {
    const derived = PLAYER_SKILLS.filter((s) => (s.requires?.length ?? 0) > 0);
    expect(derived.length).toBeGreaterThan(0);

    for (const skill of derived) {
      expect(isBindablePlayerSkill(skill), `${skill.id} 是派生技，不该可绑`).toBe(false);
    }
  });

  it('玩家技能里没有 requires 的那些都可绑', () => {
    const plain = PLAYER_SKILLS.filter((s) => (s.requires?.length ?? 0) === 0);
    expect(plain.length).toBeGreaterThan(0);

    for (const skill of plain) {
      expect(isBindablePlayerSkill(skill), `${skill.id} 应该可绑`).toBe(true);
    }
  });

  it('空 id 不列', () => {
    expect(isBindablePlayerSkill({ id: '' })).toBe(false);
  });

  /**
   * 判据的**完备性**：`ALL_SKILLS` 里"不在 `PLAYER_SKILL_IDS` 里"的那些，
   * 必须**正好**是两个 Boss 的技能，不多不少。
   *
   * 多出来 → 有技能漏登记（会被误当成玩家技能列出来）；
   * 少 → 玩家技能被误判成 Boss 技能，从设置里消失。
   */
  it('ALL_SKILLS 减去玩家技能 = 两个 Boss 的技能', () => {
    const nonPlayer = ALL_SKILLS.filter((s) => !PLAYER_SKILL_IDS.has(s.id)).map((s) => s.id);
    const expected = [...LUST_SKILLS, ...PRIDE_SKILLS].map((s) => s.id);

    expect([...nonPlayer].sort()).toEqual([...expected].sort());
  });
});
