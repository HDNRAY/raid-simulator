/**
 * Boss 的**程序化占位形象**（持剑堕落骑士）+ 霸体光晕。
 *
 * ==================================================================
 * 为什么它被拆出来（而不是留在 `BossSprite.ts` 里）
 * ==================================================================
 *
 * 正式素材（`public/fd2/rgba/boss-*`）就位后，程序化形象**不再是主路径**，
 * 它只剩一个职责：**素材还没加载完 / 加载失败**时保证画面上有东西
 * （"任何时刻都必须有一份可见的东西" —— 这条踩过坑，见
 * `parts/playerActor.ts` 里"玩家完全看不到"的记录）。
 *
 * 把它留在 `BossSprite` 里会让那个文件同时承担两件事（占位形体 +
 * 帧动画），而本仓库有"单文件 ≤ 700 行"的硬约束（AGENTS.md §3）。
 * 拆出来的另一个好处：将来真的删掉占位形象时，删这一个文件 +
 * `BossSprite` 里几行调用即可，不用在几百行绘制代码里挑。
 *
 * ==================================================================
 * 视觉语言（这几条是玩法需求，不是美术偏好）
 * ==================================================================
 *
 * 1. **前摇必须一眼可读**：读条期间整体加红边光 + 白描边，
 *    而不是"整体染红"——后者会把形体糊成一坨，看不出在打什么。
 * 2. **剪影优先**：填成纯黑还要能认出是个持剑的骑士。
 * 3. 尺寸 144×192（占屏高约 1/3），与 `docs/mockups` 的构图一致。
 */

import type { Graphics } from 'pixi.js';
import { PALETTE } from '../theme';

/**
 * 一个持剑堕落骑士的剪影。
 *
 * 坐标以"脚底中心"为原点，向上为负 y —— 与场景里的站位语义一致
 * （脚站在地面上）。
 *
 * @param target 画到哪个 Graphics
 * @param flatColor 传了就**整体涂成这个颜色**（做单色光晕层）。
 *   实现方式是替换调色板 —— 比给十几个形体各写一遍颜色分支简单得多，
 *   而且以后改形体时**描边会自动跟上**，不会漏。
 */
export function drawBossBody(target: Graphics, flatColor?: number): void {
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
 * 程序化占位形象的**缩放**。
 *
 * 素材走 `spriteAssets.ts` 的逐个体 `size`（≈0.9–1.1），而这个形体的
 * 原始高度是 190 —— 不缩就比素材大一圈，换形象那一下会"跳"。
 * 0.72 是它历史上的取值：190 × 0.72 ≈ 137，与素材的 ≈140 对得上。
 */
export const PLACEHOLDER_SCALE = 0.72;

/**
 * 程序化占位形体的包围盒（**未缩放**；脚底中心为原点）。
 *
 * x −108..46、y −190..0 —— 与 `drawBossBody` 里的顶点一致。
 * 用它的地方都要乘 `PLACEHOLDER_SCALE`（形体自己是按这个比例画的）。
 */
export const PLACEHOLDER_BOX = { left: -108, right: 46, top: -190, bottom: 0 } as const;

/**
 * 把调色板整体替换成同一个颜色。
 *
 * 用 `Proxy` 而不是手写一份含全部字段的对象：后者在 `PALETTE`
 * 增加字段时会**静默漏掉**，表现为"描边缺了一块"，很难查。
 * `Proxy` 天然覆盖所有键，包括将来新增的。
 */
export function flatPalette(color: number): typeof PALETTE {
  return new Proxy({} as typeof PALETTE, { get: () => color, has: () => true });
}

/** 把 0..1 的强度映射成一个"偏白"的 tint。 */
export function mixWhite(amount: number): number {
  const t = Math.min(1, Math.max(0, amount));
  // 基准色 0xffffff 即为不着色；受击时保持白但有轻微冷调，
  // 避免与"前摇红边光"混淆。
  const v = Math.round(0xff * (1 - t * 0.25) + 0xff * t * 0.25);
  const r = v;
  const g = Math.round(v * (1 - t * 0.1));
  const b = Math.round(v * (1 + t * 0.0));
  return (r << 16) | (g << 8) | Math.min(255, b);
}
