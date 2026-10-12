/**
 * 设置页的**底部**：两行提示 + **一个**「恢复默认」按钮。
 *
 * `SettingsPanel.ts` 超过 700 行（AGENTS.md §3），这一块是纯外观 +
 * "焦点在谁身上"的表现，抽出来之后面板只剩内容与交互。
 *
 * ==================================================================
 * ⚠️ 2026-10-12：从"两个按钮 + 一行提示"改成"一个按钮 + 两行提示"
 * ==================================================================
 *
 * **按钮**（用户原话）："**恢复默认和触屏默认 同一时间显示一个按钮就可以
 * 了，根据当前是否是触屏**。" —— "恢复什么"由设备能力决定，见
 * `./resetButton.resetTargetFor`。所以这里不再有两个命中区 / 两个焦点区，
 * 文案也**只有一条**会出现在屏幕上（`resetLabelKey` 按设备选）。
 *
 * **提示**（用户原话）："原来的 `keysHint`（方向键选择，Enter 改键，
 * Esc 返回）被删了 → **不能删，宁可弹窗更大**。"
 *
 * 于是两行：
 *
 *   第 1 行  当前状态（改键中 / 已选键位 N / 绑定与取下）—— 会变
 *   第 2 行  改键那套键：`方向键选择，Enter 改键，Esc 返回` —— **常驻**
 *
 * ⚠️ 两句**永远不会同时消失**：第一行在最差的情况下也有一条
 * `settings.slotHint`（"点键位 → 点技能 = 绑定"）。所以"某个提示永远
 * 看不到"这种情况不存在 —— 见 `updateKeys` 的分支。
 *
 * ⚠️ 两句**不会打架**："Enter 改键" 与 "Enter 绑定" 是**不同状态下**的
 * 语义，由第一行按状态切换来表达（未选中键位 = 改键；选中了 = 绑定），
 * 第二行始终描述"不选中键位时"那一套。
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
} from './logic';
import { keyEditHint, slotNavKeyHint } from './keyNames';
import { resetLabelKey, resetTargetFor, type ResetTarget } from './resetButton';
import type { TranslateFn } from '../../i18n/translator';

/** 底部一帧的状态（键位页的两行提示按它选文案）。 */
export interface KeysFooterState {
  /** 正在等按键（改键中）。 */
  readonly capturing: boolean;
  /** 那个唯一的「恢复默认」按钮是否握着焦点。 */
  readonly resetFocused: boolean;
  /** 是否显示键位提示（触屏不显示 —— 那里没有键盘）。 */
  readonly showKeyHints: boolean;
  /** 当前选中的**触屏键位**（没有则 `undefined`）—— 第一行按它换文案。 */
  readonly selectedSlot: number | undefined;
}

export class KeysFooter {
  readonly root: Container;

