/**
 * 战斗循环：把引擎、输入、渲染接起来。
 *
 * 这是 MVP 的入口逻辑。职责边界：
 *   - 顺序：输入 → 引擎 tick → 事件适配 → 渲染
 *   - 时间**来自调用方**（`frame(realNow)`），所以可以用假时钟测试
 *
 * 时间纪律（架构规范 §12）：
 *   - 逻辑按固定 tick 推进，**绝不把渲染帧的 delta 直接喂给引擎**
 *   - 用累加器把真实帧间隔换算成整数 tick
 */

import { BattleEngine, type CreateBattleOptions } from '../core/combat/battleState';
import { MS_PER_TICK } from '../core/loopConstants';
import { createKeyboardInput, repeatHeld, type InputSource, type KeyBinding } from '../input/keyboard';
import { ViewAdapter, DEFAULT_SLOTS, slotsFromBindings, type SlotBinding } from './viewAdapter';
import { LogFormatter, type LogEntry } from './logFormat';
import type { BattleSnapshotView, SkillSlotView } from '../render/viewModel';
import type { Action } from '../core/types';
import type { EventDef } from '../core/events';

/** 单帧最多补多少 tick（防止标签页休眠后一次性补几千帧）。 */
const MAX_CATCHUP_TICKS = 5;

export interface BattleLoopOptions {
  readonly engineOptions: CreateBattleOptions;
  readonly bindings: readonly KeyBinding[];
  /**
   * 技能栏槽位。可以传**函数** —— 派生技的槽位是每帧变的
   * （派生窗口开了才有），所以由 `ViewAdapter` 每帧调一次算出来。
   */
  readonly slots:
    | readonly SlotBinding[]
    | ((engine: BattleEngine) => readonly SlotBinding[]);
  readonly timeLimitMs?: number;
  readonly onRestart?: () => void;
  /**
   * 这一场是不是**肉鸽里的一场**（2026-10-22）。
   *
   * 只影响结算那句提示（"继续" vs "再来一次"）—— 由开局时按"有没有一局"
   * 决定一次（`battleSetup` 里 `run !== undefined`）。
   */
  readonly roguelike?: boolean;
  /** 注入输入源（测试用）；不给则绑定到 window。 */
  readonly input?: InputSource;
  /**
   * 触屏输入源（可选）。
   *
   * ⚠️ **与 `input` 并存**，不是替换 —— 触屏笔记本这类混合设备上
   * 鼠标键盘与手指都要能用。所以两条来源的 `drain()` 会合并。
   *
   * 它由 `app/touchControls.ts` 创建，生命周期比单个 `BattleLoop` 长
   * （重开一局不该把按钮布局丢掉）。
   */
  /**
   * 触屏输入源。
   *
   * ⚠️ **可以传 getter**，而且强烈建议这么做 —— 踩过的坑：
   * `main.ts` 的 `restartBattle()` 重建 `BattleLoop` 时漏了重新接线，
   * 于是**任何一次重开之后触屏永久断开**（Action 全堆进一个没人 drain
   * 的数组；键盘因为新 new 了一个源所以不受影响 → 表现成"只有触屏坏"）。
   *
   * 传 getter 之后，接线只在构造时写一次，每局重建都读到同一个源 ——
   * **这类"漏补一行"的 bug 从结构上不可能再发生**。
   */
  readonly touchInput?: InputSource | (() => InputSource | undefined);
  /** 是否在引擎结束后自动停止推进 */
  readonly stopOnEnd?: boolean;
  /**
   * 本地化取词（注入）。
   *
   * 只有"纯字符串载荷"（飘字）需要它；状态提示仍然传 i18n key 给渲染层。
   */
  readonly translate?: (key: string) => string;
}

/**
 * 一局战斗。
 *
 * 生命周期：`new BattleLoop(...)` → 每帧 `frame(realNow)` → `render()` 取快照。
 */
