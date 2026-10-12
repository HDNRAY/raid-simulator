/**
 * **游戏状态与界面切换**（`main.ts` 的"延后回填"上下文对象）。
 *
 * ==================================================================
 * 为什么要一个上下文对象
 * ==================================================================
 *
 * `main.ts` 原先把这批东西写在**同一个函数作用域**里，于是它们之间可以
 * 任意互相引用 —— 拆文件时如果各自复制一份 `let`，就会出现"两处真相"
 * （例如设置面板改了键位表，战斗里的键位表却还是旧的）。
 *
 * 所以这里定义一个 **`GameState`**：一个可变的普通对象，装配期间被各模块
 * 填进去，之后被各模块**读当前值**。它只承载"确实是共享可变状态"的东西 ——
 * 常量仍旧走各自的参数。
 *
 * ⚠️ **不许用模块级可变变量**（`export let`）代替它：那会让"谁在什么时候
 * 改了它"变得不可见，而这里的每一个字段都有明确的写入点（见下）。
 *
 * ==================================================================
 * 哪些是**刻意的延后回填**（TDZ 规避），不许"整理顺序"消掉
 * ==================================================================
 *
 *   - `loop` —— `?prepare=skip` 会让 `enterBattle` 早于一切界面构造，
 *     所有访问点都走 `battle()` 并容忍 `undefined`
 *   - `settingsButtonFocused` / `onScreenChange` —— `?prepare=skip` 时
 *     `enterBattle` 里的 `onScreenChange('battle')` 打在一个**空函数**上，
 *     所以必须在齿轮按钮构造之后**补调用一次 `onScreenChange(phase)`**，
 *     否则按钮会停在备战界面的右上角、压在战斗 HUD 上
 *   - `touch` —— 见 `battleSetup.ts` 里 `touchInput` getter 的说明
 */

import type { Phase } from './phaseLogic';
import type { BattleLoop } from './battleLoop';
import type { TouchControls } from './touchControls';
import type { PrepareScreen } from '../ui/PrepareScreen';
import type { HomeScreen } from '../ui/HomeScreen';
import type { CharacterSelectScreen } from '../ui/CharacterSelectScreen';
import type { ScreenControls } from '../ui/ScreenControls';
import type { SettingsButton } from '../ui/settings/SettingsButton';
import type { KeyBinding } from '../input/keyboard';

/**
 * 当前阶段（**界面路由**）。
 *
 * ⚠️ **定义在 `phaseLogic.ts`**（"哪个相位下按 `Esc` / 显示哪个控件"的
 * 判定要在 node 里单测），这里只是**转发** —— 于是
 * `import type { Phase } from './flow'` 这种既有写法照旧可用，
 * 不必因为搬家去改一片文件的 import。由来与流程图见那个文件。
 */
export type { Phase } from './phaseLogic';

/**
 * **设置齿轮按钮该摆在哪**。
 *
 * 全屏界面（首页 / 选角色 / 自由模式）没有战斗 HUD，右上角是空的；
 * 只有**战斗**界面要让它待在日志下方（详见 `SettingsButton` 的锚点注释）。
 *
 * ⚠️ 抽成一个函数是为了**只有一处映射**：`game.ts` 与 `debugApiSetup.ts`
 * 都要把当前 phase 告诉按钮（后者是"补一次摆位"），两处各写一遍
 * `phase === 'battle' ? 'battle' : 'prepare'` 就是两份会漂的真相。
 *
 * ⚠️ 它返回的是**锚点名**（`'prepare'` = 整屏界面右上角），不是 phase ——
 * `SettingsButton` 在 `ui/`，不该认识 `app/` 的 phase 取值。
 */
export function settingsAnchorOf(phase: Phase): 'prepare' | 'battle' {
  return phase === 'battle' ? 'battle' : 'prepare';
}

/** 装配期间被填、之后被读的共享状态。 */
export interface GameState {
  /**
   * 当前战斗循环。
   *
   * ⚠️ **不再一启动就跑战斗**：先进备战界面（需求："选人物 和 选boss，
   * 然后点开始才开始"）。所以 `loop` 是惰性的 —— 进战斗时才建。
   *
   * 因为它是可选的，所有访问点都走 `battle()` 并容忍 `undefined`
   * （备战阶段调它们本该无害地什么都不做）。
   */
  loop: BattleLoop | undefined;

  /** 当前阶段：首页 / 选角色 / 自由模式（原备战）/ 战斗中。 */
  phase: Phase;

  /**
   * 首页（默认入口）。
   *
   * ⚠️ **先声明、后回填**：`applyPhase`（显隐的唯一写入点）定义得比
   * 这个界面早 —— `?prepare=skip` 会让 `enterBattle` 早于一切界面构造
   * （见 `game.ts` 文件头"顺序即正确性"）。所有访问点都容忍 `undefined`。
   */
  home: HomeScreen | undefined;

  /** 选角色屏（肉鸽模式的第一屏）。同样是先声明、后回填。 */
  select: CharacterSelectScreen | undefined;

