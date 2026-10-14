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
import { rainbowColors } from './rainbow';
import type { Container, Graphics } from 'pixi.js';
import { FONT_FAMILY } from '../render/theme';
import { FONT } from './layout';
import { HALF_PIXEL, type PixiCtor } from './primitives';

export interface CastBarOptions {
  readonly pixi: PixiCtor;
  /** ⚠️ 可变：UI 缩放会重设它（见 `setRect`） */
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 填充色（纯色，无渐变）——**普通读条**用它 */
  readonly fill: number;
  /**
   * **引导**的填充色（缺省 = 用 `fill`）。
   *
   * 用户 2026-10-14："引导技能 记得 **进度条 换点颜色**"。
   * 引导与普通读条在引擎里是同一条读条（`ChannelDef` 今天只有 UI 读它，
   * 见 `capabilityAudit`），所以"不一样"只能靠**颜色**表达。
   */
  readonly channelFill?: number;
  /** 底槽色（"还没走完"的那一段） */
  readonly track: number;
  /**
   * 描边色 —— **固定值，不随进度变**。
   *
   * 曾经有过"进度过 70% 时描边转亮"的提示，已去掉：剩余秒数已经写在
   * 条上，而且 70% 对长短不同的招式意味着不同的剩余时间，
   * 不是一个玩家能学会的稳定规则。见 `BattleScene` 里的调用处。
   */
  readonly line: number;
  readonly labelColor?: number;
  readonly timeColor?: number;
  /** 是否有"剩余秒数"这一栏（玩家读条有，Boss 预警条没有） */
  readonly showTime?: boolean;
}

/** 圆角半径：4px 的面板配 2px 已经够圆。 */
/** 彩虹描边的分段数（见 `drawRainbowBorder`）。 */
const SEGMENTS = 48;

/**
 * 彩虹分段色 —— **模块级只算一次**。
 *
 * ⚠️ 它只跟 `SEGMENTS` 有关，是**常量**。原先它在 `drawRainbowBorder()`
 * 里现算（每帧 48 次 HSL→RGB + 一个新数组）—— 那是 2026-10-14 那次
 * "**进度条卡顿**"的一半原因（另一半见 `update()` 里的说明）。
 */
const RAINBOW = rainbowColors(SEGMENTS);

const RADIUS = 2;

/**
 * 填充相对面板内缩的像素数。
 *
 * **必须是 2 而不是 1** —— 1px 的描边以路径线为中心、向两侧各铺 0.5px，
 * 所以描边实际占用的是"第一行 1px"。填充若从 `+1` 开始就会盖住它。
 * 详见 `update()` 的说明（这是"看不到上 border"的根因）。
 */
const INSET = 2;

export class CastBar {
  readonly root: Container;

  /** 底槽（UI 缩放时重画） */
  private readonly bg: Graphics;
  private readonly fillGfx: Graphics;
  private readonly border: Graphics;
  /** 当前是不是引导（决定填充色）。 */
  private channel = false;
  /** 当前是不是霸体（决定边框画纯色还是彩虹）。 */
  private armored = false;
  /** 强制下一次 `update()` 重画（换色 / 换边框之后置上）。 */
  private dirty = true;
  private readonly nameText: Text;
  private readonly timeText: Text;
  /**
   * 招式提示标签（「霸体」「高伤」…）。
   *
   * 与技能名分开一格，画在技能名**右边** —— 技能名已经左对齐，
   * 标签紧跟其后读起来是"技能名（标签）"，比塞到右边和秒数挤更好。
   */
  private readonly tagText: Text;
  private lastProgress = -1;

