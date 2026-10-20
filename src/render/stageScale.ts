/**
 * **渲染缓冲的倍率**（`STAGE_SCALE`，2026-10-20）。
 *
 * ==================================================================
 * 它是什么（一句话）
 * ==================================================================
 *
 * **逻辑空间仍然是 960×540**（所有布局常量、命中测试都不动）；这个数只决定
 * "**一个逻辑像素用几个设备像素画**"：
 *
 * ```
 *   STAGE_SCALE = 1  → 缓冲 960×540    （今天以前的样子）
 *   STAGE_SCALE = 2  → 缓冲 1920×1080  （1080p 屏上 CSS 缩放变成 1:1）
 * ```
 *
 * 用户的原话："根据设备尺寸改逻辑分辨率，或者逻辑分辨率直接拉到 1920×1080
 * 符合主流屏幕，然后小的屏幕等比缩放。"
 *
 * ⚠️ **不要**把它理解成"把 `LOGICAL` 改成 1920×1080"：那样所有按 960×540
 * 设计的常量（字号 13/17/20、块头高 40、详情区 x624 宽 296……）会把界面
 * 缩到**左上角四分之一**。等效且正确的做法就是"整体 ×2"—— 也就是这个数。
 *
 * ==================================================================
 * 怎么定（纯函数，可测）
 * ==================================================================
 *
 * | 来源 | 判据 |
 * |---|---|
 * | `?scale=1` / `?scale=2` | **强制覆盖**（截图验证 / 用户自救） |
 * | 触屏（`capsOf(mode).touch`） | **1** —— 手机上 960 的缓冲是**被缩小**显示的（视口才 ~400 CSS 像素），再翻倍只是白烧 4 倍填充 |
 * | 视口宽 ≥ 1200 | **2** —— 桌面/大屏上 CSS 在**放大**缓冲，放大就糊 |
 * | 其它 | 1 |
 *
 * ⚠️ 与 `render/platform.ts` 那条纪律一致：**不从 UA / `matchMedia` 猜**，
 * 只读"操作方式"那个**唯一 flag**（`capsOf`）与视口宽度（由入口传进来）。
 *
 * ⚠️ 这是**启动期**的决定：`renderer.resolution` 要在 `app.init` 之前给。
 * 运行期切换得重建 render target（本仓库不做 —— 用户改窗口大小不会重算，
 * 与"UI 缩放只作用于界面部件"同一条口径）。
 */

/** 允许的倍率（`?scale=` 只认这两个）。 */
export const STAGE_SCALE_CHOICES = [1, 2] as const;

export type StageScale = (typeof STAGE_SCALE_CHOICES)[number];

/** 视口**宽**到这个数以上才值得上 2×（桌面 / 大屏笔记本）。 */
export const WIDE_VIEWPORT_PX = 1200;

/**
 * 解析 `?scale=`（`'1'` / `'2'` 才认，其余当没传）。
 *
 * ⚠️ 与 `?runlen=` 那套"写错了当作没写"同一条口径（调试入口不该因为拼错
 * 就悄悄用一个别的值）。
 */
export function parseStageScale(raw: string | null): StageScale | undefined {
  if (raw === null) return undefined;
  const value = raw.trim();
  if (value === '1') return 1;
  if (value === '2') return 2;
  return undefined;
}

/**
 * 这一台设备该用几倍缓冲。
 *
 * @param override `?scale=` 显式指定的那个（有就**完全听它**）
 */
export function resolveStageScale(args: {
  readonly touch: boolean;
  readonly viewportWidth: number;
  readonly override?: StageScale;
}): StageScale {
  if (args.override !== undefined) return args.override;
  /** 手机：960 的缓冲本来就在被缩小显示，翻倍没有收益。 */
  if (args.touch) return 1;
  return args.viewportWidth >= WIDE_VIEWPORT_PX ? 2 : 1;
}
