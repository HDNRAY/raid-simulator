/**
 * **`window.__raidBattle` 的装配**（调试 / 验证入口）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一段有一半是注释，另一半是"把闭包里的状态摊平成几个方法"。
 * 它在 `main.ts` 里是最不"主干"的一块 —— 玩家路径完全用不到它。
 *
 * ⚠️ **各入口一律走转调**（`settings.open()`、`prepare.confirm()` …），
 * 不另写一套逻辑：调试入口自己改状态就验证不到界面本身
 * （来龙去脉见 `app/debugApi.ts`）。
 *
 * ⚠️ **不再有"补一次界面摆位"**（2026-10-12 重构）：原先这里末尾要回填
 * `onScreenChange` 并**立刻按当前 phase 调一次** —— 因为齿轮是**一个**
 * 挂在 stage 上的共享组件，`?prepare=skip` 时那次摆位会打在空函数上。
 * 现在齿轮**每屏一个**（用户："多个页面的齿轮，应该分别定义"），位置由
 * 各屏自己的 `ScreenChrome` 决定、显隐由各屏的 `visible` 带上 —— 没有
 * 需要补摆位的全局对象，那一段整体删掉了。
 */

import {
  buildProbe,
  collectRuntimeErrors,
  emptyProbe,
  installRaidBattleApi,
} from './debugProbe';
import {
  characterSelectDebugApi,
  homeDebugApi,
  prepareDebugApi,
  qijiDebugApi,
  runConfirmDebugApi,
  settingsDebugApi,
} from './debugApi';
import { clampUiScale } from '../render/scaling';
import type { BattleLoop } from './battleLoop';
import type { GameState } from './flow';
import type { InputLayer } from './inputRouter';
import type { SettingsPanel } from '../ui/settings/SettingsPanel';
import type { SettingsToggle } from './settingsToggle';
import type { HomeScreen } from '../ui/HomeScreen';
import type { CharacterSelectScreen } from '../ui/CharacterSelectScreen';
import type { PrepareScreen } from '../ui/PrepareScreen';
import type { QijiSelectScreen } from '../ui/QijiSelectScreen';
import type { RunConfirmScreen } from '../ui/RunConfirmScreen';
import type { RunOverScreen } from '../ui/RunOverScreen';
import type { ScreenChrome } from '../ui/ScreenChrome';
import type { TouchControls } from './touchControls';
import type { RunState } from '../core/run/index';

/**
 * `window.__raidBattle` 的精确形状。
 *
 * ⚠️ 直接取自 `src/types/global.d.ts` 的全局声明 —— 这样"这里塞进去的
 * 对象"与"脚本读到的对象"由**同一份类型**约束，而不是各写一份再悄悄漂移
 * （`debugProbe.ts` 里的 `RaidBattleApi` 只是这个门面的一个子集说明）。
 */
type RaidBattleGlobal = NonNullable<Window['__raidBattle']>;

