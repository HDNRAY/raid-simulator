import { describe, expect, it } from 'vitest';
import { makeEngine } from '../golden/fixtures';
import type { EventDef } from '../../src/core/types';

/**
 * ==================================================================
 * **开发模式的一键过关**（`BattleEngine.devKill`）
 * ==================================================================
 *
 * 用户 2026-10-22："开发模式，再加一个功能，一键过关，放在设置旁边，
 * 快捷键 f2"。
 *
 * 本文件钉的**不是按钮**，而是这条硬要求：
 *
 * > 一键过关的结算必须与"真打赢"**一模一样**。
 *
 * 所以断言的是**机制**（结算事件 / 状态 / 胜者），而不是某个数字：
 *   - `status` 变成 `victory`、`endReason` 是 `hpZero`
 *   - 事件流里出现 `encounterEnd`，且 `result` 是 `'victory'`
 *   - Boss 的 `alive` 变假、`hp` 归零（不留"死了但血还在"的自相矛盾快照）
 *   - 已经结束 / 已经没有这一侧时再按一次 ⇒ `false`（幂等，不重复结算）
 */

function endEvents(events: readonly EventDef[]): Extract<EventDef, { kind: 'encounterEnd' }>[] {
  return events.filter((e): e is Extract<EventDef, { kind: 'encounterEnd' }> => e.kind === 'encounterEnd');
}

describe('devKill：一键过关走真实结算', () => {
  it('打死 Boss ⇒ status=victory / endReason=hpZero / 有 encounterEnd 事件', () => {
    const engine = makeEngine();
    expect(engine.snapshot.status).toBe('running');

    expect(engine.devKill('enemy')).toBe(true);

    const snap = engine.snapshot;
    expect(snap.status).toBe('victory');
    expect(snap.endReason).toBe('hpZero');

    const boss = snap.combatants.find((c) => c.side === 'enemy');
    expect(boss?.alive).toBe(false);
    expect(boss?.resources.hp).toBe(0);

    const ends = endEvents(engine.drainEvents());
    expect(ends).toHaveLength(1);
    expect(ends[0]?.result).toBe('victory');
    expect(ends[0]?.reason).toBe('hpZero');
  });

  it('玩家一侧还活着（一键过关不会顺手把玩家也判死）', () => {
    const engine = makeEngine();
    engine.devKill('enemy');
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally');
    expect(player?.alive).toBe(true);
  });

  it('已经结束之后再按 ⇒ false，且**不会**再记一条 encounterEnd', () => {
    const engine = makeEngine();
    expect(engine.devKill('enemy')).toBe(true);
    engine.drainEvents();

    expect(engine.devKill('enemy')).toBe(false);
    expect(endEvents(engine.drainEvents())).toHaveLength(0);
  });

  it('打玩家一侧 ⇒ 判负（同一条结算路径，方向由"谁死了"决定）', () => {
    const engine = makeEngine();
    expect(engine.devKill('ally')).toBe(true);
    expect(engine.snapshot.status).toBe('defeat');
    expect(endEvents(engine.drainEvents())[0]?.result).toBe('defeat');
  });
});
