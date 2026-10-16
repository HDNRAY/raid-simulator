/**
 * Buff / Debuff 系统。
 *
 * 数据模型规范 §6：**Buff 与 Debuff 是同一个模型**，`polarity` 只影响 UI 颜色。
 * 一个"受到更多伤害"的效果，从施加者看是 debuff，从目标看只是一条
 * `vulnerability` 修正 —— 修正本身没有正负，只有方向。
 *
 * ------------------------------------------------------------------
 * 本模块是"用 buff 实现判定窗口"那一套的落地处
 * ------------------------------------------------------------------
 *
 * **已实现**（全部落在这里，零新引擎机制）：
 *   闪避   duration:300  + flags.invulnerable
 *   卸力   duration:1500 + flags.damageReduce:0.6
 *   限制   倒地用 flags.restrictToTags（只能闪避）
 *
 * ⚠️ **下面两条是设计意图，目前没做**，别把它们当成已有能力：
 *   派生   技能 A 挂 comboWindow buff；技能 B 的 requires 检查它
 *          （`content.ts` 里 `requires:` 0 处、没有 buff 定义 comboWindow）
 *   GCD    施放后挂 gcd buff —— **这条已经过时**：公共冷却后来被删掉了，
 *          现在限速靠**读条时长**本身（见 `castPipeline` 里的说明）。
 *          `viewHelpers` 里还留着 `gcd` 的死分支（`INTERNAL_BUFF_IDS`
 *          与 `blockKeyOf`），因为没有任何 buff 会再产生那个 id。
 *
 * ------------------------------------------------------------------
 * 数值纪律：过期用**截止 tick**，不用已过时长
 * ------------------------------------------------------------------
 *
 * `remaining -= dt` 每帧减会让误差 O(N·ε) 累积（架构规范 §12.2）。
 * 这里存 `expiresAtTick`，判断是整数比较，永不漂移。
 */

import type { BuffDef, BuffFlags, BuffId, BuffInstance, Combatant, SkillTag } from '../types';

/**
 * **消费机制**（"用掉就消耗"等四种触发）实现搬到了 `./consume.ts`。
 *
 * 拆出去的理由是 AGENTS.md §3 的关注分离：本文件是"施加 / 过期 / 查询"
 * （buff 的**生命周期由时间驱动**），而消费是另一件事
 * （**生命周期由战斗事件驱动**）。两者唯一的交集是"都要改
 * `combatant.buffs`"，而那只是一行 `filter`。
 *
 * ⚠️ 这里**转发**它们，所以 `from '../buffs'` 的写法照旧可用
 * （`core/combat/` 与测试都这么 import）。
 */
export {
  applyConsume,
  consumeFactsFor,
  matchedConsumeTriggers,
} from './consume';
export type { ConsumeFacts, ConsumeOutcome } from './consume';

/** 施加 buff 的结果：新的 buff 列表 + 发生了哪种变化（供发事件）。 */
export interface ApplyBuffResult {
  readonly buffs: readonly BuffInstance[];
  readonly change: 'applied' | 'refreshed' | 'stackChanged' | 'replaced' | 'ignored';
  readonly stacks: number;
}

/** 把 duration（ms）换算成 tick 数。 */
function durationToTicks(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(durationMs / (1000 / 60)));
}

/**
 * 找一个"可被叠加/刷新"的已有实例。
 *
 * `independent` 模式下**永远返回 undefined** —— 那个模式的语义就是
 * "每次施加都是一个新实例"，所以它不走"复用已有实例"这条路，
 * 而是由下面的分支单独处理上限。
 */
function findExisting(
  buffs: readonly BuffInstance[],
  def: BuffDef,
): BuffInstance | undefined {
  if (def.stacking.mode === 'independent') return undefined;
  return buffs.find((b) => b.defId === def.id);
}

let instanceCounter = 0;

/**
 * 生成实例 id。
 *
 * 注意：**不用 `Math.random`**（C2 约束），也不用 `uuid`（依赖外部包）。
 * 用递增计数器 + defId 即可保证唯一 —— 计数器只在单次战斗内递增，
 * 而战斗状态本身是可重放的，所以这不会破坏确定性。
 */
function nextInstanceId(defId: BuffId): string {
  instanceCounter += 1;
  return `${defId}#${instanceCounter}`;
}

/** 仅供测试与重开战斗时重置计数器。 */
export function resetBuffInstanceCounter(): void {
  instanceCounter = 0;
}

