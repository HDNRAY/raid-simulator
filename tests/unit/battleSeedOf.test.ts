/**
 * `battleSeedOf` —— **一场战斗的种子从哪来**（B，2026-10-13）。
 *
 * 这一层只做**分派**：肉鸽走 `battleSeed(runSeed, position)`，
 * 没有那一局（自由模式 / 直接单场 / 黄金夹具）回落到时钟。
 *
 * ⚠️ 它只测**分派与边界**，不重复 `battleSeed` 自己的性质
 * （同一输入必然同输出 / 每场独立 / 不同种子不碰撞 —— 那在
 * `tests/unit/run/shuffle.test.ts` 里已经逐条钉过）。
 *
 * ⚠️ 时钟是**注入**的：拿真实 `Date.now()` 写断言会有"同一毫秒内两次调用"
 * 的偶然相等（那会让这条测试偶发地红），而且边界用例（非正场次 / 小数）
 * 需要"时钟到底被没被调用"这个**必然**的读数。
 */

import { describe, expect, it, vi } from 'vitest';

import { battleSeedOf } from '../../src/app/battleSetup';
import { battleSeed } from '../../src/core/run/index';

describe('battleSeedOf —— 肉鸽：从 run seed + 场次派生', () => {
  it('就是 `battleSeed(runSeed, position)`（不是"差不多"的关系）', () => {
    // 断死"它与 core 那一个纯函数是**同一个**结果"：若这里偷偷换成
    // `runSeed + position` 之类的写法，这条会红 —— 而"同种子同结果"
    // 那种性质测试**不会**红（任何确定性写法都满足它）。
    expect(battleSeedOf({ runSeed: 20261013, position: 1 })).toBe(battleSeed(20261013, 1));
    expect(battleSeedOf({ runSeed: 20261013, position: 2 })).toBe(battleSeed(20261013, 2));
    expect(battleSeedOf({ runSeed: 0, position: 7 })).toBe(battleSeed(0, 7));
  });

  it('同一 (runSeed, position) 必然同一种子（可重放的前提）', () => {
    expect(battleSeedOf({ runSeed: 123, position: 1 })).toBe(battleSeedOf({ runSeed: 123, position: 1 }));
  });

  it('⚠️ 同一局的相邻场次**不同**种子（"每场独立"的落点）', () => {
    const first = battleSeedOf({ runSeed: 123, position: 1 });
    const second = battleSeedOf({ runSeed: 123, position: 2 });
    expect(first).not.toBe(second);
  });

  it('⚠️ 派生结果**不是** runSeed 本身（不是把种子原样传下去）', () => {
    expect(battleSeedOf({ runSeed: 123, position: 1 })).not.toBe(123);
  });

  it('结果落在 uint32 范围内（能直接当引擎的 `seed` 用）', () => {
    for (let position = 1; position <= 7; position += 1) {
      const seed = battleSeedOf({ runSeed: 20261013, position });
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });
});

describe('battleSeedOf —— 自由模式 / 直接单场：保持时钟兜底', () => {
  it('`undefined`（没有进行中的一局）→ 现取时钟', () => {
    const clock = (): number => 987654321;
    expect(battleSeedOf(undefined, clock)).toBe(987654321);
  });

  it('⚠️ 肉鸽那一支**不碰时钟**（够不够得着 runSeed 与时钟无关）', () => {
    const clock = vi.fn(() => 111);
    battleSeedOf({ runSeed: 20261013, position: 3 }, clock);
    expect(clock).not.toHaveBeenCalled();
  });

  it('⚠️ 场次非法（0 / 负数 / 小数）→ 回落到时钟，而不是把 0 混进种子', () => {
    /**
     * `RunState.position` 是 1-based（`battleRecordOf` 直接抄它进记录）。
     * 非正数说明调用方拿错了状态 —— 那时宁可"这一次不可复现"，也不要
     * 造出"记录里的场次"与"种子里的场次"是两个不同的数。
     */
    for (const position of [0, -1, 1.5, Number.NaN]) {
      expect(battleSeedOf({ runSeed: 20261013, position }, () => 42), `position=${position}`).toBe(42);
    }
  });
});

describe('battleSeedOf —— 不传时钟时用真实时钟（生产默认）', () => {
  it('默认参数就是 `Date.now`：两次"不同毫秒"的调用给两个不同种子', () => {
    const spy = vi.spyOn(Date, 'now');
    try {
      spy.mockReturnValue(1_000);
      const a = battleSeedOf(undefined);
      spy.mockReturnValue(2_000);
      const b = battleSeedOf(undefined);
      expect(a).toBe(1_000);
      expect(b).toBe(2_000);
      expect(a).not.toBe(b);
    } finally {
      spy.mockRestore();
    }
  });
});
