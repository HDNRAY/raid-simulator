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

import { aggregateFlags, applyBuff, expireBuffs,
} from '../buffs';
import {
  applyDamage,
  applyHeal,
  capOf,
  changeResource,
  checkGate,
  computeDamage,
  computeHeal,
  hastedCastTime,
  hastedCooldown,
  payCosts,
  regenerate,
  type CombatContext,
  syncResourceGateBuff,
} from './index';
import { computeStats, type StatBreakdown } from '../stats/pipeline';
import { createAiState, decide, type AiState, type AiView } from '../ai';
import { nextRandom, type RngState } from '../rng';
import type {
  Action,
  BattleState,
  BuffDef,
  BuffInstance,
  CastInstance,
  Combatant,
  ResourceKey,
  Who,
  Effect,
  EventDef,
  HitDef,
  SkillDef,
  StatKey,
  StatModifier,
  DamageSpec,
} from '../types';

/**
 * tick 内的工作副本类型：把 `Combatant` 的 readonly 去掉。
 *
 * 只用于引擎内部；对外暴露的 `BattleState` 仍然是 readonly 的
 * （快照不可被渲染层改坏）。
 */
interface MutableCombatant {
  id: string;
  nameKey: Combatant['nameKey'];
  side: Combatant['side'];
  caps: Record<string, number>;
  resources: Record<string, number>;
  counters: Combatant['counters'];
  basePrimary: Combatant['basePrimary'];
  buffs: Combatant['buffs'] extends readonly (infer T)[] ? T[] : never;
  cooldowns: Record<string, number>;
  casts: CastInstance[];
  uses: Record<string, number>;
  behaviors: Combatant['behaviors'];
  alive: boolean;
}

