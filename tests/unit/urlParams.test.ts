import { describe, expect, it } from 'vitest';
import { readUrlParams } from '../../src/app/urlParams';

/**
 * **URL 启动参数**（`?prepare=skip` / `?boss=` / `?noai=1` / `?fps=1` /
 * `?runlen=N` / `?runseed=N`）。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §2.3（开发期怎么跑短局 /
 * 复现某一局的 Boss 顺序）。
 *
 * ⚠️ 这一份测的是**解析**（纯函数），不是"参数真的生效" —— 后者由
 * `runSession.test.ts`（`runLength` 的截断 + "同一 `runSeed` → 同一 Boss"）
 * 与 `?runlen=2` / `?runseed=123` 的实测覆盖。
 */

describe('`?prepare=skip` / `?boss=` / `?noai=1`（既有行为，不许变）', () => {
  it('什么都不传 → 全默认', () => {
    const p = readUrlParams('');
    expect(p.skipPrepare).toBe(false);
    expect(p.boss).toBeNull();
    expect(p.noAi).toBe(false);
    expect(p.runLength).toBeNull();
    expect(p.runSeed).toBeNull();
    expect(p.fps).toBe(false);
  });

  it('⚠️ `fps=1` 只在恰好是 `1` 时为真（`?fps` / `?fps=0` 都不开）', () => {
    /**
     * 它决定"要不要创建那一层 HTML 调试条"（线上默认不挂）。
     * 宽松解析（`?fps` 也算真）会让一个手写的空参数在线上多出一层 DOM
     * —— 所以口径与 `?noai=` 完全一致。
     */
    expect(readUrlParams('?fps=1').fps).toBe(true);
    expect(readUrlParams('?fps').fps).toBe(false);
    expect(readUrlParams('?fps=0').fps).toBe(false);
    expect(readUrlParams('?fps=true').fps).toBe(false);
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

describe('`?runseed=N`：这一局的种子（Boss 顺序可复现）', () => {
  it('正整数原样认', () => {
    expect(readUrlParams('?runseed=1').runSeed).toBe(1);
    expect(readUrlParams('?runseed=123').runSeed).toBe(123);
    expect(readUrlParams('?runseed=20261013').runSeed).toBe(20261013);
  });

  it('⚠️ 不传 → `null`（= 现取 `Date.now() >>> 0`，不传时行为逐字不变）', () => {
    /**
     * ⚠️ `null` 不是"种子的默认值" —— 它是"没给"这个事实本身。落点
     * （`app/phaseFlow.ts` 的 `startRoguelikeRun`）看到 `undefined` 才会去
     * 走原来那条 `Date.now() >>> 0`，所以"不传时行为不变"是**结构上**的，
     * 不是靠一个缺省数值恰好相等。
     */
    expect(readUrlParams('').runSeed).toBeNull();
    expect(readUrlParams('?runseed=').runSeed).toBeNull();
  });

  it('⚠️ 非法值一律当**没传**（`0` / 负数 / 小数 / 非数字）', () => {
    /**
     * 与 `?runlen=` **同一处**解析（`parsePositiveInt`）：`0` 也当没传 ——
     * 它是"正整数"这条口径的边界，而"种子 0"不表达任何调试意图。
     */
    for (const raw of ['0', '-1', '2.5', 'abc', '2abc', ' ', 'NaN', 'Infinity']) {
      expect(readUrlParams(`?runseed=${raw}`).runSeed, `runseed=${raw}`).toBeNull();
    }
  });

  it('没有上限校验（uint32 规范化在 core 里做）', () => {
    /** `startRun` / `createRng` 都会 `>>> 0`，所以大数是合法的。 */
    expect(readUrlParams('?runseed=4294967295').runSeed).toBe(4294967295);
    expect(readUrlParams('?runseed=99999999999').runSeed).toBe(99999999999);
  });

  it('与 `?runlen=` 同用 → 两个都认（种子决定顺序、runlen 决定截多长）', () => {
    const p = readUrlParams('?runlen=1&runseed=123');
    expect(p.runLength).toBe(1);
    expect(p.runSeed).toBe(123);
  });

  it('同一个串解析两次给出同一个值（复现的起点）', () => {
    expect(readUrlParams('?runseed=123').runSeed).toBe(readUrlParams('?runseed=123').runSeed);
  });
});
