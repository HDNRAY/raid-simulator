/**
 * 通用图标按钮：**图标 + 快捷键提示**，可选文字标签。
 *
 * ==================================================================
 * 为什么抽成组件
 * ==================================================================
 *
 * 需求："进入设置要支持快捷键，而且快捷键要写在图标旁边。
 * 这个最好抽成组件，以后非战斗画面会经常用。"
 *
 * 这个判断是对的 —— "图标 + 它对应的键位提示"是非战斗界面的
 * 基本单元（设置、图鉴、关卡选择、结算面板都要有）。散在各处写
 * 会重复三件事：图标居中、键位提示的排布、悬停/键盘焦点的状态色。
 *
 * 所以这里把它们收成一个组件，调用方只说"我要什么图标、什么键"。
 *
 * ==================================================================
 * 视觉约定（与技能栏一致）
 * ==================================================================
 *
 * - **没有边框、没有底色** —— 状态只靠**颜色**表达（悬停/键盘选中时
 *   图标变亮）。这是本项目"画面上只有图形"的统一语言。
 * - 键位提示用**等宽字体**、暗色，像键帽一样贴在图标旁边。
 * - 图标在左、提示在右（阅读顺序）；`hintSide` 可以翻转。
 *
 * ==================================================================
 * 布局：两种定位方式
 * ==================================================================
 *
 * 1. **给 `anchor`**（推荐用于新界面）：自动居中在给定坐标上，
 *    尺寸由图标与提示算出。非战斗界面通常"把按钮放在某个位置"，
 *    这种用法最省心。
 * 2. **给 `rect`**：固定矩形，命中测试用整个矩形（含提示）。
 *    战斗 HUD 需要精确占位，用这条。
 */

import type { Container } from 'pixi.js';
import { Icon, type IconName } from '../render/icons';
import { PALETTE } from '../render/theme';
import { FONT } from './layout';
import { Label, type PixiCtor } from './primitives';

export interface IconButtonOptions {
  readonly pixi: PixiCtor;
  readonly icon: IconName;
  /** 图标边长（逻辑像素） */
  readonly size?: number;
  readonly color?: number;
  /** 高亮时的颜色（悬停 / 键盘焦点） */
  readonly brightColor?: number;
  /**
   * 快捷键提示（例如 `Esc`）。
   *
   * 传 `undefined` 就不画 —— 但也**强烈建议给**：本项目的硬需求是
   * "几乎全键盘可操作"，把键位写在按钮旁边是最直接的告知方式，
   * 比藏在设置里好。
   */
  readonly shortcut?: string;
  /**
   * 提示的位置。
   *
   *   - `'corner'`（默认）：**图标左上角**，字号更小、带描边。
   *     需求："esc 应该比较小，然后再设置按钮的左上角"。
   *     左/右侧排布的问题是：键位和图标一样大，视觉上像同级元素，
   *     而快捷键其实是**辅助信息**，应该明显小一圈并贴在角上。
   *   - `'left'` / `'right'`：与图标同一行的左侧/右侧（旧行为）。
   */
  readonly hintSide?: 'corner' | 'left' | 'right';
  /** 可选文字标签（画在图标与提示之间） */
  readonly label?: string;
  /** 固定矩形（给 `rect` 时按它定位并命中） */
  readonly rect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 居中锚点（不给 `rect` 时按它定位） */
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly onClick: () => void;
}

export interface ContentBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 图标在盒内的左上角 */
  readonly iconX: number;
  readonly iconY: number;
}

/**
 * 算出按钮的**可点区域**（含图标与提示）。
 *
 * 抽成纯函数是为了能在 node 里测 —— Pixi 的 `Text` 宽度要等纹理
 * 生成才有值，而命中矩形必须在布局期定下来，所以这里用估算。
 * 这段算术一旦错位，表现是"看起来在按钮里却点不到"，很难查。
 */
export function computeContentBox(options: {
  readonly size?: number;
  readonly shortcut?: string;
  readonly label?: string;
  readonly hintSide?: 'corner' | 'left' | 'right';
  readonly rect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly anchor?: { readonly x: number; readonly y: number };
}): ContentBox {
  const size = options.size ?? ICON_BUTTON_DEFAULTS.size;
  const hintSide = options.hintSide ?? ICON_BUTTON_DEFAULTS.hintSide;

  /**
   * `corner` 模式下提示**不占布局宽度** —— 它画在图标左上角的外侧，
   * 属于"附注"而不是"同行元素"。这样按钮本体的尺寸仍然只由图标决定。
   */
  const corner = hintSide === 'corner';
  const hintW =
    options.shortcut === undefined || corner
      ? 0
      : estimateMonoWidth(options.shortcut, FONT.small);
  const labelW = options.label === undefined ? 0 : estimateMonoWidth(options.label, FONT.body);
  const parts = [size, hintW, labelW].filter((w) => w > 0).length;
  const contentW = size + hintW + labelW + Math.max(0, parts - 1) * ICON_BUTTON_DEFAULTS.gap;
  const contentH = Math.max(size, FONT.small + 4, FONT.body + 4);

  const box =
    options.rect !== undefined
      ? { ...options.rect }
      : (() => {
          const a = options.anchor ?? { x: 0, y: 0 };
          return {
            x: Math.round(a.x - contentW / 2),
            y: Math.round(a.y - contentH / 2),
            w: contentW,
            h: contentH,
          };
        })();

  // 图标在提示的**另一侧**；`corner` 模式提示叠在角上，图标不位移
  const iconX =
    box.x + (hintSide === 'left' ? hintW + (hintW > 0 ? ICON_BUTTON_DEFAULTS.gap : 0) : 0);
  return {
    ...box,
    iconX,
    iconY: Math.round(box.y + box.h / 2 - size / 2),
  };
}