export class BattleLoop {
  private engine: BattleEngine;
  private readonly adapter: ViewAdapter;
  private readonly logFormatter: LogFormatter;
  /**
   * 这一场的**全部事件**（肉鸽结算的输入，见 `battleEvents` 的说明）。
   *
   * ⚠️ 与 `logFormatter` 一样在 `requestRestart` 里清空 —— 两个消费者
   * 共用同一个生命周期，否则重开一局会拿着两场混在一起的事件去统计。
   */
  private readonly allEvents: EventDef[] = [];
  private input: InputSource | undefined;
  private accumulator = 0;
  /**
   * **顿帧**剩余毫秒（打击感）。
   *
   * 受击那一瞬间冻结引擎推进，但**继续渲染** —— 于是画面"卡"在
   * 被打中的姿态上，而反冲/挤压这些形变仍在推进。
   *
   * ⚠️ 与 `paused` 一样必须重置 `lastRealNow` 基准：否则顿帧结束时
   * `elapsed` 会含顿帧时长，引擎会**补跑**那几个 tick —— 那就不是
   * "冻结一下"，而是"冻结完快速追帧"，观感完全相反。
   */
  private hitStopMs = 0;
  private lastRealNow: number | undefined;
  private options: BattleLoopOptions;
  /**
   * 解析触屏输入源（兼容直接传源与传 getter 两种形态）。
   *
   * ⚠️ 每个使用点都必须走这里 —— 直接读 `options.touchInput` 会拿到
   * getter 本身而不是源。
   */
  private get touchInput(): InputSource | undefined {
    const t = this.options.touchInput;
    return typeof t === 'function' ? t() : t;
  }
  private ownedInput = false;
  /** 最近一帧的渲染快照 */
  private view: BattleSnapshotView | undefined;
  /**
   * **每个技能最近一次"按下"发生在哪个战斗 tick**（2026-10-22，用户："按住
   * 「弹」……按钮也没有按住的视觉反馈"）。
   *
   * ⚠️ 用 `Map` 而不是布尔：瞬发技的按下要亮**至少到下一次快照**，
   * 所以记"哪一 tick 按的"，由 `pressStateOf()` 折算成"现在还亮不亮"。
   */
  private readonly pressTick = new Map<string, number>();
  private paused = false;
  private restartRequested = false;
  /** 键位表可变（按键设置会改它） */
  private bindings: readonly KeyBinding[];

  constructor(options: BattleLoopOptions) {
    this.options = options;
    this.bindings = options.bindings;
    this.engine = new BattleEngine(options.engineOptions);
    this.adapter = new ViewAdapter(
      options.engineOptions.skills,
      options.translate,
      options.roguelike === true,
      () => this.pressStateOf(),
    );
    /**
     * 日志格式化器。
     *
     * ⚠️ 它**独立于 ViewAdapter** 消费同一批事件 —— 这样日志的存在
     * 与否完全不影响战斗快照的构建（低耦合的具体含义：加/删日志
     * 不需要动 ViewAdapter）。
     */
    /**
     * ⚠️ 传进技能名映射：日志要写"**被「碾压」打了 60**"而不是光一个
     * 数字 —— 有反伤 / 多来源之后，"这一下是谁打的"必须看得出来。
     * 给的是 **i18n key**，翻译由渲染层做（规范 I1）。
     */
    this.logFormatter = new LogFormatter({
      skillNameKeys: new Map(
        [...options.engineOptions.skills].map(([id, skill]) => [id, skill.nameKey]),
      ),
      buffNameKeys: new Map(
        [...options.engineOptions.buffs].map(([id, buff]) => [id, buff.nameKey]),
      ),
      /**
       * ⚠️ 传**函数**而不是 Map：日志要写"**傲慢**用「碾压」击中你"，
       * 而"这一局有谁"是运行期才知道的（构造 formatter 时引擎还没建好）。
       * 惰性解析顺带保证重开一局换了对手也不用重建 formatter。
       */
      combatantNameKey: (id) =>
        this.engine.snapshot.combatants.find((c) => c.id === id)?.nameKey,
      /**
       * 哪些 buff 值得写进日志（需求："boss 二阶段了，发生了什么事情"）。
       *
       * ⚠️ 判据是"**这个 buff 是不是一个事件**"，不是"重不重要" ——
       * `buffApplied` 是最频的事件（每层印记都发），全记会把日志埋掉。
       * 而"二阶段""霸体""倒地""眩晕"恰恰都是 buff，所以必须能筛出来。
       *
       * 用的判据与 `app/skillHints.ts` 同一套：**会锁住行动**或**是霸体**的
       * 才算事件。这样以后新增控制类 buff 会自动进日志，不用记得回来加。
       */
      notableBuffIds: new Set(
        [...options.engineOptions.buffs]
          .filter(([, b]) => {
            const f = b.flags;
            if (f === undefined) return false;
            return (
              f.actionLock === true ||
              (f.restrictToTags?.length ?? 0) > 0 ||
              f.interruptImmune === true
            );
          })
          .map(([id]) => id),
      ),
    });
    this.attachInput(options.input);
  }

