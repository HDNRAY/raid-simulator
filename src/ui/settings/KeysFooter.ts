/**
 * 设置页的**底部**：一行提示 + 两个按钮（「恢复默认」/「触屏默认」）。
 *
 * `SettingsPanel.ts` 超过 700 行（AGENTS.md §3），这一块是纯外观 +
 * "焦点在谁身上"的表现，抽出来之后面板只剩内容与交互。
 *
 * ==================================================================
 * 为什么是**两个**按钮（2026-10-12）
 * ==================================================================
 *
 * 原先「恢复默认」的含义由**当前页**决定（「按键」页恢复键位、
 * 「触屏」页恢复触屏按钮）—— 那时有两页。用户把触屏键位并进「按键」页
 * 之后，"同一句激活按页分流"这条判据就没了，两者必须靠**位置**分开。
 *
 * 所以是两个常量（`RESET_BUTTON` / `TOUCH_RESET_BUTTON`）、两个命中区域、
 * 两个焦点区（`reset` / `touchReset`）—— 合成一个就会变成
 * "点哪都恢复键位"，而那种 bug 在截图上看不出来。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import {
  hintLineY,
  mnemonicKeyOf,
  resetButtonRect,
  SETTINGS_PANEL,
  slotNavKeyHint,
  touchResetButtonRect,
} from './logic';
import type { TranslateFn } from '../../i18n/translator';

/** 底部一帧的状态（键位页的提示行按它选文案）。 */
export interface KeysFooterState {
  /** 正在等按键（改键中）。 */
  readonly capturing: boolean;
  readonly resetFocused: boolean;
  readonly touchResetFocused: boolean;
  /** 是否显示键位提示（触屏不显示）。 */
  readonly showKeyHints: boolean;
  /** 当前选中的**触屏键位**（没有则 `undefined`）—— 提示行按它换文案。 */
  readonly selectedSlot: number | undefined;
}

export class KeysFooter {
  readonly root: Container;

  private readonly hint: Label;
  private readonly resetGfx: Graphics;
  private readonly resetLabel: Label;
  private readonly resetRect: { x: number; y: number; w: number; h: number };
  private readonly touchGfx: Graphics;
  private readonly touchLabel: Label;
  private readonly touchRect: { x: number; y: number; w: number; h: number };

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

    this.touchRect = touchResetButtonRect();
    this.touchGfx = new pixi.Graphics();
    this.touchLabel = new Label(pixi, {
      x: this.touchRect.x + this.touchRect.w / 2,
      y: this.touchRect.y + 4,
      size: FONT.small,
      color: PALETTE.text,
      anchorX: 0.5,
    });
    this.root.addChild(
      this.hint.root,
      this.resetGfx,
      this.resetLabel.root,
      this.touchGfx,
      this.touchLabel.root,
    );
  }

  /**
   * 提示行的**共用部分**：通知 > 传入的常规提示，并按来源着色。
   *
   * ⚠️ 通知（"已恢复默认"这类）在**所有页**都要显示 —— 那是操作结果反馈，
   * 与"怎么操作"无关；触屏上按助记键 `R` 也能触发它。
   */
  private setHint(normal: string): void {
    const notice = this.notice();
    this.hint.set(notice !== '' ? notice : normal);
    // 通知用暖红，比常规提示更该被看到
    this.hint.setColor(notice !== '' ? 0xff9080 : PALETTE.textDim);
  }

  /**
   * 画一个底部按钮（两处共用画法 —— 重复一遍就会出现
   * "一个的焦点态变了、另一个没变"）。
   */
  private drawButton(
    gfx: Graphics,
    label: Label,
    rect: { x: number; y: number; w: number; h: number },
    text: string,
    focused: boolean,
  ): void {
    label.set(text);
    label.setColor(focused ? PALETTE.douqi.bright : PALETTE.text);
    gfx.clear();
    gfx.roundRect(rect.x, rect.y, rect.w, rect.h, 3).fill({
      color: focused ? PALETTE.douqi.base : 0xffffff,
      alpha: focused ? 0.16 : 0.08,
    });
    gfx.roundRect(rect.x, rect.y, rect.w, rect.h, 3).stroke({
      color: focused ? PALETTE.douqi.bright : 0x6a6c80,
      width: focused ? 1.5 : 1,
    });
  }

  /** 通用页：提示是"怎么用滑块"，两个恢复按钮都藏起来。 */
  showGeneralHint(showKeyHints = true): void {
    if (!showKeyHints) {
      this.hint.set('');
      this.hint.setColor(PALETTE.textDim);
    } else {
      this.hint.set(this.translate('settings.generalHint'));
      this.hint.setColor(PALETTE.textDim);
    }
    /**
     * ⚠️ **整个按钮清掉**（不是"画一个空标签的按钮"）——「通用」页没有
     * "恢复默认"这种东西，画两个空框会让人以为它们坏了。
     */
    this.resetGfx.clear();
    this.resetLabel.set('');
    this.touchGfx.clear();
    this.touchLabel.set('');
  }

  /**
   * 「按键」页：提示（通知 > 改键中 > 选键位中 > 常规）+ 两个恢复按钮。
   *
   * ⚠️ 键位提示（`←→↑↓ / Enter`）由渲染层从 `SLOT_NAV_KEYS` **反查后拼**
   * 上去，**不写进 i18n**（AGENTS.md §3b："键位提示不能放进 i18n"）——
   * 改键时只动那张表，不必碰语言包；触屏上整段不拼。
   */
  updateKeys(state: KeysFooterState): void {
    const show = state.showKeyHints;
    const hintKeys = show ? ` (${slotNavKeyHint()})` : '';
    const body = state.capturing
      ? this.translate('settings.keysCapturingHint')
      : state.selectedSlot !== undefined
        ? this.translate('settings.slotHintArmed', { index: state.selectedSlot + 1 })
        : this.translate('settings.slotHint');
    this.setHint(`${body}${state.capturing ? '' : hintKeys}`);

    /**
     * ⚠️ 「恢复默认」的助记键（`R`）**只有它有**：那是全局助记键表里的一行，
     * 而「触屏默认」没有自己的字母键（键位表要短，见 `MNEMONIC_KEYS`）。
     * 键鼠仍然可以 `Tab` 到它、按 `Enter`。
     */
    const resetText = this.translate('settings.keysReset');
    const resetKey = mnemonicKeyOf('resetKeys');
    this.drawButton(
      this.resetGfx,
      this.resetLabel,
      this.resetRect,
      show && resetKey !== undefined ? `${resetText} (${resetKey})` : resetText,
      state.resetFocused,
    );
    this.drawButton(
      this.touchGfx,
      this.touchLabel,
      this.touchRect,
      this.translate('settings.touchReset'),
      state.touchResetFocused,
    );
  }
}
