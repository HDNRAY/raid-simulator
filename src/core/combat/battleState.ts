/**
 * 战斗状态与 tick 管线。
 *
 * 数据模型规范 §1 的"运行时状态"层。这是把修正树 / buff / 技能 / 判定
 * 接起来的地方。
 *
 * ------------------------------------------------------------------
 * tick 管线（顺序即优先级，不变量）
 * ------------------------------------------------------------------
 *
 *   1. applyActions    入队动作生效（门禁 → 消耗 → 开始读条）
 *   2. advanceCasts    读条推进 → 到 hit frame 的段标记待结算
 *   3. resolveHits     判定：查 invulnerable / damageReduce → 伤害/治疗
 *   4. tickBuffs       DoT/HoT 到点触发；duration 到点过期
 *   5. regenerate      资源自然回复
 *   6. ai              Boss 读快照 → 选技能 → 产出与玩家按键等价的 Action
 *   7. deaths          死亡判定、战斗结束条件
 *
 * **顺序不能变**：改了就会改变战斗结果，黄金重放测试会立刻发现。
 *
 * ------------------------------------------------------------------
 * 数值纪律
 * ------------------------------------------------------------------
 *
 * 时间是整数 tick；buff 用截止 tick；生命是整数。
 * 见架构规范 §12。
 */

import { type CombatContext } from './index';
import { createAiState, type AiState } from '../ai';
import type { StatBreakdown } from '../stats/pipeline';
import type { HitResolutionContext } from './hitResolution';
import {
  clampStart,
  createWorkSet,
  defaultActorIdOf,
  toMutable,
  type MutableCombatant,
} from './battleStateTypes';
import { endHold, gainDouqiFromDamage, startHold, tickHolds, type HoldsContext } from './holds';
import {
  runAbilities,
  runAi,
  type AbilitiesContext,
  type AiContext,
} from './runAi';
import {
  advanceCasts,
  tryUseSkill,
  type CastPipelineContext,
} from './castPipeline';
import {
  applyEnrage,
  statsBreakdownOf,
  statsOf,
  type StatsContext,
} from './stats';
import { nextRandom, type RngState } from '../rng';
import { triggerContextFor } from './triggerContext';
import { runTriggers } from './triggers';
import { BuffHookDispatch } from './buffHookDispatch';
import {
  checkDeaths,
  checkTimeLimit,
  expireBuffs,
  regenerateResources,
  type UpkeepContext,
} from './encounterLifecycle';
import type {
  Action,
  BattleState,
  BuffDef,
  Combatant,
  EventDef,
  SkillDef,
  StatKey,
  StatModifier,
  DamageSpec,
} from '../types';

/** 起始初始状态需要的输入。 */
export interface CreateBattleOptions {
  readonly combatants: readonly Combatant[];
  readonly seed: number;
  /** 时间限制（ms）。超时判负。 */
  readonly timeLimitMs?: number;
  /** 谁是 Boss（AI 驱动方）。不给则没有 AI。 */
  readonly bossId?: string;
  readonly buffs: ReadonlyMap<string, BuffDef>;
  readonly skills: ReadonlyMap<string, SkillDef>;
  /** 每个 combatant 的基础属性（内容定义） */
  readonly baseStats: ReadonlyMap<string, Partial<Record<StatKey, number>>>;
  /** 每个 combatant 身上的被动修正（装备 / 天赋） */
  readonly passiveModifiers: ReadonlyMap<string, readonly StatModifier[]>;
}

/** 引擎实例：持有不可变的内容定义 + 可变的战斗状态。 */
export class BattleEngine {
  private state: BattleState;
  private rng: RngState;
  private readonly options: CreateBattleOptions;
  private readonly events: EventDef[] = [];
  /**
   * AI 状态（已用的 opener、各技能上次施放 tick、阶段、狂暴）。
   *
   * **必须在引擎内部持久**：它是决策的输入，必须随战斗一起可重放。
   * 如果放在外部，回放时 AI 会做出不同决定。
   *
   * ⚠️ 它带**自己的**随机流（`aiRngSeed`）—— 与玩家的 `rngSeed` 分开，
   * 这样随机选招不会扰动玩家侧的黄金基线（见 `AiState.aiRngSeed`）。
   */
  private aiState: AiState;

  /** buff 钩子派发器：理由与实现都在 `./buffHookDispatch.ts`。 */
  private readonly buffHooks = new BuffHookDispatch();

