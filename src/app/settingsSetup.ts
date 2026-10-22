/**
 * **设置面板的装配**（`new SettingsPanel(...)` + 齿轮按钮 + 开关）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 用户原话："什么**开始战斗**，**new settingspanel**，这些都不应该在这，
 * **main.ts 只应该保留主干**"。
 *
 * 这一块有 90 多行，全是"面板要读哪些活的量、齿轮点了接哪儿"的接线。
 * 抽出来之后 `main.ts` 只剩下 `createGame()` 里的一句
 * `createSettingsSetup(...)`，而**设置这块的顺序约束**（面板必须先于
 * 触屏层、齿轮的回填要补一次）集中在一处能看到全貌。
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { SettingsPanel } from '../ui/settings/SettingsPanel';
import { buildSettingsOptions } from './settingsPanelOptions';
import { createSettingsToggle, type SettingsToggle } from './settingsToggle';
import { settingsOriginOf } from './phaseLogic';
import { clampUiScale } from '../render/scaling';
import { translateSafe } from './translate';
import type { OperationMode } from '../render/platform';
import type { SettingsStore } from './settingsStore';
import type { ContentRegistry } from '../core/content/registry';
import type { KeyBinding } from '../input/keyboard';
import type { BattleLoop } from './battleLoop';
import type { GameState } from './flow';

/** 齿轮里、设置面板需要认识的**唯一**一件事：面板开合时藏 / 显示它。 */
export interface SettingsGearTarget {
  setGearVisible(visible: boolean): void;
}

/** 设置装配需要的外部依赖。 */
export interface SettingsSetupDeps {
  /** Pixi 应用（设置面板挂在它的 stage 上）。 */
  readonly app: {
    readonly stage: { addChild(child: unknown): unknown };
  };
  /**
   * **当前出战角色的注册表**（取值函数）—— 「按键」页按它列技能
   * （用户 2026-10-12："根据当前选的人，设置里决定显示谁的技能"）。
   *
   * ⚠️ 是取值函数：备战界面改人选之后，键位表要跟着换。
   */
  readonly registry: () => ContentRegistry;
  readonly settingsStore: SettingsStore;
  /** 当前战斗循环（备战阶段为 `undefined`）。 */
  readonly battle: () => BattleLoop | undefined;
  /**
   * UI 缩放的落点（渲染层的 UI 部件）。
   * ⚠️ 见下面 `setUiScale` 里"不重测画布"那条注释。
   */
  readonly scene: {
    setUiScale(scale: number): void;
  };
  /**
   * **落实一次 UI 缩放**（设置面板的滑块走这里）。
   *
   * ⚠️ 用户 2026-10-12："UI 缩放要带上"。齿轮从"一个挂 stage 上的共享组件"
   * 变成**每屏一个**之后，缩放必须**四处一起**走 —— 但那件事**不在本模块**：
   * 它是"这一局有哪几块 UI"的整体知识，住在 `game.ts`（`applyUiScale`）。
   * 这里只负责"滑块动了 → 叫它一声"，于是设置模块不逐个认识四个界面。
   *
   * ⚠️ 这也是**唯一**的缩放入口：调试入口（`__raidBattle.setUiScale`）与
   * 设置滑块都调它。两条路各写一遍必然漂 —— 实测踩到过：调试入口只推给
   * 了场景，于是"探针里选角色 / 自由模式的齿轮没跟着缩放"，而战斗那一屏
   * 看起来正常（它的缩放本来就在场景里）。
   */
  readonly applyUiScale: (scale: number) => void;
  /**
   * **设置弹窗底部「回主菜单」**（2026-10-22）：装配方（`game.ts`）在这里
   * 弹二次确认，确认后才关面板 + 切回首页。
   */
  readonly exitToHome: () => void;
  /** 当前相位对应的那个齿轮（`game.ts` 的 `getChrome()`）—— 面板开合时藏它。 */
  readonly activeChrome: () => SettingsGearTarget | undefined;
  /**
   * 键位表被改之后的**另一处同步**（`loop` 已经在上面做过）：画面技能格
   * 的键位提示。
   *
   * ⚠️ 它**不再**包含触屏按钮 —— 按钮集合与键位表互不派生，改键不该动它
   * （见 `settingsPanelOptions.ts` 文件头）。
   */
  readonly onBindingsChanged: (next: readonly KeyBinding[]) => void;
  /**
   * **触屏按钮集合**被改之后的同步（触屏层重画）。
   *
   * ⚠️ 与 `onBindingsChanged` 分开：两条改动线互不派生（用户 2026-10-12）。
   */
  readonly onTouchButtonsChanged: (next: readonly string[]) => void;
  /**
   * 用户在「通用」页切了**操作方式**（键盘 / 触屏）—— 唯一 flag 的写入点。
   *
   * ⚠️ 面板**不自己存**这件事：它要同时改 `GameState.operationMode`、
   * 存档、以及键位表读哪一份（那三件事分属不同模块）—— 所以面板只发通知，
   * 落点在 `game.ts` 的 `applyOperationMode`。
   */
  readonly onOperationModeChanged: (mode: OperationMode) => void;
  /**
   * 与触屏输入源无关的那部分可变状态。
   *
   * ⚠️ `phase` / `bindings` / `touchButtons` / `uiScale` /
   * `settingsButtonFocused` / `handlingKeyDown` 都住在这里 —— 它们各自有
   * **多个写入点**（相位转移、改键、触屏键位、缩放滑块、键盘焦点），
   * 拆成 `let` 就会在多模块间各持一份真相。
   *
   * ⚠️ `phase` 是这一轮进来的：设置面板要按"从哪打开"决定显示哪几页
   * （`settingsOriginOf`），而相位是那个判据的输入。
   */
  readonly state: Pick<
    GameState,
    | 'phase'
    | 'bindings'
    | 'touchButtons'
    | 'uiScale'
    | 'operationMode'
    | 'settingsButtonFocused'
    | 'handlingKeyDown'
  >;
}