/** 探针与界面入口要读的那些东西。 */
export interface DebugApiDeps {
  readonly state: GameState;
  /**
   * **切到备战屏并停在那里**（2026-10-22，dev-only）。
   *
   * 用途：截图验收"hover 只动白框、黄底要点击才变"那三张图 —— 走正常流程
   * 会一路 advance（选角色 `pick()` 直接进确认屏 ✗），拍不到备战屏。
   * ⚠️ 只走既有相位切换（`switchTo('prepare')`），不是第二套流程。
   */
  readonly gotoPrepare?: () => void;
  /**
   * **按"面板上显示的样子"读最近 n 条战斗日志**（2026-10-23，dev-only）。
   *
   * 用途：这一轮修的"「弹」的伤害没有 log / 反伤显示未知来源"只能靠**文本**
   * 验收 —— 而日志文本原先没有任何读取口 ✗（`logReview` 只有
   * `layer/isOpen/pointerRatio`）。
   *
   * ⚠️ 文本必须由**面板同一份**格式化逻辑产出（`ui/logReview.logLineTexts`），
   * 否则"调试读到的"与"玩家看到的"会漂。
   */
  readonly logLines?: (n?: number) => readonly string[];
  /** 场景（复盘那一层要读它）。 */
  readonly scene: {
    /**
     * 复盘那一层（`logReview` 入口读它）。
     *
     * ⚠️ 只暴露 `isOpen` / `pointerRatio` 两个**只读**查询，不暴露"滚" ——
     * 那是一条旁路（脚本要滚必须注入真实按键 / 指针事件，走的才是玩家那条路）。
     * 与 `back` 的处理同一个道理（见那里"没有点它的方法"的说明）。
     */
    readonly logReview: {
      isOpen(): boolean;
      /** 滚动位置比例（0 = 第一行，1 = 最后一行；截图前后对比用）。 */
      pointerRatio(): number;
    };
    /**
     * **圣光弹的调试读数**（2026-10-22）：回答"素材读到几帧 / 纹理成功几张 /
     * 帧组切出几个 / 第一次失败原因" —— 这些在截图里看不出来。
     */
    spellDebug(): ReturnType<typeof import('../render/spellBurst').SpellBurstPlayer.prototype.debug> | undefined;
  };
  /**
   * **落实一次 UI 缩放**（`game.ts` 的 `applyUiScale`：场景 + 四屏齿轮）。
   *
   * ⚠️ 由调用方注入而不是在这里自己拼：缩放的落点是**整体知识**
   * （这一局有哪几块 UI），判据只能有一处 —— 调试入口再转发一遍就会漏
   * （实测踩到：漏了三个界面的齿轮）。
   */
  readonly applyUiScale: (scale: number) => void;
  /** Pixi 应用（探针 `stage` 暴露它的 `app.stage`）。 */
  readonly app: { readonly stage: unknown };
  readonly settings: SettingsPanel;
  /**
   * **当前这一屏的齿轮**（`game.ts` 的 `getChrome()`，按相位查）。
   *
   * ⚠️ 是取值函数、而且可能返回 `undefined`（装配期那一瞬）：齿轮从
   * "一个共享组件"变成**四个界面各自持有**（用户 2026-10-12："多个页面的
   * 齿轮，应该分别定义"），所以"当前是谁"只能现查。探针里凡是要读齿轮
   * 状态的入口（`settings.buttonFocused`、`back.shortcutBounds`）都走它。
   */
  readonly chrome: () => ScreenChrome | undefined;
  readonly settingsToggle: SettingsToggle;
  /** 首页调试入口的目标。 */
  readonly home: HomeScreen;
  /** 选角色屏调试入口的目标。 */
  readonly select: CharacterSelectScreen;
  /**
   * 备战界面（自由模式）调试入口的目标。
   *
   * ⚠️ 返回箭头（自由模式 / 选角色屏左上角）**不再是独立参数**：它现在
   * 住在那一屏自己的 `ScreenChrome` 里，所以探针通过 `chrome()` 读它
   * （见下面 `api.back` 与文件头那段"为什么按相位查"）。
   */
  readonly prepare: PrepareScreen;
  /**
   * **选炁机屏**（P3）与**一局结束屏**（P3）。
   *
   * ⚠️ 它们进调试入口的理由与另外三屏一样：`?runlen=2` 那条路径要能被
   * **脚本读状态**（"现在这一屏有几个候选、光标在哪"），而 headless 下
   * 模拟点击不可靠 —— 只拍一张图分不清"没有候选"和"候选没画出来"。
   */
  readonly qijiSelect: QijiSelectScreen;
  readonly runOver: RunOverScreen;
  /**
   * **确认屏**（肉鸽；2026-10-15）。
   *
   * ⚠️ 进调试入口的理由：`?runlen=2` 的验收要回答"**每场之前**都到了确认屏
   * 吗"，而"到了"这件事在相位序列里只有一条字符串 —— 它显示的是哪一场、
   * 右栏是不是刚选的炁机，只有这一屏自己的读数能证明。
   */
  readonly runConfirm: RunConfirmScreen;
  /**
   * **一局肉鸽的账本 + 相位序列**（`?runlen=N` 的验收探针）。
   *
   * ⚠️ 传**取值函数**（不是快照）：账本每场都在变，快照一份会永远停在
   * 起局那一刻。
   */
  readonly run: {
    state(): RunState | undefined;
    phases(): readonly string[];
  };
  /** 触屏按钮几何的唯一真相（`touchButtonCenter` 从它反查）。 */
  readonly touch: TouchControls;
  /** 重开一局（`restart` 从它走 `enterBattle`）。 */
  readonly restart: () => void;
  /**
   * **当前输入层** —— `inputRouter.activeInputLayer` 的活取值。
   *
   * ⚠️ 由调用方注入（而不是在这里自己拼判据）：那一份判据只能有一处，
   * 调试入口再拼一遍就成了"两份会漂的真相" —— 而这次的 bug 正是
   * "各模块各自拼一份"。
   */
  readonly layer: () => InputLayer;
}

