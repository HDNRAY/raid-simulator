/**
 * **FPS 日志的纯逻辑**：采样 → 桶 / 卡顿点 / 摘要 → 那份 csv 文本。
 *
 * 设计稿：`docs/specs/2026-10-15-fps-overlay.md` §3（日志格式）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"一堆帧时长 → 一份**给人 / AI 读**的日志"这件事的**全部算法**：
 * 采样期只做两个加法与一次 push（桶化在采样时完成），导出期只做一次汇总。
 * 它不认识 DOM、不认识 Pixi、不认识 URL —— 所以能在 node 里精确测
 * （`tests/unit/fpsStats.test.ts`）。
 *
 * ==================================================================
 * ⚠️ 为什么不 dump 每帧（日志的**三层**）
 * ==================================================================
 *
 * 一分钟 = 3600 帧：逐帧 dump 既大又难读。所以：
 *
 * ```
 *   ① 每 100ms 一个桶     t_ms,fps_avg,fps_min,frame_ms_max   （≈10 行/秒）
 *   ② spikes             t_ms,frame_ms（> 2× 中位帧时间那些）
 *   ③ summary            一行：分位 / 极值 / 掉帧数 / 最长卡顿
 * ```
 *
 * ⚠️ 三个数**定义不同**（写在这里以免它们互相矛盾）：
 *
 * | 列 | 定义 |
 * |---|---|
 * | `fps_avg` | 该桶内 `帧数 ÷ 该桶实际跨过的时长`（**不是**恒除以 100ms —— 最后一个桶可能没满） |
 * | `fps_min` | 该桶内**最长那一帧**换算的瞬时 FPS（`1000 ÷ 最长帧`） |
 * | `frame_ms_max` | 该桶内最长帧的毫秒数 |
 *
 * ==================================================================
 * ⚠️ 缓冲上限（长录会吃内存）
 * ==================================================================
 *
 * 采样时逐帧留一份时长（约 8 字节/帧）—— 因为"**2× 中位数**"这条判据
 * 必须等录完才知道中位数（没法边采边定阈值）。上限是
 * `FPS_MAX_FRAMES`（20 万帧 ≈ 55 分钟 @60fps）；到顶就**停止采样**
 * 并置 `full`（界面据此提示），而不是继续吃内存。
 *
 * ⚠️ 帧的**时刻**不单独存：它是时长的前缀和（导出时累加一次即得）——
 * 存两份就是同一件事的两份表达（AGENTS.md §2），而它们会漂。
 *
 * ==================================================================
 * ⚠️ 这份 csv 的抬头是**英文**（有意）
 * ==================================================================
 *
 * 设计稿 §3 的例子写的是中文抬头（`时长=` / `掉帧(>33ms)=`）。这里改成
 * ASCII（`duration=` / `dropped_gt33ms=`），有两个理由：
 *
 *   1. 用户对格式的原话是"**大概率是给你（AI）读，你读什么效率高用什么**"
 *      —— 英文抬头同样能读，而且更省 token
 *   2. `src/` 里写中文常量会被 i18n 硬约束（I1：面向玩家的文字必须来自
 *      语言包）拦下，而这份 csv **不是**面向玩家的文案（它是开发工具产物）
 *      —— 为了它往语言包里加一堆键，反而把"玩家能看到的文案"搅浑
 */

/** 一个桶的时长（毫秒）—— 日志里"每 100ms 一行"。 */
export const FPS_BUCKET_MS = 100;

/**
 * 卡顿判据：帧时长**严格大于** `FPS_SPIKE_FACTOR × 中位帧时间` 才算 spike。
 *
 * ⚠️ **边界定死**：恰好等于 2× 中位数**不算**（用 `>`，不是 `>=`）——
 * 否则"帧时长恰好是中位数的两倍"这种常见取值会整片进 spikes 段。
 */
export const FPS_SPIKE_FACTOR = 2;

/**
 * 掉帧判据（毫秒）：超过它算"掉帧"。
 *
 * ⚠️ 33ms ≈ 两个 60Hz 帧预算（16.67 × 2）—— 也就是"这一帧至少丢了一帧"。
 * 它只服务 summary 里那一个计数。
 */
