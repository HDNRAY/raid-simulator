/**
 * 「按键」页**键盘块**的底部：两行提示 + **键盘那一份**「恢复默认」。
 *
 * `SettingsPanel.ts` 超过 700 行（AGENTS.md §3），这一块是纯外观 +
 * "焦点在谁身上"的表现，抽出来之后面板只剩内容与交互。
 *
 * ==================================================================
 * ⚠️ 2026-10-12：两块各自的按钮（不再"按设备分流"）
 * ==================================================================
 *
 * 上一版按用户当时那句话（"恢复默认和触屏默认 **同一时间显示一个按钮**
 * 就可以了，**根据当前是否是触屏**"）只画一个按钮，由**探测**决定恢复谁。
 * 实测那是错的：探测故意偏保守（"宁可多认成触屏"），被升级成"恢复哪一套
 * 配置"之后就会**吞功能** —— 触屏笔记本上键盘键位恢复不了。
 *
 * 现在：**键盘块**这里画键盘那一份，**触屏块**（`TouchSlotPreview`）画
 * 触屏那一份 —— "恢复什么"由**按钮在哪个块里**决定，与设备无关
 * （见 `settingsGeometry.RESET_BUTTON`）。
 *
 * **提示**（用户原话）："原来的 `keysHint`（方向键选择，Enter 改键，
 * Esc 返回）被删了 → **不能删，宁可弹窗更大**。"
 *
 * 于是两行：
 *
 *   第 1 行  当前状态 —— 会变
 *   第 2 行  改键那套键：`方向键选择，Enter 改键，Esc 返回` —— **常驻**
 *
 * ⚠️ 两句**永远不会同时消失**：第一行最差也有"点技能格 → 按新键 = 改键"
 * 那句。所以"某个提示永远看不到"这种情况不存在 —— 见 `updateKeys` 的分支。
 *
 * ⚠️ **键名不进 i18n**：`←→↑↓ / Enter / Esc` 由渲染层从 `keyNames`
 * 的键位表反查后拼（AGENTS.md §3b：改快捷键不该改语言包）。
 */

import type { Container } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import { hintLineY, mnemonicKeyOf, resetButtonRect, SETTINGS_PANEL } from './logic';
import { scaledFont } from './settingsScale';
import { keyEditHint } from './keyNames';
import { ResetDefaultButton } from './ResetDefaultButton';
import type { TranslateFn } from '../../i18n/translator';

/** 底部一帧的状态（两行提示按它选文案）。 */
export interface KeysFooterState {
  /** 正在等按键（改键中）—— 只有键盘方式会有。 */
  readonly capturing: boolean;
  /** 键盘那一份「恢复默认」是否握着焦点。 */
  readonly resetFocused: boolean;
  /** 是否显示键名 —— **也就是"现在是不是键盘方式"**（唯一 flag 的派生）。 */
  readonly showKeyHints: boolean;
  /**
   * 当前选中的**触屏键位**（没有则 `undefined`）—— 触屏方式下第一行按它换
   * 文案（"点键位 → 点技能" / "已选键位 N：点技能"）。
   */
  readonly selectedSlot?: number | undefined;
}

export class KeysFooter {
  readonly root: Container;

