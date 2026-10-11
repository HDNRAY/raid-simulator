/**
 * **战斗背景**（按 Boss 换图）+ 程序化夜空回退。
 *
 * ==================================================================
 * 两层：程序化夜空（底） + 该 Boss 的背景图（上）
 * ==================================================================
 *
 * 需求："每个 Boss 一个战斗背景"，配对表在 `bossBackdrops.ts`。
 *
 * | 状态 | 画什么 |
 * |---|---|
 * | 该 Boss 的图还没加载完 / 加载失败 / 没配图 | 程序化夜空（`drawBackground`） |
 * | 图就绪 | 图铺满 960×540（盖住夜空），上面压一层**统一暗化** |
 *
 * ⚠️ 程序化夜空**不能删**：它是"任何时刻都有可见背景"的保证，
 * 也是没配图的 Boss 的兜底（`bossBackdropUrl` 返回 `undefined`）。
 *
 * ==================================================================
 * ⚠️ 素材是 320×100 的**背景层**，不是 960×540 的整屏图
 * ==================================================================
 *
 * 所以只能**非等比拉伸**（横向 ×3、纵向 ×5.4）。等比 ×3 会在上下各留
 * 120px 黑边 —— 那更难看。这个代价写在 `bossBackdrops.ts` 里，
 * 结论是"接受"。
 *
 * 暗化层有两个理由（不是装饰）：
 *   1. 素材是原作 1995 年的鲜艳场景，压一层才让 HUD 的浅色文字读得清
 *      （HUD 的设计前提是"近黑背景"）
 *   2. 顶部/底部再压两道渐变：顶部给 Boss 顶栏让路，底部给玩家面板让路
 */

import { Assets, type Container, type Graphics, type Sprite, type Texture } from 'pixi.js';
import type { PixiCtor } from '../../ui/primitives';
import { LOGICAL } from '../../ui/layout';
import { drawBackground } from '../background';
import { bossBackdropUrl } from '../bossBackdrops';

/**
 * 统一暗化的强度。
 *
 * ==================================================================
 * 0.34 → **0.18**（玩家看过 A/B 之后定的）
 * ==================================================================
 *
 * 0.34 的理由是成立的：素材明度远高于原来的程序化夜空（4%–10%），
 * 而 HUD 的浅色文字是**按"近黑背景"设计的**，需要一层底才读得清。
 *
 * 但它把"换成原版背景"想要的那个效果（更亮、更有场景感）也一起压掉了。
 * 做了一组 A/B 截图给玩家看，他选了亮的那一版。
 *
 * ⚠️ 所以 0.18 是**权衡后的取值，不是随手调的**：再往下压，
 * HUD 文字就会开始吃背景的对比度。真要再亮，正确做法是
 * **改 HUD 文字的颜色/描边**，而不是继续降这个值。
 */
const VEIL_ALPHA = 0.18;

/**
 * 战斗背景。
 *
 * 用法（`BattleScene`）：
 *   ```ts
 *   const backdrop = new BackdropPart(pixi);
 *   root.addChild(backdrop.root);   // 位置决定层叠：要在角色之下
 *   ...
 *   backdrop.setBoss(bossId);       // 进战斗 / 重开时
 *   ```
 */
export class BackdropPart {
  /** 场景里的容器（含图 + 暗化层）。 */
  readonly root: Container;

  private readonly fallback: Graphics;
  private readonly veil: Graphics;
  private image: Sprite | undefined;
  /** 当前已请求的 Boss id（避免重开同一局时重复加载）。 */
  private currentId: string | undefined;
  /** 每次 `setBoss` 递增：旧的加载回来晚了不该覆盖新的。 */
  private seq = 0;

  constructor(private readonly pixi: PixiCtor) {
    this.root = new pixi.Container();
    this.fallback = new pixi.Graphics();
    drawBackground(this.fallback);
    this.root.addChild(this.fallback);

    /**
     * 暗化层：**按素材尺寸铺满整屏**（不随图缩放，避免被 image 的
     * 非等比缩放影响）。它在 image 之后加入，所以天然盖在图上。
     */
    this.veil = new pixi.Graphics();
    this.veil
      .rect(0, 0, LOGICAL.width, LOGICAL.height)
      .fill({ color: 0x05060c, alpha: VEIL_ALPHA });
    /** 顶部 128px 再压一道（Boss 顶栏 + 预警条的地盘）。 */
    this.veil
      .rect(0, 0, LOGICAL.width, 128)
      .fill({ color: 0x000000, alpha: 0.3 });
    /** 底部 96px 再压一道（玩家面板 + 技能栏的地盘）。 */
    this.veil
      .rect(0, LOGICAL.height - 96, LOGICAL.width, 96)
      .fill({ color: 0x000000, alpha: 0.26 });
    /**
     * ⚠️ 暗化层**始终隐藏**，直到图就绪 —— 否则会在程序化夜空上
     * 多压一层（那层夜空本来就已经很暗，再压就看不清地砖了）。
     */
    this.veil.visible = false;
    this.root.addChild(this.veil);
  }

  /**
   * 换背景（进战斗 / 重开时调用）。
   *
   * ⚠️ 没配图的 id（`undefined`）**保持当前的图/夜空** —— 不回退到
   * "随便挑一张"，那种错会被误当成美术风格变了。
   */
  setBoss(bossId: string): void {
    if (bossId === this.currentId) return;
    this.currentId = bossId;
    const url = bossBackdropUrl(bossId);
    const seq = (this.seq += 1);
    if (url === undefined) return;
    void Assets.load<Texture>(url)
      .then((texture) => {
        if (seq !== this.seq) return;
        /**
         * ⚠️ 背景是**大色块**（×5 拉伸），用**线性**过滤比最近邻好看：
         * 最近邻会把它放大成 5px 的方块，像马赛克；背景不是"像素角色"，
         * 它的观感目标与角色贴图相反。角色的 `nearest` 在
         * `ActorSprite` 里设，两者互不影响。
         */
        texture.source.scaleMode = 'linear';
        this.show(texture);
      })
      .catch(() => {
        /** 没有背景素材是**预期**情况（本地可能缺图）—— 夜空顶着。 */
      });
  }

  private show(texture: Texture): void {
    if (this.image === undefined) {
      this.image = new this.pixi.Sprite(texture);
      this.image.width = LOGICAL.width;
      this.image.height = LOGICAL.height;
      /**
       * ⚠️ 插到 `fallback` 之后、`veil` 之前：夜空留在最底，
       * 暗化层必须在图之上（否则暗化被图盖住 = 白做）。
       */
      this.root.addChildAt(this.image, 1);
    } else {
      this.image.texture = texture;
    }
    this.image.visible = true;
    this.veil.visible = true;
  }
}
