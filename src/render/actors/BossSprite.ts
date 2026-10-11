/**
 * Boss 形象：正式素材（帧动画）为主、程序化占位为回退。
 *
 * ==================================================================
 * 为什么程序化绘制被拆到 `bossPlaceholder.ts`
 * ==================================================================
 *
 * 素材就位后它只剩"素材没就绪时保证画面有东西"这一个职责，而它的
 * 绘制代码有 100 多行。留在本文件会让这里同时承担"帧动画 + 占位形体"，
 * 离 700 行上限（AGENTS.md §3）只剩几十行余量 —— 下次改 Boss 就得先拆。
 *
 * ==================================================================
 * 前摇 / 霸体的表达在**贴图**模式下必须换一套几何
 * ==================================================================
 *
 * 程序化形象知道自己的轮廓（一串写死的 `poly`），所以前摇可以**沿轮廓**
 * 描红边。贴图没有轮廓可描，于是改成：
 *
 * | 状态 | 贴图模式 | 程序化模式 |
 * |---|---|---|
 * | 前摇 | 素材包围盒描一圈红边 | 沿形体的三条 `poly` 描边 |
 * | 霸体 | 按素材尺寸放的彩色椭圆光晕（三层） | 按固定包围盒放同样的光晕 |
 *
 * ⚠️ 两者都由 `frameRect()` 统一给出**当前形象的包围盒**（脚底中心为
 * 原点），所以换素材、换缩放都不用改这些几何 —— 抄数字必然在换素材时错位。
 *
 * ==================================================================
 * 动画挂在**读条**上（玩家拍板）
 * ==================================================================
 *
 * 原话："**读条时间 = 播放时长，无论原来动作多少帧，都在读条时间内播完。**"
 * 所以这里只把 `view.boss.cast` 转交给 `ActorSprite`（帧号由进度推导），
 * 本文件**不判断"这是不是攻击技能"** —— 引擎只在 `castTime > 0` 时建
 * cast 记录，那条规则在数据与引擎侧就已经成立。
 */

import type { Container, Graphics } from 'pixi.js';
import type { PixiCtor } from '../../ui/primitives';
import { IDLE_FEEDBACK, type FeedbackState } from '../feedback';
import type { FrameContext } from '../sceneTypes';
import { spriteFor } from '../spriteAssets';
import { ActorSprite } from './ActorSprite';
import { PLACEHOLDER_SCALE, drawBossBody, mixWhite } from './bossPlaceholder';

/** Boss 精灵的绘制原点：脚底中心。 */
export interface BossViewOptions {
  readonly x: number;
  readonly y: number;
  /** 初始形象（进战斗时由 `setCharacter` 设置） */
  readonly id?: string;
}

/**
 * Boss 形象（素材 / 程序化）在战场上的一体。
 *
 * 坐标以"脚底中心"为原点，向上为负 y —— 与场景里的站位语义一致
 * （脚站在地面上）。
 */
export class BossSprite {
  readonly name = 'bossActor';
  readonly root: Container;
  /** 基准位置 —— 受击反馈是**叠加**在它之上的偏移，所以要先记住。 */
  private readonly baseX: number;
  private readonly body: Graphics;
  private actor: ActorSprite | undefined;
  private lastFlash = 0;

  constructor(private readonly pixi: PixiCtor, options: BossViewOptions) {
    this.root = new pixi.Container();
    this.baseX = options.x;
    this.root.x = options.x;
    this.root.y = options.y;

    this.body = new pixi.Graphics();
    /**
     * ⚠️ 程序化形体自己按 `PLACEHOLDER_SCALE` 缩（与素材的 ≈140 高对齐）。
     * 缩放放在 `body` 上而不是 `root` 上：`root` 只承担受击挤压，
     * 素材贴图的缩放则由 `ActorSprite` 按素材表的 `size` 负责 ——
     * 两套缩放混在 `root` 上一定会互相污染（乘两次）。
     */
    this.body.scale.set(PLACEHOLDER_SCALE);
    this.root.addChild(this.body);

    drawBossBody(this.body);
    if (options.id !== undefined) this.setCharacter(options.id);
  }

  /**
   * 换 Boss 形象（进战斗 / 重开时调用）。
   *
   * ⚠️ **先把上一个形象拆掉**。
   *
   * 原先这里只写 `this.actor = new ActorSprite(...)` —— 而 `ActorSprite`
   * 在构造时就把自己挂进了 `this.root`，所以**旧的仍然留在场景里**：
   * 第二把开始画面上就有两套 Boss 形象叠着（"谍影"），而且每重开一次
   * 多留一套（也是资源泄漏）。玩家原话："第一把是好的，按 enter 开
   * 第二把 就谍影了"。
   *
   * ⚠️ 拆掉旧的**不会出现空画面**：新素材加载完成前 `actor.ready` 为假，
   * 程序化形体 `body` 仍然可见 —— "任何时刻都要有可见的东西"那条不变。
   */
  setCharacter(id: string): void {
    const source = spriteFor(id);
    if (source === undefined) return;
    this.actor?.dispose();
    /**
     * ⚠️ 最后一个参数 `-1` = **水平镜像**：Boss 现在在**左边**，而素材
     * 是按"敌人在右、朝左"画的 —— 不镜像就会**背对玩家**。
     */
    this.actor = new ActorSprite(
      { Container: this.pixi.Container, Sprite: this.pixi.Sprite },
      this.root,
      source,
      -1,
    );
  }

