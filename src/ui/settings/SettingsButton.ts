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

/** 按钮几何：右下角，压在技能栏上方一点。 */
const SIZE = 26;
const MARGIN = 8;

export class SettingsButton {
  readonly root: Container;

  private readonly button: IconButton;

  constructor(options: SettingsButtonOptions) {
    const { pixi } = options;
    this.button = new IconButton({
      pixi,
      icon: 'gear',
      // 图标 + 快捷键提示，整体居中在"压在技能栏上方"的位置
      anchor: {
        x: LOGICAL.width - MARGIN - SIZE / 2,
        y: LOGICAL.height - MARGIN - SIZE - 62,
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