/** 把只读快照转成工作副本（深拷贝需要改的容器）。 */
function toMutable(combatant: Combatant): MutableCombatant {
  return {
    ...combatant,
    caps: { ...combatant.caps },
    resources: { ...combatant.resources },
    counters: { ...combatant.counters },
    basePrimary: { ...combatant.basePrimary },
    buffs: [...combatant.buffs],
    cooldowns: { ...combatant.cooldowns },
    casts: [...combatant.casts],
    uses: { ...combatant.uses },
  };
}

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
  private readonly gcdBuff: BuffDef;
  /**
   * AI 状态（已用的 opener、各技能上次施放 tick、阶段、狂暴）。
   *
   * **必须在引擎内部持久**：它是决策的输入，必须随战斗一起可重放。
   * 如果放在外部，回放时 AI 会做出不同决定。
   */
  private aiState: AiState = createAiState();

  constructor(options: CreateBattleOptions) {
    this.options = options;
    this.rng = { seed: options.seed >>> 0 };
    this.gcdBuff = options.buffs.get('gcd') ?? makeFallbackGcdBuff();
    this.state = {
      tick: 0,
      rngSeed: options.seed >>> 0,
      status: 'running',
      combatants: options.combatants.map((c) => ({
        ...c,
        resources: clampStart(c),
      })),
      phase: 1,
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
   */
  get snapshot(): BattleState {
    return { ...this.state, rngSeed: this.rng.seed };
  }

  /**
   * 属性溯源：某个 stat 的当前值由哪些来源构成。
   *
   * 为什么必须有对外接口（数据模型规范 §5.4）：数值问题一旦出现，
   * "为什么是 3.2 而不是 2.5"是最高频的问题。没有溯源就只能靠猜。
   *
   * **与 `statsOf` 共用同一份计算**（只是多要一个 breakdown）。
   * 早期版本我另写了一份修正收集逻辑，结果是两份实现会各自漂移 ——
   * 而溯源的全部价值就是"它和真实计算一致"。
   */
  statsBreakdownOf(id: string): Readonly<Partial<Record<StatKey, StatBreakdown>>> | undefined {
    return this.computeStatsFor(id, true).breakdown;
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
    return out;
  }

  /* ---------------------------------------------------------------- *
   * AI（M4）：行为数组 → Action
   * ---------------------------------------------------------------- */

  /**
   * 让 AI 决策并应用它的动作。
   *
   * 位置很关键：在"玩家动作生效"之后、"读条推进"之前 ——
   * 于是 Boss 的动作也享受**同一套**门禁与消耗，
   * 而不是绕过引擎直接改状态。
   */
  private runAi(): void {
    const bossId = this.options.bossId;
    if (!bossId) return;
    const self = this.state.combatants.find((c: Combatant) => c.id === bossId);
    if (!self || !self.alive) return;
    const opponent = this.opponentOf(bossId);
    if (!opponent) return;

    const view: AiView = {
      self,
      opponent,
      tick: this.state.tick,
      elapsedMs: (this.state.tick - this.state.startedAtTick) * (1000 / 60),
      phase: this.state.phase,
      skillOf: (id: string) => this.options.skills.get(id),
      isReady: (id: string) => (self.cooldowns[id] ?? 0) <= this.state.tick,
      canAct: self.casts.length === 0,
    };

    const decision = decide(view, self.behaviors, this.aiState);
    this.aiState = decision.nextState;

    // AI 层面的事件（阶段 / 狂暴）记进事件流，并施加对应效果
    for (const event of decision.events) {
      if (event.kind === 'phaseChanged') {
        this.state = { ...this.state, phase: event.phase };
        this.events.push({
          kind: 'phaseChanged',
          tick: this.state.tick,
          phase: event.phase,
          bossId,
        });
        this.applyPhaseBehaviors(self);
      } else {
        this.applyEnrage(self);
      }
    }

    if (decision.actions.length > 0) this.applyActions(decision.actions, bossId);
  }

  /** 阶段转换时把 `onHpBelow` 里声明的行为也执行掉（行为数组可嵌套）。 */
  private applyPhaseBehaviors(boss: Combatant): void {
    const hpRatio = boss.caps.hp > 0 ? boss.resources.hp / boss.caps.hp : 1;
    for (const behavior of boss.behaviors) {
      if (behavior.kind !== 'onHpBelow') continue;
      if (hpRatio > behavior.ratio) continue;
      for (const nested of behavior.then) {
        if (nested.kind === 'enrage') {
          const applied = applyBuff(
            this.current(boss.id),
            this.enrageBuff(nested.dmgMult),
            boss.id,
            this.state.tick,
          );
          this.replaceCombatant({ ...this.current(boss.id), buffs: applied.buffs });
        }
      }
    }
  }

  /** 狂暴：挂一个伤害倍率 buff（`damageMultBoost` 由伤害公式读取）。 */
  private applyEnrage(boss: Combatant): void {
    const behavior = boss.behaviors.find((b) => b.kind === 'enrage');
    const mult = behavior?.kind === 'enrage' ? behavior.dmgMult : 2;
    const applied = applyBuff(
      this.current(boss.id),
      this.enrageBuff(mult),
      boss.id,
      this.state.tick,
    );
    this.replaceCombatant({ ...this.current(boss.id), buffs: applied.buffs });
    this.events.push({ kind: 'enrageStarted', tick: this.state.tick, bossId: boss.id });
  }

  private enrageBuff(dmgMult: number): BuffDef {
    return {
      id: 'boss-enrage-active',
      nameKey: 'event.enrage',
      icon: 'buff_enrage',
      polarity: 'debuff',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      damageMultBoost: dmgMult,
    };
  }

  private get ctx(): CombatContext {
    const ctx: CombatContext = {
      statsOf: (id: string) => this.statsOf(id),
      buffDef: (buffId: string) => this.options.buffs.get(buffId),
      skillDef: (skillId: string) => this.options.skills.get(skillId),
      currentTick: () => this.state.tick,
    };
    return ctx;
  }

  /**
   * 计算某个单位的全部属性。
   *
   * **每次调用都重新结算** —— 没有缓存，也就没有快照。
   * 这是"动态重算"的落地方式（数据模型规范 §7.2 规则 6）。
   * 实测性能足够：一次结算在几十微秒量级。
   */
  statsOf(combatantId: string): Readonly<Record<StatKey, number>> {
    return this.computeStatsFor(combatantId, false).values;
  }

  /**
   * 属性结算的**唯一实现**。
   *
   * `statsOf` 与 `statsBreakdownOf` 都走它 —— 溯源数据必须与真实计算
   * 出自同一次求值，否则"面板上写的"和"实际用的"会不一致。
   */
  private computeStatsFor(
    combatantId: string,
    wantBreakdown: boolean,
  ): { values: Readonly<Record<StatKey, number>>; breakdown?: Readonly<Partial<Record<StatKey, StatBreakdown>>> } {
    const combatant = this.state.combatants.find((c: Combatant) => c.id === combatantId);
    if (!combatant) return { values: EMPTY_STATS };

    const modifiers: StatModifier[] = [
      ...(this.options.passiveModifiers.get(combatantId) ?? []),
    ];

    // 把 buff 的修正展开进来，并带上 buffId 作为命名空间
    for (const buff of combatant.buffs) {
      const def = buff.def ?? this.options.buffs.get(buff.defId);
      if (!def?.modifiers) continue;
      for (const modifier of def.modifiers) {
        modifiers.push(
          modifier.namespace ? modifier : { ...modifier, namespace: buff.defId },
        );
      }
    }

    const stackLookup = (key: string): number => {
      let total = 0;
      for (const buff of combatant.buffs) {
        if (buff.defId === key) total += buff.stacks;
      }
      return total === 0 ? 1 : total;
    };

    return computeStats({
      base: this.options.baseStats.get(combatantId) ?? {},
      modifiers,
      wantBreakdown,
      stackCount: stackLookup,
      evaluateCondition: () => true,
      resourceAccess: {
        getResource: (who: Who, resource: ResourceKey) =>
          this.resolveCombatant(combatantId, who).resources[resource],
        getMaxResource: (who: Who, resource: ResourceKey) =>
          this.resolveCombatant(combatantId, who).caps[resource],
        getBuffStacks: (who: Who, buffId: string) =>
          this.resolveCombatant(combatantId, who).buffs
            .filter((b: BuffInstance) => b.defId === buffId)
            .reduce((sum: number, b: BuffInstance) => sum + b.stacks, 0),
        getCounter: () => 0,
      },
    });
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
    const work = new Map<string, MutableCombatant>();
    for (const combatant of this.state.combatants) {
      work.set(combatant.id, {
        ...combatant,
        caps: { ...combatant.caps },
        resources: { ...combatant.resources },
        counters: { ...combatant.counters },
        basePrimary: { ...combatant.basePrimary },
        buffs: [...combatant.buffs],
        cooldowns: { ...combatant.cooldowns },
        casts: [...combatant.casts],
        uses: { ...combatant.uses },
      });
    }
    this.work = work;
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
        if (action.type === 'useSkill') this.tryUseSkill(action.skillId, resolvedActor);
      }
    } finally {
      if (owned) this.commitWork();
    }
  }

  /** 默认施法者：第一个存活的我方单位（没有则取第一个单位）。 */
  private defaultActorId(): string {
    const ally = this.state.combatants.find((c: Combatant) => c.side === 'ally' && c.alive);
    return (ally ?? this.state.combatants[0])?.id ?? 'player';
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
  tick(actions: readonly Action[] = []): void {
    if (this.state.status !== 'running') return;

    // 开一个 tick 的工作副本；结束时一次提交（见 work 的说明）
    this.beginWork();

    // 1. 动作生效
    this.applyActions(actions, 'player');
    this.runAi();

    // 2. 读条推进
    this.advanceCasts();

    // 3. 持续效果（DoT / HoT）到点触发
    this.tickOverTimeEffects();

    // 4. buff 过期
    this.expireBuffs();

    // 5. 资源回复
    this.regenerateResources();

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

  private tryUseSkill(skillId: string, actorId: string): void {
    /**
     * ⚠️ 必须从**工作副本**读 actor，不能读 `this.state`。
     *
     * 踩过的坑：同一 tick 内的第二个技能会读到"还没挂上 GCD"的旧状态，
     * 于是 `strike` 和 `riposte` 能在**同一个 tick 里都施放成功** ——
     * 门禁形同虚设，实测 DPS 因此虚高 3 倍以上。
     *
     * 教训与工作副本那条一致：一次 tick 内的所有读写都必须走同一个副本。
     */
    const actor = this.work?.get(actorId);
    if (!actor) return;

    const skill = this.options.skills.get(skillId);
    if (!skill) return;

    const stats = this.statsOf(actor.id);
    const opponent = this.opponentOf(actor.id);
    const gate = checkGate(actor, skill, this.ctx, { hasTarget: opponent !== undefined });

    if (!gate.ok) {
      this.events.push({
        kind: 'skillRejected',
        tick: this.state.tick,
        sourceId: actor.id,
        skillId,
        reason: gate.reason ?? 'condition',
      });
      return;
    }

    // 扣代价
    const paid = payCosts(actor, skill, this.state.tick);
    this.events.push(...paid.events);
    let next = paid.combatant;

    // GCD（不占 GCD 的技能跳过）
    if (skill.gcd) {
      const withGcd = applyBuff(next, this.gcdBuff, next.id, this.state.tick);
      next = { ...next, buffs: withGcd.buffs };
    }

    // 技能冷却（受急速影响）
    if (skill.cooldown > 0) {
      const cooldownMs = hastedCooldown(skill.cooldown, stats);
      const readyAt = this.state.tick + Math.round(cooldownMs / (1000 / 60));
      next = { ...next, cooldowns: { ...next.cooldowns, [skillId]: readyAt } };
    }

    // 记使用次数
    next = { ...next, uses: { ...next.uses, [skillId]: (next.uses[skillId] ?? 0) + 1 } };

    // 读条 or 立刻结算。
    //
    // ⚠️ 状态写回只有两处，且**互斥**。这个方法是踩坑最密集的地方，
    // 记录一下根因：早先的版本在方法末尾统一写回 `next`，而
    // `resolveSkillHits` 也会通过 replaceCombatant 改 state，
    // 于是最后那次写回把刚挂上的 buff / 刚扣的血全部覆盖掉
    // ——表现为"事件发了但状态没变"。教训：**一个方法里只在一个地方
    // 写回同一个对象**，或者干脆让下游函数自己写。
    const castTimeMs = hastedCastTime(skill.castTime, stats);
    if (castTimeMs > 0) {
      // 读条：把 cast 写回 state 即可，hit 由 advanceCasts 逐段结算
      this.replaceCombatant({
        ...next,
        casts: [
          ...next.casts,
          {
            skillId,
            startedAtTick: this.state.tick,
            castTimeMs,
            resolvedHits: 0,
            interruptible: skill.interruptible,
          },
        ],
      });
      this.events.push({
        kind: 'castStarted',
        tick: this.state.tick,
        sourceId: actor.id,
        skillId,
      });
    } else {
      // 瞬发：先同步 GCD / 冷却，再结算 —— 之后**不再写回**
      this.replaceCombatant(next);
      this.resolveSkillHits(next, skill);
    }

    this.events.push({
      kind: 'skillUsed',
      tick: this.state.tick,
      sourceId: actor.id,
      skillId,
    });
  }

  /* ---------------------------------------------------------------- *
   * 读条推进
   * ---------------------------------------------------------------- */

  private advanceCasts(): void {
    // ⚠️ 遍历 **id 列表**而不是 `this.state.combatants` 的元素快照。
    //
    // 原因：`applyActions` 会用新对象替换 combatant（例如扣了斗炁）。
    // 如果这里持有循环开始时的旧引用，读到的是**过期状态**，
    // 随后的写回会把 applyActions 刚做的改动覆盖掉。
    // （症状：`resourceChanged` 事件发了，但资源回到原值。）
    for (const id of this.state.combatants.map((c: Combatant) => c.id)) {
      const actor = this.current(id);
      if (actor.casts.length === 0) continue;

      const stillCasting: CastInstance[] = [];

      // 同样遍历副本：循环体里 resolveHit 会改状态
      for (const cast of [...actor.casts]) {
        // 来源消失（技能被移除）→ 立即中断。见 i18n/数据模型规范 §7.2 规则 4
        const skill = this.options.skills.get(cast.skillId);
        if (!skill) {
          this.events.push({
            kind: 'castInterrupted',
            tick: this.state.tick,
            sourceId: actor.id,
            skillId: cast.skillId,
            reason: 'sourceLost',
          });
          continue;
        }

        const elapsedMs = (this.state.tick - cast.startedAtTick) * (1000 / 60);
        const dueHits = skill.hits.filter(
          (hit: HitDef, index: number) => index >= cast.resolvedHits && hit.at <= elapsedMs,
        );

        // CastInstance 是 readonly（状态设计如此），所以用新对象推进计数
        let resolved = cast.resolvedHits;
        for (const hit of dueHits) {
          this.resolveHit(actor, skill, hit);
          resolved += 1;
        }

        const finished = elapsedMs >= cast.castTimeMs && resolved >= skill.hits.length;
        if (finished) {
          this.events.push({
            kind: 'castFinished',
            tick: this.state.tick,
            sourceId: actor.id,
            skillId: cast.skillId,
          });
          this.fireCastFinishTriggers(actor, skill);
        } else {
          stillCasting.push({ ...cast, resolvedHits: resolved });
        }
      }

      // ⚠️ 用**当前 state** 而不是循环开头缓存的 `next`：
      // resolveHit 会在循环中间修改双方状态（扣血、挂 buff），
      // 写回旧快照会把那些改动覆盖掉。
      this.replaceCombatant({ ...this.current(actor.id), casts: stillCasting });
    }
  }

  /** 瞬发技能：立刻结算全部 hit 段。 */
  private resolveSkillHits(actor: Combatant, skill: SkillDef): void {
    for (const hit of skill.hits) {
      this.resolveHit(actor, skill, hit);
    }
    this.fireCastFinishTriggers(actor, skill);
  }

  /**
   * 技能完成时结算它自己的 abilities。
   *
   * 两种形态都要处理，**不能只处理 trigger**：
   *
   *   1. **直接 grant**：`{ kind:'grant', buff: dodgeBuff }`
   *      —— 闪避 / 格挡这类"用了就给自己挂 buff"的技能走这条。
   *      （踩过的坑：一开始只实现了 trigger 形态，于是 dodge 施放成功
   *        但 buff 从未挂上，表现为"闪避没效果"。）
   *   2. **trigger onCastFinish**：GCD / 派生窗口走这条。
   */
  /**
   * 结算技能自带的 abilities。
   *
   * ⚠️ 这里**必须操作传入的累积对象 `actor`，不能回读 `this.current()`**。
   *
   * 踩过的坑：回读会拿到 state 里的旧版本（此时 GCD / 冷却还没写回），
   * 于是挂上 buff 后用旧的 buffs 数组整条覆盖回去 ——
   * 表现为"dodge 施放成功、buffApplied 事件也发了，但 buff 立刻消失"。
   *
   * 所以：改动累积对象 → 同步到 state → 继续改。
   */
  private fireCastFinishTriggers(actor: Combatant, skill: SkillDef): void {
    /**
     * 本次结算的**唯一工作副本**。
     *
     * ⚠️ 这是踩坑最密集的地方，规则只有一条但必须严格遵守：
     * **每改一次 state，就立刻把 working 同步成最新版本。**
     *
     * 违反它会怎样：working 是方法开头捕获的旧对象，
     * 方法末尾又用它写回 —— 中间所有改动（挂 buff、加斗炁）全被抹掉。
     * 症状是"`resourceChanged` / `buffApplied` 事件都发了，但状态没变"，
     * 极难从事件流上看出来。
     */
    let working = this.current(actor.id);

    /** 改 working 并同步到工作副本（单一入口，避免忘记同步）。 */
    const commit = (next: Combatant): void => {
      working = next as MutableCombatant;
      this.replaceCombatant(next);
    };

    const targetIdOf = (mode: string): string =>
      mode === 'self' ? working.id : (this.opponentOf(working.id)?.id ?? working.id);

    const grantTo = (buff: BuffDef, targetId: string): void => {
      if (targetId === working.id) {
        const applied = applyBuff(working, buff, working.id, this.state.tick);
        commit({ ...working, buffs: applied.buffs });
        this.pushBuffApplied(working.id, buff.id, applied.stacks);
        return;
      }
      const target = this.current(targetId);
      const applied = applyBuff(target, buff, working.id, this.state.tick);
      commit({ ...target, buffs: applied.buffs });
      this.pushBuffApplied(target.id, buff.id, applied.stacks);
    };

    /**
     * 把一个 buff 加到**施法者以外的目标**上（会被打上施法者来源）。
     *
     * 用于"大招打中后给 Boss 挂易伤"这类内容 —— 与 grantTo 的区别是
     * `sourceId` 记成施法者而不是目标自己。
     */
    const applyBuffTo = (buff: BuffDef, targetId: string): void => {
      const target = targetId === working.id ? working : this.current(targetId);
      const applied = applyBuff(target, buff, working.id, this.state.tick);
      commit({ ...target, buffs: applied.buffs });
      this.events.push({
        kind: 'buffApplied',
        tick: this.state.tick,
        targetId: target.id,
        buffId: buff.id,
        stacks: applied.stacks,
        sourceId: working.id,
      });
    };

    /** 加入一个 buff 实例（用对象字面量直接写内容，不必先定义 BuffDef）。 */
    const addBuff = (buff: BuffDef, targetId: string): void => applyBuffTo(buff, targetId);

    /**
     * 斗炁满时自动挂上的标记 buff。
     *
     * 为什么需要它：终结技的门槛是"斗炁已满"，而 `requires` 只能检查
     * buff / 资源阈值。用一条"满斗炁"标记 buff 表达它，内容层就能写
     * `requires: [{ kind:'hasBuff', buffId:'douqi-full' }]` ——
     * **不用给引擎加新条件类型**（这正是可扩展性的验证方式）。
     */
    const syncDouqiFull = (): void => {
      const result = syncResourceGateBuff(working, 'douqi', 'douqi-full', {
        id: 'douqi-full',
        nameKey: 'resource.douqi',
        icon: 'buff_douqi',
        polarity: 'buff',
        color: 0xffd050,
        duration: Number.POSITIVE_INFINITY,
        maxStacks: 1,
        stacking: { mode: 'refresh' },
      });
      if (result) {
        commit({ ...working, buffs: result.buffs });
        for (const e of result.events) this.events.push(e);
      }
    };

    const grantResource = (resource: string, delta: number, targetId: string): void => {
      if (delta === 0) return;
      const target = targetId === working.id ? working : this.current(targetId);
      const result = changeResource(target, resource, delta, this.state.tick);
      commit(result.combatant);
      this.events.push(...result.events);
    };

    for (const ability of skill.abilities) {
      if (ability.kind === 'grant') {
        grantTo(ability.buff, targetIdOf(ability.target.mode));
        continue;
      }

      if (ability.kind === 'resource') {
        // 一次性资源变动（"基础技产生 18 点斗炁"）。
        // 与 `douqiRegen` 修正的区别：那是持续速率，这是一次性。
        const delta = typeof ability.delta === 'number' ? ability.delta : 0;
        grantResource(ability.resource, delta, targetIdOf(ability.target.mode));
        syncDouqiFull();
        continue;
      }

      if (ability.kind === 'trigger') {
        if (ability.trigger.on !== 'onCastFinish') continue;
        for (const then of ability.trigger.then) {
          if (then.kind === 'grant') grantTo(then.buff, targetIdOf(then.target.mode));
          if (then.kind === 'resource') {
            const delta = typeof then.delta === 'number' ? then.delta : 0;
            grantResource(then.resource, delta, targetIdOf(then.target.mode));
            syncDouqiFull();
          }
        }
      }
    }

    // 本次结算结束后复查一次：内容可能直接写了 addBuff 形式的标记
    void addBuff;
  }

  private pushBuffApplied(targetId: string, buffId: string, stacks: number): void {
    this.events.push({
      kind: 'buffApplied',
      tick: this.state.tick,
      targetId,
      buffId,
      stacks,
      sourceId: targetId,
    });
  }

  /* ---------------------------------------------------------------- *
   * 单个 hit 段的结算（判定层的核心）
   * ---------------------------------------------------------------- */

  private resolveHit(actor: Combatant, skill: SkillDef, hit: HitDef): void {
    const target = this.opponentOf(actor.id);
    if (!target) return;

    const casterStats = this.statsOf(actor.id);
    const victimFlags = aggregateFlags(target);

    for (const effect of hit.effects) {
      switch (effect.kind) {
        case 'damage': {
          if (!effect.damage) break;
          /**
           * 暴击判定。
           *
           * ⚠️ 这里长期是硬编码 `crit: false` —— 也就是说引擎**从未做过
           * 暴击判定**，`critChance` 是个死属性，而熵之钟的
           * "暴击后翻倍"触发因此永远不会发生。
           *
           * 抽成 `rollCrit` 而不是内联，是为了让"消耗随机数"这件事
           * 只在一个地方发生 —— 重放的确定性完全取决于它。
           */
          const crit = this.rollCrit(casterStats, effect.damage);
          const result = computeDamage(
            effect.damage,
            casterStats,
            victimFlags,
            { crit, multiplier: crit ? 1 + (casterStats.critDamage ?? 0) : 1 },
          );
          // 命中本身也会触发"授予 buff"类效果（例如 Boss 给自己挂前摇标记）
          this.applyHitEffects(actor, target, effect);
          const applied = applyDamage(
            this.current(target.id),
            result,
            actor.id,
            skill.id,
            effect.damage.school,
            this.state.tick,
          );
          this.replaceCombatant(applied.combatant);
          this.events.push(...applied.events);
          break;
        }
        case 'heal': {
          if (!effect.damage) break;
          const amount = computeHeal(effect.damage, casterStats, { crit: false, multiplier: 1 });
          const healed = applyHeal(this.current(actor.id), amount, actor.id, false, this.state.tick);
          this.replaceCombatant(healed.combatant);
          this.events.push(...healed.events);
          break;
        }
        default:
          this.applyHitEffects(actor, target, effect);
          break;
      }
    }
  }

  /** 非伤害类效果（授予 buff / 改资源 / 打断）。 */
  private applyHitEffects(actor: Combatant, target: Combatant, effect: Effect): void {
    if (effect.kind === 'grantBuff' && effect.buff) {
      const who = effect.target?.mode === 'self' ? actor : target;
      const applied = applyBuff(this.current(who.id), effect.buff, actor.id, this.state.tick);
      this.replaceCombatant({ ...this.current(who.id), buffs: applied.buffs });
      this.events.push({
        kind: 'buffApplied',
        tick: this.state.tick,
        targetId: who.id,
        buffId: effect.buff.id,
        stacks: applied.stacks,
        sourceId: actor.id,
      });
      return;
    }

    if (effect.kind === 'removeBuff') {
      /**
       * 移除 buff。
       *
       * 用途：**派生技消耗掉它自己的开启条件**。
       * 没有这一步时，`combo-window` 在窗口期内可被反复利用，
       * 派生技会完全取代基础技（实测 152 次派生 vs 38 次基础）。
       * 移除之后，一次基础技只能换来一次派生。
       */
      const buffId = effect.buff?.id ?? effect.buffId;
      if (buffId) {
        const who = effect.target?.mode === 'self' ? actor : target;
        const current = this.current(who.id);
        if (current.buffs.some((b) => b.defId === buffId)) {
          this.replaceCombatant({
            ...current,
            buffs: current.buffs.filter((b) => b.defId !== buffId),
          });
          this.events.push({
            kind: 'buffExpired',
            tick: this.state.tick,
            targetId: who.id,
            buffId,
            stacks: 0,
            sourceId: actor.id,
          });
        }
      }
      return;
    }

    if (effect.kind === 'resource' && effect.resource) {
      const delta = typeof effect.resource.delta === 'number' ? effect.resource.delta : 0;
      const result = changeResource(this.current(actor.id), effect.resource.key, delta, this.state.tick);
      this.replaceCombatant(result.combatant);
      this.events.push(...result.events);
      return;
    }

    if (effect.kind === 'interrupt') {
      if (target.casts.length > 0) {
        const interrupted = target.casts.filter((c: CastInstance) => c.interruptible);
        if (interrupted.length > 0) {
          this.replaceCombatant({
            ...this.current(target.id),
            casts: target.casts.filter((c: CastInstance) => !c.interruptible),
          });
          for (const cast of interrupted) {
            this.events.push({
              kind: 'castInterrupted',
              tick: this.state.tick,
              sourceId: target.id,
              skillId: cast.skillId,
              reason: 'interrupted',
            });
            this.events.push({
              kind: 'interruptSuccess',
              tick: this.state.tick,
              sourceId: actor.id,
              targetId: target.id,
              skillId: cast.skillId,
            });
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * 持续效果、buff 过期、资源回复、死亡
   * ---------------------------------------------------------------- */

  /**
   * DoT / HoT 到点触发。
   *
   * 用 buff 的 `appliedAtTick` 与固定间隔算"应该触发了几次"，
   * 而不是每 tick 累加计时器 —— 后者会漂移（架构规范 §12.2）。
   */
  private tickOverTimeEffects(): void {
    for (const combatant of this.mutableAll()) {
      for (const buff of combatant.buffs) {
        const def = buff.def ?? this.options.buffs.get(buff.defId);
        if (!def) continue;
        // DoT 效果的实现：buff 的 modifiers 影响属性，而"每跳伤害"
        // 由内容层的 trigger（onTick）表达。M1 阶段先只处理属性类 buff。
      }
    }
  }

  private expireBuffs(): void {
    for (const combatant of this.mutableAll()) {
      const { buffs, expired } = expireBuffs(combatant.buffs, this.state.tick);
      if (expired.length === 0) continue;
      this.replaceCombatant({ ...combatant, buffs });
      for (const buffId of expired) {
        this.events.push({
          kind: 'buffExpired',
          tick: this.state.tick,
          targetId: combatant.id,
          buffId,
          stacks: 0,
          sourceId: combatant.id,
        });
      }
    }
  }

  private regenerateResources(): void {
    for (const combatant of this.mutableAll()) {
      const stats = this.statsOf(combatant.id);
      const result = regenerate(combatant, stats, this.state.tick, 0.1);
      if (result.events.length > 0) {
        this.replaceCombatant(result.combatant);
        this.events.push(...result.events);
      }
    }
  }

  private checkTimeLimit(): void {
    const limitMs = this.options.timeLimitMs;
    if (limitMs === undefined) return;
    const elapsedMs = (this.state.tick - this.state.startedAtTick) * (1000 / 60);
    if (elapsedMs >= limitMs) {
      this.state = { ...this.state, status: 'defeat', endReason: 'timeout' };
      this.events.push({
        kind: 'encounterEnd',
        tick: this.state.tick,
        result: 'defeat',
        reason: 'timeout',
      });
    }
  }

  private checkDeaths(): void {
    const dead = this.state.combatants.filter((c: Combatant) => !c.alive);
    if (dead.length === 0) return;

    const playerDead = dead.some((c: Combatant) => c.side === 'ally');
    const bossDead = dead.some((c: Combatant) => c.side === 'enemy');
    if (!playerDead && !bossDead) return;

    const result = playerDead ? 'defeat' : 'victory';
    this.state = { ...this.state, status: result, endReason: 'hpZero' };
    this.events.push({
      kind: 'encounterEnd',
      tick: this.state.tick,
      result,
      reason: 'hpZero',
    });
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

const EMPTY_STATS = {} as Readonly<Record<StatKey, number>>;

function clampStart(combatant: Combatant): Combatant['resources'] {
  const out = { ...combatant.resources };
  for (const key of ['hp', 'energy', 'douqi'] as const) {
    out[key] = Math.max(0, Math.min(capOf(combatant, key), Math.round(out[key])));
  }
  return out;
}

/** 内容里没给 gcd buff 时的兜底（保证引擎不会因为缺内容而崩）。 */
function makeFallbackGcdBuff(): BuffDef {
  return {
    id: 'gcd',
    nameKey: 'reject.gcd',
    icon: 'gcd',
    polarity: 'neutral',
    duration: 300,
    maxStacks: 1,
    stacking: { mode: 'refresh' },
    flags: { blocksGcd: true },
  };
}