  /** 帧部件入口：从快照取 Boss 形象需要的字段（见 `FrameContext`）。 */
  render(ctx: FrameContext): void {
    const { view } = ctx;
    this.update(
      view.bossFlash,
      view.boss.feedback,
      view.boss.cast,
      view.tick,
      view.status !== 'running',
    );
  }

  /**
   * 每帧更新表现。
   *
   * @param flash 受击闪白强度 0..1（0 = 不闪）
   * @param feedback 受击反馈（位移 + 挤压）
   * @param cast 读条视图（**动画的唯一驱动**：有读条播 attack、没有播 idle）
   * @param tick 引擎 tick（驱动 idle 循环与淡出）
   * @param battleOver 战斗已结束 —— 那时 tick 不再推进，淡出必须直接收起
   */
  update(
    flash = 0,
    /**
     * 受击反馈（与玩家**共用同一套通道**，见 `render/feedback.ts`）。
     *
     * ⚠️ 与 `flash` 分工：`flash` 是**提亮**（原有），`feedback` 提供
     * **位移 + 挤压**。两者都保留是因为提亮已经在用了，而"被打退一步"
     * 与"被打扁一下"是新的、更重的信息。
     */
    feedback: FeedbackState = IDLE_FEEDBACK,
    cast: { readonly progress: number } | undefined = undefined,
    tick = 0,
    battleOver = false,
  ): void {
    /**
     * 贴图：按读条选帧 → 就绪就把程序化形体藏起来。
     * ⚠️ 藏的是 `body`，**不销毁** —— 素材万一在运行期被删还能退回去。
     */
    const actor = this.actor;
    if (actor !== undefined) {
      actor.show(tick, cast, battleOver);
      if (actor.ready) this.body.visible = false;
    }

    /**
     * ==================================================================
     * ⚠️ 前摇描边与霸体光晕已**移除**（玩家要求："包围盒 和 椭圆光晕都先删了"）
     * ==================================================================
     *
     * 原因是它们在**贴图模式下不好看**：
     *   - 前摇描边只能画成**包围盒矩形**（素材没有轮廓可沿，硬编码轮廓
     *     必然在换素材时错位）—— 一个框住角色的方框
     *   - 霸体光晕是三层放大椭圆，贴在素材上像"叠了一层脏东西"
     *
     * 需求"Boss 释放霸体招式时人物有彩色描边"**暂时没有实现**。
     * 留两条线索给以后要做的人（这两条是当初试出来的坑）：
     *   1. 直接抄程序化前摇那几条 `poly` 当贴图描边 → 它们是**开口折线**、
     *      内部还穿过形体，描边会横穿身体
     *   2. "把形体放大一圈再画一遍"当等宽描边 → 外轮廓**有凹陷**时
     *      各顶点外移距离正比于到中心的距离，一圈宽窄不一
     *   3. 贴图要跟随动作的话，可行方向是**把当前帧的纹理按 8 个方向
     *      偏移复制若干份、染成描边色、垫在本体下面** —— 纹理每帧跟着
     *      换，描边自然跟随动作，且是沿轮廓的
     *
     * ⚠️ 霸体**状态本身没有丢失**：读条秒数的颜色仍然区分
     * "可打断（青绿）/ 霸体（青蓝）"，见 `viewModel.telegraphHint`。
     */
    // 受击闪白：整体提亮（用 tint 比重绘便宜），贴图走同一个值
    const tint = flash > 0 ? mixWhite(flash) : 0xffffff;
    if (Math.abs(flash - this.lastFlash) > 0.02) {
      this.lastFlash = flash;
      this.body.tint = tint;
    }
    if (actor !== undefined) actor.apply({ tint, squashY: feedback.squashY });

    /**
     * **受击位移 + 挤压**（统一反馈的"位/形"通道）。
     *
     * ⚠️ 位移取**负**：Boss 现在在**左**边，所以受击是**向左**退
     * （背离右边的玩家）。与玩家的反冲方向相反 —— 这才是"沿受力方向退"，
     * 不是"都往一边"。站位互换前这里是取正的。
     */
    const baseX = this.baseX;
    this.root.x = Math.round(baseX - feedback.recoilX);
    this.root.scale.set(1, feedback.squashY);
  }
}
