/**
 * **HTML FPS 层**（贴游戏底边 · 录制 · 导出日志）—— 只在 `?fps=1` 时存在。
 *
 * 设计稿：`docs/specs/2026-10-15-fps-overlay.md`。
 *
 * ==================================================================
 * ⚠️ 这是 AGENTS.md §2 的**有意例外**（"所有 UI 走 canvas"）
 * ==================================================================
 *
 * 这个功能**故意**用 DOM 而不是 canvas，三条理由缺一不可：
 *
 *   1. 它是**开发 / 调优工具**（FPS + 录日志），不是玩法界面
 *   2. 它**不参与游戏布局**：`position: absolute` 贴底、`pointer-events: none`
 *      （只有按钮自己 `auto`）、不改 `#stage` 的尺寸计算
 *   3. **`?fps=1` 才存在** —— 不带参数时**一行 DOM 都不创建**（工厂直接
 *      返回 `undefined`，有单测钉着）
 *
 * ⚠️ 所以它**不是**"以后可以照抄的先例"：想加真正的界面元素仍然走 canvas。
 *
 * ==================================================================
 * ⚠️ 帧的**唯一真相**是主循环那个 ticker
 * ==================================================================
 *
 * `app/loopWiring` 每帧 `state.frameCount += 1`，而这一层由那里回调
 * （`WireOptions.fps.frame(now)`）。**不要**自己再挂一个
 * `requestAnimationFrame` 去数帧 —— 那会变成第二份"帧"的定义，两份必然漂
 * （设计稿 §6 第一条）。
 *
 * ==================================================================
 * 采样的开销（每帧只做两个加法）
 * ==================================================================
 *
 * 桶化在**采样时**完成（`fpsStats.createFpsRecorder`）：每帧就是两次加法 +
 * 一次"同桶就覆盖最后一项"。导出时才做一次汇总（分位 / spikes）。
 * ⚠️ FPS 数字与"录制中"那行状态**每秒才写一次 DOM** —— 每帧改文本本身
 * 就会掉帧（设计稿 §4）。
 */

import {
  buildFpsLog,
  createFpsRecorder,
  fpsLogFileName,
  type FpsRecorder,
} from './fpsStats';
import type { TranslateFn } from '../i18n/translator';

/** 面板与按钮的外观（**内联样式**：这一层只在 `?fps=1` 时存在，不进样式表）。 */
const BAR_STYLE = [
  'position:absolute',
  'left:0',
  'right:0',
  'bottom:0',
  'display:flex',
  'align-items:center',
  'gap:10px',
  'padding:4px 10px',
  'font:12px/1.5 ui-monospace,monospace',
  'color:#dcdcdc',
  'background:rgba(10,10,15,0.78)',
  'pointer-events:none',
  'z-index:10',
].join(';');

const BUTTON_STYLE = [
  'pointer-events:auto',
  'font:12px/1.2 ui-monospace,monospace',
  'color:#dcdcdc',
  'background:#22242e',
  'border:1px solid #3a3d4a',
  'border-radius:3px',
  'padding:2px 8px',
  'cursor:pointer',
].join(';');

export interface FpsOverlayOptions {
  /**
   * 要不要**创建**这一层（`?fps=1`）。
   *
   * ⚠️ 由工厂自己判、而不是调用方 `if`：这样"不带参数时一行 DOM 都不建"
   * 是一条**可单测**的性质（`createFpsOverlay({ enabled:false, … })`
   * 必须返回 `undefined`，且 `host` 里没有任何新节点）。
   */
  readonly enabled: boolean;
  /** 挂到哪（`#stage`）。 */
  readonly host: HTMLElement;
  /** 画布（只读它的内部分辨率，写进日志抬头）。 */
  readonly canvas: HTMLCanvasElement;
  readonly translate: TranslateFn;
  /**
   * 把一份日志存下来。
   *
   * ⚠️ 默认实现是 Blob + `<a download>`（设计稿 §3），而**注入点**存在的
   * 理由与其它注入一致：单测要读那份文本，而不是真去下文件
   * （jsdom 没有 `URL.createObjectURL`）。
   */
  readonly save?: (text: string, fileName: string) => void;
  /** 构建版本（`# commit=` 那一行；拿不到就写 `unknown`）。 */
  readonly commit?: string;
}

/** 这一层对外只有"每帧喂一次" + 一个只读状态（测试 / 验收用）。 */
export interface FpsOverlay {
  /**
   * 每帧调一次（**必须**由主循环那个 ticker 调，别自己挂 rAF）。
   *
   * @param nowMs 当前时刻（毫秒；主循环给 `performance.now()`）
   */
  frame(nowMs: number): void;
  /** 只读状态（测试 / 验收探针用）。 */
  state(): {
    readonly recording: boolean;
    readonly frames: number;
    readonly durationMs: number;
    readonly full: boolean;
  };
  /** 面板根节点（测试断言 DOM 用）。 */
  readonly root: HTMLElement;
}

/**
 * 造这一层。
 *
 * @returns 不带 `?fps=1` 时 `undefined`（**且不创建任何 DOM**）。
 */
