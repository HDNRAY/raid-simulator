/**
 * 设置弹窗（全 canvas）。
 *
 * ==================================================================
 * 为什么也是 canvas 而不是 DOM
 * ==================================================================
 *
 * 架构规范里定的是"所有 UI 走 canvas，方便以后移植小游戏"。
 * 设置界面是最容易被"顺手用 DOM 做"的一块（表单、滚动、输入框都是
 * 浏览器免费的），但一旦开了这个口子，以后再想移植就要重写它 ——
 * 而它偏偏是**交互最复杂**的一块（改键要独占键盘、要处理冲突）。
 *
 * 所以这里连按键捕获都在 canvas 里做。
 *
 * ==================================================================
 * 与引擎的关系
 * ==================================================================
 *
 * 设置界面**完全不碰引擎**：它只改两类东西 ——
 *   1. 键位表（通过回调交出去）
 *   2. 将来的通用选项（缩放模式等）
 *
 * 打开设置时必须**暂停战斗**，否则玩家在改键时会被 Boss 打死。
 * 这个决定交给调用方（`onOpen` / `onClose`），组件自己不假设。
 */

import type { Container, Graphics } from 'pixi.js';
import { PALETTE } from '../../render/theme';
import { FONT, LOGICAL } from '../layout';
import { Label, Panel, type PixiCtor } from '../primitives';
import {
  KEY_ROW,
  SETTINGS_PANEL,
  hitTest as hitTestLogic,
  keyLabel as formatKey,
  keyRowRect,
  resetButtonRect,
  resolveKeyAction,
  tabRect,
  KEY_ROW_MAX,
  type SettingsTab,
} from './logic';

export type { SettingsTab };

export interface KeyRow {
  /** 技能 id */
  readonly skillId: string;
  /** 技能名的 i18n key（图标就是那个字） */
  readonly nameKey: string;
  /** 当前绑定（归一化键名） */
  readonly key: string;
}

export interface SettingsPanelOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string) => string;
  /** 读取当前键位表 */
  readonly getRows: () => readonly KeyRow[];
  /** 改键：把某个技能的键改成 `key` */
  readonly onRebind: (skillId: string, key: string) => void;
  /** 恢复默认键位 */
  readonly onResetKeys: () => void;
  /**
   * 进入/退出**捕获模式**。
   *
   * 捕获期间输入层不再把按键当技能 —— 这是必须的：否则玩家
   * 按 `Esc` 想取消改键，技能会真的放出去。
   */
  readonly onCapture: (handler: ((key: string) => void) | undefined) => void;
  /** 关闭弹窗 */
  readonly onClose: () => void;
}


export class SettingsPanel {
  readonly root: Container;

  private readonly dim: Graphics;
  private readonly panel: Panel;
  private readonly title: Label;
  private readonly closeHint: Label;

  private readonly tabButtons: Array<{
    tab: SettingsTab;
    gfx: Graphics;
    label: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];

  private readonly body: Container;
  private readonly rowGfx: Graphics;
  private readonly rowLabels: Array<{
    name: Label;
    key: Label;
    rect: { x: number; y: number; w: number; h: number };
  }> = [];
  private readonly hintLabel: Label;
  private readonly resetButton: { gfx: Graphics; label: Label; rect: { x: number; y: number; w: number; h: number } };

  private tab: SettingsTab = 'keys';
  private visible = false;
  /** 正在等待按键的技能 id（undefined = 没在捕获） */
  private capturingSkill: string | undefined;
  /** 提示文字（冲突/已恢复默认） */
  private notice = '';
  private noticeTtl = 0;

  private readonly origin = {
    x: Math.round((LOGICAL.width - SETTINGS_PANEL.w) / 2),
    y: Math.round((LOGICAL.height - SETTINGS_PANEL.h) / 2),
  };

