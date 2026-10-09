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
        getCounter: () => 0,
      },
    });
  }
