/**
 * 属性计算与 Boss 狂暴。
 *
 * ==================================================================
 * 为什么从 `battleState.ts` 里搬出来
 * ==================================================================
 *
 * `battleState.ts` 有 1580 行（AGENTS.md §3）。这一段约 105 行，
 * 而且是**纯查询 + 一处状态改动**，与施法/命中那些流程无关：
 *
 *   computeStatsFor    把基础属性 + 修正 + buff 合成最终属性（唯一实现）
 *   statsOf / statsBreakdownOf   两个查询入口（都走上面那个）
 *   applyEnrage        进入狂暴：挂一个增伤 buff
 *   enrageBuff         构造那个 buff 的定义（**纯函数**，不碰状态）
 *
 * 依赖用 `StatsContext` 写清楚（见 `hitResolution.ts` 的同名说明）。
 */

import type {
  BuffDef,
  BuffInstance,
  Combatant,
  ResourceKey,
  StatKey,
  StatModifier,
  Who,
} from '../types';
import type { CreateBattleOptions } from './battleState';
import { applyBuff } from '../buffs';
import { computeStats, type StatBreakdown } from '../stats/pipeline';

/** 属性计算需要的引擎能力。 */
export interface StatsContext {
  /** 当前 tick */
  readonly tick: number;
  /** 全部战斗者（`computeStatsFor` 要按 id 找） */
  readonly combatants: readonly Combatant[];
  /** 内容注册表（基础属性、被动修正、buff 定义） */
  readonly options: CreateBattleOptions;
  current(id: string): Combatant;
  replaceCombatant(updated: Combatant): void;
  /** 解析 `who` 指向的战斗者（`computeStatsFor` 的 resourceAccess 要它） */
  resolveCombatantFor(combatantId: string, who: string): Combatant;
  /** 发"狂暴开始"事件 */
  pushEnrageStarted(bossId: string): void;
}

/** 属性为空时的占位（避免每次分配新对象）。 */
const EMPTY_STATS = {} as Readonly<Record<StatKey, number>>;

