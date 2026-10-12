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

import type { Container, Graphics } from 'pixi.js';
import { LOGICAL } from '../ui/layout';
import type { PixiCtor } from '../ui/primitives';
import { BossSprite } from './actors/BossSprite';
import { ACTOR_POS } from './actorLayout';
import { drawBackground } from './background';
import { BackdropPart } from './parts/backdrop';
import { FlashPart } from './parts/flash';
import { PlayerActorPart } from './parts/playerActor';
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

  /**
   * @param root 场景根容器 —— 本层的节点按 **背景 → 角色 → 闪光** 的顺序
   *   加进去，这个顺序就是层叠顺序（背景必须在角色之下、闪光在上）。
   */
  constructor(pixi: PixiCtor, root: Container) {
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

  /** 挂上本层的每帧部件（玩家角色、闪光、Boss 形象）。 */
  register(registry: FrameRegistry): void {
    // 第 3 参 = 加载贴图形象（拿不到就回退到程序化绘制）
    this.playerActor = new PlayerActorPart(this.playerRoot, this.playerAnim, true);
    registry.add(this.playerActor);
    registry.add(new FlashPart(this.flashOverlay));
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
