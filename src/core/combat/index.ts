/**
 * 战斗结算：资源、读条、hit frame 判定、伤害/治疗。
 *
 * 对应数据模型规范 §6.3（判定窗口）与 §7.1（技能）。
 *
 * ------------------------------------------------------------------
 * 判定层是 M2 的核心，但它天然属于这里
 * ------------------------------------------------------------------
 *
 * Boss 技能在 **hit frame** 一次性判定，玩家靠施放闪避/格挡给自己挂
 * 短时 buff 来规避。所以"躲避"的完整链路是：
 *
 *   hit frame 到达
 *     → 查目标 buff 的 flags
 *       → invulnerable  → 发 avoided 事件，HP 不变（**必须发事件**，
 *                          否则玩家不知道自己躲掉了）
 *       → damageReduce  → 乘 (1 - reduce)，事件里带 absorbed
 *       → 都没有        → 正常结算
 *
 * 数值纪律（架构规范 §12）：
 *   - 生命是**整数**，公式内部 float，只在写回时取整
 *   - 伤害**向下取整**（向上会让"每次 0.5 伤害"变成 1 点）
 *   - 除法走 safeDiv，NaN 绝不允许进入状态
 */

import { kahanSum, roundDamage, roundStat, safeDiv } from '../numeric';
import type {
  BuffDef,
  BuffInstance,
  Combatant,
  DamageSpec,
  EventDef,
  School,
  SkillDef,
  StatKey,
} from '../types';
import { aggregateFlags, applyBuff } from '../buffs';
import { TICKS_PER_LOGIC_TICK } from '../loopConstants';
import { ENERGY_PER_LOGIC_TICK } from '../../data/balance';

/** 结算环境：引擎把内容定义与属性查询注入进来。 */
export interface CombatContext {
  /** 读某个单位的某个属性（由 M1-3 的 computeStats 提供） */
  statsOf(combatantId: string): Readonly<Record<StatKey, number>>;
  /** 解析 buff 定义（用于 flags 与 modifiers） */
  buffDef(buffId: string): BuffDef | undefined;
  /** 解析技能定义 */
  skillDef(skillId: string): SkillDef | undefined;
  /** 战斗内的当前 tick */
  currentTick(): number;
}

/* ------------------------------------------------------------------ *
 * 1. 资源
 * ------------------------------------------------------------------ */

/** 资源上限（floor 后作为整数上限）。 */
export function capOf(combatant: Combatant, key: keyof Combatant['resources']): number {
  return Math.max(0, Math.floor(combatant.caps[key]));
}

/** 把资源钳到 [0, cap]。**整数**。 */
export function clampResources(combatant: Combatant): Combatant['resources'] {
  const out = { ...combatant.resources };
  for (const key of ['hp', 'energy', 'douqi'] as const) {
    const cap = capOf(combatant, key);
    const value = out[key];
    out[key] = Math.max(0, Math.min(cap, Number.isFinite(value) ? Math.round(value) : 0));
  }
  return out;
}

export interface ResourceDelta {
  readonly combatant: Combatant;
  readonly events: readonly EventDef[];
}

/**
 * 增减资源。返回新的 combatant 与事件。
 *
 * 不做"资源够不够"的判断 —— 那是 `canAfford` 的事。
 * 这里只负责钳制与发事件。
 */
export function changeResource(
  combatant: Combatant,
  key: keyof Combatant['resources'] | string,
  delta: number,
  tick: number,
): ResourceDelta {
  const resources = { ...combatant.resources } as Record<string, number>;
  const before = resources[key] ?? 0;
  const cap = (combatant.caps as Record<string, number>)[key] ?? Number.POSITIVE_INFINITY;
  const after = Math.max(0, Math.min(cap, Math.round(before + delta)));
  resources[key] = after;

  const events: EventDef[] =
    after === before
      ? []
      : [
          {
            kind: 'resourceChanged',
            tick,
            targetId: combatant.id,
            resource: key,
            delta: after - before,
            current: after,
          },
        ];

  return {
    combatant: { ...combatant, resources: resources as Combatant['resources'] },
    events,
  };
}

/* ------------------------------------------------------------------ *
 * 2. 施法门禁（skillRejected 的分类）
 * ------------------------------------------------------------------ */

