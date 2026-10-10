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
import type { BattleSnapshotView } from '../render/viewModel';
import type { Action } from '../core/types';

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
  private paused = false;
  private restartRequested = false;
  /** 键位表可变（按键设置会改它） */
  private bindings: readonly KeyBinding[];

  constructor(options: BattleLoopOptions) {
    this.options = options;
    this.bindings = options.bindings;
    this.engine = new BattleEngine(options.engineOptions);
    this.adapter = new ViewAdapter(options.engineOptions.skills, options.translate);
    /**
     * 日志格式化器。
     *
     * ⚠️ 它**独立于 ViewAdapter** 消费同一批事件 —— 这样日志的存在
     * 与否完全不影响战斗快照的构建（低耦合的具体含义：加/删日志
     * 不需要动 ViewAdapter）。
     */
    this.logFormatter = new LogFormatter();
    this.attachInput(options.input);
  }

  get snapshot(): BattleSnapshotView {
    if (!this.view) this.view = this.adapter.build(this.engine, this.options.slots, this.timeLimitMsOption);
    return this.view;
  }

  get engineState(): BattleEngine {
    return this.engine;
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
      isHoldSkill: (skillId) => this.engine.skillOf(skillId)?.holdDrain !== undefined,
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
       * 需求：**Esc 直接打开设置弹窗**（顺带暂停），而不是切换暂停。
       * 所以 Esc 交给 `main.ts` 的捕获阶段监听器统一处理；
       * 这里保留 `onUiKey` 只是为了"界面键不作为技能"这个语义
       * （输入层会把 Esc/Enter 从技能处理里摘出来）。
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

  /** 推进一个逻辑 tick。 */
  private step(): void {
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
     */
    const fromInput = [
      ...(this.input?.drain() ?? []),
      ...(this.touchInput?.drain() ?? []),
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
            (skillId) => this.engine.skillOf(skillId)?.holdDrain !== undefined,
          )
        : []),
      ...(this.touchInput
        ? repeatHeld(
            this.touchInput,
            this.touchInput.bindings(),
            state.tick,
            usableNow,
            (skillId) => this.engine.skillOf(skillId)?.holdDrain !== undefined,
          )
        : []),
    ];

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
     * 取本次事件带来的顿帧（取**最大**而不是累加：同一 tick 里被打两下
     * 不该冻两倍时长，那会明显卡住）。
     */
    this.hitStopMs = Math.max(this.hitStopMs, this.adapter.pendingHitStopMs());
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
    if (!skill) return false;
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
