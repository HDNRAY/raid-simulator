/**
 * **圣光弹的播放器**（2026-10-22，`FDOTHER_028`）。
 *
 * ==================================================================
 * 它做什么
 * ==================================================================
 *
 * 每次**伤害**（`BattleSnapshotView.spellSeq` 变大）⇒ 播**下一组**帧
 * （用户 2026-10-22："每次伤害都按顺序抽一次攻击帧组，下一次伤害又是下一次"）。
 *
 * 帧数据来自导出物 `public/fd2/animations/FDOTHER_028/`：
 *   `animation.json` 的 `frames[]`（每帧 `x/y/width/height/delay_native`）
 *   + **合好 alpha** 的 `f00.png …`（`artgen/prepare_fdother.py` 产出）
 *
 * ==================================================================
 * ⚠️ 素材缺了**不是错误**（这条很重要）
 * ==================================================================
 *
 * `public/fd2/` 是 gitignore 的第三方素材（54MB，CI / 新检出里没有）。
 * 所以这里**任何一步失败都只是"不放这段动画"**：不抛错、不阻塞战斗。
 * 判据：`fetch` 失败 / 帧文件缺失 ⇒ 整个部件永久静默。
 */

import type { Container, Sprite, Texture } from 'pixi.js';
import { loadSpellAssets } from './spellBurstAssets';
import {
  nextSpellGroup,
  spellFrameAtElapsed,
  spellFrameGroupStarts,
  type SpellFrameGeometry,
} from './spellFrames';

/** 一组里每帧的基础时长（毫秒）。`delay_native` 是它乘数。 */
const FRAME_MS = 40;

/** 播放器状态。 */
interface Burst {
  /** 这一组的第一帧在全局帧数组里的下标。 */
  readonly start: number;
  /** 这一组有几帧。 */
  readonly length: number;
  /** 已经播了多久（毫秒）。 */
  elapsedMs: number;
}

export interface SpellBurstOptions {
  readonly container: Container;
  readonly textureFor: (url: string) => Texture | undefined;
  /**
   * **异步加载一张纹理**（真正把 PNG 拉进 `Assets` 缓存的那一步）。
   *
   * ⚠️ 2026-10-22 修的 bug：原来只调 `textureFor`（= `Assets.get`）而**从没
   * `Assets.load` 过** ⇒ 每张都拿不到、控制台刷 `Asset id … was not found in
   * the Cache`，而且那段圣光弹动画**从来没播出来过** ✗。
   *
   * 注入而不是直接 import `Assets`：本文件在 node 单测里也要能跑（不碰 pixi 的
   * 加载器），而且"加载失败只丢这一帧"的策略可以在这里测 ✓。
   */
  readonly loadTexture?: (url: string) => Promise<Texture | undefined>;
  /** 素材根（相对站点根）：`fd2/animations/FDOTHER_028/`。 */
  readonly assetBase: string;
  /** 在哪儿画（逻辑坐标，通常是 Boss 的位置）。 */
  readonly anchor: { readonly x: number; readonly y: number };
  /** 造一个精灵（注入 `pixi.Sprite`，与其它部件的做法一致）。 */
  readonly createSprite?: (texture: Texture) => Sprite;
}

/**
 * 圣光弹播放器：**懒加载 + 静默降级**。
 *
 * ⚠️ 构造是**同步**的（`BattleScene` 的装配是同步的），而素材是异步的 ——
 * 所以第一帧之前它什么也不画，加载完成后才开始响应 `spellSeq`。
 */
export class SpellBurstPlayer {
  private readonly options: SpellBurstOptions;
  private frames: readonly SpellFrameGeometry[] = [];
  private delays: readonly number[] = [];
  private groupStarts: readonly number[] = [];
  private textures: readonly (Texture | undefined)[] = [];
  private sprite: Sprite | undefined;
  private burst: Burst | undefined;
  private lastSeq = 0;
  private lastGroup: number | undefined;
  private disposed = false;
  /** 第一次加载失败的原因（`debug()` 用它回答"到底是哪一步挂的"）。 */
  private lastError: string | undefined;
  /** `load()` 走到哪一步了（调试读数：`start` → `assets` → `textures` → `done`）。 */
  private loadStage = 'idle';
  /** 第一次 `loadOne` 收到的 URL（调试：确认路径拼接对不对）。 */
  private firstUrl: string | undefined;

