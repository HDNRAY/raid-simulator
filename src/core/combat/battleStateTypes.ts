/**
 * 引擎内部的**可变战斗者**类型 + 只读快照 → 工作副本的转换。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `battleState.ts` 超过 700 行（AGENTS.md §3），拆出去的
 * `hitResolution.ts` / `castPipeline.ts` 都要这个类型。
 *
 * ⚠️ 如果它们从 `battleState.ts` import，就形成"子模块反向依赖
 * 主模块"的环 —— 所以必须待在两边都能向下依赖的地方。
 */

import type { CastInstance, Combatant } from '../types';

/**
 * tick 内的工作副本类型：把 `Combatant` 的 readonly 去掉。
 *
 * 只用于引擎内部；对外暴露的 `BattleState` 仍然是 readonly 的
 * （快照不可被渲染层改坏）。
 */
export interface MutableCombatant {
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
export function toMutable(combatant: Combatant): MutableCombatant {
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

/**
 * 为一个 tick 建立**工作副本集**（浅拷贝 + 需要改的容器深拷贝一层）。
 *
 * 引擎的 `work` map 本身仍是它的私有字段（那是状态），
 * 但"怎么造这份副本"是**纯函数**，没有理由留在 700+ 行的文件里。
 *
 * ⚠️ 逐字段复制那段曾经在本文件和 `toMutable` 里**各写了一份** ——
 * 两处必须永远一致（都是"哪些容器要深拷一层"的知识），
 * 所以这里直接复用 `toMutable`，不再重复一遍。
 */
export function createWorkSet(combatants: readonly Combatant[]): Map<string, MutableCombatant> {
  const work = new Map<string, MutableCombatant>();
  for (const combatant of combatants) work.set(combatant.id, toMutable(combatant));
  return work;
}

/**
 * 开战时的资源钳制：非负、不超上限、取整。
 *
 * ⚠️ 与 `snapshot` 的注释同一个理由 —— 直接从 `battleState.ts` 搬过来
 * 是因为那个文件顶在 AGENTS.md §3 的 700 行上限上，而这是**纯函数**：
 * 它不碰引擎的任何状态，待在"类型 + 纯工具"的文件里比待在引擎类里合适。
 *
 * ⚠️ 上限用 `caps[key]` 而不是 `capOf(...)`：`capOf` 在 `./index`，
 * 从这里 import 会造出 `index → battleState → battleStateTypes → index`
 * 的值导入环（`data/scale.ts` 顶部记过这类环导致 `undefined` 的坑）。
 */
export function clampStart(combatant: Combatant): Combatant['resources'] {
  const out = { ...combatant.resources };
  for (const key of ['hp', 'energy', 'douqi'] as const) {
    const cap = combatant.caps[key] ?? out[key];
    out[key] = Math.max(0, Math.min(cap, Math.round(out[key])));
  }
  return out;
}

/**
 * 默认施法者：第一个存活的我方单位（没有则取第一个单位，再没有就 `'player'`）。
 *
 * 从 `battleState.ts` 搬出来：它是**纯函数**（只看 `combatants`），
 * 而那个文件顶在 700 行上限上 —— 移出纯逻辑而不是压注释。
 */
export function defaultActorIdOf(combatants: readonly Combatant[]): string {
  const ally = combatants.find((c) => c.side === 'ally' && c.alive);
  return (ally ?? combatants[0])?.id ?? 'player';
}