  constructor(options: CreateBattleOptions) {
    this.options = options;
    this.rng = { seed: options.seed >>> 0 };
    this.aiState = createAiState(options.seed);
    this.state = {
      tick: 0,
      rngSeed: options.seed >>> 0,
      status: 'running',
      combatants: options.combatants.map((c) => ({
        ...c,
        resources: clampStart(c),
      })),
      startedAtTick: 0,
      charges: {},
    };
  }

  /**
   * 当前战斗状态的只读快照。
   *
   * ⚠️ `rngSeed` 从**实时的 rng** 取，而不是直接用 `this.state.rngSeed`。
   *
   * 踩过的坑：这个字段长期是 Hardcode 的初始种子（构造时写进 state 之后再没更新），
   * 于是"随机数状态在状态里、所以战斗可重放"这条设计约定**实际上是假的** ——
   * 快照里读不到推进后的随机状态。虽然重放本身只依赖初始种子，
   * 但任何"从快照恢复战斗"的用法（存档、断线续玩、分叉调试）都会静默错位。
   *
   * `aiRngSeed` 同理：它从 `aiState` 取，而不是直接用构造时写进 state 的那个值
   * —— 否则它就是同一个坑的第二个实例。
   */
  get snapshot(): BattleState {
    return { ...this.state, rngSeed: this.rng.seed, aiRngSeed: this.aiState.aiRngSeed };
  }

  /**
   * 按 id 查技能定义。
   *
   * 暴露给渲染适配器（它需要技能名与 hit 时间轴来画预警条）。
   * 这是**只读查询**，不改变任何状态。
   */
  skillOf(skillId: string): SkillDef | undefined {
    return this.options.skills.get(skillId);
  }

  /** 按 id 查 buff 定义（只读，同上）。 */
  buffDef(buffId: string): BuffDef | undefined {
    return this.options.buffs.get(buffId);
  }

  /** 全部技能 id（UI 构建技能栏用）。 */
  get skillIds(): readonly string[] {
    return [...this.options.skills.keys()];
  }

  /** 取出并清空自上次调用以来产生的事件。 */
  drainEvents(): readonly EventDef[] {
    const out = [...this.events];
    this.events.length = 0;
    // ⚠️ 游标与事件数组是同一份状态：清了事件就必须归零，
    // 否则下一 tick 的派发会从越界下标开始（静默漏掉所有 buff 钩子）。
    this.buffHooks.reset();
    return out;
  }

  /* ---------------------------------------------------------------- *
   * AI（M4）：行为数组 → Action
   * ---------------------------------------------------------------- */

  /**
   * 属性计算与狂暴 —— 实现搬到 `./stats.ts`（约 105 行）。
   *
   * 这里只留**薄委托**：把引擎的能力打包成 `StatsContext` 交过去。
   * 公开方法（`statsOf` / `statsBreakdownOf`）名字不变 —— 拆文件
   * 不该改动对外 API。
   */
  statsBreakdownOf(id: string): Readonly<Partial<Record<StatKey, StatBreakdown>>> | undefined {
    return statsBreakdownOf(this.statsContext(), id);
  }

  statsOf(combatantId: string): Readonly<Record<StatKey, number>> {
    return statsOf(this.statsContext(), combatantId);
  }

  private applyEnrage(boss: Combatant): void {
    applyEnrage(this.statsContext(), boss);
  }

  /**
   * AI 轮转 + 能力执行器 —— 实现搬到 `./runAi.ts`（约 105 行）。
   *
   * ⚠️ `aiState` **仍然留在引擎**：它必须随战斗一起持久、可重放
   * （放外部的话回放时 AI 会做出不同决定）。这里只是把"怎么决策"
   * 借出去，状态还是引擎的。
   */
  private aiContext(): AiContext {
    return {
      state: this.state,
      events: this.events,
      tick: this.state.tick,
      combatants: this.state.combatants,
      aiState: this.aiState,
      /**
       * ⚠️ 唯一的 AI 状态写回路径 —— 见 `AiContext.updateAiState` 的说明。
       * 没有它，`ctx.aiState = next` 只会改一个被丢弃的临时对象，
       * 引擎的 `lastUsedAt` 永远是空的（`gapMs` 与保底同时失效）。
       */
      updateAiState: (next) => {
        this.aiState = next;
      },
      buffs: this.options.buffs,
      skills: this.options.skills,
      options: {
        ...(this.options.bossId === undefined ? {} : { bossId: this.options.bossId }),
        skills: this.options.skills,
      },
      current: (id) => this.current(id),
      replaceCombatant: (updated) => this.replaceCombatant(updated),
      opponentOf: (id) => this.opponentOf(id),
      applyEnrage: (boss) => this.applyEnrage(boss),
      runAbilities: (actorId, abilities) => runAbilities(this.abilitiesContext(), actorId, abilities),
      applyActions: (actions, actorId) => this.applyActions(actions, actorId),
    };
  }

