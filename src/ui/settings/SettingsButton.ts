/**
 * 设置按钮（canvas 里的一个小按钮）。
 *
 * ------------------------------------------------------------------
 * 为什么按钮也自己做而不是用 DOM
 * ------------------------------------------------------------------
 *
 * 架构规范定的是"所有 UI 走 canvas"。一个 `<button>` 确实更省事，
 * 但那样一来"设置"就成了唯一一个 DOM 元素，跨屏缩放的坐标系
 * 会多出一套（DOM 用 CSS 像素、canvas 用逻辑像素），
 * letterbox 时会错位。
 *
 * 所以这里就是一个 canvas 图形 + 自己算的命中测试。
 */

import type { Container } from 'pixi.js';
import { Icon } from '../../render/icons';
import { PALETTE } from '../../render/theme';
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
/** 图标边长与颜色（比按钮小一圈，留出内边距）。 */
const ICON_SIZE = 18;
const ICON_COLOR = 0xb0b0be;

export class SettingsButton {
  readonly root: Container;

  private readonly icon: Icon;
  private readonly rect: { x: number; y: number; w: number; h: number };
  private hovered = false;
  private focused = false;
  private lastDrawnHover = false;

  constructor(private readonly options: SettingsButtonOptions) {
    const { pixi } = options;
    this.rect = {
      x: LOGICAL.width - MARGIN - SIZE,
      // 技能栏底部在 530 左右，所以按钮放在它上面
      y: LOGICAL.height - MARGIN - SIZE - 62,
      w: SIZE,
      h: SIZE,
    };

    this.root = new pixi.Container();
    /**
     * 图标用 SVG（`render/icons.ts`）。
     *
     * 这里换过三种做法：字符「设」→ 命令式绘制的齿轮 → SVG。
     * SVG 胜出的理由是**美术能参与**：它就是一个标准的图形文件，
     * 而前两种都要改代码。
     */
    this.icon = new Icon({
      pixi,
      name: 'gear',
      size: ICON_SIZE,
      color: ICON_COLOR,
    });
    this.root.addChild(this.icon.root);
    this.placeIcon();
  }

  /** 命中测试（坐标是逻辑像素）。 */
  hitTest(px: number, py: number): boolean {
    const hit =
      px >= this.rect.x &&
      px <= this.rect.x + this.rect.w &&
      py >= this.rect.y &&
      py <= this.rect.y + this.rect.h;
    if (hit) this.options.onClick();
    return hit;
  }

  /** 指针悬停。 */
  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  /**
   * 键盘是否选中了它。
   *
   * 与"悬停"分开：两者视觉一致（图标变亮），但来源不同 ——
   * 混成一个字段会让"鼠标移开时把键盘选中也一起清掉"。
   */
  setFocused(focused: boolean): void {
    this.focused = focused;
    this.update();
  }

  /**
   * 悬停 / 键盘选中状态。
   *
   * **没有边框、没有底色**（需求明确"不需要边框"）—— 状态只靠
   * **图标颜色**表达，与技能栏"不要按钮方框"的处理一致：
   * 画面上只有图形本身。
   */
  update(): void {
    const lit = this.hovered || this.focused;
    if (lit === this.lastDrawnHover) return;
    this.lastDrawnHover = lit;
    this.icon.setColor(lit ? PALETTE.douqi.bright : ICON_COLOR);
  }

  /**
   * 图标居中。
   *
   * 图标是 16px 的正方形，`Icon` 的原点在左上角，所以手动偏移
   * 半个尺寸 —— 这也解释了为什么不用 `root.width`：SVG 纹理的
   * 尺寸要到渲染时才确定，而这里是布局期。
   */
  private placeIcon(): void {
    const { x, y, w, h } = this.rect;
    this.icon.root.x = x + (w - ICON_SIZE) / 2;
    this.icon.root.y = y + (h - ICON_SIZE) / 2;
  }

  /** 无障碍/调试用：按钮的语义名称。 */
  get labelKey(): string {
    return 'settings.open';
  }
}

