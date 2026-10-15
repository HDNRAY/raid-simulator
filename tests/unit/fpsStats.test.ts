import { describe, expect, it } from 'vitest';
import {
  FPS_BUCKET_MS,
  FPS_DROPPED_MS,
  FPS_MAX_FRAMES,
  buildFpsLog,
  createFpsRecorder,
  fpsLogFileName,
  medianFrameMs,
  spikesOf,
  summarizeFps,
} from '../../src/app/fpsStats';

/**
 * ==================================================================
 * FPS 日志的**纯逻辑**（设计稿 `docs/specs/2026-10-15-fps-overlay.md` §3）
 * ==================================================================
 *
 * 这一份钉的是"那份 csv 到底长什么样、每个数是怎么来的"——截图 / 手动导出
 * 只能证明"下到了一个文件"，证明不了"桶算对了、spikes 阈值是 2× 中位数、
 * 恰好 2× 算不算"。而这三个数**错了不会报错**（只是一份读起来像真的日志）。
 *
 * ⚠️ 采样期的两个不变量也在这里钉：
 *   - 桶化在**采样时**完成（导出时不再遍历逐帧数据去分桶）
 *   - 缓冲有上限（到顶停止采样，而不是继续吃内存）
 */

/** 采样一串帧时长，返回采样器。 */
function record(frameMs: readonly number[]): ReturnType<typeof createFpsRecorder> {
  const recorder = createFpsRecorder();
  for (const ms of frameMs) recorder.push(ms);
  return recorder;
}

describe('采样：桶化在采样时完成（每 100ms 一格）', () => {
  it('18 帧 16.67ms（≈300ms）→ 3 个满桶、每桶 6 帧、平均 60fps', () => {
    const recorder = record(Array.from({ length: 18 }, () => 16.6667));
    expect(recorder.buckets.map((b) => b.tMs)).toEqual([0, 100, 200]);
    for (const bucket of recorder.buckets) {
      expect(bucket.frames).toBe(6);
      /** 满桶的跨度 ≈ 100ms（不是恰好，因为 6 × 16.6667 = 100.0002）。 */
      expect(bucket.spanMs).toBeCloseTo(FPS_BUCKET_MS, 5);
      expect(bucket.frameMsMax).toBeCloseTo(16.6667, 6);
    }
    /** ⚠️ 18 × 16.6667 = 300.0006（浮点累加），所以只钉到毫秒量级。 */
    expect(recorder.durationMs).toBeCloseTo(300, 2);
    expect(recorder.frames).toBe(18);
    expect(recorder.full).toBe(false);
  });

  it('⚠️ 最后一格没收满时，跨度是**它真实跨过的**（不是恒 100ms）', () => {
    /**
     * 3 帧 16.67ms = 50ms：只跨了半格。拿 100ms 当分母会算出 30fps
     * （假掉帧），而真实是 60fps。
     */
    const recorder = record([16, 17, 17]);
    const bucket = recorder.buckets[0];
    expect(bucket?.frames).toBe(3);
    expect(bucket?.spanMs).toBe(50);
    const fpsAvg = ((bucket?.frames ?? 0) / (bucket?.spanMs ?? 1)) * 1000;
    expect(fpsAvg).toBeCloseTo(60, 0);
  });

  it('⚠️ 长冻结落在**它开始**的那一格，且下一帧的 t_ms 会跳号（看得见断层）', () => {
    /**
     * 6 帧 10ms（60ms）之后一次 250ms 的冻结（开始于 60ms → 第 0 格），
     * 再一帧 10ms（开始于 310ms → 第 300 格）。
     */
    const recorder = record([10, 10, 10, 10, 10, 10, 250, 10]);
    expect(recorder.buckets.map((b) => b.tMs)).toEqual([0, 300]);
    const first = recorder.buckets[0];
    expect(first?.frames).toBe(7);
    expect(first?.frameMsMax).toBe(250);
    expect(first?.spanMs).toBe(FPS_BUCKET_MS);
    /** 100 / 200 两格不存在 = 那段时间没有帧（断层在日志里读得出来）。 */
    expect(recorder.buckets.map((b) => b.tMs)).not.toContain(100);
  });

  it('坏样本（NaN / 负数 / Infinity）被丢掉，不污染桶与中位数', () => {
    const recorder = record([10, Number.NaN, -5, Number.POSITIVE_INFINITY, 10]);
    expect(recorder.frames).toBe(2);
    expect(recorder.durationMs).toBe(20);
    expect(recorder.buckets[0]?.frameMsMax).toBe(10);
  });

  it('⚠️ 缓冲到顶就**停止采样**（`full`，不再吃内存）', () => {
    const recorder = createFpsRecorder();
    for (let i = 0; i < FPS_MAX_FRAMES + 10; i += 1) recorder.push(1);
    expect(recorder.full).toBe(true);
    expect(recorder.frames).toBe(FPS_MAX_FRAMES);
    /** 满了之后 `push` 是空操作（时长也不再涨）。 */
    expect(recorder.durationMs).toBe(FPS_MAX_FRAMES);
  });

  it('`reset()` 清空一切（重新录制不看上一段的数）', () => {
    const recorder = record([10, 10, 10]);
    recorder.reset();
    expect(recorder.frames).toBe(0);
    expect(recorder.durationMs).toBe(0);
    expect(recorder.buckets).toEqual([]);
    expect(recorder.full).toBe(false);
  });
});

