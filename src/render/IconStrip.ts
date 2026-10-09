/**
 * 一行**图标方块 + 短标签**（Boss 的 buff 条用它）。
 *
 * 抽成独立文件的原因：它是一个**自成一体的可视组件**（有自己的
 * 几何、显隐、UI 缩放），原先内嵌在 `BattleScene.ts` 里，
 * 让那个文件同时承担了"场景编排"和"组件实现"两种职责。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../ui/layout';
import { Label, type PixiCtor } from '../ui/primitives';
import type { BuffView } from './viewModel';
import { isTightWindow } from './viewModel';
import type { TranslateFn } from './sceneTypes';

export class IconStrip {
  readonly root: Container;
  private readonly items: Array<{
    square: Graphics;
    label: Label;
    timer: Label;
  }> = [];
  private readonly pixi: PixiCtor;
  /** UI 缩放系数（默认 1）—— 只在 Boss buff 条上用到 */
  private uiScale = 1;

  constructor(
    pixi: PixiCtor,
    /** ⚠️ 可变：UI 缩放会重设 x/y/size/gap（见 `setUiScale`） */
    private strip: {
      x: number;
      y: number;
      size: number;
      gap: number;
      readonly max: number;
      labelGap?: number;
    },
    private readonly translate: TranslateFn,
  ) {
    this.pixi = pixi;
    this.root = new pixi.Container();
  }

  /**
   * 设定 UI 缩放（Boss buff 条用）。
   *
   * 与技能栏同理：**销毁旧的方块与标签再让 `ensure` 重建**。
   * ⚠️ 只清数组不销毁，旧节点仍挂在 root 上 —— 缩放后会新旧两层叠加
   * （技能栏上踩过这个坑，这里一次做对）。
   */
  setUiScale(
    scale: number,
    rect: { readonly x: number; readonly y: number; readonly size: number; readonly gap: number },
  ): void {
    if (scale === this.uiScale) return;
    this.uiScale = scale;
    this.strip = { ...this.strip, x: rect.x, y: rect.y, size: rect.size, gap: rect.gap, labelGap: Math.max(1, Math.round(4 * scale)) };
    for (const item of this.items) {
      item.square.destroy({ children: true });
      item.label.root.destroy({ children: true });
      item.timer.root.destroy({ children: true });
    }
    this.items.length = 0;
  }

  private ensure(count: number): void {
    const target = Math.min(count, this.strip.max);
    while (this.items.length < target) {
      const square = new this.pixi.Graphics();
      // 极简标签：最多 2 字，字号 small（中文下限 13）
      const label = new Label(this.pixi, {
        x: 0,
        y: this.strip.y + 3,
        size: FONT.small,
        color: 0xffffff,
      });
      // 剩余时间叠在方块**右下角**，不额外占横向空间
      const timer = new Label(this.pixi, {
        x: 0,
        y: this.strip.y + this.strip.size - FONT.tiny - 1,
        size: FONT.tiny,
        color: 0xffffff,
        anchorX: 1,
        stroke: 0x000000,
        strokeWidth: 2,
      });
      this.root.addChild(square, label.root, timer.root);
      this.items.push({ square, label, timer });
    }
  }

  update(buffs: readonly BuffView[]): void {
    // 判定窗口类排最前：玩家最需要看到"我还能躲多久"
    const sorted = [...buffs].sort((a, b) => Number(b.isDefensive) - Number(a.isDefensive));
    this.ensure(sorted.length);

    const { x, y, size, gap } = this.strip;
    const labelGap = this.strip.labelGap ?? 4;
    let cursor = x;

    for (let i = 0; i < this.items.length; i += 1) {
      const item = this.items[i];
      const view = sorted[i];
      if (!item) continue;

      if (!view) {
        item.square.clear();
        item.label.set('');
        item.timer.set('');
        item.square.visible = false;
        continue;
      }

      const tight = isTightWindow(view);
      const edge = view.color;

      const g = item.square;
      g.visible = true;
      g.clear();
      // **单色方块占位**：一块纯色 + 深色描边。
      // 接入正式图标后这一块会被贴图替换，布局不需要改。
      g.rect(cursor, y, size, size).fill({ color: edge, alpha: tight ? 1 : 0.9 });
      g.rect(cursor, y, size, size).stroke({ color: 0x05050a, width: 1 });
      // 判定窗口且时间很紧：加一圈亮边提醒"就是现在"
      if (tight) g.rect(cursor - 1, y - 1, size + 2, size + 2).stroke({ color: 0xffffff, width: 1 });

      // 剩余时间：叠在方块内右下角（白字 + 黑描边，压在纯色上也读得清）
      const seconds =
        view.stacks > 1
          ? `${view.stacks}`
          : Number.isFinite(view.remainingMs) && view.remainingMs < 100_000
            ? `${Math.ceil(view.remainingMs / 1000)}`
            : '';
      item.timer.set(seconds);
      item.timer.setColor(edge > 0x808080 ? 0x101014 : 0xffffff);
      item.timer.root.x = cursor + size - 2;

      // 标签在方块右侧，流式排布
      item.label.set(this.translate(view.shortLabelKey));
      item.label.setColor(0xd0d0dc);
      item.label.root.x = cursor + size + labelGap;

      const labelW = Math.max(item.label.root.width, 16);
      cursor += size + labelGap + labelW + gap;
    }
  }
}
