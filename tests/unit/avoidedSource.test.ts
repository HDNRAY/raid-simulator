import { describe, expect, it } from 'vitest';
import { applyBuff } from '../../src/core/buffs';
import {
  absorbedByOf,
  blockBuffIdOf,
  thresholdBuffIdOf,
  withAbsorbedByBuffId,
} from '../../src/core/combat/avoidedSource';
import type { BuffDef, Combatant, EventDef } from '../../src/core/types';
import { makeBuffDef, makeCombatant } from './helpers';

/**
 * ==================================================================
 * "**是谁吸收了这一击**" —— 两个出口的判定（纯函数）
 * ==================================================================
 *
 * 它守的是「连消带打」（卸 → 击）能不能被观测到，而两个出口问的**不是
 * 同一个问题**（本文件第 3 组就是那个反例）：
 *
 * | 出口 | 事件字段 | 含义 |
 * |---|---|---|
 * | 完全挡下 | `avoided.viaBuffId` | `blockBuffIdOf`：**无敌优先**，否则取阈值最大的 |
 * | 磨掉一部分 | `damage.viaBuffId` | `thresholdBuffIdOf`：**只可能是阈值** |
 *
 * ⚠️ 为什么不能用同一个解析器：同一击上既挂无敌又挂阈值时，"完全挡下"
 * 是无敌干的、而"磨掉一部分"只可能来自阈值 —— 用 `blockBuffIdOf` 会把
 * 后者记到无敌那个 buff 上（于是炁机认错 buff，窗口开不出来）。
 *
 * ⚠️ 真引擎的那一端（`damage.thinned` 真的会被 `hitResolution` 补上）
 * 在 `playerKits.test.ts` 与 `comboWindow.test.ts`；这里钉**判定本身**
 * （含"没磨掉就不写字段"这条最容易写错的）。
 */

/** 无敌 buff（「闪」/「避」的判据）。 */
const IFRAME = makeBuffDef({
  id: 'iframe',
  nameKey: 'skill.flash.name',
  flags: { invulnerable: true },
});

/** 阈值 buff（「卸」的判据），数值可调 —— 用来验"取最大"。 */
const guardLike = (id: string, threshold: number): BuffDef =>
  makeBuffDef({ id, nameKey: 'skill.guard.name', flags: { damageThreshold: threshold } });

/** 把 buff 真挂上去（实例的形状只该由 `applyBuff` 决定）。 */
function withBuffs(base: Combatant, defs: readonly BuffDef[]): Combatant {
  return defs.reduce((c, def) => ({ ...c, buffs: applyBuff(c, def, c.id, 0).buffs }), base);
}

/** 一条 `damage` 事件（只带本文件关心的字段）。 */
function damage(overrides: Partial<Extract<EventDef, { kind: 'damage' }>> = {}): EventDef {
  return {
    kind: 'damage',
    tick: 1,
    sourceId: 'boss',
    targetId: 'player',
    amount: 20,
    crit: false,
    absorbed: 0,
    thinned: 15,
    overkill: 0,
    skillId: 'boss-cleave',
    ...overrides,
  };
}

const avoidedEvent = (viaBuffId?: string): EventDef => ({
  kind: 'avoided',
  tick: 1,
  sourceId: 'boss',
  targetId: 'player',
  skillId: 'boss-cleave',
  reason: 'immune',
  ...(viaBuffId === undefined ? {} : { viaBuffId }),
});

describe('① `thresholdBuffIdOf`：阈值取**最大**的那一个', () => {
  it('没有阈值 buff → undefined（缺键，不是空串）', () => {
    expect(thresholdBuffIdOf(withBuffs(makeCombatant(), []))).toBeUndefined();
    expect(thresholdBuffIdOf(withBuffs(makeCombatant(), [IFRAME]))).toBeUndefined();
  });

  it('一个阈值 buff → 它自己', () => {
    expect(thresholdBuffIdOf(withBuffs(makeCombatant(), [guardLike('guard', 15)]))).toBe('guard');
  });

  it('⚠️ 两个阈值 buff → **大的那个**（与 `aggregateFlags` 取最大同源）', () => {
    const weak = guardLike('weak-guard', 5);
    const strong = guardLike('strong-guard', 15);
    /** 两个顺序都试：判据不能依赖挂载顺序。 */
    expect(thresholdBuffIdOf(withBuffs(makeCombatant(), [weak, strong]))).toBe('strong-guard');
    expect(thresholdBuffIdOf(withBuffs(makeCombatant(), [strong, weak]))).toBe('strong-guard');
  });
});

