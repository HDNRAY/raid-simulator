/**
 * **"当前这一屏是谁"的两个查询**：缩放落到谁身上、齿轮 / 返回箭头问谁。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是**整屏界面那一层的点名册**：`screens`（首页 / 选角色 / 自由模式 /
 * 确认屏 / 选炁机 / 一局结束）造好之后，这一层回答两个问题：
 *
 *   1. `applyUiScale(scale)` —— **UI 缩放要逐个转给谁**
 *   2. `getChrome()` —— **当前这一屏的齿轮 / 返回箭头是哪一个**
 *
 * ⚠️ 两条都**只由相位决定**，而且都必须"一处说清"：缩放漏掉一屏的表现是
 * "探针里那一屏的 `chromeScale` 停在 1，而它看起来完全正常"；点名册漏掉
 * 一屏的表现是"设置按钮点亮了看不见的那一个"（都实测踩过，见下）。
 *
 * ==================================================================
 * 为什么从 `game.ts` 切出来（AGENTS.md §3：横向切割）
 * ==================================================================
 *
 * `game.ts` 是**装配流水账**（把各部件按正确顺序造出来并接上线），而
 * "哪一屏在台上"是一块**独立的、会随界面数量增长**的知识：加一个新整屏
 * 界面时，`applyUiScale` 与 `getChrome` 各要补一行 —— 它正好在 `game.ts`
 * 顶到上限（上限 700）时被切出来。
 *
 * ⚠️ 切它**不是为了行数**：这两条都带"漏一处会怎样"的账（下面逐条写着），
 * 而 `game.ts` 的文件头已经很长、讲的是装配顺序 —— 混在一起之后，加一屏
 * 时读者不会想到"还有两处要点名"。
 *
 * ⚠️ 依赖是**单向**的：本文件只读 `state.phase` 与那几个界面对象，界面不
 * 认识它。注释与代码一起搬（§3：不留"见 xxx"的摘要）。
 */

import type { GameState } from './flow';
import type { ScreenChrome } from '../ui/ScreenChrome';
import type { Screens } from './screenSetup';

export interface ScreenAccessDeps {
  readonly state: GameState;
  /**
   * 全部整屏界面（`screenSetup.buildScreens` 的产物）。
   *
   * ⚠️ 传**整个对象**而不是逐个界面：这一层的职责就是"对每一个界面各做
   * 一次"，逐个传参会让"加一屏"变成改签名（而漏改的那一屏不会报错）。
   */
  readonly screens: Screens;
  /**
   * 战斗场景：它自己那一个齿轮住在里面（`BattleScene.chrome`），缩放也
   * 由它带上（`setUiScale`）。
   */
  readonly scene: {
    setUiScale(scale: number): void;
    readonly chrome: ScreenChrome;
  };
}

export interface ScreenAccess {
  /** 把 UI 缩放推给**每一个**界面（含场景）。 */
  applyUiScale(scale: number): void;
  /** 当前这一屏的齿轮 / 返回箭头（战斗那一屏是场景自己的那一个）。 */
  getChrome(): ScreenChrome | undefined;
}

export function createScreenAccess(d: ScreenAccessDeps): ScreenAccess {
  const { state, screens, scene } = d;

  /**
   * **UI 缩放的唯一落实点**：场景 + **每个界面各自的边角控件**。
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
    screens.runConfirm.setUiScale(scale);
    screens.qijiSelect.setUiScale(scale);
    screens.runOver.setUiScale(scale);
    screens.codex.setUiScale(scale);
  };

  /**
   * **当前这一屏的边角控件**（齿轮 / 返回箭头）—— 键盘焦点与调试入口
   * 都问它，而不是各自记着"设置按钮"那**一个**对象。
   *
   * ⚠️ 这正是齿轮重构的核心：它们从"一个挂 stage 上的共享组件"变成
   * **每个界面各自的**（用户："多个页面的齿轮，应该分别定义"）。所以
   * 需要"当前是谁"时只能**按相位查**，不能再指着一个全局引用。
   *
   * ⚠️ 战斗那一屏的齿轮挂在**场景**里（`BattleScene.chrome`），所以
   * 剩下的分支落到它 —— 那也是 `state.phase === 'battle'` 与"设置面板
   * 从战斗打开"两条路的唯一出口。
   */
  const getChrome = (): ScreenChrome | undefined => {
    if (state.phase === 'home') return screens.home.chrome;
    if (state.phase === 'characterSelect') return screens.select.chrome;
    if (state.phase === 'prepare') return screens.prepare.chrome;
    if (state.phase === 'runConfirm') return screens.runConfirm.chrome;
    if (state.phase === 'qijiSelect') return screens.qijiSelect.chrome;
    if (state.phase === 'runOver') return screens.runOver.chrome;
    if (state.phase === 'codex') return screens.codex.chrome;
    return scene.chrome;
  };

  return { applyUiScale, getChrome };
}
