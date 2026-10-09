/**
 * Boss 精灵（程序化占位像素画）。
 *
 * 为什么先程序化绘制而不是一开始就用美术素材：
 *   - 换正式素材时**不改一行引擎代码**（渲染层只认 atlas 的键名）
 *   - 现在这个版本足以验证构图、剪影可读性、预警表现
 *
 * ------------------------------------------------------------------
 * 视觉语言（这几条是玩法需求，不是美术偏好）
 * ------------------------------------------------------------------
 *
 * 1. **前摇必须一眼可读**：读条期间整体加红边光 + 白描边，
 *    而不是"整体染红"——后者会把形体糊成一坨，看不出在打什么。
 * 2. **剪影优先**：填成纯黑还要能认出是个持剑的骑士。
 * 3. 尺寸 144×192（占屏高约 1/3），与 `docs/mockups` 的构图一致。
 */

import type { Container, Graphics } from 'pixi.js';
import { PALETTE } from '../theme';
import type { PixiCtor } from '../../ui/primitives';

/** Boss 精灵的绘制原点：脚底中心。 */
export interface BossViewOptions {
  readonly x: number;
  readonly y: number;
  /** 整体缩放，默认 0.72 */
  readonly scale?: number;
}

/**
 * 一个持剑堕落骑士的剪影。
 *
 * 坐标以"脚底中心"为原点，向上为负 y —— 与场景里的站位语义一致
 * （脚站在地面上）。
 */
export class BossSprite {
  readonly root: Container;
  private readonly body: Graphics;
  private readonly telegraphOverlay: Graphics;
  /** 霸体光晕：多层放大的单色形体叠加，营造柔和的彩色外发光。 */
  private readonly armorLayers: readonly Graphics[] = [];
  private lastTelegraph = false;
  private lastFlash = 0;
  private lastArmored = false;
  /** 描边色相的推进量 —— 让彩边**流动**起来而不是静止的彩虹 */
  private armorPhase = 0;

  constructor(pixi: PixiCtor, options: BossViewOptions) {
    this.root = new pixi.Container();
    this.root.x = options.x;
    this.root.y = options.y;
    /**
     * 整体缩放。绘制定在"原始尺寸"上（便于按像素调形），
     * 由这里统一缩到场景里合适的比例 —— 改比例不用重画。
     */
    this.root.scale.set(options.scale ?? 0.72);

    this.body = new pixi.Graphics();
    this.telegraphOverlay = new pixi.Graphics();
    /**
     * 霸体描边层：**同一组形体再画一遍、整体放大一圈、涂成单色**，
     * 垫在 `body` 底下 —— 于是露出来的那一圈就是描边。
     *
     * 为什么不用手写轮廓路径（我试过，两次都错）：
     *   1. 直接抄前摇描边那几条 `poly` → 它们是**开口折线**、
     *      内部还穿过形体，描边横穿身体。
     *   2. 手写一条闭合轮廓 → 顶点顺序不对外加**自交**，画出个大 X。
     *
     * 这个做法是**零维护**的：`drawBody` 画什么，描边就是什么的轮廓。
     */
    /**
     * 霸体外观：**多层放大的单色形体，从大到小、从透明到不透明**，
     * 叠在 `body` 底下 —— 于是形体四周浮出一圈彩色光晕。
     *
     * ------------------------------------------------------------------
     * 为什么是"光晕"而不是"等宽描边"
     * ------------------------------------------------------------------
     *
     * 我先试了"画一遍放大一圈的形体当描边"，结果**一圈宽窄不一**：
     * 形体的外轮廓**有凹陷**（披风的凹边、两腿之间的空隙、剑与手臂的夹角），
     * 围绕一个中心做均匀缩放时，每个顶点外移的距离正比于它到中心的
     * 距离 —— 凸出的角外移最多，凹陷处几乎不动。所以看起来像
     * "只有一半有彩边"。
     *
     * 真正等宽的描边需要按**法线**偏移多边形外框，那是另一个量级的
     * 工作量（还要处理自交）。而"由大到小叠几层半透明"既避开了这个问题，
     * 视觉上也更像"能量外溢"而不是"描了个边"。
     *
     * 缩放支点必须放在**形体视觉中心**：`scale` 默认绕原点（脚底）
     * 缩放，那样只往右上方扩。
     */
    const armorLayers: Graphics[] = [];
    for (const spec of ARMOR_GLOW_LAYERS) {
      const layer = new pixi.Graphics();
      /**
       * 光晕椭圆**以躯干为中心**，不是以整个形体的包围盒为中心。
       *
       * 踩过的坑：用包围盒中心（含向左伸出的剑）会让椭圆整体偏左下，
       * 光晕跑到人物脚边去。所以单独用 `AURA_CX/CY` 定位 ——
       * 那是躯干 + 头盔的视觉中心。
       */
      layer.pivot.set(0, 0);
      layer.position.set(AURA_CX, AURA_CY);
      layer.scale.set(spec.scale);
      layer.alpha = spec.alpha;
      layer.visible = false;
      layer.ellipse(0, 0, AURA_RX, AURA_RY).fill(0xffffff);
      armorLayers.push(layer);
    }
    this.armorLayers = armorLayers;
    this.root.addChild(...armorLayers, this.body, this.telegraphOverlay);

    this.drawBody();
  }

