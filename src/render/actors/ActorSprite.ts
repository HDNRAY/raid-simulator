/**
 * **一个会播帧动画的角色贴图**（玩家与 Boss 共用）。
 *
 * ==================================================================
 * 它只做一件事：把快照里的"读条状态"翻译成一帧纹理
 * ==================================================================
 *
 * 规则由玩家拍板（原话）："**读条时间 = 播放时长，无论原来动作多少帧，
 * 都在读条时间内播完。这样美术就没有影响之前的交互。**"
 *
 * | 快照 | 画什么 |
 * |---|---|
 * | `cast` 存在（该单位正在读条） | **attack** 段，帧号 = `cast.progress` 按 delay 加权 |
 * | `cast` 不存在 | **idle** 段，按引擎 tick 循环 |
 * | 读条刚消失（被打断 / 打完） | idle 打底，attack **约 0.1 秒淡出**（裸切太突兀） |
 *
 * ⚠️ 判据是 `cast`（"这个单位**正在读条**"），**不是**"刚放了攻击招式"
 * 那种电平信号 —— 后者与读条长短无关，做不出"读条时间 = 播放时长"。
 * `castTime === 0` 的技能不进 `casts`（引擎侧 `castPipeline` 只在
 * `castTimeMs > 0` 时建 cast 记录），所以"瞬发不播 attack、保持 idle"
 * 是**自动**成立的，不需要在这里特判。
 *
 * ==================================================================
 * 三层分工（这一层只管 Pixi，不管规则）
 * ==================================================================
 *
 * | 层 | 文件 | 职责 |
 * |---|---|---|
 * | 帧选择规则 | `spriteAnim.ts` | 进度 → 帧号（纯函数，可单测） |
 * | 数据 | `spriteAssets.ts` | 谁用哪套帧、每帧权重、多大 |
 * | **Pixi** | **本文件** | 加载、切纹理、着色、挤压、淡出 |
 *
 * ==================================================================
 * ⚠️ 两种状态，别把"还没加载完"当成"加载失败"
 * ==================================================================
 *
 * | 状态 | `phase` | 画面上 |
 * |---|---|---|
 * | 还没加载完 / 加载失败 | `'none'` | 调用方的程序化绘制顶着（**必须有**） |
 * | idle 段**每一帧**都拿到了 | `'ready'` | 贴图（程序化图形隐藏、但不销毁） |
 *
 * 判据是"idle 段的帧数与素材表一致"，不是"拿到了至少一张" ——
 * 后者在**只加载到第一帧**时就会切成贴图，表现是"人物永远静止"
 * （后面几帧全是 undefined，被静默跳过）。攻击段要等 idle 就绪之后
 * 才允许用，否则会出现"只有攻击帧"的中间态。
 */

import { Assets, Sprite, type Container, type Texture } from 'pixi.js';
import { animUrls, type CharacterSprite } from '../spriteAssets';
import { frameAtProgress, loopProgress, type FrameWeights } from '../spriteAnim';

/**
 * **这一帧该画哪一段、第几帧**（纯函数，单测直接测它）。
 *
 * 判据顺序：
 * 1. **有读条** ⇒ 攻击段按 `cast.progress` 播（原行为）
 * 2. **按住型技能在施放**（`holding`）⇒ 攻击段**循环**播（"一直用攻击帧" ✓）
 * 3. 都没有 ⇒ idle（调用方负责把攻击段淡出）
 */
export function actorPoseOf(input: {
  readonly tick: number;
  readonly cast: { readonly progress: number } | undefined;
  readonly holding: boolean;
  /** 攻击段的帧权重（`FrameWeights`，与 `frameAtProgress` 同一个输入）。 */
  readonly attack: FrameWeights;
}): { readonly pool: 'idle' | 'attack'; readonly index: number } {
  if (input.attack.length > 0) {
    if (input.cast !== undefined) {
      return { pool: 'attack', index: frameAtProgress(input.attack, input.cast.progress) };
    }
    if (input.holding) {
      /** 循环：按住多久就一直播，看起来是"持续施法"而不是定格 ✓ */
      return { pool: 'attack', index: frameAtProgress(input.attack, loopProgress(input.attack, input.tick)) };
    }
  }
  return { pool: 'idle', index: 0 };
}

/** 一张贴图的加载状态。 */
export type SpritePhase = 'none' | 'ready';