  /**
   * **整屏界面共用的"返回"箭头**（左上角；自由模式 / 选角色屏）。
   *
   * ⚠️ 与 `home` / `select` 同样是**先声明、后回填**：`applyPhase` 的定义
   * 早于它（`?prepare=skip` 那条路），所有访问点都容忍 `undefined`。
   *
   * ⚠️ 触屏对等就靠它 —— `Esc` 只有键盘按得出（AGENTS.md §3b）。
   */
  back: ScreenControls | undefined;

  /** 备战界面（自由模式；进战斗时隐藏，回来时显示）。 */
  prepare: PrepareScreen | undefined;

  /**
   * 键位表是**可变状态**，由设置界面修改。
   *
   * ⚠️ 放在这里而不是塞进 loop：每次重开都会重建 loop，
   * 而玩家的改键不该因为重开一局就被重置。
   */
  bindings: readonly KeyBinding[];

  /**
   * **触屏按钮集合**（技能 id，顺序即双弧槽位）。
   *
   * ⚠️ 与 `bindings` **互不派生**（用户 2026-10-12："触屏和键盘当然是
   * 2 套……只是可选技能是一样的"）。它由设置页「触屏」页增删、
   * 存 `raid.touchButtons.v1`。
   *
   * ⚠️ 放在 `GameState` 而不是 `TouchControls` 里：设置面板**先于**
   * 触屏层构造（它要接收触屏的能力值），所以面板必须有一个**与触屏层
   * 无关**的地方读这份选择。触屏层只是它的一个消费者（`setButtons`）。
   */
  touchButtons: readonly string[];

  /**
   * 触屏控件（能力探测 + 布局 + 输入源 + 双弧按钮层）。与键盘并存。
   *
   * ⚠️ **先声明、后回填**：它由 `touchSetup.ts` 在设置面板之后建出来，
   * 而 `startBattle` 的 `touchInput` getter 要在每帧读它（那时已就绪）。
   */
  touch: TouchControls | undefined;

  /** UI 缩放的当前值（设置里的 slider）。 */
  uiScale: number;

  /**
   * 设置按钮此刻是否持有键盘焦点（`↑` 提上去、`↓` 退下来）。
   *
   * ⚠️ **先声明、后回填**：`wireSettingsKeys(...)` 在 `createGame` 的末尾
   * 才接线（那里依赖一堆已经构造好的对象），而备战界面的 keydown 处理
   * 定义在中间。默认 `false` 表示"还没接线 = 按钮没聚焦"，与真实状态一致。
   *
   * ⚠️ 为什么备战界面需要知道它：设置那边**不再**在备战界面抢 `↑`
   * （`acceptsKeyboardFocus` 只在战斗为真），但这条守卫仍然留着 ——
   * 如果哪天设置按钮又被允许在备战聚焦，按 Enter 会先开设置而不是
   * 确定角色，而那种 bug 在截图里看不出来（齿轮只是亮了一下）。
   */
  settingsButtonFocused: () => boolean;

  /**
   * **界面切换时通知设置按钮**（它在两个界面里的位置不同）。
   *
   * ⚠️ 又是"延后回填"，原因和上面那条一样：`enterBattle` 可能在
   * 齿轮按钮构造**之前**就被调用（`?prepare=skip` 走的就是那条路），
   * 直接引用会撞 TDZ。
   */
  onScreenChange: (screen: Phase) => void;

  /**
   * 设置齿轮按钮。
   *
   * ⚠️ **先声明、后回填**：`backToPrepare`（回备战）里要 `update()` 它一次，
   * 而 `backToPrepare` 的**定义**早于齿轮按钮的构造 —— 这个顺序是
   * `?prepare=skip` 需要的（见 `game.ts` 文件头"顺序即正确性"第 1 条）。
   * 定义早不等于调用早：第一次真正回备战一定是用户点/按出来的，那时
   * 齿轮按钮早就构造好了；用状态对象读它就同时满足两者。
   */
  settingsButton: SettingsButton | undefined;

  /**
   * 是否正在"由主监听器处理一次按键"。
   *
   * 用途：输入层与设置面板都会监听 `keydown`，需要避免同一次按键被
   * 两边各处理一遍（否则改键时技能会真的放出去）。
   */
  handlingKeyDown: boolean;

  /** 已经渲染的帧数（调试探针读它证明"战斗在推进"）。 */
  frameCount: number;
}

/** 造一份初始状态（各字段在装配期间被填）。 */
export function createGameState(
  bindings: readonly KeyBinding[],
  /**
   * 初始触屏按钮集合。
   *
   * ⚠️ 是**参数**而不是"先给空、后面回填"：设置面板一构造就会读它，
   * 而面板比触屏层早 —— 回填的窗口里玩家能看到一组错的按钮。
   */
  touchButtons: readonly string[],
): GameState {
  return {
    loop: undefined,
    /**
     * 默认入口 = **首页**（需求："默认入口：首页"）。
     * 各屏的显隐由 `game.ts` 的 `applyPhase` 统一落实。
     */
    phase: 'home',
    home: undefined,
    select: undefined,
    back: undefined,
    prepare: undefined,
    bindings,
    touchButtons,
    touch: undefined,
    uiScale: 1,
    settingsButtonFocused: () => false,
    onScreenChange: () => {},
    settingsButton: undefined,
    handlingKeyDown: false,
    frameCount: 0,
  };
}
