import { describe, expect, it } from 'vitest';
import { createRunSession } from '../../src/app/runSession';
import { BOSS_POOL, isDeveloping } from '../../src/data/roster';

/**
 * `app/runSession.ts` —— 一局肉鸽的持有者（P2 只有**一场**）。
 *
 * ⚠️ 这一层现在是**刻意的桩**：只用来"洗出 Boss 顺序、取第 1 场是谁"，
 * 战斗一结束就整个丢掉（见那个文件头）。P3 会把它接成"N 场 + 炁机选择"。
 *
 * 能在这个 project（node、无 DOM）里测，是因为**种子由调用方传入** ——
 * 这一层不碰 `Date.now()`（`core/` 不许有它，这是 lint C2 的硬约束）。
 */
const POOL = ['meiichiro', 'lust'] as const;

describe('一局肉鸽的开局：种子决定顺序', () => {
  it('同一 runSeed → 同一 Boss（可复现）', () => {
    const a = createRunSession({ bossPool: POOL });
    const b = createRunSession({ bossPool: POOL });
    a.begin('player', 12345);
    b.begin('player', 12345);
    expect(a.bossId()).toBe(b.bossId());
    expect(a.state()?.order).toEqual(b.state()?.order);
  });

  it('开局的形状：position = 1 / status = active / playerId 写进去', () => {
    const run = createRunSession({ bossPool: POOL });
    run.begin('kaili', 7);
    expect(run.active).toBe(true);
    expect(run.position()).toBe(1);
    expect(run.length()).toBe(POOL.length);
    expect(run.state()?.playerId).toBe('kaili');
    expect(run.state()?.status).toBe('active');
  });

  it('第 1 场打的是 `order[0]`，而且一定在池子里', () => {
    const run = createRunSession({ bossPool: POOL });
    for (const seed of [1, 2, 3, 99, 0xffff_ffff]) {
      run.begin('player', seed);
      const boss = run.bossId();
      expect(boss).toBeDefined();
      expect(POOL).toContain(boss);
      expect(run.state()?.order[0]).toBe(boss);
    }
  });

  it('池子为空 → 没有 Boss 可取（调用方据此不开战）', () => {
    const run = createRunSession({ bossPool: [] });
    run.begin('player', 1);
    expect(run.bossId()).toBeUndefined();
    expect(run.length()).toBe(0);
    expect(run.active).toBe(true);
  });

  it('clear() 之后什么都没有了（P2 的桩：一场打完就丢）', () => {
    const run = createRunSession({ bossPool: POOL });
    run.begin('player', 1);
    run.clear();
    expect(run.active).toBe(false);
    expect(run.state()).toBeUndefined();
    expect(run.bossId()).toBeUndefined();
    expect(run.position()).toBeUndefined();
    expect(run.length()).toBeUndefined();
  });
});

describe('Boss 池 = **做完的**那些（设计稿 §2.3）', () => {
  it('不含任何 `DEVELOPING` 里的 Boss（占位轮转让"随机顺序"像 bug）', () => {
    for (const entry of BOSS_POOL) {
      expect(isDeveloping(entry.id)).toBe(false);
    }
  });

  it('现在只有傲慢与色欲（P2 的现状：未实现的 Boss 会陆续进来）', () => {
    expect(BOSS_POOL.map((b) => b.id)).toEqual(['meiichiro', 'lust']);
  });

  it('池子派生自 BOSS_ROSTER：id / nameKey 都在', () => {
    for (const entry of BOSS_POOL) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.nameKey).toBe('string');
    }
  });
});
