/**
 * 战斗 HUD 上的设置按钮。
 *
 * ------------------------------------------------------------------
 * 这里只剩"放哪儿 + 写什么键位"，视觉与交互都在 `IconButton` 里
 * ------------------------------------------------------------------
 *
 * 原先这个文件自己画图标、自己算命中、自己管悬停/焦点状态。
 * 抽成通用组件（`ui/IconButton.ts`）之后，它退化成一层薄封装：
 *
 *   - 位置：右下角，压在技能栏上方
 *   - 内容：齿轮图标 + 快捷键提示
 *
 * 需求："进入设置也要支持快捷键，而且要写在图标旁边。
 * 这个最好抽成组件，以后非战斗画面会经常用。"
 */

import type { Container } from 'pixi.js';
import { IconButton } from '../IconButton';
import { LOGICAL } from '../layout';
import type { PixiCtor } from '../primitives';

export interface SettingsButtonOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string) => string;
  readonly onClick: () => void;
}

/**
 * 按钮几何。
 *
 * ==================================================================
 * 演进：右下角 → **玩家面板右侧**（需求："设置按钮，暂时挪到玩家面板
 * 的右侧"）
 * ==================================================================
 *
 * 原先在右下角（压在技能栏上方）。但那块地方要留给移动端的**双弧
 * 触屏按钮**（外弧半径 210，最左缘到 `x 654`），必须让开。
 *
 * 新位置离右下角的拇指区更近，而且 `x 244..288` 与双弧最左缘之间
 * 还有 366px 余量（见 `docs/plans/2026-10-10-m8-mobile.md` §2.2）。
 */
const MARGIN = 8;
/** 按钮区域的边长（含可点范围），比图标本身大一圈。 */
const HIT = 44;

export class SettingsButton {
  readonly root: Container;

  private readonly button: IconButton;

  constructor(options: SettingsButtonOptions) {
    const { pixi } = options;
    this.button = new IconButton({
      pixi,
      icon: 'gear',
      /**
       * 图标 + 快捷键提示，贴在**玩家面板右侧**。
       *
       * 面板在 `x 8..236, y 452..532`（见 `LAYOUT.player`）。
       * 按钮在它右缘外 `MARGIN` px，并且**底边与面板底边对齐**
       * （需求："设置icon，可以贴着底部和 人物面板底部对齐"）。
       *
       * ⚠️ 原先取的是面板**垂直中心**（`y = 452 + 40 = 492`），于是按钮
       * 底边落在 512、比面板底(532)高 20px —— 看起来"吊在半空"。
       * 改成 `y = 面板底 - HIT/2` 之后底边精确贴齐（532）。
       * ⚠️ 用 `LAYOUT.player.y + LAYOUT.player.h` 表达而不是写 `532`：
       * 面板位置是布局表的事，这里只引用它（避免两处真相）。
       */
      /**
       * ⚠️ **从"玩家面板右侧"移到右上角**（需求："设置按钮换到别的地方"）。
       *
       * 原因：玩家面板右侧那一块要留给**玩家 buff / debuff 两行**
       * （需求："玩家的都放面板右侧"），原位置与它们直接重叠。
       *
       * 为什么选右上角：
       *   - `y < 40` 那一条右侧**没有别的元素**（Boss 血条只到 `y=36`，
       *     Boss debuff 行从 `y=40` 开始），所以按钮**不压血条**
       *   - 右上角是这类按钮的常规位置，比挤在左下更好点（尤其触屏）
       *
       * 底边贴 `y=45`：不与下面 `y=40..60` 的 Boss debuff 行在**视觉上**
       * 挤在一起（`HIT/2 = 22`，中心 `y=23`）。
       */
      anchor: {
        x: LOGICAL.width - MARGIN - HIT / 2,
        y: 23,
      },
      /**
       * 需求："设置按钮，Esc 在 icon 的左边……这个设计不对，
       * esc 应该比较小，然后再设置按钮的左上角。"
       *
       * 所以用 `corner` 模式：提示缩小到 9px、带黑色描边、
       * 贴在齿轮的**左上角**（不占按钮本体的布局）。
       */
      shortcut: options.translate('settings.openKey'),
      hintSide: 'corner',
      onClick: options.onClick,
    });
    this.root = this.button.root;

    /**
     * ⚠️ 按钮**没有边框与底色**（需求明确）。
     *
     * 状态只靠图标（与文字）的颜色表达 —— 这是本项目"画面上
     * 只有图形"的统一语言，与技能栏的处理一致。
     */
  }

  /** 命中测试（逻辑像素）。 */
  /**
   * 显示/隐藏整个按钮。
   *
   * 用途：**设置面板打开时隐藏它**。按钮原先在面板打开后仍然可见
   * （实测 `stage.children[1].visible === true`），于是齿轮和它的提示
   * 从面板左下角露出来，既重叠又让人以为可以点。
   *
   * ⚠️ 面板的命中测试已经会拦下点击（`settingsOpen` 分支），所以
   * 这只是**视觉**修正 —— 但不修就是假的"可点"暗示。
   */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 隐藏快捷键提示（触屏设备）。见 `IconButton.setShowShortcut`。 */
  setShowShortcut(show: boolean): void {
    this.button.setShowShortcut(show);
  }

  hitTest(px: number, py: number): boolean {
    return this.button.hitTest(px, py);
  }

  /** 指针悬停。 */
  setHovered(hovered: boolean): void {
    this.button.setHovered(hovered);
  }

  /** 键盘焦点。 */
  setFocused(focused: boolean): void {
    this.button.setFocused(focused);
  }

  /** 每帧（状态变化时才真正重绘）。 */
  update(): void {
    this.button.update();
  }

  /** 可点区域（供调试与布局断言）。 */
  get bounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
    return this.button.bounds;
  }
}
