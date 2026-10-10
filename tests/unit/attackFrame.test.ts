import { describe, expect, it } from 'vitest';
import { ATTACK_FRAME_TICKS, isAttacking, lastUsedKey } from '../../src/app/attackFrame';
import { makeSkillDef } from './helpers';
import type { SkillDef } from '../../src/core/types';

/**
 * 攻击帧判定。
 *
 * 需求："人物攻击，无论是那个攻击（tags实现）都播放 攻击帧。"
 */
const skills = new Map<string, SkillDef>([
  ['attack', makeSkillDef({ id: 'attack', tags: ['melee'] })],
  ['blast', makeSkillDef({ id: 'blast', tags: ['spell'] })],
  ['guard', makeSkillDef({ id: 'guard', tags: ['defensive'] })],
  ['flash', makeSkillDef({ id: 'flash', tags: ['defensive', 'dodge'] })],
]);

const used = (...entries: readonly (readonly [string, string, number])[]) =>
  new Map(entries.map(([src, sk, at]) => [lastUsedKey(src, sk), at]));

describe('攻击帧：哪些技能算"攻击"', () => {
  it('【关键】按 `SkillTag` 判定 —— melee 与 spell 都算', () => {
    /**
     * ⚠️ 需求强调"（tags实现）"：不能写死技能 id 列表，否则加新攻击技能
     * 就会漏。`spell`（「轰」/「凝」）也算攻击。
     */
    expect(isAttacking(used(['player', 'attack', 100]), skills, 'player', 100)).toBe(true);
    expect(isAttacking(used(['player', 'blast', 100]), skills, 'player', 100)).toBe(true);
  });

  it('防御 / 闪避**不算**攻击（不该播攻击帧）', () => {
    expect(isAttacking(used(['player', 'guard', 100]), skills, 'player', 100)).toBe(false);
    expect(isAttacking(used(['player', 'flash', 100]), skills, 'player', 100)).toBe(false);
  });

  it('【关键】Boss 放攻击技**不会**让玩家播攻击帧', () => {
    /**
     * ⚠️ 键必须带来源 id。原先 `lastUsed` 的键只有 `skillId`（而且只写
     * 不读），那样 Boss 一放「重斩」玩家就跟着挥 —— 很明显的错。
     */
    expect(isAttacking(used(['boss', 'attack', 100]), skills, 'player', 100)).toBe(false);
    expect(isAttacking(used(['boss', 'attack', 100]), skills, 'boss', 100)).toBe(true);
  });

  it('超出时间窗就不再算攻击', () => {
    const m = used(['player', 'attack', 100]);
    expect(isAttacking(m, skills, 'player', 100 + ATTACK_FRAME_TICKS)).toBe(true);
    expect(isAttacking(m, skills, 'player', 101 + ATTACK_FRAME_TICKS)).toBe(false);
  });

  it('【关键】窗口必须**大于 1 tick** —— 60fps 下单帧只有 16ms，看不见', () => {
    expect(ATTACK_FRAME_TICKS).toBeGreaterThan(1);
  });

  it('没放过任何技能 → 不攻击；未知技能 id 不炸', () => {
    expect(isAttacking(new Map(), skills, 'player', 100)).toBe(false);
    expect(isAttacking(used(['player', 'no-such-skill', 100]), skills, 'player', 100)).toBe(false);
  });
});