  get snapshot(): BattleSnapshotView {
    if (!this.view) this.view = this.adapter.build(this.engine, this.options.slots, this.timeLimitMsOption);
    return this.view;
  }

  get engineState(): BattleEngine {
    return this.engine;
  }

  /**
   * **单独造一个技能槽位视图**（这个技能不必上技能栏）。
   *
   * 用途：触屏按钮可以放"没绑键、因此没上技能栏"的技能 —— 那正是
   * "没绑键的技能在触屏上根本没有按钮"那个死结的解法。按钮上的字 / 代价 /
   * 冷却都来自槽位视图，所以这里按 `skillId` 现造一个。
   *
   * ⚠️ 走 `ViewAdapter.slotViewOf`：与技能栏**同一段构造**，不另写一份
   * 静态近似（那会漂成"按钮亮着、按下去没反应"）。见那边的说明。
   */
  /**
   * **按下状态**（2026-10-22，用户："按住「弹」……按钮也没有按住的视觉反馈，
   * 按了一下，和按住，都需要有"）。
   *
   * - `pressed`：这一 tick 或上一 tick 按下过（≈100~200ms 的灯，瞬发技也看得见）
   * - `holding`：`InputSource.isHeld()` 为真 —— 按住型技能持续亮
   *
   * ⚠️ 判据只有输入层那一份（`isHeld`），渲染层不自己监听 DOM ✗。
   * ⚠️ 键鼠与触屏**合并**：触屏的合成 key 是 `touch:{skillId}`（见 `touchInput`）。
   */
  pressStateOf(): { readonly pressed: ReadonlySet<string>; readonly holding: ReadonlySet<string> } {
    const state = this.engine.snapshot;
    const pressed = new Set<string>();
    for (const [id, tick] of this.pressTick) {
      if (state.tick - tick <= 1) pressed.add(id);
    }
    /** 太老的记录清掉（否则 Map 会一直长） */
    for (const [id, tick] of this.pressTick) {
      if (state.tick - tick > 2) this.pressTick.delete(id);
    }
    /**
     * ⚠️ `holding` **只对按住型技能**有意义（「弹」这种 `holdDrain`）——
     * 瞬发技的键被按住并不代表"正在持续施放" ✗，把它算进 holding 会让
     * 「破」这类技能看着像"按住了"（错的语义）。所以这里过一道 `holdDrain`。
     */
    const isHoldType = (skillId: string): boolean => {
      const skill = this.engine.skillOf(skillId);
      return skill?.kind === 'activeSkill' && skill.holdDrain !== undefined;
    };
    const holding = new Set<string>();
    for (const binding of this.bindings) {
      if (isHoldType(binding.skillId) && this.input?.isHeld(binding.key) === true) {
        holding.add(binding.skillId);
      }
    }
    for (const binding of this.touchInput?.bindings() ?? []) {
      if (isHoldType(binding.skillId) && this.touchInput?.isHeld(`touch:${binding.skillId}`) === true) {
        holding.add(binding.skillId);
      }
    }
    return { pressed, holding };
  }