export type RejectReason =
  | 'cooldown'
  | 'cost'
  | 'casting'
  | 'condition'
  | 'locked'
  | 'target';

export interface GateResult {
  readonly ok: boolean;
  readonly reason?: RejectReason;
}

/**
 * 施法门禁检查。**顺序是确定的**，因为它决定了"同时多个原因时报告哪个"。
 *
 * 顺序：locked → casting → cooldown → cost → condition
 *
 * 为什么这个顺序合理：
 *   - `locked`（动作锁）是最高优先级：连行动都不行，谈别的没意义
 *   - `casting` 其次：正在读条时按键，玩家最需要知道的就是"我在读条"
 *   - `cost` 比 `condition` 优先：资源不足比"条件不满足"更可操作
 */
/**
 * 按"资源是否已达上限"同步一个标记 buff。
 *
 * 用途：终结技的门槛常常是"资源攒满"。`Condition` 里只有
 * `resourceAbove`（数值阈值）而没有"是否满"的语义 —— 数值阈值在
 * 上限变化时就会失效（装备提升上限后，写死的阈值不再等于"满"）。
 *
 * 所以引擎负责在资源变动后把这条标记 buff 挂上/摘掉，
 * 内容层就能用 `requires: [{ kind:'hasBuff', buffId }]` 表达门槛，
 * **不需要给 Condition 加新类型**（这是可扩展性的一个验证点）。
 *
 * @returns 需要写入的 buffs 与事件；无变化时返回 undefined
 */
export function syncResourceGateBuff(
  combatant: Combatant,
  resource: string,
  buffId: string,
  buffDef: BuffDef,
  tick = 0,
): { readonly buffs: readonly BuffInstance[]; readonly events: readonly EventDef[] } | undefined {
  const cap = (combatant.caps as Record<string, number>)[resource] ?? 0;
  const current = (combatant.resources as Record<string, number>)[resource] ?? 0;
  const atFull = cap > 0 && current >= cap;
  const has = combatant.buffs.some((b) => b.defId === buffId);

  if (atFull === has) return undefined;

  if (atFull) {
    const applied = applyBuff(combatant, buffDef, combatant.id, tick);
    return {
      buffs: applied.buffs,
      events: [
        {
          kind: 'buffApplied',
          tick,
          targetId: combatant.id,
          buffId,
          stacks: applied.stacks,
          sourceId: combatant.id,
        },
      ],
    };
  }

  return {
    buffs: combatant.buffs.filter((b) => b.defId !== buffId),
    events: [
      {
        kind: 'buffExpired',
        tick,
        targetId: combatant.id,
        buffId,
        stacks: 0,
        sourceId: combatant.id,
      },
    ],
  };
}