  constructor(private readonly options: SettingsPanelOptions) {
    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    this.dim = new pixi.Graphics();
    this.dim.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: 0x000000, alpha: 0.66 });
    this.root.addChild(this.dim);

    const { x, y } = this.origin;
    this.panel = new Panel(pixi, {
      x,
      y,
      w: SETTINGS_PANEL.w,
      h: SETTINGS_PANEL.h,
      fill: 0x0e0e16,
      line: 0x6a6c80,
      fillAlpha: 0.98,
      radius: 4,
    });
    this.title = new Label(pixi, {
      x: x + 16,
      y: y + 10,
      size: FONT.title,
      color: PALETTE.text,
      kai: true,
    });
    this.closeHint = new Label(pixi, {
      x: x + SETTINGS_PANEL.w - 14,
      y: y + 12,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 1,
    });
    this.root.addChild(this.panel.root, this.title.root, this.closeHint.root);

    /* ---- tab 按钮 ---- */
    const tabs: SettingsTab[] = ['general', 'keys'];
    for (const [i, tab] of tabs.entries()) {
      const rect = tabRect(i);
      const gfx = new pixi.Graphics();
      const label = new Label(pixi, {
        x: rect.x + rect.w / 2,
        y: rect.y + 6,
        size: FONT.body,
        color: PALETTE.textDim,
        anchorX: 0.5,
        kai: true,
      });
      this.root.addChild(gfx, label.root);
      this.tabButtons.push({ tab, gfx, label, rect });
    }

    /* ---- 内容区 ---- */
    this.body = new pixi.Container();
    this.root.addChild(this.body);

    this.rowGfx = new pixi.Graphics();
    this.body.addChild(this.rowGfx);

    for (let i = 0; i < KEY_ROW_MAX; i += 1) {
      const rect = this.rowRect(i);
      const name = new Label(pixi, {
        x: rect.x + 10,
        y: rect.y + KEY_ROW.textY,
        size: FONT.body,
        color: PALETTE.text,
        kai: true,
      });
      const key = new Label(pixi, {
        x: rect.x + rect.w - 10,
        y: rect.y + KEY_ROW.textY,
        size: FONT.body,
        color: PALETTE.text,
        anchorX: 1,
      });
      this.body.addChild(name.root, key.root);
      this.rowLabels.push({ name, key, rect });
    }

    this.hintLabel = new Label(pixi, {
      x: x + 16,
      y: y + SETTINGS_PANEL.h - 54,
      size: FONT.small,
      color: PALETTE.textDim,
    });
    this.body.addChild(this.hintLabel.root);

    /* ---- 恢复默认按钮 ---- */
    const resetRect = resetButtonRect();
    const resetGfx = new pixi.Graphics();
    const resetLabel = new Label(pixi, {
      x: resetRect.x + resetRect.w / 2,
      y: resetRect.y + 4,
      size: FONT.small,
      color: PALETTE.text,
      anchorX: 0.5,
    });
    this.resetButton = { gfx: resetGfx, label: resetLabel, rect: resetRect };
    this.body.addChild(resetGfx, resetLabel.root);

    this.drawFrame();
  }

  /** 某一行的矩形（相对弹窗内的固定偏移）。 */
  private rowRect(index: number): { x: number; y: number; w: number; h: number } {
    return keyRowRect(index);
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(tab: SettingsTab = 'keys'): void {
    this.visible = true;
    this.root.visible = true;
    this.setTab(tab);
  }

  close(): void {
    this.stopCapture();
    this.visible = false;
    this.root.visible = false;
  }

  setTab(tab: SettingsTab): void {
    this.tab = tab;
    this.stopCapture();
    this.notice = '';
    this.redraw();
  }

  /**
   * 点一下某个位置。
   *
   * 命中测试自己算（不做逐对象事件绑定）—— 弹窗只有十几个可点区域，
   * 一个"从上到下第一个命中的"循环就够，而且比 Pixi 的事件系统
   * 更容易在测试里驱动（直接传坐标即可）。
   *
   * @returns 是否消费了这次点击
   */
  hitTest(px: number, py: number): boolean {
    if (!this.visible) return false;

    const target = hitTestLogic(px, py, {
      tab: this.tab,
      rowSkillIds: this.options.getRows().map((r) => r.skillId),
    });

    switch (target.kind) {
      case 'outside':
        this.options.onClose();
        return true;
      case 'tab':
        this.setTab(target.tab);
        return true;
      case 'resetKeys':
        this.options.onResetKeys();
        this.setNotice(this.options.translate('settings.keysResetDone'));
        this.redraw();
        return true;
      case 'keyRow':
        this.startCapture(target.skillId);
        return true;
      case 'none':
        // 点在弹窗内的空白处：消费掉，不穿透到战斗
        return true;
    }
  }

  /**
   * 键盘输入（弹窗打开时由主循环转发过来）。
   *
   * @returns 是否消费了这次按键
   */
  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const action = resolveKeyAction(key, this.capturingSkill !== undefined);
    switch (action.kind) {
      case 'cancelCapture':
        this.stopCapture();
        this.redraw();
        return true;
      case 'closePanel':
        this.options.onClose();
        return true;
      case 'capture':
        // 捕获模式下输入层会直接把键回调过来，这里不重复处理
        return true;
      case 'ignore':
        return true;
    }
  }

  private startCapture(skillId: string): void {
    this.capturingSkill = skillId;
    this.options.onCapture((key) => this.finishCapture(key));
    this.redraw();
  }

  private stopCapture(): void {
    this.capturingSkill = undefined;
    this.options.onCapture(undefined);
  }

  private finishCapture(key: string): void {
    const skillId = this.capturingSkill;
    this.stopCapture();
    if (skillId === undefined) return;

    // 冲突策略（顶掉旧占用者）在 `applyRebind` 里，见它的说明
    const rows = this.options.getRows();
    const before = rows.find((r) => r.skillId === skillId);
    if (before?.key === key) {
      this.redraw();
      return;
    }

    this.options.onRebind(skillId, key);
    this.redraw();
  }

  private setNotice(text: string): void {
    this.notice = text;
    this.noticeTtl = 180;
  }

  /** 每帧调用：倒计时提示文字。 */
  update(): void {
    if (this.noticeTtl > 0) {
      this.noticeTtl -= 1;
      if (this.noticeTtl === 0) {
        this.notice = '';
        this.redraw();
      }
    }
  }

  private redraw(): void {
    this.drawFrame();
    this.drawBody();
  }

  private drawFrame(): void {
    const { x, y } = this.origin;
    this.title.set(this.options.translate('settings.title'));
    this.closeHint.set(this.options.translate('settings.close'));

    for (const button of this.tabButtons) {
      const active = button.tab === this.tab;
      const label =
        button.tab === 'general'
          ? this.options.translate('settings.tabGeneral')
          : this.options.translate('settings.tabKeys');
      button.label.set(label);
      button.label.setColor(active ? 0xffffff : PALETTE.textDim);
      const g = button.gfx;
      g.clear();
      if (active) {
        // 选中的 tab 只用一个很淡的底色 + 下划线，不用整块高亮
        g.rect(button.rect.x, button.rect.y, button.rect.w, button.rect.h).fill({
          color: 0xffffff,
          alpha: 0.07,
        });
        g.rect(button.rect.x, button.rect.y + button.rect.h - 2, button.rect.w, 2).fill(
          PALETTE.douqi.base,
        );
      }
    }
    void x;
    void y;
  }

  private drawBody(): void {
    this.rowGfx.clear();
    for (const row of this.rowLabels) {
      row.name.set('');
      row.key.set('');
    }

    if (this.tab === 'general') {
      // 通用 tab 目前是空的 —— 明确写出来，而不是给一片空白
      this.hintLabel.set(this.options.translate('settings.generalEmpty'));
      this.resetButton.label.set('');
      this.resetButton.gfx.clear();
      this.drawEmptyGeneral();
      return;
    }

    /* ---- 按键 tab ---- */
    const rows = this.options.getRows();
    this.hintLabel.set(
      this.notice !== ''
        ? this.notice
        : this.capturingSkill !== undefined
          ? this.options.translate('settings.keysCapturing')
          : this.options.translate('settings.keysHint'),
    );
    this.hintLabel.setColor(this.notice !== '' ? 0xff9080 : PALETTE.textDim);

    for (const [i, row] of rows.entries()) {
      if (i >= KEY_ROW_MAX) break;
      const slot = this.rowLabels[i];
      if (!slot) continue;

      const capturing = this.capturingSkill === row.skillId;
      slot.name.set(this.options.translate(row.nameKey));
      // 按键名统一大写显示，与技能栏上的提示一致
      slot.key.set(capturing ? '…' : formatKey(row.key, this.options.translate('settings.keyUnbound')));
      slot.key.setColor(capturing ? PALETTE.douqi.bright : PALETTE.text);

      const g = this.rowGfx;
      // 交替底色 + 捕获时的高亮
      g.rect(slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h).fill({
        color: capturing ? PALETTE.douqi.base : 0xffffff,
        alpha: capturing ? 0.14 : i % 2 === 0 ? 0.03 : 0.06,
      });
      if (capturing) {
        g.rect(slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h).stroke({
          color: PALETTE.douqi.bright,
          width: 1,
        });
      }
    }

    // 恢复默认按钮
    const rb = this.resetButton;
    rb.label.set(this.options.translate('settings.keysReset'));
    const g = this.rowGfx;
    g.roundRect(rb.rect.x, rb.rect.y, rb.rect.w, rb.rect.h, 3).fill({
      color: 0xffffff,
      alpha: 0.08,
    });
    g.roundRect(rb.rect.x, rb.rect.y, rb.rect.w, rb.rect.h, 3).stroke({
      color: 0x6a6c80,
      width: 1,
    });
  }

  /** 空 tab 的占位：一行主文案 + 一行提示，避免一片空白让人以为坏了。 */
  private drawEmptyGeneral(): void {
    const { x, y } = this.origin;
    const g = this.rowGfx;
    const cy = y + 140;
    g.roundRect(x + 40, cy - 26, SETTINGS_PANEL.w - 80, 52, 4).stroke({
      color: 0x3a3a48,
      width: 1,
    });
    void g;
  }
}

