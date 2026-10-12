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
 *   flow.ts            GameState（延后回填的共享状态）
 *   phaseLogic.ts      Phase + "哪个相位能返回 / 显示哪个控件"的判定
 *   loopWiring.ts      Pixi ticker / 键盘 / pagehide
 *   debugApiSetup.ts   window.__raidBattle
 * ```
 *
 * ==================================================================
 * ⚠️ 顺序即正确性：这些"先后关系"不许整理
 * ==================================================================
 *
 *   1. **先造三个界面（首页 / 选角色 / 自由模式）+ 返回箭头、后
 *      `?prepare=skip` 的进入战斗** —— `enterBattle` 会走 `applyPhase`
 *      （它一次性重设三个界面、返回箭头与战斗场景的显隐）与
 *      `scene.setAppearance` / `startBattle`，界面早一步调用会撞 TDZ。
 *      返回箭头也在这批里：它的显隐同样由 `applyPhase` 写，而且要挂在
 *      三个界面**上面**（后 `addChild` 的盖在上面）。
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
import { HomeScreen } from '../ui/HomeScreen';
import { CharacterSelectScreen } from '../ui/CharacterSelectScreen';
import { ScreenControls } from '../ui/ScreenControls';
import {
  BOSS_POOL,
  BOSS_ROSTER,
  PLAYER_ROSTER,
  resolveBossId,
  resolvePlayerId,
} from '../data/roster';
import { translator } from '../i18n/translator';
import { observeStage } from '../render/sizes';
import { UI_SCALE_MAX, UI_SCALE_MIN, type ScalingMode } from '../render/scaling';
import { parseUiScale } from './settingsStore';
import { createStartBattle } from './battleSetup';
import { createRunSession } from './runSession';
import { createGameState, settingsAnchorOf } from './flow';
import { CONTROL_VISIBILITY, phaseFromEscape } from './phaseLogic';
import { createSettingsSetup } from './settingsSetup';
import { createTouchSetup } from './touchSetup';
import { installDebugApi } from './debugApiSetup';
import { wireLoop } from './loopWiring';
import { wireCanvasPointer } from './canvasInput';
import { wireSettingsKeys } from './settingsKeys';
import { translateSafe } from './translate';
import type { BattleLoop } from './battleLoop';
import type { GameDeps } from './deps';
import type { Phase } from './flow';
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
   *
   * ⚠️ 传的是 **`registryFor`（按角色取注册表）**，不是一张固定的：
   * 注册表里装着技能表，而两个角色的技能不一样（林晚风有「卸」、
   * 凯丽有「截」与「闪」）。固定一张会让"换角色"只在界面上生效。
   */
  const startBattle = createStartBattle({
    registryFor: d.registryFor,
    getBindings: () => state.bindings,
    getSelection: () => selection,
    noAi: params.get('noai') === '1',
    timeLimitMs: TIME_LIMIT_MS,
    touchInput: () => state.touch?.input,
  });

  /**
   * 取当前战斗循环（非战斗阶段为 `undefined`）。
   */
  const battle = (): BattleLoop | undefined => state.loop;

  /**
   * **一局肉鸽的持有者**（P2 只有一场，见 `runSession.ts` 文件头的桩说明）。
   *
   * ⚠️ 它的存在同时回答了"当前战斗是不是肉鸽那一场"—— 所以**没有**
   * 另设一个 `mode: 'roguelike' | 'free'` 字段（两份真相会漂）。
   * ⚠️ 种子在这里生成（`Date.now() >>> 0`）：`app/` 层允许非确定性，
   * `core/` 不许（lint C2）—— 与 `battleSetup.ts` 给战斗种子的做法一致。
   */
  const runSession = createRunSession({ bossPool: BOSS_POOL.map((b) => b.id) });

  /**
   * **界面路由的唯一落实点**：把 `phase` 写进状态，并一次性重设
   * **三个界面 + 战斗场景**的显隐。
   *
   * ==================================================================
   * 为什么要有这个函数（这个仓库踩过的坑）
   * ==================================================================
   *
   * `phase` 的消费者分布在 4 个文件（`loopWiring` ×2、`canvasInput`、
   * `game` ×2 …），而"两个界面同时可见"历来是**漏改一处**的结果 ——
   * 因为每个转移函数都自己手动 `setVisible`，加一个界面就要在每条路径上
   * 各补一次。
   *
   * 所以显隐只在这里写：任何转移路径都**必须**走 `applyPhase`，
   * 而它把四个开关一次算清（哪个 phase 显示哪一块是**一张表**）。
   * 于是"加一个新界面"只需要改这一张表，而不是每条路径。
   *
   * ⚠️ 触屏层的显隐**不在这里**：它由 `touchControls.frame` 每帧按
   * `isBattleActive()` 决定（那里的"唯一写入点"不该被绕过 —— 与
   * `backToPrepare` 时代同一条纪律）。
   */
  const applyPhase = (phase: Phase): void => {
    state.phase = phase;
    state.home?.setVisible(phase === 'home');
    state.select?.setVisible(phase === 'characterSelect');
    state.prepare?.setVisible(phase === 'prepare');
    /**
     * ⚠️ 返回箭头（左上角）也走这张表 —— 它的可见相位与"哪个相位按 `Esc`
     * 会回首页"是**同一个判据**（`phaseLogic.backVisibleIn`）。
     * 两处各写一遍就会漂，而漂移的样子正是"箭头看得见、按 Esc 却不动"
     * （或反过来）。同理它在 `battle` / `home` 不出现。
     */
    state.back?.setVisible(CONTROL_VISIBILITY.back(phase));
    scene.root.visible = phase === 'battle';
    /**
     * ⚠️ 走 `state.settingsButton`（可能还没回填）：`applyPhase` 的定义早于
     * 设置面板的构造 —— 这个顺序是 `?prepare=skip` 需要的（见文件头
     * "顺序即正确性"第 1 条），所以这里必须容忍 `undefined`。
     */
    state.settingsButton?.update();
    state.onScreenChange(phase);
  };

  /**
   * 备战界面的「开始」回调。
   *
   * ⚠️ **可变引用 + 延后回填**：`enterBattle` 定义在下面（它要读
   * `selection`，而 `selection` 又要 `settingsStore`），但 `PrepareScreen`
   * 得先构造出来才能显示。这个转交点让定义顺序不再互相牵制。
   */
  let onPrepareStart: (playerId: string, bossId: string) => void = () => {};

  /**
   * **进入战斗**：建一局新战斗，并把界面切到 `battle`。
   *
   * ⚠️ 显隐全部交给 `applyPhase`：任何一条进入战斗的路径（备战开始、
   * 选角色开始、`?prepare=skip`、`restart`）都走这里，不会各自漏一个开关。
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

    /**
     * ⚠️ **触屏按钮要按"这一局有哪些技能"重派生一次**（2026-10-12）。
     *
     * 触屏按钮由键位表机械派生（AGENTS.md §3b），而键位表是整场游戏的
     * （Q 斩 / S 防 / A 避…）。两个角色的技能不一样 —— 不过滤的话凯丽的
     * 双弧上会多出「防」「避」两个按不出东西的按钮。
     *
     * ⚠️ 过滤的判据在触屏层里读**引擎的技能集**（`currentSkillIds`），
     * 所以这里只需在**换局之后**通知它一次；换角色之后再开一局就会
     * 重新派生。放在 `applyPhase` **之前**与显隐无关（那时按钮整层隐藏）。
     */
    state.touch?.setBindings(state.bindings);

    applyPhase('battle');
  };
  onPrepareStart = (playerId: string, bossId: string): void => enterBattle(playerId, bossId);

  /**
   * 切到某个**全屏界面**，并释放当前这一局的战斗循环（如果有）。
   *
   * 需求（自由模式）："再来一次"先回备战，让玩家有机会换对手。
   * 需求（肉鸽模式）：一场打完回**选角色**（P2 的桩，见 `runSession.ts`）。
   *
   * ⚠️ **释放循环必须在这里**（而不是留给 `applyPhase`）：`BattleLoop`
   * 每帧被主循环驱动，留着不放会继续跑一场已经看不到的战斗
   * （而且下一局 `enterBattle` 还会再建一个 —— 两个循环同时推进）。
   */
  const switchTo = (target: 'home' | 'characterSelect' | 'prepare'): void => {
    state.loop?.dispose();
    state.loop = undefined;
    applyPhase(target);
  };

  /**
   * 战斗结束（结算面板按 Enter / 触屏点屏）之后的去向。
   *
   * ⚠️ **按模式分流**，而且判据只有一个：`runSession.active`（有没有
   * 没结束的一局肉鸽）。加一个 `mode` 字段就会多一个可能与它打架的真相源。
   *
   * ⚠️ 肉鸽这一支是**临时的桩**：P2 只打一场就 `clear()`（回选角色）；
   * P3 会在这里改成"推进到下一场 + 进炁机选择"（见 `runSession.ts`）。
   */
  const backFromBattle = (): void => {
    if (runSession.active) {
      runSession.clear();
      switchTo('characterSelect');
      return;
    }
    switchTo('prepare');
  };

  /**
   * **返回首页**（用户 2026-10-12："肯定要加返回啊"）。
   *
   * 两条路都落到这里：
   *   - 键盘 `Esc`（`loopWiring` 的 `backToHome`）
   *   - 触屏 / 鼠标点左上角的箭头（`ScreenControls.onBack`）
   *
   * ⚠️ 只对**自由模式 / 选角色屏**成立 —— 判据在 `phaseFromEscape`
   * （`phaseLogic.ts`）里，与箭头的可见相位**同一张表**。战斗与首页
   * 都返回 `undefined`，于是这里什么都不做（战斗中 `Esc` 不做事是
   * 用户的判断，见那个函数的说明）。
   */
  const backToHome = (): void => {
    const target = phaseFromEscape(state.phase);
    if (target !== undefined) switchTo(target);
  };

  /**
   * **肉鸽模式：选完角色，开始一局**。
   *
   * Boss 由这一局的**种子洗出来**（`runSession.begin`）—— 不是备战界面
   * 里选的那个对手。这是肉鸽与自由模式的核心差别（设计稿 §3.4：
   * 备战的核心能力是"玩家直接挑 Boss"，与"顺序随机"语义冲突）。
   *
   * ⚠️ 洗牌走 `core/run/` 自己的随机流（§7.1），不碰 `BattleState.rngSeed`。
   */
  const startRoguelikeRun = (playerId: string): void => {
    runSession.begin(playerId, Date.now() >>> 0);
    const bossId = runSession.bossId();
    /**
     * `BOSS_POOL` 为空才会走到这里（现在有 2 个）。**留在选角色屏**，
     * 而不是开始一场打不存在的 Boss 的假战斗 —— 那种静默失败更难查。
     */
    if (bossId === undefined) {
      runSession.clear();
      applyPhase('characterSelect');
      return;
    }
    enterBattle(playerId, bossId);
  };

  /* ---------- 首页（默认入口） ---------- */
  /**
   * 需求："有一个**新的首页**，首页可以选进入肉鸽模式，或者自由" +
   * "默认入口：首页"。
   *
   * ⚠️ 首页只是**路由**：它不通向半成品，所以现在就能当默认入口。
   */
  const home = new HomeScreen({
    pixi: { Container, Graphics, Sprite, Text },
    translate: translateSafe,
    showKeyHints: () => state.touch?.caps.showKeyHints ?? true,
    onPick: (action) => {
      /**
       * 「自由模式」= 原来的备战界面（标题已改成「自由模式」）；
       * 「肉鸽模式」= 先选角色（设计稿 §3.1：**进入肉鸽才是选角色**）。
       */
      if (action === 'free') switchTo('prepare');
      else switchTo('characterSelect');
    },
  });
  state.home = home;
  app.stage.addChild(home.root);

  /* ---------- 选角色屏（肉鸽模式的第一屏） ---------- */
  const select = new CharacterSelectScreen({
    pixi: { Container, Graphics, Sprite, Text },
    translate: translateSafe,
    players: PLAYER_ROSTER,
    initialPlayerId: selection.playerId,
    showKeyHints: () => state.touch?.caps.showKeyHints ?? true,
    onStart: (playerId: string) => startRoguelikeRun(playerId),
  });
  state.select = select;
  app.stage.addChild(select.root);

  /* ---------- 备战界面（自由模式） ---------- */
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

  /* ---------- 返回箭头（整屏界面共用） ---------- */
  /**
   * 需求（用户 2026-10-12）："肯定要加返回啊" + "把设置的快捷键改成别的
   * 比如 f1"（`Esc` 腾出来做返回）。
   *
   * ⚠️ **触屏对等**（AGENTS.md §3b）：`Esc` 只有键盘按得出，所以这一屏
   * 左上角必须有一个**可见、可点**的箭头 —— 它就是本组件。
   *
   * ⚠️ 它挂在 stage 上（与设置齿轮同一层），**不画进任何一个屏**：
   * 两个界面共用一份实现，否则"选角色屏的箭头能点、自由模式的不行"
   * 只是时间问题。
   *
   * ⚠️ 显隐的唯一写入点仍是 `applyPhase`（上面那行
   * `CONTROL_VISIBILITY.back`）；本对象自己**不**决定何时可见。
   */
  const back = new ScreenControls({
    pixi: { Container, Graphics, Sprite, Text },
    showKeyHints: () => state.touch?.caps.showKeyHints ?? true,
    /**
     * ⚠️ 与键盘 `Esc` 走**同一个**闭包（`backToHome`）—— 目标相位、
     * "战斗里不做事"这些判断只有一份，不会出现"按 Esc 回首页、
     * 点箭头去别处"。
     */
    onBack: () => backToHome(),
  });
  state.back = back;
  app.stage.addChild(back.root);

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
  /** 回填给 `applyPhase`（它的定义早于这一句，见 `flow.ts` 的说明）。 */
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
    /**
     * ⚠️ 判据是"**在战斗中**"而不是"在备战界面"：首页 / 选角色 / 自由模式
     * 都是**整屏界面**，双弧按钮浮在上面会与卡片重叠（设计稿 §8.2、
     * AGENTS.md §3b"触屏时整条技能栏都隐藏"）。
     */
    isBattleActive: () => state.phase === 'battle',
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
   *
   * ⚠️ 映射走 `settingsAnchorOf`（`flow.ts`）：`debugApiSetup.ts` 也要用
   * 同一条映射，两处各写一遍三元表达式就是两份会漂的真相。
   */
  const onScreenChange = (screen: Phase): void =>
    settingsButton.setScreen(settingsAnchorOf(screen));
  state.onScreenChange = onScreenChange;

  /* ---------- 画布指针接线 ---------- */
  /**
   * ⚠️ 抽到了 `app/canvasInput.ts` —— 那里集中写着"顺序即优先级"的
   * 那条清单（都是实测踩出来的），不在这里重复。
   */
  wireCanvasPointer({
    canvas: app.canvas,
    home,
    select,
    prepare,
    back,
    settings,
    settingsButton,
    touch,
    phase: () => state.phase,
    settingsOpen: () => settingsToggle.isOpen(),
    openSettings: () => settingsToggle.open('keys'),
    battleEnded: () => state.loop?.engineState.snapshot.status !== 'running',
    backFromBattle,
  });

  /* ---------- 设置界面的键盘 ---------- */
  /**
   * ⚠️ 抽到了 `app/settingsKeys.ts` —— 那里写着"必须用捕获阶段"与
   * "弹窗打开时独占键盘"两条由来，不在这里重复。
   *
   * ⚠️ `acceptsKeyboardFocus` 只在**战斗**为真：自由模式里 `↑↓` 换槽位、
   * 首页里 `↑↓` 移动光标，都不能被设置按钮抢走（那些界面 `F1`
   * 照样能开设置）。由来见 `settingsKeys.ts` 里那个方法的注释。
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
          home,
          select,
          prepare,
          back,
          settings,
          settingsButton,
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
        home,
        select,
        prepare,
        back,
        touch,
        restart: () => enterBattle(selection.playerId, selection.bossId),
      });
    },
  };
}
