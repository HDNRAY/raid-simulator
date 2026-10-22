import { describe, expect, it } from 'vitest';

import { skillStatsOf } from '../../src/app/skillStats';
import { displaySeconds } from '../../src/app/displayTime';
import { logicMs } from '../../src/core/loopConstants';
import { S } from '../../src/data/scale';
import { makeSkillDef } from './helpers';

/**
 * **技能的结构化数值**（2026-10-22）：前摇 / 冷却 / 代价。
 *
 * 用户："boss详情里，技能有显示 cd和读条时间吗，我希望显示，结构化显示，
 * 可以有不同颜色"。
 *
 * 这一层钉的是"**从内容字段算出三种槽位**"的规则，不钉具体数值
 * （数值改平衡时会变，这里一律**从定义里取**再断言）。
 */
describe('技能 → 结构化数值', () => {
  it('读条 / 冷却 / 代价都有 ⇒ 三项，顺序是 前摇 → 冷却 → 代价', () => {
    const skill = makeSkillDef({
      id: 't-all',
      castTime: logicMs(8),
      cooldown: logicMs(30),
      cost: [{ resource: 'douqi', value: S(40) }],
    });
    const stats = skillStatsOf(skill);
    expect(stats.map((s) => s.kind)).toEqual(['cast', 'cooldown', 'cost']);
    /** ⚠️ 数值**从定义来**（换个数照样绿）。 */
    const cast = stats.find((s) => s.kind === 'cast');
    expect(cast?.seconds).toBe(displaySeconds(logicMs(8)));
    const cost = stats.find((s) => s.kind === 'cost');
    expect(cost?.resourceKey).toBe('douqi');
    expect(cost?.amount).toBe(S(40));
  });

  it('瞬发（`castTime = 0`）⇒ 不出现"前摇 0 秒"', () => {
    const skill = makeSkillDef({ id: 't-instant', castTime: 0, cooldown: logicMs(5) });
    expect(skillStatsOf(skill).some((s) => s.kind === 'cast')).toBe(false);
  });

  it('没有冷却（`cooldown = 0`）⇒ 不出现"冷却 0 秒"', () => {
    const skill = makeSkillDef({ id: 't-nocd', castTime: logicMs(3), cooldown: 0 });
    expect(skillStatsOf(skill).some((s) => s.kind === 'cooldown')).toBe(false);
  });

  it('免费技能 ⇒ 不出现"代价 0"', () => {
    const skill = makeSkillDef({ id: 't-free', castTime: logicMs(2), cost: [] });
    expect(skillStatsOf(skill).some((s) => s.kind === 'cost')).toBe(false);
  });

  it('多个代价 ⇒ 各自一条（顺序与定义一致）', () => {
    const skill = makeSkillDef({
      id: 't-two-cost',
      castTime: logicMs(4),
      cost: [
        { resource: 'energy', value: S(10) },
        { resource: 'douqi', value: S(20) },
      ],
    });
    expect(skillStatsOf(skill).filter((s) => s.kind === 'cost').map((s) => s.resourceKey)).toEqual([
      'energy',
      'douqi',
    ]);
  });
});