export const FPS_DROPPED_MS = 33;

/**
 * 缓冲上限（帧数）。
 *
 * ⚠️ 20 万帧 ≈ 55 分钟 @60fps（设计稿说的"30 分钟 / 20 万个桶"是量级
 * 示意；这里按**帧**记账，因为逐帧时长才是 spikes 需要的）。
 */
export const FPS_MAX_FRAMES = 200_000;

/** 一个桶（采样期就地累加，**不**逐帧 push）。 */
export interface FpsBucket {
  /** 桶起点（`FPS_BUCKET_MS` 的整数倍）。 */
  readonly tMs: number;
  /** 这个桶里采到的帧数。 */
  readonly frames: number;
  /**
   * 这个桶**实际跨过的时长**（毫秒，≤ `FPS_BUCKET_MS`）。
   *
   * ⚠️ 它存在的唯一理由是**最后一个桶可能没满**：拿 100ms 当分母会把
   * 一个只跨了 40ms 的尾桶算成"30fps"（假掉帧）。
   */
  readonly spanMs: number;
  /** 这个桶里**最长**那一帧的毫秒数。 */
  readonly frameMsMax: number;
}

/** 采样器（`createFpsRecorder()` 的产物）。 */
export interface FpsRecorder {
  /** 已经采到的帧数。 */
  readonly frames: number;
  /** 已经跨过的总时长（毫秒）。 */
  readonly durationMs: number;
  /** 已经封好的桶（**只有真有帧的桶**；`tMs` 跳号 = 那段时间没有帧）。 */
  readonly buckets: readonly FpsBucket[];
  /** 每一帧的时长（只读引用；导出时才用它算中位数 / spikes）。 */
  readonly frameMs: readonly number[];
  /** 缓冲是否已满（满了之后 `push` 是空操作）。 */
  readonly full: boolean;
  /** 记一帧。 */
  push(frameMs: number): void;
  /** 清空（重新开始录制）。 */
  reset(): void;
}

/**
 * 造一个采样器。
 *
 * ⚠️ 用**工厂 + 闭包**而不是 class（与 `app/runSession` 同一条）：调用方
 * 会解构它（`const { push } = recorder`），而 class 的方法一旦解构就丢了
 * `this`（那是一个**不报错**的 bug）。
 */
