/**
 * 设置页右下角**模拟键位预览**的几何。
 *
 * ==================================================================
 * 为什么单独一个文件：预览必须与真实按钮**同一套布局**
 * ==================================================================
 *
 * 需求："在设置页面的右下角，模拟一个 7 个键位"。
 *
 * 如果预览自己摆一套坐标，迟早会和战斗里的双弧不一致 —— 那正是本仓库
 * 反复踩的"两份真相"（预览看着在左、实际在右；`BattleScene` 拆分前的
 * "一个文件装了整个页面"也是同一类）。所以这里**只做一次等比变换**：
 *
 *   1. 双弧的所有槽位圆心来自 `render/touchGeometry.touchButtonCenter`
 *      （**与战斗里画按钮的是同一个函数**）
 *   2. 整组按钮的外接矩形来自 `touchLayoutBounds`（也是算出来的）
 *   3. 把外接矩形**等比装进** `TOUCH_PREVIEW` 那块区域：
 *      `scale = min(区域宽 / 外接宽, 区域高 / 外接高)`
 *
 * ⚠️ **一个数字都不许手写**（AGENTS.md §3b："画布几何是算出来的……
 * 不要手调数字"）。想改预览大小 → 改 `TOUCH_PREVIEW`；想改按钮排布 →
 * 改 `touchGeometry` 的弧参数。两者都会同时作用于预览与实战。
 *
 * ⚠️ 坐标是**画布逻辑坐标**（与 `hitTest` 同一套），不是面板相对坐标 ——
 * 命中测试与绘制必须直接可比，中间再换算一次就是下一个错位来源。
 */

import {
  TOUCH_BUTTON_CAPACITY,
  TOUCH_BUTTON_DIAMETER,
  touchButtonCenter,
  touchLayoutBounds,
} from '../../render/touchGeometry';
import {
  currentSettingsMetrics,
  touchPreviewArcBox,
  touchPreviewCaptionPos,
} from './settingsScale';

interface Transform {
  readonly scale: number;
  /** 双弧外接矩形中心 → 预览中心。 */
  readonly cx: number;
  readonly cy: number;
  readonly boundsCx: number;
  readonly boundsCy: number;
}

/**
 * 变换**按当前缩放缓存**：它依赖 `TOUCH_PREVIEW` 那块区域，而那块现在
 * 跟着 UI 缩放变（`settingsScale.touchPreviewArcBox`）。
 *
 * ⚠️ 缓存键是 `k` —— 缩放一变就重算，值没变就复用（这条路径每次命中测试
 * 与每帧绘制都会走，不缓存会白算）。
 */
let cachedK = Number.NaN;
let cached: Transform | undefined;

function transform(): Transform {
  const m = currentSettingsMetrics();
  if (cached !== undefined && cachedK === m.k) return cached;
  const bounds = touchLayoutBounds();
  const box = touchPreviewArcBox();
  /**
   * ⚠️ **等比**（取两个方向的小者）：非等比会把双弧拉成椭圆，
   * 于是"预览里在右下、实战里跑到右上"。
   */
  const scale = Math.min(box.w / bounds.w, box.h / bounds.h);
  cached = {
    scale,
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2,
    boundsCx: bounds.cx,
    boundsCy: bounds.cy,
  };
  cachedK = m.k;
  return cached;
}

/** 某个槽位圆心在**画布坐标**里的位置（超出容量返回 `undefined`）。 */
export function previewSlotCenter(
  index: number,
): { readonly x: number; readonly y: number } | undefined {
  const world = touchButtonCenter(index);
  if (world === undefined) return undefined;
  const t = transform();
  return {
    x: t.cx + (world.x - t.boundsCx) * t.scale,
    y: t.cy + (world.y - t.boundsCy) * t.scale,
  };
}

/** 预览里键位圆的半径（按同一个比例缩放）。 */
export function previewSlotRadius(): number {
  return (TOUCH_BUTTON_DIAMETER / 2) * transform().scale;
}

/**
 * 顶部说明行（"已选键位 3" / 块标题）的左上角。
 *
 * ⚠️ 与槽位圆心一样是**画布坐标**（`SETTINGS_PANEL` + 面板相对量）——
 * 第一版这里只加了 y、忘了 x，说明文字就跑到了面板中间（截图里
 * "触屏键位"四个字离那组按钮很远）。坐标空间必须与槽位一致。
 */
export function previewCaptionX(): number {
  return touchPreviewCaptionPos().x;
}

/** 顶部说明行的 y。 */
export function previewCaptionY(): number {
  return touchPreviewCaptionPos().y;
}

/**
 * 命中测试：画布坐标 `(px, py)` 落在哪个键位上。
 *
 * ⚠️ 与绘制**同一份几何**（都走 `previewSlotCenter` / `previewSlotRadius`）——
 * 分开算就会出现"看着能点、点不中"。多给 2px 容差让手指好点。
 */
export function previewSlotAt(px: number, py: number): number | undefined {
  const radius = previewSlotRadius() + 2;
  let best: number | undefined;
  let bestDist = Infinity;
  for (let i = 0; i < TOUCH_BUTTON_CAPACITY; i += 1) {
    const c = previewSlotCenter(i);
    if (c === undefined) continue;
    const dist = Math.hypot(px - c.x, py - c.y);
    if (dist <= radius && dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}
