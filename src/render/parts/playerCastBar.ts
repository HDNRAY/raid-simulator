/**
 * 玩家自己的读条。
 *
 * 与 Boss 预警条共用一个组件形状（Panel + Label + Bar），
 * 但用**暖金色**而不是危险红 —— 颜色在这里承担语义：
 * 红色 = "要挨打了"，金色 = "我在出手"。
 *
 * 不显示"可打断 / 需闪避"那类提示：那是 Boss 预警条的信息，
 * 对自己没有意义。
 */

import type { CastBar } from '../../ui/CastBar';
import type { FrameContext, FramePart } from '../sceneTypes';

/** 玩家读条部件。 */
export class PlayerCastBarPart implements FramePart {
  readonly name = 'playerCastBar';

  constructor(private readonly castBar: CastBar) {}

  render(ctx: FrameContext): void {
    const { view, translate } = ctx;
    const playerCast = view.player.cast;
    this.castBar.visible = playerCast !== undefined;
    if (!playerCast) return;
    this.castBar.setContent(
      translate(playerCast.nameKey),
      `${(playerCast.remainingMs / 1000).toFixed(1)}s`,
    );
    this.castBar.update(playerCast.progress);
    // 边框恒为金色，不随进度变色（见 `bossCastBar` 的同名说明）
  }
}
