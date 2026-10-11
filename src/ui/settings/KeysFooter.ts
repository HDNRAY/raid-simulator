/**
 * 按键页的**底部**：一行提示 + 「恢复默认」按钮。
 *
 * `SettingsPanel.ts` 超过 700 行（AGENTS.md §3），这一块是纯外观 +
 * 一个"焦点在谁身上"的表现，抽出来之后面板只剩内容与交互。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import { hintLineY, mnemonicKeyOf, resetButtonRect, SETTINGS_PANEL } from './logic';
import type { TranslateFn } from '../../i18n/translator';

export class KeysFooter {
  readonly root: Container;

  private readonly hint: Label;
  private readonly resetGfx: Graphics;
  private readonly resetLabel: Label;
  private readonly resetRect: { x: number; y: number; w: number; h: number };

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
    private readonly notice: () => string,
  ) {
    this.root = new pixi.Container();
    const x = SETTINGS_PANEL.x;
    const y = SETTINGS_PANEL.y;

    this.hint = new Label(pixi, {
      x: x + 16,
      y: y + hintLineY(),
      size: FONT.small,
      color: PALETTE.textDim,
    });

    this.resetRect = resetButtonRect();
    this.resetGfx = new pixi.Graphics();
    this.resetLabel = new Label(pixi, {
      x: this.resetRect.x + this.resetRect.w / 2,
      y: this.resetRect.y + 4,
      size: FONT.small,
      color: PALETTE.text,
      anchorX: 0.5,
    });
    this.root.addChild(this.hint.root, this.resetGfx, this.resetLabel.root);
  }

  /**
   * 通用页：提示 + 隐藏恢复按钮。
   *
   * ⚠️ 提示是**键盘操作说明**（"← → 调整，↑ ↓ 切换项"），所以触屏要换成
   * 触屏版文案，不能直接沿用 —— 需求："移动端就不用显示快捷键信息了"。
   */
  showGeneralHint(showKeyHints = true): void {
    if (!showKeyHints) {
      this.hint.set('');
      this.resetLabel.set('');
      this.resetGfx.clear();
      return;
    }
    this.hint.set(this.translate('settings.generalHint'));
    this.hint.setColor(PALETTE.textDim);
    this.resetLabel.set('');
    this.resetGfx.clear();
  }

  /**
   * 按键页：提示按优先级选一条（通知 > 改键中 > 常规），
   * 并画出「恢复默认」（含焦点表现）。
   */
  updateKeys(capturing: boolean, resetFocused: boolean, showKeyHints = true): void {
    const notice = this.notice();
    /**
     * ⚠️ 触屏上**不显示键盘操作说明**（需求："移动端就不用显示快捷键
     * 信息了，无论是技能按钮还是其他的功能按钮"）。
     *
     * 但**通知仍然显示**（"已恢复默认"这类）—— 那是操作结果反馈，
     * 与"怎么用键盘"无关；触屏上按助记键 `R` 也能触发它。
     */
    this.hint.set(
      notice !== '' || !showKeyHints
        ? notice
        : capturing
          ? this.translate('settings.keysCapturingHint')
          : this.translate('settings.keysHint'),
    );
    // 通知（如"已恢复默认"）用暖红，比常规提示更该被看到
    this.hint.setColor(notice !== '' ? 0xff9080 : PALETTE.textDim);

    /** ⚠️ 助记键反查后拼上，不写进 i18n（改键不该动文案）。 */
    const resetText = this.translate('settings.keysReset');
    const resetKey = mnemonicKeyOf('resetKeys');
    this.resetLabel.set(
      showKeyHints && resetKey !== undefined ? `${resetText} (${resetKey})` : resetText,
    );
    this.resetLabel.setColor(resetFocused ? PALETTE.douqi.bright : PALETTE.text);
    const g = this.resetGfx;
    const r = this.resetRect;
    g.clear();
    g.roundRect(r.x, r.y, r.w, r.h, 3).fill({
      color: resetFocused ? PALETTE.douqi.base : 0xffffff,
      alpha: resetFocused ? 0.16 : 0.08,
    });
    g.roundRect(r.x, r.y, r.w, r.h, 3).stroke({
      color: resetFocused ? PALETTE.douqi.bright : 0x6a6c80,
      width: resetFocused ? 1.5 : 1,
    });
  }
}
