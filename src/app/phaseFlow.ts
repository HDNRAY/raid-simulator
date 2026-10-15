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
import { ALL_QIJI, qijiById } from '../data/qiji';
import { buildPlayerKit, type PlayerKit } from '../data/kit';
import type { QijiEntity } from '../core/types/qiji';
import { freeQijiChoices, type FreeQiji } from '../ui/prepareLogic';
import type { RunState } from '../core/run/index';
import { runLengthOf } from '../core/run/index';
import { createRunSession } from './runSession';
import type { QijiCandidateView, QijiView } from '../ui/qijiSelectLogic';
import { switchPlayerProfile } from './playerKeys';
import { phaseFromEscape, phaseAfterAdvance, RUN_BATTLE_ENTRY, RUN_BATTLE_ENTRY_AFTER_QIJI, screenVisibilityOf } from './phaseLogic';
import type { Phase, ShiftTarget } from './phaseLogic';
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
  /**
   * **这一局打几场**（`?runlen=N`；`undefined` = 用 Boss 池的长度）。
   *
   * ⚠️ 它是**构造期常量**（来自 URL），不是每帧读的运行期状态 ——
   * 一局开始之后再改它没有意义（`order` 已经截断了）。
   */
  readonly runLength?: number | undefined;
  /**
   * **这一局的种子**（`?runseed=N`；`undefined` = 每次现取 `Date.now() >>> 0`）。
   *
   * ⚠️ 与 `runLength` 同族：**构造期常量**（来自 URL），一局开始之后再改
   * 没有意义（`order` 已经洗好了）。它是**调试入口** —— 存在的理由是
   * "复现某一局特定的 Boss 顺序"，来龙去脉见 `urlParams.ts` 的 `runSeed`。
   *
   * ⚠️ **它钉住的不止顺序**（B，2026-10-13）：一场战斗的种子由
   * `battleSetup.battleSeedOf` 从 `(runSeed, position)` 派生
   * （`battleSeed(runSeed, position)`）—— 所以同一个 `?runseed=` 跑两次，
   * **Boss 顺序 + 每场战斗内部**都相同。
   *
   * ⚠️ 沿革：这一条**原先写的是"战斗种子另取时钟、与它没有派生关系"**
   * ——那句描述的是当时的**事实**，而事实与 `core/run/types.ts` /
   * `tests/unit/run/record.test.ts` 里"由 `battleSeed` 派生"的约定**对不上**。
   * 现在线上改成按约定派生，两边才一致（见 `battleSetup.ts` 文件头）。
   */
  readonly runSeed?: number | undefined;
  /**
   * **自由模式当前开着的炁机**（2026-10-13）。
   *
   * ⚠️ 传**取值函数**而不是一张算好的表：与 `getPlayerKit` 同一条理由 ——
   * 玩家在备战屏上改一次炁机，下一场战斗就该带上它。快照一份会让改动
   * 停在第一次开战那一刻。
   *
   * ⚠️ 自由模式**没有一局肉鸽**（`runSession.active === false`），所以
   * `RunState.chosen` 那条路在自由模式里是空的 —— 这份表就是自由模式
   * 唯一的炁机来源。两者最终都汇进 `buildPlayerKit`（**同一个函数**）。
   */
  readonly freeQiji: () => FreeQiji;
}

/**
 * 造这一局的**相位流转**。
 *
 * @returns 四个转移入口 + `applyPhase`。`game.ts` 的装配只需要它们
 *   （接线到各界面 / 指针路由 / 主循环 / 调试入口）。
 */
