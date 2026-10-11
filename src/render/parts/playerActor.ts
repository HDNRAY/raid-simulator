/**
 * 玩家角色的**形象与姿态**（帧动画 + 防御下沉、闪避横移）。
 *
 * ==================================================================
 * 形象现在有两套：正式素材 / 程序化回退
 * ==================================================================
 *
 * 需求："无论角色还是 boss，我都希望加载 完整的 idle 和 attack 的动画"。
 *
 * | 状态 | 画什么 |
 * |---|---|
 * | 素材帧还没就绪（加载中 / 加载失败 / 测试环境） | 程序化绘制（下面 `drawPlayer`） |
 * | 素材就绪 | 贴图（`ActorSprite`），程序化图形隐藏但**不销毁** |
 *
 * ⚠️ **任何时刻都必须有一份可见的东西**：纹理是异步加载的，加载完成
 * 之前如果只画贴图，玩家会看到"角色不见了"。这条踩过坑 —— 见
 * `git log` 里"玩家的人物都看不到了"那次（根因是初始化被漏掉，
 * 而"初值 = 默认姿态"的巧合静默掩盖了它）。
 *
 * ⚠️ 位移与防御**明显区分**（需求）：防御只有下沉（pose）+ 冷色，
 * 不位移；闪避才横移 —— 两者在余光里也不会混。
 *
 * 状态（`lastPose`）由部件自己持有：它只服务于这一个部件，
 * 放进场景会让"这个字段是谁的"变得含糊。
 */

import { Container, Sprite, type Graphics } from 'pixi.js';
import { PALETTE } from '../theme';
import { ACTOR_POS, DODGE_PEAK_X } from '../actorLayout';
import { ActorSprite, type ActorSpriteFrame } from '../actors/ActorSprite';
import { spriteFor } from '../spriteAssets';
import type { FrameContext, FramePart } from '../sceneTypes';

/**
 * 玩家"站立"的基准点 —— **与程序化绘制同一组数字**（`drawPlayer` 里的
 * `cx` / `base`）。贴图与图形必须落在同一位置，否则切换形象时会看到
 * 角色"跳"一下。
 *
 * ⚠️ 值本身在 `actorLayout.ts` 的 `ACTOR_POS.player` —— 那里是布局知识的
 * **唯一真相**（闪避幅度的推算也要读它）。这里只取个短名字，
 * **不要**改回字面量：那会变成两份真相，改一处忘一处。
 */
const { x: PLAYER_CX, y: PLAYER_BASE_Y } = ACTOR_POS.player;

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
   * 正式素材（帧动画）；`undefined` = 还没选定角色 / 没有对应素材。
   *
   * ⚠️ 由 `setCharacter()` 建，不在构造里建：角色是**进战斗时**才知道的
   * （备战界面选完才有 id），而构造时还不知道。
   */
  private actor: ActorSprite | undefined;

  constructor(
    private readonly playerRoot: Container,
    private readonly playerAnim: Graphics,
    /**
     * 是否异步加载贴图形象。
     *
     * ⚠️ 默认 `false`：测试与无素材环境都该走程序化绘制 ——
     * 那不会发起任何网络请求，也就不依赖 jsdom 里的 `Assets`。
     */
    loadTexture = false,
  ) {
    this.loadTextures = loadTexture;
  }

  /** 是否允许发起素材加载（构造参数存下来，`setCharacter` 时用）。 */
  private readonly loadTextures: boolean;

  /**
   * 换角色形象（进战斗 / 重开时调用）。
   *
   * ⚠️ 传入**出战单位的 id**（`data/roster.ts`），不是素材 slot ——
   * id → slot 的映射在 `spriteAssets.ts`，一处维护。
   * 不认识的 id 直接**保持程序化绘制**（不报错、不留空白）。
   *
   * ⚠️ **先把上一个形象拆掉** —— `ActorSprite` 构造时会把自己挂进
   * `playerRoot`，只换引用的话旧的会留在场景里，第二把就有两套人物
   * 叠着（"谍影"）。与 `BossSprite.setCharacter` 是同一个坑。
   */
  setCharacter(id: string): void {
    if (!this.loadTextures) return;
    const source = spriteFor(id);
    if (source === undefined) return;
    this.actor?.dispose();
    /**
     * ⚠️ 最后一个参数 `-1` = **水平镜像**。玩家现在在**右边**，而素材
     * 是按"玩家在左、朝右"画的 —— 不镜像就会**背对 Boss**。
     */
    this.actor = new ActorSprite({ Container, Sprite }, this.playerRoot, source, -1);
    this.actor.root.x = PLAYER_CX;
    this.actor.root.y = PLAYER_BASE_Y;
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
     *
     * ⚠️ 动画的驱动是**读条**（`view.player.cast`），不是"刚放了招式"
     * 那种电平信号：玩家拍板的规则是"读条时间 = 播放时长"
     * （见 `spriteAnim.ts`）。瞬发技能（`castTime === 0`）没有 cast
     * 记录 → 保持 idle，那是引擎侧就成立的事实，这里不用特判。
     *
     * ⚠️ 顺序：先 `show`（选帧、可能刚好就绪）再读 `ready`。刚就绪的
     * 那一帧就要把程序化图形藏掉，否则两者会**同时可见**（叠影）。
     */
    const actor = this.actor;
    if (actor !== undefined) {
      actor.show(ctx.view.tick, ctx.view.player.cast, ctx.view.status !== 'running');
      if (actor.ready) this.playerAnim.visible = false;
      const frame: ActorSpriteFrame = { tint, squashY: pose * fb.squashY };
      actor.apply(frame);
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
    /**
     * ⚠️ 号从**减**改成了**加**：玩家现在在**右边**，被打是向右退
     * （背离左边的 Boss）。与 `BossSprite` 那边正好相反。
     */
    this.playerRoot.x = Math.round(base + fb.recoilX);
  }
}
