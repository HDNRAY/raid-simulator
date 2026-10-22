/**
 * **法术动画素材的加载**（2026-10-22，`FDOTHER_028`）。
 *
 * 只做一件事：把导出物读成"帧几何 + 每帧时长 + 帧图 URL"。
 *
 * ⚠️ **素材不在仓库里**（`public/fd2/` 是 gitignore 的第三方素材，见
 * AGENTS §4b）⇒ 任何一步失败都返回 `undefined`，调用方据此**静默关掉**
 * 这段动画。**不许**为了"让测试过"去读 `public/fd2/`。
 *
 * 帧图是 `artgen/prepare_fdother.py` 合好 alpha 的那一份（`f00.png…`）；
 * 原始导出是 RGB + 独立 mask，直接画会带白底（我核对帧组时踩过）。
 */

import type { SpellFrameGeometry } from './spellFrames';

/** `animation.json` 里我们真正用到的字段（多的一概忽略）。 */
interface RawFrame {
  readonly path: string;
  readonly delay_native?: number;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface SpellAssets {
  readonly base: string;
  readonly frames: readonly SpellFrameGeometry[];
  readonly delays: readonly number[];
  /** 每帧的图片名（相对 `base`，已合 alpha）。 */
  readonly urls: readonly string[];
}

/**
 * 读 `<base>animation.json`。
 *
 * @param base 相对站点根的目录，**带结尾斜杠**（例：`fd2/animations/FDOTHER_028/`）
 * @returns `undefined` = 素材缺失 / 结构不对（**不是异常**）
 */
export async function loadSpellAssets(base: string): Promise<SpellAssets | undefined> {
  if (typeof fetch !== 'function') return undefined;
  let doc: unknown;
  try {
    const response = await fetch(`${base}animation.json`);
    if (!response.ok) return undefined;
    doc = await response.json();
  } catch {
    return undefined;
  }
  if (typeof doc !== 'object' || doc === null) return undefined;
  const rawFrames = (doc as { frames?: unknown }).frames;
  if (!Array.isArray(rawFrames) || rawFrames.length === 0) return undefined;

  const frames: SpellFrameGeometry[] = [];
  const delays: number[] = [];
  const urls: string[] = [];
  for (const [index, raw] of rawFrames.entries()) {
    const frame = raw as RawFrame;
    if (
      typeof frame.width !== 'number' ||
      typeof frame.height !== 'number' ||
      typeof frame.x !== 'number' ||
      typeof frame.y !== 'number'
    ) {
      return undefined;
    }
    frames.push({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    const delay = typeof frame.delay_native === 'number' ? frame.delay_native : 1;
    delays.push(delay > 0 ? delay : 1);
    /** 合并后的帧名：`f00.png`（`prepare_fdother.py` 的产出，与 FIGANI 同规律）。 */
    urls.push(`f${String(index).padStart(2, '0')}.png`);
  }
  return { base, frames, delays, urls };
}