export function createPhaseFlow(d: PhaseFlowDeps): {
  applyPhase(phase: Phase): void;
  enterBattle(playerId: string, bossId: string): void;
  switchTo(target: ShiftTarget): void;
  backFromBattle(): void;
  backToHome(): void;
  /**
   * **一局结束屏的确认**：丢掉这一局、回选角色（开下一局）。
   *
   * ⚠️ 与 `backToHome` 的"放弃"是**两条**路：那条会 `clear()` 然后回
   * **首页**（"我不想玩了"），这条回**选角色**（"再来一局"）。
   * 它们的目标相位不同，所以不能合成一个函数。
   */
  continueRun(): void;
  startRoguelikeRun(playerId: string): void;
  /** 选炁机屏的候选（**视图形状**，渲染层只认它）。 */
  qijiCandidates(): readonly QijiCandidateView[];
  /** 选一个炁机生效（**当场生效**，没有撤销）。 */
  chooseQiji(qijiId: string): void;
  /**
   * **这一场战斗的玩家装配**（角色 + 本局已选的炁机；§5.5 的 `BattleKit`）。
   *
   * ⚠️ 它是**取值函数**：每开一场都要现算（打了这一场之后可能又选了一个
   * 炁机），快照一份会让第 2 场还带着第 1 场的装配。
   */
  playerKit(playerId: string): PlayerKit;
  /**
   * **相位历史的只读快照**（调试 / 验收探针用）。
   *
   * ⚠️ 它是**观测数据**（像事件流一样），不参与任何判定：`?runlen=2`
   * 的验收要"贴出每场的相位序列"，而截图证明不了"走进过哪一屏"。
   * 每次 `applyPhase` 追加一条，**不清理**（进程内内存，几条字符串）。
   */
  phaseHistory(): readonly string[];
  /** 当前一局的 `RunState`（没有时 `undefined`）。⚠️ 只读引用，别改它。 */
  runState(): RunState | undefined;
  /**
   * **确认屏要显示的内容**（2026-10-15）：第几场 / 共几场 / 出战角色 /
   * 本局最近选的那条炁机。
   *
   * ⚠️ 渲染层不认识 `RunState`，所以摊平在这一层做（与 `runSummary` 同一条
   * 纪律：接口形状由消费者声明）。
   */
  runConfirmInfo(): {
    readonly position: number;
    readonly length: number;
    readonly playerId: string;
    readonly qijiId?: string | undefined;
  };
  /**
   * **确认屏的「开始战斗」**：真的开这一场（`enterBattle` 的唯一肉鸽入口
   * 之一 —— 另外两条是开局与"选完炁机"，它们都先切到确认屏）。
   */
  confirmRunBattle(): void;
  /** 一局结束屏要显示的内容（位置 / 长度 / 这一局带了哪些炁机）。 */
  runSummary(): {
    readonly victory: boolean;
    readonly position: number;
    readonly length: number;
    readonly loadout: readonly { readonly nameKey: string }[];
  };
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
  /**
   * **相位序列**（观测用，见 `phaseHistory` 的说明）。
   *
   * ⚠️ 写在这里而不是各转移函数里：`applyPhase` 是**显隐的唯一写入点**，
   * 也是"真的切过去了"的唯一时刻 —— 在各转移函数里各记一次就会有漏。
   */
  const phaseHistory: string[] = [];

  const runSession = createRunSession({
    bossPool: BOSS_POOL.map((b) => b.id),
    /**
     * ⚠️ **炁机池只有一处来源**（`data/qiji.ts` 的 `ALL_QIJI`）：解锁判定
     * 与候选生成读的都是它。两份池子必然漂，而漂的样子是"解锁了一个不在
     * 候选里的东西"。
     */
    qijiPool: ALL_QIJI,
    ...(d.runLength === undefined ? {} : { runLength: d.runLength }),
  });

  /**
   * 这一局**已经选了生效**的炁机（定义）。
   *
   * ⚠️ 它是 `RunState.chosen`（只存 `{ qijiId }`）的**展开**：战斗装配要的
   * 是定义（`abilities` / `comboWindow` / `skillTweak`），而 `RunState` 里
   * 只有 id。展开只在这一处，所以"某个 id 在不在池子里"只有一个答案。
   *
   * ⚠️ **没有层数**（2026-10-13）：肉鸽一局只能选一次、不叠加
   * （用户原话："肉鸽也改成一局只能选一次（不叠加）"）。所以这里给出的是
   * **定义数组**，`buildPlayerKit` 的入参就是它（那个恒为 1 的 `stacks`
   * 已整条删除，见 `data/kit.ts` 的作废段）。
   */
  const activeQiji = (): readonly QijiEntity[] => {
    const state = runSession.state();
    /**
     * ⚠️ **自由模式那一支**（没有进行中的一局）：读题面注入的激活集合，
     * 按 `ALL_QIJI` 的顺序翻译。
     *
     * ⚠️ 两个模式**共用同一个翻译出口**（`freeQijiChoices` / `qijiById` —
     * 这里两边都走 `qijiById`）：肉鸽那边是 `RunState.chosen`，
     * 自由这边是玩家在备战屏点出来的表 —— 差别只在"谁来填这张表"，
     * 效果本身走的是同一个 `buildPlayerKit`。
     *
     * ⚠️ 自由模式的"开 / 关"语义**一个字都没改**：`freeQijiChoices`
     * 仍然按内容表顺序给出选中的那些。
     */
    if (state === undefined) {
      return freeQijiChoices(d.freeQiji(), ALL_QIJI).flatMap((choice) => {
        const def = qijiById(choice.qijiId);
        return def === undefined ? [] : [def];
      });
    }
    return state.chosen.flatMap((choice) => {
      /** ⚠️ 走 `qijiById`（内容表自己的 id→定义 查找）而不是在这里再写一遍 find。 */
      const def = qijiById(choice.qijiId);
      return def === undefined ? [] : [def];
    });
  };

  /**
   * **这一场战斗的玩家装配**（炁机在这里生效）。
   *
   * ⚠️ 自由模式（没有进行中的一局）时 `activeQiji()` 是空数组 ——
   * `buildPlayerKit(playerId)` 于是与"今天"逐字相同（`caps` = 角色的、
   * `modifiers` = 空、`comboWindows` = 空）。
   *
   * ⚠️ **没有层数**（肉鸽一局只能选一次、自由模式是开关，见 `activeQiji`）：
   * `buildPlayerKit` 的入参就是那份定义数组，这里不再有"把层数写成 1"
   * 的翻译（2026-10-13 删）。
   */
  const playerKit = (playerId: string): PlayerKit =>
    buildPlayerKit(playerId, activeQiji());

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
  const applyPhase = (phase: Phase): void => {
    state.phase = phase;
    /**
     * ⚠️ 记的是**相位名**（不是"第几场"）：场次在 `RunState.position` 里
     * 有唯一真相，这里重复一遍就是第二份。验收时把两者拼起来读即可。
     */
    phaseHistory.push(phase);
    /**
     * ⚠️ **判据只有一处**：`phase → 四屏显隐`整块在
     * `phaseLogic.screenVisibilityOf`（纯函数、有单测）。这里只负责
     * **落实**（把四个布尔写给四个对象），不再自己写 `phase === '…'`
     * —— 那会把"哪一屏对应哪个相位"拆成两份真相，而两份真相漂移的样子
     * 正是"两个界面同时可见"。
     */
    const show = screenVisibilityOf(phase);
    state.home?.setVisible(show.home);
    state.select?.setVisible(show.characterSelect);
    state.prepare?.setVisible(show.prepare);
    state.runConfirm?.setVisible(show.runConfirm);
    state.qijiSelect?.setVisible(show.qijiSelect);
    state.runOver?.setVisible(show.runOver);
    d.scene.root.visible = show.battle;
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
  const switchTo = (target: ShiftTarget): void => {
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
   * 肉鸽这一支（P3 接真）做三件事：
   *   1. 把**这一场的事件流 + 胜负 + 满血**喂给 `runSession.advance`
   *      （统计**不在这里算** —— 那是 `core/run/stats.ts` 的归约，
   *      由 `advanceRun` 调用；本文件一个加法都不写）
   *   2. 按它给的**去向**走（`phaseLogic.phaseAfterAdvance`）：选炁机屏 /
   *      **确认屏**（下一场先确认，2026-10-15）/ 一局结束屏
   *   3. 自由模式（`runSession.active === false`）照旧回备战界面
   *
   * ⚠️ **必须在 `switchTo` 之前读 loop**：`switchTo` 会 `dispose` 掉它
   * （而且把 `state.loop` 置空），之后读事件流就什么都拿不到了。
   */
  const backFromBattle = (): void => {
    if (!runSession.active) {
      switchTo('prepare');
      return;
    }

    const loop = state.loop;
    const snapshot = loop?.engineState.snapshot;
    const outcome = snapshot?.status === 'victory' ? 'victory' : 'defeat';
    /**
     * **满血赢的**：终局快照里玩家 `hp === caps.hp`。
     *
     * ⚠️ 事件流里**没有**血量上限，这个事实推不出来 —— 所以由这里
     * （拿得到快照的那一层）算好喂进去（`core/run/lifecycle.ts` 的
     * `BattleInput.flawless` 写明了这条）。
     */
    const player = snapshot?.combatants.find((c) => c.side === 'ally');
    const flawless = outcome === 'victory' && player !== undefined && player.resources.hp >= player.caps.hp;

    const next = runSession.advance(outcome, loop?.battleEvents ?? [], flawless);
    /**
     * ⚠️ **`'battle'` 也要先过确认屏**（2026-10-15）：下一场开打之前给玩家
     * 一屏只读的"派谁 / 带哪条炁机"。判据收在 `phaseAfterAdvance`
     * （纯函数，有单测），所以这里不再自己写 `next.kind === 'battle'` 的
     * 字面目标 —— 那正是"三条路里漏改一条"的形状。
     */
    if (next.kind !== 'battle') {
      /**
       * ⚠️ `runOver` 这一支**不 `clear()`**：一局结束屏要显示"打到第几场 /
       * 带了哪些炁机"（`runSummary` 读的就是这一局）。丢掉它的时机是
       * **离开这一屏**时（`backToHome` / 一局结束屏的确认），不是进来的时候。
       */
      switchTo(phaseAfterAdvance(next));
      return;
    }
    switchTo(RUN_BATTLE_ENTRY);
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
    if (target === undefined) return;
    /**
     * ⚠️ **放弃这一局**：从选炁机屏 / 一局结束屏返回（目标 = 选角色）时，
     * 这一局的 `RunState` 该丢掉 —— 否则下一局会拿着上一局的
     * `battleStats` / `unlocked` / `chosen` 继续（"我明明重开了，怎么还带着
     * 三个炁机"）。
     *
     * ⚠️ 从**自由模式 / 选角色屏**返回首页时 `target === 'home'`，
     * 而那两种情况本来就没有进行中的一局（`active` 为假）—— 调 `clear()`
     * 是幂等的空操作，所以不需要为它再写一条分支。
     */
    runSession.clear();
    switchTo(target);
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
    /**
     * ⚠️ **`?runlen=N` 在 `begin` 里生效**（`runSession` 的 `runLength`）：
     * 它截断洗好的 Boss 顺序，于是"这一局打几场"从第一场起就是确定的。
     *
     * ⚠️ **`?runseed=N` 是种子的唯一覆盖点**（`d.runSeed`）：给了就用它，
     * 不给就是**逐字不变**的 `Date.now() >>> 0`（`app/` 层允许非确定性，
     * `core/` 不许 —— 见 `battleSetup.ts` 给战斗种子的同一做法）。
     * 两个参数互不影响：种子决定**顺序**，`runlen` 决定**截多长**。
     */
    runSession.begin(playerId, d.runSeed ?? (Date.now() >>> 0));
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
    /**
     * ⚠️ **不直接进战斗**：先到**确认屏**（用户 2026-10-15："每场战斗开始前
     * 加一个确认界面"）。`RUN_BATTLE_ENTRY` 是那三条路共用的**唯一**目标值。
     */
    switchTo(RUN_BATTLE_ENTRY);
  };

  /**
   * **选炁机屏的候选**（把 `core/run` 的 `Candidate` 翻成渲染要的字段）。
   *
   * ⚠️ 只在这一处做这个翻译：渲染层**不认识** `RunState` / `QijiEntity` /
   * `UnlockProgress`（那三个都是 core 的），而 app 层在这里一次给全。
   */
  const qijiCandidates = (): readonly QijiCandidateView[] =>
    runSession.candidates().map((candidate) => {
      const qiji: QijiView = {
        id: candidate.qiji.id,
        nameKey: candidate.qiji.nameKey,
        icon: candidate.qiji.icon,
        ...(candidate.qiji.descKey === undefined ? {} : { descKey: candidate.qiji.descKey }),
      };
      return { qiji };
    });

  /**
   * **选一个炁机生效**（用户规则：选了才本局生效）。
   *
   * ⚠️ 选完**先去确认屏**（2026-10-15），再由玩家按「开始战斗」进下一场：
   * 节拍是"每场战斗 → 一个决策 → **确认** → 下一场"。没有"确定 / 取消"
   * 两步 —— 那会多一个与"选了不能换"打架的中间态。
   */
  const chooseQiji = (qijiId: string): void => {
    if (!runSession.chooseQiji(qijiId)) {
      /**
       * 选不上（不是候选 / 这一局没了）：**停在选择屏**而不是静默进下一场。
       * 静默前进会让"点了没反应"变成"莫名其妙开始了下一场"，
       * 而后者看不出是哪一步错了。
       */
      return;
    }
    const bossId = runSession.bossId();
    if (bossId === undefined) {
      /** 越界（顺序算错）：回一局结束屏，而不是打一个不存在的 Boss。 */
      switchTo('runOver');
      return;
    }
    /**
     * ⚠️ **选完也要先确认**（与开局那条同一条规则）：这一条路的目标由
     * `RUN_BATTLE_ENTRY_AFTER_QIJI` 给（见那里的说明：它与"开局"分开命名）。
     */
    switchTo(RUN_BATTLE_ENTRY_AFTER_QIJI);
  };

  /**
   * **确认屏要显示的内容**（2026-10-15）—— 纯读取，不改任何状态。
   *
   * ⚠️ `position` / `length` 与 `runSummary` 同一条口径（夹回 `1..length`）：
   * `RunState.position` 在"通关"那一刻是 `len + 1`（见 `core/run/lifecycle.ts`），
   * 虽然确认屏只在**一局还没结束时**出现，但这一层不该指望"调用点保证它
   * 没结束" —— 夹一次的成本是零，而漏一次会显示"第 3 / 2 场"。
   */
  const runConfirmInfo = (): {
    readonly position: number;
    readonly length: number;
    readonly playerId: string;
    readonly qijiId?: string | undefined;
  } => {
    const run = runSession.state();
    if (run === undefined) {
      /**
       * 没有进行中的一局（理论上到不了这一屏 —— 肉鸽那三条路都会先
       * `begin`）。给一份能读的零值，而不是崩。
       */
      return { position: 0, length: 0, playerId: d.selection.playerId };
    }
    const length = runLengthOf(run);
    const position = Math.min(Math.max(run.position, 1), Math.max(length, 1));
    /**
     * ⚠️ 右栏画的是**最近选的那一条**（`chosen` 的最后一条）：一局每场之后
     * 可以选一条，而"这一场之前刚选了什么"正是玩家要确认的东西。
     * 第一场之前 `chosen` 是空的 → `undefined`（由界面画占位那一句）。
     */
    const last = run.chosen[run.chosen.length - 1];
    return {
      position,
      length,
      playerId: run.playerId,
      qijiId: last?.qijiId,
    };
  };

  /**
   * **确认屏的「开始战斗」**：真的开这一场。
   *
   * ⚠️ 它是肉鸽进战斗的**唯一**门口（另外两条路 —— 开局 / 选完炁机 ——
   * 都只切到确认屏）：所以"跳过确认"这件事在结构上不存在，而不是靠
   * 三条路各自记得不跳过。
   *
   * ⚠️ 没有进行中的一局时**什么也不做**（这一屏只可能在局里；静默开一场
   * "自由模式的战斗"会让相位与账本对不上）。
   */
  const confirmRunBattle = (): void => {
    const run = runSession.state();
    if (run === undefined) return;
    const bossId = runSession.bossId();
    if (bossId === undefined) {
      /** 越界（顺序算错）：回一局结束屏，而不是打一个不存在的 Boss。 */
      switchTo('runOver');
      return;
    }
    enterBattle(run.playerId, bossId);
  };

  /** 一局结束屏要显示的内容（纯读取，不改任何状态）。 */
  const runSummary = (): {
    readonly victory: boolean;
    readonly position: number;
    readonly length: number;
    readonly loadout: readonly { readonly nameKey: string }[];
  } => {
    const run = runSession.state();
    if (run === undefined) {
      return { victory: false, position: 0, length: 0, loadout: [] };
    }
    /**
     * ⚠️ `position` 在"通关"时会**超出长度一位**（`len + 1`），那是
     * "第 `len + 1` 场不存在"的直接编码（见 `core/run/lifecycle.ts`）。
     * 显示"打到第几场"时夹回 `1..len` —— 通关的摘要不该写"打到第 3/2 场"。
     */
    const length = runLengthOf(run);
    /** 通关时 `position` 是 `len + 1`（见上）：摘要里夹回最后一场。 */
    const position = Math.min(Math.max(run.position, 1), Math.max(length, 1));
    return {
      victory: run.status === 'victory',
      position,
      length,
      loadout: activeQiji().map((def) => ({ nameKey: def.nameKey })),
    };
  };

  /**
   * **一局结束屏的确认**（用户规则：通关 / 失败都回选角色开下一局）。
   *
   * ⚠️ 这里 `clear()` 是**对的**（与 `backFromBattle` 里的 `runOver` 分支
   * 相反）：那一条是"刚进一局结束屏、摘要还要显示"，而这一条是"看完了、
   * 离开"—— 离开之后 `RunState` 没有任何消费者（下一局从 `begin` 重开）。
   */
  const continueRun = (): void => {
    runSession.continueRun();
    switchTo('characterSelect');
  };

  return {
    applyPhase,
    enterBattle,
    switchTo,
    backFromBattle,
    backToHome,
    continueRun,
    startRoguelikeRun,
    playerKit,
    phaseHistory: () => phaseHistory,
    runState: () => runSession.state(),
    runConfirmInfo,
    confirmRunBattle,
    qijiCandidates,
    chooseQiji,
    runSummary,
  };
}