/** `createSettingsSetup()` 的产物。 */
export interface SettingsSetup {
  readonly settings: SettingsPanel;
  readonly settingsToggle: SettingsToggle;
}

/**
 * 造设置面板 + 开关（**不再造齿轮**）。
 *
 * ⚠️ 齿轮从"一个共享的 `SettingsButton`"变成**四个界面各自持有**的
 * `ScreenChrome`（用户 2026-10-12："多个页面的齿轮，应该分别定义"、
 * "stage 上理论上不挂任何小组件"）—— 那四个对象由各自的界面构造
 * （`screenSetup` / `BattleScene`），本函数只负责把"缩放"与"面板开合时
 * 藏齿轮"接到它们身上。
 *
 * ⚠️ **顺序**：面板 → 开关。
 *   开关只能读 `battle()?.isPaused`（**取值函数**，不是构造期的值）——
 *   所以"设置比战斗循环晚"或"比它早"都不影响 `isPaused` 的解析：
 *   它只在 `open()` / `close()` 时被调用，那时战斗状态已经就绪。
 *
 * ⚠️ **不再有"能力值转交点"**：操作方式住在 `GameState.operationMode`
 * （唯一 flag），面板与触屏层都只是它的读者 —— 没有"谁先构造谁产出"，
 * 也就没有占位值/回填（见 `touchSetup.ts` 文件头那段）。
 */
export function createSettingsSetup(d: SettingsSetupDeps): SettingsSetup {
  const settings = new SettingsPanel(
    buildSettingsOptions({
      getRegistry: () => d.registry(),
      getBindings: () => d.state.bindings,
      setBindings: (next) => {
        d.state.bindings = next;
        d.battle()?.setBindings(d.state.bindings);
        d.onBindingsChanged(next);
      },
      getTouchSkillIds: () => d.state.touchButtons,
      setTouchSkillIds: (next) => {
        d.state.touchButtons = next;
        d.onTouchButtonsChanged(next);
      },
      settingsStore: d.settingsStore,
      getUiScale: () => d.state.uiScale,
      setUiScale: (value) => {
        d.state.uiScale = clampUiScale(value);
        d.settingsStore.saveUiScale(d.state.uiScale);
        /**
         * ⚠️ **不重测画布**（`stageObserver.refresh()`）。
         *
         * 需求澄清过："我不是说缩放整个游戏画面，我是指，缩放游戏 UI，
         * 比如面板、技能图标等，战斗画面和战斗文字保持不变。"
         * 所以系数**只传给渲染层的 UI 部件**，画布尺寸照旧。
         */
        d.applyUiScale(d.state.uiScale);
      },
      snapshot: () => d.battle()?.snapshot,
      translate: translateSafe,
      /**
       * ⚠️ **唯一 flag**（`GameState.operationMode`）：面板要用它回答
       * "显示键盘绑定还是触屏键位"、"要不要拼键名"两个问题 ——
       * 两个视图都从这一个值派生，没有第二个来源。
       */
      getOperationMode: () => d.state.operationMode,
      onOperationMode: (mode) => d.onOperationModeChanged(mode),
      pixi: { Container, Graphics, Sprite, Text },
      close: () => settingsToggle.close(),
      /**
       * **底部「回主菜单」**（2026-10-22）：装配方注入的那条（`game.ts` 里
       * 接到"弹二次确认 → 确认后关面板 + 回首页"）。
       */
      exitToHome: () => d.exitToHome(),
      capture: (handler) => d.battle()?.inputSource?.capture(handler),
      isHandlingKeyDown: () => d.state.handlingKeyDown,
    }),
  );
  d.app.stage.addChild(settings.root);

  /**
   * 设置面板的开关（含"打开时暂停 / 关闭时恢复原状"的状态机）。
   *
   * ⚠️ 抽到了 `app/settingsToggle.ts` —— 那里写着"为什么要暂停"与
   * "为什么不能无脑恢复"，不在这里重复。
   */
  const settingsToggle = createSettingsToggle({
    settings,
    /**
     * ⚠️ 藏 / 显示的是**当前那一屏**的齿轮（`activeChrome()`）——
     * 面板只可能从当前那一屏被打开。
     */
    setGearVisible: (visible) => d.activeChrome()?.setGearVisible(visible),
    /**
     * ⚠️ **从哪打开**取自相位（`settingsOriginOf`，纯函数、有单测）——
     * 首页打开的面板没有「按键」页（那里没有技能可配）。
     */
    origin: () => settingsOriginOf(d.state.phase),
    isPaused: () => d.battle()?.isPaused ?? false,
    setPaused: (value) => d.battle()?.setPaused(value),
  });

  return { settings, settingsToggle };
}
