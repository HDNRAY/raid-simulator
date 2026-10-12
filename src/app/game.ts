/**
 * **一局应用的装配**（主干第三步：`createGame({ app, stage, deps })`）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 用户原话："main.ts 早都可以拆了，我刚看了下，很多都可以挪出去……
 * **main.ts 只应该保留主干**"。
 *
 * `main.ts` 原先 699 行，其中真正"立起应用"的只有四步（建舞台 → 备数据 →
 * 装配 → 跑主循环）。这个文件承担第三步：把各部件按**正确顺序**造出来并
 * 接上线。各部件自己的知识都在各自的模块里：
 *
 * ```text
 *   bootstrap.ts       Pixi + #stage + resize 观察
 *   deps.ts            内容注册表 / 设置存储 / 键位表 / 输入方式
 *   sceneSetup.ts      BattleScene（含 i18n 取词注入）
 *   battleSetup.ts     startBattle()：造一局 BattleLoop
 *   settingsSetup.ts   new SettingsPanel + settingsToggle（齿轮已归各屏，见下）
 *   touchSetup.ts      触屏层（能力 / 布局 / 输入源 / 双弧按钮）
 *   flow.ts            GameState（装配期回填的共享状态）
 *   phaseFlow.ts       applyPhase + 进战斗 / 切界面 / 返回（相位流转）
 *   phaseLogic.ts      Phase + "哪个相位能返回 / 显示哪个控件"的判定
 *   loopWiring.ts      Pixi ticker / 键盘 / pagehide
 *   debugApiSetup.ts   window.__raidBattle
 * ```
 *
 * ==================================================================
 * ⚠️ 顺序即正确性：这些"先后关系"不许整理
 * ==================================================================
 *
 *   1. **先造三个界面（首页 / 选角色 / 自由模式）、后 `?prepare=skip`
 *      的进入战斗** —— `enterBattle` 会走 `applyPhase`（它一次性重设三个
 *      界面与战斗场景的显隐）与 `scene.setAppearance` / `startBattle`，
 *      界面早一步调用会撞 TDZ。
 *      ⚠️ 各屏**自己的齿轮与返回箭头**跟着各屏一起造（它们住在各屏的
 *      root 里，不再是挂 stage 上的共享组件 —— 用户 2026-10-12：
 *      "stage 上理论上不挂任何小组件"、"多个页面的齿轮，应该分别定义"）。
 *   2. **触屏层必须晚于设置面板** —— 面板要接收 `touch` 的能力值
 *      （是否显示键位提示），所以它拿到的是一份**预览数据源**，
 *      稍后由 `touchSetup` 回填。
 *   3. **`touch` 在第一次 `startBattle` 之前必须已就绪** ——
 *      `BattleLoop` 每帧通过 `() => touch.input` 读它；`?prepare=skip`
 *      会在 `createGame` 中途就建好第一局，而那时 `touch` 还没有。
 *      解法：`startBattle` 的工厂在**第 1 步之前**就建好（它只捕获
 *      取值函数），而 `startBattle` 的第一次**调用**发生在触屏装配之后。
 *   4. **`wireCanvasPointer` / `wireSettingsKeys` 最后接** —— 它们依赖
 *      上面所有部件，且 `settingsButtonFocused` 要等键盘接线接好才能回填。
 *      ⚠️ 场景那一个（`BattleScene`）例外：它在**第 1 步之前**就造好了，
 *      因为 `createChrome` 里那句 `settingsToggle.toggle()` 是**延后的**
 *      （只在点齿轮时才执行），不需要开关先生成。
 *   5. **各屏的齿轮都接到同一个开关上** —— 它们不会同时可见
 *      （`applyPhase` 是显隐的唯一写入点）；"当前是谁"由 `getChrome()`
 *      按相位查，所以没有"一个全局设置按钮"需要回填。
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { BattleScene } from '../render/BattleScene';
import { resolveBossId } from '../data/roster';
import { translator } from '../i18n/translator';
import { observeStage } from '../render/sizes';
import { UI_SCALE_MAX, UI_SCALE_MIN, type ScalingMode } from '../render/scaling';
import { parseUiScale } from './settingsStore';
import { createStartBattle } from './battleSetup';
import { createPhaseFlow } from './phaseFlow';
import { createGameState } from './flow';
import { activeInputLayer } from './inputRouter';
import { createSettingsSetup } from './settingsSetup';
import { createTouchSetup } from './touchSetup';
import { installDebugApi } from './debugApiSetup';
import { wireLoop } from './loopWiring';
import { wireCanvasPointer } from './canvasInput';
import { wireSettingsKeys } from './settingsKeys';
import { buildScreens } from './screenSetup';
import { readUrlParams } from './urlParams';
import { switchOperationMode } from './operationMode';
import { translateSafe } from './translate';
import { battleGearBoxAt, ScreenChrome } from '../ui/ScreenChrome';
import { capsOf, type OperationMode } from '../render/platform';
import type { BattleLoop } from './battleLoop';
import type { GameDeps } from './deps';
import type { Application } from 'pixi.js';
/** 画布自适应的缩放模式（MVP 固定 `fit`）。 */
const SCALING_MODE: ScalingMode = 'fit';