  constructor(private readonly options: CastBarOptions) {
    const { pixi, rect } = options;
    this.root = new pixi.Container();

    // ── 底槽 ──
    this.bg = new pixi.Graphics();
    this.bg.roundRect(rect.x, rect.y, rect.w, rect.h, RADIUS).fill({ color: options.track, alpha: 1 });

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

    this.tagText = new Text({
      text: '',
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: FONT.small,
        fill: css(0xe4a840),
      },
    });
    // 紧跟技能名之后（x 由 setContent 里按技能名实际宽度推）
    this.tagText.y = midY;
    this.tagText.anchor.y = 0.5;

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
    this.root.addChild(this.bg, this.fillGfx, this.border, this.nameText, this.tagText, this.timeText);
  }

  /**
   * 技能名、剩余秒数，以及可选的提示标签。
   *
   * 标签用" · "连接（例：`高伤`），并以**暗金**画在技能名右侧 ——
   * 它的作用是"这一招该怎么应对"，与技能名同级但更弱。
   */
  setContent(name: string, time: string, tagLabel = ''): void {
    if (this.nameText.text !== name) this.nameText.text = name;
    const t = this.options.showTime === false ? '' : time;
    if (this.timeText.text !== t) this.timeText.text = t;
    if (this.tagText.text !== tagLabel) this.tagText.text = tagLabel;
    // 技能名宽度要到渲染后才准，所以这里按 Text 的实际宽度定位
    this.tagText.x = this.options.rect.x + 12 + this.nameText.width + 8;
  }

  /** 技能名颜色（Boss 预警条用它表达"能不能打断"）。 */
  setNameColor(color: number): void {
    this.nameText.style.fill = css(color);
  }

  /** 剩余秒数颜色。 */
  setTimeColor(color: number): void {
    this.timeText.style.fill = css(color);
  }

  /**
   * **这条读条是不是"引导"**（用户："引导技能 记得进度条换点颜色"）。
   *
   * ⚠️ 换色要**强制重画**（见 `update` 里的 `dirty`）：否则进度没动时
   * 颜色不会自己更新。
   */
  setChannel(on: boolean): void {
    if (this.channel === on) return;
    this.channel = on;
    this.dirty = true;
  }

  /**
   * **霸体**：把描边从纯色换成**彩色渐变**（用户："霸体技能，能不能给边框
   * 搞个彩色渐变？"）。
   *
   * ⚠️ 判据用"**这个读条是不是霸体**"（`interruptImmune` 提示），
   * 而不是"能不能打断" —— 两者今天恰好等价，但语义不同（见 `viewAdapter`
   * 里 `armored` 的注释）。
   */
  setArmored(on: boolean): void {
    if (this.armored === on) return;
    this.armored = on;
    this.dirty = true;
    /**
     * ⚠️ 描边**不跟 `update()` 走了**（那里每帧调一次的代价见 `update()`）⇒
     * 状态真的翻转时，这里必须自己画一次。
     */
    this.drawBorder(this.options.line);
  }

  /**
   * 画描边。
   *
   * ⚠️ **路径内移 0.5px** —— 这是"上下边框看不见"的另一个原因。
   *
   * 1px 的描边是**以路径线为中心**向两侧各铺 0.5px。路径画在整数坐标
   * （如 `y=74`）上时，这条线跨越 73.5..74.5 两个半行像素 ——
   * 两个半行各自混合一次，最终上下两条边框都被稀释成接近底槽的颜色。
   * （左右没事是因为「横」字那一笔恰好落在整数列上，视觉上确实看得到。）
   *
   * 把路径移到 `x+0.5 / y+0.5`、宽高各减 1 之后，1px 的线正好覆盖
   * 一个整行/整列像素，边缘干净且颜色是满的。
   *
   * 这是像素级的经验：**奇数宽度的线要落在半像素上**。
   */
  private drawBorder(color: number): void {
    const { x, y, w, h } = this.options.rect;
    this.border.clear();
    /** 霸体 ⇒ **彩虹分段**（纯色那条路照旧，两者只在这里分叉）。 */
    if (this.armored) {
      this.drawRainbowBorder();
      return;
    }
    this.border
      .roundRect(x + HALF_PIXEL, y + HALF_PIXEL, w - 1, h - 1, RADIUS)
      .stroke({ color, width: 1 });
  }

  /**
   * **彩虹描边**：把圆角矩形的轮廓切成 `SEGMENTS` 段，每段一个色相。
   *
   * ⚠️ Pixi 的 `stroke()` 只吃纯色 ⇒ 渐变只能这样近似（理由写在
   * `ui/rainbow.ts` 的文件头）。段数取 48：够密（肉眼看不出折线）又够便宜
   * （每条读条每帧最多 48 次 stroke）。
   *
   * ⚠️ 采样点**沿轮廓等距**（按周长比例），不是按边长 —— 否则长短边上的
   * 色彩推进速度不同，看起来像"某一边特别花"。
   */
  private drawRainbowBorder(): void {
    const { x, y, w, h } = this.options.rect;
    const left = x + HALF_PIXEL;
    const top = y + HALF_PIXEL;
    const right = x + w - HALF_PIXEL;
    const bottom = y + h - HALF_PIXEL;
    /** 圆角矩形的周长（四段直线 + 四个四分之一圆）。 */
    const straight = Math.max(0, right - left - 2 * RADIUS) * 2 +
      Math.max(0, bottom - top - 2 * RADIUS) * 2;
    const arcs = 2 * Math.PI * RADIUS;
    const total = Math.max(1, straight + arcs);
    const colors = RAINBOW;
    const pointAt = (t: number): readonly [number, number] => {
      /** 按周长把 `t`(0..1) 映射到轮廓上的一点。走四个边 + 四个圆角。 */
      const arcLen = (Math.PI / 2) * RADIUS;
      const sideH = Math.max(0, right - left - 2 * RADIUS);
      const sideV = Math.max(0, bottom - top - 2 * RADIUS);
      let d = t * total;
      // 上边（左圆角之后）
      if (d <= arcLen) return [left + RADIUS - Math.cos(d / RADIUS) * RADIUS, top + RADIUS - Math.sin(d / RADIUS) * RADIUS];
      d -= arcLen;
      if (d <= sideH) return [left + RADIUS + d, top];
      d -= sideH;
      if (d <= arcLen) return [right - RADIUS + Math.sin(d / RADIUS) * RADIUS, top + RADIUS - Math.cos(d / RADIUS) * RADIUS];
      d -= arcLen;
      if (d <= sideV) return [right, top + RADIUS + d];
      d -= sideV;
      if (d <= arcLen) return [right - RADIUS + Math.cos(d / RADIUS) * RADIUS, bottom - RADIUS + Math.sin(d / RADIUS) * RADIUS];
      d -= arcLen;
      if (d <= sideH) return [right - RADIUS - d, bottom];
      d -= sideH;
      if (d <= arcLen) return [left + RADIUS - Math.sin(d / RADIUS) * RADIUS, bottom - RADIUS + Math.cos(d / RADIUS) * RADIUS];
      d -= arcLen;
      return [left, bottom - RADIUS - d];
    };
    for (let i = 0; i < SEGMENTS; i += 1) {
      const from = pointAt(i / SEGMENTS);
      const to = pointAt((i + 1) / SEGMENTS);
      this.border
        .moveTo(from[0], from[1])
        .lineTo(to[0], to[1])
        .stroke({ color: colors[i] ?? 0xffffff, width: 1 });
    }
  }

  /**
   * 进度 0..1 → **纯色方块从左往右长**。
   *
   * ⚠️ **四周各让 `INSET`(2) px**，这是"看不到上 border"的根因修复。
   *
   * 像素实测（修复前，Boss 读条竖直扫描 @x=400）：
   *   y=74 → `#2a0c0e`（底槽色）
   *   y=75 → `#e8542c`（**填充色**）← 上边框那一行被填充盖住了
   *
   * 原因：填充原先画在 `y+1`、高 `h-2`，而 1px 的描边是**以路径线
   * 为中心**向两侧各铺 0.5px —— 于是 `y+1` 那一行同时属于描边和填充，
   * 填充后画就把它整个盖掉。上下两条边框都被盖，只剩左右可见。
   *
   * 玩家读条看起来只是"有缝隙"，是因为它的填充很短（只占左边一段），
   * 所以上边框在那一段之外还是露出来的 —— 同一个 bug 的两种表现。
   *
   * 让 2px 之后，描边那一行永远属于描边，填充退到它内侧。
   */
  update(progress: number): void {
    const safe = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    /**
     * ⚠️ **换色必须强制重画**：进度没变时下面那行会早退（省重绘），
     * 于是 `setChannel` / `setArmored` 之后要等进度动一下才看得见颜色 ——
     * 表现成"有时候颜色不对"。所以那两个 setter 会把 `lastProgress` 清掉。
     */
    if (!this.dirty && Math.abs(safe - this.lastProgress) < 0.002) return;
    this.dirty = false;
    this.lastProgress = safe;

    const { x, y, w, h } = this.options.rect;
    const innerW = Math.max(0, w - INSET * 2);
    const innerH = Math.max(0, h - INSET * 2);
    const filled = Math.round(innerW * safe);
    this.fillGfx.clear();
    if (filled > 0 && innerH > 0) {
      this.fillGfx
        .rect(x + INSET, y + INSET, filled, innerH)
        .fill({ color: this.channel ? (this.options.channelFill ?? this.options.fill) : this.options.fill, alpha: 1 });
    }
    /**
     * ⚠️ **这里不再重画描边**（2026-10-14 改）。
     *
     * 原先每次 `update()`（= 每帧，读条期间）都调一遍 `drawBorder()`，
     * 本意是"无论填充怎么变，描边都最后画上去"。但那是**用错工具解决
     * 顺序问题**：`this.border` 在 `addChild` 里**本来就排在填充之后**
     * （见构造处），而填充四周各让了 `INSET`(2)px ⇒ 它压不到描边。
     *
     * 代价有多大：霸体读条时 `drawBorder` 会走彩虹分支 ——
     * **每帧 48 次 `stroke` + 48 次色相换算**，两条读条就是每帧 96 次
     * 描边调用。用户直接报的就是这个："**还是有点卡··啊 进度条卡顿**"。
     *
     * ⇒ 现在描边只在**它真的变了**的时候画：构造、`setRect`（缩放 /
     * 换分辨率）、`setArmored`（霸体开关）。进度变化只重画填充。
     */
  }

  /**
   * 改几何与字号（UI 缩放时用）。
   *
   * 三件事必须**一起**做，否则会出现"框变大了、字没变"或"字变大了、
   * 位置还按旧框算"：
   *   1. 记住新的矩形（`update` / `drawBorder` 都读它）
   *   2. 重画底槽与描边
   *   3. 按新矩形重排文字（行内垂直居中，所以 y 也要跟着变）
   */
  setRect(rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, scale: number): void {
    this.options.rect = rect;
    const midY = rect.y + rect.h / 2;
    this.bg.clear();
    this.bg.roundRect(rect.x, rect.y, rect.w, rect.h, RADIUS).fill({ color: this.options.track, alpha: 1 });
    this.drawBorder(this.options.line);
    const nameSize = Math.max(1, Math.round(FONT.warn * scale));
    const timeSize = Math.max(1, Math.round(FONT.body * scale));
    this.nameText.style.fontSize = nameSize;
    this.nameText.x = rect.x + Math.round(12 * scale);
    this.nameText.y = midY;
    this.timeText.style.fontSize = timeSize;
    this.timeText.x = rect.x + rect.w - Math.round(10 * scale);
    this.timeText.y = midY;
    this.tagText.style.fontSize = Math.max(1, Math.round(FONT.small * scale));
    this.tagText.y = midY;
    // 强制下一帧重画填充（几何变了，缓存的进度不再有效）
    this.lastProgress = -1;
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
