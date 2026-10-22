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
  activeHold?: { readonly skillId: string; readonly drainDebt?: number } | undefined;
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
/**
 * 这一批动作的**默认执行者**：活着的那一个我方单位。
 *
 * ⚠️ **不要在调用处写死 `'player'`**（2026-10-22 实测的真 bug）：
 * 出战单位的 id 就是**角色 id**（`makePlayer('daixuan')` ⇒ `'daixuan'`），
 * 所以写死 `'player'` 时，黛玄 / 凯丽的每一个动作都落在一个**不存在的 id** 上：
 * `current()` 会退化到"第一个战斗者的临时可变副本"（不进 `work`），
 * 于是**写着成功、实际被丢弃**。
 *
 * 症状是"按住「弹」炁一点不掉"：`activeHold` 写在那个临时副本上，
 * 下一次 tick 就没了 ⇒ `tickHolds` 永远没有可扣的东西。
 * `tick()` 原来就是 `actorId ?? 'player'`，现在改成把 `undefined` 直接
 * 交给 `applyActions`（由本函数按阵营推断）。
 */
export function defaultActorIdOf(combatants: readonly Combatant[]): string {
  const ally = combatants.find((c) => c.side === 'ally' && c.alive);
  return (ally ?? combatants[0])?.id ?? 'player';
}

/**
 * 把 `who`（`'self'` / `'caster'` / 其它 id）解析成实际的 combatant。
 *
 * ⚠️ 从 `battleState.ts` 搬出来（纯函数，只看 `combatants`；那个文件顶在
 * 700 行上限上，AGENTS.md §3 要求"拆 util"而不是压注释）。
 *
 * 兜底顺序是 `对手 → 自己 → 第一个单位 → undefined`：调用点都在 tick
 * 热路径上，宁可给出一个可解释的结果，也不要抛错。
 */
export function resolveCombatantIn(
  combatants: readonly Combatant[],
  selfId: string,
  who: string,
): Combatant {
  if (who === 'self' || who === 'caster') {
    return combatants.find((c) => c.id === selfId) ?? nonNull(combatants[0]);
  }
  const self = combatants.find((c) => c.id === selfId);
  const opponent = combatants.find((c) => c.side !== self?.side);
  return opponent ?? self ?? nonNull(combatants[0]);
}

/**
 * 把"数组下标取出来的 `T | undefined`"收成 `T`。
 *
 * ⚠️ 与 AGENTS.md §1 不冲突：那条禁的是 `as any` / `as unknown as`
 * （**关闭**类型检查的断言）。这里用的是 `!`，它只让编译器"相信调用方
 * 的不变量"——而这个不变量（`combatants` 非空）由引擎的构造保证，
 * 旧代码在同样位置用的也是 `!`。名字写出来是为了让"这里有一个未经验证的
 * 假设"在调用点上是**可见的**，而不是一个散落的标点。
 */
function nonNull<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('resolveCombatantIn: combatants is empty');
  }
  return value;
}

/**
 * **对手**（另一侧的第一个单位）。单挑场景里就是那唯一一个敌人。
 *
 * ⚠️ 从 `battleState.ts` 搬出来（AGENTS.md §3：拆 util，**不压注释**）：
 * 它是**纯函数**（只看 `combatants`），而那个文件顶在 700 行上限上。
 *
 * 判据是 `side !== self.side` —— 找不到自己时 `self` 是 `undefined`，
 * 于是取第一个单位（与 `defaultActorIdOf` 的兜底同一条：宁可给出一个
 * 可解释的结果，也不要抛错 —— 调用点都在 tick 热路径上）。
 */
export function opponentOf(
  combatants: readonly Combatant[],
  id: string,
): Combatant | undefined {
  const self = combatants.find((c) => c.id === id);
  return combatants.find((c) => c.side !== self?.side);
}