export function createFpsOverlay(o: FpsOverlayOptions): FpsOverlay | undefined {
  if (!o.enabled) return undefined;

  const translate = o.translate;
  const recorder: FpsRecorder = createFpsRecorder();

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.id = 'fps-overlay';
  root.style.cssText = BAR_STYLE;

  const fpsLabel = document.createElement('span');
  fpsLabel.textContent = 'FPS --';
  const statusLabel = document.createElement('span');
  /** 状态那一段占满剩下的宽度（按钮贴右端）。 */
  statusLabel.style.cssText = 'flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';

  const makeButton = (label: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = BUTTON_STYLE;
    button.textContent = label;
    return button;
  };
  const recordButton = makeButton(translate('dev.fps.record'));
  const exportButton = makeButton(translate('dev.fps.export'));

  root.append(fpsLabel, statusLabel, recordButton, exportButton);

  /**
   * ⚠️ `#stage` 是 `display:flex` 的居中容器（`styles.css`），默认
   * `position: static` —— 绝对定位的浮层要有一个定位祖先，所以这里**只在
   * 必要时**给它 `position: relative`。它不影响 flex 布局（浮层是
   * out-of-flow），也不会动 canvas 的居中。
   */
  if (getComputedStyle(o.host).position === 'static') o.host.style.position = 'relative';
  o.host.appendChild(root);

  /* ---------- 状态 ---------- */
  let recording = false;
  /** 上一帧的时刻（第一次没有基准，只记下来）。 */
  let lastNow: number | undefined = undefined;
  /** FPS 读数那一秒窗口里数到的帧数 / 窗口起点。 */
  let windowFrames = 0;
  let windowStart = 0;

  const saveLog =
    o.save ??
    ((text: string, fileName: string): void => {
      const blob = new Blob([text], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    });

  /**
   * 导出文件名里的时刻。
   *
   * ⚠️ `Date` 只在这一处取（设计稿 §3）：这一层是 `src/app/` 的 dev 工具，
   * 允许非确定性（`core/` 不许）。
   */
  const fileNameNow = (): string => {
    const at = new Date();
    return fpsLogFileName({
      year: at.getFullYear(),
      month: at.getMonth() + 1,
      day: at.getDate(),
      hour: at.getHours(),
      minute: at.getMinutes(),
      second: at.getSeconds(),
    });
  };

  /** 时间参数（`{samples}` / `{seconds}` 是**数字**，由 i18n 那层格式化）。 */
  const statusParams = (): Readonly<Record<string, string | number>> => ({
    samples: recorder.frames,
    seconds: (recorder.durationMs / 1000).toFixed(1),
  });

  /** 把按钮 / 状态那一段重画一次（**不**每帧调）。 */
  const refresh = (): void => {
    recordButton.textContent = translate(recording ? 'dev.fps.stop' : 'dev.fps.record');
    recordButton.disabled = recorder.full;
    exportButton.disabled = recording || recorder.frames === 0;
    if (recorder.full) {
      statusLabel.textContent = translate('dev.fps.full', statusParams());
      return;
    }
    if (recording) {
      statusLabel.textContent = translate('dev.fps.recording', statusParams());
      return;
    }
    statusLabel.textContent =
      recorder.frames === 0 ? '' : translate('dev.fps.stopped', statusParams());
  };

  const buildLog = (): string =>
    buildFpsLog({
      buckets: recorder.buckets,
      frameMs: recorder.frameMs,
      durationMs: recorder.durationMs,
      meta: {
        url: globalThis.location.href,
        canvasW: o.canvas.width,
        canvasH: o.canvas.height,
        dpr: globalThis.devicePixelRatio,
        ua: globalThis.navigator.userAgent,
        commit: o.commit ?? 'unknown',
      },
    });

  recordButton.addEventListener('click', () => {
    if (recorder.full) return;
    if (recording) {
      recording = false;
    } else {
      /** ⚠️ 每次开始录制都清空缓冲（"录制"= 录这一段）。 */
      recorder.reset();
      recording = true;
    }
    refresh();
  });

  exportButton.addEventListener('click', () => {
    if (recording || recorder.frames === 0) return;
    saveLog(buildLog(), fileNameNow());
  });

  refresh();

  /* ---------- 每帧 ---------- */
  return {
    root,

    frame(nowMs: number): void {
      if (lastNow === undefined) {
        /** 第一帧只立基准：没有"上一帧"就没有帧时长。 */
        lastNow = nowMs;
        windowStart = nowMs;
        return;
      }
      const frameMs = nowMs - lastNow;
      lastNow = nowMs;
      /** ⚠️ 时钟回拨 / 同一个时间戳：丢掉这一帧，不污染中位数与桶。 */
      if (frameMs < 0) return;

      if (recording) {
        recorder.push(frameMs);
        if (recorder.full) {
          /** 到顶就停（`fpsStats.FPS_MAX_FRAMES`）：继续录只会吃内存。 */
          recording = false;
        }
      }

      windowFrames += 1;
      const elapsed = nowMs - windowStart;
      if (elapsed >= 1000) {
        /**
         * ⚠️ **每秒才写一次 DOM**（每帧写文本本身会掉帧）。
         * `FPS_BUCKET_MS` 与这里无关 —— 那是日志的桶宽，这是读数刷新周期。
         */
        fpsLabel.textContent = `FPS ${((windowFrames * 1000) / elapsed).toFixed(1)}`;
        windowFrames = 0;
        windowStart = nowMs;
        /** 录制中/刚满/刚停：那一行状态也跟着秒级刷新。 */
        refresh();
      }
    },

    state(): {
      readonly recording: boolean;
      readonly frames: number;
      readonly durationMs: number;
      readonly full: boolean;
    } {
      return {
        recording,
        frames: recorder.frames,
        durationMs: recorder.durationMs,
        full: recorder.full,
      };
    },
  };
}

/**
 * ⚠️ 这一层**不**做定时器：它只被主循环喂帧。
 *
 * 留给下一个人：想"让 FPS 数字自己动"时**不要**在这里 `setInterval`
 * —— 那个数字的定义就是"帧之间的间隔"，没有帧就没有数（页面失焦时浏览器
 * 会停 rAF，见 AGENTS.md §4b）。
 */
