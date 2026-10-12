/**
 * **屏幕中下部的状态区**：状态提示（"闪躲！"/"被打断"）+「眩晕中」横幅。
 *
 * ==================================================================
 * 为什么这两块归在一起
 * ==================================================================
 *
 * 两者是同一类东西：**"你现在的处境"**，都出现在角色之间的空旷处
 * （`LAYOUT.status` / `LAYOUT.stunBanner`），都不属于 Boss、也不属于
 * 任何面板。所以它们是同一个屏幕区域，而不是"顶栏的一部分"。
 *
 * ⚠️ 原先 `stunBanner` 是**很早**就加进 HUD 的（排在 Boss 血条之前），
 * 现在跟着这块区域一起挂到了 HUD 的后段。这是本次拆分唯一一处
 * 节点层叠顺序变化 —— 该矩形（480,300 附近）不与任何其它 HUD 节点
 * 重叠，所以外观不变（截图对照守着这一点）。
 *
 * ⚠️ 下面的注释与代码是一起从 `BattleScene.ts` 搬过来的
 * （AGENTS.md §3：抽取时连带注释一起搬）。
 */

import type { Container } from 'pixi.js';
import { FONT, LAYOUT } from '../../ui/layout';
import { Label, type PixiCtor } from '../../ui/primitives';
import { StatusLinePart, StunBannerPart } from '../parts/statusLine';
import { PALETTE } from '../theme';
import type { FrameRegistry } from '../sceneTypes';

/** 状态区。 */
export class StatusArea {
  /** HUD 层上的根容器。`(0,0)` 让内部的逻辑坐标保持不变。 */
  readonly root: Container;

  private readonly statusLabel: Label;
  private readonly statusSub: Label;
  /** 「眩晕中」横幅（玩家被完全锁死时）。 */
  private readonly stunBanner: Label;

  constructor(pixi: PixiCtor) {
    this.root = new pixi.Container();

    this.stunBanner = new Label(pixi, {
      x: LAYOUT.stunBanner.x,
      y: LAYOUT.stunBanner.y,
      size: FONT.warn,
      color: 0xff70d0,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });

    this.statusLabel = new Label(pixi, {
      x: LAYOUT.status.x,
      y: LAYOUT.status.y,
      size: FONT.warn,
      color: 0xffffff,
      anchorX: 0.5,
      stroke: 0x000000,
      strokeWidth: 4,
    });
    this.statusSub = new Label(pixi, {
      x: LAYOUT.status.x,
      y: LAYOUT.status.y + FONT.warn + 4,
      size: FONT.body,
      color: PALETTE.interrupt.bright,
      anchorX: 0.5,
      stroke: 0x000000,
      strokeWidth: 3,
    });
    this.root.addChild(this.statusLabel.root, this.statusSub.root, this.stunBanner.root);
  }

  /** 挂上本区域的每帧部件（状态行、眩晕横幅）。 */
  register(registry: FrameRegistry): void {
    registry.add(new StatusLinePart(this.statusLabel, this.statusSub));
    registry.add(new StunBannerPart(this.stunBanner));
  }
}
