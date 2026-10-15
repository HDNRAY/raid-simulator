import { describe, expect, it } from 'vitest';
import { createFpsOverlay } from '../../src/app/fpsOverlay';
import type { TranslateFn } from '../../src/i18n/translator';

/**
 * ==================================================================
 * FPS 层（`?fps=1`）：**只在参数打开时存在**，且每帧只被喂一次
 * ==================================================================
 *
 * 设计稿：`docs/specs/2026-10-15-fps-overlay.md`。
 *
 * ⚠️ 这一份是**少量**的 DOM 冒烟（`web` project 有 jsdom），钉三件
 * 截图 / 手动操作都证明不了的事：
 *
 *   1. **不带 `?fps=1` 时一行 DOM 都不建**（工厂返回 `undefined`）——
 *      设计稿 §2 的第三条，也是"线上不挂调试条"的落地
 *   2. **它不参与布局**：条形层 `pointer-events:none`（只有按钮 `auto`）
 *   3. **按钮那两条流水**：录制 → 状态行有样本数 → 停止 → 导出拿到一份
 *      结构正确的 csv（导出走**注入的** `save`，不真下文件 —— jsdom 没有
 *      `URL.createObjectURL`）
 *
 * ⚠️ 桶化 / spikes / summary 的数**不在这里测**：那些是纯逻辑，在
 * `tests/unit/fpsStats.test.ts` 里逐条钉着（本文件不重复）。
 */

/** 取词桩：把 key 与参数原样拼出来，方便断言"界面上真的写了什么"。 */
const stubTranslate: TranslateFn = (key, params) =>
  params === undefined ? key : `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`;

function setup(enabled: boolean): {
  readonly host: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly overlay: ReturnType<typeof createFpsOverlay>;
  readonly saved: { text: string; name: string }[];
} {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  host.id = 'stage';
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);
  const saved: { text: string; name: string }[] = [];
  const overlay = createFpsOverlay({
    enabled,
    host,
    canvas,
    translate: stubTranslate,
    save: (text, name) => saved.push({ text, name }),
    commit: 'deadbee',
  });
  return { host, canvas, overlay, saved };
}

/** 面板上的两颗按钮：`[录制/停止, 导出]`。 */
function buttons(overlay: NonNullable<ReturnType<typeof createFpsOverlay>>): {
  readonly record: HTMLButtonElement;
  readonly exportButton: HTMLButtonElement;
} {
  const all = overlay.root.querySelectorAll('button');
  return { record: all[0]!, exportButton: all[1]! };
}

/** 按 60fps 喂 `count` 帧（从 t=0 开始）。 */
function feed(
  overlay: NonNullable<ReturnType<typeof createFpsOverlay>>,
  count: number,
  stepMs = 1000 / 60,
): void {
  for (let i = 0; i < count; i += 1) overlay.frame(i * stepMs);
}

describe('⚠️ `?fps=1` 之外**一行 DOM 都不建**', () => {
  it('`enabled: false` → 工厂返回 `undefined`，宿主里没有新节点', () => {
    const { host, overlay } = setup(false);
    expect(overlay).toBeUndefined();
    /** 宿主里只有那个 canvas（一个子节点都没多）。 */
    expect(host.children).toHaveLength(1);
    expect(host.querySelector('#fps-overlay')).toBeNull();
    /** 连 `position: relative` 都没动（不改宿主的样式）。 */
    expect(host.style.position).toBe('');
  });

  it('`enabled: true` → 面板挂在宿主里，且**不参与布局**（吃指针的是按钮自己）', () => {
    const { host, overlay } = setup(true);
    expect(overlay).toBeDefined();
    expect(host.querySelector('#fps-overlay')).not.toBeNull();
    /** 浮层的定位祖先由工厂补上（`#stage` 默认是 static）。 */
    expect(host.style.position).toBe('relative');
    const bar = overlay?.root;
    expect(bar?.style.pointerEvents).toBe('none');
    expect(bar?.style.position).toBe('absolute');
    const { record, exportButton } = buttons(overlay!);
    expect(record.style.pointerEvents).toBe('auto');
    expect(exportButton.style.pointerEvents).toBe('auto');
    /** 文案走 i18n（这里用桩，所以断言的是 key）。 */
    expect(record.textContent).toBe('dev.fps.record');
    expect(exportButton.textContent).toBe('dev.fps.export');
  });
});

describe('每秒刷新一次 FPS 读数', () => {
  it('喂满一秒的帧 → 读数变成 ~60（而不是停在 `--`）', () => {
    const { overlay } = setup(true);
    const o = overlay!;
    /** 61 帧：t = 0 … 1000ms（第 61 帧落在窗口末尾）。 */
    feed(o, 61);
    expect(o.root.textContent).toContain('FPS 60.0');
  });

  it('第一帧只立基准（不会算出一个假的 0.0）', () => {
    const { overlay } = setup(true);
    overlay?.frame(5000);
    expect(overlay?.root.textContent).toContain('FPS --');
  });
});

describe('录制 → 停止 → 导出（按钮流水）', () => {
  it('点「录制」开始采样、状态行给出样本数；再点变成「停止」', () => {
    const { overlay } = setup(true);
    const o = overlay!;
    const { record } = buttons(o);

    expect(o.state().recording).toBe(false);
    expect(record.textContent).toBe('dev.fps.record');
    /** 还没录过：导不出东西。 */
    expect(buttons(o).exportButton.disabled).toBe(true);

    record.click();
    expect(o.state().recording).toBe(true);
    expect(buttons(o).record.textContent).toBe('dev.fps.stop');

    /** 喂 61 帧（跨过 1 秒）→ 状态行由秒级刷新写成"录制中 · N 样本 · M 秒"。 */
    feed(o, 61);
    expect(o.state().frames).toBeGreaterThanOrEqual(59);
    expect(o.root.textContent).toContain('dev.fps.recording');
    expect(o.root.textContent).toContain('samples=');

    buttons(o).record.click();
    expect(o.state().recording).toBe(false);
    expect(buttons(o).record.textContent).toBe('dev.fps.record');
    /** 停下来了 → 可以导出。 */
    expect(buttons(o).exportButton.disabled).toBe(false);
    expect(o.root.textContent).toContain('dev.fps.stopped');
  });

  it('再点「录制」**清空**上一段缓冲（录的是这一段）', () => {
    const { overlay } = setup(true);
    const o = overlay!;
    buttons(o).record.click();
    feed(o, 61);
    const first = o.state().frames;
    expect(first).toBeGreaterThan(0);

    buttons(o).record.click();
    expect(o.state().frames).toBe(first);
    /** 重新开始 → 立刻归零。 */
    buttons(o).record.click();
    expect(o.state().frames).toBe(0);
  });

  it('点「导出」→ 注入的 save 拿到一份 fps-log 文本与规范文件名', () => {
    const { overlay, saved } = setup(true);
    const o = overlay!;
    buttons(o).record.click();
    feed(o, 121);
    buttons(o).record.click();
    buttons(o).exportButton.click();

    expect(saved).toHaveLength(1);
    const entry = saved[0]!;
    expect(entry.name).toMatch(/^fps-log-\d{8}-\d{6}\.csv$/);
    expect(entry.text).toContain('# fps-log v1');
    /** commit 透传（"能从 build 里拿到就填，拿不到写 unknown"）。 */
    expect(entry.text).toContain('# commit=deadbee');
    expect(entry.text).toContain('t_ms,fps_avg,fps_min,frame_ms_max');
    expect(entry.text).toContain('# summary');
  });
});
