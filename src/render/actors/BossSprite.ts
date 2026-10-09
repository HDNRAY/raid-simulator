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
  private lastTelegraph = false;
  private lastFlash = 0;

  constructor(pixi: PixiCtor, options: BossViewOptions) {
    this.root = new pixi.Container();
    this.root.x = options.x;
    this.root.y = options.y;

    this.body = new pixi.Graphics();
    this.telegraphOverlay = new pixi.Graphics();
    this.root.addChild(this.body, this.telegraphOverlay);

    this.drawBody();
  }

  private drawBody(): void {
    const g = this.body;
    const P = PALETTE;
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
   */
  update(telegraphing: boolean, flash = 0): void {
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

    // 受击闪白：整体提亮（用 tint 比重绘便宜）
    if (Math.abs(flash - this.lastFlash) > 0.02) {
      this.lastFlash = flash;
      this.body.tint = flash > 0 ? mixWhite(flash) : 0xffffff;
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
