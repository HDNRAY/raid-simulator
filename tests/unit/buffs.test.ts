import { beforeEach, describe, expect, it } from 'vitest';
import {
  aggregateFlags,
  applyBuff,
  buffRemainingMs,
  buffStacks,
  expireBuffs,
  expandBuffModifiers,
  hasBuff,
  isInComboWindow,
  removeBuff,
  resetBuffInstanceCounter,
} from '../../src/core/buffs';
import { CHANGE_TICK as T } from './helpers';
import type { BuffDef, Combatant } from '../../src/core/types';
import { makeCombatant } from './helpers';

function def(overrides: Partial<BuffDef> & Pick<BuffDef, 'id' | 'stacking'>): BuffDef {
  return {
    nameKey: 'stat.haste',
    icon: 'i',
    polarity: 'buff',
    duration: 1000,
    maxStacks: 1,
    ...overrides,
  };
}

beforeEach(() => {
  resetBuffInstanceCounter();
});

describe('applyBuff —— 六种叠层规则', () => {
  it('refresh（默认）：刷新时长，层数不变', () => {
    const c = makeCombatant();
    const d = def({ id: 'a', stacking: { mode: 'refresh' }, duration: 1000 });
    const first = applyBuff(c, d, 'src', 0);
    expect(first.change).toBe('applied');
    expect(first.stacks).toBe(1);

    const later = { ...c, buffs: first.buffs };
    const second = applyBuff(later, d, 'src', 30);
    expect(second.change).toBe('refreshed');
    expect(second.stacks).toBe(1);
    // 过期时间被推后了
    const expiry = (b: (typeof second.buffs)[number]): number => b.expiresAtTick;
    expect(expiry(second.buffs[0]!)).toBeGreaterThan(expiry(first.buffs[0]!));
  });

  it('stack：加层但封顶', () => {
    const d = def({ id: 'a', stacking: { mode: 'stack', max: 3 } });
    let c = makeCombatant();
    for (let i = 0; i < 5; i += 1) {
      const r = applyBuff(c, d, 'src', i);
      c = { ...c, buffs: r.buffs };
    }
    expect(buffStacks(c, 'a')).toBe(3);
  });

  it('stackRefresh：加层同时刷新时长', () => {
    const d = def({ id: 'a', stacking: { mode: 'stackRefresh', max: 5 }, duration: 1000 });
    let c = makeCombatant();
    const first = applyBuff(c, d, 'src', 0);
    c = { ...c, buffs: first.buffs };
    const second = applyBuff(c, d, 'src', 30);
    expect(second.stacks).toBe(2);
    expect(second.buffs[0]!.expiresAtTick).toBe(30 + 60);
  });

  it('independent：同 defId 多实例，各自计时', () => {
    const d = def({ id: 'a', stacking: { mode: 'independent', max: 3 } });
    let c = makeCombatant();
    for (let i = 0; i < 3; i += 1) {
      const r = applyBuff(c, d, `src${i}`, i * 10);
      c = { ...c, buffs: r.buffs };
    }
    expect(c.buffs).toHaveLength(3);
    // instanceId 各不相同
    expect(new Set(c.buffs.map((b) => b.instanceId)).size).toBe(3);
  });

  it('independent 到上限时替换最早的那个', () => {
    const d = def({ id: 'a', stacking: { mode: 'independent', max: 2 } });
    let c = makeCombatant();
    for (let i = 0; i < 4; i += 1) {
      const r = applyBuff(c, d, `src${i}`, i * 10);
      c = { ...c, buffs: r.buffs };
    }
    expect(c.buffs).toHaveLength(2);
    // 留下的是较新的两个
    expect(c.buffs.map((b) => b.appliedAtTick).sort((a, b) => a - b)).toEqual([20, 30]);
  });

  it('replace：新顶替旧（同 defId 只剩一个）', () => {
    const d = def({ id: 'a', stacking: { mode: 'replace' }, duration: 1000 });
    let c = makeCombatant();
    c = { ...c, buffs: applyBuff(c, d, 's1', 0).buffs };
    const r = applyBuff(c, d, 's2', 50);
    expect(r.change).toBe('replaced');
    expect(r.buffs).toHaveLength(1);
    expect(r.buffs[0]!.sourceId).toBe('s2');
  });

  it('extend：时长叠加但有上限', () => {
    const d = def({ id: 'a', stacking: { mode: 'extend', maxDurationMs: 3000 }, duration: 1000 });
    let c = makeCombatant();
    for (let i = 0; i < 5; i += 1) {
      const r = applyBuff(c, d, 'src', i);
      c = { ...c, buffs: r.buffs };
    }
    // 上限 3000ms = 180 tick（从 appliedAtTick=0 起算）
    expect(c.buffs[0]!.expiresAtTick).toBeLessThanOrEqual(0 + 180);
  });

  it('永久 buff（duration = Infinity）的过期时间是 Infinity', () => {
    const d = def({ id: 'a', stacking: { mode: 'refresh' }, duration: Number.POSITIVE_INFINITY });
    const r = applyBuff(makeCombatant(), d, 'src', 0);
    expect(r.buffs[0]!.expiresAtTick).toBe(Number.POSITIVE_INFINITY);
  });

  it('duration 为 0 或负数时至少持续 1 tick（不会立刻消失）', () => {
    const d = def({ id: 'a', stacking: { mode: 'refresh' }, duration: 0 });
    const r = applyBuff(makeCombatant(), d, 'src', 0);
    expect(r.buffs[0]!.expiresAtTick).toBe(1);
  });
});