/**
 * 施加一个 buff，按 `stacking` 规则决定叠加方式。
 *
 * 六种规则（数据模型规范 §6.1）：
 *   refresh      刷新时长，层数不变（默认）
 *   stack        加层，封顶
 *   stackRefresh 加层 + 刷新时长
 *   independent  各自独立计时（同 defId 多实例）
 *   replace      新顶替旧
 *   extend       时长叠加（有上限）
 */
export function applyBuff(
  combatant: Combatant,
  def: BuffDef,
  sourceId: string,
  currentTick: number,
): ApplyBuffResult {
  const durationTicks = durationToTicks(def.duration);
  const expiresAtTick =
    durationTicks === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : currentTick + durationTicks;

  // 独立模式**不走"复用已有实例"这条路**，必须在查表之前分流。
  // （踩过的坑：把这段放进下面的 switch 里，会被 !existing 的提前 return 吃掉，
  //   于是上限永远不生效。）
  if (def.stacking.mode === 'independent') {
    const max = Math.max(1, def.stacking.max);
    const instance: BuffInstance = {
      instanceId: nextInstanceId(def.id),
      defId: def.id,
      stacks: 1,
      appliedAtTick: currentTick,
      expiresAtTick,
      sourceId,
      def,
      triggerCooldowns: {},
      triggerCounts: {},
      ...(def.absorbValue === undefined ? {} : { absorb: def.absorbValue }),
      ...(def.custom === undefined ? {} : { custom: def.custom }),
    };
    const existingIndependent = combatant.buffs.filter((b) => b.defId === def.id);
    if (existingIndependent.length >= max) {
      // 到达上限：替换最早施加的那个
      const oldest = existingIndependent.reduce((a, b) =>
        a.appliedAtTick <= b.appliedAtTick ? a : b,
      );
      return {
        buffs: [...combatant.buffs.filter((b) => b !== oldest), instance],
        change: 'replaced',
        stacks: 1,
      };
    }
    return { buffs: [...combatant.buffs, instance], change: 'applied', stacks: 1 };
  }

  const existing = findExisting(combatant.buffs, def);

  if (!existing) {
    const instance: BuffInstance = {
      instanceId: nextInstanceId(def.id),
      defId: def.id,
      stacks: 1,
      appliedAtTick: currentTick,
      expiresAtTick,
      sourceId,
      def,
      triggerCooldowns: {},
      triggerCounts: {},
      ...(def.absorbValue === undefined ? {} : { absorb: def.absorbValue }),
      ...(def.custom === undefined ? {} : { custom: def.custom }),
    };
    return { buffs: [...combatant.buffs, instance], change: 'applied', stacks: 1 };
  }

  const rule = def.stacking;
  switch (rule.mode) {
    case 'refresh': {
      const updated: BuffInstance = { ...existing, expiresAtTick };
      return {
        buffs: replaceInstance(combatant.buffs, updated),
        change: 'refreshed',
        stacks: existing.stacks,
      };
    }

    case 'stack':
    case 'stackRefresh': {
      const max = Math.max(1, rule.max);
      const stacks = Math.min(max, existing.stacks + 1);
      const updated: BuffInstance = {
        ...existing,
        stacks,
        // stack 模式不刷新时长；stackRefresh 刷新
        expiresAtTick: rule.mode === 'stackRefresh' ? expiresAtTick : existing.expiresAtTick,
      };
      const changed = stacks !== existing.stacks;
      return {
        buffs: replaceInstance(combatant.buffs, updated),
        change: changed ? 'stackChanged' : 'refreshed',
        stacks,
      };
    }

    case 'replace': {
      const cleared = combatant.buffs.filter((b) => b.defId !== def.id);
      const instance: BuffInstance = {
        instanceId: nextInstanceId(def.id),
        defId: def.id,
        stacks: 1,
        appliedAtTick: currentTick,
        expiresAtTick,
        sourceId,
        def,
        triggerCooldowns: {},
        triggerCounts: {},
        ...(def.absorbValue === undefined ? {} : { absorb: def.absorbValue }),
      ...(def.custom === undefined ? {} : { custom: def.custom }),
      };
      return { buffs: [...cleared, instance], change: 'replaced', stacks: 1 };
    }

    case 'extend': {
      const maxTicks = durationToTicks(rule.maxDurationMs);
      const cap =
        maxTicks === Number.POSITIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : existing.appliedAtTick + maxTicks;
      const extended = Math.min(cap, existing.expiresAtTick + durationTicks);
      const updated: BuffInstance = { ...existing, expiresAtTick: extended };
      return {
        buffs: replaceInstance(combatant.buffs, updated),
        change: 'refreshed',
        stacks: existing.stacks,
      };
    }
  }
}

