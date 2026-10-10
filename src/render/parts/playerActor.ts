/**
 * 玩家角色的**姿态与位移**（防御下沉、闪避横移）。
 *
 * ⚠️ 位移与防御**明显区分**（需求）：防御只有下沉（pose）+ 冷色，
 * 不位移；闪避才横移 —— 两者在余光里也不会混。
 *
 * 状态（`lastPose`）由部件自己持有：它只服务于这一个部件，
 * 放进场景会让"这个字段是谁的"变得含糊。
 */

import type { Container, Graphics } from 'pixi.js';
import { PALETTE } from '../theme';
import { DODGE_PEAK_X } from '../actorLayout';
import type { FrameContext, FramePart } from '../sceneTypes';

/** 玩家角色部件。 */
export class PlayerActorPart implements FramePart {
  readonly name = 'playerActor';

  /**
   * 上一次画的姿态。
   *
   * ⚠️ **初值是 `null`（哨兵），不是 `1`。**
   *
   * 踩过的坑（实测）：原来写 `= 1`，而首帧 `pose` 也是 `1` ——
   * 于是 `pose !== this.lastPose` 为假，**`drawPlayer` 一次都没执行**，
   * `playerAnim` 的绘制指令数为 0、`getBounds()` 全零 ——
   * **玩家在画面上完全看不到**（看起来像"角色没渲染"，其实是从没画过）。
   *
   * 根因是拆分帧部件时把原构造函数里的 `this.drawPlayer(1)`
   * （旧 `BattleScene.ts` 第 205 行）漏掉了，而"初值 = 默认姿态"这个
   * 巧合把漏掉的初始化**静默掩盖**了。
   *
   * 用 `null` 之后首帧必然不等于它，于是必然绘制一次；之后仍然只在
   * 姿态变化时重画（保留原来的缓存意图）。
   */
  private lastPose: number | null = null;

  constructor(
    private readonly playerRoot: Container,
    private readonly playerAnim: Graphics,
  ) {}

  /**
   * 玩家背影。`pose`：1 = 站姿，0.85 = 下沉（防御）。
   *
   * 从 `BattleScene` 搬进来的：它只操作 `playerAnim` 这一个对象，
   * 天然属于"玩家角色"这个部件。
   */
  private drawPlayer(pose: number): void {
    const g = this.playerAnim;
    const P = PALETTE;
    const cx = 300;
    const base = 456 + (1 - pose) * 12;
    const h = 84 * pose;
    g.clear();

    g.poly([cx - 54, base, cx - 30, base - h, cx + 30, base - h, cx + 54, base, cx + 34, base, cx - 34, base]);
    g.fill(P.playerCloak);
    g.poly([cx - 54, base, cx - 30, base - h, cx - 7, base - h, cx - 12, base]);
    g.fill(P.playerCloakDark);
    g.poly([cx - 52, base, cx - 29, base - h - 3, cx - 14, base - h + 5, cx - 36, base]);
    g.fill(P.playerCloakLight);
    g.poly([cx + 52, base, cx + 29, base - h - 3, cx + 14, base - h + 5, cx + 36, base]);
    g.fill(P.playerCloakLight);
    g.ellipse(cx, base - h - 14, 16, 17).fill(0x1a2036);
    g.ellipse(cx, base - h - 13, 13, 14).fill(0x2a3450);
    g.poly([cx + 40, base - 5, cx + 71, base - 92, cx + 80, base - 88, cx + 49, base + 3]);
    g.fill(0x8a90a0);
    g.poly([cx + 44, base - 8, cx + 68, base - 87, cx + 74, base - 84, cx + 48, base + 1]);
    g.fill(0xb8bcc8);
    g.rect(cx + 34, base - 11, 18, 12).fill(0xa8863c);
  }

  render(ctx: FrameContext): void {
    const buffs = ctx.view.player.buffs;
    const dodging = buffs.some((b) => b.id.startsWith('dodge') && b.remainingMs > 0);
    const guarding = buffs.some((b) => b.id.startsWith('guard') && b.remainingMs > 0);
    /**
     * 姿态下沉**只给防御**（需求："闪避的动画不要变矮了"）。
     *
     * 原先闪避和防御共用 `pose = 0.85`。但区分两者的手段已经够了：
     * 闪避是**横向位移**、防御是**下沉 + 冷色**。再让闪避也变矮，
     * 两者就只剩颜色差异，在余光里反而不好分。
     */
    const pose = guarding ? 0.85 : 1;
    if (pose !== this.lastPose) {
      this.lastPose = pose;
      this.drawPlayer(pose);
    }

    this.playerAnim.tint = dodging ? 0x9ad8ff : guarding ? 0xc8d0e8 : 0xffffff;

    const dodge = buffs.find((b) => b.id.startsWith('dodge') && b.remainingMs > 0);
    if (!dodge) {
      this.playerRoot.x = 0;
      return;
    }
    const total = Math.max(1, dodge.durationMs);
    const progress = 1 - Math.min(1, dodge.remainingMs / total);
    // 三角波：0 → 1 → 0
    const wave = 1 - Math.abs(progress * 2 - 1);
    this.playerRoot.x = Math.round(DODGE_PEAK_X * wave);
  }
}
