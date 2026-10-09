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
}

/**
 * 一局战斗。
 *
 * 生命周期：`new BattleLoop(...)` → 每帧 `frame(realNow)` → `render()` 取快照。
 */
export class BattleLoop {
  private engine: BattleEngine;
  private readonly adapter: ViewAdapter;
  private input: InputSource | undefined;
  private accumulator = 0;
  private lastRealNow: number | undefined;
  private readonly options: BattleLoopOptions;
  private ownedInput = false;
  /** 最近一帧的渲染快照 */
  private view: BattleSnapshotView | undefined;
  private paused = false;
  private restartRequested = false;

  constructor(options: BattleLoopOptions) {
    this.options = options;
    this.engine = new BattleEngine(options.engineOptions);
    this.adapter = new ViewAdapter(options.engineOptions.skills);
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
      bindings: this.options.bindings,
      currentTick: () => this.engine.snapshot.tick,
      isHoldSkill: (skillId) => this.engine.skillOf(skillId)?.holdDrain !== undefined,
      onUiKey: (key) => {
        if (key === 'escape') this.paused = !this.paused;
      },
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
          this.options.bindings,
          state.tick,
          (skillId) => this.isUsable(skillId),
          (skillId) => this.engine.skillOf(skillId)?.holdDrain !== undefined,
        )
      : [];

    const actions: Action[] = [...fromInput, ...held];
    this.engine.tick(actions);
    this.adapter.consume(this.engine.drainEvents(), this.engine.snapshot.tick);
  }

  /**
   * 技能当前是否可用。
   *
   * 用于"按住连发"：只在引擎确实能接受时才补 Action，
   * 否则会每 tick 产生一堆 `skillRejected` 事件。
   *
   * ------------------------------------------------------------------
   * ⚠️ GCD 要**多留一个 tick 的余量**
   * ------------------------------------------------------------------
   *
   * 踩过的坑：这里与引擎门禁在同一时刻判断，但动作是在**下一个 tick**
   * 才被引擎处理。于是 GCD 还剩 1 个 tick 时这里判"可用"，
   * 动作入队后到下一 tick 已被 GCD 拦住 —— 表现为玩家每次按普攻
   * 都会看到一次「公共冷却中」的误报。
   *
   * 修法：要求 GCD 在**下一 tick 之后**才结束，即剩余 > 1。
   * 代价是最坏情况晚 1 tick（16.7ms）施放，远小于感知阈值。
   */
  private isUsable(skillId: string): boolean {
    const skill = this.engine.skillOf(skillId);
    if (!skill) return false;
    const state = this.engine.snapshot;
    const actor = state.combatants.find((c) => c.side === 'ally');
    if (!actor || !actor.alive) return false;
    if (actor.casts.length > 0) return false;
    if (skill.gcd) {
      const gcd = actor.buffs.find((b) => b.defId === 'gcd');
      // 见上面的说明：留一个 tick 的余量，避免"入队即被拒"的误报
      if (gcd !== undefined && gcd.expiresAtTick > state.tick + 1) return false;
    }
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

  /** 请求重开（下一帧生效）。 */
  requestRestart(): void {
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
