/**
 * 受击闪光（全屏叠加层的一次透明度变化）。
 *
 * 极小的部件，但**独立**是有意义的：它跟任何面板都无关，
 * 只是"这一帧玩家挨打了"的一个视觉回声。
 */

import type { Graphics } from 'pixi.js';
import type { FrameContext, FramePart } from '../sceneTypes';

/** 闪光部件。 */
export class FlashPart implements FramePart {
  readonly name = 'flash';

  constructor(private readonly flashOverlay: Graphics) {}

  render(ctx: FrameContext): void {
    this.flashOverlay.alpha = Math.min(0.3, ctx.view.playerFlash * 0.3);
  }
}