  /**
   * 画 Boss 的形体。
   *
   * @param target 画到哪个 Graphics（霸体描边层复用同一组形态）
   * @param flatColor 传了就**整体涂成这个颜色**（做放大一圈的描边层）。
   *   实现方式是替换调色板 —— 比给十几个形体各写一遍颜色分支简单得多，
   *   而且以后改形体时**描边会自动跟上**，不会漏。
   */
  private drawBody(target: Graphics = this.body, flatColor?: number): void {
    const g = target;
    const P = flatColor === undefined ? PALETTE : flatPalette(flatColor);
    g.clear();

    // ---- 披风（最底层，形成外轮廓） ----
    g.poly([-46, -8, -22, -60, -10, -104, 0, -132, 10, -104, 22, -60, 46, -8, 34, 0, -34, 0]);
    g.fill(P.bossCloak);
    // 披风暗部（左侧）
    g.poly([-46, -8, -22, -60, -10, -104, 0, -132, 0, 0, -34, 0]);
    g.fill({ color: P.bossCloak, alpha: 0.55 });
    g.poly([-46, -8, -22, -60, -10, -104, 0, -132, 0, 0, -34, 0]);
    g.fill(0x2a0e14);

    // ---- 腿（分离的部件，避免"方块感"） ----
    g.rect(-26, -70, 20, 62).fill(P.bossBodyDark);
    g.rect(6, -70, 20, 62).fill(P.bossBodyDark);
    g.rect(-26, -18, 20, 12).fill(0x1a1620);
    g.rect(6, -18, 20, 12).fill(0x1a1620);
    // 膝甲
    g.rect(-28, -44, 24, 10).fill(P.bossBodyLight);
    g.rect(4, -44, 24, 10).fill(P.bossBodyLight);

    // ---- 躯干 ----
    g.poly([-30, -110, 0, -122, 30, -110, 34, -50, 26, -34, -26, -34, -34, -50]);
    g.fill(P.bossBody);
    // 左半暗部（光源在右上）
    g.poly([-30, -110, 0, -122, 0, -34, -26, -34, -34, -50]);
    g.fill(P.bossBodyDark);
    // 胸甲细节
    g.rect(-16, -100, 32, 8).fill(P.bossBodyLight);
    g.rect(-10, -84, 20, 6).fill(P.bossBodyDark);
    g.rect(-13, -84, 3, 46).fill(0x1a1620);

    // ---- 肩甲（形成关键剪影特征） ----
    g.poly([-34, -114, -18, -122, -14, -100, -32, -92]).fill(P.bossBodyLight);
    g.poly([14, -122, 34, -114, 32, -92, 14, -100]).fill(P.bossBodyLight);
    g.poly([-36, -78, -20, -84, -18, -58, -34, -52]).fill(P.bossBodyDark);
    g.poly([18, -84, 36, -78, 34, -52, 18, -58]).fill(P.bossBodyDark);

    // ---- 头盔 ----
    g.poly([-18, -152, 0, -160, 18, -152, 22, -128, 12, -118, -12, -118, -22, -128]);
    g.fill(P.bossBody);
    g.poly([-18, -152, 0, -160, 0, -118, -12, -118, -22, -128]);
    g.fill(P.bossBodyDark);
    // 颈部
    g.rect(-12, -122, 24, 10).fill(P.bossBodyDark);
    // 角
    g.poly([-20, -150, -30, -186, -20, -190, -10, -152]).fill(0x241f2c);
    g.poly([20, -150, 30, -186, 20, -190, 10, -152]).fill(0x241f2c);
    // 面甲发光缝
    g.rect(-16, -142, 32, 8).fill(0x1a0a08);
    g.rect(-14, -141, 28, 5).fill(P.bossVisor);
    g.rect(-14, -141, 12, 3).fill(0xffc89a);

    // ---- 持剑的手臂（屏幕左侧） ----
    g.rect(-40, -112, 12, 46).fill(P.bossBodyDark);
    g.rect(-42, -68, 16, 10).fill(P.bossBodyLight);
    // 剑（指向左上方，形成强烈的对角线剪影）
    g.poly([-38, -108, -104, -152, -108, -144, -42, -100]).fill(P.bossSword);
    g.poly([-38, -100, -106, -148, -108, -144, -42, -96]).fill(0x6a7280);
    // 护手与柄
    g.rect(-62, -128, 26, 12).fill(0xc4a04a);
    g.rect(-70, -134, 12, 24).fill(0xc4a04a);

    // ---- 右臂 ----
    g.rect(28, -104, 14, 48).fill(P.bossBody);
    g.rect(26, -60, 18, 10).fill(P.bossBodyDark);
  }

