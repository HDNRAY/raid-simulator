/**
 * **对话头像的显示**（Pixi Sprite + 异步贴图），与 `ActorSprite` 同一条纪律。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把一个 `PortraitAsset`（`render/portraitAssets.ts` 里的配对）变成
 * 屏幕上的一颗**正方形小脸**：加载好就显示，没加载好就什么都不画
 * （占位由调用方负责）。
 *
 * ==================================================================
 * ⚠️ 两条与 `ActorSprite` 相同的纪律（那边踩过，这边照抄）
 * ==================================================================
 *
 * 1. **"还没加载完" ≠ "加载失败"**：两者都表现为 `ready === false`，
 *    调用方据此**画自己的程序化占位**（这里是一圈描边 + 名字）。
 *    绝不显示空 Sprite（那是**白方块**，比什么都不画更糟）。
 *
 * 2. **加载序号**：同一颗头像可能被"换了个人"（光标移到另一个角色时
 *    卡片复用同一个对象）—— 旧的那次 Promise 回来太晚就**不该覆盖新的**。
 *    同一条在 `ActorSprite` 里叫 `loadSeq`。
 *
 * ==================================================================
 * ⚠️ 缩放比来自**已知常量**，不是等图加载完再算
 * ==================================================================
 *
 * `PORTRAIT_PIXELS`（80）是素材边长，`box` 是布局表给的显示边长
 * （`PREPARE_LAYOUT.portraitBox` = 28）。两者都是**编译期已知**的，
 * 所以缩放比在构造时就定死 —— 否则画面会在图片到达的一瞬间跳一下。
 */

import { Assets, type Container, type Sprite, type Texture } from 'pixi.js';
import { PORTRAIT_PIXELS, portraitUrl, type PortraitAsset } from './portraitAssets';

/** 建头像需要的构造器（`PixiCtor` 的窄版本，与 `SpriteCtors` 同源）。 */
export interface PortraitCtors {
  readonly Container: typeof Container;
  readonly Sprite: typeof Sprite;
}

export class PortraitSprite {
  /** 贴图容器（调用方按 `box` 的中心摆位）。 */
  readonly root: Container;

  private readonly sprite: Sprite;
  /** ⚠️ 非 readonly：`setAsset` 会换脸（见那个方法的说明）。 */
  private url: string;
  private readonly scale: number;
  private phase: 'none' | 'ready' = 'none';
  private loadSeq = 0;

  /**
   * @param box 显示边长（正方形，逻辑像素）。布局表里是
   *   `PREPARE_LAYOUT.portraitBox`（卡片）或详情区自己算的更大值。
   */
  constructor(
    pixi: PortraitCtors,
    parent: Container,
    private asset: PortraitAsset,
    box: number,
  ) {
    this.url = portraitUrl(asset);
    this.scale = box / PORTRAIT_PIXELS;
    this.root = new pixi.Container();
    this.sprite = new pixi.Sprite();
    /** 隐藏直到贴图到位 —— 空 Sprite 是白方块，不能让它露出来。 */
    this.sprite.visible = false;
    /** 锚点居中：卡片与详情区都按"中心"摆位，省掉两处各减半。 */
    this.sprite.anchor.set(0.5, 0.5);
    this.sprite.scale.set(this.scale);
    this.root.addChild(this.sprite);
    parent.addChild(this.root);
    void this.load();
  }

  /** 贴图是否就绪（`false` 时调用方画占位）。 */
  get ready(): boolean {
    return this.phase === 'ready';
  }

  /**
   * 显隐整颗头像。
   *
   * ⚠️ 与 `visible`（`ready`）分开：**"这一格没有头像"** 与
   * **"头像还没加载完"** 是两件事 —— 前者要连占位一起藏掉，后者要让
   * 调用方画占位。合成一个标志会让"切到炁机详情时，人物的脸还留在
   * 上一帧的位置"。
   */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.sprite.visible = visible && this.phase === 'ready';
  }

  /**
   * **换一张脸**（详情区跟着光标换人时用）。
   *
   * ⚠️ 必须**同时递增 `loadSeq`**：旧那张的 `Assets.load` 可能还在飞，
   * 回来晚了会把新那张盖掉（表现是"光标停在凯丽上，脸却是林晚风"）。
   * 同一条在 `ActorSprite.loadAll` 里叫 `loadSeq`。
   * ⚠️ 换了之后 `ready` 立刻变回 `false`（新贴图还没到）—— 调用方据此
   * 继续画占位，而不是露出一张**上一帧的脸**。
   */
  setAsset(asset: PortraitAsset): void {
    if (asset.id === this.asset.id) return;
    this.loadSeq += 1;
    this.asset = asset;
    this.url = portraitUrl(asset);
    this.phase = 'none';
    this.sprite.visible = false;
    void this.load();
  }

  private async load(): Promise<void> {
    const seq = (this.loadSeq += 1);
    try {
      const texture = await Assets.load<Texture>(this.url);
      if (seq !== this.loadSeq) return;
      if (texture === undefined || texture === null) return;
      this.sprite.texture = texture;
      this.sprite.visible = true;
      this.phase = 'ready';
    } catch {
      /**
       * ⚠️ **不算失败态**：停在 `'none'`，调用方继续画占位。
       * 抛出去会让整个备战屏的构造挂在一个 Promise 上（那个 Promise
       * 没人 await），而玩家只会看到"卡片突然不见了"。
       */
      this.phase = 'none';
    }
  }
}