describe('卡顿点（spikes）：判据是 **2× 中位帧时间**', () => {
  it('只挑 > 2× 中位数的那些，`t_ms` 是那一帧的结束时刻', () => {
    /** 中位数 = 10ms → 阈值 20ms。 */
    const frames = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 30, 10];
    const spikes = spikesOf(frames);
    expect(spikes).toHaveLength(1);
    expect(spikes[0]?.frameMs).toBe(30);
    /** 前 11 帧之和 = 10×10 + 30 = 130。 */
    expect(spikes[0]?.tMs).toBe(130);
  });

  it('⚠️ **恰好 2×** 中位数**不算** spike（边界定死：严格大于）', () => {
    const frames = [10, 10, 10, 10, 20];
    expect(medianFrameMs(frames)).toBe(10);
    expect(spikesOf(frames)).toEqual([]);
    /** 比它多一点点就算。 */
    expect(spikesOf([10, 10, 10, 10, 20.1])).toHaveLength(1);
  });

  it('一次大冻结**不会**把之后的卡顿挤出 spikes（阈值是中位数不是平均数）', () => {
    /**
     * 若用平均数：一次 3000ms 会把均值拉到 ~350ms，于是 100ms 的卡顿
     * 全都"不算卡顿"（那正是这份日志最想找的东西）。
     */
    const frames = [16, 16, 16, 16, 3000, 16, 16, 100, 16, 16];
    const spikes = spikesOf(frames);
    const times = spikes.map((s) => s.frameMs);
    expect(times).toContain(3000);
    expect(times).toContain(100);
  });

  it('没有帧（或全 0）时不会算出虚空 spikes', () => {
    expect(spikesOf([])).toEqual([]);
    expect(spikesOf([0, 0, 0])).toEqual([]);
  });
});

describe('summary：分位 / 极值 / 掉帧 / 最长卡顿', () => {
  it('给定一串帧时长 → 每个数都对得上', () => {
    /** 100 帧：99 × 10ms + 1 × 50ms（50 > 33 → 掉帧 1 次）。 */
    const frames = [...Array.from({ length: 99 }, () => 10), 50];
    const summary = summarizeFps(frames, 1040);
    expect(summary.frames).toBe(100);
    expect(summary.durationMs).toBe(1040);
    expect(summary.avg).toBeCloseTo((100 / 1040) * 1000, 6);
    /** nearest-rank：p50 = 第 50 个 = 10；p95 = 第 95 个 = 10；p99 = 第 99 个 = 10。 */
    expect(summary.p50).toBe(10);
    expect(summary.p95).toBe(10);
    expect(summary.p99).toBe(10);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(50);
    expect(summary.dropped).toBe(1);
    /** 最长那一帧在最后（前 99 帧 990ms + 50 = 1040）。 */
    expect(summary.longestAtMs).toBe(1040);
  });

  it('分位是 **nearest-rank**（取真的出现过的那一帧，不插值）', () => {
    const frames = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const summary = summarizeFps(frames, 145);
    /** 第 ceil(0.95 × 10) = 10 个 = 100（不是插值出来的 60 那类"没发生过的帧"）。 */
    expect(summary.p95).toBe(100);
    expect(summary.p99).toBe(100);
    expect(summary.p50).toBe(5);
  });

  it('掉帧判据是 > 33ms（边界：33 不算、33.1 算）', () => {
    expect(summarizeFps([FPS_DROPPED_MS], 33).dropped).toBe(0);
    expect(summarizeFps([FPS_DROPPED_MS + 0.1], 33.1).dropped).toBe(1);
  });

  it('空采样 → 一份零值摘要（不抛错、不产生 NaN）', () => {
    const summary = summarizeFps([], 0);
    expect(summary).toEqual({
      frames: 0,
      durationMs: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
      dropped: 0,
      longestAtMs: 0,
    });
  });
});

