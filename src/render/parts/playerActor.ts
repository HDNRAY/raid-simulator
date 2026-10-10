/**
 * 玩家角色的**姿态与位移**（防御下沉、闪避横移）。
 *
 * ⚠️ 位移与防御**明显区分**（需求）：防御只有下沉（pose）+ 冷色，
 * 不位移；闪避才横移 —— 两者在余光里也不会混。
 *
 * 状态（`lastPose`）由部件自己持有：它只服务于这一个部件，
 * 放进场景会让"这个字段是谁的"变得含糊。
 */

import { Assets, Sprite, type Container, type Graphics, type Texture } from 'pixi.js';
import { PALETTE } from '../theme';
import { DODGE_PEAK_X } from '../actorLayout';
import type { FrameContext, FramePart } from '../sceneTypes';

/**
 * 玩家"站立"的基准点 —— **与程序化绘制同一组数字**（`drawPlayer` 里的
 * `cx = 300` / `base = 456`）。贴图与图形必须落在同一位置，否则切换
 * 形象时会看到角色"跳"一下。
 */
const PLAYER_CX = 300;
const PLAYER_BASE_Y = 456;
/**
 * 贴图缩放。
 *
 * 原图 202×232，而程序化玩家大约 134×105（`getBounds` 实测）。
 * 0.42 让贴图高度约 97px，与原来同量级 —— 太大就会挡住 Boss。
 */
const SPRITE_SCALE = 0.42;
/**
 * 贴图路径。
 *
 * ⚠️ 在 `placeholder/` 下 —— 那是**不可分发的本地占位素材**（见该目录的
 * README 与 `.gitignore`）。换成正式美术时只改这一个常量。
 */
const SPRITE_URL = '/placeholder/player-fd2-mirrored.png';

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


  /**
   * 贴图版玩家（有纹理时用它；没有时回退到程序化绘制）。
   *
   * ⚠️ **纹理是异步加载的**，所以 `playerAnim`（程序化）必须留着当回退
   * —— 否则加载完成之前会什么都不画。这正是"玩家看不到"那个 bug 的
   * 同类：**任何时刻都必须有一份可见的东西**。
   */
  private sprite: Sprite | undefined;

  constructor(
    private readonly playerRoot: Container,
    private readonly playerAnim: Graphics,
    /**
     * 是否异步加载贴图形象。
     *
     * ⚠️ 默认 `false`：测试与无贴图环境（线上没有 `placeholder/` 里的
     * 占位素材）都该走程序化绘制 —— 那不会发起任何网络请求。
     */
    loadTexture = false,
  ) {
    if (loadTexture) this.loadSprite();
  }

  /**
   * **加载贴图形象（异步）**。
   *
   * ⚠️ 必须容错：拿不到纹理时**保留程序化绘制**，而不是画一片空白
   * （那就是"玩家看不到"那个 bug 的同类 —— 任何时刻都要有可见的东西）。
   * ⚠️ 贴图在 `public/placeholder/`（**不可分发的本地占位素材**，
   * 已 gitignore），所以线上构建里不存在 —— 那时回退就是唯一显示。
   */
  private loadSprite(): void {
    void Assets.load<Texture>(SPRITE_URL)
      .then((texture) => {
        this.setTexture(texture);
      })
      .catch(() => {
        // 故意吞掉：没有贴图是**预期**情况，程序化回退已就位
      });
  }

  /** 换成贴图形象（纹理就绪后调用；程序化图形隐藏但**不销毁**）。 */
  setTexture(texture: Texture): void {
    if (this.sprite === undefined) {
      this.sprite = new Sprite(texture);
      /**
       * 锚点放**底部中心**：玩家"站在"基地线上，缩放/下沉都绕脚下，
       * 与程序化绘制的 `base` 语义一致。
       */
      this.sprite.anchor.set(0.5, 1);
      this.sprite.x = PLAYER_CX;
      this.sprite.y = PLAYER_BASE_Y;
      this.sprite.scale.set(SPRITE_SCALE);
      this.playerRoot.addChild(this.sprite);
    } else {
      this.sprite.texture = texture;
    }
    this.playerAnim.visible = false;
  }

  /**
   * 玩家背影。`pose`：1 = 站姿，0.85 = 下沉（防御）。
   *
   * 从 `BattleScene` 搬进来的：它只操作 `playerAnim` 这一个对象，
   * 天然属于"玩家角色"这个部件。
   */
  private drawPlayer(pose: number): void {
    const g = this.playerAnim;
    const P = PALETTE;
    const cx = PLAYER_CX;
    const base = PLAYER_BASE_Y + (1 - pose) * 12;
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

    const fb = ctx.view.player.feedback;
    /**
     * **受击反馈**（统一四通道里的色 + 形 + 位）。
     *
     * ⚠️ 优先级：受击 > 防御 > 闪避。受击是**瞬间**事件，必须压过
     * 持续状态，否则"防御中被打"会看不出被打。
     */
    const hit = fb.recoilX !== 0 || fb.squashY !== 1;
    const tint = hit
      ? 0xffd0d0
      : dodging
        ? 0x9ad8ff
        : guarding
          ? 0xc8d0e8
          : 0xffffff;
    this.playerAnim.tint = tint;
    /**
     * 贴图走**同一套反馈**：
     *   - 着色与程序化一致（闪避偏蓝、防御偏冷）
     *   - 防御的"下沉"用**纵向压缩**表达（贴图锚点在脚下，压 scale.y
     *     就是"矮下去"）—— 与程序化那边 `base` 下移 12px 是同一个意思
     */
    if (this.sprite !== undefined) {
      this.sprite.tint = tint;
      // 受击的挤压**叠在**防御的下沉上（两者可以同时发生）
      this.sprite.scale.set(SPRITE_SCALE, SPRITE_SCALE * pose * fb.squashY);
    }

    const dodge = buffs.find((b) => b.id.startsWith('dodge') && b.remainingMs > 0);
    /**
     * 位移 = 闪避位移 + **受击反冲**。
     *
     * ⚠️ 两者可以同时发生（闪避中被打），所以是**相加**而不是二选一 ——
     * 这也是"四通道"设计的好处：通道之间不抢彼此。
     * 反冲方向取负（被打是**向后**退，而闪避是向右冲）。
     */
    let base = 0;
    if (dodge !== undefined) {
      const total = Math.max(1, dodge.durationMs);
      const progress = 1 - Math.min(1, dodge.remainingMs / total);
      // 三角波：0 → 1 → 0
      base = DODGE_PEAK_X * (1 - Math.abs(progress * 2 - 1));
    }
    this.playerRoot.x = Math.round(base - fb.recoilX);
  }
}
