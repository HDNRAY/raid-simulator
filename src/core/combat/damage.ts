/**
 * **伤害 / 治疗的公式与落地**：`computeDamage` / `applyDamage` 那一整块。
 *
 * ==================================================================
 * 为什么从 `combat/index.ts` 里搬出来
 * ==================================================================
 *
 * 2026-10-12 加「卸」的**阈值抵消**（`damageThreshold`）时，
 * `combat/index.ts` 到了 **765 行**（AGENTS.md §3 的上限是 700）。
 *
 * 按 §3 的顺序（**先拆 util，不要压注释**），这里选的是"横向切割"：
 * 这一块 299 行是一个**自成一体的阶段** ——
 *
 *   preBlockDamage / flatBlocked   阈值判定的输入（"这一击值多少"）
 *   computeDamage / computeHeal    公式
 *   applyDamage / applyHeal        落到状态上 + 发事件
 *
 * 它夹在"资源 / 门禁 / 条件"与"冷却 / 回复"之间，读者要在一千行里来回跳。
 * 搬出来之后 `index.ts` 只剩**门禁与资源**（它的文件名说的那件事）。
 *
 * ⚠️ **注释一条都没压**（§3 明确禁止靠删注释解决超限）：原文照搬，
 * 包括「卸」那条"两半都复用已有通路"的设计说明。
 *
 * ⚠️ `index.ts` **转发**本文件全部导出，所以
 * `from './index'` 的写法照旧可用（本仓库在 `core/types/` 上用过同一条）。
 */

import { roundDamage } from '../numeric';
import { capOf } from './index';
import type {
  Combatant,
  DamageSpec,
  EventDef,
  StatKey,
} from '../types';

/* ------------------------------------------------------------------ *
 * 伤害与治疗（原 `combat/index.ts` 的第 4 节）
 * ------------------------------------------------------------------ */

export interface DamageResult {
  /** 实际扣掉的生命（已取整） */
  readonly amount: number;
  /** 被减伤/护盾吸收的量 */
  readonly absorbed: number;
  /**
   * 被**阈值抵消**磨掉的量（林晚风「卸」的 `>N → 伤害 − N`）。
   *
   * ⚠️ 与 `absorbed` 分开记：`absorbed` 是**比例减免**（`damageReduce`），
   * 这一条是**平减**（`damageThreshold`）。两者在日志里是不同的话
   * （"卸力挡掉了 15"vs"减免了 55%"），合成一个字段会让那句话说不清。
   */
  readonly thinned: number;
  readonly crit: boolean;
  readonly avoided: boolean;
  readonly avoidReason?: 'invulnerable' | 'dodged';
}

/**
 * 一次命中的**防御侧**判定旗标。
 *
 * ⚠️ 单独命名是给 `flatBlocked` 与 `resolveHit` 共用同一个形状：
 * 两者必须对"这一击的伤害是多少"给出**完全一致**的答案，
 * 而参数相同是保证这点的最便宜办法。
 */
export interface DefenseFlags {
  readonly invulnerable?: boolean;
  readonly damageReduce?: number;
  readonly damageThreshold?: number;
  /**
   * **平减**（「恶魔低语」的"所有伤害 −5，但**保底 3**"，2026-10-16）。
   *
   * ==================================================================
   * 为什么**不能**复用 `damageThreshold`
   * ==================================================================
   *
   * `damageThreshold` 是「卸」的语义，**自带两半**：
   * `≤N` → **整击作废（连效果一起免）**；`>N` → 伤害 − N。
   *
   * 把"所有伤害 −5"挂成它，就会继承那两半 —— 于是玩家的「击」（5 点）
   * 被**整击作废**（一点伤害都没有），而且小伤害段上挂的打断 / 眩晕
   * 会被"连效果一起免"顺带吃掉。用户 2026-10-16 点名的就是这一条
   * （"小于等于五整击无效，这个要稍微调整一下…我平砍只有 5 点"）。
   *
   * 所以这里是**第三种形态**：**只平减**，不整击作废、不碰效果，
   * 且**保底**（削完至少 `floor`，但**不会超过**本来该有的伤害 ——
   * 保底不是"凭空加伤"）。
   *
   * ```
   * afterThreshold = max(0, floor(…) − damageThreshold)
   * after          = afterThreshold − amount
   * final          = after > 0 ? after : min(afterThreshold, floor)
   * ```
   *
   * ⚠️ 与 `damageThreshold` 一样，它**不参与**「卸」的
   * `≤N` 判定（`flatBlocked` 只看 `damageThreshold`）—— 两者是
   * 两条独立的规则，谁也别猜谁。
   *
   * ⚠️ 多个来源**取 `amount` 最大的那一条**（与 `damageReduce` /
   * `damageThreshold` 同一条理由：相加会越过"完全免疫"，玩家无法预期）。
   */
  readonly flatDamageReduce?: {
    /** 平减多少点（「恶魔低语」当前是 5）。 */
    readonly amount: number;
    /** 保底：削完至少留多少（当前是 3）。⚠️ 上限是本来的伤害，不会加伤。 */
    readonly floor: number;
  };
  /**
   * **受到的伤害倍率**（`damageTakenMult`，基准 1）。
   *
   * ⚠️ 这个属性**声明了很久但没有任何引擎分支读它**（与 `ccImmune` /
   * `interruptImmune` 同一类病）。第一次真实消费者是「贪婪」的「弱点」
   * （"双方各挂一层，2 秒内受到的伤害翻倍"）与「嫉妒」的「见红」
   * （"受到的伤害 +30%"）—— 所以在 `computeDamage` 里接上。
   *
   * ⚠️ 它是**乘子**（`STAT_RULES` 里 `kind: 'multiplier'`，基准 1）：
   * `add 1` ⇒ ×2（翻倍）、`add 0.3` ⇒ ×1.3。
   */
  readonly damageTakenMult?: number;
}

