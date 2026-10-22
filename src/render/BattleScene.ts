/**
 * 战斗场景（M5）。
 *
 * 设计要点：
 * 1. **不画地面预警扇形** —— 本作没有位移，所以"范围"不存在。判断压力
 *    全部来自**读条结束的时机**（该躲 / 该挡 / 该打断），表达它的是顶部
 *    那条预警条。
 * 2. **HUD 让路**：画面中央只放角色，不放面板。
 * 3. **元素小、信息密度高**：技能格 48、buff 图标 26、字号 11–20。
 *
 * 数据流单向：`update(view)` 只读传入的快照。
 *
 * ==================================================================
 * 它现在**只做三件事**：持有各区域 / 决定层叠顺序 / 转发
 * ==================================================================
 *
 * 需求（用户原话）："battlescene 就更不说了……如此复杂的页面，那么多小区域，
 * 非要都放在一起……我给你 700 的限制不是为了限制而限制，是为了提醒你，
 * 这个内容很多了，应该拆分，遵从关注分离"。
 *
 * 所以按**屏幕区域**切开了（每个区域 = 一个"造 + 画 + 缩放"的整体）：
 *
 *   `SceneStage`        战场层：背景 / 角色 / 闪光（**不随 UI 缩放**）
 *   `hud/BossHeader`    Boss 顶栏：名字 / 阶段 / 计时 / 狂暴 + 血条 + 它的 buff 条
 *   `hud/CastBars`      两条读条（Boss 预警 + 玩家读条）
 *   `hud/PlayerStatus`  玩家面板：三根资源条 + 数值 + 玩家的 buff / debuff 条
 *   `hud/LogArea`       战斗日志
 *   `hud/StatusArea`    屏幕中下的状态提示 + 眩晕横幅
 *   `SkillBarView`      技能栏（早就独立，自己实现 `setUiScale`）
 *   `FloatingTextLayer` 飘字（早就独立）
 *   `hud/ResultArea`    结算面板（**不随 UI 缩放**）
 *
 * ⚠️ 这次拆分的重点**不是"文件短了"**，而是：`setUiScale` 原先的 80 行
 * 是"场景逐个元素手调" —— 那说明"谁该知道自己多大"放错了地方。
 * 现在每个区域自己实现 `setUiScale(scale)`，场景只转发（见下面的说明）。
 */

import type { Container } from 'pixi.js';
import type { LogEntry } from '../app/logFormat';
import type { LogReviewPanel } from '../ui/LogReviewPanel';
import type { ScreenChrome } from '../ui/ScreenChrome';
import { BossHeader } from './hud/bossHeader';
import { CastBars } from './hud/castBars';
import { LogArea } from './hud/logArea';
import { PlayerStatus } from './hud/playerStatus';
import { ResultArea } from './hud/resultArea';
import { StatusArea } from './hud/statusArea';
import { FloatingTextLayer } from './FloatingTextLayer';
import { BattleChromePart } from './parts/battleChrome';
import { SceneStage } from './sceneStage';
import { FrameRegistry } from './sceneTypes';
import type { BattleSceneOptions } from './sceneTypes';
import { SkillBarView } from './skillBar';
import type { BattleSnapshotView } from './viewModel';

/**
 * 类型从这里**重新导出**，所以 `import { BattleSceneOptions } from
 * './render/BattleScene'` 依然可用 —— 拆文件不该是个破坏性改动。
 * 定义本身在 `sceneTypes.ts`（见那里的说明）。
 */
export type { BattleSceneOptions, TranslateFn } from './sceneTypes';

export class BattleScene {
  readonly root: Container;

