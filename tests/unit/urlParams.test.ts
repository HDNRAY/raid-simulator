import { describe, expect, it } from 'vitest';
import { readUrlParams } from '../../src/app/urlParams';

/**
 * **URL 启动参数**（`?prepare=skip` / `?boss=` / `?noai=1` / `?runlen=N`）。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §2.3（开发期怎么跑短局）。
 *
 * ⚠️ 这一份测的是**解析**（纯函数），不是"参数真的生效" —— 后者由
 * `runSession.test.ts`（`runLength` 的截断）与 `?runlen=2` 的实测覆盖。
 */

describe('`?prepare=skip` / `?boss=` / `?noai=1`（既有行为，不许变）', () => {
  it('什么都不传 → 全默认', () => {
    const p = readUrlParams('');
    expect(p.skipPrepare).toBe(false);
    expect(p.boss).toBeNull();
    expect(p.noAi).toBe(false);
    expect(p.runLength).toBeNull();
  });

  it('`prepare=skip` 只在恰好是 `skip` 时为真', () => {
    expect(readUrlParams('?prepare=skip').skipPrepare).toBe(true);
    expect(readUrlParams('?prepare=1').skipPrepare).toBe(false);
    expect(readUrlParams('?prepare=Skip').skipPrepare).toBe(false);
  });

  it('`noai=1` 只在恰好是 `1` 时为真', () => {
    expect(readUrlParams('?noai=1').noAi).toBe(true);
    expect(readUrlParams('?noai=0').noAi).toBe(false);
    expect(readUrlParams('?noai=true').noAi).toBe(false);
  });

  it('`boss=` 原样带出来（校验是 roster 的事，不是解析的事）', () => {
    expect(readUrlParams('?boss=lust').boss).toBe('lust');
    expect(readUrlParams('?boss=nope').boss).toBe('nope');
  });

  it('多个参数一起（`?runlen=2&noai=1`）', () => {
    const p = readUrlParams('?runlen=2&noai=1');
    expect(p.runLength).toBe(2);
    expect(p.noAi).toBe(true);
  });
});

describe('`?runlen=N`：这一局打几场（P2 的调试入口）', () => {
  it('正整数原样认', () => {
    expect(readUrlParams('?runlen=1').runLength).toBe(1);
    expect(readUrlParams('?runlen=2').runLength).toBe(2);
    expect(readUrlParams('?runlen=7').runLength).toBe(7);
  });

  it('⚠️ 不传 → `null`（= 用 Boss 池的长度，**不是** 7）', () => {
    /**
     * 拿 7 当缺省会让"2 个 Boss 的开发期"永远通不了关
     * （见 `core/run/types.ts` 的 `MAX_RUN_POSITION`）。
     */
    expect(readUrlParams('').runLength).toBeNull();
    expect(readUrlParams('?runlen=').runLength).toBeNull();
  });

  it('⚠️ 非法值一律当**没传**（调试入口宁可"像没写"，也不猜）', () => {
    for (const raw of ['0', '-1', '2.5', 'abc', '2abc', ' ', 'NaN', 'Infinity']) {
      expect(readUrlParams(`?runlen=${raw}`).runLength, `runlen=${raw}`).toBeNull();
    }
  });

  it('比池子长是**允许**的（由 `runSession` 夹到池子长度）', () => {
    /** 解析层不做"知不知道池子"的判断 —— 那是 run 层的知识。 */
    expect(readUrlParams('?runlen=99').runLength).toBe(99);
  });
});
