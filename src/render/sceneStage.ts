/**
 * **战场层**（非 HUD）：程序化夜空 + 该 Boss 的背景图 + 双方角色 + 全屏闪光。
 *
 * ==================================================================
 * 为什么单独一个文件（关注分离，AGENTS.md §3）
 * ==================================================================
 *
 * 这一块和 HUD 是**两类东西**：它不参与 UI 缩放、不读数面板，
 * 只负责"场景里有什么、站在哪、怎么闪"。原先它和 345 行的 HUD 构造
 * 挤在 `BattleScene` 的同一个构造函数里，读者分不清哪几行是"战场"、
 * 哪几行是"读数面板"。
 *
 * ⚠️ **它没有 `setUiScale`** —— 这正是 UI 缩放系数存在的理由
 * （需求："缩放游戏 UI……战斗画面和战斗文字保持不变"）：
 * 战场与飘字不经过 `UiLayout`，天然不随缩放变化。
 *
 * ⚠️ 下面的注释与代码是一起从 `BattleScene.ts` 搬过来的
 * （AGENTS.md §3：抽取时连带注释一起搬）。
 */

import { Sprite, Texture, type Container, type Graphics } from 'pixi.js';
import { LOGICAL } from '../ui/layout';
import type { PixiCtor } from '../ui/primitives';
import { BossSprite } from './actors/BossSprite';
import { ACTOR_POS } from './actorLayout';
import { drawBackground } from './background';
import { BackdropPart } from './parts/backdrop';
import { FlashPart } from './parts/flash';
import { PlayerActorPart } from './parts/playerActor';
import { SpellBurstPlayer } from './spellBurst';
import type { FrameRegistry } from './sceneTypes';

/** 战场层（背景 / 角色 / 闪光）。 */
export class SceneStage {
  private readonly boss: BossSprite;
  /** 该 Boss 的战斗背景（按 `bossId` 换图，配错/漏配回退程序化夜空）。 */
  private readonly backdrop: BackdropPart;
  private readonly playerAnim: Graphics;
  /** 玩家部件（构造时自己决定是否加载贴图形象）。 */
  private playerActor: PlayerActorPart | undefined;
  /** 玩家图形的外层容器（只用于闪避位移） */
  private readonly playerRoot: Container;
  private readonly flashOverlay: Graphics;
  /** 场景根容器（法术动画要往里加精灵）。 */
  private readonly root: Container;

  /**
   * @param root 场景根容器 —— 本层的节点按 **背景 → 角色 → 闪光** 的顺序
   *   加进去，这个顺序就是层叠顺序（背景必须在角色之下、闪光在上）。
   */
  constructor(pixi: PixiCtor, root: Container) {
    this.root = root;
    /* ---------- 背景 ---------- */
    const background = new pixi.Graphics();
    drawBackground(background);
    root.addChild(background);

    /**
     * **该 Boss 的背景图**（`bossBackdrops.ts` 的配对表）。
     *
     * ⚠️ 它的容器必须加在 `background` **之后**、角色之前：
     * 图要盖住程序化夜空，但不能盖住角色。图没就绪时它只有夜空，
     * 与上面的 `background` 完全重合（看不出接缝）。
     */
    this.backdrop = new BackdropPart(pixi);
    root.addChild(this.backdrop.root);

    /* ---------- 角色（Boss 左、玩家右，中间留空给飘字） ---------- */
    /** ⚠️ 站位（含"互换过"的由来）在 `actorLayout.ACTOR_POS` —— 唯一真相。 */
    this.boss = new BossSprite(pixi, { ...ACTOR_POS.boss });
    root.addChild(this.boss.root);

    /**
     * 玩家图形外面套一层容器，**只为了能整体位移**：闪避是"横移一下再复位"，
     * 而 `drawPlayer` 是在固定 `cx` 处绘制路径的。移动容器的 `x` 几乎零成本，
     * 比每帧按偏移重绘整套多边形便宜得多（60fps 下白算几十次 fill）。
     */
    this.playerRoot = new pixi.Container();
    this.playerAnim = new pixi.Graphics();
    this.playerRoot.addChild(this.playerAnim);
    root.addChild(this.playerRoot);

    /* ---------- 全屏闪光 ---------- */
    this.flashOverlay = new pixi.Graphics();
    this.flashOverlay.rect(0, 0, LOGICAL.width, LOGICAL.height).fill(0xffffff);
    this.flashOverlay.alpha = 0;
    root.addChild(this.flashOverlay);
  }

  /** 圣光弹播放器（懒加载素材；缺素材时静默）。 */
  private spellBurst: SpellBurstPlayer | undefined;
  /** 圣光弹的调试读数（`__raidBattle.spell()`；见 `spellBurst.debug`）。 */
  spellDebug(): ReturnType<SpellBurstPlayer['debug']> | undefined {
    return this.spellBurst?.debug();
  }
  /** 上一帧的时间戳（给法术动画算 `dt`）。 */
  private lastSpellMs = 0;

