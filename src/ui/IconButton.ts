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

import type { Container, Graphics } from 'pixi.js';
import { Icon, type IconName } from '../render/icons';
import { PALETTE } from '../render/theme';
import { FONT, LOGICAL } from './layout';
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
  /**
   * 角落提示**摆在哪里** —— 全应用**一条规则**，与按钮在画布哪个角无关。
   *
   * ==================================================================
   * ⚠️ 这一项**不存在**（连"哪种摆法"的可选项都不给）
   * ==================================================================
   *
   * 用户 2026-10-12 的两条否决把它收敛成了一条：
   *
   *   1. "**不用看在哪一半，全局统一风格**" —— 旧版有个 `hintCorner`，
   *      取值 `'auto'` 时**按按钮在画布哪一半**决定提示翻到左边还是右边；
   *      于是"左上角的返回"和"右上角的齿轮"各走一条分支，看起来就是
   *      **两套算法**。那个选项已删。
   *   2. "**快捷键在图标的左上角**，目前在正中间" —— 规格就是**左上角角标**。
   *
   * 所以既没有"按位置选边"，也没有"另一种摆法"可选 —— 有分支就意味着两个
   * 按钮可能走不同的路，正是这一轮要消掉的东西。位置由
   * `iconHintPlacement` 从**图标本地的坐标**一条算出来（见那里）。
   *
   * ⚠️ 更早还叫 `hintOffset: { dx, dy }`（`+34 / +22`）—— 拿手调数字硬拗
   * 左上的落位。也已删（它没有任何其它调用方）。
   */
  /**
   * 键盘焦点时在图标外画一圈**描边**（不填色）。
   *
   * ==================================================================
   * 为什么需要它：只靠颜色无法区分"聚焦"与"别处的选中"
   * ==================================================================
   *
   * 需求（用户）："设置按钮 有时也会被变黄" —— 齿轮聚焦时被涂成
   * `douqi.bright`（金色），而备战界面**已选中的角色卡也是金色**，
   * 于是"我的光标在这儿"和"这一项已经选定了"撞成一个外观。
   *
   * 光把 `brightColor` 换掉只是"换一种撞法"：真正的区分维度是**形状**。
   * 所以这里给一个可选的**焦点环**：只有键盘焦点才画，
   * 悬停（鼠标划过）不画 —— 两种状态来源不同，外观也不该一样。
   *
   * ⚠️ 默认关闭：战斗 HUD 上图标按钮很多，默认加环会改变既有观感。
   * 需要"焦点必须一眼看到"的调用方（设置按钮）显式打开。
   */
  readonly focusRing?: boolean;
  /** 焦点环颜色（默认与 `brightColor` 同源，见 `ICON_BUTTON_DEFAULTS.focusRingColor`）。 */
  readonly focusRingColor?: number;
  /** 可选文字标签（画在图标与提示之间） */
  readonly label?: string;
  /** 固定矩形（给 `rect` 时按它定位并命中） */
  readonly rect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 居中锚点（不给 `rect` 时按它定位） */
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly onClick: () => void;
}

/** 落位要看的几何：图标在画布里的矩形（+ 兜底夹取用的画布尺寸）。 */
export interface IconHintInput {
  readonly icon: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly canvasW: number;
  readonly canvasH: number;
}

/**
 * 角落提示的**落位** —— 纯函数（可在 node 里测，不碰 Pixi）。
 *
 * ==================================================================
 * 规则（一条，两个角落共用；没有"看位置"的判断、也没有模式开关）
 * ==================================================================
 *
 * 设图标矩形为 `(ix, iy, iw, ih)`、提示尺寸 `hintW × hintH`：
 *
 * ```
 * 提示的【左上角】 = (ix, iy + OVERLAP)
 * ```
 *
 * 也就是**提示的左缘与图标的左缘对齐**、上缘比图标上缘低 `OVERLAP`
 * —— 提示因此压住图标的**左上角**，读起来是一个**角标**。
 * 锚点是提示的左上角（`anchorX/Y = 0`），提示**往右下方**长。
 *
 * ⚠️ **用户 2026-10-12 把"在哪"说死了**（原话）："**快捷键在图标的左上角**，
 * 目前在**正中间**"。
 *
 * ⚠️ 旧版把锚点放在提示的**右下角**、且右缘对齐到 `ix + OVERLAP` ——
 * 那让提示以"图标左缘"为中心横跨，看起来就**在正中间**（用户报的正是
 * 这个）。现在左缘对齐 `ix`。
 *
 * ⚠️ **不做越界避让**（没有夹取、没有第二套逻辑）—— 用户 2026-10-12 明确
 * 否掉了（"别再加第二套避让逻辑"）。判据：画布是 letterbox 的，返回箭头在
 * 逻辑 `x = 8`、齿轮在 `x = 924`，两处**图标的左上角都在画布内**，而这条
 * 规则只让提示**往右下方**长：
 *
 * | 调用点 | 图标左上角 | 提示包围盒（`Esc` 估计宽 21） | 在 960×540 内？ |
 * |---|---|---|---|
 * | 返回箭头 | `(8, 8)` | `x 8..29, y 12..21` | ✅ |
 * | 设置齿轮 | `(924, 8)` | `x 924..945, y 12..21` | ✅ |
 *
 * ⚠️ 所以这里**故意不写兜底**：真有调用方把图标放到会溢出的位置，那是
 * 它自己的 bug，应当在截图/测试里**看见**，而不是被一段夹取悄悄推回来。
 */
