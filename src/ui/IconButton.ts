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
 * - 键位提示用**等宽字体**，是一枚压在**图标左上角**上的小角标
 *   （更小一号 + 黑描边）—— 见 `hintBox` 与 `ui/iconHint.ts`。
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
import {
  BASE_HINT_FONT,
  MIN_HINT_FONT,
  estimateMonoWidth,
  iconHintBoxSize,
  iconHintFontSize,
  iconHintPlacement,
} from './iconHint';

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
   * ⚠️ **不存在"提示在哪一侧"这一项** —— 摆法只有一种：**角标**。
   *
   * 用户 2026-10-13 原话："**是角标在左上角啊？** 你随便找个【昨天】的版本
   * 都是这样。" 而昨天的 `e64eb2d` 里，两个按钮配的都是 `hintSide: 'corner'`
   * —— 取值本来就一致，所以这次把那一项整个删掉，只留这套外观。
   *
   * 曾有过、且都已删掉的三项（每一个都对应一次走错的路）：
   *
   *   1. `hintSide: 'left' | 'right'`（**并排**：`⚙ F1` / `F1 ⚙`）—— 首个提交
   *      `d4e3fb7` 的摆法。`41ca468` 误以为"用户要的历史版本"就是它，于是
   *      把角标拆掉恢复了并排 ✗ —— 用户否掉的从来不是角标。
   *   2. `hintCorner: 'auto'`（按按钮在画布哪一半自动翻边）—— 会让"左上角的
   *      返回"和"右上角的齿轮"各走一条分支，看起来是两套算法 ✗
   *      （用户原话："**不用看在哪一半，全局统一风格**"）。
   *   3. `hintOffset: { dx, dy }`（`+34 / +22` 手调数字）—— 拿手调偏移硬拗
   *      左上的落位。角标的位置是**算出来的**（`iconHintPlacement` 一行），
   *      不需要任何偏移量。
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
  readonly rect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly anchor?: { readonly x: number; readonly y: number };
}): ContentBox {
  const size = options.size ?? ICON_BUTTON_DEFAULTS.size;

  /**
   * 角标提示**不占布局宽度** —— 它画在图标左上角**之内**（压着那一角），
   * 属于"附注"而不是"同行元素"。这与 `e64eb2d` 逐字相同：
   *
   * ```ts
   * // 老版：`corner` 模式下 hintW 直接归零（只有并排才占宽度）
   * const hintW = options.shortcut === undefined || corner ? 0 : estimateMonoWidth(...);
   * ```
   *
   * ⚠️ 所以按钮本体的尺寸仍然只由**图标 + 文字标签**决定：提示整块落在图标的
   * 坐标范围里，`hintBounds` 只是把"真的画在哪"报出去，不参与命中区域
   * （可点范围靠图标的 `hitSlop` 外扩，见 `contains`）。
   */
  const labelW = options.label === undefined ? 0 : estimateMonoWidth(options.label, FONT.body);
  const parts = [size, labelW].filter((w) => w > 0).length;
  const contentW = size + labelW + Math.max(0, parts - 1) * ICON_BUTTON_DEFAULTS.gap;
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

  return {
    ...box,
    /** 图标在盒内左端（文字标签在它右侧）；角标不参与排布，图标不位移。 */
    iconX: box.x,
    iconY: Math.round(box.y + box.h / 2 - size / 2),
  };
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
  /**
   * 图标与**文字标签**之间的间隙（只有同时给了 `label` 才会用到）。
   *
   * ⚠️ 角标提示**不占这个间隙** —— 它压在图标的左上角上，不参与排布
   * （见 `computeContentBox`）。
   */
  gap: 4,
  /**
   * 提示字号的两个基准 —— **转发 `ui/iconHint.ts`**（不在这里重写数字）。
   *
   *   `hintFont`    = 提示在**图标 20px 时的字号**（**9**，角标那一档）
   *   `minHintFont` = 缩放时字号的**下限**（8）
   *
   * ⚠️ 真正的读值是 `iconHintFontSize(size)` —— 那里写着"按图标边长缩放 +
   * 下限"那条规则。这里留着只是为了让调用方有一处可读的默认值表。
   *
   * ⚠️ `hintFont` 是 **9 而不是 `FONT.small`（13）**：角标压在图标角上，
   * 必须比图标明显小一圈（老版 `e64eb2d` 的 `cornerSize` 就是 9）。
   * 13 是"并排"那一版的值（那时提示与图标同一行、是同级元素）——
   * `41ca468` 恢复并排时把它一起改过去了，现在跟着角标改回来。
   *
   * ⚠️ 沿革：这两项**曾经是"提示不随 UI 缩放"的全部依据**（某轮判断：
   * "角标放大到 40px 会比图标还抢眼"）—— 用户推翻了它，现在它们只是
   * **比例的分母与下限**。缩放与"角标"是两件事，可以叠加。
   *
   * ⚠️ 更早还有 `hintOverlap: 4` 与 `hintCanvasGap: 2` —— 前者是"让角标
   * 压住那一角"（用户报的"左中"就是它造成的），后者从第一天起就没有读者
   * （那是"别伸出画布"那条兜底的余量，而那条兜底已被用户明确否掉）。
   * 两个都已删：**一条没有读者的常量，就是在暗示一条不存在的规则。**
   */
  hintFont: BASE_HINT_FONT,
  minHintFont: MIN_HINT_FONT,
  /**
   * 角标提示的**黑描边宽度** —— 老版 `e64eb2d` 的 `cornerStroke: 3`。
   *
   * ⚠️ 它**不是装饰**：角标压在图标上，而齿轮本身是浅色笔画 —— 不加描边时
   * `F1` 的深灰字与齿轮糊成一团（用户原话："**esc 的描边没有让它看起来足够
   * 清晰**"）。实测 3px 才让它"跳"出来。并排摆法不需要它（提示不压图标），
   * 所以这一项是**角标专属**的几何特征。
   */
  cornerStroke: 3,
  /**
   * 可点区域在**图标外侧**的外扩量（逻辑像素）。
   *
   * ==================================================================
   * ⚠️ 为什么是**增量**而不是"整个矩形"
   * ==================================================================
   *
   * 旧版 `SettingsButton` 有一个 `HIT = 44`：锚点按它算、图标钉在它中心，
   * 于是可点范围 = 44×44 的方块。可它同时**把按钮的落位也绑死了** ——
   * "按钮贴右上角 8px"其实算的是那个 44 方块贴边，图标因此内缩 12px
   * （齿轮落在 `x=924` 而不是 `932`）。位置与命中范围被同一个魔数绑在一起，
   * 正是 `ScreenChrome` 要把两者分开的原因（图标左上角是一条落位规则，
   * 可点范围是另一条人体工学规则）。
   *
   * 现在命中范围 = 内容盒 **∪ 图标外扩 `hitSlop`**：图标 20/22px 加上
   * 两侧各 10px，得到 40~42px 的方块 —— 与旧版 44 相差无几，鼠标 / 手指
   * 都好点，而**它不再影响按钮画在哪**。
   *
   * ⚠️ 顺带修掉一个真实的副作用：旧版 44 方块在战斗界面会**盖住右上角
   * 的计时器**（`LAYOUT.timer` 就在 `x 868..952, y 3..23`）—— 那里本来
   * 不该有可点区域。40/42 的方块仍然与计时器相邻，但不再压住它。
   */
  hitSlop: 10,
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
   * 键位提示的**包围盒**（构造时由 `iconHintPlacement` 算出来）。
   *
   * ⚠️ **坐标是相对本组件 `root` 的**（与 `rect` / `contains` 同一坐标系），
   * **不是**画布坐标：落位函数只拿到"盒内"的图标矩形。谁把按钮整体摆到了
   * 画布上的某处，谁就要在报出去之前加上那个位移 —— `ScreenChrome.
   * shortcutBoundsOf` 正是这么做的（不加就会报出 `{0,0}` 这种假位置）。
   *
   * 为什么要留一份：提示是"算出来的落位"，而截图脚本只能看图 ——
   * "提示在自己那一侧、且没有伸出画布"这条纪律需要一个**读得到**的数
   * （`hintBounds` 探针）。实测旧版的手调偏移就是这么发现"`Escape` 被裁"的。
   */
  private hintBox: { x: number; y: number; w: number; h: number } | undefined = undefined;

  private hovered = false;
  private focused = false;
  private lastLit = false;
  private lastRingVisible: boolean | undefined = undefined;

  /**
   * 图标在本组件 `root` 坐标系里的左上角与边长。
   *
   * ⚠️ 存在的理由：`ScreenChrome` 要把按钮的**图标左上角**钉到一个算法
   * 算出来的点上（"贴右上角 8px"之类）。而图标在 `root` 里的位置由
   * `computeContentBox` + `anchor` 一起决定（含取整），外面**重算一遍**
   * 就是第二份布局真相 —— 那正是"看着在按钮里、点不到"的来源。
   * 所以答案只在这里留一份，外面读它。
   */
  private iconX = 0;
  private iconY = 0;
  private iconSize = 0;

  constructor(private readonly options: IconButtonOptions) {
    const { pixi } = options;
    const size = options.size ?? ICON_BUTTON_DEFAULTS.size;
    const color = options.color ?? ICON_BUTTON_DEFAULTS.color;

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
       * 键位提示：**压在图标左上角上的角标**。
       *
       * ⚠️ 三条都照 `e64eb2d` 抄（老版的 `corner` 分支）：
       *
       *   1. **亮色 `PALETTE.text`**（不是 `textDim`）—— 老版的理由写得很具体：
       *      "根因不是描边不够粗，而是**文字本身太暗**：Esc 压在浅色的齿轮上，
       *      深灰字与齿轮笔画糊成一团"
       *   2. **黑描边 3px**（`cornerStroke`）—— 角标压图标，没有描边读不出来
       *   3. **9px**（`iconHintFontSize` 在 20px 图标时的值）—— 附注要比图标
       *      明显小一圈。字号仍然是**图标边长的函数**（跟随 UI 缩放那条规则
       *      叠在角标上），只是基准从并排的 13 改回角标的 9。
       */
      this.hint = new Label(pixi, {
        x: 0,
        y: 0,
        size: iconHintFontSize(size),
        color: PALETTE.text,
        stroke: 0x000000,
        strokeWidth: ICON_BUTTON_DEFAULTS.cornerStroke,
      });
      this.hint.set(options.shortcut);
    }

    // ── 布局：全部交给纯函数算（可在 node 里测） ──
    const box = computeContentBox(options);
    this.rect = { x: box.x, y: box.y, w: box.w, h: box.h };
    this.iconX = box.iconX;
    this.iconY = box.iconY;
    this.iconSize = size;
    const midY = box.y + box.h / 2;

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

    /**
     * 文字标签排在**图标右侧**（只有它有排布；角标提示不参与）。
     *
     * ⚠️ 游标从图标右缘起 —— 角标不占宽度，所以这里只有 `label` 一个元素。
     */
    if (this.text) {
      this.text.root.x = box.iconX + size + ICON_BUTTON_DEFAULTS.gap;
      this.text.root.y = Math.round(midY - FONT.body / 2);
    }

    this.root.addChild(this.icon.root);
    if (this.text) this.root.addChild(this.text.root);
    if (this.hint) {
      /**
       * ============================================================
       * 角标的**落位**由 `iconHintPlacement` 一条规则算出（不手调偏移）
       * ============================================================
       *
       * 规则只有一行：**提示左缘 = 图标左缘，上缘 = 图标上缘 − `rise`**
       * （锚点是提示的左上角）。`x` 不动、`y` 抬 `rise` —— 这就是
       * `e64eb2d` 的角标（`rise = 0`）再加上用户 2026-10-13 给的抬升
       * （原话："**f1 还要再往上挪几个 px**"，见 `HINT_RISE`）。
       *
       * ⚠️ `41ca468` 那次"恢复历史"挖错了版本（挖到首个提交 `d4e3fb7` 的
       * **并排**），把这里改成了"同一行、垂直居中、按 `hintSide` 在左右" ✗
       * —— 现在逐字改回角标，再叠上抬升。
       *
       * ⚠️ `rise` 由 `iconHintRise(size)` 给（跟着图标缩放），**不在这里
       * 自己算** —— 与字号同一条公式、同一个分母，两处各写一遍必然漂。
       *
       * ⚠️ 落位**不做越界避让**（用户明确否掉："别再加第二套避让逻辑"）：
       * 抬升的上限由**锚点**保证（图标上缘 ≥ 安全区 `8×scale`，而
       * `HINT_RISE = 4 ≤ 8`）—— 推导见 `iconHintPlacement` 的说明。
       */
      const hint = iconHintBoxSize(options.shortcut ?? '', size);
      const placed = iconHintPlacement(
        {
          icon: { x: box.iconX, y: box.iconY, w: size, h: size },
          canvasW: LOGICAL.width,
          canvasH: LOGICAL.height,
        },
        hint.w,
        hint.h,
      );
      this.hint.root.x = placed.x;
      this.hint.root.y = placed.y;
      this.hint.root.anchor.x = placed.anchorX;
      this.hint.root.anchor.y = placed.anchorY;
      /**
       * 探针用（`hintBounds`）—— 提示真的画在哪儿只有这里知道。
       *
       * ⚠️ 锚点是提示的**左上角**（`anchorX/Y = 0`），所以包围盒的左上角
       * 就是 `placed`。公式与 `iconHintPlacement` 的锚点语义**必须同步**：
       * 锚点一改，这个盒子就会算错（截图脚本读它判断"提示有没有出画布"）。
       */
      this.hintBox = { x: placed.x, y: placed.y, w: hint.w, h: hint.h };
      this.root.addChild(this.hint.root);
    }
  }

  /** 命中测试（逻辑像素）。命中会触发 `onClick`。 */
  hitTest(px: number, py: number): boolean {
    const hit = this.contains(px, py);
    if (hit) this.options.onClick();
    return hit;
  }

  /**
   * **只问"在不在里面"**（逻辑像素，坐标与 `root` 同系）—— 不触发点击。
   *
   * ⚠️ 与 `hitTest` 共用同一段算术：调用方两种需求都有（命中即触发 vs
   * 只想知道悬停状态），各写一遍必然漂移。
   *
   * 命中区域 = 内容盒 **∪ 图标外扩 `hitSlop`** —— 见 `ICON_BUTTON_DEFAULTS`
   * 里那个常量的说明（图标只有 20px 见方，纯按它算太小，手指点不中）。
   */
  contains(px: number, py: number): boolean {
    const { x, y, w, h } = this.rect;
    if (px >= x && px <= x + w && py >= y && py <= y + h) return true;
    const pad = ICON_BUTTON_DEFAULTS.hitSlop;
    return (
      px >= this.iconX - pad &&
      px <= this.iconX + this.iconSize + pad &&
      py >= this.iconY - pad &&
      py <= this.iconY + this.iconSize + pad
    );
  }

  /** 图标在 `root` 坐标系里的左上角（`ScreenChrome` 用它钉落位）。 */
  get iconLeft(): number {
    return this.iconX;
  }

  /** 图标在 `root` 坐标系里的上缘。 */
  get iconTop(): number {
    return this.iconY;
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
   * 键位提示的包围盒（没有提示时为 `undefined`）。
   *
   * ⚠️ **相对本组件 `root` 的坐标**（见 `hintBox` 的说明）——
   * 想拿画布坐标要自己加上 `root.x/y`。
   *
   * ⚠️ 它是**估算**（`iconHintBoxSize` 走的 `estimateMonoWidth`）：真实
   * 字形宽度要等 Pixi 生成纹理。估宽不估窄，所以"看着没伸出画布"用它判
   * 是安全的。
   */
  get hintBounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined {
    return this.hintBox === undefined ? undefined : { ...this.hintBox };
  }
}