/**
 * 建贴图对象要的那两个构造器。
 *
 * 与 `ui/primitives.ts` 的 `PixiCtor` 是同一个依赖注入缝的窄版本 ——
 * 这里只要 Container 与 Sprite，写窄一点，测试塞假实现更容易。
 */
export interface SpriteCtors {
  readonly Container: typeof Container;
  readonly Sprite: typeof Sprite;
}

/**
 * 读条被打断（或打完）之后，attack 段淡出多少 tick。
 *
 * 6 tick ≈ 0.1 秒。⚠️ 这是**唯一的"过渡状态"**，它读 `view.tick`
 * （快照里的引擎时间），不是自己攒计时器 —— 同一 tick 反复调用结果相同。
 */
export const CAST_FADE_TICKS = 6;

/** 一帧的反馈通道（见 `render/feedback.ts`）。 */
export interface ActorSpriteFrame {
  /** 着色（白 = 不着色）。与程序化绘制那边用同一个值。 */
  readonly tint: number;
  /** 纵向压缩系数（1 = 不变；防御下沉 / 受击挤压都用它）。 */
  readonly squashY: number;
}

/** 默认帧：不着色、不挤压。 */
export const IDLE_ACTOR_FRAME: ActorSpriteFrame = { tint: 0xffffff, squashY: 1 };

/**
 * 一个贴图角色的**渲染器**。
 *
 * 调用方负责：
 *   - 把 `root` 挂到场景里、摆好位置（`root` 的原点 = 脚底中心）
 *   - 在 `ready === false` 时**自己**画一份占位形象
 *   - 每帧调 `show`（选段选帧）与 `apply`（着色 / 挤压）——
 *     分成两个方法是因为调用方要在 `show` 之后读 `ready`
 *     （决定藏不藏自己那份程序化图形）
 */
export class ActorSprite {
  /** 贴图容器：位置 = 脚底中心（由调用方摆放）。 */
  readonly root: Container;

  /**
   * ⚠️ **两个 Sprite**（而不是一个换纹理）：淡出需要"idle 打底 +
   * attack 盖在上面渐隐"，一个对象做不到（换纹理就是硬切）。
   */
  private readonly idleSprite: Sprite;
  private readonly attackSprite: Sprite;

  private idle: readonly Texture[] = [];
  private attack: readonly Texture[] = [];
  /** 加载状态（见类注释的两态表）。 */
  private phase: SpritePhase = 'none';
  /** 上一次写进去的帧号（避免每帧重复 `sprite.texture = ...`）。 */
  private idleIndex = -1;
  private attackIndex = -1;
  /** 见 `castFade`。`undefined` = 没有正在淡出的攻击帧。 */
  private lastCastTick: number | undefined;
  /** 本次加载的序号：**换角色之后旧的那次回来太晚，不该覆盖新的**。 */
  private loadSeq = 0;
  /** 素材原始像素尺寸（未缩放）—— 光晕 / 前摇描边要按它定位。 */
  private natural: { readonly w: number; readonly h: number } | undefined;

  constructor(
    pixi: SpriteCtors,
    parent: Container,
    private readonly source: CharacterSprite,
    /**
     * 朝向：`1` = 素材原方向，`-1` = **水平镜像**。
     *
     * ==================================================================
     * 为什么需要它
     * ==================================================================
     *
     * 原版构图是"玩家在左（背影，朝右）、敌人在右（正面，朝左）"——
     * 两人**面对面**。玩家要求把左右互换之后，素材朝向不会跟着变，
     * 于是两人就**背对背**了。所以换位必须连朝向一起翻。
     *
     * ⚠️ 镜像走 `scale.x` 的符号，而锚点是 `(0.5, 1)`（脚底中心）——
     * 所以翻转是**绕角色中心线**做的，站位不变。
     */
    private readonly facing: 1 | -1 = 1,
  ) {
    this.root = new pixi.Container();
    this.idleSprite = new pixi.Sprite();
    this.attackSprite = new pixi.Sprite();
    for (const s of [this.idleSprite, this.attackSprite]) {
      /** 隐藏直到第一帧到位 —— 空 Sprite 是白方块，不能让它露出来。 */
      s.visible = false;
      /**
       * 锚点放**底部中心**：角色"站在"基地线上，缩放/下沉都绕脚下，
       * 与程序化绘制的 `base` 语义一致。两个 Sprite 必须用**同一个**
       * 锚点与位置，否则淡出时两个姿势会错开。
       */
      s.anchor.set(0.5, 1);
      s.scale.set(source.size * this.facing, source.size);
      this.root.addChild(s);
    }
    parent.addChild(this.root);
    void this.loadAll();
  }

