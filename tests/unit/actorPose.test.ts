import { describe, expect, it } from 'vitest';
import { actorPoseOf } from '../../src/render/actors/ActorSprite';

/**
 * 2026-10-22 用户："按住弹的时候，角色本身也要播放攻击帧···一直用攻击帧"。
 *
 * 判据顺序：有读条 ⇒ 按读条进度；**按住** ⇒ 攻击段循环；否则 idle。
 */
const ATTACK = [1, 1, 1, 1] as const;

describe('立绘的段/帧选择（actorPoseOf）', () => {
  it('没有读条也没有按住 ⇒ idle', () => {
    expect(actorPoseOf({ tick: 10, cast: undefined, holding: false, attack: ATTACK }).pool).toBe('idle');
  });

  it('按住（没有读条）⇒ attack 段，且帧号随 tick 前进（循环，不是定格）', () => {
    const a = actorPoseOf({ tick: 0, cast: undefined, holding: true, attack: ATTACK });
    const b = actorPoseOf({ tick: 3, cast: undefined, holding: true, attack: ATTACK });
    expect(a.pool).toBe('attack');
    expect(b.pool).toBe('attack');
    expect(a.index).not.toBe(b.index);
  });

  it('有读条时按读条进度（按住不改变它）', () => {
    const pose = actorPoseOf({ tick: 99, cast: { progress: 0.5 }, holding: true, attack: ATTACK });
    expect(pose).toEqual({ pool: 'attack', index: 2 });
  });

  it('没有攻击段素材 ⇒ 永远 idle', () => {
    expect(actorPoseOf({ tick: 5, cast: undefined, holding: true, attack: [] }).pool).toBe('idle');
  });
});