/**
 * 估算等宽字体下一段文字的宽度。
 *
 * 存在的理由：`Text` 的宽度要等纹理生成才有值，而命中矩形必须在
 * 布局期定下来。等宽字体的字宽是稳定的（约 0.6em），所以估算足够准；
 * 这里取 0.62 并向上取整，**宁宽勿窄** —— 估窄了会出现
 * "看起来在按钮里、点不到"。
 */
export function estimateMonoWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * 0.62) + 4;
}

/** 默认值集中在这里，调用方不必重复写。 */
export const ICON_BUTTON_DEFAULTS = {
  size: 20,
  color: 0xb0b0be,
  brightColor: PALETTE.douqi.bright,
  hintSide: 'corner' as const,
  /** 提示与图标之间的间隙（同一行排布时用） */
  gap: 4,
  /**
   * 角落提示的字号与描边。
   *
   * 比 `FONT.tiny`(11) 还小一号 —— 它是辅助信息，不能和图标抢注意力。
   * 描边是为了在任意背景上都读得清（需求："esc 可以考虑加描边"）。
   */
  cornerSize: 9,
  cornerStroke: 3,
} as const;

export class IconButton {
  readonly root: Container;

  private readonly icon: Icon;
  /** 整个可点区域（含提示），命中测试用它 */
  private readonly rect: { x: number; y: number; w: number; h: number };
  private readonly hint?: Label;
  private readonly text?: Label;

  private hovered = false;
  private focused = false;
  private lastLit = false;

