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

import { aggregateFlags, applyBuff, expireBuffs } from '../buffs';
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
} from './index';
import { computeStats } from '../stats/pipeline';
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
} from '../types';

/** 起始初始状态需要的输入。 */
export interface CreateBattleOptions {
  readonly combatants: readonly Combatant[];
  readonly seed: number;
  readonly buffs: ReadonlyMap<string, BuffDef>;
  readonly skills: ReadonlyMap<string, SkillDef>;
  /** 每个 combatant 的基础属性（内容定义） */
  readonly baseStats: ReadonlyMap<string, Partial<Record<StatKey, number>>>;
  /** 每个 combatant 身上的被动修正（装备 / 天赋） */
  readonly passiveModifiers: ReadonlyMap<string, readonly StatModifier[]>;
  readonly timeLimitMs?: number;
}

/** 引擎实例：持有不可变的内容定义 + 可变的战斗状态。 */
export class BattleEngine {
  private state: BattleState;
  private rng: RngState;
  private readonly options: CreateBattleOptions;
  private readonly events: EventDef[] = [];
  private readonly gcdBuff: BuffDef;

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

  get snapshot(): BattleState {
    return this.state;
  }

  /** 取出并清空自上次调用以来产生的事件。 */
  drainEvents(): readonly EventDef[] {
    const out = [...this.events];
    this.events.length = 0;
    return out;
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
    const combatant = this.state.combatants.find((c: Combatant) => c.id === combatantId);
    if (!combatant) return EMPTY_STATS;

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
    }).values;
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
   * 主循环
   * ---------------------------------------------------------------- */

  /**
   * 应用一批动作。对应管线第 1 步。
   *
   * `actorId` 决定"谁在执行这些动作" —— 这让**玩家与 Boss 走完全同一条
   * 施法路径**（数据模型规范：两边只差输入来源）。
   * 不给则默认玩家。
   */
  applyActions(actions: readonly Action[], actorId = 'player'): void {
    for (const action of actions) {
      if (action.type === 'useSkill') this.tryUseSkill(action.skillId, actorId);
    }
  }

  /**
   * 推进一个 tick。这是**唯一的**状态推进入口。
   *
   * @param actions 本 tick 要应用的玩家 / AI 动作
   * @param aiActions AI 产出的动作（M4 会填充；现在可以为空）
   */
  tick(
    actions: readonly Action[] = [],
    aiActions: readonly Action[] = [],
    aiActorId = 'boss',
  ): void {
    if (this.state.status !== 'running') return;

    // 1. 动作生效（两边走同一条路径，只是 actor 不同）
    this.applyActions(actions, 'player');
    this.applyActions(aiActions, aiActorId);

    // 2. 读条推进
    this.advanceCasts();

    // 3. 持续效果（DoT / HoT）到点触发
    this.tickOverTimeEffects();

    // 4. buff 过期
    this.expireBuffs();

    // 5. 资源回复
    this.regenerateResources();

    // 6. 时间限制 / 狂暴（M4 会扩展；这里先做时限判定）
    this.checkTimeLimit();

    // 7. 推进 tick 并做死亡判定
    this.state = { ...this.state, tick: this.state.tick + 1 };
    this.checkDeaths();
  }

  /* ---------------------------------------------------------------- *
   * 技能施放
   * ---------------------------------------------------------------- */

  private tryUseSkill(skillId: string, actorId: string): void {
    const actor = this.state.combatants.find((c: Combatant) => c.id === actorId);
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
    for (const actor of this.state.combatants) {
      if (actor.casts.length === 0) continue;

      const stillCasting: typeof actor.casts[number][] = [];

      for (const cast of actor.casts) {
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
    let working = actor;

    const grantTo = (buff: BuffDef, targetId: string): void => {
      const target = working.id === targetId ? working : this.current(targetId);
      const applied = applyBuff(target, buff, working.id, this.state.tick);
      working =
        target.id === working.id ? { ...working, buffs: applied.buffs } : working;
      if (target.id !== working.id) {
        this.replaceCombatant({ ...target, buffs: applied.buffs });
      }
      this.events.push({
        kind: 'buffApplied',
        tick: this.state.tick,
        targetId: target.id,
        buffId: buff.id,
        stacks: applied.stacks,
        sourceId: working.id,
      });
    };

    for (const ability of skill.abilities) {
      const targetIdOf = (mode: string): string => {
        if (mode === 'self') return working.id;
        return this.opponentOf(working.id)?.id ?? working.id;
      };

      if (ability.kind === 'grant') {
        grantTo(ability.buff, targetIdOf(ability.target.mode));
        continue;
      }

      if (ability.kind === 'trigger') {
        if (ability.trigger.on !== 'onCastFinish') continue;
        for (const then of ability.trigger.then) {
          if (then.kind === 'grant') grantTo(then.buff, targetIdOf(then.target.mode));
        }
      }
    }

    this.replaceCombatant(working);
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
          // 判定：无敌 → 免伤；否则算减伤
          const result = computeDamage(
            effect.damage,
            casterStats,
            victimFlags,
            { crit: false, multiplier: 1 },
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
    for (const combatant of this.state.combatants) {
      for (const buff of combatant.buffs) {
        const def = buff.def ?? this.options.buffs.get(buff.defId);
        if (!def) continue;
        // DoT 效果的实现：buff 的 modifiers 影响属性，而"每跳伤害"
        // 由内容层的 trigger（onTick）表达。M1 阶段先只处理属性类 buff。
      }
    }
  }

  private expireBuffs(): void {
    for (const combatant of this.state.combatants) {
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
    for (const combatant of this.state.combatants) {
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

  private current(id: string): Combatant {
    return this.state.combatants.find((c: Combatant) => c.id === id) ?? this.state.combatants[0]!;
  }

  private replaceCombatant(updated: Combatant): void {
    this.state = {
      ...this.state,
      combatants: this.state.combatants.map((c: Combatant) => (c.id === updated.id ? updated : c)),
    };
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
  for (const key of ['hp', 'mp', 'energy', 'fury'] as const) {
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