/** 暴击判定结果。 */
export interface CritRoll {
  readonly crit: boolean;
  readonly multiplier: number;
}

/**
 * **未经防御侧减免的伤害**（"这一击值多少"）。
 *
 * ==================================================================
 * 为什么把它单独抽出来（这是「卸」的核心）
 * ==================================================================
 *
 * `damageThreshold` 的规则是：
 *
 * ```
 * 伤害 ≤ N  →  整击作废（连效果一起免）
 * 伤害 >  N  →  伤害 − N（效果照吃）
 * ```
 *
 * 两半都要求**先知道这一击的裸值**，再决定"作废"还是"平减"。
 * 而"算裸值"这件事 `computeDamage` 本来就会做 —— 所以这里把那段
 * 抽成纯函数，让两处**同源**：`flatBlocked` 用它判阈值（不消耗随机数），
 * `computeDamage` 用它算最终值。写两遍必然会漂（改增伤公式时漏一处，
 * 症状是"阈值判得不对"而完全看不出来）。
 *
 * ⚠️ 不含防御侧减免（`damageReduce` / `damageThreshold`），因为
 * **阈值就是拿它来判的** —— 把减免算进去会变成"减完再看够不够 15"，
 * 那是另一种规则。
 *
 * ⚠️ 含暴击与增伤/易伤：问的是"玩家实际吃到多少"，不是"Boss 面板多少"。
 * 当前内容 `canCrit` 全是 false，所以这条路径暂时不消耗随机数。
 */
export function preBlockDamage(
  spec: DamageSpec,
  casterStats: Readonly<Record<StatKey, number>>,
  roll: CritRoll,
): number {
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
  }
  return value;
}

/**
 * 这一击是否被**阈值**完全挡下（`≤N`）。
 *
 * ⚠️ 用的是 `roundDamage`（与最终伤害同一个取整口径）：`10.4` 这种
 * 值最终会结算成 10 点，那它就该按 10 判"≤15"，而不是按 10.4。
 * 口径不一致会出现"看起来 10 点却漏过卸力"。
 *
 * ⚠️ 多个效果时**任一**超过阈值就算没挡住（见 `resolveHit` 里的
 * "整次命中一个判据"说明）—— 那与"效果一起免"是同一件事的两面。
 *
 * @returns 阈值（0 = 没有这个 buff）与"是否完全挡下"。
 */
export function flatBlocked(
  specs: readonly DamageSpec[],
  casterStats: Readonly<Record<StatKey, number>>,
  flags: { readonly invulnerable?: boolean; readonly damageThreshold?: number },
  roll: CritRoll,
): boolean {
  const threshold = flags.damageThreshold ?? 0;
  if (threshold <= 0) return false;
  if (specs.length === 0) return false;
  return specs.every((spec) => roundDamage(preBlockDamage(spec, casterStats, roll)) <= threshold);
}

/**
 * 计算一次伤害。
 *
 * 公式（数据模型规范 §5）：
 *   raw    = (base + Σ stat × ratio)
 *   boosted= raw × (1 + damageBoost/100)
 *   mult   = damageMult（乘子型，已经是"要乘的数"）
 *   crit   = × critDamage（如果暴击）
 *   final  = max(0, floor(boosted × mult × crit × (1 - damageReduce)) − flatReduce)
 *
 * ⚠️ `flatReduce`（`damageThreshold` 的 `>N` 那一半）**最后才减**，
 * 减完再钳到 0：`30 − 15 = 15` 是玩家会心算的式子，而"先减再乘比例"
 * 会得到 `(30−15)×0.45 = 6.75` —— 那既不是需求写的规则，也没人算得清。
 *
 * 注意 `damageBoost` 除以 100：它是**累加器**，值 10 表示 +10%。
 * 这个单位约定在规范 §5.2 里写明了。
 */