  /** 第 1 行：当前状态（会随改键变）。 */
  private readonly hintState: Label;
  /** 第 2 行：怎么改键 —— **常驻**（用户要求"不能删"）。 */
  private readonly hintKeys: Label;
  private readonly reset: ResetDefaultButton;

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
    private readonly notice: () => string,
  ) {
    this.root = new pixi.Container();
    const x = SETTINGS_PANEL.x;

    this.hintState = new Label(pixi, {
      x: x + 16,
      y: hintLineY(0),
      size: scaledFont(FONT.small),
      color: PALETTE.textDim,
    });
    /**
     * 第二行用 `FONT.tiny`（11px）：
     * 它是**参考信息**而不是"现在该做什么"，比第一行轻一档正好分层；
     * 而且 13px 时它 + 第一行的长句会顶到右边的键位预览上（实测）。
     */
    this.hintKeys = new Label(pixi, {
      x: x + 16,
      y: hintLineY(1),
      size: scaledFont(FONT.tiny),
      color: PALETTE.textDim,
    });

    this.reset = new ResetDefaultButton(pixi, resetButtonRect);
    this.root.addChild(this.hintState.root, this.hintKeys.root, this.reset.root);
    /** 文案是**固定**的（这一块恢复键盘键位）—— 不随设备变。 */
    this.reset.setText(translate('settings.keysReset'));
  }

  /**
   * **UI 缩放变了**：两行提示的位置 / 行高 / 字号 + 恢复按钮都要重排。
   *
   * ⚠️ 位置**每次都从 `../logic` 取当前几何**（那里转发 `settingsScale`），
   * 不在本组件里缓存 —— 缓存会让"缩放了、提示还停在旧行高上"。
   */
  relayout(): void {
    this.hintState.root.y = hintLineY(0);
    this.hintKeys.root.y = hintLineY(1);
    this.hintState.setSize(scaledFont(FONT.small));
    this.hintKeys.setSize(scaledFont(FONT.tiny));
    this.reset.relayout();
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
   * ⚠️ 触屏方式（`showKeyHints === false`）时**两条提示都不画** ——
   * 通用页只有滑块与操作方式选择器，触屏没有键可按，键名提示全是噪音
   * （需求："移动端就不用显示快捷键信息了"）。
   */
  showGeneralHint(showKeyHints = true): void {
    this.hintState.set(showKeyHints ? this.translate('settings.generalHint') : '');
    this.hintState.setColor(PALETTE.textDim);
    this.hintKeys.set('');
    /**
     * ⚠️ **整个按钮藏起来**（不是"画一个空标签的按钮"）——「通用」页没有
     * "恢复键位"这种东西，画一个空框会让人以为它坏了。
     */
    this.reset.setVisible(false);
  }

  /**
   * 「按键」页的两行提示 + **键盘那一份**恢复按钮。
   *
   * ⚠️ 按**操作方式**（= `showKeyHints`，唯一 flag 的派生）分两种内容 ——
   * 用户："虽然都是 按键 tab，但是里面的实现**有一半都不一样**"：
   *
   *   键盘方式：第一行"怎么改键"、第二行那套键名、可见的恢复按钮
   *   触屏方式：第一行"点键位 → 点技能"（两步交互）、第二行空、
   *             恢复按钮**藏起来**（触屏块自己有那一个）
   */
  updateKeys(state: KeysFooterState): void {
    const show = state.showKeyHints;
    if (!show) {
      /**
       * 触屏方式：第一行是**两步交互**的状态（选中键位之前 / 之后），
       * 与 `slotActions` 的规则一一对应；第二行不画（没有键盘要按）。
       *
       * ⚠️ `slotHint` / `slotHintArmed` 是**文案**，键名不写进去
       * （§3b）；触屏方式本来也不必拼键名。
       * ⚠️ 恢复按钮藏在这里（它的那一份在那个块里）。
       */
      this.hintKeys.set('');
      this.reset.setVisible(false);
      this.setHint(
        this.hintState,
        state.selectedSlot === undefined
          ? this.translate('settings.slotHint')
          : this.translate('settings.slotHintArmed', { index: state.selectedSlot + 1 }),
        true,
      );
      return;
    }

    /**
     * 键盘方式。
     *
     * ⚠️ 键名由渲染层从 `KEY_EDIT_KEYS` **反查后拼**上去，**不写进 i18n**
     * （AGENTS.md §3b："键位提示不能放进 i18n"）。
     */
    const state1 = state.capturing
      ? this.translate('settings.keysCapturingHint')
      : this.translate('settings.keysTapHint');
    this.setHint(this.hintState, state1, true);

    /**
     * 第 2 行：**改键那套键**（方向键选择 / Enter 改键 / Esc 返回）——
     * 常驻，用户明确要求"不能删"。
     */
    this.setHint(this.hintKeys, keyEditHint(this.translate('settings.keysHintLabel')), false);

    /**
     * ⚠️ **键盘那一份**恢复按钮：文案固定，助记键 `(R)` 从 `MNEMONIC_KEYS`
     * 反查后拼（键名不进 i18n）。
     */
    const resetKey = mnemonicKeyOf('resetKeys');
    this.reset.setVisible(true);
    this.reset.setText(
      resetKey !== undefined
        ? `${this.translate('settings.keysReset')} (${resetKey})`
        : this.translate('settings.keysReset'),
    );
    this.reset.setFocused(state.resetFocused);
  }
}
