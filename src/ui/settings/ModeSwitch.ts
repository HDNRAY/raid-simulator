/**
 * 「通用」页的**操作方式**选择器（键盘 / 触屏）。
 *
 * ==================================================================
 * 它是唯一 flag 的**用户入口**
 * ==================================================================
 *
 * 用户 2026-10-12："**不用自动判断，由入口显式传**"，并且接受
 * "真手机第一次进来默认是键盘界面，要用户自己切"。
 *
 * 所以这一行不是"顺手加的开关"，而是 `OperationMode` 唯一的**人工**写入点
 * （另一处是 `?touch=1/0` 的启动覆盖）：
 *
 *   ```
 *   点这里        → 写 `GameState.operationMode` + 存档（刷新后还记得）
 *   ?touch=1 / 0  → 只覆盖这一次会话（截图验证 / 用户自救）
 *   默认          → keyboard
 *   ```
 *
 * ⚠️ 顺序（`keyboard` 在左）、点的命中区（`logic.operationModeRect`）、这里
 * 画的位置**都从 `./operationModeRow.OPERATION_MODE_ORDER` 取** —— 各写一遍
 * 就会出现"点左边的按钮、亮右边那个"。
 *
 * ⚠️ 文案走 i18n（`operationModeLabelKey`），渲染层不硬编码可显示文字。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import { operationModeLabelKey, OPERATION_MODE_ORDER } from './operationModeRow';
import { operationModeLabelPos, operationModeRect } from './logic';
import { scaledFont } from './settingsScale';
import type { OperationMode } from '../../render/platform';
import type { TranslateFn } from '../../i18n/translator';

interface ModeButtonView {
  readonly gfx: Graphics;
  readonly label: Label;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export class ModeSwitch {
  readonly root: Container;

  private readonly buttons: ModeButtonView[] = [];
  /** 「操作方式」那一行的标签 —— 缩放时它也要换字号。 */
  private readonly caption: Label;

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    this.root = new pixi.Container();
    const pos = operationModeLabelPos();
    const caption = new Label(pixi, {
      x: pos.x,
      y: pos.y,
      size: scaledFont(FONT.small),
      color: PALETTE.textDim,
    });
    this.caption = caption;
    this.root.addChild(caption.root);

    for (const [index] of OPERATION_MODE_ORDER.entries()) {
      const rect = operationModeRect(index);
      const gfx = new pixi.Graphics();
      const label = new Label(pixi, {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2 - 9,
        size: scaledFont(FONT.body),
        color: PALETTE.text,
        anchorX: 0.5,
      });
      this.root.addChild(gfx, label.root);
      this.buttons.push({ gfx, label, rect });
    }
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** **UI 缩放变了**：这一行的位置不跟 k，只有字号跟。 */
  relayout(): void {
    this.caption.setSize(scaledFont(FONT.small));
    for (const button of this.buttons) button.label.setSize(scaledFont(FONT.body));
  }

  /**
   * 重画。
   *
   * @param mode 当前操作方式（那一个按钮是"选中"态）
   * @param focusIndex 键盘焦点所在的按钮（`-1` = 焦点不在这行）
   */
  update(mode: OperationMode, focusIndex: number): void {
    for (const [index, button] of this.buttons.entries()) {
      const value = OPERATION_MODE_ORDER[index];
      if (value === undefined) continue;
      const selected = value === mode;
      const focused = index === focusIndex;
      button.label.set(this.translate(operationModeLabelKey(value)));
      button.label.setColor(selected ? PALETTE.douqi.bright : PALETTE.text);
      const r = button.rect;
      button.gfx.clear();
      button.gfx.roundRect(r.x, r.y, r.w, r.h, 4).fill({
        color: selected ? PALETTE.douqi.base : 0xffffff,
        alpha: selected ? 0.2 : 0.06,
      });
      button.gfx.roundRect(r.x, r.y, r.w, r.h, 4).stroke({
        color: selected || focused ? PALETTE.douqi.bright : 0x6a6c80,
        width: selected || focused ? 2 : 1,
        alpha: selected || focused ? 1 : 0.9,
      });
    }
  }
}