export function enrageBuff(dmgMult: number): BuffDef {
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

export function applyEnrage(ctx: StatsContext, boss: Combatant): void {
    const behavior = boss.behaviors.find((b) => b.kind === 'enrage');
    const mult = behavior?.kind === 'enrage' ? behavior.dmgMult : 2;
    const applied = applyBuff(
      ctx.current(boss.id),
      enrageBuff(mult),
      boss.id,
      ctx.tick,
    );
    ctx.replaceCombatant({ ...ctx.current(boss.id), buffs: applied.buffs });
    ctx.pushEnrageStarted(boss.id);
  }

export function statsOf(
  ctx: StatsContext,
  combatantId: string,
): Readonly<Record<StatKey, number>> {
    return computeStatsFor(ctx, combatantId, false, ctx.options).values;
  }

export function statsBreakdownOf(
  ctx: StatsContext,
  id: string,
): Readonly<Partial<Record<StatKey, StatBreakdown>>> | undefined {
    return computeStatsFor(ctx, id, true, ctx.options).breakdown;
  }

export function computeStatsFor(
  ctx: StatsContext,
  combatantId: string,
  wantBreakdown: boolean,
  options: CreateBattleOptions,
): { values: Readonly<Record<StatKey, number>>; breakdown?: Readonly<Partial<Record<StatKey, StatBreakdown>>> } {
    const combatant = ctx.combatants.find((c: Combatant) => c.id === combatantId);
    if (!combatant) return { values: EMPTY_STATS };

    const modifiers: StatModifier[] = [
      ...(options.passiveModifiers.get(combatantId) ?? []),
    ];

    // 把 buff 的修正展开进来，并带上 buffId 作为命名空间
    for (const buff of combatant.buffs) {
      const def = buff.def ?? options.buffs.get(buff.defId);
      if (!def?.modifiers) continue;
      /**
       * ⚠️ **按层展开**（每层推一条修正），不是一个实例只贡献一次。
       *
       * ==================================================================
       * 为什么（2026-10-14，用户点名）
       * ==================================================================
       *
       * 原先这里**不展开**：一个 buff 实例的 `modifiers` 无论几层都只贡献
       * 一次。于是"每层 +1 点/秒回血"这种写法**静默地只生效一份** ——
       * 懒惰的「怠惰」涨到 9 层却只回 1 点/秒（实测过）。
       *
       * 用户的原始口径本来就是**按层**：
       *   - 懒惰："**回血先按最大 9 层**"
       *   - 贪婪："9 层、**每层**全面一点点（回血 / 全技能伤害 / 读条时间）"
       *
       * ⚠️ 与 `damageMultBoost` 的展开（本文件下面那段）是同一条规则，
       * 只是那条是"每层乘"，这条是"照 `op` 走"：
       *   - `op: 'add'` ⇒ 每层各加一次（`+1` × 9 层 = `+9`）
       *   - `op: 'mult'` ⇒ 每层各乘一次 ⇒ **指数**（`×2` × 9 层 = `512`）
       *     后者正是懒惰要的 `2^层数`。
       *
       * ⚠️ `Math.max(1, …)`：层数恒 ≥ 1，写成它是为了"万一"（与
       * `damageMultBoost` 那段的写法保持一致）。
       */
      for (let i = 0; i < Math.max(1, buff.stacks); i += 1) {
        for (const modifier of def.modifiers) {
          modifiers.push(
            modifier.namespace ? modifier : { ...modifier, namespace: buff.defId },
          );
        }
      }
    }

    const stackLookup = (key: string): number => {
      let total = 0;
      for (const buff of combatant.buffs) {
        if (buff.defId === key) total += buff.stacks;
      }
      return total === 0 ? 1 : total;
    };

    /**
     * `BuffDef.damageMultBoost` → `damageMult` 修正。
     *
     * ⚠️ **这个字段声明了很久但没有任何引擎分支读它** —— 也就是说
     * "狂暴（`dmgMult`）"与「贪婪」的「敛财」（每层 +10%）都**从来没生效过**。
     * 与 `ccImmune` / `interruptImmune` / `damageTakenMult` 是同一类病
     * （看起来支持、其实静默无效），这次一起接上。
     *
     * ⚠️ `op: 'mult'` 而不是 `add`：`damageMult` 是**乘子**型
     * （`aggregate` 里乘法型贡献按 ∏ 累积），而"每层 +10%"要的正是
     * **逐层相乘**（9 层 ≈ ×2.36，不是 ×1.9）。buff 的层数由
     * `stackCount` 展开（`perStackAdd` 的语义）。
     */
    for (const buff of combatant.buffs) {
      const def = buff.def ?? options.buffs.get(buff.defId);
      const boost = def?.damageMultBoost;
      if (def === undefined || boost === undefined) continue;
      /**
       * ⚠️ **每层推一条**，而不是"一条带层数"。
       *
       * 因为"每层 +10%"要的是**逐层相乘**（1.1^n），而一条
       * `op:'perStackAdd'` 走的是 `value × stacks` 再**相加**
       * （`1 + Σ`）—— 9 层会得到 ×10.9 而不是 ×2.36。`mult` 的语义是
       * ∏，所以"N 条 1.1"正好是 1.1^N。
       */
      for (let i = 0; i < Math.max(1, buff.stacks); i += 1) {
        modifiers.push({
          stat: 'damageMult',
          op: 'mult',
          value: boost,
          sourceKey: def.nameKey,
          namespace: buff.defId,
        });
      }
    }

    return computeStats({
      base: options.baseStats.get(combatantId) ?? {},
      modifiers,
      wantBreakdown,
      stackCount: stackLookup,
      evaluateCondition: () => true,
      resourceAccess: {
        getResource: (who: Who, resource: ResourceKey) =>
          ctx.resolveCombatantFor(combatantId, who).resources[resource],
        getMaxResource: (who: Who, resource: ResourceKey) =>
          ctx.resolveCombatantFor(combatantId, who).caps[resource],
        getBuffStacks: (who: Who, buffId: string) =>
          ctx.resolveCombatantFor(combatantId, who).buffs
            .filter((b: BuffInstance) => b.defId === buffId)
            .reduce((sum: number, b: BuffInstance) => sum + b.stacks, 0),
        getBuffCustom: (who: Who, buffId: string) =>
          ctx.resolveCombatantFor(combatantId, who).buffs
            .filter((b: BuffInstance) => b.defId === buffId)
            .reduce((sum: number, b: BuffInstance) => sum + (b.custom ?? 0), 0),
        /**
         * ⚠️ **未实现的桩**：离散计数器还没有接线，所以这里恒返回 0。
         *
         * 这就是"写 `counter` 表达式会静默算错"的来源。当前的防线是
         * **校验层**：`validate.ts` 的 `COUNTER_UNIMPLEMENTED` 拒绝任何
         * 用到 `Expr.counter` 的内容，所以这句话不会被合法内容读到。
         * 实现时把这里换成真的池子查询，并删掉那条校验。
         */
        getCounter: () => 0,
      },
    });
  }