  /** 能力执行器需要的引擎能力。 */
  private abilitiesContext(): AbilitiesContext {
    return {
      tick: this.state.tick,
      combatants: this.state.combatants,
      buffs: this.options.buffs,
      skills: this.options.skills,
      events: this.events,
      current: (id) => this.current(id),
      replaceCombatant: (updated) => this.replaceCombatant(updated),
      opponentOf: (id) => this.opponentOf(id),
    };
  }

  /**
   * 按住型技能 + 炁换算 —— 实现搬到 `./holds.ts`（约 115 行）。
   *
   * ⚠️ 它们原先用 `this.work?.get(id)` 取工作副本，现在统一走
   * `current()` —— 后者本来就是 work-aware 的（先查工作副本、
   * 没有才回落到 state），所以是**语义等价**的简化。
   */
  private holds(): HoldsContext {
    return {
      tick: this.state.tick,
      combatants: this.state.combatants,
      skills: this.options.skills,
      buffs: this.options.buffs,
      events: this.events,
      current: (id) => this.current(id),
      replaceCombatant: (updated) => this.replaceCombatant(updated),
      tryUseSkill: (skillId, actorId) => tryUseSkill(this.castPipeline(), skillId, actorId),
    };
  }

  /**
   * 施法流程 —— 实现搬到 `./castPipeline.ts`（约 465 行）。
   *
   * 引擎**不再持有这些方法的实现**，只在 tick 的合适位置调用它们
   * （tick 顺序是引擎的职责，见 `tick()`）。
   */
  private castPipeline(): CastPipelineContext {
    return {
      tick: this.state.tick,
      combatants: this.state.combatants,
      events: this.events,
      skills: this.options.skills,
      buffs: this.options.buffs,
      current: (id) => this.current(id),
      replaceCombatant: (updated) => this.replaceCombatant(updated),
      opponentOf: (id) => this.opponentOf(id),
      statsOf: (id) => this.statsOf(id),
      hit: () => this.hitContext(),
      combatContext: this.ctx,
    };
  }

  /** 命中结算阶段需要的引擎能力（每次现取，避免持有可变引用）。 */
  private hitContext(): HitResolutionContext {
    return {
      state: this.state,
      events: this.events,
      current: (id) => this.current(id),
      replaceCombatant: (updated) => this.replaceCombatant(updated),
      opponentOf: (id) => this.opponentOf(id),
      statsOf: (id) => this.statsOf(id),
      rollCrit: (stats, damage) => this.rollCrit(stats, damage),
      /**
       * 触发器需要的能力（解析定义 + 三类落地动作）。
       *
       * ⚠️ 实现抽到了 `triggerContext.ts` —— 那一块是**触发器专用**的，
       * 与战斗状态机无关；留在这里会把这个文件顶过 700 行上限
       * （AGENTS.md §3），而且每加一种能力都会再顶一次。
       */
      /**
       * 触发器引擎的落地动作（反伤等）。
       *
       * ⚠️ 显式**转发**而不是把 `this` 传出去：`current` /
       * `replaceCombatant` 是 private，传 `this` 过不了类型（那会誘人写成
       * `as never` 绕过去，见 AGENTS.md §1）。
       */
      ...triggerContextFor(
        {
          current: (id) => this.current(id),
          replaceCombatant: (updated) => this.replaceCombatant(updated),
          statsOf: (id) => this.statsOf(id),
          events: this.events,
          combat: this.ctx,
        },
        () => this.roll(),
      ),
      gainDouqiFromDamage: (id, damage, tick) => gainDouqiFromDamage(this.holds(), id, damage, tick),
      pushBuffApplied: (id, buffId, stacks) => {
        this.events.push({
          kind: 'buffApplied',
          tick: this.state.tick,
          targetId: id,
          buffId,
          stacks,
          sourceId: id,
        });
      },
    };
  }