  /** 战场层（背景 / 角色 / 闪光）——**不随 UI 缩放**（见 `SceneStage`）。 */
  private readonly stage: SceneStage;
  /** Boss 顶栏。 */
  private readonly bossHeader: BossHeader;
  /** 两条读条。 */
  private readonly castBars: CastBars;
  /** 玩家面板。 */
  private readonly playerStatus: PlayerStatus;
  /** 战斗日志。 */
  private readonly logArea: LogArea;
  /** 状态提示 + 眩晕横幅——**不随 UI 缩放**（现状如此）。 */
  private readonly statusArea: StatusArea;
  /** 技能栏（自己实现 `setUiScale`，见 `skillBar.ts`）。 */
  private readonly skillBar: SkillBarView;
  /** 飘字（自己就是帧部件）。 */
  private readonly floating: FloatingTextLayer;
  /** 结算面板——**不随 UI 缩放**（现状如此）。 */
  private readonly resultArea: ResultArea;

  /**
   * **战斗界面自己的边角控件**（齿轮；这一屏没有返回箭头）。
   *
   * ⚠️ 用户 2026-10-12："stage 上理论上不挂任何小组件"、"多个页面的齿轮，
   * 应该分别定义"、"UI 缩放要带上"。所以它挂在 **HUD 层**（见构造函数）、
   * 由本场景持有并参与 `setUiScale` —— 与 `SkillBarView` / `BossHeader`
   * 同一范式（各自实现 `setUiScale`，场景只转发）。
   *
   * ⚠️ 公开（而不是只留一个私有字段）：它是**输入路由的目标**
   * （`canvasInput` 命中 / `settingsKeys` 焦点 / `settingsToggle` 显隐），
   * 而那些接线住在 `app/`。与 `logReview` 暴露给输入层同一个理由。
   */
  readonly chrome: ScreenChrome;

  /**
   * 帧部件注册表（见 `FrameRegistry` / `FramePart`）。
   *
   * 场景只持有它并广播；**不持有任何部件内部状态**
   * （比如玩家姿态的 `lastPose` 已经跟着 `PlayerActorPart` 走了）。
   */
  private readonly registry = new FrameRegistry();

  /** UI 缩放系数（默认 1）——只影响 UI 部件，不影响画布与战斗画面 */
  private uiScale = 1;
  /** 是否显示键名（触屏隐藏）。见 `FrameContext.showKeyHints`。 */
  private showKeyHints = true;

  private readonly options: BattleSceneOptions;

  constructor(options: BattleSceneOptions) {
    this.options = options;
    const { pixi, app, translate } = options;

    this.root = new pixi.Container();
    app.stage.addChild(this.root);

    /* ---------- 战场层（必须在 HUD 之下） ---------- */
    this.stage = new SceneStage(pixi, this.root);

    /**
     * **HUD 的层叠顺序 = `addChild` 的顺序**：
     * 顶栏 → 日志 → 读条 → 玩家面板 → 技能栏 → 飘字 → 状态提示。
     *
     * ⚠️ 与拆分前逐行 `hud.addChild(...)` 的顺序一致 —— 面板是**后绘制**的，
     * 所以"玩家读条在面板上方、两者不重叠"这条约束
     * （见 `LAYOUT.playerCastBar` 的说明）仍然成立。
     *
     * ⚠️ 唯一一处例外：`stunBanner` 原先很早（排在 Boss 血条之前）就加进
     * HUD 了，现在跟着 `StatusArea` 排在最后。该矩形（480,300 附近）不与
     * 任何其它 HUD 节点重叠，所以外观不变 —— 见 `hud/statusArea.ts`。
     */
    const hud = new pixi.Container();
    this.root.addChild(hud);

    this.bossHeader = new BossHeader(pixi, translate);
    hud.addChild(this.bossHeader.root);

    this.logArea = new LogArea(pixi, translate);
    hud.addChild(this.logArea.root);

    this.castBars = new CastBars(pixi);
    hud.addChild(this.castBars.root);

    this.playerStatus = new PlayerStatus(pixi, translate);
    hud.addChild(this.playerStatus.root);

    this.skillBar = new SkillBarView(pixi, translate);
    hud.addChild(this.skillBar.root);

    this.floating = new FloatingTextLayer(pixi);
    hud.addChild(this.floating.root);

    this.statusArea = new StatusArea(pixi);
    hud.addChild(this.statusArea.root);

    /**
     * **战斗界面的齿轮**：造在 **HUD 层**（不是 `stage`，也不是 `root` 的
     * 顶层）—— 因为它属于"战斗这一屏的界面"。
     *
     * ⚠️ 落点是**玩家面板右缘 + 间距**（`battleGearBoxAt`，与面板上缘对齐）
     * —— 用户 2026-10-13："**战斗时，齿轮应该在人物面板的右边**"。这个位置
     * 由 `ScreenChrome` 的落位函数表达（引用 `LAYOUT.player`，面板一改它就
     * 跟着走）。
     *
     * ⚠️ 加在**最后** = 压在 HUD 之上、`resultArea` 之下（后者是 `root` 的
     * 子节点，排在 `hud` 之后）。缩放走下面的 `setUiScale`。
     */
    this.chrome = options.createChrome(pixi);
    hud.addChild(this.chrome.root);

    /* ---------- 结算面板 ----------
     * 单独一层、**加在 HUD 之后**，所以天然压在 HUD 之上。
     * 战斗进行中完全隐藏，所以它不占用任何视觉注意力。 */
    this.resultArea = new ResultArea(pixi);
    this.root.addChild(this.resultArea.root);

    this.registerFrameParts();
  }