  /** 第 1 行：当前状态（会随选中 / 改键变）。 */
  private readonly hintState: Label;
  /** 第 2 行：怎么改键 —— **常驻**（用户要求"不能删"）。 */
  private readonly hintKeys: Label;
  private readonly resetGfx: Graphics;
  private readonly resetLabel: Label;
  private readonly resetRect: { x: number; y: number; w: number; h: number };
  /** 当前设备下这个按钮恢复什么（由 `setTouch` 收进来，只存一份）。 */
  private target: ResetTarget = 'keys';

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
    private readonly notice: () => string,
  ) {
    this.root = new pixi.Container();
    const x = SETTINGS_PANEL.x;
    const y = SETTINGS_PANEL.y;

    this.hintState = new Label(pixi, {
      x: x + 16,
      y: y + hintLineY(0),
      size: FONT.small,
      color: PALETTE.textDim,
    });
    /**
     * 第二行用 `FONT.tiny`（11px）：
     * 它是**参考信息**而不是"现在该做什么"，比第一行轻一档正好分层；
     * 而且 13px 时它 + 第一行的长句会顶到右边的键位预览上（实测）。
     */
    this.hintKeys = new Label(pixi, {
      x: x + 16,
      y: y + hintLineY(1),
      size: FONT.tiny,
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
    this.root.addChild(
      this.hintState.root,
      this.hintKeys.root,
      this.resetGfx,
      this.resetLabel.root,
    );
  }

  /**
   * 告诉底部"这台设备是不是触屏" —— 决定那**一个**按钮恢复什么、
   * 显示哪条文案。
   *
   * ⚠️ 由面板在每次 `redraw` 里喂进来（它从 `SettingsPanelOptions` 读
   * 能力值）—— 底部自己不去探测，否则就是第二份判据。
   */
  setTouch(touch: boolean): void {
    this.target = resetTargetFor(touch);
  }

  /**
   * 提示行的**共用部分**：通知 > 传入的常规提示，并按来源着色。
   *
   * ⚠️ 通知（"已恢复默认"这类）在**所有页**都要显示 —— 那是操作结果反馈，
   * 与"怎么操作"无关。
   *
   * ⚠️ **只有第一行**吃通知（`primary`）：两行都取通知的话，刚才那一下
   * 操作会**在屏幕上出现两遍**（实测"已恢复默认键位"上下各一行）。
   * 第二行在通知期间**清空** —— 那时候"怎么改键"这行不是玩家关心的。
   */
  private setHint(label: Label, normal: string, primary: boolean): void {
    const notice = primary ? this.notice() : '';
    label.set(notice !== '' ? notice : normal);
    // 通知用暖红，比常规提示更该被看到
    label.setColor(notice !== '' ? 0xff9080 : PALETTE.textDim);
  }

  /**
   * 通用页：提示是"怎么用滑块"，那一行按钮藏起来。
   *
   * ⚠️ 触屏（`showKeyHints === false`）时**两条提示都不画** ——
   * 通用页只有滑块，触屏没有键可按，键名提示全是噪音（需求：
   * "移动端就不用显示快捷键信息了"）。
   */
  showGeneralHint(showKeyHints = true): void {
    this.hintState.set(showKeyHints ? this.translate('settings.generalHint') : '');
    this.hintState.setColor(PALETTE.textDim);
    this.hintKeys.set('');
    /**
     * ⚠️ **整个按钮清掉**（不是"画一个空标签的按钮"）——「通用」页没有
     * "恢复默认"这种东西，画一个空框会让人以为它坏了。
     */
    this.resetGfx.clear();
    this.resetLabel.set('');
  }

  /**
   * 「按键」页：两行提示 + 那个唯一的恢复按钮。
   *
   * 第 1 行按状态三选一（改键中 > 已选键位 > 绑定与取下）；第 2 行**常驻**
   * （触屏不拼键名，因为那里没有键盘）。
   */
  updateKeys(state: KeysFooterState): void {
    const show = state.showKeyHints;
    /**
     * ⚠️ 键名（`←→↑↓ / Enter`）由渲染层从 `SLOT_NAV_KEYS` **反查后拼**
     * 上去，**不写进 i18n**（AGENTS.md §3b："键位提示不能放进 i18n"）——
     * 改键时只动那张表，不必碰语言包；触屏上整段不拼。
     */
    const navKeys = show ? slotNavKeyHint() : '';
    const state1 = state.capturing
      ? this.translate('settings.keysCapturingHint')
      : state.selectedSlot !== undefined
        ? this.translate('settings.slotHintArmed', { index: state.selectedSlot + 1 })
        : this.translate('settings.slotHint');
    const nav = navKeys === '' ? '' : ` (${navKeys})`;
    this.setHint(this.hintState, `${state1}${state.capturing ? '' : nav}`, true);

    /**
     * 第 2 行：**改键那套键**（方向键选择 / Enter 改键 / Esc 返回）。
     *
     * ⚠️ 键名同样**不进 i18n**：`keyEditHint()` 从 `keyNames.ts` 的键位表
     * 反查后拼。触屏不显示（那里没有键盘，显示只会让人以为要按键）。
     */
    this.setHint(
      this.hintKeys,
      show ? keyEditHint(this.translate('settings.keysHintLabel')) : '',
      false,
    );

    /**
     * ⚠️ 那**一个**按钮：文案按设备（`resetLabelKey`），恢复什么也按设备
     * （`this.target`，面板拿它决定按下去调哪个回调）。
     * ⚠️ 助记键 `(R)` 只有键盘那套有（触屏设备上不显示"改键"字样，
     * 见需求：触屏上别出现"改键"）。
     */
    const resetText = this.translate(resetLabelKey(this.target));
    const resetKey = this.target === 'keys' ? mnemonicKeyOf('resetKeys') : undefined;
    this.drawButton(
      show && resetKey !== undefined ? `${resetText} (${resetKey})` : resetText,
      state.resetFocused,
    );
  }

  /** 画那个按钮（唯一一处画法 —— 重复一遍就会出现"焦点态没跟着变"）。 */
  private drawButton(label: string, focused: boolean): void {
    const rect = this.resetRect;
    this.resetLabel.set(label);
    this.resetLabel.setColor(focused ? PALETTE.douqi.bright : PALETTE.text);
    this.resetGfx.clear();
    this.resetGfx.roundRect(rect.x, rect.y, rect.w, rect.h, 3).fill({
      color: focused ? PALETTE.douqi.base : 0xffffff,
      alpha: focused ? 0.16 : 0.08,
    });
    this.resetGfx.roundRect(rect.x, rect.y, rect.w, rect.h, 3).stroke({
      color: focused ? PALETTE.douqi.bright : 0x6a6c80,
      width: focused ? 1.5 : 1,
    });
  }
}