export function createFpsRecorder(): FpsRecorder {
  const frameMs: number[] = [];
  const buckets: FpsBucket[] = [];
  let durationMs = 0;
  let full = false;

  return {
    get frames(): number {
      return frameMs.length;
    },
    get durationMs(): number {
      return durationMs;
    },
    get buckets(): readonly FpsBucket[] {
      return buckets;
    },
    get frameMs(): readonly number[] {
      return frameMs;
    },
    get full(): boolean {
      return full;
    },

    push(ms: number): void {
      if (full) return;
      /**
       * ⚠️ 非有限 / 负数**不是**"一帧很短"，而是坏样本（时钟回拨、
       * 第一次采样的初值）—— 丢掉它，别让它污染中位数与桶。
       */
      if (!Number.isFinite(ms) || ms < 0) return;
      if (frameMs.length >= FPS_MAX_FRAMES) {
        full = true;
        return;
      }
      frameMs.push(ms);
      /**
       * ⚠️ 帧归到**它开始那一刻**所在的桶：一次 250ms 的冻结要落在"它开始
       * 的那一格"上（那才是"卡在哪儿"），而不是它结束的那一格。
       */
      const startMs = durationMs;
      durationMs += ms;
      const tMs = Math.floor(startMs / FPS_BUCKET_MS) * FPS_BUCKET_MS;
      /**
       * 桶的跨度 = **这个桶实际被帧覆盖到哪儿**（封顶一格），于是：
       *   - 满桶 ≈ 100ms
       *   - 最后一个（没收满的）桶 = 它真实跨过的时长 —— 拿 100 当分母会把
       *     尾桶算成假掉帧（见 `spanMs` 的说明）
       *   - 一帧结束在桶边界上时也不会得到 0（跨度按"开始时刻"算）
       */
      const spanMs = Math.min(FPS_BUCKET_MS, Math.max(0, durationMs - tMs));
      const last = buckets[buckets.length - 1];
      if (last !== undefined && last.tMs === tMs) {
        buckets[buckets.length - 1] = {
          tMs,
          frames: last.frames + 1,
          spanMs,
          frameMsMax: Math.max(last.frameMsMax, ms),
        };
        return;
      }
      buckets.push({ tMs, frames: 1, spanMs, frameMsMax: ms });
    },

    reset(): void {
      frameMs.length = 0;
      buckets.length = 0;
      durationMs = 0;
      full = false;
    },
  };
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

/** 一份日志的摘要（summary 段的那几个数）。 */
export interface FpsSummary {
  readonly frames: number;
  readonly durationMs: number;
  /** 平均 FPS（总帧数 ÷ 总时长）。 */
  readonly avg: number;
  /** 帧时间中位数（= p50）。 */
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  /** 最短 / 最长的帧时长（毫秒）。 */
  readonly min: number;
  readonly max: number;
  /** 掉帧数（帧时长 > `FPS_DROPPED_MS`）。 */
  readonly dropped: number;
  /** 最长那一帧出现在什么时候（毫秒，**帧结束时刻**）。 */
  readonly longestAtMs: number;
}

/**
 * 分位（**nearest-rank**：取排序后第 `ceil(p × n)` 个）。
 *
 * ⚠️ 不用插值：插值出来的"16.7ms"在小样本上会给出一个**没有发生过**的
 * 帧时长，而这份日志的用途是"找出真的卡在哪儿"。
 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1] ?? 0;
}

/** 帧时长的中位数（偶数个取**靠前**那一个 —— 与 `percentile(…, 0.5)` 同一个口径）。 */
export function medianFrameMs(frameMs: readonly number[]): number {
  if (frameMs.length === 0) return 0;
  const sorted = [...frameMs].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

/** 汇总一份采样（纯函数：同样的输入永远同样的输出）。 */
export function summarizeFps(frameMs: readonly number[], durationMs: number): FpsSummary {
  if (frameMs.length === 0) {
    return {
      frames: 0,
      durationMs,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
      dropped: 0,
      longestAtMs: 0,
    };
  }
  const sorted = [...frameMs].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] ?? 0;
  /** ⚠️ 最长帧的时刻由**前缀和**推（时长里没有时刻，见文件头）。 */
  let elapsed = 0;
  let longestAtMs = 0;
  for (const ms of frameMs) {
    elapsed += ms;
    if (ms === max) {
      longestAtMs = elapsed;
      break;
    }
  }
  return {
    frames: frameMs.length,
    durationMs,
    avg: durationMs > 0 ? (frameMs.length / durationMs) * 1000 : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0] ?? 0,
    max,
    dropped: frameMs.filter((ms) => ms > FPS_DROPPED_MS).length,
    longestAtMs,
  };
}

/** 一个卡顿点（`t_ms` = 那一帧的**结束**时刻）。 */
export interface FpsSpike {
  readonly tMs: number;
  readonly frameMs: number;
}

/**
 * 挑出卡顿点：帧时长 > `FPS_SPIKE_FACTOR × 中位帧时间`。
 *
 * ⚠️ 阈值是**中位数**（不是平均数）：一次 3 秒的冻结会把平均数拉高到
 * "之后的卡顿都不算 spike"，而中位数不会被单点带偏。
 */
