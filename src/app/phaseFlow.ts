/**
 * **相位流转**：`applyPhase` + 进入战斗 / 切界面 / 返回。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3：横向切割）
 * ==================================================================
 *
 * `app/game.ts` 在"齿轮归各屏所有"这一轮改动之后到了 **738 行**
 * （上限 700）。按 §3 的顺序**不许压注释**，而用户早就点名过这一段：
 *
 *   > "（`game.ts` 679 行）**先横向切**，再加东西 ——
 *   >  `enterBattle` / `applyPhase` 那一段能切出去"
 *
 * 这一撮正好是一个**完整的状态机**：`applyPhase` 是唯一写显隐的地方，
 * 其余四个函数是它的四条转移路径（进战斗 / 切整屏界面 / 战斗结束去哪 /
 * 返回首页 + 肉鸽开局）。它们互相引用得很紧（`enterBattle` ↔
 * `startRoguelikeRun` ↔ `switchTo`），拆成两半只会让读者来回跳。
 *
 * ⚠️ **注释整段搬过来**（AGENTS §3：抽取时连带注释一起搬，不留摘要）——
 * 下面每一段"为什么这样写"都是实测踩出来的，压掉它们下一个人会重踩。
 *
 * ==================================================================
 * 与 `phaseLogic.ts` 的分工
 * ==================================================================
 *
 * 那边是**纯判定**（"这个相位按 `Esc` 该去哪"、"箭头该不该显示"），
 * 能在 node 里直接测；这边是**落实**（改 `GameState.phase`、`setVisible`、
 * 建 / 释放战斗循环）—— 它要碰场景与存储，所以只做接线、不再判一次。
 */

import { BOSS_POOL, resolveBossId, resolvePlayerId } from '../data/roster';
import { createRunSession } from './runSession';
import { switchPlayerProfile } from './playerKeys';
import { phaseFromEscape } from './phaseLogic';
import type { BattleLoop } from './battleLoop';
import type { GameState } from './flow';
import type { ContentRegistry } from '../core/content/registry';
import type { SettingsStore } from './settingsStore';

/**
 * 一个**出战的单位选择**（可变的）。
 *
 * ⚠️ 它是**可变的**（`enterBattle` 会改它），而且 `startBattle` 每次开局
 * 都要读**当前**值 —— 所以下游一律通过取值函数拿它，不复制。
 * 对象由 `game.ts` 造（那里的初值来自 `deps`），这里只负责改。
 */
export interface BattleSelection {
  playerId: string;
  bossId: string;
}

export interface PhaseFlowDeps {
  readonly state: GameState;
  readonly store: SettingsStore;
  readonly registry: ContentRegistry;
  /** 当前选中的出战单位（本模块会改它）。 */
  readonly selection: BattleSelection;
  /** 战斗场景：换出战形象 + 显隐。 */
  readonly scene: {
    readonly root: { visible: boolean };
    setAppearance(playerId: string, bossId: string): void;
  };
  /** 开局工厂（`battleSetup.createStartBattle` 的产物）。 */
  readonly startBattle: () => BattleLoop;
}

/**
 * 造这一局的**相位流转**。
 *
 * @returns 四个转移入口 + `applyPhase`。`game.ts` 的装配只需要它们
 *   （接线到各界面 / 指针路由 / 主循环 / 调试入口）。
 */