function replaceInstance(
  buffs: readonly BuffInstance[],
  updated: BuffInstance,
): readonly BuffInstance[] {
  return buffs.map((b) => (b.instanceId === updated.instanceId ? updated : b));
}

/**
 * 移除 buff（驱散 / 主动取消）。
 *
 * 使用次数、层数归零等情况由调用方决定是否走这里。
 */
export function removeBuff(combatant: Combatant, buffId: BuffId): readonly BuffInstance[] {
  return combatant.buffs.filter((b) => b.defId !== buffId);
}

/** 按实例 id 移除（`independent` 模式下需要）。 */
export function removeBuffInstance(
  combatant: Combatant,
  instanceId: string,
): readonly BuffInstance[] {
  return combatant.buffs.filter((b) => b.instanceId !== instanceId);
}

/** 哪些 buff 在这一 tick 过期。返回新的列表与过期的 defId。 */
export function expireBuffs(
  buffs: readonly BuffInstance[],
  currentTick: number,
): { readonly buffs: readonly BuffInstance[]; readonly expired: readonly BuffId[] } {
  const expired: BuffId[] = [];
  const kept: BuffInstance[] = [];
  for (const buff of buffs) {
    if (buff.expiresAtTick <= currentTick) expired.push(buff.defId);
    else kept.push(buff);
  }
  return { buffs: kept, expired };
}

/* ------------------------------------------------------------------ *
 * 查询
 * ------------------------------------------------------------------ */

/** 某个 buff 的总层数（同 defId 多实例时求和）。 */
export function buffStacks(combatant: Combatant, buffId: BuffId): number {
  let total = 0;
  for (const buff of combatant.buffs) {
    if (buff.defId === buffId) total += buff.stacks;
  }
  return total;
}

export function hasBuff(combatant: Combatant, buffId: BuffId): boolean {
  return combatant.buffs.some((b) => b.defId === buffId);
}

/** 还有多久过期（ms）。不存在或永久返回 Infinity。 */
export function buffRemainingMs(
  combatant: Combatant,
  buffId: BuffId,
  currentTick: number,
): number {
  const buff = combatant.buffs.find((b) => b.defId === buffId);
  if (!buff) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(buff.expiresAtTick)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (buff.expiresAtTick - currentTick) * (1000 / 60));
}

/**
 * 汇总所有生效 buff 的判定旗标。
 *
 * **这是判定层的输入**：hit 结算时看 `invulnerable` / `damageReduce` /
 * `damageThreshold`，施法时看 `actionLock` 与 `restrictToTags`。
 *
 * ⚠️ `comboWindow`（派生）**还没有使用者** —— 见文件头。
 *
 * 多个来源的 `damageReduce` / `damageThreshold` 都用"取最大值"而不是相加：
 * 相加会让两层 60% 减伤变成 120%（超过免疫），而且玩家无法预期。
 */