  /**
   * **注册帧部件**（需求："ui 的各个部分注册在 tick 上"）。
   *
   * ⚠️ **注册顺序 = 广播顺序**（`FrameRegistry` 保序）。它**不决定层叠**
   * —— 谁盖在谁上面由上面 `addChild` 的顺序决定。两件事分开之后，
   * "飘字要盖在面板上、结算要盖在所有东西上"读场景的加入顺序就够了。
   */
  private registerFrameParts(): void {
    this.bossHeader.register(this.registry);
    this.castBars.register(this.registry);
    this.playerStatus.register(this.registry);
    this.stage.register(this.registry);
    this.registry.add(this.skillBar);
    this.registry.add(this.floating);
    this.statusArea.register(this.registry);
    this.logArea.register(this.registry);
    this.resultArea.register(this.registry);
    /**
     * ⚠️ 齿轮也注册成帧部件（`BattleChromePart`）：键位提示的显隐跟着
     * "键盘 / 触屏"这个唯一 flag 走，每帧读一次就不需要"切换方式时通知
     * 所有界面的所有齿轮"那张订阅表 —— 与 `ScreenChrome.update` 的说明同源。
     */
    this.registry.add(new BattleChromePart(this.chrome));
  }

  /**
   * **复盘那一层**（一局结束后的全屏战报）—— 给**输入路由**用。
   *
   * ⚠️ 只读地转出去，不在这里判任何东西：`phase` 在战斗结束后**仍然是
   * `battle`**（见 `phaseLogic.Phase`，"不要新增 `'result'`"），
   * 所以"复盘开着没有"是"谁该拿键盘 / 指针"的关键输入 ——
   * 判据只有一处（`app/inputRouter.ts`），这里只负责把它递到那里。
   */
  get logReview(): LogReviewPanel {
    return this.logArea.review;
  }

  /**
   * **战斗界面的齿轮命中**（指针路由用）。
   *
   * ⚠️ 用户 2026-10-12："stage 上理论上不挂任何小组件"、"多个页面的齿轮，
   * 应该分别定义" —— 所以这个齿轮住在**本场景的 HUD 层**，而"它在哪里、
   * 什么时候可点"也由场景自己回答。`app/canvasInput.ts` 只转调这一句，
   * 不再认识任何一个具体的按钮对象。
   *
   * @returns 是否命中（命中即已经触发"打开设置"）
   */
  hitTestChrome(px: number, py: number): boolean {
    return this.chrome.hitTest(px, py);
  }

