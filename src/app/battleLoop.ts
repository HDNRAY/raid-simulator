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
import { ViewAdapter, DEFAULT_SLOTS, type SlotBinding } from './viewAdapter';
import { LogFormatter, type LogEntry } from './logFormat';
import type { BattleSnapshotView } from '../render/viewModel';
import type { Action } from '../core/types';

/** 单帧最多补多少 tick（防止标签页休眠后一次性补几千帧）。 */
const MAX_CATCHUP_TICKS = 5;

export interface BattleLoopOptions {
  readonly engineOptions: CreateBattleOptions;
  readonly bindings: readonly KeyBinding[];
  readonly slots: readonly SlotBinding[];
  readonly timeLimitMs?: number;
  readonly onRestart?: () => void;
  /** 注入输入源（测试用）；不给则绑定到 window。 */
  readonly input?: InputSource;
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
  private lastRealNow: number | undefined;
  private readonly options: BattleLoopOptions;
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
      const tail = this.input?.drain() ?? [];
      if (tail.some((a) => a.type === 'restart')) this.restartRequested = true;
      return;
    }

    const fromInput = this.input?.drain() ?? [];
    const held = this.input
      ? repeatHeld(
          this.input,
          this.bindings,
          state.tick,
          (skillId) => this.isUsable(skillId),
          (skillId) => this.engine.skillOf(skillId)?.holdDrain !== undefined,
        )
      : [];

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
    this.adapter.consume(events, this.engine.snapshot.tick);
    this.logFormatter.consume(events);
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
  setBindings(next: readonly KeyBinding[]): void {
    this.bindings = next;
    this.input?.setBindings(next);
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