export function checkGate(
  combatant: Combatant,
  skill: SkillDef,
  ctx: CombatContext,
  options: {
    readonly hasTarget: boolean;
    readonly ignoreCost?: boolean;
    /**
     * 正在读条时，这个技能是否**放行**（由调用方负责打断旧读条）。
     *
     * 命名说清楚方向：`true` = "读条中也能用"，`false` = "读条中不能用"。
     * （早期叫 `interruptCasts`，名字描述的是"会不会打断"，
     * 调用点容易传反 —— 我就传反过一次，表现为"所有技能都被 casting
     * 拒绝、打断功能整个失效"。）
     *
     * 默认 `false`。**按住型技能（「防」）传 `true`**：它每个逻辑步
     * 都会重复请求一次，如果按默认规则办，按住「防」会把自己的读条
     * 无限打断，「攻」永远打不出来。
     *
     * 放行时门禁跳过读条判断，由调用方**自己清掉读条**并补发中断事件
     * （否则读条会与新技能共存，两条一起结算）。
     */
    readonly allowedWhileCasting?: boolean;
  } = {
    hasTarget: true,
  },
): GateResult {
  const flags = aggregateFlags(combatant);

  // 1. 动作锁
  if (flags.actionLock) return { ok: false, reason: 'locked' };

  // 2. 正在读条 —— 默认不放行，由调用方决定是否要打断它
  if (combatant.casts.length > 0 && options.allowedWhileCasting !== true) {
    return { ok: false, reason: 'casting' };
  }

  const tick = ctx.currentTick();

  // 3. 技能冷却
  const readyAt = combatant.cooldowns[skill.id];
  if (readyAt !== undefined && readyAt > tick) return { ok: false, reason: 'cooldown' };

  // 4. 代价
  if (!options.ignoreCost) {
    for (const cost of skill.cost) {
      const need = typeof cost.value === 'number' ? cost.value : 0;
      const has = (combatant.resources as Record<string, number>)[cost.resource] ?? 0;
      if (has < need && !cost.allowOverdraft) return { ok: false, reason: 'cost' };
    }
  }

  // 5. 前置条件（派生窗口等）
  if (skill.requires && skill.requires.length > 0) {
    for (const condition of skill.requires) {
      if (!evaluateCondition(combatant, condition, ctx)) return { ok: false, reason: 'condition' };
    }
  }

  // 6. 目标
  if (!options.hasTarget && skill.targeting.mode === 'primaryEnemy') {
    return { ok: false, reason: 'target' };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * 3. 条件求值
 * ------------------------------------------------------------------ */

/**
 * 求值一个条件。
 *
 * 与 M1-3 的修正树共用同一套 `Condition` —— 这是"唯一一套判定语法"
 * 的落地处（数据模型规范 §4）。
 */
export function evaluateCondition(
  combatant: Combatant,
  condition: import('../types').Condition,
  ctx: CombatContext,
  other?: Combatant,
): boolean {
  const pick = (who?: string): Combatant => {
    if (who === 'target' && other) return other;
    if (who === 'caster' && other) return other;
    return combatant;
  };

  switch (condition.kind) {
    case 'always':
      return true;

    case 'hasBuff': {
      const target = pick(condition.who);
      const stacks = target.buffs
        .filter((b) => b.defId === condition.buffId)
        .reduce((sum, b) => sum + b.stacks, 0);
      return stacks >= (condition.minStacks ?? 1);
    }

    case 'notHasBuff':
      return !pick(condition.who).buffs.some((b) => b.defId === condition.buffId);

    case 'buffExpiring': {
      const buff = pick(condition.who).buffs.find((b) => b.defId === condition.buffId);
      if (!buff || !Number.isFinite(buff.expiresAtTick)) return false;
      const remainingMs = (buff.expiresAtTick - ctx.currentTick()) * (1000 / 60);
      return remainingMs <= condition.withinMs;
    }

    case 'hpBelow':
      return safeDiv(pick(condition.who).resources.hp, pick(condition.who).caps.hp) < condition.ratio;

    case 'hpAbove':
      return safeDiv(pick(condition.who).resources.hp, pick(condition.who).caps.hp) > condition.ratio;

    case 'resourceAbove':
      return (pick(condition.who).resources as Record<string, number>)[condition.resource]! > condition.value;

    case 'resourceBelow':
      return (pick(condition.who).resources as Record<string, number>)[condition.resource]! < condition.value;

    case 'statAbove':
      return (ctx.statsOf(pick(condition.who).id)[condition.stat] ?? 0) > condition.value;

    case 'isCasting':
      return pick(condition.who).casts.length > 0;

    case 'targetCount':
      // 单 Boss 战斗里这个条件几乎不用，实现为恒假以避免误导
      return false;

    case 'lastHitWasCrit':
      // 需要引擎记录上一次命中，M4 再接
      return false;

    case 'all':
      return condition.of.every((c) => evaluateCondition(combatant, c, ctx, other));

    case 'any':
      return condition.of.some((c) => evaluateCondition(combatant, c, ctx, other));

    case 'not':
      return !evaluateCondition(combatant, condition.of, ctx, other);
  }
}

/** 阶段读取的钩子（由引擎注入，避免这里依赖 EncounterState）。 */


/* ------------------------------------------------------------------ *
 * 4. hit frame 判定（M2 的核心）
 * ------------------------------------------------------------------ */

export interface DamageResult {
  /** 实际扣掉的生命（已取整） */
  readonly amount: number;
  /** 被减伤/护盾吸收的量 */
  readonly absorbed: number;
  readonly crit: boolean;
  readonly avoided: boolean;
  readonly avoidReason?: 'invulnerable' | 'dodged';
}

/** 暴击判定结果。 */
export interface CritRoll {
  readonly crit: boolean;
  readonly multiplier: number;
}

/**
 * 计算一次伤害。
 *
 * 公式（数据模型规范 §5）：
 *   raw    = (base + Σ stat × ratio)
 *   boosted= raw × (1 + damageBoost/100)
 *   mult   = damageMult（乘子型，已经是"要乘的数"）
 *   crit   = × critDamage（如果暴击）
 *   final  = floor(boosted × mult × crit × (1 - damageReduce))
 *
 * 注意 `damageBoost` 除以 100：它是**累加器**，值 10 表示 +10%。
 * 这个单位约定在规范 §5.2 里写明了。
 */
export function computeDamage(
  spec: DamageSpec,
  casterStats: Readonly<Record<StatKey, number>>,
  targetFlags: { readonly invulnerable?: boolean; readonly damageReduce?: number },
  roll: CritRoll,
): DamageResult {
  // 无敌：直接免伤（不发伤害，但要告诉调用方是"被规避"）
  if (targetFlags.invulnerable) {
    return { amount: 0, absorbed: 0, crit: false, avoided: true, avoidReason: 'invulnerable' };
  }

  let raw = typeof spec.base === 'number' ? spec.base : 0;
  for (const term of spec.scaling ?? []) {
    raw += (casterStats[term.stat] ?? 0) * term.ratio;
  }

  let value = raw;
  if (!spec.ignoreModifiers) {
    const boost = (casterStats.damageBoost ?? 0) / 100;
    value *= 1 + boost;
    const mult = casterStats.damageMult ?? 0;
    value *= mult > 0 ? mult : 1;
    if (roll.crit) {
      const critDamage = casterStats.critDamage ?? 0;
      const critBoost = casterStats.critDamageBoost ?? 0;
      // critDamage 是"额外倍率"（0.5 表示 +50%），critDamageBoost 是乘子
      value *= 1 + (critDamage > 0 ? critDamage : 0);
      value *= critBoost > 0 ? critBoost : 1;
    }
    if (targetFlags.damageReduce) value *= 1 - targetFlags.damageReduce;
  }

  const rounded = roundDamage(value);
  return { amount: Math.max(0, rounded), absorbed: 0, crit: roll.crit, avoided: false };
}

/** 治疗：与伤害对称，但**向上取整**（治疗少一点会让玩家难受）。 */
export function computeHeal(
  spec: DamageSpec,
  casterStats: Readonly<Record<StatKey, number>>,
  roll: CritRoll,
): number {
  let raw = typeof spec.base === 'number' ? spec.base : 0;
  for (const term of spec.scaling ?? []) {
    raw += (casterStats[term.stat] ?? 0) * term.ratio;
  }
  let value = raw * (1 + (casterStats.healingBoost ?? 0) / 100);
  if (roll.crit && spec.canCrit) value *= 1 + (casterStats.critDamage ?? 0);
  return Math.max(0, Math.ceil(value));
}

/**
 * 对一个目标应用伤害。
 *
 * **闪避成功必须发 `avoided` 事件** —— 否则玩家不知道自己躲掉了，
 * 这个反馈缺失会让"躲避"这个机制在体感上不存在。
 */
export function applyDamage(
  target: Combatant,
  result: DamageResult,
  sourceId: string,
  skillId: string,
  school: School,
  tick: number,
): { readonly combatant: Combatant; readonly events: readonly EventDef[] } {
  if (result.avoided) {
    return {
      combatant: target,
      events: [
        {
          kind: 'avoided',
          tick,
          sourceId,
          targetId: target.id,
          skillId,
          reason: result.avoidReason === 'invulnerable' ? 'immune' : 'dodged',
        },
      ],
    };
  }

  const before = target.resources.hp;
  const after = Math.max(0, before - result.amount);
  const dealt = before - after;
  const overkill = Math.max(0, result.amount - before);

  const events: EventDef[] = [
    {
      kind: 'damage',
      tick,
      sourceId,
      targetId: target.id,
      amount: dealt,
      crit: result.crit,
      school,
      absorbed: result.absorbed,
      overkill,
    },
  ];

  if (after <= 0) {
    events.push({ kind: 'death', tick, targetId: target.id });
  }

  return {
    combatant: {
      ...target,
      resources: { ...target.resources, hp: after },
      alive: after > 0,
    },
    events,
  };
}

/** 治疗。 */
export function applyHeal(
  target: Combatant,
  amount: number,
  sourceId: string,
  crit: boolean,
  tick: number,
): { readonly combatant: Combatant; readonly events: readonly EventDef[] } {
  const cap = capOf(target, 'hp');
  const before = target.resources.hp;
  const after = Math.min(cap, before + amount);
  const healed = after - before;

  if (healed === 0 && amount === 0) return { combatant: target, events: [] };

  return {
    combatant: { ...target, resources: { ...target.resources, hp: after } },
    events: [
      {
        kind: 'heal',
        tick,
        sourceId,
        targetId: target.id,
        amount: healed,
        crit,
        overheal: Math.max(0, amount - healed),
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * 5. 冷却
 * ------------------------------------------------------------------ */

export interface CooldownResult {
  readonly combatant: Combatant;
  readonly events: readonly EventDef[];
}

/** 设置技能冷却（绝对 tick）。急速会缩短冷却，由调用方算好传入。 */
export function setCooldown(combatant: Combatant, skillId: string, readyAtTick: number): Combatant {
  return { ...combatant, cooldowns: { ...combatant.cooldowns, [skillId]: readyAtTick } };
}

/** 应用急速到冷却时长。 */
export function hastedCooldown(cooldownMs: number, stats: Readonly<Record<StatKey, number>>): number {
  const haste = stats.haste ?? 0;
  return Math.max(0, cooldownMs * (1 - haste));
}

/** 应用急速到读条时长。 */
export function hastedCastTime(castTimeMs: number, stats: Readonly<Record<StatKey, number>>): number {
  const haste = stats.haste ?? 0;
  return Math.max(0, castTimeMs * (1 - haste));
}

/** 资源消耗（返回新的 combatant；不足时由 gate 拦住，这里只扣）。 */
export function payCosts(
  combatant: Combatant,
  skill: SkillDef,
  tick: number,
): { readonly combatant: Combatant; readonly events: readonly EventDef[] } {
  let current = combatant;
  const events: EventDef[] = [];
  for (const cost of skill.cost) {
    const value = typeof cost.value === 'number' ? cost.value : 0;
    const result = changeResource(current, cost.resource, -value, tick);
    current = result.combatant;
    events.push(...result.events);
  }
  return { combatant: current, events };
}

/**
 * 资源自然回复。
 *
 * ------------------------------------------------------------------
 * 按**逻辑步**（0.1 秒）而不是按秒或按 tick
 * ------------------------------------------------------------------
 *
 * 需求是"每 0.1 秒恢复 1 点缠"。三种做法里只有一种是对的：
 *
 *   按秒聚合（每秒 +10）：玩家看到缠一秒跳一次，
 *     而「防」是按 0.1 秒扣的 —— 收支节奏对不上，手感会很怪。
 *   按 tick（每 1/60 秒 +1/6 点）：被整数化吃掉小数，实际不回复。
 *   按逻辑步：与内容里的时长单位一致，收支都在同一个时间网格上。
 *
 * 所以回复量与时长常量都放在 `data/balance.ts` / `loopConstants.ts`，
 * 由内容层决定"每步回多少"。
 */
export function regenerate(
  combatant: Combatant,
  stats: Readonly<Record<StatKey, number>>,
  tick: number,
): { readonly combatant: Combatant; readonly events: readonly EventDef[] } {
  const events: EventDef[] = [];
  let current = combatant;

  if (tick % TICKS_PER_LOGIC_TICK !== 0) return { combatant: current, events };

  // 缠：固定每逻辑步回复（不再受精神加成影响 —— 刻度太小，加法会失真）
  if (ENERGY_PER_LOGIC_TICK > 0) {
    const result = changeResource(current, 'energy', ENERGY_PER_LOGIC_TICK, tick);
    current = result.combatant;
    events.push(...result.events);
  }

  // 生命回复仍走属性（内容可以给回血装备）
  const hpPerLogicTick = (stats.hpRegen ?? 0) / 10;
  if (hpPerLogicTick > 0) {
    const result = changeResource(current, 'hp', Math.round(hpPerLogicTick), tick);
    current = result.combatant;
    events.push(...result.events);
  }

  return { combatant: current, events };
}

/** 求和工具再导出，便于引擎层复用。 */
export { kahanSum, roundStat };
