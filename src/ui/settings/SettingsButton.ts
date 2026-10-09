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

import type { Container, Graphics } from 'pixi.js';
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

export class SettingsButton {
  readonly root: Container;

  private readonly gfx: Graphics;
  private readonly rect: { x: number; y: number; w: number; h: number };
  private hovered = false;
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
    this.gfx = new pixi.Graphics();
    this.root.addChild(this.gfx);
    this.draw();
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

  /** 悬停反馈（目前只有主循环每帧调一次，用于重绘）。 */
  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  update(): void {
    if (this.hovered === this.lastDrawnHover) return;
    this.lastDrawnHover = this.hovered;
    this.draw();
  }

  private draw(): void {
    const g = this.gfx;
    const { x, y, w, h } = this.rect;
    g.clear();

    // 按钮底：很淡的底 + 细描边，与技能栏一样"不抢眼"
    g.roundRect(x, y, w, h, 3).fill({
      color: 0xffffff,
      alpha: this.hovered ? 0.12 : 0.06,
    });
    g.roundRect(x, y, w, h, 3).stroke({
      color: this.hovered ? PALETTE.douqi.bright : 0x5a5c70,
      width: 1,
    });

    drawGear(g, x + w / 2, y + h / 2, this.hovered ? PALETTE.douqi.bright : 0xb0b0be);
  }

  /** 无障碍/调试用：按钮的语义名称。 */
  get labelKey(): string {
    return 'settings.open';
  }
}


/**
 * 画一个齿轮图标。
 *
 * ------------------------------------------------------------------
 * 为什么是"画出来的"而不是一个字符
 * ------------------------------------------------------------------
 *
 * 早期用「设」字当图标。问题有两个：
 *   1. 字必须**显式 set()** —— 我漏了这一步，按钮渲染成空方块，
 *      看起来像"图标没加载"（截图区分不了"空"和"被遮住"）。
 *   2. 「设」是个抽象字，不像图标那样一眼认得出是"设置"。
 *
 * 齿轮用 8 齿 + 中心孔构造，是设置图标最通用的形态。
 * 全部是几何计算，所以**不依赖字体**，也不会有字形缺失的风险。
 *
 * 接入正式美术素材时，只需要把这一次调用换成贴图。
 */
function drawGear(g: Graphics, cx: number, cy: number, color: number): void {
  const teeth = 8;
  const rOuter = 8;
  const rInner = 5.5;
  const halfTooth = Math.PI / teeth / 2.2;

  g.moveTo(cx + rInner * Math.cos(-halfTooth), cy + rInner * Math.sin(-halfTooth));
  for (let i = 0; i < teeth; i += 1) {
    const mid = (i * 2 * Math.PI) / teeth;
    const a0 = mid - halfTooth;
    const a1 = mid + halfTooth;
    const b0 = mid + (2 * Math.PI) / teeth / 2 - halfTooth;
    const b1 = mid + (2 * Math.PI) / teeth / 2 + halfTooth;

    g.lineTo(cx + rInner * Math.cos(a0), cy + rInner * Math.sin(a0));
    g.lineTo(cx + rOuter * Math.cos(a0), cy + rOuter * Math.sin(a0));
    g.lineTo(cx + rOuter * Math.cos(a1), cy + rOuter * Math.sin(a1));
    g.lineTo(cx + rInner * Math.cos(a1), cy + rInner * Math.sin(a1));
    // 回到内圈，走到下一个齿的起点
    g.lineTo(cx + rInner * Math.cos(b0), cy + rInner * Math.sin(b0));
    g.lineTo(cx + rInner * Math.cos(b1), cy + rInner * Math.sin(b1));
  }
  g.closePath();
  // 齿轮本体：用描边而不是填充 —— 26px 的按钮里，实心齿轮会糊成一坨
  g.stroke({ color, width: 1.4 });
  // 中心孔
  g.circle(cx, cy, 2.2).stroke({ color, width: 1.4 });
}
