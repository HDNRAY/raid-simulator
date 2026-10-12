/**
 * **小块里那个「恢复默认」按钮** —— 键盘块一个、触屏块一个，同一个画法。
 *
 * ==================================================================
 * 为什么抽成一个组件（而不是两处各画一遍）
 * ==================================================================
 *
 * 这个按钮原先画在 `KeysFooter` 里（`drawButton`）。现在「按键」页按操作
 * 方式分两块，**两块各有一个**「恢复默认」：
 *
 *   | 在哪 | 恢复什么 | 文案 key |
 *   |---|---|---|
 *   | 键盘块（提示文字下面） | 键盘键位 | `settings.keysReset` |
 *   | 触屏块（键位预览下面） | 触屏键位 | `settings.touchReset` |
 *
 * "画一遍"这件事**只有一份**（圆角框 + 描边 + 居中文字 + 焦点态）——
 * 两处各写一遍的后果是"其中一个块忘了画焦点态"，而那种不一致在截图里
 * 看起来只是"这里按键没反应"。
 *
 * ⚠️ 文件名**不是** `ResetButton.ts`：那个名字（小写 `resetButton.ts`）曾经
 * 是"按设备决定恢复哪一套"的纯函数模块，这一轮**删掉了**（见下）。macOS
 * 大小写不敏感，两个名字会指向同一个文件 —— 所以换一个明确的名字，
 * 免得下一个人在大小写敏感的 CI 上看到两个同名文件。
 *
 * ⚠️ 与 `ui/IconButton`（另一位 subagent 统一的圆钮组件）不是一回事：
 * 那个是**正方形图标钮**（返回 / 设置齿轮那类），这个是设置页里的小文字
 * 按钮 —— 形状、尺寸、语义都不同，本文件只服务后者。
 *
 * ⚠️ Pixi 对象**建一次**（构造时），之后只改文字与描边 —— 每帧重建
 * Graphics/Text 会让设置页卡顿（焦点每移动一次就重画一遍）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import type { Rect } from './logic';

export class ResetDefaultButton {
  readonly root: Container;

  private readonly gfx: Graphics;
  private readonly label: Label;
  private text = '';
  private focused = false;

  constructor(
    pixi: PixiCtor,
    private readonly rect: Rect,
  ) {
    this.root = new pixi.Container();
    this.gfx = new pixi.Graphics();
    this.label = new Label(pixi, {
      x: rect.x + rect.w / 2,
      y: rect.y + 4,
      size: FONT.small,
      color: PALETTE.text,
      anchorX: 0.5,
    });
    this.root.addChild(this.gfx, this.label.root);
    this.draw();
  }

  /** 文案（**已翻译**——渲染层不硬编码可显示文字，i18n 规范 I1）。 */
  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.label.set(text);
    /** ⚠️ 文字长短会变（触屏那套不拼助记键），但框是固定尺寸的 —— 不重排。 */
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.label.setColor(focused ? PALETTE.douqi.bright : PALETTE.text);
    this.draw();
  }

  /** 这一块整块不显示时（切页 / 另一种操作方式）连按钮一起藏。 */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  private draw(): void {
    const r = this.rect;
    this.gfx.clear();
    this.gfx.roundRect(r.x, r.y, r.w, r.h, 3).fill({
      color: this.focused ? PALETTE.douqi.base : 0xffffff,
      alpha: this.focused ? 0.16 : 0.08,
    });
    this.gfx.roundRect(r.x, r.y, r.w, r.h, 3).stroke({
      color: this.focused ? PALETTE.douqi.bright : 0x6a6c80,
      width: this.focused ? 1.5 : 1,
    });
  }
}