  /**
   * 每帧更新表现。
   *
   * @param telegraphing 是否在前摇（读条）
   * @param flash 受击闪白强度 0..1（0 = 不闪）
   * @param armored 是否处于霸体（彩色流动描边）
   */
  update(telegraphing: boolean, flash = 0, armored = false): void {
    // 前摇：白描边 + 红边光（不是整体染红 —— 那样会把形体糊成一坨）
    if (telegraphing !== this.lastTelegraph) {
      this.lastTelegraph = telegraphing;
      const g = this.telegraphOverlay;
      g.clear();
      if (telegraphing) {
        g.poly([-18, -152, 0, -160, 18, -152, 22, -128, 12, -118, -12, -118, -22, -128]);
        g.stroke({ color: 0xff9a78, width: 2 });
        g.poly([-30, -110, 0, -122, 30, -110, 34, -50, 26, -34, -26, -34, -34, -50]);
        g.stroke({ color: 0xff9a78, width: 2 });
        g.poly([-46, -8, -22, -60, -10, -104, 0, -132, 10, -104, 22, -60, 46, -8]);
        g.stroke({ color: 0xff6a4a, width: 2 });
        g.rect(-14, -141, 28, 5).fill(0xffe0c0);
      }
    }

    /**
     * 霸体：**彩色描边**。
     *
     * 需求：Boss 释放霸体招式时人物有彩色描边。
     *
     * 色相每帧缓慢推进（`armorPhase`），于是描边是**流动的彩虹**
     * 而不是一圈静止的彩色 —— 静止的彩边容易被误读为"美术风格"，
     * 流动的才像"某个状态正在生效"。
     *
     * 只在 `armored` 切换或色相变化到可见程度时重绘：
     * 每帧重绘 3 条 `poly` + `stroke` 是明显的开销，而描边本身
     * 只有几十个顶点。
     */
    if (armored) this.armorPhase = (this.armorPhase + 0.02) % 1;
    const hueMoved = armored && Math.abs((this.armorPhase % 0.05) - 0.025) < 0.011;
    if (armored !== this.lastArmored || hueMoved) {
      this.lastArmored = armored;
      this.drawArmorOverlay(armored);
    }

    // 受击闪白：整体提亮（用 tint 比重绘便宜）
    if (Math.abs(flash - this.lastFlash) > 0.02) {
      this.lastFlash = flash;
      this.body.tint = flash > 0 ? mixWhite(flash) : 0xffffff;
    }
  }

