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

  constructor(options: SpellBurstOptions) {
    this.options = options;
    void this.load();
  }

  private async load(): Promise<void> {
    const assets = await loadSpellAssets(this.options.assetBase);
    if (this.disposed || assets === undefined) return;
    this.frames = assets.frames;
    this.delays = assets.delays;
    this.textures = assets.urls.map((url) => this.options.textureFor(assets.base + url));
    this.groupStarts = spellFrameGroupStarts(this.frames);
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
    sprite.position.set(
      this.options.anchor.x + (frame.width / 2 - frame.x) * 0.5,
      this.options.anchor.y + (frame.height / 2 - frame.y) * 0.5,
    );
  }

  private createSprite(texture: Texture): Sprite | undefined {
    const make = this.options.createSprite;
    if (make === undefined) return undefined;
    const sprite = make(texture);
    sprite.anchor?.set(0.5, 0.5);
    sprite.scale?.set(0.5);
    this.options.container.addChild(sprite);
    this.sprite = sprite;
    return sprite;
  }
}