  /**
   * 依次加载 idle → attack。
   *
   * ⚠️ **顺序**而不是并行：攻击段只有在 idle 就绪之后才允许使用
   * （见类注释），并行时无法保证谁先回来。两段合计最多 4 + 22 张，
   * 串行的代价可以接受。
   */
  private async loadAll(): Promise<void> {
    const seq = (this.loadSeq += 1);
    const urls = animUrls(this.source);
    const idle = await this.load(urls.idle, seq);
    if (idle === undefined || seq !== this.loadSeq) return;
    const first = idle[0];
    /**
     * ⚠️ 判据是"`frames.idle` 张全都拿到"：少一张就当**没就绪**，
     * 继续用调用方的程序化绘制（宁可回退，也不要"永远静止的贴图"）。
     */
    if (first === undefined || idle.length !== this.source.idle.length) return;
    this.idle = idle;
    this.natural = { w: first.width, h: first.height };
    this.phase = 'ready';
    this.idleSprite.texture = first;
    this.idleSprite.visible = true;
    /**
     * 攻击帧**独立加载**：它失败不该影响站姿（两段是分开的资源）——
     * 拿不到就一直用站姿，不会出现空帧。
     */
    const attack = await this.load(urls.attack, seq);
    if (attack === undefined || seq !== this.loadSeq) return;
    this.attack = attack;
  }

  /** 加载一组帧；失败或过期返回 `undefined`（调用方按"没有"处理）。 */
  private async load(
    urls: readonly string[],
    seq: number,
  ): Promise<readonly Texture[] | undefined> {
    try {
      const textures = await Promise.all(urls.map((u) => Assets.load<Texture>(u)));
      if (seq !== this.loadSeq) return undefined;
      for (const t of textures) {
        /**
         * ⚠️ **最近邻过滤**：素材是像素画，默认的线性插值会把像素糊成
         * 一团（这里还要放大，更明显）。
         */
        t.source.scaleMode = 'nearest';
      }
      return textures;
    } catch {
      /**
       * 故意吞掉：没有素材是**预期**情况（本地可能缺图），程序化回退
       * 已就位 —— 抛出来只会在控制台刷一堆红字。
       */
      return undefined;
    }
  }

  /** 是否已经可以用贴图作画（false 时调用方必须继续画占位形象）。 */
  get ready(): boolean {
    return this.phase === 'ready';
  }

  /**
   * 拆掉这个形象 —— **换人 / 重开时必须调**。
   *
   * ==================================================================
   * ⚠️ 不调会"谍影"（真实踩过的 bug）
   * ==================================================================
   *
   * 构造时 `parent.addChild(this.root)` 把两个 Sprite 挂进了**父容器**。
   * 所以调用方如果只把引用指向新对象（`this.actor = new ActorSprite(...)`），
   * **旧的 root 仍然留在场景里**，于是新旧两套形象**叠在一起画**：
   *
   *   玩家原话："第一把是好的，按 enter 开第二把 就谍影了"
   *
   * 实测（重开前后 dump 场景）：第一把 5 个角色级 Sprite，重开后变 8 个 ——
   * 每重开一次就多留一套，同时也是一处**资源泄漏**。
   *
   * ⚠️ 只 `removeFromParent()` 也能修掉叠影；这里连 `destroy` 一起做是为了
   * 别把废弃的 Container 留在内存里。**纹理不销毁**（`Assets` 缓存着，
   * 而且同一个角色的形象可能被复用）—— 所以不传 `texture` 相关选项。
   */
  dispose(): void {
    /**
     * 作废在途的加载：`loadAll` 拿到的结果会用 `loadSeq` 比对，
     * 不等就丢弃 —— 否则一个已经拆掉的对象还会去改自己的纹理。
     */
    this.loadSeq += 1;
    this.root.removeFromParent();
    this.root.destroy({ children: true });
  }

  /**
   * 素材原始像素尺寸（未缩放）；没就绪时为 `undefined`。
   *
   * 光晕与前摇描边要按它定位 —— 程序化形象有固定包围盒，贴图没有，
   * 只能问纹理要。
   */
  get naturalSize(): { readonly w: number; readonly h: number } | undefined {
    return this.natural;
  }

  /** 渲染缩放（`spriteAssets.ts` 的 `size`）。光晕 / 包围盒计算要用。 */
  get scale(): number {
    return this.source.size;
  }