  /** 属性计算阶段需要的引擎能力（每次现取，避免持有可变引用）。 */
  private statsContext(): StatsContext {
    return {
      tick: this.state.tick,
      combatants: this.state.combatants,
      options: this.options,
      current: (id) => this.current(id),
      replaceCombatant: (updated) => this.replaceCombatant(updated),
      resolveCombatantFor: (selfId, who) => this.resolveCombatant(selfId, who),
      pushEnrageStarted: (bossId) => {
        this.events.push({ kind: 'enrageStarted', tick: this.state.tick, bossId });
      },
    };
  }

  private get ctx(): CombatContext {
    /**
     * ⚠️ 这个本地的 `ctx` 是给 `evaluateCondition` / 技能门禁用的，
     * 与上面 `hitContext()` 里那份**不是同一个**（那份带触发器落地动作）。
     * 两者都要满足 `CombatContext` 的形状 —— 曾经误删过这里的
     * `buffDef` / `currentTick`，表现是 81 个测试报
     * `ctx.currentTick is not a function`，而类型检查只报一条。
     */
    return {
      statsOf: (id: string) => this.statsOf(id),
      buffDef: (buffId: string) => this.options.buffs.get(buffId),
      skillDef: (skillId: string) => this.options.skills.get(skillId),
      currentTick: () => this.state.tick,
    };
  }

  /**
   * 直接写入一个单位的状态。
   *
   * ⚠️ **只给测试与开发者工具用**，正常玩法路径不该调用它 ——
   * 那会绕过门禁与结算。存在的理由是：有些状态（例如"某个 buff 还剩 1 tick"）
   * 靠正常流程构造代价很高，而测试需要精确控制它。
   */
  replaceCombatantForTest(updated: Combatant): void {
    this.replaceCombatant(updated);
  }

  /** 把 `who` 解析成实际的 combatant（单挑场景下 target 就是对手）。 */
  private resolveCombatant(selfId: string, who: string): Combatant {
    if (who === 'self' || who === 'caster') {
      return this.state.combatants.find((c: Combatant) => c.id === selfId) ?? this.state.combatants[0]!;
    }
    const self = this.state.combatants.find((c: Combatant) => c.id === selfId);
    const opponent = this.state.combatants.find((c: Combatant) => c.side !== self?.side);
    return opponent ?? self ?? this.state.combatants[0]!;
  }

  private opponentOf(id: string): Combatant | undefined {
    const self = this.state.combatants.find((c: Combatant) => c.id === id);
    return this.state.combatants.find((c: Combatant) => c.side !== self?.side);
  }

  /* ---------------------------------------------------------------- *
   * 按住型技能（「防」）
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * 工作副本：一次 tick 内只有一份可变状态
   * ---------------------------------------------------------------- */

  /**
   * 本次 tick 的可变工作副本（`id → Combatant`）。
   *
   * **这是引擎的核心不变量**：一次 tick 内所有修改都写进这里，
   * tick 结束时由 `commitWork()` 一次性提交回 `this.state`。
   *
   * 为什么这样设计（有据可查）：早先的版本有 15 处 `replaceCombatant`
   * 调用，彼此用过期快照互相覆盖，同一个 bug 类反复出现 5 次，
   * 症状都是"事件发了但状态没变"。改成单一可变副本后，
   * **结构上不可能再发生覆盖** —— 因为只有一处写回。
   */
  private work: Map<string, MutableCombatant> | undefined;

  /** 全部工作副本单位（按 state 原顺序）。 */
  private mutableAll(): MutableCombatant[] {
    return this.state.combatants
      .map((c: Combatant) => this.work?.get(c.id))
      .filter((c): c is MutableCombatant => c !== undefined);
  }

  /** 开始一个 tick 的工作副本（浅拷贝 + 需要改的容器深拷贝一层）。 */
  private beginWork(): void {
    this.work = createWorkSet(this.state.combatants);
  }

  /** 把工作副本一次性提交回 state。**这是唯一的写回点。** */
  private commitWork(): void {
    const work = this.work;
    this.work = undefined;
    if (!work) return;
    this.state = {
      ...this.state,
      combatants: this.state.combatants.map((c: Combatant) => work.get(c.id) ?? c),
    };
  }

  /* ---------------------------------------------------------------- *
   * 主循环
   * ---------------------------------------------------------------- */

