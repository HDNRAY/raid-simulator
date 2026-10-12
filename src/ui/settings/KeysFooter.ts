/**
 * 设置页的**底部**：一行提示 + 「恢复默认」按钮。
 *
 * `SettingsPanel.ts` 超过 700 行（AGENTS.md §3），这一块是纯外观 +
 * 一个"焦点在谁身上"的表现，抽出来之后面板只剩内容与交互。
 *
 * ⚠️ 两个 tab（「按键」/「触屏」）共用这一个 footer：按钮只画一次，
 * 但**含义由当前页决定**（按键页恢复键位、触屏页恢复按钮集合），
 * 提示文案也不同。所以有 `updateKeys` / `updateTouch` 两个入口，
 * 而不是一个带布尔开关的函数 —— 那会让"这页到底是什么"变得不可见。
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
  touchToggleKeyHint,
} from './logic';
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

  /** 清空整个底部（通用页用：那一页没有"恢复默认"）。 */
  private clear(): void {
    this.hint.set('');
    this.resetLabel.set('');
    this.resetGfx.clear();
  }

  /**
   * 画「恢复默认」按钮。
   *
   * ⚠️ 抽出来是因为**两页共用**（按键页 / 触屏页），而重复一遍画法
   * 就会出现"一页的焦点态变了、另一页没变"。
   */
  private drawReset(label: string, focused: boolean): void {
    this.resetLabel.set(label);
    this.resetLabel.setColor(focused ? PALETTE.douqi.bright : PALETTE.text);
    const g = this.resetGfx;
    const r = this.resetRect;
    g.clear();
    g.roundRect(r.x, r.y, r.w, r.h, 3).fill({
      color: focused ? PALETTE.douqi.base : 0xffffff,
      alpha: focused ? 0.16 : 0.08,
    });
    g.roundRect(r.x, r.y, r.w, r.h, 3).stroke({
      color: focused ? PALETTE.douqi.bright : 0x6a6c80,
      width: focused ? 1.5 : 1,
    });
  }

  /**
   * 通用页：提示 + 隐藏恢复按钮。
   *
   * ⚠️ 提示是**键盘操作说明**（"← → 调整，↑ ↓ 切换项"），所以触屏要换成
   * 触屏版文案，不能直接沿用 —— 需求："移动端就不用显示快捷键信息了"。
   */
  showGeneralHint(showKeyHints = true): void {
    if (!showKeyHints) {
      this.clear();
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
    this.setHint(
      /**
       * ⚠️ 触屏上**不显示键盘操作说明**（需求："移动端就不用显示快捷键
       * 信息了，无论是技能按钮还是其他的功能按钮"），换成"点技能看详情"。
       *
       * 触屏改不了键（没有键），所以这一页对触屏玩家只是"技能全集 + 详情"；
       * 真正能配的那一页是「触屏」页。
       */
      !showKeyHints
        ? this.translate('settings.keysHintTap')
        : capturing
          ? this.translate('settings.keysCapturingHint')
          : this.translate('settings.keysHint'),
    );

    /** ⚠️ 助记键反查后拼上，不写进 i18n（改键不该动文案）。 */
    const resetText = this.translate('settings.keysReset');
    const resetKey = mnemonicKeyOf('resetKeys');
    this.drawReset(
      showKeyHints && resetKey !== undefined ? `${resetText} (${resetKey})` : resetText,
      resetFocused,
    );
  }

  /**
   * 「触屏」页：提示 = **点一下格子放上 / 取下**，键鼠再拼上动作键；
   * 「恢复默认」= 恢复默认**按钮集合**（与按键页的"恢复默认键位"不同）。
   */
  updateTouch(resetFocused: boolean, showKeyHints = true): void {
    const hint = this.translate('settings.touchHint');
    /**
     * ⚠️ **键名从 `TOUCH_TOGGLE_KEYS` 反查后拼**，不写进 i18n ——
     * 需求："改快捷键 害得改 i18n吗？"，且触屏要能只显示前半句
     * （AGENTS.md §3b："键位提示不能放进 i18n"）。
     */
    this.setHint(showKeyHints ? `${hint} (${touchToggleKeyHint()})` : hint);
    /**
     * ⚠️ 触屏页的恢复按钮**不拼助记键**：`R` 的语义（先切到按键页、
     * 再恢复键位）是全局的，这里再标一个 `(R)` 会指向另一件事。
     * 键鼠仍然可以 Tab 到它、按 Enter。
     */
    this.drawReset(this.translate('settings.keysReset'), resetFocused);
  }
}