export function createPhaseFlow(d: PhaseFlowDeps): {
  applyPhase(phase: 'home' | 'characterSelect' | 'prepare' | 'battle'): void;
  enterBattle(playerId: string, bossId: string): void;
  switchTo(target: 'home' | 'characterSelect' | 'prepare'): void;
  backFromBattle(): void;
  backToHome(): void;
  startRoguelikeRun(playerId: string): void;
} {
  const { state } = d;

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
   * 设置焦点 …），而"两个界面同时可见"历来是**漏改一处**的结果 ——
   * 因为每个转移函数都自己手动 `setVisible`，加一个界面就要在每条路径上
   * 各补一次。
   *
   * 所以显隐只在这里写：任何转移路径都**必须**走 `applyPhase`，
   * 而它把几个开关一次算清（哪个 phase 显示哪一块是**一张表**）。
   * 于是"加一个新界面"只需要改这一张表，而不是每条路径。
   *
   * ⚠️ **返回箭头 / 齿轮不在这里出现**（2026-10-12 重构）：它们现在住在
   * 各自界面的 root 里（用户："stage 上理论上不挂任何小组件"、"多个页面的
   * 齿轮，应该分别定义"），所以上面那三句 `setVisible` 已经把**那一屏的
   * 边角控件**一起带上了 —— 这里不需要（也不该）再有一条独立开关。
   * "哪一屏有返回"由 `screenSetup` 按 `phaseLogic.CONTROL_VISIBILITY.back`
   * 决定要不要建箭头，判据仍然只有一处。
   *
   * ⚠️ 触屏层的显隐**不在这里**：它由 `touchControls.frame` 每帧按
   * `isBattleActive()` 决定（那里的"唯一写入点"不该被绕过 —— 与
   * `backToPrepare` 时代同一条纪律）。
   */
  const applyPhase = (phase: 'home' | 'characterSelect' | 'prepare' | 'battle'): void => {
    state.phase = phase;
    state.home?.setVisible(phase === 'home');
    state.select?.setVisible(phase === 'characterSelect');
    state.prepare?.setVisible(phase === 'prepare');
    d.scene.root.visible = phase === 'battle';
  };

  /**
   * **进入战斗**：建一局新战斗，并把界面切到 `battle`。
   *
   * ⚠️ 显隐全部交给 `applyPhase`：任何一条进入战斗的路径（备战开始、
   * 选角色开始、`?prepare=skip`、`restart`）都走这里，不会各自漏一个开关。
   */
  const enterBattle = (playerId: string, bossId: string): void => {
    d.selection.playerId = resolvePlayerId(playerId);
    d.selection.bossId = resolveBossId(bossId);
    d.store.savePick(d.selection.playerId, d.selection.bossId);

    /**
     * ⚠️ **换角色 = 换一整套键位**（用户："不同的人按键设置应该是分开的"）。
     * 四件连带的事整块在 `./playerKeys`（那里写着为什么要一起发生），
     * 这里是它**唯一**的调用点。
     *
     * ⚠️ 同一个角色再进来（重开一局）是**空操作** —— 守卫在那边：键位表在
     * 内存里已经是最新的，从存储重读反而可能丢掉刚改的那一次。
     *
     * ⚠️ **战斗中换不了角色**：本函数是"开一局新战斗"的入口，而战斗中
     * 没有界面能换人 —— 所以不会出现"打着打着键变了"。
     */
    switchPlayerProfile(
      { state, store: d.store, registry: d.registry, touch: () => state.touch },
      d.selection.playerId,
    );

    /**
     * ⚠️ **先换形象再开战**（需求：玩家与 Boss 都要播 idle / attack 动画）。
     *
     * 放在这里而不是 `BattleSceneOptions`：一局战斗的出战单位**在这里**
     * 才定下来，而场景只在启动时建一次（构造参数换不了）。同时它也覆盖
     * "重开换了个对手" —— 结算面板的 `restart` 也走本函数。
     */
    d.scene.setAppearance(d.selection.playerId, d.selection.bossId);

    state.loop?.dispose();
    state.loop = d.startBattle();

    /**
     * ⚠️ **触屏按钮要按"这一局有哪些技能"过滤一次**（2026-10-12）。
     *
     * 按钮集合是**用户自己选的**（整场游戏的技能池），两个角色的技能不一样
     * —— 不过滤的话凯丽的双弧上会多出「防」「避」两个按不出东西的按钮。
     *
     * ⚠️ 过滤的判据在触屏层里读**引擎的技能集**（`currentSkillIds`），
     * 所以这里只需在**换局之后**通知它一次；换角色之后再开一局就会重新
     * 过滤。放在 `applyPhase` **之前**与显隐无关（那时按钮整层隐藏）。
     *
     * ⚠️ 传的是**按钮集合**（`state.touchButtons`）而不是键位表：那正是
     * 这次切断的派生（"没绑键的技能在触屏上就没有按钮"）。
     */
    state.touch?.setButtons(state.touchButtons);

    applyPhase('battle');
  };

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
   *   - 触屏 / 鼠标点左上角的箭头（各屏 `ScreenChrome.onBack`）
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

  return { applyPhase, enterBattle, switchTo, backFromBattle, backToHome, startRoguelikeRun };
}
