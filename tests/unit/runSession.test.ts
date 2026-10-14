import { describe, expect, it } from 'vitest';
import { createRunSession } from '../../src/app/runSession';
import { BOSS_POOL, isDeveloping } from '../../src/data/roster';
import { ALL_QIJI } from '../../src/data/qiji';
import type { EventDef } from '../../src/core/events';

/**
 * `app/runSession.ts` —— 一局肉鸽的持有者。
 *
 * ⚠️ **P3 起它不再是 P2 的桩**：会真的推进 N 场、每场之后给炁机选择。
 * 这一份测试覆盖三块：
 *   1. 开局（种子决定顺序 / `?runlen` 截断）—— P2 就有的行为
 *   2. 一场打完之后的**去向判定**（`advance` 的三种返回）
 *   3. 炁机选择（`candidates` / `chooseQiji` / 叠层）
 *
 * 能在这个 project（node、无 DOM）里测，是因为**种子由调用方传入** ——
 * 这一层不碰 `Date.now()`（`core/` 不许有它，这是 lint C2 的硬约束）。
 */
const POOL = ['meiichiro', 'lust'] as const;

/** 一个能读懂的统计输入：`n` 次「截」的 `skillUsed`（解锁「截炁·生击」用）。 */
function jieUses(n: number, tick = 1): readonly EventDef[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'skillUsed' as const,
    tick: tick + i,
    sourceId: 'player',
    skillId: 'jie',
  }));
}

/** 一场胜利（满血）的空事件流。 */
const WIN: readonly EventDef[] = [];

describe('一局肉鸽的开局：种子决定顺序', () => {
  it('同一 runSeed → 同一 Boss（可复现）', () => {
    const a = createRunSession({ bossPool: POOL, qijiPool: [] });
    const b = createRunSession({ bossPool: POOL, qijiPool: [] });
    a.begin('player', 12345);
    b.begin('player', 12345);
    expect(a.bossId()).toBe(b.bossId());
    expect(a.state()?.order).toEqual(b.state()?.order);
  });

  it('开局的形状：position = 1 / status = active / playerId 写进去', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: [] });
    run.begin('kaili', 7);
    expect(run.active).toBe(true);
    expect(run.position()).toBe(1);
    expect(run.length()).toBe(POOL.length);
    expect(run.state()?.playerId).toBe('kaili');
    expect(run.state()?.status).toBe('active');
  });

  it('第 1 场打的是 `order[0]`，而且一定在池子里', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: [] });
    for (const seed of [1, 2, 3, 99, 0xffff_ffff]) {
      run.begin('player', seed);
      const boss = run.bossId();
      expect(boss).toBeDefined();
      expect(POOL).toContain(boss);
      expect(run.state()?.order[0]).toBe(boss);
    }
  });

  it('池子为空 → 没有 Boss 可取（调用方据此不开战）', () => {
    const run = createRunSession({ bossPool: [], qijiPool: [] });
    run.begin('player', 1);
    expect(run.bossId()).toBeUndefined();
    expect(run.length()).toBe(0);
    expect(run.active).toBe(true);
  });

  it('clear() 之后什么都没有了', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: [] });
    run.begin('player', 1);
    run.clear();
    expect(run.active).toBe(false);
    expect(run.state()).toBeUndefined();
    expect(run.bossId()).toBeUndefined();
    expect(run.position()).toBeUndefined();
    expect(run.length()).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * `?runlen=N`：一局只打 N 场（P2 的验收物）
 * ------------------------------------------------------------------ */

describe('`?runlen=N`：这一局打几场', () => {
  const LONG = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;

  it('不传 runlen → 池子多长就打几场（今天的默认）', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: [] });
    run.begin('player', 1);
    expect(run.length()).toBe(2);
  });

  it('runlen = 2 → 只打 2 场（顺序是洗牌结果的前 2 个）', () => {
    const full = createRunSession({ bossPool: LONG, qijiPool: [] });
    full.begin('player', 5);
    const run = createRunSession({ bossPool: LONG, qijiPool: [], runLength: 2 });
    run.begin('player', 5);
    expect(run.length()).toBe(2);
    /** ⚠️ 不是"另洗一次"：前 2 个必须与完整顺序的前 2 个**逐位相同**。 */
    expect(run.state()?.order).toEqual(full.state()?.order.slice(0, 2));
  });

  it('runlen 超过池子长度 → 夹到池子长度（`?runlen=99` = 全打）', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: [], runLength: 99 });
    run.begin('player', 1);
    expect(run.length()).toBe(2);
  });

  it('runlen = 0 / 负数 → 至少打 1 场（不能开一局 0 场的）', () => {
    for (const runlen of [0, -3]) {
      const run = createRunSession({ bossPool: POOL, qijiPool: [], runLength: runlen });
      run.begin('player', 1);
      expect(run.length()).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 一场打完之后去哪（`advance`）
 * ------------------------------------------------------------------ */

describe('一场打完之后的去向（P3 的核心状态转移）', () => {
  it('赢了、还有下一场 → 进炁机选择（每场之后选 1 个）', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    /** 2 场的一局：第 1 场赢了还有第 2 场。 */
    expect(run.advance('victory', WIN, true).kind).toBe('selectQiji');
  });

  it('打满 runlen → runOver', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI, runLength: 1 });
    run.begin('player', 1);
    expect(run.advance('victory', WIN, true).kind).toBe('runOver');
  });

  it('输了 → runOver（一局全丢，position 停在死的那一场）', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    expect(run.advance('defeat', WIN, false).kind).toBe('runOver');
    expect(run.state()?.status).toBe('defeat');
    expect(run.state()?.position).toBe(1);
  });

  it('⚠️ 候选为空时**不进**选择屏，直接开下一场', () => {
    /**
     * 用空池子：没有炁机可解锁，所以每一场之后都没有候选。
     * 这条钉的是"选择屏只在真有得选的时候出现" —— 否则会画一个空屏。
     */
    const run = createRunSession({ bossPool: POOL, qijiPool: [] });
    run.begin('player', 1);
    const next = run.advance('victory', WIN, true);
    expect(next.kind).toBe('battle');
    if (next.kind === 'battle') expect(POOL).toContain(next.bossId);
  });

  it('这一场刚数的"用了 3 次截"**这一场就解锁**（先累加、后判定）', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    run.advance('victory', jieUses(3), true);
    expect(run.state()?.unlocked).toContain('jieShengJi');
  });

  it('只用了 2 次 → 不解锁（反面）', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    run.advance('victory', jieUses(2), true);
    expect(run.state()?.unlocked).not.toContain('jieShengJi');
  });

  it('累计是**本局**的：第 1 场 2 次 + 第 2 场 1 次 = 3 次 → 第 2 场解锁', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    run.advance('victory', jieUses(2), true);
    expect(run.state()?.unlocked).not.toContain('jieShengJi');
    /** 第二场（赢下之后就是最后一局，`advance` 会返回 runOver，但统计照加）。 */
    run.advance('victory', jieUses(1, 10), true);
    expect(run.state()?.unlocked).toContain('jieShengJi');
  });

  it('未开局时 advance 不会崩（返回 runOver）', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    expect(run.advance('victory', WIN, true).kind).toBe('runOver');
  });
});

