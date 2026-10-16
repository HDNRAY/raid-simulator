/**
 * 战斗结算：资源、读条、hit frame 判定、伤害/治疗。
 *
 * 对应数据模型规范 §6.3（判定窗口）与 §7.1（技能）。
 *
 * ------------------------------------------------------------------
 * 判定层是 M2 的核心，但它天然属于这里
 * ------------------------------------------------------------------
 *
 * Boss 技能在 **hit frame** 一次性判定，玩家靠施放闪避/卸力给自己挂
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

import { kahanSum, roundStat, safeDiv } from '../numeric';
import type {
  ActiveSkillDef,
  BuffDef,
  BuffInstance,
  Combatant,
  EventDef,
  SkillDef,
  StatKey,
} from '../types';
import { aggregateFlags, applyBuff } from '../buffs';
import { LOGIC_TICKS_PER_SECOND, TICKS_PER_LOGIC_TICK } from '../loopConstants';
import { ENERGY_PER_LOGIC_TICK } from '../../data/balance';
import { skipEnergyRegenStep } from './energyRhythm';

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

/**
 * `regenDebt`（生命回复的小数欠账）的刻度：**1/1000 点**。
 *
 * 与「卸」的 `DRAIN_SCALE` 同一条纪律：**必须走整数**，否则 10 次 0.1 的
 * 浮点累加会得到 `0.999…`，差一个整点。值取 1000 是因为"每秒 1 点"
 * 落到每步是 `0.1 = 100/1000`（整数），而更细的回复率也不会掉精度。
 */
export const REGEN_DEBT_SCALE = 1000;

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
  | 'target'
  /**
   * 被限制只能使用某类技能（倒地时只能用「闪避」类）。
   *
   * ⚠️ 与 `locked` 分开：`locked` 是"完全不能动"，这条是"**只能做
   * 某类动作**" —— 玩家需要知道"我还能按什么"。
   */
  | 'tagRestricted';

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

/**
 * ⚠️ 参数收窄成 `ActiveSkillDef`：门禁判的是"**能不能放这一招**" ——
 * 读条 / 冷却 / 代价 / 目标全是主动技能才有的概念，被动技能不会被施放。
 */