/**
 * 装上 `window.__raidBattle`，并**补一次界面摆位**。
 *
 * ⚠️ 探针里凡是"指向活的战斗"的入口都走 `d.state.loop` —— 重开一局会
 * 换掉它，所以不能在这里快照一份。
 */
export function installDebugApi(d: DebugApiDeps): RaidBattleGlobal {
  const { state } = d;

  /**
   * 调试探针：把战斗状态挂到 window，供端到端验证读取。
   *
   * 静态截图只能证明"渲染了一帧"，证明不了"战斗在推进"。
   * M7 起会被真正的调试面板与回放录制取代。
   */
  /** 捕获运行期异常，供端到端验证读取（否则会被静默吞掉）。 */
  const runtimeErrors = collectRuntimeErrors(window);

  const battle = (): BattleLoop | undefined => state.loop;

  const api: RaidBattleGlobal = {
    act: (skillId: string, actorId?: string) => {
      const l = battle();
      if (l === undefined) return;
      /**
       * ⚠️ **走 `BattleLoop.injectActions`，不许再直接戳 `engineState`。**
       *
       * 老写法是自己 `engineState.tick(...)` 之后再 `engineState.drainEvents()`
       * —— 那一步 drain 把**本 tick 的全部事件排空后丢掉**（`skillUsed` /
       * `castStarted` / 瞬发技的效果事件），于是日志、飘字、肉鸽统计看不到
       * 这次注入，而验证脚本读到的引擎读数与渲染层对不上。这就是
       * "静默无效"的形状（不报错、结果不对），见 `battleLoop.ts` 的
       * `injectActions` 文件说明。
       *
       * ⚠️ 它仍是**一条合法的 `Action[]` 注入**：与玩家按键走同一条
       * `Action[] → engine.tick → 事件三消费者`，不改变确定性。
       * ⚠️ 也**不是**"先 act 再 sleep 等一下"那种掩盖 —— 根因（事件被
       * 排空丢弃 + 旁路 `step()`）在这里被去掉，而不是靠时序绕过。
       */
      l.injectActions(
        [{ type: 'useSkill', skillId, atTick: l.engineState.snapshot.tick }],
        actorId,
      );
    },
    /**
     * **开发模式的一键过关**（2026-10-22）：与 `F2` / 齿轮旁那颗按钮
     * **同一条**实现（`BattleLoop.devClear`），所以截图脚本验证的就是
     * 玩家点它时发生的事 —— 不是另一套"脚本专用"的作弊路径。
     */
    devClear: () => state.loop?.devClear() ?? false,
    /**
     * **最近 n 条日志的文本**（未挂载时返回空数组 —— 生产里不该有人调它）。
     *
     * 见 `DebugApiDeps.logLines`：返回的就是面板上那几行的**渲染结果**。
     */
    logLines: (n?: number) => (d.logLines === undefined ? [] : d.logLines(n)),
    /** 切到备战屏并停住（见 `DebugApiDeps.gotoPrepare`）；没挂就是 `false`。 */
    gotoPrepare: () => {
      if (d.gotoPrepare === undefined) return false;
      d.gotoPrepare();
      return true;
    },
    /**
     * 当前键位表（顶层探针）。
     *
     * 端到端脚本用它来"按某个技能" —— 而不是把键位写死在脚本里。
     * 踩过的坑：脚本原先硬编码 `1` / `4`，默认键位改成 QWER/ASDF 之后
     * 它就悄悄失效，报出来像是"战斗坏了"。
     */
    bindings: () => state.bindings.map((b) => ({ ...b })),
    /**
     * 把 Pixi stage 暴露出来。
     *
     * 用途：让验证脚本能读取**渲染层实际写进去的文本** ——
     * 只看截图无法区分"没画"和"画了但看不见"。
     */
    stage: d.app.stage,
    /**
     * 设定 UI 缩放（端到端脚本用）。
     *
     * ⚠️ 走的是设置面板**同一条路径**（`onUiScale` → `game.ts` 的
     * `applyUiScale`：场景 + 四个界面各自的齿轮），所以它验证的就是真实
     * 行为，不是另一套旁路。
     *
     * ⚠️ 这里**不许**自己逐个转发（`scene.setUiScale` + 四个 chrome）：
     * 那正是之前那个 bug 的写法 —— 调试入口漏了三个界面的齿轮，
     * 于是"探针说没缩放、而战斗那一屏看起来正常"。
     */
    setUiScale: (value: number) => {
      state.uiScale = clampUiScale(value);
      d.applyUiScale(state.uiScale);
    },
    /**
     * 设置 / 备战两块调试入口。
     *
     * ⚠️ 抽到了 `app/debugApi.ts` —— 那里写着"为什么不另写一套逻辑"与
     * "为什么 headless 下必须读状态而不是看图"，不在这里重复。
     *
     * ⚠️ 传**取值函数**而不是对象：设置面板与它的开关构造得比这里晚
     * （装配顺序使然），直接传引用会撞 TDZ。
     */
    ...settingsDebugApi(
      () => d.settings,
      () => d.settingsToggle,
      () => d.chrome(),
    ),
    ...homeDebugApi(d.home),
    ...characterSelectDebugApi(d.select),
    ...prepareDebugApi(d.prepare),
    /**
     * **圣光弹的读数**（只读）：`ready` 为假时，`lastError` 会指出卡在哪一帧。
     * 与 `probe()` 一样，它不是"另一套实现"，只是把内部状态摊平。
     */
    spell: () => d.scene.spellDebug() ?? null,
    ...qijiDebugApi(d.qijiSelect, d.runOver),
    ...runConfirmDebugApi(d.runConfirm),
    /**
     * **一局肉鸽的账本**（只读观测）。
     *
     * ⚠️ 这里是**唯一**把 `RunState` 摊平成纯数据的地方（`crossJson`）：
     * `Runtime.evaluate` 的 `returnByValue` 只认对象自己的属性，所以
     * 不能直接把手写的 `RunState` 交出去（`debugApi.ts` 的 `toPlainText`
     * 记着同一个坑）。摊平也让脚本读到的字段名是稳定的。
     */
    run: {
      state: () => {
        const run = d.run.state();
        if (run === undefined) return null;
        const outcomes = run.battleStats.battles ?? [];
        return {
          runSeed: run.runSeed,
          playerId: run.playerId,
          order: [...run.order],
          position: run.position,
          status: run.status,
          unlocked: [...run.unlocked],
          chosen: run.chosen.map((c) => ({ qijiId: c.qijiId })),
          battles: outcomes.map((b) => ({ won: b.won, flawless: b.flawless })),
        };
      },
      phases: () => [...d.run.phases()],
    },
    /**
     * 返回箭头（截图 / 触屏验证用）。
     *
     * ⚠️ **从当前这一屏的 `ScreenChrome` 反推**（`d.chrome()`）—— 箭头现在
     * 住在选角色屏 / 自由模式各自的 root 里（用户 2026-10-12："stage 上
     * 理论上不挂任何小组件"、"多个页面的齿轮，应该分别定义"）。首页 / 战斗
     * 那一屏没有箭头，所以这几个读数返回 `null` / `false`。
     *
     * ⚠️ `center()` 从**对象自己的几何**反推（`bounds` 是"含角落提示"的
     * 可点区域，箭头在它的左上角）—— 不让脚本抄一份坐标：布局一调，
     * 抄的那份就会静默指到别处（各屏的落位函数记着同一个坑）。
     */
    back: {
      visible: () => d.chrome()?.backBounds !== undefined,
      /**
       * ⚠️ 用三目而不是 `??`：`{ ...undefined }` 会得到 `{}`（不是
       * `nullish`），于是"这一屏没有箭头"会变成一个**空矩形** —— 脚本拿它
       * 去点就会点到画布左上角。
       */
      bounds: () => {
        const b = d.chrome()?.backBounds;
        return b === undefined ? null : { ...b };
      },
      center: () => d.chrome()?.backCenter ?? null,
      /**
       * ⚠️ `null` 而不是 `undefined`：它要跨 `Runtime.evaluate` 的
       * JSON 边界，而 `undefined` 在那里会被丢掉（"没有提示"与"忘了返回"
       * 长得一样）。与 `settings.slotCenter` 同一条约定。
       */
      shortcutBounds: () => d.chrome()?.backShortcutBounds ?? null,
    },
    /** 重开一局（端到端脚本用；见 `global.d.ts` 的说明）。 */
    restart: () => d.restart(),
    /**
     * **界面结构探针**（截图 / 验证脚本用）。
     *
     * ⚠️ 存在的理由：这一轮把齿轮 / 返回箭头从"一个挂 stage 上的共享组件"
     * 改成**四个界面各自持有**（用户 2026-10-12："多个页面的齿轮，应该分别
     * 定义"、"stage 上理论上不挂任何组件"）。于是"某个界面的齿轮在正确位置、
     * 且点得开设置"这件事**必须逐屏验**——只拍一张战斗界面证明不了别的屏。
     *
     * ⚠️ 只读**几何与标志位**：没有"点它"的方法 —— 要验证"点得通"必须注入
     * 真实指针事件（走玩家那条路），与 `back` 的纪律一致。
     */
    chrome: () => {
      const active = d.chrome();
      const dev = d.app.stage;
      /** Pixi 的 `stage.children` 顺序就是 `addChild` 顺序（层叠顺序）。 */
      const children =
        dev !== null && typeof dev === 'object' && 'children' in dev
          ? (dev as { children: readonly { label?: string }[] }).children.length
          : -1;
      return {
        /** 当前相位（字符串；`battle` / `home` / …）。 */
        phase: String(d.state.phase),
        /** 当前这一屏的齿轮在不在（首页 / 选角色 / 自由模式 / 战斗都该有）。 */
        gear: active?.gearShown ?? false,
        /** 齿轮的可点区域（含角落提示；`null` = 这一屏没有齿轮）。 */
        gearBounds: active?.gearBounds ?? null,
        /**
         * 齿轮的**键位提示**（`F1`）包围盒（画布坐标；`null` = 没有）。
         *
         * ⚠️ 与 `back.shortcutBounds` 同一个读数（齿轮这一份是本轮补的）：
         * "齿轮 + 提示在**任何缩放系数**下都不出画布"是本轮的硬验收，
         * 而画布下缘与背景同色 —— 只有这个数能证明"没被裁掉"。
         */
        gearShortcutBounds: active?.gearShortcutBounds ?? null,
        /** 当前这一屏的返回箭头（只有选角色 / 自由模式有；`null` = 没有）。 */
        backBounds: active?.backBounds ?? null,
        /** 齿轮的键盘焦点（`↑` 那条路的读数）。 */
        gearFocused: active?.focused ?? false,
        /** 这一屏的边角控件当前用的缩放系数（证明"缩放带上了它"）。 */
        chromeScale: active?.scale ?? null,
        /** 设置里的 UI 缩放值（与 `chromeScale` 应当始终相等）。 */
        uiScale: state.uiScale,
        /** `app.stage` 的直接子节点数 —— 用来证明**没有**小组件挂在 stage 上。 */
        stageChildren: children,
      };
    },
    /** 触屏按钮圆心（端到端脚本用）。 */
    touchButtonCenter: (skillId: string) => d.touch.centerOfSkill(skillId),
    /**
     * **输入归属 + 复盘状态**（验证脚本用）。
     *
     * ⚠️ 这两个读数合在一起才能证明"上下键归复盘"：
     *   - `layer()` = `review`（不是 `battle`）→ 键盘没被设置按钮抢走
     *   - `pointerRatio()` 变了 → 内容真的滚了
     * 只截一张图分不清"滚了"和"重新排版了"。
     */
    logReview: {
      layer: () => d.layer(),
      isOpen: () => d.scene.logReview.isOpen(),
      pointerRatio: () => d.scene.logReview.pointerRatio(),
    },
    /**
     * **战斗探针**（只读；字段来源与刷新时机的逐条说明在 `app/debugProbe.ts`）。
     *
     * ⚠️ 两个实参的分工是**刻意的**，不要"统一成一个"：
     *   - `l.engineState` 是**活引擎** —— 战斗者 / tick / status 全部从它现取
     *   - `l.snapshot` 是**渲染视图**（只有技能栏槽位数与飘字条数需要它）；
     *     它每帧重建，且 `injectActions` 会主动作废，所以 `act()` 之后这里
     *     读到的是按刚推进过的引擎重建的新视图，不是上一帧的
     *
     * ⚠️ 探针**不许**走 `drainEvents()`：那是排空语义，读了就等于从另外三个
     * 消费者手里把事件拿走（`act()` 踩过的同一个坑）。
     */
    probe: () => {
      const l = battle();
      /** 备战阶段没有战斗可测：给一份零值快照，而不是 crash。 */
      if (l === undefined) return emptyProbe(state.frameCount, runtimeErrors);
      return buildProbe(l.engineState, l.snapshot, state.frameCount, runtimeErrors);
    },
  };

  installRaidBattleApi(api);

  return api;
}