  constructor(options: SpellBurstOptions) {
    this.options = options;
    void this.load();
  }

  private async load(): Promise<void> {
    this.loadStage = 'start';
    const assets = await loadSpellAssets(this.options.assetBase);
    this.loadStage = assets === undefined ? 'assets-failed' : 'assets-ok';
    if (assets === undefined) {
      if (this.lastError === undefined) this.lastError = `assets-json-missing: ${this.options.assetBase}animation.json`;
      return;
    }
    if (this.disposed) return;
    /**
     * **逐帧加载，失败的那一帧单独丢掉**（素材是 gitignore 的、可能缺几张）：
     * 丢帧之后 `frames` / `delays` / `textures` **必须同步裁掉同一批下标**，
     * 否则时间轴与画面会错位 ✗。
     */
    /**
     * ⚠️ **并行加载**（2026-10-22 第二次修）：串行 32 帧实测要 ~7 秒 ⇒ 开局
     * 前几秒根本没有动画 ✗。并行之后总耗时 ≈ 最慢的那一帧。
     */
    const textures = await Promise.all(assets.urls.map((url) => this.loadOne(assets.base + url)));
    const loaded: { frame: SpellFrameGeometry; delay: number; texture: Texture | undefined }[] = [];
    for (const [index, texture] of textures.entries()) {
      const frame = assets.frames[index];
      if (frame === undefined || texture === undefined) continue;
      loaded.push({ frame, delay: assets.delays[index] ?? 1, texture });
    }
    if (loaded.length === 0) {
      if (this.lastError === undefined) this.lastError = `all-frames-failed: tried ${assets.urls.length}`;
      return;
    }
    if (this.disposed) return;
    this.frames = loaded.map((entry) => entry.frame);
    this.delays = loaded.map((entry) => entry.delay);
    this.textures = loaded.map((entry) => entry.texture);
    this.groupStarts = spellFrameGroupStarts(this.frames);
    this.loadStage = 'done';
  }

  /**
   * 加载一帧。优先走注入的 `loadTexture`（真正 `Assets.load`），没有注入就退回
   * `textureFor`（单测里就是直接给纹理）。**任何异常都只丢这一帧**。
   */
  private async loadOne(url: string): Promise<Texture | undefined> {
    if (this.firstUrl === undefined) this.firstUrl = url;
    const { loadTexture, textureFor } = this.options;
    if (loadTexture === undefined) return textureFor(url);
    try {
      const texture = await loadTexture(url);
      if (texture === undefined && this.lastError === undefined) this.lastError = `${url} → undefined`;
      return texture;
    } catch (error) {
      /** 缺帧 / 只有一半素材 / 网络失败 —— 一律降级成"这一帧不画" ✓ */
      if (this.lastError === undefined) this.lastError = `${url} -> ${String(error)}`;
      return undefined;
    }
  }

