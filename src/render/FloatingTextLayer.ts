/**
 * 飘字层（伤害/闪躲等战斗文字）。
 *
 * 抽成独立部件：它是一个**中心化的池**（最多 24 个 Label 复用），
 * 生命周期与其它面板无关。
 */

import type { Container } from 'pixi.js';
import { FONT } from '../ui/layout';
import { Label, type PixiCtor } from '../ui/primitives';
import type { BattleSnapshotView } from './viewModel';
import type { FrameContext, FramePart } from './sceneTypes';

export class FloatingTextLayer implements FramePart {
  readonly root: Container;
  private readonly pool: Array<{ label: Label }> = [];

  constructor(private readonly pixi: PixiCtor) {
    this.root = new pixi.Container();
  }

  readonly name = 'floatingText';

  /**
   * 注册为帧部件（见 `FramePart` 的说明）。
   *
   * 形状从 `update(items)` 变成 `render(ctx)` —— 部件自己去 ctx 里取
   * 需要的字段，而不是由场景替它取出 `view.floatingText` 再喂进来。
   * 这一行改动就是"注册机制"与"场景逐个调用"的分界。
   */
  render(ctx: FrameContext): void {
    this.draw(ctx.view.floatingText);
  }

  private draw(items: BattleSnapshotView['floatingText']): void {
    while (this.pool.length < items.length && this.pool.length < 24) {
      const label = new Label(this.pixi, {
        x: 0,
        y: 0,
        size: FONT.title,
        color: 0xffffff,
        anchorX: 0.5,
        stroke: 0x000000,
        strokeWidth: 3,
      });
      this.root.addChild(label.root);
      this.pool.push({ label });
    }
    for (let i = 0; i < this.pool.length; i += 1) {
      const slot = this.pool[i];
      const view = items[i];
      if (!slot) continue;
      if (!view) {
        slot.label.root.visible = false;
        continue;
      }
      slot.label.root.visible = true;
      slot.label.set(view.text);
      slot.label.setColor(view.color);
      slot.label.root.x = view.x;
      slot.label.root.y = view.y;
      slot.label.root.alpha = Math.min(1, view.life * 1.5);
    }
  }
}