  constructor(private readonly options: IconButtonOptions) {
    const { pixi } = options;
    const size = options.size ?? ICON_BUTTON_DEFAULTS.size;
    const color = options.color ?? ICON_BUTTON_DEFAULTS.color;
    const hintSide = options.hintSide ?? ICON_BUTTON_DEFAULTS.hintSide;
    const corner = hintSide === 'corner';

    this.root = new pixi.Container();

    // ── 先建标签，才能算出整体宽度 ──
    if (options.label !== undefined) {
      this.text = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.body,
        color,
      });
      this.text.set(options.label);
    }
    if (options.shortcut !== undefined) {
      /**
       * 角落提示：**比 tiny 还小一号 + 描边**。
       *
       * 需求："esc 应该比较小……esc 可以考虑加描边"。
       * 描边保证它在任意背景上都读得清（齿轮本身是浅色，
       * 没有描边时 Esc 会和它糊在一起）。
       */
      this.hint = new Label(pixi, {
        x: 0,
        y: 0,
        size: corner ? ICON_BUTTON_DEFAULTS.cornerSize : FONT.small,
        /**
         * 颜色用**亮**的 `PALETTE.text`，不是 `textDim`。
         *
         * 需求："esc 的描边没有让它看起来足够清晰"。
         *
         * 根因不是描边不够粗，而是**文字本身太暗**：Esc 压在浅色的齿轮上，
         * 深灰字与齿轮笔画糊成一团，再加粗描边也只是把糊的部分圈起来。
         * 改成亮色 + 3px 黑描边之后，它才从齿轮上"跳"出来。
         */
        color: corner ? PALETTE.text : PALETTE.textDim,
        ...(corner
          ? { stroke: 0x000000, strokeWidth: ICON_BUTTON_DEFAULTS.cornerStroke }
          : {}),
      });
      this.hint.set(options.shortcut);
    }

    // ── 布局：全部交给纯函数算（可在 node 里测） ──
    const box = computeContentBox(options);
    this.rect = { x: box.x, y: box.y, w: box.w, h: box.h };
    const midY = box.y + box.h / 2;
    const hintW = options.shortcut === undefined ? 0 : estimateMonoWidth(options.shortcut, FONT.small);
    const labelW = options.label === undefined ? 0 : estimateMonoWidth(options.label, FONT.body);

    this.icon = new Icon({ pixi, name: options.icon, size, color });
    this.icon.root.x = box.iconX;
    this.icon.root.y = box.iconY;

    // 提示与文字按同一顺序排布，垂直各自居中
    let cursor = box.x;
    const place = (node: Container, w: number): void => {
      node.x = cursor;
      cursor += w + ICON_BUTTON_DEFAULTS.gap;
    };
    if (hintSide === 'left' && this.hint) {
      this.hint.root.y = Math.round(midY - FONT.small / 2);
      place(this.hint.root, hintW);
    }
    if (this.text) {
      this.text.root.y = Math.round(midY - FONT.body / 2);
      place(this.text.root, labelW);
    }
    // 图标已由 box.iconX 定位；把游标推到图标右侧，供右侧提示使用
    cursor = box.iconX + size + ICON_BUTTON_DEFAULTS.gap;
    if (hintSide === 'right' && this.hint) {
      this.hint.root.y = Math.round(midY - FONT.small / 2);
      place(this.hint.root, hintW);
    }
    void cursor;

    this.root.addChild(this.icon.root);
    if (this.text) this.root.addChild(this.text.root);
    if (this.hint) {
      if (corner) {
        /**
         * 需求："esc 应该比较小，然后再设置按钮的左上角"，
         * 以及"理论上 esc 应该**盖住**小部分齿轮 icon"。
         *
         * 所以它不是"贴在旁边"，而是**伸进图标左上角**：
         * 右对齐到 `iconX + 4`、下对齐到 `iconY + 5`，
         * 于是右下角与齿轮叠约 4×5px —— 既读得清，又明显是"標在图标上"。
         *
         * （第一版只偏移 +2 / +1，结果 Esc 完全落在齿轮**外面**，
         * 看起来像两个互不相干的元素。）
         */
        this.hint.root.x = box.iconX + 12;
        /**
         * 纵向偏移要**大于** `+5`。
         *
         * 实测（探针读 `getBounds()`）：齿轮 Sprite 占 y 438..458，
         * 但它的**可见**像素从约 440 才开始（圆齿轮的顶部本来就是圆的，
         * 加上 SVG 的 1px 内缩）。`+5` 时 Esc 的底部正好落在 443 ——
         * 只在左上角勉强碰到，看起来仍是"贴在旁边"。
         * `+10` 让它明显压住齿轮的左上角。
         *
         * 横向取 `+12`：Esc 的字形自带描边，且右边最后一笔离字形框
         * 还有 1–2px 空隙，所以 `+4` 时看上去只挨上 2px。
         *
         * ⚠️ 描边宽度 2 → **3**：需求"esc 的描边没有让它看起来足够清晰"。
         * 2px 的黑色描边在深色背景上压根看不出来，等于没加；
         * 3px 才让 Esc 从齿轮的浅色笔画里跳出来。
         */
        this.hint.root.y = box.iconY + 12;
        this.hint.root.anchor.x = 1;
        this.hint.root.anchor.y = 1;
      }
      this.root.addChild(this.hint.root);
    }
  }

  /** 命中测试（逻辑像素）。命中会触发 `onClick`。 */
  hitTest(px: number, py: number): boolean {
    const { x, y, w, h } = this.rect;
    const hit = px >= x && px <= x + w && py >= y && py <= y + h;
    if (hit) this.options.onClick();
    return hit;
  }

  /** 指针悬停。 */
  /**
   * 显示/隐藏快捷键提示。
   *
   * 用途：触屏设备上没有任何键可按，画 `Esc` 只会误导
   * （需求："移动端就不用显示快捷键信息了，无论是技能按钮还是
   * 其他的功能按钮"）。
   *
   * ⚠️ 只是隐藏提示，**不影响可点区域** —— `rect` 是按提示算出来的，
   * 重算会让按钮在两种模式下命中范围不同，反而更难用。
   */
  setShowShortcut(show: boolean): void {
    if (this.hint === undefined) return;
    this.hint.root.visible = show;
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
    this.update();
  }

  /**
   * 键盘焦点。
   *
   * 与"悬停"分开记录：视觉一致，但来源不同 —— 混成一个字段会让
   * "鼠标移开时把键盘选中也一起清掉"。
   */
  setFocused(focused: boolean): void {
    this.focused = focused;
    this.update();
  }

  /** 亮起/熄灭（悬停或键盘焦点）。 */
  update(): void {
    const lit = this.hovered || this.focused;
    if (lit === this.lastLit) return;
    this.lastLit = lit;
    this.icon.setColor(lit ? (this.options.brightColor ?? ICON_BUTTON_DEFAULTS.brightColor) : (this.options.color ?? ICON_BUTTON_DEFAULTS.color));
    // 标签跟着一起亮 —— 否则"图标亮了、文字没亮"看起来像两件事
    this.text?.setColor(lit ? (this.options.brightColor ?? ICON_BUTTON_DEFAULTS.brightColor) : (this.options.color ?? ICON_BUTTON_DEFAULTS.color));
  }

  /** 可点区域（供调用方做布局断言/调试）。 */
  get bounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
    return this.rect;
  }
}