  /**
   * 应用一批动作。对应管线第 1 步。
   *
   * `actorId` 决定"谁在执行这些动作" —— 这让**玩家与 Boss 走完全同一条
   * 施法路径**（数据模型规范：两边只差输入来源）。
   * 不给则默认玩家。
   */
  applyActions(actions: readonly Action[], actorId?: string): void {
    /**
     * 在 tick 之外被调用时（测试、工具、将来的回放注入），
     * 这里**临时开一个工作副本并在结束时提交**。
     *
     * 为什么必须有这个兜底：一次 tick 内的所有读写都走工作副本，
     * 而 `tryUseSkill` 的 actor 也从工作副本读。如果调用方在 tick
     * 之外调进来，工作副本不存在 —— 早期版本会**静默什么都不做**
     * （没有事件、没有异常），排查成本极高。
     *
     * `actorId` 不给则按阵营推断（第一个存活的我方单位），
     * 而不是写死 'player' —— 写死会让 id 也叫 'player' 的敌方单位
     * 被误当成施法者。
     */
    const owned = this.work === undefined;
    if (owned) this.beginWork();
    try {
      const resolvedActor = actorId ?? this.defaultActorId();
      for (const action of actions) {
        if (action.type === 'useSkill') tryUseSkill(this.castPipeline(), action.skillId, resolvedActor);
        else if (action.type === 'hold') startHold(this.holds(), action.skillId, resolvedActor);
        else if (action.type === 'releaseSkill') endHold(this.holds(), action.skillId, resolvedActor);
      }
    } finally {
      if (owned) this.commitWork();
    }
  }

  /** 默认施法者 —— 纯函数实现搬到 `./battleStateTypes.ts`（本文件顶在 700 行上限）。 */
  private defaultActorId(): string {
    return defaultActorIdOf(this.state.combatants);
  }

  /**
   * 推进一个 tick。这是**唯一的**状态推进入口。
   *
   * @param actions 本 tick 要应用的玩家 / AI 动作
   * @param aiActions AI 产出的动作（M4 会填充；现在可以为空）
   */
  /**
   * 推进一个 tick。
   *
   * @param actions 玩家本 tick 的动作
   *
   * AI 的动作由引擎内部产出（见 `runAi`）—— 它和玩家动作走**同一条**
   * `applyActions` 路径，只是 actor 不同。这样"Boss 与玩家共用引擎"
   * 才是真的，而不是两套代码碰巧产生相似结果。
   */
  /**
   * 推进一 tick。
   *
   * @param actions 本 tick 要应用的动作
   * @param actorId 动作的施放者。不传时按"单人一侧"推断 ——
   *   调试入口需要能给 Boss 也发动作（例如手动触发霸体招式来看表现）。
   */
  tick(actions: readonly Action[] = [], actorId?: string): void {
    if (this.state.status !== 'running') return;

    // 开一个 tick 的工作副本；结束时一次提交（见 work 的说明）
    this.beginWork();

    // 1. 动作生效
    this.applyActions(actions, actorId ?? 'player');
    runAi(this.aiContext());

    // 2. 读条推进
    advanceCasts(this.castPipeline());

    // ⚠️ 原 `tickOverTimeEffects()`（"DoT 到点触发"）循环体是**空的**，只看名字会
    // 以为 DoT 已支持。DoT 应由 `onTick` 触发器表达（见 `triggers.ts`），别恢复空壳。

    // 3. buff 过期
    this.expireBuffs();
    // 4. 资源回复
    this.regenerateResources();

    // 5b. 按住型技能的持续消耗（按逻辑步）
    tickHolds(this.holds());

    // 5c. buff 钩子（在 `commitWork` 之前，触发器的改动才能随工作副本提交）
    this.dispatchBuffHooks();

    // 6. 时间限制
    this.checkTimeLimit();

    // 7. 提交 + 推进 tick + 死亡判定
    this.commitWork();
    this.state = { ...this.state, tick: this.state.tick + 1 };
    this.checkDeaths();
  }

  /* ---------------------------------------------------------------- *
   * 技能施放
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * 读条推进
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * 单个 hit 段的结算（判定层的核心）
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * 持续效果、buff 过期、资源回复、死亡
   * ---------------------------------------------------------------- */