  /**
   * 按快照选段选帧（每帧调一次）。
   *
   * @param holding **按住型技能正在施放**（「弹」这类 `holdDrain` 技能）——
   *   见 `actorPoseOf` 的说明。
   *
   * @param tick `BattleSnapshotView.tick`（驱动 idle 循环与淡出）
   * @param cast 该单位的读条视图；`undefined` = 没在读条
   * @param finished 战斗是否已经结束（`view.status !== 'running'`）——
   *   见下面"结算后 tick 不再推进"的说明
   */
  show(
    tick: number,
    cast: { readonly progress: number } | undefined,
    finished = false,
    holding = false,
  ): void {
    if (this.phase !== 'ready') return;

    /**
     * ⚠️ **按住型技能也要走攻击帧**（2026-10-22 用户："按住弹的时候，角色本身
     * 也要播放攻击帧···一直用攻击帧"）。按住不是"读条"（`holdDrain` 技能没有
     * `cast` 记录）⇒ 之前一直停在 idle ✗。
     *
     * 帧策略：**让攻击段循环**（`loopProgress`，与 idle 同一套节奏）——
     * 定格在第一帧会像"卡住了"，循环播放才读得出"在持续施法" ✓。
     */
    const pose = actorPoseOf({ tick, cast, holding, attack: this.source.attack });
    if (pose.pool === 'attack') {
      this.lastCastTick = tick;
      this.idleSprite.visible = false;
      this.attackSprite.visible = true;
      this.attackSprite.alpha = 1;
      this.paint('attack', pose.index);
      return;
    }
    /** 没有读条：idle 打底（循环），attack 段在它上面淡出。 */
    this.idleSprite.visible = true;
    this.paint('idle', frameAtProgress(this.source.idle, loopProgress(this.source.idle, tick)));
    /**
     * ⚠️ **结算之后 tick 不再推进**（`stopOnEnd`），淡出会**永远走不完** ——
     * 实测卡在 alpha 0.67，于是在结算面板背后留一个半透明的定格挥砍姿势。
     * 战斗已经结束，不需要过渡，直接收起。
     */
    if (finished) this.lastCastTick = undefined;
    const fade = finished ? 0 : this.castFade(tick);
    this.attackSprite.alpha = fade;
    this.attackSprite.visible = fade > 0 && this.attack.length > 0;
  }

  /**
   * 读条消失之后的淡出系数（1 → 0）。
   *
   * ⚠️ 时间来源是 `view.tick` 而不是"自己记时间"：同一 tick 反复调用
   * 结果相同，暂停时也不会继续淡（那正是"渲染层是快照的纯函数"）。
   *
   * | 情况 | 返回 |
   * |---|---|
   * | 从没读过条 | 0（不淡，直接就是 idle） |
   * | 本 tick 刚消失 | 1（还看不出淡出） |
   * | 消失 ≥ `CAST_FADE_TICKS` | 0（并清掉状态） |
   * | tick 倒退（重开一局） | 0 并清掉状态 —— 否则会永远卡着上一局的攻击帧 |
   */
  private castFade(tick: number): number {
    const at = this.lastCastTick;
    if (at === undefined) return 0;
    const elapsed = tick - at;
    if (elapsed < 0) {
      this.lastCastTick = undefined;
      return 0;
    }
    if (elapsed >= CAST_FADE_TICKS) {
      this.lastCastTick = undefined;
      return 0;
    }
    return 1 - elapsed / CAST_FADE_TICKS;
  }

  /** 把一个帧号写进对应的 Sprite（帧号没变就不动纹理）。 */
  private paint(pool: 'idle' | 'attack', index: number): void {
    if (pool === 'idle') {
      if (index === this.idleIndex) return;
      this.idleIndex = index;
      const texture = this.idle[index] ?? this.idle[0];
      if (texture !== undefined) this.idleSprite.texture = texture;
      return;
    }
    if (index === this.attackIndex) return;
    this.attackIndex = index;
    const texture = this.attack[index] ?? this.attack[0];
    if (texture !== undefined) this.attackSprite.texture = texture;
  }

  /** 应用一帧的着色与挤压（每帧调一次，与 `show` 分开见类注释）。 */
  apply(frame: ActorSpriteFrame): void {
    if (this.phase !== 'ready') return;
    for (const s of [this.idleSprite, this.attackSprite]) {
      s.tint = frame.tint;
      s.scale.set(this.source.size, this.source.size * frame.squashY);
    }
  }
}