describe('② `blockBuffIdOf`：无敌优先，否则阈值', () => {
  it('无敌 → 它自己（「闪」/「避」靠它区分）', () => {
    expect(blockBuffIdOf(withBuffs(makeCombatant(), [IFRAME]))).toBe('iframe');
  });

  it('只有阈值 → 阈值那个', () => {
    expect(blockBuffIdOf(withBuffs(makeCombatant(), [guardLike('guard', 15)]))).toBe('guard');
  });

  it('⚠️ 两个都在 → 无敌（"完全挡下"是它干的）', () => {
    const target = withBuffs(makeCombatant(), [guardLike('guard', 15), IFRAME]);
    expect(blockBuffIdOf(target)).toBe('iframe');
  });
});

describe('③ `absorbedByOf`：两个出口**问的不是同一个问题**', () => {
  const both = withBuffs(makeCombatant(), [guardLike('guard', 15), IFRAME]);

  it('没被挡下（`avoided = false`）→ `blockedBy` 缺，而 `thinnedBy` 仍然问出阈值那个', () => {
    expect(absorbedByOf(both, false)).toEqual({ blockedBy: undefined, thinnedBy: 'guard' });
  });

  it('被挡下（`avoided = true`）→ `blockedBy` = 无敌；`thinnedBy` **仍然是阈值**（两者可以不同）', () => {
    expect(absorbedByOf(both, true)).toEqual({ blockedBy: 'iframe', thinnedBy: 'guard' });
  });

  it('什么 buff 都没有 → 两个都缺', () => {
    expect(absorbedByOf(makeCombatant(), false)).toEqual({
      blockedBy: undefined,
      thinnedBy: undefined,
    });
  });
});

describe('④ `withAbsorbedByBuffId`：补字段（含"没磨掉就不写"）', () => {
  it('`avoided` 事件补 `viaBuffId`', () => {
    const out = withAbsorbedByBuffId([avoidedEvent()], { blockedBy: 'guard', thinnedBy: undefined });
    const first = out[0];
    expect(first?.kind === 'avoided' ? first.viaBuffId : undefined).toBe('guard');
  });

  it('`thinned > 0` 的 `damage` 事件补 `viaBuffId`', () => {
    const out = withAbsorbedByBuffId([damage({ thinned: 15 })], {
      blockedBy: undefined,
      thinnedBy: 'guard',
    });
    const first = out[0];
    expect(first?.kind === 'damage' ? first.viaBuffId : undefined).toBe('guard');
  });

  it('⚠️ `thinned = 0` 的 `damage` 事件**不补**（挂着阈值 buff 不等于这一击被它吸收了）', () => {
    const out = withAbsorbedByBuffId([damage({ thinned: 0 })], {
      blockedBy: undefined,
      thinnedBy: 'guard',
    });
    const first = out[0];
    expect(first?.kind === 'damage' ? first.viaBuffId : undefined).toBeUndefined();
  });

  it('⚠️ 命中的整击作废（`avoided`）只在**完全挡下**时才补', () => {
    const out = withAbsorbedByBuffId([avoidedEvent()], { blockedBy: undefined, thinnedBy: 'guard' });
    const first = out[0];
    expect(first?.kind === 'avoided' ? first.viaBuffId : undefined).toBeUndefined();
  });

  it('两个都缺 → 原样返回**同一个数组**（没有可补的就不复制）', () => {
    const events = [damage()];
    expect(withAbsorbedByBuffId(events, { blockedBy: undefined, thinnedBy: undefined })).toBe(
      events,
    );
  });

  it('不改入参（返回新数组，原事件的字段不动）', () => {
    const events = [damage({ thinned: 15 })];
    const out = withAbsorbedByBuffId(events, { blockedBy: undefined, thinnedBy: 'guard' });
    expect(out).not.toBe(events);
    const original = events[0];
    expect(original?.kind === 'damage' ? original.viaBuffId : undefined).toBeUndefined();
  });

  it('别的 kind 原样返回（死亡 / 治疗不该被碰）', () => {
    const death: EventDef = { kind: 'death', tick: 1, targetId: 'player' };
    const out = withAbsorbedByBuffId([death], { blockedBy: 'guard', thinnedBy: 'guard' });
    expect(out[0]).toBe(death);
  });
});
