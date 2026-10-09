/**
 * 基础图元（架构规范 §6.1 的第一层）。
 *
 * 只有几何 + 颜色，**没有业务语义**。所有 UI 都由它们组合出来。
 *
 * 统一契约：
 *   - 创建一次，每帧 `update()`，**绝不每帧重建**
 *     （Pixi 的 Container 创建成本不低，每帧重建会 GC 抖动）
 *   - `Pixi.Text` 改 `text` 会重建内部纹理，所以**只在显示值真变化时赋值**
 *   - 组件只读传入的值，不持有引擎对象
 *
 * 构造器由入口注入（而不是在这里 import pixi）：否则 pixi 会同时被
 * 静态与动态导入，动态 import 失去意义、分包也失效。
 */

import type { Container, Graphics, Sprite, Text } from 'pixi.js';
import { FONT_FAMILY, FONT_FAMILY_MONO, TYPE, css } from '../render/theme';

/**
 * Pixi 类的**依赖注入缝**。
 *
 * 组件不直接 `import { Container } from 'pixi.js'`，而是经由这个接口
 * 拿构造函数 —— 于是测试可以塞一套极简的假实现，
 * 不必在 jsdom 里跑真的 WebGL。
 */
export interface PixiCtor {
  readonly Container: typeof Container;
  readonly Graphics: typeof Graphics;
  readonly Text: typeof Text;
  /** 图标用（`render/icons.ts`）。 */
  readonly Sprite: typeof Sprite;
}

/* ------------------------------------------------------------------ *
 * Panel：带描边的面板
 * ------------------------------------------------------------------ */

export interface PanelProps {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fill?: number;
  readonly line?: number;
  readonly fillAlpha?: number;
  readonly radius?: number;
}

/**
 * 奇数宽度描边的**半像素偏移**。
 *
 * 1px 的线以路径线为中心、向两侧各铺 0.5px。路径落在整数坐标上时，
 * 它跨越两个半行像素、各混一次，于是被稀释到几乎看不见。
 * 内移 0.5px 之后，线正好覆盖一个整行/整列像素。
 *
 * 这个坑在**读条**（`ui/CastBar.ts`）和**面板**（这里）各踩过一次 ——
 * 所以提成常量，别再靠记忆。
 */
export const HALF_PIXEL = 0.5;

/**
 * 面板的**共享外观**（填充色 / 描边 / 透明度 / 圆角）。
 *
 * ==================================================================
 * 为什么要抽出来
 * ==================================================================
 *
 * 需求："战斗日志和人物资源面板用的是一个组件吗？最好用一个，
 * 然后把背景的透明度调低。"
 *
 * 它们**本来就用的是同一个 `Panel` 组件**，但构造参数各写了一遍：
 * 填充 `0x0c0c14` vs `0x0d0e16`、描边 `0x4a4c60` vs `0x2a2c3a` ——
 * 差异小到看不出来，却是两处需要同步维护的真相。
 *
 * 抽成常量之后"所有面板看起来是一个东西"变成**默认行为**，
 * 而不是每次都得记得抄对参数。
 *
 * 透明度取 0.62：比原来的 0.86 / 0.72 都低 —— 需求要"调低"，
 * 而且面板是**压在战斗画面之上**的，越透越不影响看战斗。
 */
export const PANEL_STYLE = {
  fill: 0x0c0d15,
  line: 0x3c3e50,
  fillAlpha: 0.62,
  radius: 3,
} as const;

export class Panel {
  readonly root: Container;
  private readonly gfx: Graphics;
  private props: PanelProps;

  constructor(pixi: PixiCtor, props: PanelProps) {
    this.props = props;
    this.root = new pixi.Container();
    this.gfx = new pixi.Graphics();
    this.root.addChild(this.gfx);
    this.redraw();
  }

  set(props: Partial<PanelProps>): void {
    this.props = { ...this.props, ...props };
    this.redraw();
  }

  private redraw(): void {
    const { x, y, w, h, fill = 0x11121b, line = 0x505266, fillAlpha = 0.82, radius = 3 } = this.props;
    this.gfx.clear();
    this.gfx.roundRect(x, y, w, h, radius).fill({ color: fill, alpha: fillAlpha });
    /**
     * ⚠️ 描边路径**内移半像素**（见 `HALF_PIXEL` 的说明）。
     * 画在整数坐标上时，1px 的线会被反锯齿劈成两个半行像素 ——
     * 实测**上边框几乎看不见**（`#020305` 就是背景色），而下/左正常。
     */
    this.gfx
      .roundRect(x + HALF_PIXEL, y + HALF_PIXEL, w - 1, h - 1, radius)
      .stroke({ color: line, width: 1 });
  }
}

/* ------------------------------------------------------------------ *
 * Bar：进度条
 * ------------------------------------------------------------------ */

export interface BarProps {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: number;
  readonly darkColor: number;
  readonly brightColor?: number;
}

export class Bar {
  readonly root: Container;
  private readonly gfx: Graphics;
  /** 几何是可变的 —— UI 缩放时要整体重排（见 `setRect`）。 */
  private props: BarProps;
  /** 上一次的值，用于跳过无变化的绘图 */
  private lastRatio = -1;

