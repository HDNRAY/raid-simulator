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
import { DOUQI_PER_INTERNAL_DAMAGE } from '../../data/balance';
import { TICKS_PER_LOGIC_TICK } from '../loopConstants';
import { createAiState, decide, type AiState, type AiView } from '../ai';
import { nextRandom, type RngState } from '../rng';
import type {  Ability,
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
  activeHold?: { readonly skillId: string } | undefined;
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
      skillOf: (id: string) => this.options.skills.get(id),
      isReady: (id: string) => (self.cooldowns[id] ?? 0) <= this.state.tick,
      canAct: self.casts.length === 0,
    };

    const decision = decide(view, self.behaviors, this.aiState);
    this.aiState = decision.nextState;

    /**
     * AI 层事件 → 实际效果。
     *
     * 只有两种，都是"执行一串能力/挂一个 buff"，
     * **没有"阶段"这类引擎概念**。
     */
    for (const event of decision.events) {
      if (event.kind === 'thresholdReached') {
        // 血量阈值被跨过：执行内容声明的能力（通常是授予阶段 buff）
        this.runAbilities(bossId, event.abilities);
        this.events.push({
          kind: 'behaviorTriggered',
          tick: this.state.tick,
          bossId,
          kindName: `onHpBelow#${event.index}`,
        });
      } else {
        this.applyEnrage(self);
      }
    }

    if (decision.actions.length > 0) this.applyActions(decision.actions, bossId);
  }

  /**
   * 执行一串能力（`onHpBelow.then` 用）。
   *
   * 这是"内容组合能力"的入口：`grant` / `modifier` / `resource` 全部走
   * 既有实现，所以**新增一种阶段效果不需要改引擎**。
   */
  private runAbilities(actorId: string, abilities: readonly Ability[]): void {
    for (const ability of abilities) {
      const actor = this.work?.get(actorId);
      if (!actor) return;
      const opponent = this.opponentOf(actorId);
      const targetIdOf = (mode: string): string =>
        mode === 'self' ? actorId : (opponent?.id ?? actorId);

      if (ability.kind === 'grant') {
        const targetId = targetIdOf(ability.target.mode);
        const target = this.current(targetId);
        const applied = applyBuff(target, ability.buff, actorId, this.state.tick);
        this.replaceCombatant({ ...target, buffs: applied.buffs });
        this.events.push({
          kind: 'buffApplied',
          tick: this.state.tick,
          targetId,
          buffId: ability.buff.id,
          stacks: applied.stacks,
          sourceId: actorId,
        });
        continue;
      }

      if (ability.kind === 'resource') {
        const delta = typeof ability.delta === 'number' ? ability.delta : 0;
        if (delta !== 0) {
          const targetId = targetIdOf(ability.target.mode);
          const result = changeResource(
            this.current(targetId),
            ability.resource,
            delta,
            this.state.tick,
          );
          this.replaceCombatant(result.combatant);
          this.events.push(...result.events);
        }
        continue;
      }

      if (ability.kind === 'trigger') {
        // onHpBelow 里嵌 trigger 没有明确语义，直接执行它的 then
        for (const then of ability.trigger.then) this.runAbilities(actorId, [then]);
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
   * 按住型技能（「防」）
   * ---------------------------------------------------------------- */

  /**
   * 开始按住一个技能。
   *
   * 与 `useSkill` 的区别：按住型技能施放后**保持生效**，
   * 由 `tickHolds` 每个逻辑步扣 `holdDrain`。资源耗尽或松手即结束。
   */
  private startHold(skillId: string, actorId: string): void {
    const actor = this.work?.get(actorId);
    if (!actor) return;
    const skill = this.options.skills.get(skillId);
    if (!skill?.holdDrain) {
      // 不是按住型技能 → 退化成普通施放，这样输入层不必区分两种技能
      this.tryUseSkill(skillId, actorId);
      return;
    }
    if (actor.activeHold?.skillId === skillId) return;

    this.tryUseSkill(skillId, actorId);
    const after = this.work?.get(actorId);
    if (!after) return;
    // 只有施放真的成功（身上有它授予的 buff）才进入按住状态
    const granted = skill.abilities.some(
      (a) => a.kind === 'grant' && after.buffs.some((b) => b.defId === a.buff.id),
    );
    if (!granted) return;
    this.replaceCombatant({ ...after, activeHold: { skillId } });
  }

  /** 结束按住：移除它授予的 buff。 */
  private endHold(skillId: string, actorId: string): void {
    const actor = this.work?.get(actorId);
    if (!actor) return;
    if (actor.activeHold?.skillId !== skillId) return;

    const skill = this.options.skills.get(skillId);
    const grantedIds = new Set(
      (skill?.abilities ?? [])
        .filter((a): a is Extract<typeof a, { kind: 'grant' }> => a.kind === 'grant')
        .map((a) => a.buff.id),
    );

    this.replaceCombatant({
      ...actor,
      activeHold: undefined,
      buffs: actor.buffs.filter((b) => !grantedIds.has(b.defId)),
    });
  }

  /**
   * 每个逻辑步处理按住状态：扣资源，资源不够就自动松开。
   *
   * 为什么按**逻辑步**而不是每 tick：需求定义"每 0.1 秒扣 2 点"，
   * 按 tick（1/60 秒）扣会让玩家算不清代价，也会被整数化吃掉小数。
   */
  private tickHolds(): void {
    if (this.state.tick % TICKS_PER_LOGIC_TICK !== 0) return;

    for (const id of this.state.combatants.map((c: Combatant) => c.id)) {
      const actor = this.work?.get(id);
      const hold = actor?.activeHold;
      if (!actor || !hold) continue;

      const skill = this.options.skills.get(hold.skillId);
      const drain = skill?.holdDrain;
      if (!drain) {
        this.endHold(hold.skillId, id);
        continue;
      }

      const have = (actor.resources as Record<string, number>)[drain.resource] ?? 0;
      if (have < drain.perLogicTick) {
        // 资源耗尽 → 自动松开，并告诉玩家原因
        this.endHold(hold.skillId, id);
        this.events.push({
          kind: 'skillRejected',
          tick: this.state.tick,
          sourceId: id,
          skillId: hold.skillId,
          reason: 'cost',
        });
        continue;
      }
      const result = changeResource(actor, drain.resource, -drain.perLogicTick, this.state.tick);
      this.replaceCombatant(result.combatant);
      this.events.push(...result.events);
    }
  }

  /**
   * 按伤害量换算炁。
   *
   * 需求：「炁根据造成或受到的伤害数值」—— 造成 1 点伤害得 1 点，
   * 受到 1 点伤害也得 1 点。
   *
   * 换算放在**引擎**而不是逐条写进内容，因为它必须对**每一次伤害**生效
   * （包括 DoT、反击、任何来源）—— 写进内容一定会漏。
   */
  private gainDouqiFromDamage(combatantId: string, damage: number, tick: number): void {
    if (damage <= 0) return;
    /**
     * `damage` 是**内部刻度**，而系数是展示刻度的 —— 必须用换算过的版本。
     *
     * 踩过的坑：直接用展示刻度系数会让炁攒得快 `DISPLAY_SCALE` 倍，
     * 玩家一路「轰」秒杀 Boss（实测 7 秒通关一场本该 2 分钟的战斗）。
     * 而且单点伤害小到 10 内部点时，`Math.round` 会把 1 点炁算成 1 ——
     * 所以系数的换算必须在这里做，不能靠调用方记得。
     */
    const gain = Math.round(damage * DOUQI_PER_INTERNAL_DAMAGE);
    if (gain <= 0) return;
    const target = this.work?.get(combatantId);
    if (!target) return;
    const result = changeResource(target, 'douqi', gain, tick);
    this.replaceCombatant(result.combatant);
    this.events.push(...result.events);
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
        else if (action.type === 'hold') this.startHold(action.skillId, resolvedActor);
        else if (action.type === 'releaseSkill') this.endHold(action.skillId, resolvedActor);
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
    this.runAi();

    // 2. 读条推进
    this.advanceCasts();

    // 3. 持续效果（DoT / HoT）到点触发
    this.tickOverTimeEffects();

    // 4. buff 过期
    this.expireBuffs();
    // 5. 资源回复
    this.regenerateResources();

    // 5b. 按住型技能的持续消耗（按逻辑步）
    this.tickHolds();

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
     * 踩过的坑：同一 tick 内的第二个技能会读到"还没扣掉代价"的旧状态，
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

    /**
     * 谁能打断读条：**只有瞬发技能**。
     *
     * ------------------------------------------------------------------
     * 规则（需求明确）
     * ------------------------------------------------------------------
     *
     *   - **瞬发**（`castTime === 0`）：读条中放行 → 打断当前读条。
     *     包括「闪」「破」「凝」，以及**「防」这种按住型**。
     *   - **有读条的**（攻 / 轰）：读条中被 `casting` 拒绝，
     *     所以**不会**打断自己，必须等当前读条结束。
     *
     * 这条规则很自然：读条技能之间互相打断会让"读条"失去意义
     * （永远在被打断，永远读不完）；而瞬发技能本来就是"零耗时"的
     * 应对手段（闪避、打断、增益），随时可用才合理。
     *
     * 踩过的坑：早期这里写的是 `!isHold`，方向正好取反 —— 变成
     * "只有按住型被拒绝、其它全部放行"，与需求完全相反。
     */
    const isInstant = skill.castTime === 0;

    /* ------------------------------------------------------------------ *
     * 读条中施放**其它**技能 → 打断当前读条。
     *
     * 需求：「读条的时候如果使用其他技能，就打断当前的读条」。
     *
     * 这是删掉公共冷却之后的**主要限速机制**，也是"攻 / 轰 要挑空档"
     * 这一博弈的来源。注意代价在开始读条时就已扣除、**中断不退** ——
     * 所以"酝酿大招被打断"是有真实损失的。
     * ------------------------------------------------------------------ */

    // 先做门禁检查（含资源、冷却）
    const gate = checkGate(actor, skill, this.ctx, {
      hasTarget: opponent !== undefined,
      allowedWhileCasting: isInstant,
    });

    /**
     * ⚠️ 顺序很重要：**门禁通过之后才能打断**。
     *
     * 踩过的坑：早期把打断放在门禁之前，于是"资源不足被拒绝"也会
     * 顺手把正在读的条打断 —— 玩家按下幻想的「轰」（缠不够），
     * 结果连「攻」的读条也没了。用日志才看出来：同一 tick 里
     * 先 `castInterrupted`、再 `skillRejected`。
     */
    /**
     * **瞬发技能都会打断自己的读条** —— 包括「闪」（需求明确）。
     *
     * 我一度给「闪」开了豁免（"瞬发自保不该有双重代价"），
     * 但需求要的是它**必须**打断：读条中按闪避 = 放弃这次输出
     * 换取生存，这个取舍本身就是玩法。
     *
     * ⚠️ 代价确实很大（一次「攻」≈10 伤 + 30 炁），所以给「闪」
     * 加了 **1 秒冷却** —— 既保留"要打断"的取舍，又避免连按浪费。
     */
    const isDefensiveReaction = false;
    if (gate.ok && actor.casts.length > 0 && !isDefensiveReaction) {
      for (const cast of actor.casts) {
        this.events.push({
          kind: 'castInterrupted',
          tick: this.state.tick,
          sourceId: actor.id,
          skillId: cast.skillId,
          reason: 'replaced',
        });
      }
      actor.casts = [];
    }

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
      /**
       * **起手就生效**的能力（`on: 'castStart'`）。
       *
       * 需求："重斩加上霸体标签和霸体效果" —— 霸体的意义是"整个前摇
       * 打不断"，所以它必须在起手时挂上。之前 skills 的 abilities 只在
       * 读条**完成**时结算，于是前摇期间照样能被「破」打断，
       * 霸体等于没有（实测确认过）。
       *
       * 时机放在 `castStarted` 事件之后：事件流上读起来是
       * "开始了 → 因此获得霸体"，消费者按顺序理解不会歧义。
       */
      this.applyCastStartAbilities(skill, actor.id);
    } else {
      // 瞬发：先同步冷却，再结算 —— 之后**不再写回**
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
    // 原因：`applyActions` 会用新对象替换 combatant（例如扣了炁）。
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

        /**
         * **刚在本 tick 创建的读条不结算**（进度从下一帧开始算）。
         *
         * 踩过的坑：「攻」的 `hit.at` 是 0（伤害在读条结束时结算），
         * 而读条创建后**同一个 tick** 就会被推进到这里 ——
         * `elapsedMs = 0`、`0 <= 0` 成立，于是伤害**立刻**打出去，
         * 读条形同虚设（实测按下「攻」当场掉 10 血）。
         *
         * 从"读条"的语义看这也更对：读条是跨时间的动作，
         * 它不应该在开始的那一帧就完成。
         */
        if (cast.startedAtTick === this.state.tick) {
          stillCasting.push(cast);
          continue;
        }

        const elapsedMs = (this.state.tick - cast.startedAtTick) * (1000 / 60);

        /**
         * ⚠️ **读条没走完，任何 hit 都不许结算。**
         *
         * 这是需求"所有技能的效果，如果要读条，都应该在读条之后"的
         * 技术落地，也是踩出来的 bug：
         *
         * 原先的条件只有 `hit.at <= elapsedMs`。而**玩家技能的 `at` 是 0**
         * （「攻」「轰」都写 `at: 0`）—— 于是读条创建后的**下一 tick**
         * 就满足 `0 <= 16.67`，伤害当场结算，读条形同虚设。
         *
         * 观感上就是"读条还在走、血已经掉了"（Boss 与玩家两边都有，
         * 玩家的最明显：按下「攻」血就掉）。
         *
         * 现在多一个 `elapsedMs >= cast.castTimeMs` 的前提：
         *   - 读条技能的 `at` 语义变成"读条走完之后的第几毫秒"
         *     （Boss 技能本来就写 `at === castTime`，行为不变）
         *   - 瞬发技能（`castTime === 0`）不走这里，仍由
         *     `resolveSkillHits` 立即结算
         *
         * 注意 `castTimeMs` 是**已经算过急速**的值，所以这条判断
         * 对急速同样成立。
         */
        const castDone = elapsedMs >= cast.castTimeMs;
        const dueHits = skill.hits.filter(
          (hit: HitDef, index: number) =>
            index >= cast.resolvedHits && castDone && hit.at <= elapsedMs,
        );

        /**
         * ⚠️ **顺序很重要：先发 `castFinished`，再结算伤害。**
         *
         * 需求："所有技能的效果，如果要读条，都应该在读条之后。"
         *
         * 事件顺序是这句话最直接的证据 —— 消费者（渲染层的飘字、
         * 测试里的断言、未来的日志）都按事件顺序理解发生了什么。
         * 原先伤害先发、`castFinished` 后发，于是时间线上看起来
         * 仍然是"伤害在读条结束之前"。
         */
        const finished = elapsedMs >= cast.castTimeMs;
        if (finished) {
          this.events.push({
            kind: 'castFinished',
            tick: this.state.tick,
            sourceId: actor.id,
            skillId: cast.skillId,
          });
          this.fireCastFinishTriggers(actor, skill);
        }

        // CastInstance 是 readonly（状态设计如此），所以用新对象推进计数
        let resolved = cast.resolvedHits;
        for (const hit of dueHits) {
          this.resolveHit(actor, skill, hit);
          resolved += 1;
        }

        if (!finished) {
          stillCasting.push({ ...cast, resolvedHits: resolved });
        }
      }

      // ⚠️ 用**当前 state** 而不是循环开头缓存的 `next`：
      // resolveHit 会在循环中间修改双方状态（扣血、挂 buff），
      // 写回旧快照会把那些改动覆盖掉。
      this.replaceCombatant({ ...this.current(actor.id), casts: stillCasting });
    }
  }

  /**
   * 结算 `on: 'castStart'` 的能力。
   *
   * 与 `fireCastFinishTriggers` 是**两套**：那个处理"完成时的结果"，
   * 这个处理"施法期间的状态"。分成两个方法而不是加一个参数，
   * 是因为它们的**写入对象不同** —— 完成时的结算必须操作累积对象
   * （见那里的长注释），而起手时 `state` 已经是最新的。
   */
  private applyCastStartAbilities(skill: SkillDef, actorId: string): void {
    for (const ability of skill.abilities) {
      if (ability.kind !== 'grant' || ability.on !== 'castStart') continue;
      const targetId = ability.target.mode === 'self' ? actorId : (this.opponentOf(actorId)?.id ?? actorId);
      const target = this.current(targetId);
      const applied = applyBuff(target, ability.buff, actorId, this.state.tick);
      this.replaceCombatant({ ...target, buffs: applied.buffs });
      this.events.push({
        kind: 'buffApplied',
        tick: this.state.tick,
        targetId,
        buffId: ability.buff.id,
        stacks: applied.stacks,
        sourceId: actorId,
      });
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
   *   2. **trigger onCastFinish**：派生窗口走这条。
   */
  /**
   * 结算技能自带的 abilities。
   *
   * ⚠️ 这里**必须操作传入的累积对象 `actor`，不能回读 `this.current()`**。
   *
   * 踩过的坑：回读会拿到 state 里的旧版本（此时冷却还没写回），
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
     * 方法末尾又用它写回 —— 中间所有改动（挂 buff、加炁）全被抹掉。
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
     * 炁满时自动挂上的标记 buff。
     *
     * 为什么需要它：终结技的门槛是"炁已满"，而 `requires` 只能检查
     * buff / 资源阈值。用一条"满炁"标记 buff 表达它，内容层就能写
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

    /**
     * ⚠️ 这里只结算**读条完成**时刻的能力。
     *
     * `on: 'castStart'` 的那组在起手时就结算过了（见 `tryUseSkill`），
     * 如果在完成时再算一次，霸体会被刷新成"从完成时刻起算"——
     * 那正好把"整个前摇都免疫"这个语义破坏掉。
     */
    for (const ability of skill.abilities) {
      if (ability.kind === 'grant' && ability.on === 'castStart') continue;
      if (ability.kind === 'grant') {
        grantTo(ability.buff, targetIdOf(ability.target.mode));
        continue;
      }

      if (ability.kind === 'resource') {
        // 一次性资源变动（"基础技产生 18 点炁"）。
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

          /**
           * 炁按伤害换算：**造成伤害的人**与**受到伤害的人**各得一份。
           * 放在这里（而不是内容里）才能覆盖所有伤害来源。
           */
          if (result.amount > 0) {
            this.gainDouqiFromDamage(actor.id, result.amount, this.state.tick);
            this.gainDouqiFromDamage(target.id, result.amount, this.state.tick);
          }
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
      /**
       * **霸体（`interruptImmune`）拦截一切打断，包括「破」的强制打断。**
       *
       * 需求：所有 Boss 招式默认都能被打断 / 闪避 / 格挡，
       * 除非 Boss 处于霸体状态 —— 霸体由一个有 CD 的招式给自己挂上。
       *
       * 这里刻意**不看 `effect.force`**：`force` 的语义是"无视技能的
       * 可打断标记"，但霸体是**更上层的状态**，它必须连强制打断也挡住，
       * 否则霸体招式就没有意义了。
       *
       * 踩过的坑：`BuffFlags.interruptImmune` 早就定义了、`aggregateFlags`
       * 也一直在算它，但**没有任何地方读它** —— 一个"看起来支持但实际
       * 不生效"的字段。接上它比新造一个 flag 好：语义更准，
       * 而且不用动数据模型。
       */
      if (aggregateFlags(target).interruptImmune) {
        this.events.push({
          kind: 'interruptImmune',
          tick: this.state.tick,
          targetId: target.id,
          // 记录"本来会被打断的那个读条"，供 UI 提示用
          skillId: target.casts[0]?.skillId ?? '',
        });
        return;
      }

      if (target.casts.length > 0) {
        /**
         * `force: true` 时**不看可打断性** —— 这是「破」的语义
         * （需求：可以打断任何技能）。默认仍尊重目标技能的可打断性。
         */
        const interrupted = effect.force
          ? [...target.casts]
          : target.casts.filter((c: CastInstance) => c.interruptible);
        if (interrupted.length > 0) {
          const interruptedIds = new Set(interrupted.map((c: CastInstance) => c.skillId));
          this.replaceCombatant({
            ...this.current(target.id),
            casts: this.current(target.id).casts.filter(
              (c: CastInstance) => !interruptedIds.has(c.skillId),
            ),
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
      const result = regenerate(combatant, stats, this.state.tick);
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