/* ------------------------------------------------------------------ *
 * 炁机候选与选择
 * ------------------------------------------------------------------ */

describe('炁机候选（两条 `unlock: always` 的兜底恒在）', () => {
  it('开局还没打完那一场时也有候选（恒在池里）——但**界面不会**在第一场之前出现', () => {
    /**
     * ⚠️ 这两件事要分开看：
     *   - `candidates()` 从 `begin` 之后就有（两条通用炁机 `always`）
     *   - **选择屏只在第一场打完之后出现** —— 那是 `phaseFlow` 的判据
     *     （`startRoguelikeRun` 直接进战斗，不经过选择屏）
     */
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    const ids = run.candidates().map((c) => c.qiji.id);
    expect(ids).toContain('vitality');
    expect(ids).toContain('breath');
    /** 三条"用了 3 次"的炁机开局**不解锁**。 */
    expect(ids).not.toContain('jieShengJi');
  });

  it('选一个 → `chosen` 记下**它自己**（没有层数），而它**立刻从候选里消失**', () => {
    /**
     * ⚠️ 旧版这条叫"`chosen` 记 1 层，而它仍是候选（可叠）"——
     * 用户 2026-10-13 推翻了那条语义（"一局只能选一次（不叠加）"），
     * 所以现在 `chosen` 的元素只有一个 `qijiId`，选过的**不再**是候选。
     */
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    expect(run.chooseQiji('vitality')).toBe(true);
    expect(run.state()?.chosen).toEqual([{ qijiId: 'vitality' }]);
    expect(run.candidates().map((c) => c.qiji.id)).not.toContain('vitality');
  });

  it('⚠️【核心】再选同一个 → **失败**（它已经不在候选里，没有"叠第 2 层"）', () => {
    /**
     * 这条同时钉住两件事：
     *   1. `chooseQiji` 的判据是"**在不在候选里**"（复用 `nextCandidates`），
     *      所以选过的 id 直接被拒 —— 不是"接受但只记一次"
     *   2. `chosen` 里**不会出现两条同 id**（数组长度是 1）
     */
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    expect(run.chooseQiji('vitality')).toBe(true);
    expect(run.chooseQiji('vitality')).toBe(false);
    expect(run.state()?.chosen).toEqual([{ qijiId: 'vitality' }]);
  });

  it('选一个**没解锁 / 不存在**的 → 失败（判定复用候选，不另写一套）', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    run.begin('player', 1);
    expect(run.chooseQiji('jieShengJi')).toBe(false);
    expect(run.chooseQiji('nope')).toBe(false);
    expect(run.state()?.chosen).toEqual([]);
  });

  it('未开局时 candidates 是空数组、chooseQiji 失败', () => {
    const run = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI });
    expect(run.candidates()).toEqual([]);
    expect(run.chooseQiji('vitality')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Boss 池 = 做完的那些（设计稿 §2.3）
 * ------------------------------------------------------------------ */

describe('Boss 池 = **做完的**那些（设计稿 §2.3）', () => {
  it('不含任何 `DEVELOPING` 里的 Boss（占位轮转让"随机顺序"像 bug）', () => {
    for (const entry of BOSS_POOL) {
      expect(isDeveloping(entry.id)).toBe(false);
    }
  });

  it('现在有傲慢、色欲、嫉妒（未实现的 Boss 会陆续进来）', () => {
    expect(BOSS_POOL.map((b) => b.id)).toEqual(['meiichiro', 'lust', 'envy']);
  });

  it('池子派生自 BOSS_ROSTER：id / nameKey 都在', () => {
    for (const entry of BOSS_POOL) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.nameKey).toBe('string');
    }
  });
});