export function checkGate(
  combatant: Combatant,
  skill: ActiveSkillDef,
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
     * 默认 `false`。**按住型技能（「卸」）传 `true`**：它每个逻辑步
     * 都会重复请求一次，如果按默认规则办，按住「卸」会把自己的读条
     * 无限打断，「斩」永远打不出来。
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

  /**
   * 1. 动作锁。
   *
   * ⚠️ **`movesWhileLocked` 是"锁住但还能按键"的出路**（「睡眠」用）：
   * 锁本身还在（技能照常受限），但**允许施放技能** —— 因为"按技能"
   * 在那个设计里就是**挣扎**（每次减 3 秒睡眠）。
   * 附加旗标在**同一个 buff 上**（`LAZY_SLEEP` 同时带 `actionLock` 与
   * 它），所以不需要第二个 buff 去"抵消"第一个。
   */
  if (flags.actionLock && flags.movesWhileLocked !== true) {
    return { ok: false, reason: 'locked' };
  }

  /**
   * 1b. **技能 tag 白名单**（倒地时只能用「闪避」类）。
   *
   * 需求："2s内只能按 带有 闪避 tag的技能。"
   *
   * ⚠️ 放在 `casting` 之前：玩家被控时最该看到的提示是"你现在只能
   * 翻滚"，而不是"你正在施法中"。否则按住「斩」会一直看到后者，
   * 完全不知道有出路。
   */
  const allowed = flags.restrictToTags;
  if (allowed !== undefined && allowed.length > 0) {
    const skillTags = skill.tags ?? [];
    if (!skillTags.some((t) => allowed.includes(t))) {
      return { ok: false, reason: 'tagRestricted' };
    }
  }

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

    case 'buffStacks': {
      const stacks = pick(condition.who)
        .buffs.filter((b) => b.defId === condition.buffId)
        .reduce((sum, b) => sum + b.stacks, 0);
      return stacks >= condition.minStacks;
    }

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
 * 4. 伤害 / 治疗 —— **实现搬到了 `./damage.ts`**
 * ------------------------------------------------------------------ *
 *
 * ⚠️ 公式（`computeDamage` / `computeHeal`）、落地（`applyDamage` /
 * `applyHeal`）与「卸」的阈值判定入口（`preBlockDamage` /
 * `flatBlocked`）都在那边。搬走的理由见 `damage.ts` 的文件头
 * （`combat/index.ts` 到了 765 行，AGENTS.md §3）。
 *
 * ⚠️ 这里**转发**它们，所以 `from './index'` 的写法照旧可用。
 */
export {
  applyDamage,
  applyHeal,
  computeDamage,
  computeHeal,
  flatBlocked,
  preBlockDamage,
} from './damage';
export type { CritRoll, DamageResult, DefenseFlags } from './damage';

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
  skill: ActiveSkillDef,
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
 *     而「卸」是按 0.1 秒扣的 —— 收支节奏对不上，手感会很怪。
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

  /**
   * ⚠️ **这一步要不要跳过回炁**（「恶魔低语」的"回炁变慢"，2026-10-16）。
   *
   * `energyRegenScale < 1` 时按**整数节奏**跳步（0.8 ⇒ 每 5 步跳 1 步
   * ⇒ 8/秒）。⚠️ 不能直接乘 0.8，也**不能**走 `energyRegen` 属性 ——
   * 两条路都会被取整吃掉（一个照样 +1、一个变成 0），
   * 完整理由与那张表在 `./energyRhythm.ts`。
   *
   * ⚠️ 跳的是**整个炁回复**（下面的固定回复**和**属性回复），
   * 而不是其中一半 —— "回炁速度"只有一条口径。
   */
  const energyScale = stats.energyRegenScale ?? 1;
  const skipEnergy = skipEnergyRegenStep({
    step: tick / TICKS_PER_LOGIC_TICK,
    scale: energyScale,
  });

  // 缠：固定每逻辑步回复（不再受精神加成影响 —— 刻度太小，加法会失真）
  if (ENERGY_PER_LOGIC_TICK > 0 && !skipEnergy) {
    const result = changeResource(current, 'energy', ENERGY_PER_LOGIC_TICK, tick);
    current = result.combatant;
    events.push(...result.events);
  }

  /**
   * **炁回复速度**（`energyRegen`，口径 = **每秒**，见 `stats/aggregate.ts`）。
   *
   * ==================================================================
   * ⚠️ 这一条是 P3 才接上的（2026-10-13）—— 在那之前它"写了没人读"
   * ==================================================================
   *
   * `energyRegen` 从数据模型第一天就在 `StatKey` 里（`STAT_RULES` 也有它的
   * 聚合规则），但**没有任何引擎分支读它**：上面那条固定回复是唯一来源。
   * 肉鸽的兜底炁机「炁回复速度」（`data/qiji.ts` 的 `QIJI_BREATH`）就是靠
   * 这个属性，所以这里把它接上。
   *
   * 换算与 `hpRegen` 同一条：属性是**每秒**，而结算按**逻辑步** ——
   * 用 `LOGIC_TICKS_PER_SECOND`，不写字面量 `10`（否则"一步多长"就有了
   * 第二份真相，那正是「卸」那次 10 倍偏差的形状）。
   *
   * ⚠️ **取整方向是"向下"**（`Math.floor`），故意的：
   *   `energyRegen = 5/秒` ⇒ 每步 0.5 ⇒ 被吃掉。这不是 bug，而是
   *   "内容里写 `energyRegen` 时必须是每步至少 1 点（= 每秒 ≥10）的量级"
   *   这条口径 —— 所以 `data/qiji.ts` 用的是 **+10/秒**，那张表里记着原因。
   *
   *   为什么不做「卸」那种小数欠账累加器：`holdDrain` 有欠账是因为内容作者
   *   会写任意小数；而 `energyRegen` 的推荐值是整十。多一个**随战斗推进的
   *   字段**去救一个没人会写的配置不划算 —— 而那种字段会动确定性语义
   *   （`REPLAY_FORMAT_VERSION` 的账）。
   */
  const energyPerLogicTick = Math.floor((stats.energyRegen ?? 0) / LOGIC_TICKS_PER_SECOND);
  if (energyPerLogicTick > 0 && !skipEnergy) {
    const result = changeResource(current, 'energy', energyPerLogicTick, tick);
    current = result.combatant;
    events.push(...result.events);
  }

  // 生命回复仍走属性（内容可以给回血装备）
  /**
   * ⚠️ `hpRegen` 这个 stat 的口径是**每秒**（见 `stats/aggregate.ts` 的
   * "资源回复（每秒）"），而这里要的是**每逻辑步**。
   * 用 `LOGIC_TICKS_PER_SECOND` 而不是字面量 `10` —— 否则"一步多长"
   * 就有了第二份真相（正是「卸」那次 10 倍偏差的同一类问题）。
   */
  const hpPerStep = (stats.hpRegen ?? 0) / LOGIC_TICKS_PER_SECOND;
  if (hpPerStep > 0) {
    /**
     * ⚠️ **小数走欠账累加器**（原来的写法是 `Math.round(hpPerStep)`，
     * 那会把"每秒 1 点"（= 每步 0.1）**舍成 0，一点都不回**）。
     *
     * 与「卸」的 `drainDebt` 同一条思路，而且同样用**整数**（1/1000 点）：
     * 浮点累加 10 次 0.1 会得到 `0.9999999999999999`，差一个整点。
     */
    const gain =
      ((current.regenDebt ?? 0) + Math.round(hpPerStep * REGEN_DEBT_SCALE)) / REGEN_DEBT_SCALE;
    const whole = Math.floor(gain);
    const next = { ...current, regenDebt: Math.round((gain - whole) * REGEN_DEBT_SCALE) };
    if (whole > 0) {
      const result = changeResource(next, 'hp', whole, tick);
      current = result.combatant;
      events.push(...result.events);
    } else {
      current = next;
    }
  }

  return { combatant: current, events };
}

/** 求和工具再导出，便于引擎层复用。 */
export { kahanSum, roundStat };