  constructor(pixi: PixiCtor, props: BarProps) {
    this.props = props;
    this.root = new pixi.Container();
    this.gfx = new pixi.Graphics();
    this.root.addChild(this.gfx);
  }

  /**
   * 改几何（UI 缩放时用）。
   *
   * ⚠️ 必须把 `lastRatio` 置回 -1：否则"新尺寸 + 相同数值"会被
   * 跳过重绘，条还停在旧尺寸上（表现为"改了缩放但条没变"）。
   */
  setRect(rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
    this.props = { ...this.props, ...rect };
    this.lastRatio = -1;
  }

  /** `ratio` 会被钳到 [0,1]；NaN 视作 0（见数值纪律）。 */
  update(ratio: number): void {
    const safe = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
    if (Math.abs(safe - this.lastRatio) < 0.002) return;
    this.lastRatio = safe;

    const { x, y, w, h, color, darkColor, brightColor } = this.props;
    const g = this.gfx;
    g.clear();
    // 底槽
    g.rect(x, y, w, h).fill(darkColor);
    // 填充
    const filled = Math.round(w * safe);
    if (filled > 0) {
      g.rect(x, y, filled, h).fill(color);
      // 顶部高光：让条看起来有厚度（1px）
      g.rect(x, y, filled, 1).fill(brightColor ?? color);
    }
    // 外描边
    g.rect(x, y, w, h).stroke({ color: 0x08080c, width: 1 });
  }
}

/* ------------------------------------------------------------------ *
 * Label：文本（只在值变化时重建纹理）
 * ------------------------------------------------------------------ */

export interface LabelProps {
  readonly x: number;
  readonly y: number;
  readonly size?: number;
  readonly color?: number;
  readonly anchorX?: number;
  readonly anchorY?: number;
  readonly bold?: boolean;
  /**
   * 描边色。**压在亮色条上的数字必须描边** ——
   * 纯白字压亮绿/亮金会糊成一片，实测读不出来。
   */
  readonly stroke?: number;
  readonly strokeWidth?: number;
  /**
   * 用**楷体族**而不是等宽族。
   *
   * 技能图标上的字（攻/闪/防/破/轰/凝）走这条 ——
   * 见 `theme.ts` 里关于楷体的说明。
   */
  readonly kai?: boolean;
}

export class Label {
  readonly root: Text;
  private lastText: string | undefined;

  constructor(pixi: PixiCtor, props: LabelProps, initial = '') {
    this.root = new pixi.Text({
      text: initial,
      style: {
        fontFamily: props.kai ? FONT_FAMILY : FONT_FAMILY_MONO,
        fontSize: props.size ?? TYPE.sm,
        fill: css(props.color ?? 0xf0f0f6),
        fontWeight: props.bold ? '700' : '400',
        ...(props.stroke === undefined
          ? {}
          : { stroke: { color: css(props.stroke), width: props.strokeWidth ?? 3 } }),
      },
    });
    this.root.x = props.x;
    this.root.y = props.y;
    if (props.anchorX !== undefined) this.root.anchor.x = props.anchorX;
    if (props.anchorY !== undefined) this.root.anchor.y = props.anchorY;
    this.lastText = initial;
  }

  /**
   * 设置文本。
   *
   * **只在真的变化时赋值** —— Pixi 的 `text` setter 会重建内部 canvas 纹理，
   * 是明显的性能开销。
   */
  set(value: string): void {
    if (value === this.lastText) return;
    this.lastText = value;
    this.root.text = value;
  }

  setColor(color: number): void {
    this.root.style.fill = css(color);
  }

  /**
   * 改字号（UI 缩放时用）。
   *
   * ⚠️ Pixi 的 `Text` 在 `style.fontSize` 变化时会**重新光栅化**纹理 ——
   * 所以这不是免费操作，别放在每帧路径上。调用方要记住"上次设定的字号"，
   * 只在缩放真的变了的时候调（见 `SkillBarView` 里的 `lastIconSize`）。
   *
   * 之前没有这个方法，导致"缩放 UI"只放大了格子与间距、**字没变** ——
   * 看起来就是"图标没放大"。
   */
  setSize(size: number): void {
    if (this.root.style.fontSize === size) return;
    this.root.style.fontSize = size;
  }
}

/* ------------------------------------------------------------------ *
 * 九宫格描边（预警 / 选中框用）
 * ------------------------------------------------------------------ */

/** 画一个"四角括号"式的选中框，比整圈描边更有游戏感。 */
export function drawCorners(
  gfx: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  arm = 6,
  width = 2,
): void {
  gfx.moveTo(x, y + arm).lineTo(x, y).lineTo(x + arm, y).stroke({ color, width });
  gfx.moveTo(x + w - arm, y).lineTo(x + w, y).lineTo(x + w, y + arm).stroke({ color, width });
  gfx.moveTo(x + w, y + h - arm).lineTo(x + w, y + h).lineTo(x + w - arm, y + h).stroke({ color, width });
  gfx.moveTo(x + arm, y + h).lineTo(x, y + h).lineTo(x, y + h - arm).stroke({ color, width });
}