  /**
   * 是否显示键名（触屏传 `false`）。见 `FrameContext.showKeyHints`。
   *
   * ⚠️ 触屏时**整条技能栏都隐藏**：双弧按钮承担了它的全部职责
   * （技能字 + 冷却 + 代价），同时显示会重叠。
   */
  setShowKeyHints(show: boolean): void {
    this.showKeyHints = show;
    this.skillBar.root.visible = show;
  }

  /**
   * **换这一局的出战形象**（进战斗 / 重开时调用）。
   *
   * ⚠️ 完整的说明（为什么不能塞进构造参数）在 `sceneStage.ts` 的
   * `setAppearance` 上 —— 那里才是"出战单位是可变的"这条知识的归属。
   *
   * @param playerId 玩家单位 id（`data/roster.ts`）
   * @param bossId Boss 单位 id
   */
  setAppearance(playerId: string, bossId: string): void {
    this.stage.setAppearance(playerId, bossId);
    /**
     * **Boss 的头像**（2026-10-22）：顶栏那颗跟着换人。
     * ⚠️ 顶栏挂在 **HUD 层**（`BossHeader`），不在 `SceneStage` 里 ——
     * 所以它只能从这里转过去（`SceneStage` 拿不到它）。
     */
    this.bossHeader.setBoss(bossId);
  }

  /**
   * **UI 缩放**（需求："缩放游戏 UI……战斗画面和战斗文字保持不变"）。
   *
   * 只作用于 UI 部件，**不碰画布尺寸**（仍是 960×540 逻辑分辨率），
   * 所以角色、场景、飘字不受影响。
   *
   * ==================================================================
   * ⚠️ 这里**只转发系数** —— "谁该知道自己多大"由各区域自己决定
   * ==================================================================
   *
   * 拆分前它是 80 行"逐个元素手调"：面板矩形、三根资源条、每个标签的
   * `setSize` / `root.x` / `root.y`、Boss 顶栏、四条图标条、两条读条……
   * 全排在场景里。那说明这块知识**放错了地方**。
   *
   * 现在每个区域自己实现同名方法（签名一致，见各自的文件）：
   *   `hud/bossHeader.ts`    `setUiScale(scale)`
   *   `hud/castBars.ts`      `setUiScale(scale)`
   *   `hud/playerStatus.ts`  `setUiScale(scale)`
   *   `hud/logArea.ts`       `setUiScale(scale)`
   *   `skillBar.ts`          `setUiScale(scale)`（更早就独立了）
   *   `ui/ScreenChrome.ts`   `setUiScale(scale)`（战斗界面的齿轮 —— 用户
   *                          2026-10-12："UI 缩放要带上"。它原先挂在 stage 上，
   *                          完全不受缩放影响，实测三张不同缩放的图 md5 相同）
   *
   * ⚠️ **不缩放的三块**（现状如此，本次纯搬运不改行为）：
   * `SceneStage`／`FloatingTextLayer`（战场与飘字，见 `UiLayout` 的设计前提）、
   * `StatusArea`、`ResultArea`。
   */
  setUiScale(scale: number): void {
    if (scale === this.uiScale) return;
    this.uiScale = scale;
    this.skillBar.setUiScale(scale);
    this.bossHeader.setUiScale(scale);
    this.castBars.setUiScale(scale);
    this.playerStatus.setUiScale(scale);
    this.logArea.setUiScale(scale);
    this.chrome.setUiScale(scale);
  }

  /**
   * 每帧重画。
   *
   * `logEntries` 与 `view` **分开传** —— 日志和战斗快照是两个独立的
   * 数据流（各自消费同一批引擎事件），所以不该硬塞进 `view` 里。
   * 这样"要不要显示日志"就只是调用方传不传数组的问题。
   */
    /** 每帧广播（部件自己从 ctx 取字段，场景不逐个 update）。 */
  update(view: BattleSnapshotView, logEntries: readonly LogEntry[] = []): void {
    this.registry.notify({
      view,
      logEntries,
      translate: this.options.translate,
      uiScale: this.uiScale,
      showKeyHints: this.showKeyHints,
    });
  }
}