describe('expireBuffs', () => {
  it('到期的被移除并报告 defId', () => {
    const d = def({ id: 'a', stacking: { mode: 'refresh' }, duration: 1000 });
    const r = applyBuff(makeCombatant(), d, 'src', 0);
    // 1000ms = 60 tick
    const at59 = expireBuffs(r.buffs, 59);
    expect(at59.expired).toHaveLength(0);
    const at60 = expireBuffs(r.buffs, 60);
    expect(at60.expired).toEqual(['a']);
    expect(at60.buffs).toHaveLength(0);
  });

  it('刚好在边界上过期（闭区间）', () => {
    const d = def({ id: 'a', stacking: { mode: 'refresh' }, duration: 300 });
    const r = applyBuff(makeCombatant(), d, 'src', 0);
    // 300ms = 18 tick
    expect(expireBuffs(r.buffs, 17).expired).toHaveLength(0);
    expect(expireBuffs(r.buffs, 18).expired).toHaveLength(1);
  });

  it('未到期的保留', () => {
    const d = def({ id: 'a', stacking: { mode: 'refresh' }, duration: 10000 });
    const r = applyBuff(makeCombatant(), d, 'src', 0);
    expect(expireBuffs(r.buffs, 500).buffs).toHaveLength(1);
  });
});

describe('查询', () => {
  it('buffStacks 对同 defId 的多实例求和', () => {
    const d = def({ id: 'a', stacking: { mode: 'stack', max: 3 } });
    let c = makeCombatant();
    for (let i = 0; i < 3; i += 1) c = { ...c, buffs: applyBuff(c, d, 'src', i).buffs };
    expect(buffStacks(c, 'a')).toBe(3);
    expect(hasBuff(c, 'a')).toBe(true);
    expect(hasBuff(c, 'nope')).toBe(false);
  });

  it('buffRemainingMs 报告剩余时间', () => {
    const d = def({ id: 'a', stacking: { mode: 'refresh' }, duration: 1000 });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), d, 'src', 0).buffs };
    expect(buffRemainingMs(c, 'a', 0)).toBeCloseTo(1000, 6);
    expect(buffRemainingMs(c, 'a', 30)).toBeCloseTo(500, 6);
    expect(buffRemainingMs(c, 'a', 200)).toBe(0);
    expect(buffRemainingMs(c, 'nope', 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('removeBuff 按 defId 移除', () => {
    const d = def({ id: 'a', stacking: { mode: 'refresh' } });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), d, 'src', 0).buffs };
    expect(removeBuff(c, 'a')).toHaveLength(0);
  });
});