/** 每场战斗的时限。超时判负。与 Boss 的 enrage 阈值一致。 */
const TIME_LIMIT_MS = 180_000;

/** `createGame()` 的产物：主干只需要 `start()`。 */
export interface GameHandle {
  /** 接上主循环 / 键盘 / 调试入口，并把页面标记为就绪。 */
  start(): void;
}

/** `createGame()` 的依赖（舞台已经建好、数据已经备好）。 */
export interface CreateGameDeps {
  readonly app: Application;
  readonly stage: HTMLElement;
  /** 主干第二步的产物（内容 / 存储 / 键位 / 输入方式）。 */
  readonly deps: GameDeps;
}

/**
 * 装配整个应用（不启动）。
 *
 * ⚠️ 它**不注册 ticker、不装 window 监听、不碰 `window.__raidBattle`** ——
 * 那些都在 `start()` 里。拆成两段是为了让"造"与"跑"分开：`?prepare=skip`
 * 这类早于启动的进入战斗，走的是"造"这一段里的显式函数调用。
 */
export function createGame(o: CreateGameDeps): GameHandle {
  const { app, stage } = o;
  const d = o.deps;
  const state = createGameState(d.bindings, d.touchButtons, d.inputMode);

  /**
   * **要不要显示键名提示** = "现在是不是键盘方式"（唯一 flag 的派生）。
   *
   * ⚠️ 提成一个取值函数：`home` / `select` / `prepare` / 场景 / 四个界面的
   * 边角控件（`ScreenChrome`，各自每帧现读）/ 设置面板 / 指针路由都要它，
   * 各写一遍 `capsOf(...)` 就是一片会漂的派生 —— 而"唯一 flag"的意义
   * 正是**只有一处**回答这个问题。
   */
  const showKeyHintsNow = (): boolean => capsOf(state.operationMode).showKeyHints;

  /**
   * 齿轮上那个键位提示（`F1`）的显示名。
   *
   * ⚠️ 它是**键位**、不是文案（AGENTS.md §3b）：`settings.openKey` 只写
   * 键名本身，渲染层直接用它；四个界面各自的齿轮都读这一个取值函数 ——
   * 键位表一改，四处一起改，没有第二份。
   */
  const f1Label = (): string => translateSafe('settings.openKey');

  /* ---------- 场景 ---------- */
  const scene = new BattleScene({
    app,
    pixi: { Container, Graphics, Sprite, Text },
    /**
     * ⚠️ 这里的取词是**内联箭头**而不是 `translateSafe` 本身：`BattleScene`
     * 的选项把 `key` / `params` 收窄成了 i18n 的联合类型，直接传
     * `translateSafe`（`key: string`）对不上。**但 `params` 必须透传** ——
     * 套一层 `(key) => ...` 会把占位符吃掉（见 `battleSetup.ts` 里
     * `translate: translateSafe` 的整段说明）。
     */
    translate: (key, params) => {
      try {
        return translator.t(
          key as Parameters<typeof translator.t>[0],
          params as Parameters<typeof translator.t>[1],
        );
      } catch {
        return key;
      }
    },
    /**
     * **战斗界面自己的齿轮**（挂在场景的 HUD 层，不是 stage 上）。
     *
     * ⚠️ 用户 2026-10-12："stage 上理论上不挂任何小组件"、"多个页面的齿轮，
     * 应该分别定义"、"UI 缩放要带上"。所以战斗这一屏的齿轮由**场景**持有
     * （见 `BattleScene.chrome`），位置是**战斗日志下方**（`battleGearBoxAt`
     * —— 右上角被 Boss 血条与 debuff 行占着）。
     *
     * ⚠️ `onGear` 引用 `settingsToggle`（本函数后面才构造）。这是**刻意的
     * 延后引用**：箭头体只在玩家点齿轮时才执行，那时它早就建好了。与
     * `settingsSetup` 里那批取值函数同一个处理方式 —— 不要"整理顺序"，
     * 那会把场景与设置面板的构造顺序绑死。
     */
    createChrome: (pixi) =>
      new ScreenChrome({
        pixi,
        gearAt: battleGearBoxAt,
        f1Label,
        showKeyHints: showKeyHintsNow,
        onGear: () => settingsToggle.toggle(),
      }),
  });

  /* ---------- UI 缩放 ---------- */
  /**
   * **UI 缩放**（设置里的 slider）。
   *
   * 它是"乘在自动适配之上的额外倍数" —— 所以 120% 在任意窗口下
   * 都是"比自动适配再大 20%"。改它之后要手动 `refresh()` 一次：
   * `ResizeObserver` 不会因为"视口尺寸没变"而重新回调。
   */
  const savedScale = parseUiScale(d.settingsStore.uiScaleRaw, UI_SCALE_MIN, UI_SCALE_MAX);
  state.uiScale = savedScale ?? 1;
  /**
   * ⚠️ 这里**不**把 `uiScale` 推给场景：初值由"进战斗后的第一帧"推
   * （见 `loopWiring.ts`）；设置面板的滑块走 `settingsSetup.ts` 里那条
   * `setUiScale` 路径 —— 两条路都收口到 `state.uiScale`。
   */
  const observer = observeStage(stage, app.canvas, SCALING_MODE, () => {});

  /* ---------- 一局战斗 ---------- */
  /**
   * **启动开关**（`?prepare=skip` / `?boss=` / `?noai=1`）—— 读法与语义
   * 整块在 `./urlParams`（`game.ts` 又一次顶到 700 行，AGENTS.md §3 的横向
   * 切割）。这里只取结果。
   */
  const url = readUrlParams(globalThis.location.search);

  /**
   * **当前选中的出战单位**（备战界面的选择，进战斗时读到）。
   *
   * ⚠️ 它是**可变的**（`enterBattle` 会改它），而且 `startBattle` 每次开局
   * 都要读**当前**值 —— 所以下游一律通过取值函数拿它，不复制。
   */
  const selection = {
    /**
     * ⚠️ 初值直接取 `d.playerId`（`deps.ts` 已经 `resolvePlayerId` 过一次）
     * —— 键位按角色分存，那个值同时也是"启动时读的是谁的键位"，
     * 这里再 `resolvePlayerId` 一遍就是同一件事的第二份表达。
     */
    playerId: d.playerId,
    bossId: resolveBossId(d.settingsStore.bossIdRaw),
  };

  /**
   * 建"开始战斗"工厂。
   *
   * ⚠️ **只建工厂、不立刻开战**：工厂里的 `touchInput` 是取值函数，
   * 真正的 `touch` 在下面才装配（见文件头"顺序即正确性"第 3 条）。
   *
   * ⚠️ 传的是 **`registryFor`（按角色取注册表）**，不是一张固定的：
   * 注册表里装着技能表，而两个角色的技能不一样（林晚风有「卸」、
   * 凯丽有「截」与「闪」）。固定一张会让"换角色"只在界面上生效。
   */
  const startBattle = createStartBattle({
    registryFor: d.registryFor,
    getBindings: () => state.bindings,
    getSelection: () => selection,
    noAi: url.noAi,
    timeLimitMs: TIME_LIMIT_MS,
    touchInput: () => state.touch?.input,
  });

  /**
   * 取当前战斗循环（非战斗阶段为 `undefined`）。
   */
  const battle = (): BattleLoop | undefined => state.loop;

  /**
   * **相位流转**（`applyPhase` + 进战斗 / 切界面 / 返回）—— 整块在
   * `./phaseFlow`。
   *
   * ⚠️ 用户点过名："（`game.ts` 679 行）**先横向切**，再加东西 ——
   * `enterBattle` / `applyPhase` 那一段能切出去"。它是**一个完整的状态机**
   * （`applyPhase` + 四条转移路径 + 肉鸽开局），互相引用得很紧，拆成两半
   * 只会让读者来回跳。
   *
   * ⚠️ `selection` 由**这里**造（初值来自 `deps`）、交给它改：进战斗时
   * 选中的出战单位是**共享可变状态**，而"谁改它"只有 `enterBattle` 一处。
   */
  /**
   * **UI 缩放的唯一落实点**：场景 + **四个界面各自的边角控件**。
   *
   * ==================================================================
   * 为什么单提一个函数（实测踩到的一条）
   * ==================================================================
   *
   * 用户 2026-10-12："**UI 缩放要带上**"—— 齿轮从"一个挂 stage 上的共享
   * 组件"变成**每屏一个**之后，它们不会自己跟着任何东西走，必须逐个转发。
   *
   * ⚠️ 原先**两条**路径各推各的：设置滑块推场景、调试入口
   * （`__raidBattle.setUiScale`）也推场景。齿轮加进来之后只补了滑块那条，
   * 于是"探针里选角色 / 自由模式的 `chromeScale` 停在 1"—— / 而**战斗那一屏
   * 看起来完全正常**（它的齿轮挂在场景里，`BattleScene.setUiScale` 顺手
   * 带上了），这种"三屏坏一屏好"最难归因。所以两个入口都收口到**这里**。
   *
   * ⚠️ 触屏层与设置面板**不在这里**：面板按 `uiScale` 重排是它自己的事，
   * 触屏层的几何另有一套（见各自的文件）。
   */
  const applyUiScale = (scale: number): void => {
    scene.setUiScale(scale);
    screens.home.setUiScale(scale);
    screens.select.setUiScale(scale);
    screens.prepare.setUiScale(scale);
  };

  const flow = createPhaseFlow({
    state,
    store: d.settingsStore,
    registry: d.registry,
    selection,
    scene,
    startBattle,
  });
  const { applyPhase, enterBattle, switchTo, backFromBattle, backToHome, startRoguelikeRun } = flow;


  /* ---------- 整屏界面（首页 / 选角色 / 自由模式 / 返回箭头） ---------- */
  /**
   * ⚠️ 四个界面怎么建整块在 `./screenSetup`（`game.ts` 顶到 700 行，
   * AGENTS.md §3 的横向切割）。这里只负责**回填给 `state`** ——
   * `applyPhase` 的定义早于它们，所有访问点都容忍 `undefined`（见 `flow.ts`）。
   */
  const screens = buildScreens({
    app,
    showKeyHints: showKeyHintsNow,
    f1Label,
    /**
     * ⚠️ 三个整屏界面各自的齿轮都接到**同一个开关**上：它们不会同时
     * 存在（`applyPhase` 是显隐的唯一写入点），所以"谁被点到"没有歧义 ——
     * 而"齿轮摆哪儿、要不要返回箭头"由**各屏自己**决定（`screenSetup`）。
     */
    settingsToggle: () => settingsToggle,
    switchTo,
    startRun: (playerId) => startRoguelikeRun(playerId),
    onPrepareStart: (playerId, bossId) => enterBattle(playerId, bossId),
    rememberPick: (playerId, bossId) => d.settingsStore.savePick(playerId, bossId),
    backToHome,
    initial: { playerId: selection.playerId, bossId: selection.bossId },
  });
  state.home = screens.home;
  state.select = screens.select;
  state.prepare = screens.prepare;

  /**
   * **当前这一屏的边角控件**（齿轮 / 返回箭头）—— 键盘焦点与调试入口
   * 都问它，而不是各自记着"设置按钮"那**一个**对象。
   *
   * ⚠️ 这正是这一轮的核心：齿轮从"一个挂 stage 上的共享组件"变成
   * **四个界面各自的**（用户："多个页面的齿轮，应该分别定义"）。所以
   * 需要"当前是谁"时只能**按相位查**，不能再指着一个全局引用。
   */
  const getChrome = (): ScreenChrome | undefined => {
    if (state.phase === 'home') return screens.home.chrome;
    if (state.phase === 'characterSelect') return screens.select.chrome;
    if (state.phase === 'prepare') return screens.prepare.chrome;
    return scene.chrome;
  };

  /**
   * ⚠️ 开局默认在**首页**：一次性把三个界面与战斗场景的显隐摆好
   * （而不是各写一句 `setVisible` —— 那正是"漏一处就两个界面同时可见"）。
   */
  applyPhase('home');

  /**
   * ⚠️ 放在三个界面构造**之后**：`enterBattle` 走 `applyPhase`（会用到
   * 三个界面），早一步调用会碰到 TDZ。
   *
   * ⚠️ **`?prepare=skip` 照旧直接进战斗**（不经过首页）：截图工具依赖它
   * （见文件头那段说明）。`?boss=` / `?noai=1` 的行为也一字未变。
   */
  if (url.skipPrepare) enterBattle(selection.playerId, resolveBossId(url.boss ?? selection.bossId));

  /**
   * **操作方式**唯一的运行期写入点 —— 五件事整块在 `./operationMode`
   * （`game.ts` 顶到 700 行，AGENTS.md §3：拆 util + 注释一起搬）。
   */
  const applyOperationMode = (mode: OperationMode): void => {
    switchOperationMode(
      {
        state,
        store: d.settingsStore,
        registry: d.registry,
        scene,
        settings,
      },
      mode,
    );
  };

  /* ---------- 设置面板 / 开关 ---------- */
  const settingsSetup = createSettingsSetup({
    app,
    /** ⚠️ 按**当前选的人**取注册表（「按键」页只列他真能按出来的技能）。 */
    registry: () => d.registryFor(selection.playerId),
    state,
    settingsStore: d.settingsStore,
    battle,
    scene,
    applyUiScale,
    activeChrome: getChrome,
    onOperationModeChanged: (mode) => applyOperationMode(mode),
    /**
     * ⚠️ **改键的同步**（loop 由 `settingsSetup` 自己做）：画面技能格的
     * 键位提示。
     *
     * ⚠️ **不含触屏按钮** —— 按钮集合与键位表互不派生（用户 2026-10-12），
     * 改键不该动按钮。按钮那条走下面的 `onTouchButtonsChanged`。
     *
     * ⚠️ 走 `state.touch` 而不是闭包变量：这个回调在**用户改键时**才被调，
     * 那时触屏层早就在下面建好了；用闭包变量反而要先声明一个可能为空的
     * `let`，而那正是"两处真相"的开端。
     */
    onBindingsChanged: () => {
      /**
     * ⚠️ 键名提示读的是**唯一 flag**（不是触屏控件的 caps）——
     * 触屏控件不再是它的拥有者（见 `render/platform.ts` 文件头）。
     */
    scene.setShowKeyHints(showKeyHintsNow());
    },
    /**
     * ⚠️ **触屏按钮集合的同步**（另一条改动线）：触屏层按新集合重画。
     *
     * 与 `onBindingsChanged` 同一个"走 `state.touch` 而不是闭包变量"的理由。
     */
    onTouchButtonsChanged: (next) => {
      state.touch?.setButtons(next);
    },
  });
  const { settings, settingsToggle } = settingsSetup;

  /* ---------- 触屏层 ---------- */
  /**
   * ⚠️ 触屏控件（能力探测 + 布局 + 输入源 + 双弧按钮层）。与键盘并存。
   *
   * ⚠️ 它**必须晚于设置面板**（面板要接收 `touch` 的能力值 —— 见
   * `touchCapsSource` 的转交说明），但**必须早于第一次真正驱动战斗**：
   * `BattleLoop` 每帧通过 `() => state.touch?.input` 读它。`?prepare=skip`
   * 在上一段就建好了第一局 loop，但那只是建对象 —— `frame()` 要等主循环
   * 启动，那时触屏层已经就绪。
   */
  const touch = createTouchSetup({
    app: app,
    battle,
    isSettingsOpen: () => settingsToggle.isOpen(),
    /**
     * ⚠️ 判据是"**在战斗中**"而不是"在备战界面"：首页 / 选角色 / 自由模式
     * 都是**整屏界面**，双弧按钮浮在上面会与卡片重叠（设计稿 §8.2、
     * AGENTS.md §3b"触屏时整条技能栏都隐藏"）。
     */
    isBattleActive: () => state.phase === 'battle',
    /** ⚠️ 按钮集合是**用户自己选的**，与键位表无关（见 `touchLayout`）。 */
    touchSkillIds: () => state.touchButtons,
    mode: () => state.operationMode,
    scene,
  });
  state.touch = touch;

  /**
   * **现在哪一层在接收输入** —— 全应用唯一的那个取值。
   *
   * ⚠️ 三个消费者（指针路由 `canvasInput`、设置快捷键 `settingsKeys`、
   * 调试入口 `__raidBattle.logReview`）都从这里读，而不是各自拼
   * `phase === 'battle'`：复盘是 `battle` 相位里的**子模式**，
   * 各自拼一份就会漏掉它 —— 那正是这次的 bug。
   *
   * ⚠️ 它是**取值函数**而不是快照：`phase` / 面板开关都会变，
   * 快照一份就会永远停在装配那一刻。
   */
  const currentLayer = () =>
    activeInputLayer({
      phase: state.phase,
      settingsOpen: settingsToggle.isOpen(),
      reviewOpen: scene.logReview.isOpen(),
    });

  /* ---------- 画布指针接线 ---------- */
  /**
   * ⚠️ 抽到了 `app/canvasInput.ts` —— 那里集中写着"顺序即优先级"的
   * 那条清单（都是实测踩出来的），不在这里重复。
   *
   * ⚠️ **不再传"返回箭头 / 齿轮"这两个独立对象**：它们现在住在各自的
   * 界面里，指针路由只把点击交给**当前那一屏**（或战斗场景）的
   * `hitTest`，由那一屏自己先问它的边角控件（见各屏的 `hitTest`）。
   */
  wireCanvasPointer({
    canvas: app.canvas,
    home: screens.home,
    select: screens.select,
    prepare: screens.prepare,
    scene,
    settings,
    touch,
    /** ⚠️ 唯一 flag 的派生（"点屏幕离开战斗"只在触屏方式生效）。 */
    showKeyHints: showKeyHintsNow,
    phase: () => state.phase,
    settingsOpen: () => settingsToggle.isOpen(),
    /**
     * ⚠️ **复盘那一层**要递给指针路由 —— 它是 `battle` 相位里的子模式，
     * 只看相位会让"触屏点复盘"被当成"点屏幕离开战斗"（详见 `inputRouter`）。
     */
    review: () => scene.logReview,
    openSettings: () => settingsToggle.open('keys'),
    battleEnded: () => state.loop?.engineState.snapshot.status !== 'running',
    backFromBattle,
  });

  /* ---------- 设置界面的键盘 ---------- */
  /**
   * ⚠️ 抽到了 `app/settingsKeys.ts` —— 那里写着"必须用捕获阶段"与
   * "弹窗打开时独占键盘"两条由来，不在这里重复。
   *
   * ⚠️ **`acceptsKeyboardFocus` 不是 `phase === 'battle'`**（原先就是这么写的，
   * 那正是用户报的那个 bug）：复盘是 `battle` 相位里的**子模式**，
   * 一局结束仍然停在 `battle`，于是复盘开着时 `↑` 被设置按钮抢走、
   * 复盘收不到上下键。判据收口到 `inputRouter.activeInputLayer`
   * ——"只有输入层是 `battle` 时才允许"，复盘 / 设置面板开着都不允许。
   */
  const settingsKeys = wireSettingsKeys({
    settings,
    /**
     * ⚠️ 焦点落到**当前这一屏自己的齿轮**上（`getChrome()`）—— 不再是
     * 一个全局的设置按钮。四屏的齿轮是四个对象，问错人就会"点亮了看不见
     * 的那个"。
     */
    chrome: () => getChrome(),
    settingsOpen: () => settingsToggle.isOpen(),
    /**
     * ⚠️ **判据是"输入层是 `battle`"**（不是原先的 `state.phase === 'battle'`）：
     * 复盘是 `battle` 相位里的子模式，只看相位就会在复盘开着时把 `↑`
     * 判给设置按钮 —— 那正是用户报的那个 bug。判据收口在 `currentLayer`
     * （`inputRouter.activeInputLayer`），不是在这里再写一份。
     */
    acceptsKeyboardFocus: () => currentLayer() === 'battle',
    openSettings: () => settingsToggle.open('keys'),
    setHandling: (value) => {
      state.handlingKeyDown = value;
    },
  });
  /** 回填给非战斗界面的键盘处理（见 `flow.ts` 里那个字段的说明）。 */
  state.settingsButtonFocused = settingsKeys.isButtonFocused;

  return {
    /**
     * **启动**：接上主循环 / 键盘 / 调试入口。
     *
     * ⚠️ 界面**在 `createGame` 里就已经造好了**（包括 `?prepare=skip` 那次
     * 进入战斗），这里只负责"让它跑起来" —— 两件事分开，是为了让主干
     * 读起来是"造 → 跑"两步，而不是混在一起。
     */
    start(): void {
      /**
       * ⚠️ 传给 `wireLoop` 的是**一个包含 `battle()` 的对象**，而不是把
       * `enterBattle` 直接传进去：主循环每一帧都要读 `state.loop` /
       * `state.phase`（重开一局会换掉它们），快照一份就会永远停在第一局。
       */
      wireLoop({
        state,
        host: {
          home: screens.home,
          select: screens.select,
          prepare: screens.prepare,
          /**
           * ⚠️ **边角控件按相位取**（`getChrome()`）：每帧只更新**当前这一屏**
           * 的齿轮 / 返回箭头（键位提示跟着唯一 flag 走）。四屏各自的
           * `chrome.update()` 都在这里一次算清，不需要"切换方式时通知所有
           * 界面的所有齿轮"那张订阅表。
           */
          chrome: getChrome,
          settings,
          touch,
          scene,
          settingsToggle,
          backFromBattle,
          backToHome,
          battle,
        },
        app,
        stage,
        observer,
        /** 复盘那一层：键盘归属要问它（见 `WireOptions.review`）。 */
        review: scene.logReview,
      });

      installDebugApi({
        state,
        scene,
        app,
        /** ⚠️ 与设置滑块**同一个**落点（见 `applyUiScale` 的说明）。 */
        applyUiScale,
        settings,
        /**
         * ⚠️ 调试入口要的是**当前这一屏的齿轮**（`getChrome()`）——
         * `__raidBattle.settings.buttonFocused()` 正是用来分辨"没聚焦"与
         * "聚焦了但没画出来"的读数，问错屏就会永远读到 `false`。
         */
        chrome: getChrome,
        settingsToggle,
        home: screens.home,
        select: screens.select,
        prepare: screens.prepare,
        touch,
        /**
         * ⚠️ **输入归属**（调试 / 验证用）：一份纯函数的结果，脚本据此
         * 断言"复盘开着时这一层是 `review` 而不是 `battle`" ——
         * 那正是本次 bug 的判据，只看截图看不出"键被谁吃了"。
         */
        layer: currentLayer,
        restart: () => enterBattle(selection.playerId, selection.bossId),
      });
    },
  };
}