  /**
   * 每个 tick 的四步收尾 —— 实现全部搬到 `./encounterLifecycle.ts`。
   *
   * ⚠️ **顺序是不变量**（见本文件顶部的 tick 管线）：过期 → 回复 →
   * 时限 → 死亡。四步不拆到不同文件，就是为了让这个顺序只有一个读者。
   *
   * ⚠️ 它们要改 `this.state`，而 `state` 是**主文件私有的**，所以这里把
   * "改成什么"以回调（`end`）借出去，而不是把 state 交出去 ——
   * 状态永远只有一个写入者。
   */
  private expireBuffs(): void {
    expireBuffs(this.upkeepContext());
  }

  /** 把本 tick 新产生的 buff 事件派发成触发器（理由见 `./buffHookDispatch.ts`）。 */
  private dispatchBuffHooks(): void {
    this.buffHooks.drain(this.events, (ownerId, hook, payload) => {
      runTriggers(this.hitContext(), ownerId, hook, payload);
    });
  }

  private regenerateResources(): void {
    regenerateResources(this.upkeepContext());
  }

  private checkTimeLimit(): void {
    checkTimeLimit(this.upkeepContext());
  }

  private checkDeaths(): void {
    checkDeaths(this.upkeepContext());
  }

  private upkeepContext(): UpkeepContext {
    return {
      tick: this.state.tick,
      startedAtTick: this.state.startedAtTick,
      timeLimitMs: this.options.timeLimitMs,
      combatants: this.state.combatants,
      mutableAll: () => this.mutableAll(),
      replaceCombatant: (updated) => this.replaceCombatant(updated),
      statsOf: (id) => this.statsOf(id),
      events: this.events,
      end: (result, reason) => {
        this.state = { ...this.state, status: result, endReason: reason };
      },
    };
  }

  /* ---------------------------------------------------------------- *
   * 状态更新辅助
   * ---------------------------------------------------------------- */

  /** 读某个单位的**当前**状态（优先工作副本）。 */
  private current(id: string): MutableCombatant {
    const fromWork = this.work?.get(id);
    if (fromWork) return fromWork;
    const found = this.state.combatants.find((c: Combatant) => c.id === id);
    if (found) {
      // 没有工作副本时（例如构造后立即查询）返回一个临时可变视图
      return toMutable(found);
    }
    return toMutable(this.state.combatants[0]!);
  }

  /**
   * 写入一个单位。
   *
   * 现在它只写**工作副本**，不再碰 `this.state` —— 于是
   * "用过期快照覆盖新状态"这类 bug 结构上不可能发生。
   */
  private replaceCombatant(updated: Combatant): void {
    if (!this.work) {
      // 不在 tick 内（构造期 / 测试直接调用）：退化为直接改 state
      this.state = {
        ...this.state,
        combatants: this.state.combatants.map((c: Combatant) =>
          c.id === updated.id ? updated : c,
        ),
      };
      return;
    }
    this.work.set(updated.id, toMutable(updated));
  }

  /**
   * 本场战斗的**初始**种子。
   *
   * 与 `rngValue` 的区别：后者是"当前"的随机数状态（会随战斗推进变化），
   * 而重放只需要初始种子 —— 它是整场战斗的完整随机输入。
   */
  get initialSeed(): number {
    return this.options.seed;
  }

  /**
   * 暴击判定。
   *
   * 规则：
   *   - `canCrit: false` 的伤害**不消耗随机数** —— 否则"哪些攻击会暴击"
   *     取决于有没有打过不可暴击的技能，重放会因此变得极难推理。
   *   - 暴击率 <= 0 时同样不消耗（与 `rollChance` 的短路一致）。
   *   - 暴击率 >= 1 时必定暴击，也不消耗。
   *
   * 于是随机数的消耗**只由内容决定**（哪些技能可暴击），
   * 这让黄金重放的 diff 可解释。
   */
  private rollCrit(
    stats: Readonly<Record<StatKey, number>>,
    spec: DamageSpec,
  ): boolean {
    if (spec.canCrit === false) return false;
    const chance = stats.critChance ?? 0;
    if (chance <= 0) return false;
    if (chance >= 1) return true;
    return this.roll() < chance;
  }

  /** 消耗一个随机数（供 AI 与概率判定使用）。 */
  protected roll(): number {
    const next = nextRandom(this.rng);
    this.rng = next.state;
    return next.value;
  }

  get rngValue(): number {
    return this.rng.seed;
  }
}

/* ------------------------------------------------------------------ *
 * 辅助
 * ------------------------------------------------------------------ */
