/**
 * 战斗背景：夜空 + 远景剪影。
 *
 * 纯 Graphics 绘制，没有任何状态 —— 抽成独立文件是因为它是**一次
 * 性**的静态装饰，和"每帧更新的 HUD"是两类东西。
 */

import type { Graphics } from 'pixi.js';
import { PALETTE } from './theme';
import { LOGICAL } from '../ui/layout';

export function drawBackground(g: Graphics): void {
  g.clear();

  const horizon = 372;

  /* ---- 天空：从近黑到暖褐的竖向渐变（色带模拟） ---- */
  const bands = 26;
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    // 上暗下亮，且下半段更快变亮 —— 视觉重心落在接近地平线处
    const eased = t * t;
    const color = mixColor(PALETTE.bgTop, PALETTE.bgBottom, eased);
    g.rect(0, (horizon * i) / bands, LOGICAL.width, horizon / bands + 1).fill(color);
  }

  /* ---- 月亮：给画面一个焦点，也让角色剪影有背光 ---- */
  g.circle(742, 118, 34).fill({ color: 0xd8c8a8, alpha: 0.1 });
  g.circle(742, 118, 26).fill({ color: 0xe8d8b8, alpha: 0.14 });
  g.circle(742, 118, 18).fill({ color: 0xf0e4c8, alpha: 0.2 });

  /* ---- 远景废墟：**只放两侧**，中间留空给角色 ---- */
  // 塔身用比天空更暗的色，才能读成"远处的黑剪影"而不是灰块
  const spires: Array<[number, number, number]> = [
    [24, 40, 176],
    [84, 22, 232],
    [120, 30, 200],
    [800, 26, 214],
    [860, 44, 158],
    [916, 18, 246],
  ];
  for (const [x, w, top] of spires) {
    g.rect(x, top, w, horizon - top).fill(0x08070c);
    // 塔尖
    g.poly([x - 4, top, x + w / 2, top - 22, x + w + 4, top]).fill(0x08070c);
  }
  // 远处的拱门轮廓（只有边框，暗示有建筑）
  g.rect(150, 244, 78, horizon - 244).stroke({ color: 0x121019, width: 3 });
  g.rect(756, 232, 62, horizon - 232).stroke({ color: 0x121019, width: 3 });

  /* ---- 地表雾：把地平线糊开，避免一条生硬的直线 ---- */
  for (let i = 0; i < 8; i += 1) {
    const t = i / 7;
    g.rect(0, horizon - 18 + i * 5, LOGICAL.width, 6).fill({
      color: mixColor(PALETTE.ground, 0x3a2c34, t),
      alpha: 0.42 - t * 0.3,
    });
  }

  /* ---- 地面 ---- */
  g.rect(0, horizon, LOGICAL.width, LOGICAL.height - horizon).fill(PALETTE.ground);
  // 地面近处更暗（暗角），把角色所在的中景"顶"出来
  g.rect(0, horizon, LOGICAL.width, 26).fill({ color: 0x241a20, alpha: 0.9 });
  g.rect(0, LOGICAL.height - 46, LOGICAL.width, 46).fill({ color: 0x0f0b11, alpha: 0.85 });

  // 地砖透视：近处间距更大
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const x = -40 + t * (LOGICAL.width + 80);
    g.moveTo(x, horizon).lineTo(x + (x - LOGICAL.width / 2) * 0.18, LOGICAL.height);
    g.stroke({ color: 0x241a22, width: 1, alpha: 0.5 });
  }
  for (const y of [horizon + 22, horizon + 54, horizon + 96]) {
    g.moveTo(0, y).lineTo(LOGICAL.width, y);
    g.stroke({ color: 0x241a22, width: 1, alpha: 0.4 });
  }

  /* ---- 顶部压暗：让 HUD 区域与战场分层 ---- */
  g.rect(0, 0, LOGICAL.width, 128).fill({ color: 0x000000, alpha: 0.34 });
}

export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}
