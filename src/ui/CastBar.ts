/**
 * 读条组件 —— **所有进度条共用这一个**。
 *
 * ==================================================================
 * 为什么必须抽成一个组件（这是被反复的 bug 逼出来的）
 * ==================================================================
 *
 * 需求原话："boss 读条依旧看不到上 border，玩家读条也有 bug，
 * 这 2 个你没有抽成组件？所有的进度条，都应该抽成同一个组件。"
 *
 * 这是对的。Boss 读条与玩家读条原先**各写一份**（面板 + 填充 +
 * 文字，约 60 行 × 2），于是：
 *
 *   - 修了玩家的"填充盖住描边"，Boss 那边照旧
 *   - 两处的层叠顺序、内边距、文字位置各有各的写法，改一处忘一处
 *
 * 现在层叠顺序**只在这里定义一次**，而且是硬约束：
 *
 *     底槽（暗色） → 纯色填充 → **描边** → 文字
 *
 * ⚠️ 描边必须在填充**之后**画。早期把填充画在面板之上，于是填充块
 * 盖住了描边 —— 而且只盖中间一段，看起来像"上边框缺失"。
 *
 * ==================================================================
 * 形态
 * ==================================================================
 *
 * 底槽是"还没走完的那一段"，填充是**纯色方块从左往右长**
 * （像水位 / 电量条）。**不是渐变** —— 需求专门澄清过
 * "渐变指的是 gradient"，那个不要。
 */

import { Text } from 'pixi.js';
import type { Container, Graphics } from 'pixi.js';
import { FONT_FAMILY } from '../render/theme';
import { FONT } from './layout';
import type { PixiCtor } from './primitives';

export interface CastBarOptions {
  readonly pixi: PixiCtor;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 填充色（纯色，无渐变） */
  readonly fill: number;
  /** 底槽色（"还没走完"的那一段） */
  readonly track: number;
  /** 描边色 */
  readonly line: number;
  readonly labelColor?: number;
  readonly timeColor?: number;
  /** 是否有"剩余秒数"这一栏（玩家读条有，Boss 预警条没有） */
  readonly showTime?: boolean;
}

/** 圆角半径：4px 的面板配 2px 已经够圆。 */
const RADIUS = 2;

export class CastBar {
  readonly root: Container;

  private readonly fillGfx: Graphics;
  private readonly border: Graphics;
  private readonly nameText: Text;
  private readonly timeText: Text;
  private lastProgress = -1;

  constructor(private readonly options: CastBarOptions) {
    const { pixi, rect } = options;
    this.root = new pixi.Container();

    // ── 底槽 ──
    const bg = new pixi.Graphics();
    bg.roundRect(rect.x, rect.y, rect.w, rect.h, RADIUS).fill({ color: options.track, alpha: 1 });

    // ── 填充（内容由 update() 画） ──
    this.fillGfx = new pixi.Graphics();

    // ── 描边 ──
    this.border = new pixi.Graphics();
    this.drawBorder(options.line);

    // ── 文字：垂直居中（用 anchor，不猜偏移） ──
    const midY = rect.y + rect.h / 2;
    this.nameText = new Text({
      text: '',
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: FONT.warn,
        fill: css(options.labelColor ?? 0xffe8c0),
      },
    });
    this.nameText.x = rect.x + 12;
    this.nameText.y = midY;
    this.nameText.anchor.y = 0.5;

    this.timeText = new Text({
      text: '',
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: FONT.body,
        fill: css(options.timeColor ?? 0xffffff),
      },
    });
    this.timeText.x = rect.x + rect.w - 10;
    this.timeText.y = midY;
    this.timeText.anchor.x = 1;
    this.timeText.anchor.y = 0.5;
    this.timeText.visible = options.showTime !== false;

    /**
     * **层叠顺序就是这一行**：底 → 填充 → 描边 → 文字。
     *
     * 顺序错了就会出现"边框被填充盖住"（而且只盖中间一段，
     * 看起来像"上边框缺失"）。所以顺序写在这里、只写一次 ——
     * 这也是把两处读条合并成一个组件的主要收益。
     */
    this.root.addChild(bg, this.fillGfx, this.border, this.nameText, this.timeText);
  }

  /** 技能名与剩余秒数。 */
  setContent(name: string, time: string): void {
    if (this.nameText.text !== name) this.nameText.text = name;
    const t = this.options.showTime === false ? '' : time;
    if (this.timeText.text !== t) this.timeText.text = t;
  }

  /** 技能名颜色（Boss 预警条用它表达"能不能打断"）。 */
  setNameColor(color: number): void {
    this.nameText.style.fill = css(color);
  }

  /** 剩余秒数颜色。 */
  setTimeColor(color: number): void {
    this.timeText.style.fill = css(color);
  }

  /** 描边颜色（"快命中"时提亮）。 */
  setBorderColor(color: number): void {
    this.drawBorder(color);
  }

  private drawBorder(color: number): void {
    const { x, y, w, h } = this.options.rect;
    this.border.clear();
    this.border.roundRect(x, y, w, h, RADIUS).stroke({ color, width: 1 });
  }

  /**
   * 进度 0..1 → **纯色方块从左往右长**。
   *
   * 填充区域左右各让 1px：否则它会压住左右两条边框
   * （就是"看不到上 border"那个 bug 的同源问题）。
   */
  update(progress: number): void {
    const safe = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    if (Math.abs(safe - this.lastProgress) < 0.002) return;
    this.lastProgress = safe;

    const { x, y, w, h } = this.options.rect;
    const innerW = Math.max(0, w - 2);
    const filled = Math.round(innerW * safe);
    this.fillGfx.clear();
    if (filled > 0) {
      this.fillGfx.rect(x + 1, y + 1, filled, h - 2).fill({ color: this.options.fill, alpha: 1 });
    }
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }
}

/** 0xRRGGBB → `#rrggbb`（Pixi 的 Text 样式要 CSS 颜色串）。 */
function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