export function spikesOf(
  frameMs: readonly number[],
  factor: number = FPS_SPIKE_FACTOR,
): readonly FpsSpike[] {
  const threshold = medianFrameMs(frameMs) * factor;
  const out: FpsSpike[] = [];
  let elapsed = 0;
  for (const ms of frameMs) {
    elapsed += ms;
    /** ⚠️ **严格大于**（边界定死，见 `FPS_SPIKE_FACTOR` 的说明）。 */
    if (ms > threshold) out.push({ tMs: Math.round(elapsed), frameMs: ms });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 文本
 * ------------------------------------------------------------------ */

/** 日志抬头要的那几个环境读数（由调用方给 —— 本模块不碰 DOM / URL）。 */
export interface FpsLogMeta {
  readonly url: string;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly dpr: number;
  readonly ua: string;
  /**
   * 构建版本（git 短哈希）。
   *
   * ⚠️ **能从 build 里拿到就填，拿不到写 `unknown`**（设计稿 §3）——
   * 不要为了它去 `git`（浏览器里没有），也不要编一个。
   */
  readonly commit: string;
}

/** 保留一位小数（日志里的数都按这个精度写）。 */
function fixed(value: number): string {
  return value.toFixed(1);
}

/**
 * 生成那一份 csv 文本（三层，见文件头）。
 *
 * ⚠️ 它是**纯函数**：输入是采样结果 + 几个环境读数，输出是字符串 ——
 * 所以"结构就是那三层"这件事能在 node 里逐行断言，不必起浏览器。
 */
export function buildFpsLog(input: {
  readonly buckets: readonly FpsBucket[];
  readonly frameMs: readonly number[];
  readonly durationMs: number;
  readonly meta: FpsLogMeta;
}): string {
  const { buckets, frameMs, durationMs, meta } = input;
  const summary = summarizeFps(frameMs, durationMs);
  const spikes = spikesOf(frameMs);

  const lines: string[] = [];
  lines.push('# fps-log v1');
  lines.push(
    `# url=${meta.url} canvas=${meta.canvasW}x${meta.canvasH} dpr=${meta.dpr} ua=${meta.ua}`,
  );
  lines.push(`# commit=${meta.commit}`);
  /**
   * ⚠️ 这一行是"帧数"的两份读数之一（另一份是 `# summary` 的 `frames=`）：
   * 两处必须相等，否则说明采样与汇总看的不是同一份数据。
   */
  lines.push(`# duration=${fixed(durationMs / 1000)}s frames=${summary.frames}`);
  lines.push('');

  lines.push('t_ms,fps_avg,fps_min,frame_ms_max');
  for (const bucket of buckets) {
    const fpsAvg = bucket.spanMs > 0 ? (bucket.frames / bucket.spanMs) * 1000 : 0;
    const fpsMin = bucket.frameMsMax > 0 ? 1000 / bucket.frameMsMax : 0;
    lines.push(
      `${bucket.tMs},${fixed(fpsAvg)},${fixed(fpsMin)},${fixed(bucket.frameMsMax)}`,
    );
  }
  lines.push('');

  lines.push(`# spikes (>${FPS_SPIKE_FACTOR}x median frame time)`);
  lines.push('t_ms,frame_ms');
  for (const spike of spikes) lines.push(`${spike.tMs},${fixed(spike.frameMs)}`);
  lines.push('');

  lines.push('# summary');
  lines.push(
    `# avg=${fixed(summary.avg)} p50=${fixed(summary.p50)} p95=${fixed(summary.p95)}` +
      ` p99=${fixed(summary.p99)} min=${fixed(summary.min)} max=${fixed(summary.max)}` +
      ` dropped_gt${FPS_DROPPED_MS}ms=${summary.dropped}` +
      ` longest=${fixed(summary.max)}ms@${Math.round(summary.longestAtMs)}` +
      ` median_frame_ms=${fixed(medianFrameMs(frameMs))} spikes=${spikes.length}`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * 导出文件名：`fps-log-<YYYYMMDD-HHmmss>.csv`。
 *
 * ⚠️ 时间由调用方给（本模块不读时钟 —— `core/` 不许 `Date.now`，而这一层
 * 刻意与它同一条纪律：纯函数才能在 node 里断言文件名格式）。
 */
export function fpsLogFileName(at: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `fps-log-${at.year}${pad(at.month)}${pad(at.day)}-${pad(at.hour)}${pad(at.minute)}${pad(at.second)}.csv`;
}