export function aggregateFlags(combatant: Combatant): BuffFlags {
  let invulnerable = false;
  let damageReduce = 0;
  let damageThreshold = 0;
  /**
   * 平减（「恶魔低语」）—— **取 `amount` 最大的那一条**，与
   * `damageReduce` / `damageThreshold` 同一条理由（相加会越过"完全免疫"）。
   */
  let flatDamageReduce: { readonly amount: number; readonly floor: number } | undefined;
  let noDouqiOnHitTaken = false;
  let ccImmune = false;
  let interruptImmune = false;
  let actionLock = false;
  /**
   * 荆棘（`reflectFraction`）—— **多个来源取最大值**。
   *
   * ⚠️ 与 `damageReduce` / `damageThreshold` 同一条理由：相加会越过
   * "完全反弹"，而且玩家无法预期（两层 50% 变成 100% 是没人能想到的）。
   */
  let reflectFraction = 0;
  /** 「睡眠」的两个出路旗标（取**任意一个来源**即可，不做叠加）。 */
  let movesWhileLocked = false;
  let sleepReduceMs = 0;
  const comboWindow: string[] = [];
  /**
   * 技能 tag 白名单 —— 多个来源取**并集**。
   *
   * 并集而不是交集：两层限制叠加时，玩家能按的技能应该是"任一条允许
   * 的"，否则会出现"两个 buff 各自放行一批，结果一个都按不了"。
   */
  const restrictToTags: SkillTag[] = [];

  for (const buff of combatant.buffs) {
    const def = buff.def;
    if (!def?.flags) continue;
    const f = def.flags;
    if (f.invulnerable) invulnerable = true;
    if (f.damageReduce !== undefined) damageReduce = Math.max(damageReduce, f.damageReduce);
    if (f.damageThreshold !== undefined) {
      damageThreshold = Math.max(damageThreshold, f.damageThreshold);
    }
    if (f.flatDamageReduce !== undefined) {
      if (flatDamageReduce === undefined || f.flatDamageReduce.amount > flatDamageReduce.amount) {
        flatDamageReduce = f.flatDamageReduce;
      }
    }
    if (f.noDouqiOnHitTaken === true) noDouqiOnHitTaken = true;
    if (f.ccImmune) ccImmune = true;
    if (f.interruptImmune) interruptImmune = true;
    if (f.actionLock) actionLock = true;
    if (f.movesWhileLocked === true) movesWhileLocked = true;
    if (f.sleepReduceMs !== undefined) sleepReduceMs = Math.max(sleepReduceMs, f.sleepReduceMs);
    if (f.reflectFraction !== undefined) {
      reflectFraction = Math.max(reflectFraction, f.reflectFraction);
    }
    if (f.comboWindow) comboWindow.push(...f.comboWindow);
    if (f.restrictToTags) restrictToTags.push(...f.restrictToTags);
  }

  return {
    ...(invulnerable ? { invulnerable: true } : {}),
    ...(damageReduce > 0 ? { damageReduce } : {}),
    ...(damageThreshold > 0 ? { damageThreshold } : {}),
    ...(flatDamageReduce === undefined ? {} : { flatDamageReduce }),
    ...(noDouqiOnHitTaken ? { noDouqiOnHitTaken: true } : {}),
    ...(ccImmune ? { ccImmune: true } : {}),
    ...(interruptImmune ? { interruptImmune: true } : {}),
    ...(actionLock ? { actionLock: true } : {}),
    ...(movesWhileLocked ? { movesWhileLocked: true } : {}),
    ...(sleepReduceMs > 0 ? { sleepReduceMs } : {}),
    ...(reflectFraction > 0 ? { reflectFraction } : {}),
    ...(comboWindow.length > 0 ? { comboWindow } : {}),
    ...(restrictToTags.length > 0 ? { restrictToTags } : {}),
  };
}

/**
 * 某个技能是否在派生窗口内可用。
 *
 * ⚠️ **机制未实现，这个函数目前只有测试在调**（生产代码零调用）。
 *
 * 保留它是为了固定设计意图：**派生 = buff 存在性判断，不需要新引擎
 * 机制** —— 真正做派生时，技能 B 加一个 `requires: hasBuff(...)` 即可。
 */
export function isInComboWindow(combatant: Combatant, skillId: string): boolean {
  return aggregateFlags(combatant).comboWindow?.includes(skillId) ?? false;
}

/* ------------------------------------------------------------------ *
 * 把战斗单位的 buff 展开成修正池
 * ------------------------------------------------------------------ */

export interface BuffModifierSource {
  readonly modifier: import('../types').StatModifier;
  /** 层数（`perStackAdd` 会用到） */
  readonly stacks: number;
  readonly buffId: BuffId;
}

/**
 * 把 combatant 身上所有 buff 的修正展开成扁平数组。
 *
 * 展开时必须**给每条修正补上 namespace = buffId**，
 * 否则 `contrib` 引用不到它、`perStackAdd` 也拿不到层数。
 */
export function expandBuffModifiers(
  combatant: Combatant,
  defs: ReadonlyMap<BuffId, BuffDef>,
): readonly BuffModifierSource[] {
  const out: BuffModifierSource[] = [];

  for (const buff of combatant.buffs) {
    const def = defs.get(buff.defId) ?? buff.def;
    if (!def?.modifiers) continue;
    for (const modifier of def.modifiers) {
      out.push({
        // 每条修正带上 buffId 作为命名空间，保证 contrib 能引用到
        modifier: modifier.namespace ? modifier : { ...modifier, namespace: buff.defId },
        /**
         * ⚠️ `independent` 叠层下同一个 defId 会有**多个实例**，每个各带
         * 一条修正 —— 于是修正被展开 N 次（是"线性叠加"，不是"取最大"）。
         *
         * 那不是"顺手就支持"的能力：本仓库的修正池语义是"同 namespace 的
         * 修正按 `STAT_RULES` 聚合"，把同一份修正复制 N 份的表达在两个
         * 概念上都说不通。所以 `validate.ts` 对"`independent` 且带
         * `modifiers`"的 buff **报错拦下**（`INDEPENDENT_BUFF_MODIFIERS`）——
         * 要让每层提供修正，用 `stack` / `stackRefresh`（那是它们的定义）。
         */
        stacks: buff.stacks,
        buffId: buff.defId,
      });
    }
  }

  return out;
}