describe('aggregateFlags —— 判定层的输入', () => {
  it('闪避 buff：invulnerable', () => {
    const dodge = def({
      id: 'dodge',
      stacking: { mode: 'refresh' },
      duration: 300,
      flags: { invulnerable: true },
    });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), dodge, 'src', 0).buffs };
    expect(aggregateFlags(c).invulnerable).toBe(true);
  });

  it('格挡 buff：damageReduce', () => {
    const guard = def({
      id: 'guard',
      stacking: { mode: 'refresh' },
      duration: 1500,
      flags: { damageReduce: 0.6 },
    });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), guard, 'src', 0).buffs };
    expect(aggregateFlags(c).damageReduce).toBeCloseTo(0.6, 10);
  });

  it('【关键】多个减伤来源取最大值而不是相加', () => {
    // 相加会让两层 60% 变成 120%（超过免疫），而且玩家无法预期
    const a = def({ id: 'a', stacking: { mode: 'refresh' }, flags: { damageReduce: 0.6 } });
    const b = def({ id: 'b', stacking: { mode: 'refresh' }, flags: { damageReduce: 0.5 } });
    let c = makeCombatant();
    c = { ...c, buffs: applyBuff(c, a, 'src', 0).buffs };
    c = { ...c, buffs: applyBuff(c, b, 'src', 0).buffs };
    expect(aggregateFlags(c).damageReduce).toBeCloseTo(0.6, 10);
  });

  it('GCD 与动作锁', () => {
    const gcd = def({ id: 'gcd', stacking: { mode: 'refresh' }, flags: { blocksGcd: true } });
    const lock = def({ id: 'lock', stacking: { mode: 'refresh' }, flags: { actionLock: true } });
    let c = makeCombatant();
    c = { ...c, buffs: applyBuff(c, gcd, 'src', 0).buffs };
    expect(aggregateFlags(c).blocksGcd).toBe(true);
    expect(aggregateFlags(c).actionLock).toBeUndefined();
    c = { ...c, buffs: applyBuff(c, lock, 'src', 0).buffs };
    expect(aggregateFlags(c).actionLock).toBe(true);
  });

  it('派生窗口：comboWindow 汇总多个 buff', () => {
    const a = def({
      id: 'combo1',
      stacking: { mode: 'refresh' },
      flags: { comboWindow: ['arc'] },
    });
    const b = def({
      id: 'combo2',
      stacking: { mode: 'refresh' },
      flags: { comboWindow: ['heavy', 'arc'] },
    });
    let c = makeCombatant();
    c = { ...c, buffs: applyBuff(c, a, 'src', 0).buffs };
    c = { ...c, buffs: applyBuff(c, b, 'src', 0).buffs };
    expect(aggregateFlags(c).comboWindow).toEqual(['arc', 'heavy', 'arc']);
    expect(isInComboWindow(c, 'arc')).toBe(true);
    expect(isInComboWindow(c, 'heavy')).toBe(true);
    expect(isInComboWindow(c, 'slash')).toBe(false);
  });

  it('没有任何 buff 时返回空对象', () => {
    expect(aggregateFlags(makeCombatant())).toEqual({});
  });
});

describe('expandBuffModifiers', () => {
  it('给没有 namespace 的修正补上 buffId（保证 contrib 能引用）', () => {
    const d = def({
      id: 'surge',
      stacking: { mode: 'refresh' },
      modifiers: [
        { stat: 'damageBoost', op: 'addPercent', value: 0.1, sourceKey: 'stat.damageBoost' },
      ],
    });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), d, 'src', 0).buffs };
    const expanded = expandBuffModifiers(c, new Map());
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.modifier.namespace).toBe('surge');
    expect(expanded[0]?.stacks).toBe(1);
  });

  it('已有 namespace 的保留原样', () => {
    const d = def({
      id: 'surge',
      stacking: { mode: 'refresh' },
      modifiers: [
        {
          stat: 'damageBoost',
          op: 'addPercent',
          value: 0.1,
          sourceKey: 'stat.damageBoost',
          namespace: 'entropy-clock.potential',
        },
      ],
    });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), d, 'src', 0).buffs };
    const expanded = expandBuffModifiers(c, new Map());
    expect(expanded[0]?.modifier.namespace).toBe('entropy-clock.potential');
  });

  it('层数被带出来（perStackAdd 需要）', () => {
    const d = def({
      id: 'intent',
      stacking: { mode: 'stack', max: 10 },
      modifiers: [
        {
          stat: 'damageBoost',
          op: 'perStackAdd',
          value: 0.02,
          sourceKey: 'stat.damageBoost',
          namespace: 'intent',
        },
      ],
    });
    let c: Combatant = makeCombatant();
    for (let i = 0; i < 4; i += 1) c = { ...c, buffs: applyBuff(c, d, 'src', i).buffs };
    const expanded = expandBuffModifiers(c, new Map());
    expect(expanded[0]?.stacks).toBe(4);
  });
});

describe('C5：buff 状态可结构化克隆', () => {
  it('带 def 的 BuffInstance 仍可克隆（def 是不可变对象）', () => {
    const d = def({ id: 'a', stacking: { mode: 'refresh' } });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), d, 'src', 0).buffs };
    expect(() => structuredClone(c)).not.toThrow();
    expect(structuredClone(c).buffs[0]?.defId).toBe('a');
  });
});

void T;