export function iconHintPlacement(
  input: IconHintInput,
  hintW: number,
  hintH: number,
): { x: number; y: number; anchorX: number; anchorY: number } {
  const { icon } = input;
  const { hintOverlap: overlap } = ICON_BUTTON_DEFAULTS;
  /**
   * 提示的左上角 = 图标左上角 + 纵向 `OVERLAP`。
   *
   * ⚠️ 两个按钮都走这里 —— 没有分支看"按钮在画布哪一半"；
   * `canvasW` / `canvasH` 仍在入参里（调用方要说明"这块提示是画在哪张
   * 画布上的"），但**规则本身不使用它们**。
   */
  void hintW;
  void hintH;
  return { x: icon.x, y: icon.y + overlap, anchorX: 0, anchorY: 0 };
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

/**
 * 焦点环的**几何**（纯函数，可在 node 里测）。
 *
 * ⚠️ 环画在图标**外面**（`pad` 向外扩），且**不随提示文字变化**：
 * 焦点是"键盘现在在这一格"，与旁边那行键位提示无关。它的存在是为了
 * 给"聚焦"一个**不依赖颜色**的线索（需求："设置按钮 有时也会被变黄"）。
 */
export function focusRingRect(
  iconX: number,
  iconY: number,
  size: number,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const pad = ICON_BUTTON_DEFAULTS.focusRingPad;
  return { x: iconX - pad, y: iconY - pad, w: size + pad * 2, h: size + pad * 2 };
}

/** 默认值集中在这里，调用方不必重复写。 */
export const ICON_BUTTON_DEFAULTS = {
  size: 20,
  color: 0xb0b0be,
  /**
   * 高亮色（悬停 / 键盘焦点）。
   *
   * ⚠️ 从 `PALETTE.douqi.bright`（金色）**改掉**了 —— 需求（用户）：
   * "设置按钮 有时也会被变黄"。金色在本作里是"**选中**"的语言
   * （备战界面已确定的卡片、技能格被选中），而图标按钮的聚焦是
   * "**光标在这儿**"，两者不该同色。
   *
   * 现在它取 `PALETTE.focus`：冷白偏蓝，也就是备战界面光标环的颜色 ——
   * 整个项目"光标 / 焦点"只有一种颜色语言（见 `render/theme.ts`）。
   */
  brightColor: PALETTE.focus,
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
  /**
   * 角落提示的**落位参数**（只有两个，其余全是推出来的）。
   *
   *   - `hintOverlap`：提示的外缘越过图标那个角多少 —— 提示因此**压住
   *     图标那一角**（需求："esc 应该……盖住小部分齿轮 icon"）。
   *   - `hintCanvasGap`：提示与画布边的**最小**呼吸空间。它是"别伸出
   *     画布"那条兜底的余量（提示字形自带描边，贴到 0 会看着被切）。
   *
   * ⚠️ 这两个不是"调位置"的数字：提示在**哪一侧**由 `iconHintPlacement`
   * 的规则定死（图标左上角），它们只决定**压多少**与**离画布边多远**。
   */
  hintOverlap: 4,
  hintCanvasGap: 2,
  /**
   * 焦点环的默认几何。
   *
   * 环画在**图标本身**外面（不外扩到提示文字），半径 6 让它看起来像
   * 一个"按钮框"而不是"贴纸"。这些都是逻辑像素，随 `size` 一起放大
   * 会在 `focusRing` 的实现里按 `size` 缩放。
   */
  focusRingPad: 5,
  focusRingRadius: 6,
  focusRingWidth: 2,
} as const;

export class IconButton {
  readonly root: Container;

  private readonly icon: Icon;
  /** 整个可点区域（含提示），命中测试用它 */
  private readonly rect: { x: number; y: number; w: number; h: number };
  private readonly hint?: Label;
  private readonly text?: Label;
  /**
   * 焦点环（只有 `options.focusRing` 为真时才建）。
   *
   * ⚠️ 它是 `Graphics` 而**不是** `Panel`：环是描边、**不能有填充** ——
   * 需求要的正是"只描边不填色"，填了就和"被选中"的金色底板撞了。
   */
  private readonly ring?: Graphics;

  /**
   * 角落提示的**包围盒**（逻辑坐标，构造时由 `iconHintPlacement` 算出来）。
   *
   * 为什么要留一份：提示是"算出来的落位"，而截图脚本只能看图 ——
   * "提示贴在自己那一侧、且没有伸出画布"这条纪律需要一个**读得到**的数
   * （`hintBounds` 探针）。实测旧版的手调偏移就是这么发现"`Escape` 被裁"的。
   */
  private cornerHintBox: { x: number; y: number; w: number; h: number } | undefined = undefined;

  private hovered = false;
  private focused = false;
  private lastLit = false;
  private lastRingVisible: boolean | undefined = undefined;

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

    /**
     * 焦点环：**先加进 root**（它要画在图标下面，不能盖住齿轮笔画），
     * 初始不可见。
     */
    if (options.focusRing === true) {
      const ringRect = focusRingRect(box.iconX, box.iconY, size);
      this.ring = new pixi.Graphics();
      this.ring
        .roundRect(ringRect.x, ringRect.y, ringRect.w, ringRect.h, ICON_BUTTON_DEFAULTS.focusRingRadius)
        .stroke({
          color: options.focusRingColor ?? options.brightColor ?? ICON_BUTTON_DEFAULTS.brightColor,
          width: ICON_BUTTON_DEFAULTS.focusRingWidth,
        });
      this.ring.visible = false;
      this.root.addChild(this.ring);
    }

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
         * ============================================================
         * 角落提示：**位置全是算出来的**（旧版这里是手调偏移）
         * ============================================================
         *
         * 需求："esc 应该比较小，然后再设置按钮的左上角"，以及"理论上
         * esc 应该**盖住**小部分齿轮 icon"。所以它不是"贴在旁边"，而是
         * 压住图标的一个角。
         *
         * ⚠️ **位置由 `iconHintPlacement` 一条规则推**（不按按钮在画布
         * 哪一半、也没有任何偏移常量）：齿轮在右上角、返回箭头在左上角，
         * 两边都是**提示压在自己图标的左上角**。
         *
         * ⚠️ 旧版这里写的是 `box.iconX + 12 + hintOffset.dx`、`box.iconY + 12
         * + hintOffset.dy`，而 `ScreenControls` 传了 `+34 / +22` 去硬拗
         * 左上的落位（"调了三版"）。那个参数已删。
         *
         * ⚠️ 描边宽度 2 → **3**（需求："esc 的描边没有让它看起来足够清晰"）：
         * 3px 才让 Esc 从齿轮的浅色笔画里跳出来。那条约束现在体现在
         * `cornerStroke` 上，与位置无关。
         */
        const cornerW = estimateMonoWidth(options.shortcut ?? '', ICON_BUTTON_DEFAULTS.cornerSize);
        const placed = iconHintPlacement(
          {
            icon: { x: box.iconX, y: box.iconY, w: size, h: size },
            canvasW: LOGICAL.width,
            canvasH: LOGICAL.height,
          },
          cornerW,
          ICON_BUTTON_DEFAULTS.cornerSize,
        );
        this.hint.root.x = placed.x;
        this.hint.root.y = placed.y;
        this.hint.root.anchor.x = placed.anchorX;
        this.hint.root.anchor.y = placed.anchorY;
        /**
         * 探针用（`hintBounds`）—— 提示真的画在哪儿只有这里知道。
         *
         * ⚠️ 锚点现在是提示的**左上角**（规则改成"左缘对齐图标左缘"之后），
         * 所以包围盒的左上角就是 `placed` —— 这里只把估算宽度补上。
         * 公式与 `iconHintPlacement` 的锚点语义**必须同步**：锚点一改，
         * 这个盒子就会算错（截图脚本读它判断"有没有压住图标左上角"）。
         */
        this.cornerHintBox = {
          x: placed.anchorX === 1 ? placed.x - cornerW : placed.x,
          y: placed.anchorY === 1 ? placed.y - ICON_BUTTON_DEFAULTS.cornerSize : placed.y,
          w: cornerW,
          h: ICON_BUTTON_DEFAULTS.cornerSize,
        };
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
   * 用途：触屏设备上没有任何键可按，画 `F1` / `Esc` 只会误导
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
   *
   * ⚠️ 但**外观不完全一致**：焦点环只跟键盘焦点走（见 `focusRing`）。
   * 鼠标悬停是"我正在指过去"，键盘焦点是"按 Enter 会作用在它身上"——
   * 后者需要更明确、更持久的提示。
   */
  setFocused(focused: boolean): void {
    this.focused = focused;
    this.update();
  }

  /** 亮起/熄灭（悬停或键盘焦点）。 */
  update(): void {
    const lit = this.hovered || this.focused;
    /**
     * ⚠️ 焦点环的处理**放在 `lit` 的早退之前**：环只看 `focused`，
     * 而"悬停着、同时失去键盘焦点"时 `lit` 不变（还是 true），
     * 早退会把环留在屏幕上。
     */
    if (this.ring !== undefined && this.lastRingVisible !== this.focused) {
      this.lastRingVisible = this.focused;
      this.ring.visible = this.focused;
    }
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

  /**
   * 角落提示的包围盒（没有提示时为 `undefined`）。
   *
   * ⚠️ 它是**估算**（用 `estimateMonoWidth` + `cornerSize`）：真实字形宽度
   * 要等 Pixi 生成纹理。估宽不估窄，所以"看着没伸出画布"用它判是安全的。
   */
  get hintBounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined {
    return this.cornerHintBox === undefined ? undefined : { ...this.cornerHintBox };
  }
}

