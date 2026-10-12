/**
 * 设置弹窗的**外框**：底板 + 标题 + 「关闭」 + tab 按钮。
 *
 * ==================================================================
 * 为什么抽出来
 * ==================================================================
 *
 * `SettingsPanel.ts` 超过 700 行（AGENTS.md §3）。这一块是**纯外观**
 * —— 它不碰任何设置逻辑，只需要知道"当前在哪个 tab、焦点在哪"。
 * 抽出来之后面板只剩"内容 + 交互"，读起来清楚得多。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from '../layout';
import { Label, Panel, type PixiCtor } from '../primitives';
import { PALETTE } from '../../render/theme';
import type { TranslateFn } from '../../i18n/translator';
import { ALL_SETTINGS_TABS, CLOSE_BUTTON, SETTINGS_PANEL, mnemonicKeyOf, tabRect } from './logic';
/**
 * ⚠️ **可见的 tab 是参数**（首页只有「通用」）：外框不能自己去算，
 * 那会造出第二份判据（`ui/settings/tabs.ts` 的 `visibleTabs` 才是真相）。
 */
import type { SettingsTab } from './tabs';

/**
 * 每个 tab 的**标签 key** 与**助记键目标**。
 *
 * ⚠️ 写成两张表而不是 `tab === 'general' ? ... : ...` 的三元链：三元链的
 * 默认分支会**静默**把新页的标签画成旧页的，而截图上看不出"这页叫错了"。
 * 加页 / 删页时这两张表会因为**类型**而必须一起改（键是 `SettingsTab`）。
 */
const TAB_LABEL: Readonly<Record<SettingsTab, string>> = {
  general: 'settings.tabGeneral',
  keys: 'settings.tabKeys',
};

const TAB_MNEMONIC: Readonly<Record<SettingsTab, 'tabGeneral' | 'tabKeys'>> = {
  general: 'tabGeneral',
  keys: 'tabKeys',
};

interface TabButton {
  readonly tab: SettingsTab;
  readonly gfx: Graphics;
  readonly label: Label;
  readonly rect: { x: number; y: number; w: number; h: number };
}

export class SettingsFrame {
  readonly root: Container;
  /** 「关闭」的标签 —— 面板要按焦点给它换色 */
  readonly closeHint: Label;

  private readonly title: Label;
  /**
   * tab 按钮按**容量**建好，显隐由 `update` 决定 —— 于是"首页少一个 tab"
   * 不需要销毁/重建 Pixi 对象（那正是"切来源后画面错位"的来源）。
   */
  private readonly tabButtons: TabButton[] = [];

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    this.root = new pixi.Container();
    const x = SETTINGS_PANEL.x;
    const y = SETTINGS_PANEL.y;

    const panel = new Panel(pixi, {
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
      x: x + SETTINGS_PANEL.w - CLOSE_BUTTON.right,
      y: y + CLOSE_BUTTON.top + 3,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 1,
    });
    this.root.addChild(panel.root, this.title.root, this.closeHint.root);

    /* ---- tab 按钮 ---- */
    /**
     * ⚠️ 按钮**按位置**建（最多 `ALL_SETTINGS_TABS.length` 个），
     * 每次 `update` 按**当前可见的 tab 表**决定画哪几个。
     * 顺序取自 `tabRect(i)` —— 命中测试用的是同一个函数，所以
     * "点第二个位置进了第三页"这类错位结构上不可能发生。
     */
    for (const [i, tab] of ALL_SETTINGS_TABS.entries()) {
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

    this.title.set(this.translate('settings.title'));
    this.closeHint.set(this.translate('settings.close'));
  }

  /**
   * 更新 tab 的选中 / 焦点表现。
   *
   * ⚠️ 「选中」与「焦点」是**两种不同的视觉手段**，不能合并：
   *   选中 = 当前显示哪个 tab（下划线）
   *   焦点 = 回车会作用在谁身上（一圈描边）
   * 两者可能同时在同一个 tab 上，也可能分开（焦点移走了但 tab 没切）。
   */
  update(
    /** **可见的 tab 表**（首页只有「通用」）—— 由调用方从 `visibleTabs` 取。 */
    tabs: readonly SettingsTab[],
    activeTab: SettingsTab,
    focusZone: string,
    /**
     * tab 焦点序号（-1 = 焦点不在 tab 栏）。用 `number` 而不是可选值，
     * 调用点少一层三元判断。
     */
    focusIndex: number,
    /**
     * 是否显示助记键（如 `通用 (G)`）。
     *
     * 需求："移动端就不用显示快捷键信息了，无论是技能按钮还是其他的
     * 功能按钮" —— 助记键属于"快捷键信息"，所以触屏要藏。
     * ⚠️ 只藏**提示**，不改按键行为：触屏上按 G/K 仍然能用（外接键盘）。
     */
    showKeyHints = true,
  ): void {
    for (const [i, button] of this.tabButtons.entries()) {
      /** ⚠️ 不可见的 tab **整个不画**（也不可点 —— 命中测试同样按可见表来）。 */
      const visible = tabs.includes(button.tab);
      button.gfx.visible = visible;
      button.label.root.visible = visible;
      if (!visible) {
        button.gfx.clear();
        button.label.set('');
        continue;
      }
      const active = button.tab === activeTab;
      const focused = focusZone === 'tabs' && focusIndex === i;
      const base = this.translate(TAB_LABEL[button.tab]);
      /**
       * ⚠️ 助记键从 `MNEMONIC_KEYS` **反查并拼上**，不写进 i18n ——
       * 否则改快捷键就得改文案（需求："改快捷键 害得改 i18n吗？"）。
       * 触屏不拼（"移动端就不用显示快捷键信息了"）。
       */
      const mnemonic = mnemonicKeyOf(TAB_MNEMONIC[button.tab]);
      button.label.set(
        showKeyHints && mnemonic !== undefined ? `${base} (${mnemonic})` : base,
      );
      button.label.setColor(active || focused ? 0xffffff : PALETTE.textDim);
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
      if (focused) {
        g.rect(button.rect.x, button.rect.y, button.rect.w, button.rect.h).stroke({
          color: PALETTE.douqi.bright,
          width: 1.5,
        });
      }
    }
  }
}