  slotViewOf(skillId: string, index: number): SkillSlotView | undefined {
    return this.adapter.slotViewOf(this.engine, skillId, index);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private get timeLimitMsOption(): { timeLimitMs?: number } {
    return this.options.timeLimitMs === undefined
      ? {}
      : { timeLimitMs: this.options.timeLimitMs };
  }

  private attachInput(injected: InputSource | undefined): void {
    if (injected) {
      this.input = injected;
      return;
    }
    this.input = createKeyboardInput(window, {
      bindings: this.bindings,
      currentTick: () => this.engine.snapshot.tick,
      /**
       * ⚠️ `holdDrain` 是主动技能专属 —— 按 `kind` 收窄（`?.` 之后
       * `skill?.kind === 'activeSkill'` 已经把 `skill` 收窄成 `ActiveSkillDef`）。
       */
      isHoldSkill: (skillId) => {
        const skill = this.engine.skillOf(skillId);
        return skill?.kind === 'activeSkill' && skill.holdDrain !== undefined;
      },
      /**
       * **派生技**：`Ctrl/Cmd + 源技能键` → 放派生技。
       *
       * 需求："快捷键是 ctrl/command + 原技能快捷键。"
       *
       * ⚠️ 从**上一帧的快照**读（`this.snapshot` 是缓存的），因为
       * 派生窗口的开合是 `ViewAdapter` 在读 —— 输入层不该自己去
       * 翻 buff。`snapshot.skills` 里带 `derivedFrom` 的槽位就是
       * 当前可用的派生技，它的 `key` 就是源技能的键。
       */
      resolveDerived: (baseKey) => {
        const slot = this.snapshot.skills.find(
          (s) => s.derivedFrom !== undefined && s.key.toLowerCase() === baseKey,
        );
        return slot?.skillId;
      },
      /**
       * 界面按键不再由这里处理。
       *
       * 演进：`Esc` 打开设置（顺带暂停）→ **`F1` 打开设置**（2026-10-12，
       * `Esc` 腾出来做返回，见 `app/settingsKeys.ts` 顶部）。
       *
       * 两条路都在**捕获阶段**的窗口监听器里（设置那条在 `settingsKeys`、
       * 返回那条在 `loopWiring`），这里保留 `onUiKey` 只是为了
       * "界面键不作为技能"这个语义（输入层会把 Esc/Enter 从技能处理里摘出来）。
       */
      onUiKey: () => {},
    });
    this.ownedInput = true;
  }

  /** 推进到某个真实时间。 */
  frame(realNow: number): void {
    if (this.lastRealNow === undefined) {
      this.lastRealNow = realNow;
      return;
    }
    const elapsed = realNow - this.lastRealNow;
    this.lastRealNow = realNow;

    if (elapsed <= 0) return;

    // 暂停：只清空累加器，不推进（但不丢弃"暂停了多久"这个概念，
    // 因为下一帧的 elapsed 会含暂停时长 —— 所以要主动重置基准）
    if (this.paused) {
      this.accumulator = 0;
      return;
    }

    /**
     * 顿帧：冻结引擎推进，但**不丢弃本帧的渲染**（下面的 `build` 照跑）
     * —— 反冲与挤压要继续动，否则"顿帧"看起来就是掉帧。
     */
    if (this.hitStopMs > 0) {
      this.hitStopMs = Math.max(0, this.hitStopMs - elapsed);
      this.accumulator = 0;
      this.view = this.adapter.build(this.engine, this.options.slots, this.timeLimitMsOption);
      return;
    }

    this.accumulator += elapsed;
    const maxMs = MAX_CATCHUP_TICKS * MS_PER_TICK;
    if (this.accumulator > maxMs) this.accumulator = maxMs;

    let steps = 0;
    while (this.accumulator >= MS_PER_TICK && steps < MAX_CATCHUP_TICKS) {
      this.accumulator -= MS_PER_TICK;
      this.step();
      steps += 1;
    }

    // 每帧重建一次渲染快照（读取是廉价的；贵的是每个组件重建 Pixi 对象，
    // 而那些是创建一次的）
    this.view = this.adapter.build(this.engine, this.options.slots, this.timeLimitMsOption);

    if (this.restartRequested) {
      this.restartRequested = false;
      this.options.onRestart?.();
    }
  }

  /**
   * **外部注入一批动作并立刻推进一 tick**（调试入口 `__raidBattle.act` 用）。
   *
   * ==================================================================
   * 为什么必须从这里进，而不是调用方自己去戳 `engineState.tick`
   * ==================================================================
   *
   * `step()` 是**唯一**的事件消费点：引擎 `drainEvents()` 出来的事件在
   * 这里被分发给三个消费者（视图适配器 / 日志 / 肉鸽事件流）。绕开它
   * 直接 `engineState.tick(...)` 会**把这一 tick 的事件排空后丢掉** ——
   * 引擎状态确实变了（冷却跳了、读条挂上了），但日志、飘字、肉鸽统计
   * 一个字都看不到。这正是"**静默无效**"：不报错、结果不对，而任何靠
   * `act()` 驱动状态的验证脚本都会读到与渲染层对不上的读数。
   *
   * ⚠️ **不做成"让调用方再 tick 一次"的旁路**：注入的动作与玩家按键走
   * **同一条** `Action[] → engine.tick → 事件三消费者`；它只是把"下一帧
   * 才轮到的那一 tick"**现在就推**（headless 下 rAF 会被降频，脚本需要
   * "推到某个状态再拍"）。所以它仍然是一条**合法的 `Action[]` 注入**，
   * 不改变确定性：同一串注入动作 + 同一串输入 → 同一个结果。
   */
  /**
   * **开发模式专用：一键过关**（`?dev=1` / `config.DEV_MODE`）。
   *
   * 只做一件事：让引擎把 Boss 打死（`engineState.devKill('enemy')`）——
   * 判胜负、`encounterEnd` 事件、`status` 全部由 `./encounterLifecycle.killSide`
   * → `checkDeaths` 走**真实**那条路算出来，所以"一键过关"与"真打赢"的
   * 结算（含满血判定 / 肉鸽推进 / 复盘）**逐字一致** ✓。
   *
   * ⚠️ 它**不是**"直接写一个 victory"：那会绕开事件与推进，留下一个
   * "状态说赢、日志说没打"的中间态 ✗。
   * ⚠️ 也不走"改成 1 血再等动画"：那是另一条路径，且界面会先动画再结算 ✗。
   *
   * @returns 真的打死了吗（已经结束 / 已经没有 Boss ⇒ false）
   */
  devClear(): boolean {
    const killed = this.engineState.devKill('enemy');
    /** 与 `injectActions` 同理由：丢掉缓存的渲染快照。 */
    this.view = undefined;
    return killed;
  }

  injectActions(actions: readonly Action[], actorId?: string): void {
    if (actions.length === 0) return;
    this.step(actions, actorId);
    /**
     * ⚠️ 丢掉缓存的渲染快照：下一次读 `snapshot`（探针 / 渲染）会按
     * **刚推进过的引擎**重建 —— 否则探针会读到注入前的旧视图
     * （"引擎与读数不一致"正是这次要修的读数之一）。
     */
    this.view = undefined;
  }

  /**
   * 推进一个逻辑 tick。
   *
   * @param extra 本 tick 额外注入的动作（`injectActions` 用；与真实输入同路）
   * @param extraActorId 注入动作的执行者。不给则与真实输入一样按阵营推断
   */
  private step(extra: readonly Action[] = [], extraActorId?: string): void {
    const state = this.engine.snapshot;
    if (this.options.stopOnEnd !== false && state.status !== 'running') {
      // 战斗已结束：仍消费输入（让重开生效），但不推进引擎
      const tail = [...(this.input?.drain() ?? []), ...(this.touchInput?.drain() ?? [])];
      if (tail.some((a) => a.type === 'restart')) this.restartRequested = true;
      return;
    }

    /**
     * **两条输入来源合并**（键鼠 + 触屏）。
     *
     * `repeatHeld` 遍历的是各自的绑定表：
     *   - 键盘：`q` / `w` / … 这些真按键
     *   - 触屏：`touch:attack` 这类**合成 key**（见 `touchInput.ts`）
     *
     * 两边的 key 空间不重叠，所以合并很安全。
     *
     * ⚠️ **注入的动作合进同一个数组**（`injectActions` 的 `extra`）：
     * 玩家那条路的执行者由引擎按阵营推断，注入的也一样。显式指定了
     * `extraActorId`（例如给 Boss 发招）时**不并入** —— 那种动作由下面
     * 的 `applyActions` 按指定执行者应用。
     */
    const fromInput = [
      ...(this.input?.drain() ?? []),
      ...(this.touchInput?.drain() ?? []),
      ...(extraActorId === undefined ? extra : []),
    ];
    /**
     * ⚠️ **这一 tick 刚被请求过的技能**，不让连发逻辑再补一发。
     *
     * 踩过的坑（实测）：`drain()` 与 `repeatHeld()` 是**同一份 tick 前状态**
     * 上的两个独立求值 —— `drain()` 拿到本次按下产生的 `hold`，紧接着
     * `repeatHeld()` 看到"该键仍被按住 且 `isUsable` 仍为真（引擎还没
     * tick，`casts` 还是空的）"，于是**同 tick 又补一个 `useSkill`**。
     * 两个动作进同一个 `engine.tick()`，第一个启动读条、第二个撞
     * `checkGate` 的 `casting` 被拒 → 玩家看到「攻 · 正在施放中」。
     *
     * 后果**不止多一句提示**：瞬发技能会**双执行、双扣资源**
     * （实测「破」一个 tick 内两条 `energy:-10`、两次 `interruptSuccess`）。
     *
     * 修在这里而不是输入层：`touchInput` 那边早已只发 `hold`（上一轮修过），
     * 重复是在**循环层**产生的 —— 键盘单按 `Q` 同样中招。
     * `repeatHeld` 的语义是"**按住**才连发"，而"这一 tick 刚按下的那一次"
     * 已经由 `drain()` 投递了，首 tick 不该再由它补。
     * 后续 tick 的按住连发完全不受影响。
     */
    /** 这一 tick 的**按下**（`useSkill` / `hold` 都算：瞬发与按住型一样要点亮） */
    for (const action of fromInput) {
      if (action.type === 'useSkill' || action.type === 'hold') {
        this.pressTick.set(action.skillId, state.tick);
      }
    }
    const requestedThisTick = new Set(
      fromInput
        .filter((a) => a.type === 'useSkill' || a.type === 'hold')
        .map((a) => a.skillId),
    );
    const usableNow = (skillId: string): boolean =>
      this.isUsable(skillId) && !requestedThisTick.has(skillId);

    const held = [
      ...(this.input
        ? repeatHeld(
            this.input,
            this.bindings,
            state.tick,
            usableNow,
            (skillId) => {
              const skill = this.engine.skillOf(skillId);
              return skill?.kind === 'activeSkill' && skill.holdDrain !== undefined;
            },
          )
        : []),
      ...(this.touchInput
        ? repeatHeld(
            this.touchInput,
            this.touchInput.bindings(),
            state.tick,
            usableNow,
            (skillId) => {
              const skill = this.engine.skillOf(skillId);
              return skill?.kind === 'activeSkill' && skill.holdDrain !== undefined;
            },
          )
        : []),
    ];

    /**
     * ⚠️ **显式指定执行者的注入**（`injectActions(actions, actorId)`）：
     * 引擎的 `tick()` 只接受**一个**执行者给整批动作，所以这类注入先用
     * `applyActions(actions, actorId)` 应用到工作副本 —— 它开/提交自己的一份
     * 副本，随后 `tick()` 再开一份读提交后的状态，两边看到的 tick 号相同。
     * 事件留在引擎里，由下面**同一个** `drainEvents()` 分发给三个消费者
     * （这正是"不丢事件"的关键）。
     */
    if (extraActorId !== undefined && extra.length > 0) {
      this.engine.applyActions(extra, extraActorId);
    }

    const actions: Action[] = [...fromInput, ...held];
    this.engine.tick(actions);
    /**
     * **一次 drain，两个独立消费者。**
     *
     * 视图快照与战斗日志都读同一批事件，但彼此不知道对方存在 ——
     * 加/删日志不需要动 `ViewAdapter`（这就是"低耦合"的具体含义）。
     * `drainEvents` 是**排空**语义，所以只能调一次，必须在这里分发。
     */
    const events = this.engine.drainEvents();
    const snapshot = this.engine.snapshot;
    const playerId = snapshot.combatants.find((c) => c.side === 'ally')?.id ?? 'player';
    this.adapter.consume(events, snapshot.tick, playerId, (id) => {
      return snapshot.combatants.find((c) => c.id === id)?.caps.hp ?? 0;
    });
    this.logFormatter.consume(events);
    /**
     * **第三个消费者：这一场战斗的完整事件流**（肉鸽的结算用）。
     *
     * ⚠️ 它是 `core/run/stats.ts` 的输入 —— 用户明确要求"从 log 判断，
     * 不要又加一层记录"（§5.2 的方向修正），所以一局肉鸽的统计**不是**
     * 引擎里的计数器，而是"这一场的事件数组"归约出来的。
     *
     * ⚠️ 为什么存在这里（而不是让 app 另外接一个 drain）：`drainEvents`
     * 是**排空**语义，一个 tick 只能调一次（见上面那段注释）——
     * 再加一个消费者就必须在同一处收集。清空时机由 `requestRestart`
     * 负责（与 `logFormatter.clear()` 同一处）。
     */
    this.allEvents.push(...events);
    /**
     * 取本次事件带来的顿帧（取**最大**而不是累加：同一 tick 里被打两下
     * 不该冻两倍时长，那会明显卡住）。
     */
    this.hitStopMs = Math.max(this.hitStopMs, this.adapter.pendingHitStopMs());
  }

  /**
   * 这一场从开战到现在的**全部事件**（肉鸽结算用；只读）。
   *
   * ⚠️ 单场 / 自由模式**不读它**（没有消费者）—— 收集本身是 O(1) 的
   * push，不会让那些路径的行为变一个字。
   */
  get battleEvents(): readonly EventDef[] {
    return this.allEvents;
  }

  /** 当前战斗日志（只读，供渲染层画右侧面板）。 */
  get logEntries(): readonly LogEntry[] {
    return this.logFormatter.all();
  }

  /**
   * 技能当前是否可用。
   *
   * 用于"按住连发"：只在引擎确实能接受时才补 Action，
   * 否则会每 tick 产生一堆 `skillRejected` 事件。
   *
   * 判据与引擎门禁**共用**（`isOnGcd`）—— 早期这里自己写了一份
   * 带"余量"的版本，结果每个 GCD 周期都漏出误报。
   */
  private isUsable(skillId: string): boolean {
    const skill = this.engine.skillOf(skillId);
    /**
     * ⚠️ **只有主动技能"可用"** —— 代价 / 冷却 / 读条是主动技能专属，
     * 被动技能不会被"使用"。顺手把 `kind` 判在这里，下面就不必再判。
     */
    if (!skill || skill.kind !== 'activeSkill') return false;
    const state = this.engine.snapshot;
    const actor = state.combatants.find((c) => c.side === 'ally');
    if (!actor || !actor.alive) return false;
    if (actor.casts.length > 0) return false;
    const readyAt = actor.cooldowns[skillId] ?? 0;
    if (readyAt > state.tick) return false;
    for (const cost of skill.cost) {
      const need = typeof cost.value === 'number' ? cost.value : 0;
      const has = (actor.resources as Record<string, number>)[cost.resource] ?? 0;
      if (has < need) return false;
    }
    for (const cond of skill.requires ?? []) {
      if (cond.kind === 'hasBuff' && !actor.buffs.some((b) => b.defId === cond.buffId)) return false;
    }
    return true;
  }

  /** 当前键位表。 */
  currentBindings(): readonly KeyBinding[] {
    return this.bindings;
  }

  /** 替换键位表（按键设置用）。会同步到输入层。 */
  /**
   * 接上触屏输入源。
   *
   * ⚠️ **必须在构造之后调用**，不能走构造参数：`BattleLoop` 是每次
   * 重开都会重建的，而触屏控件（布局 + 按钮层 + 输入源）的生命周期
   * **比一局长得多** —— 重开一局不该把按钮布局丢掉。主循环在创建
   * 触屏控件后立刻接上它。
   */
  /**
   * 改键位表。
   *
   * ⚠️ 同时更新**输入层**与**画面技能格** —— 键位表是它们的唯一真相
   * 来源。原先只更新输入层，于是改完键画面还是老样子，
   * 而"没绑键的技能不上场"这条规则也没法表达。
   */
  setBindings(next: readonly KeyBinding[]): void {
    this.bindings = next;
    this.input?.setBindings(next);
    /**
     * ⚠️ 只在 `slots` **不是函数**时才重算：函数形态由 `ViewAdapter`
     * 每帧自己算（它要读派生窗口），覆盖成静态数组会让派生技永远
     * 不再出现。
     */
    if (typeof this.options.slots !== 'function') {
      this.options = { ...this.options, slots: slotsFromBindings(next) };
    }
    this.view = undefined;
  }

  /** 输入层（设置界面要独占输入做改键捕获）。 */
  get inputSource(): InputSource | undefined {
    return this.input;
  }

  /** 请求重开（下一帧生效）。 */
  requestRestart(): void {
    this.logFormatter.clear();
    /** ⚠️ 事件流也要清（见 `allEvents`）：否则统计会把两场混在一起。 */
    this.allEvents.length = 0;
    this.restartRequested = true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    // 恢复时重置时间基准，避免把暂停时长算进 elapsed
    this.lastRealNow = undefined;
  }

  dispose(): void {
    if (this.ownedInput) this.input?.dispose();
  }
}

export { DEFAULT_SLOTS };