  /** 挂上本层的每帧部件（玩家角色、闪光、Boss 形象）。 */
  register(registry: FrameRegistry): void {
    // 第 3 参 = 加载贴图形象（拿不到就回退到程序化绘制）
    this.playerActor = new PlayerActorPart(this.playerRoot, this.playerAnim, true);
    registry.add(this.playerActor);
    registry.add(new FlashPart(this.flashOverlay));
    /**
     * **圣光弹**（2026-10-22，黛玄的弹/波）：每次伤害播下一组帧组。
     * ⚠️ 素材在 gitignore 的 `public/fd2/` 里 —— 缺了就静默不播（见
     * `spellBurst.ts` 的降级说明），**不是错误**。
     */
    this.spellBurst = new SpellBurstPlayer({
      container: this.root,
      textureFor: (url) => Texture.from(url),
      /**
       * **加载一帧的纹理**（2026-10-22 第二次修）。
       *
       * 演进：
       * - ① 只用 `Texture.from(url)` ⇒ 立刻拿到一张**还没就绪**的纹理，
       *   控制台刷 `Asset id … was not found in the Cache` ✗
       * - ② 改成 `await Assets.load(url)` ⇒ **在战斗装配期会一直挂着**
       *   （实测 `loadStage` 停在 `assets-ok`：`Assets.load` 的 promise
       *   在 `Assets` 尚未 init / 渲染器尚未就绪时既不 resolve 也不 reject ✗）
       * - ③ 现在：`Texture.from(url)` **启动**加载，然后等它的 source
       *   `update` 事件；`error` 或 3 秒兜底 ⇒ 这一帧不可用（不挂、不报错）
       *
       * ⚠️ 3 秒兜底是必须的：素材是 gitignore 的，缺文件时不能让"加载动画"
       * 变成一个永远 pending 的 promise（那会把 `load()` 卡死 ✗）。
       */
      /**
       * **加载一帧的纹理**（2026-10-22 第三次修，前两次都失败）：
       *
       * | 方案 | 结果 |
       * |---|---|
       * | `Texture.from(url)` 直接当纹理用 | 拿到的是**空纹理**，控制台刷 `Asset id … was not found in the Cache` ✗ |
       * | `await Assets.load(url)` | 在战斗装配期**永远 pending**（`loadStage` 停在 `assets-ok`）✗ |
       * | `Texture.from(url)`（相对路径）| 直接返回 `undefined`（`reading 'source' of undefined`）✗ |
       *
       * 现在**自己把图 load 成 `HTMLImageElement`**，再用 `Texture.from(image)`
       * —— 成败只有两个分支，而且都在我们手里（`onload` / `onerror`）：
       * 缺文件 ⇒ 这一帧返回 `undefined` ⇒ 播放器丢掉这一帧 ✓（不挂、不报错）。
       */
      loadTexture: async (url) => {
        if (typeof Image === 'undefined' || typeof document === 'undefined') return undefined;
        const absolute = new URL(url, document.baseURI).href;
        return await new Promise<Texture | undefined>((resolve) => {
          let settled = false;
          const finish = (value: Texture | undefined): void => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          const element = new Image();
          element.crossOrigin = 'anonymous';
          element.onload = () => {
            finish(Texture.from(element));
          };
          element.onerror = () => finish(undefined);
          element.src = absolute;
          /**
           * ⚠️ **兜底 3 秒**：实测在新版 Chrome 里，某些帧的 `Image` 既不
           * `load` 也不 `error`（promise 永远 pending ⇒ `load()` 卡死在
           * 第一帧、`frames` 永远是 0 ✗）。给一个上限，超时就当这一帧不可用。
           */
          setTimeout(() => finish(undefined), 3000);
        });
      },
      assetBase: 'fd2/animations/FDOTHER_028/',
      anchor: { x: ACTOR_POS.boss.x, y: ACTOR_POS.boss.y - 40 },
      createSprite: (texture) => new Sprite(texture),
    });
    registry.add({
      name: 'spellBurst',
      render: (ctx) => {
        const now = performance.now();
        const dt = this.lastSpellMs === 0 ? 0 : now - this.lastSpellMs;
        this.lastSpellMs = now;
        this.spellBurst?.update(ctx.view.spellSeq, dt);
      },
    });
    // Boss 形象自己就是帧部件（读哪些字段见 `BossSprite.render`）
    registry.add(this.boss);
  }

  /**
   * **换这一局的出战形象**（进战斗 / 重开时调用）。
   *
   * 需求："无论角色还是 boss，我都希望加载 完整的 idle 和 attack 的动画"。
   *
   * ⚠️ 为什么不塞进 `BattleSceneOptions` 的构造参数：`BattleScene` 只在
   * `bootstrap()` 里建**一次**，而一局战斗的出战单位是**可变的**
   * （备战界面选完才知道，重开还能换）。放构造参数就必须重建整个场景，
   * 那会把 Pixi 的舞台、toupper 层、设置面板全部跟着换一遍。
   *
   * @param playerId 玩家单位 id（`data/roster.ts`）
   * @param bossId Boss 单位 id
   */
  setAppearance(playerId: string, bossId: string): void {
    this.playerActor?.setCharacter(playerId);
    this.boss.setCharacter(bossId);
    this.backdrop.setBoss(bossId);
  }
}