  /**
   * 霸体描边：只做**开关 + 换色**。
   *
   * 形态本身在构造时就由 `drawBody(this.armorOverlay, ...)` 画好并放大一圈，
   * 垫在 `body` 下面。所以这里一个顶点都不用碰。
   *
   * 色相每帧缓慢推进 —— 描边是**流动的彩虹**而不是静止的一圈彩色：
   * 静止的彩边容易被读成"美术风格"，流动的才像"某个状态正在生效"。
   */
  private drawArmorOverlay(armored: boolean): void {
    const color = hueToRgb(this.armorPhase);
    for (const layer of this.armorLayers) {
      layer.visible = armored;
      if (armored) layer.tint = color;
    }
  }
}

/** 把 0..1 的强度映射成一个"偏白"的 tint。 */
function mixWhite(amount: number): number {
  const t = Math.min(1, Math.max(0, amount));
  // 基准色 0xffffff 即为不着色；受击时保持白但有轻微冷调，
  // 避免与"前摇红边光"混淆。
  const v = Math.round(0xff * (1 - t * 0.25) + 0xff * t * 0.25);
  const r = v;
  const g = Math.round(v * (1 - t * 0.1));
  const b = Math.round(v * (1 + t * 0.0));
  return (r << 16) | (g << 8) | Math.min(255, b);
}


/**
 * HSL 色相 → RGB（固定高饱和、亮度 0.6）。
 *
 * 只做"彩虹描边"这一个用途，所以不实现完整的 HSL 转换 ——
 * 把饱和度与亮度写死，代码只有几行，也不会有人误用成通用工具。
 */
function hueToRgb(h: number): number {
  const s = 0.85;
  const l = 0.62;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const to255 = (v: number): number => Math.round((v + m) * 255) & 0xff;
  return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}


/**
 * 霸体光晕的层次：由内向外，越来越大 → 越来越透明。
 *
 * ------------------------------------------------------------------
 * 为什么是椭圆光晕，而不是"放大一圈的描边"
 * ------------------------------------------------------------------
 *
 * 需求原文是"人物有彩色描边"。我试了四种做法，前三种都不成立：
 *
 *   1. **手写轮廓路径**（抄前摇描边那几条 `poly`）→ 它们是开口折线、
 *      内部还穿过形体，描边**横穿身体**。
 *   2. **手写闭合轮廓** → 顶点顺序不对外加自交，画出**一个大 X**。
 *   3. **放大重画形体** → 形体是十几个多边形拼的、彼此**有空隙**
 *      （披风凹边、腿间缝、剑与臂的夹角），放大的部分只能从缝里
 *      透出来，**左侧几乎没有光晕**；补一条闭合剪影又出现大三角缺口。
 *
 * 真正等宽的描边需要按**法线**偏移多边形外框（还要处理自交），
 * 那是另一个量级的工作量。而"由内向外叠几层半透明椭圆"：
 *   - 几何上**不可能出错**（椭圆没有自交，也没有空隙）
 *   - 观感上更像"能量场正在生效"，而不是"描了个边"
 *
 * 椭圆大小按形体的包围盒取（x −108..46、y −190..0），
 * 中心即 `BODY_CENTER`。
 */
const ARMOR_GLOW_LAYERS = [
  { scale: 1.0, alpha: 0.34 },
  { scale: 1.12, alpha: 0.22 },
  { scale: 1.26, alpha: 0.12 },
] as const;

/**
 * 光晕椭圆：**以躯干 + 头盔的视觉中心定位**，半轴贴着身形。
 *
 * 不包含向左伸出的剑 —— 否则椭圆会被拉偏，光晕跑到人物脚边。
 */
const AURA_CX = -2;
const AURA_CY = -86;
const AURA_RX = 54;
const AURA_RY = 90;

/**
 * 把调色板整体替换成同一个颜色。
 *
 * 用 `Proxy` 而不是手写一份含全部字段的对象：后者在 `PALETTE`
 * 增加字段时会**静默漏掉**，表现为"描边缺了一块"，很难查。
 * `Proxy` 天然覆盖所有键，包括将来新增的。
 */
function flatPalette(color: number): typeof PALETTE {
  return new Proxy({} as typeof PALETTE, { get: () => color, has: () => true });
}