export function computeDamage(
  spec: DamageSpec,
  casterStats: Readonly<Record<StatKey, number>>,
  targetFlags: DefenseFlags,
  roll: CritRoll,
): DamageResult {
  // 无敌：直接免伤（不发伤害，但要告诉调用方是"被规避"）
  if (targetFlags.invulnerable) {
    return {
      amount: 0,
      absorbed: 0,
      thinned: 0,
      crit: false,
      avoided: true,
      avoidReason: 'invulnerable',
    };
  }

  /**
   * ⚠️ `computeDamage` **只做 `>N` 的那一半**（平减 N）。
   *
   * `≤N` 的那一半（整击作废、**连效果一起免**）**不在这里判** ——
   * 它需要看"整次命中有哪些伤害效果"，而这里只拿到一个 `DamageSpec`。
   * 判定点是 `resolveHit`（它才有 `hit`），结论是 `avoided`，
   * 走的是无敌的同一条通路（于是"连眩晕一起免"是天然的）。
   *
   * ⚠️ **这个分工必须两边一致**：`flatBlocked` 返回 true 的那一击，
   * `resolveHit` 会**根本不调本函数**。所以这里不需要再处理 `≤N`——
   * 若哪天有人把 `≤N` 也塞进来，就会出现"既能整击作废、又算了一次平减"
   * 的双重结算（`tests/unit/playerKits.test.ts` 钉住了这两条）。
   */
  let value = preBlockDamage(spec, casterStats, roll);

  if (!spec.ignoreModifiers) {
    if (targetFlags.damageReduce) value *= 1 - targetFlags.damageReduce;
    /** 易伤 / 弱点（基准 1；`damageTakenMult` 是乘子型）。 */
    const taken = targetFlags.damageTakenMult ?? 1;
    if (taken !== 1) value *= taken;
  }

  const flatReduce = targetFlags.damageThreshold ?? 0;
  const afterFlat = flatReduce > 0 ? value - flatReduce : value;
  let rounded = roundDamage(afterFlat);

  /**
   * **平减**（`flatDamageReduce`：「恶魔低语」的"所有伤害 −5，保底 3"）。
   *
   * ⚠️ 位置就在**阈值之后、取整之前的那一步**：与 `damageThreshold` 是
   * 两条独立的规则（那条是「卸」，带"≤N 整击作废"的另一半，这条没有）。
   * 判据与"为什么不能复用"写在 `DefenseFlags.flatDamageReduce` 上。
   *
   * ⚠️ **保底不是加伤**：`min(afterThreshold, floor)` —— 本来只有 2 点的
   * 一击削完还是 2 点，不会因为"保底 3"变成 3。
   */
  const spill = targetFlags.flatDamageReduce;
  const spillAmount = spill !== undefined && spill.amount > 0 ? spill.amount : 0;
  if (spillAmount > 0 && rounded > 0) {
    const afterSpill = rounded - spillAmount;
    rounded = afterSpill > 0 ? afterSpill : Math.min(rounded, Math.max(0, spill?.floor ?? 0));
  }

  /**
   * `thinned` = "本来要打出来的"减去"实际打出来的"。
   *
   * ⚠️ 两个值都先过 `roundDamage` 再相减，而且**钳到规则承诺的上限**
   * （阈值 + 平减）：`15.9 − 15 = 0.9 → floor 0`（实际 0 点），
   * 若按浮点差算会得到 15.9 这种"挡掉的比规则还多"的数字。
   */
  const reduceBudget = flatReduce + spillAmount;
  const beforeFlat = reduceBudget > 0 ? roundDamage(value) : 0;
  const thinned = reduceBudget > 0 ? Math.min(reduceBudget, Math.max(0, beforeFlat - rounded)) : 0;

  return {
    amount: Math.max(0, rounded),
    absorbed: 0,
    thinned,
    crit: roll.crit,
    avoided: false,
  };
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
  tick: number,
  /** 是否由触发器产出的**反伤**（日志要标注）。 */
  reflect = false,
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
      absorbed: result.absorbed,
      thinned: result.thinned,
      overkill,
      skillId,
      ...(reflect ? { reflect: true } : {}),
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
