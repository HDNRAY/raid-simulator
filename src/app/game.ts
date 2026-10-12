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
 *   settingsSetup.ts   new SettingsPanel + SettingsButton + settingsToggle
 *   touchSetup.ts      触屏层（能力 / 布局 / 输入源 / 双弧按钮）
 *   flow.ts            GameState（延后回填的共享状态）+ Phase
 *   loopWiring.ts      Pixi ticker / 键盘 / pagehide
 *   debugApiSetup.ts   window.__raidBattle
 * ```
 *
 * ==================================================================
 * ⚠️ 顺序即正确性：这些"先后关系"不许整理
 * ==================================================================
 *
 *   1. **先备战界面、后 `?prepare=skip` 的进入战斗** ——
 *      `enterBattle` 会调 `prepare.setVisible` / `scene.setAppearance` /
 *      `startBattle`，`prepare` 早一步调用会撞 TDZ。
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
 *   5. **调试入口与设置齿轮的回填一起做**（`installDebugApi` 末尾）——
 *      见那里的说明；`?prepare=skip` 就靠它把按钮摆回战斗界面的位置。
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { BattleScene } from '../render/BattleScene';
import { PrepareScreen } from '../ui/PrepareScreen';
import { BOSS_ROSTER, PLAYER_ROSTER, resolveBossId, resolvePlayerId } from '../data/roster';
import { translator } from '../i18n/translator';
import { observeStage } from '../render/sizes';
import { UI_SCALE_MAX, UI_SCALE_MIN, type ScalingMode } from '../render/scaling';
import { parseUiScale } from './settingsStore';
import { createStartBattle } from './battleSetup';
import { createGameState } from './flow';
import { createSettingsSetup } from './settingsSetup';
import { createTouchSetup } from './touchSetup';
import { installDebugApi } from './debugApiSetup';
import { wireLoop } from './loopWiring';
import { wireCanvasPointer } from './canvasInput';
import { wireSettingsKeys } from './settingsKeys';
import { translateSafe } from './translate';
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
  const state = createGameState(d.bindings);

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
   * **跳过备战界面直接进战斗**：`?prepare=skip`（端到端脚本用）。
   *
   * ⚠️ 用 URL 参数而不是"再加一个调试方法"：后者是**旁路**，而备战界面是
   * 真实入口的一部分（"点开始"本身也会坏）。走参数则与玩家同一条路。
   * ⚠️ 只有显式带这个参数才生效 —— 线上地址没有它，玩家路径一字未变。
   */
  const params = new URLSearchParams(globalThis.location.search);
  const skipPrepare = params.get('prepare') === 'skip';

  /**
   * `?boss=lust` —— 指定对手（截图 / 调试用）。
   *
   * ⚠️ 与 `?prepare=skip` 配合使用：`?prepare=skip&boss=lust` 直接开一局
   * 打色欲。单独给 `?boss=` 只在跳过备战时才有意义（否则备战界面会按
   * 存储里的选择走）。
   */
  const bossParam = params.get('boss');

  /**
   * **当前选中的出战单位**（备战界面的选择，进战斗时读到）。
   *
   * ⚠️ 它是**可变的**（`enterBattle` 会改它），而且 `startBattle` 每次开局
   * 都要读**当前**值 —— 所以下游一律通过取值函数拿它，不复制。
   */
  const selection = {
    playerId: resolvePlayerId(d.settingsStore.playerIdRaw),
    bossId: resolveBossId(d.settingsStore.bossIdRaw),
  };

  /**
   * 建"开始战斗"工厂。
   *
   * ⚠️ **只建工厂、不立刻开战**：工厂里的 `touchInput` 是取值函数，
   * 真正的 `touch` 在下面才装配（见文件头"顺序即正确性"第 3 条）。
   */
  const startBattle = createStartBattle({
    registry: d.registry,
    getBindings: () => state.bindings,
    getSelection: () => selection,
    noAi: params.get('noai') === '1',
    timeLimitMs: TIME_LIMIT_MS,
    touchInput: () => state.touch?.input,
  });

  /**
   * 取当前战斗循环（备战阶段为 `undefined`）。
   */
  const battle = (): BattleLoop | undefined => state.loop;

  /**
   * 备战界面的「开始」回调。
   *
   * ⚠️ **可变引用 + 延后回填**：`enterBattle` 定义在下面（它要读
   * `selection`，而 `selection` 又要 `settingsStore`），但 `PrepareScreen`
   * 得先构造出来才能显示。这个转交点让定义顺序不再互相牵制。
   */
  let onPrepareStart: (playerId: string, bossId: string) => void = () => {};

  /**
   * **进入战斗**：建一局新战斗、藏起备战界面。
   *
   * ⚠️ 与 `backToPrepare` 成对：两者各自负责好**场景 / 触屏层 / 面板**的
   * 显隐，任何一条路径漏掉一个开关都会出现"两个界面同时可见"。
   */
  const enterBattle = (playerId: string, bossId: string): void => {
    selection.playerId = resolvePlayerId(playerId);
    selection.bossId = resolveBossId(bossId);
    d.settingsStore.savePick(selection.playerId, selection.bossId);

    /**
     * ⚠️ **先换形象再开战**（需求：玩家与 Boss 都要播 idle / attack 动画）。
     *
     * 放在这里而不是 `BattleSceneOptions`：一局战斗的出战单位**在这里**
     * 才定下来，而场景只在启动时建一次（构造参数换不了）。同时它也覆盖
     * "重开换了个对手" —— 结算面板的 `restart` 也走本函数。
     */
    scene.setAppearance(selection.playerId, selection.bossId);

    state.loop?.dispose();
    state.loop = startBattle();
    state.phase = 'battle';
    state.prepare?.setVisible(false);
    scene.root.visible = true;
    state.onScreenChange('battle');
  };
  onPrepareStart = (playerId: string, bossId: string): void => enterBattle(playerId, bossId);

  /**
   * 回到**备战界面**（而不是直接重开一局）。
   *
   * 需求："选人物 和 选boss，然后点开始才开始" —— 那"再来一次"自然也
   * 该先回备战，让玩家有机会换对手。
   */
  const backToPrepare = (): void => {
    state.loop?.dispose();
    state.loop = undefined;
    state.phase = 'prepare';
    state.prepare?.setVisible(true);
    /**
     * ⚠️ 战斗场景直接改 `root.visible`；触屏层的显隐由 `touch.frame`
     * 每帧按 `isPrepareOpen()` 决定 —— 那里的**唯一写入点**不该被绕过。
     */
    scene.root.visible = false;
    /**
     * ⚠️ 走 `state.settingsButton`（可能还没回填）：`backToPrepare` 的
     * 定义早于设置面板的构造 —— 这个顺序是 `?prepare=skip` 需要的
     * （见文件头"顺序即正确性"第 1 条），所以这里必须容忍 `undefined`。
     */
    state.settingsButton?.update();
    state.onScreenChange('prepare');
  };

  /* ---------- 备战界面 ---------- */
  const prepare = new PrepareScreen({
    pixi: { Container, Graphics, Sprite, Text },
    translate: translateSafe,
    players: PLAYER_ROSTER,
    bosses: BOSS_ROSTER,
    initial: { playerId: selection.playerId, bossId: selection.bossId },
    onStart: (playerId: string, bossId: string) => onPrepareStart(playerId, bossId),
    onChange: (playerId: string, bossId: string) => d.settingsStore.savePick(playerId, bossId),
  });
  state.prepare = prepare;
  app.stage.addChild(prepare.root);
  /**
   * ⚠️ 开局默认在**备战**：战斗场景先藏起来，否则会从备战界面下面露出来。
   */
  scene.root.visible = false;
  prepare.setVisible(true);

  /**
   * ⚠️ 放在 `prepare` 构造**之后**：`enterBattle` 会用到 `prepare.setVisible`，
   * 早一步调用会碰到 TDZ。
   */
  if (skipPrepare) enterBattle(selection.playerId, resolveBossId(bossParam ?? selection.bossId));

  /* ---------- 设置面板 / 齿轮 / 开关 ---------- */
  const settingsSetup = createSettingsSetup({
    app,
    registry: d.registry,
    state,
    settingsStore: d.settingsStore,
    battle,
    scene,
    /**
     * ⚠️ **改键的另外两处同步**（loop 由 `settingsSetup` 自己做）：
     * 触屏按钮与画面技能格的键位提示。
     *
     * ⚠️ 走 `state.touch` 而不是闭包变量：这个回调在**用户改键时**才被调，
     * 那时触屏层早就在下面建好了；用闭包变量反而要先声明一个可能为空的
     * `let`，而那正是"两处真相"的开端。
     */
    onBindingsChanged: (next) => {
      state.touch?.setBindings(next);
      if (state.touch !== undefined) scene.setShowKeyHints(state.touch.caps.showKeyHints);
    },
  });
  const { settings, settingsButton, settingsToggle, touchPreviewSource } = settingsSetup;
  /** 回填给 `backToPrepare`（它的定义早于这一句，见 `flow.ts` 的说明）。 */
  state.settingsButton = settingsButton;

  /* ---------- 触屏层 ---------- */
  /**
   * ⚠️ 触屏控件（能力探测 + 布局 + 输入源 + 双弧按钮层）。与键盘并存。
   *
   * ⚠️ 它**必须晚于设置面板**（面板要接收 `touch` 的能力值 —— 见
   * `touchPreviewSource` 的转交说明），但**必须早于第一次真正驱动战斗**：
   * `BattleLoop` 每帧通过 `() => state.touch?.input` 读它。`?prepare=skip`
   * 在上一段就建好了第一局 loop，但那只是建对象 —— `frame()` 要等主循环
   * 启动，那时触屏层已经就绪。
   */
  const touch = createTouchSetup({
    app: app,
    registry: d.registry,
    battle,
    isSettingsOpen: () => settingsToggle.isOpen(),
    isPrepareOpen: () => state.phase === 'prepare',
    bindings: () => state.bindings,
    scene,
    settingsButton,
    previewSource: touchPreviewSource,
  });
  state.touch = touch;

  /* ---------- 界面切换时通知设置按钮 ---------- */
  /**
   * 这里的回填只是"接线"，真正的**补调用一次**在 `installDebugApi` 里 ——
   * 两件事必须在一起看（见那里的说明）。
   */
  const onScreenChange = (screen: 'prepare' | 'battle'): void => settingsButton.setScreen(screen);
  state.onScreenChange = onScreenChange;

  /* ---------- 画布指针接线 ---------- */
  /**
   * ⚠️ 抽到了 `app/canvasInput.ts` —— 那里集中写着"顺序即优先级"的
   * 三条规则（都是实测踩出来的），不在这里重复。
   */
  wireCanvasPointer({
    canvas: app.canvas,
    prepare,
    settings,
    settingsButton,
    touch,
    phase: () => state.phase,
    settingsOpen: () => settingsToggle.isOpen(),
    openSettings: () => settingsToggle.open('keys'),
    battleEnded: () => state.loop?.engineState.snapshot.status !== 'running',
    backToPrepare,
  });

  /* ---------- 设置界面的键盘 ---------- */
  /**
   * ⚠️ 抽到了 `app/settingsKeys.ts` —— 那里写着"必须用捕获阶段"与
   * "弹窗打开时独占键盘"两条由来，不在这里重复。
   *
   * ⚠️ `acceptsKeyboardFocus` 只在**战斗**为真：备战界面里 `↑↓` 是
   * 换槽位的，不能被设置按钮抢走（那里 `Esc` / `,` 照样能开设置）。
   * 由来见 `settingsKeys.ts` 里那个方法的注释。
   */
  const settingsKeys = wireSettingsKeys({
    settings,
    settingsButton,
    settingsOpen: () => settingsToggle.isOpen(),
    acceptsKeyboardFocus: () => state.phase === 'battle',
    openSettings: () => settingsToggle.open('keys'),
    setHandling: (value) => {
      state.handlingKeyDown = value;
    },
  });
  /** 回填给备战界面的键盘处理（见 `flow.ts` 里那个字段的说明）。 */
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
          prepare,
          settings,
          settingsButton,
          touch,
          scene,
          settingsToggle,
          backToPrepare,
          battle,
        },
        app,
        stage,
        observer,
      });

      /**
       * ⚠️ 调试入口里会**补一次 `onScreenChange`** —— `?prepare=skip` 时
       * `enterBattle` 早于齿轮按钮构造，那一次摆位打在空函数上。
       * 见 `debugApiSetup.ts` 末尾的说明。
       */
      installDebugApi({
        state,
        scene,
        app,
        settings,
        settingsButton,
        settingsToggle,
        prepare,
        touch,
        restart: () => enterBattle(selection.playerId, selection.bossId),
      });
    },
  };
}