  /**
   * **调试读数**（2026-10-22）：把"圣光弹到底卡在哪一步"摊成纯数据。
   *
   * 为什么必须有它：之前三轮都是"看截图猜" —— 而"没画"与"画了但看不见"
   * 在截图里长得一样。现在能直接读到：素材读到了几帧、纹理加载成功几张、
   * 帧组切出几个、第一次失败的原因、这一帧在播第几组。
   */
  debug(): {
    readonly ready: boolean;
    readonly frames: number;
    readonly textures: number;
    readonly groups: readonly number[];
    readonly lastError: string | undefined;
    readonly playing: number | undefined;
    readonly hasSprite: boolean;
    readonly seq: number;
    readonly sprite: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly visible: boolean; readonly alpha: number } | undefined;
    readonly loadStage: string;
    readonly firstUrl: string | undefined;
    readonly assetBase: string;
  } {
    return {
      ready: this.ready,
      loadStage: this.loadStage,
      firstUrl: this.firstUrl,
      assetBase: this.options.assetBase,
      frames: this.frames.length,
      textures: this.textures.length,
      groups: [...this.groupStarts],
      lastError: this.lastError,
      playing: this.burst === undefined ? undefined : this.lastGroup,
      hasSprite: this.sprite !== undefined,
      seq: this.lastSeq,
      sprite:
        this.sprite === undefined
          ? undefined
          : {
              x: Math.round(this.sprite.x),
              y: Math.round(this.sprite.y),
              w: Math.round(this.sprite.width),
              h: Math.round(this.sprite.height),
              visible: this.sprite.visible,
              alpha: this.sprite.alpha,
            },
    };
  }

  /** 素材准备好了吗（调试 / 验收读数）。 */
  get ready(): boolean {
    return this.groupStarts.length > 0 && this.textures.length > 0;
  }

  /** 当前在播第几组（`undefined` = 没在播）。 */
  get playingGroup(): number | undefined {
    return this.burst === undefined ? undefined : this.lastGroup;
  }

  /**
   * 每帧调用一次。
   *
   * @param spellSeq 视图里的触发计数（变大 ⇒ 播下一组）
   * @param dtMs 距上一帧的毫秒数
   */
  update(spellSeq: number, dtMs: number): void {
    if (this.disposed || !this.ready) return;
    /** 计数变大 ⇒ 开一段新的（连变 2 也只从最近那一段开始，避免叠 4 层）。 */
    if (spellSeq > this.lastSeq) {
      this.lastSeq = spellSeq;
      this.lastGroup = nextSpellGroup(this.lastGroup, this.groupStarts.length);
      const start = this.groupStarts[this.lastGroup] ?? 0;
      const nextStart = this.groupStarts[this.lastGroup + 1] ?? this.frames.length;
      this.burst = { start, length: Math.max(1, nextStart - start), elapsedMs: 0 };
    }
    if (this.burst === undefined) return;
    this.burst = { ...this.burst, elapsedMs: this.burst.elapsedMs + Math.max(0, dtMs) };

    const groupDelays = this.delays.slice(this.burst.start, this.burst.start + this.burst.length);
    const scaled = groupDelays.map((delay) => Math.max(1, delay) * FRAME_MS);
    const local = spellFrameAtElapsed(scaled, this.burst.elapsedMs);
    const total = scaled.reduce((sum, each) => sum + each, 0);
    if (this.burst.elapsedMs >= total) {
      this.burst = undefined;
      this.hide();
      return;
    }
    this.draw(this.burst.start + local);
  }

  /** 换战斗（重开一局）时清掉仍在播的那一段。 */
  reset(): void {
    this.burst = undefined;
    this.lastGroup = undefined;
    this.lastSeq = 0;
    this.hide();
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
  }

  private hide(): void {
    if (this.sprite !== undefined) this.sprite.visible = false;
  }

  private draw(frameIndex: number): void {
    const frame = this.frames[frameIndex];
    const texture = this.textures[frameIndex];
    if (frame === undefined || texture === undefined) return;
    const sprite = this.sprite ?? this.createSprite(texture);
    if (sprite === undefined) return;
    sprite.texture = texture;
    sprite.visible = true;
    /**
     * ⚠️ 每帧的 `x/y` 是**原版画布里的绝对位置**（"帧坐标不一样"就是它）——
     * 这里按"该帧自己的左上角"摆回去，并把锚点归一化到**这一帧的中心**，
     * 于是四组（x/y 各不同）看起来是同一门法术的四次出手 ✓。
     */
    /**
     * ⚠️ **直接画在锚点上**（2026-10-22 第二次修）。
     *
     * 旧版按 `anchor + (frame.width/2 - frame.x) * 0.5` 摆 —— 那套是给
     * "整张画布里的子矩形"用的，而 `prepare_fdother.py` 合出来的
     * `fNN.png` 是**已经裁好的小图**（f00 只有 122×42）⇒ 再加一次原图
     * 绝对坐标的偏移，精灵会跑到 Boss 左边很远的地方 ✗（实测 x=325，
     * 而 Boss 在 393 附近）。
     *
     * 现在每一帧都**居中画在锚点**上：裁好的帧本来就以自身为中心 ✓。
     */
    sprite.position.set(this.options.anchor.x, this.options.anchor.y);
  }

  private createSprite(texture: Texture): Sprite | undefined {
    const make = this.options.createSprite;
    if (make === undefined) return undefined;
    const sprite = make(texture);
    sprite.anchor?.set(0.5, 0.5);
    /**
     * ⚠️ 缩放 **1**（2026-10-22 第二次修）：原先是 0.5 ⇒ 裁好的帧只有
     * 20~60px，在战斗画面里像一粒白点 ✗。原始导出的画布约 299px 宽，
     * 按 1:1 摆在 Boss 身上才是"一发圣光弹"的体量 ✓。
     */
    sprite.scale?.set(0.7);
    this.options.container.addChild(sprite);
    this.sprite = sprite;
    return sprite;
  }
}