describe('导出文本：结构就是设计稿那**三层**', () => {
  const recorder = record([
    ...Array.from({ length: 18 }, () => 16.6667),
    /** 一次 60ms 的卡顿（> 2× 中位数）。 */
    60,
    ...Array.from({ length: 12 }, () => 16.6667),
  ]);
  const log = buildFpsLog({
    buckets: recorder.buckets,
    frameMs: recorder.frameMs,
    durationMs: recorder.durationMs,
    meta: {
      url: 'http://localhost:5273/?fps=1',
      canvasW: 960,
      canvasH: 540,
      dpr: 2,
      ua: 'HeadlessChrome',
      commit: 'unknown',
    },
  });
  const lines = log.trimEnd().split('\n');

  it('抬头：版本 / 环境 / commit / 时长与帧数（四行 + 一个空行）', () => {
    expect(lines[0]).toBe('# fps-log v1');
    expect(lines[1]).toContain('url=http://localhost:5273/?fps=1');
    expect(lines[1]).toContain('canvas=960x540');
    expect(lines[1]).toContain('dpr=2');
    expect(lines[1]).toContain('ua=HeadlessChrome');
    expect(lines[2]).toBe('# commit=unknown');
    expect(lines[3]).toMatch(/^# duration=\d+\.\ds frames=\d+$/);
    expect(lines[4]).toBe('');
  });

  it('第一层：桶表的表头 + 每桶一行（t_ms 递增）', () => {
    const headerAt = lines.indexOf('t_ms,fps_avg,fps_min,frame_ms_max');
    expect(headerAt).toBeGreaterThan(0);
    const rows: string[] = [];
    for (const line of lines.slice(headerAt + 1)) {
      if (line === '' || line.startsWith('#')) break;
      rows.push(line);
    }
    expect(rows).toHaveLength(recorder.buckets.length);
    const tms = rows.map((row) => Number(row.split(',')[0]));
    expect(tms).toEqual([...tms].sort((a, b) => a - b));
    for (const row of rows) {
      expect(row.split(',')).toHaveLength(4);
      for (const cell of row.split(',')) expect(Number.isFinite(Number(cell))).toBe(true);
    }
  });

  it('第二层：spikes 段（只有那次 60ms 的冻结）', () => {
    const at = lines.indexOf('# spikes (>2x median frame time)');
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe('t_ms,frame_ms');
    const spikeRows: string[] = [];
    for (const line of lines.slice(at + 2)) {
      if (line === '' || line.startsWith('#')) break;
      spikeRows.push(line);
    }
    expect(spikeRows).toHaveLength(1);
    expect(Number(spikeRows[0]?.split(',')[1])).toBeCloseTo(60, 1);
  });

  it('第三层：summary 一行，且 frames 与抬头那行**一致**', () => {
    const at = lines.indexOf('# summary');
    expect(at).toBeGreaterThan(0);
    const summary = lines[at + 1] ?? '';
    expect(summary).toMatch(/^# avg=/);
    expect(summary).toContain('p50=');
    expect(summary).toContain('p95=');
    expect(summary).toContain('p99=');
    expect(summary).toContain(`dropped_gt${FPS_DROPPED_MS}ms=`);
    expect(summary).toContain('longest=');
    expect(summary).toContain('median_frame_ms=');
    expect(summary).toContain('spikes=1');
    const head = lines[3] ?? '';
    expect(Number(/frames=(\d+)/.exec(head)?.[1])).toBe(recorder.frames);
    /** ⚠️ 摘要里的数必须**真的是**这份采样的汇总（不是写死的示例行）。 */
    const expected = summarizeFps(recorder.frameMs, recorder.durationMs);
    expect(summary).toContain(`avg=${expected.avg.toFixed(1)}`);
    expect(summary).toContain(`p50=${expected.p50.toFixed(1)}`);
    expect(summary).toContain(`max=${expected.max.toFixed(1)}`);
    expect(summary).toContain(`dropped_gt${FPS_DROPPED_MS}ms=${expected.dropped}`);
    expect(summary).toContain(`longest=${expected.max.toFixed(1)}ms@${Math.round(expected.longestAtMs)}`);
  });

  it('空采样也导得出一份**能读**的日志（不会崩、不会给 NaN）', () => {
    const empty = createFpsRecorder();
    const text = buildFpsLog({
      buckets: empty.buckets,
      frameMs: empty.frameMs,
      durationMs: empty.durationMs,
      meta: {
        url: 'http://localhost:5273/?fps=1',
        canvasW: 960,
        canvasH: 540,
        dpr: 1,
        ua: 'x',
        commit: 'unknown',
      },
    });
    expect(text).toContain('# fps-log v1');
    expect(text).toContain('frames=0');
    expect(text).not.toContain('NaN');
  });
});

describe('文件名：`fps-log-<YYYYMMDD-HHmmss>.csv`', () => {
  it('补零到两位', () => {
    expect(
      fpsLogFileName({ year: 2026, month: 10, day: 15, hour: 9, minute: 5, second: 3 }),
    ).toBe('fps-log-20261015-090503.csv');
  });

  it('两位数的月 / 日 / 时 / 分 / 秒原样保留', () => {
    expect(
      fpsLogFileName({ year: 2026, month: 12, day: 31, hour: 23, minute: 59, second: 58 }),
    ).toBe('fps-log-20261231-235958.csv');
  });
});
