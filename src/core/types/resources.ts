/** 资源：计数池与引用。 */

import type { CombatantId } from './ids';

/* ================================================================== *
 * 2. 资源
 * ================================================================== */

/** 具名资源。有上限、会回复的那几种。 */
/**
 * 具名资源。
 *
 * 只有两种玩家资源：**缠**（短循环、衰减快，用于常规技能）
 * 与**炁**（积攒型，用于高威力技能）。
 * 刻意不做"魔法值"——多一种资源只会让 UI 与循环都更啰嗦。
 */
export type ResourceKey = 'hp' | 'energy' | 'douqi';

/**
 * 离散计数器（使用次数、充能、弹药……）。
 *
 * 使用次数做成资源而不是独立字段（数据模型规范 §2.2）：
 * "用 1 次的药水"就是 `uses: { current: 1, max: 1 }`，
 * 于是消耗、回复、UI 显示、事件全部复用同一套机制。
 */
export interface Counter {
  readonly current: number;
  readonly max: number;
}

/** 任何实例都可以有自己的资源池。 */
export interface ResourcePool {
  readonly hp?: number;
  readonly energy?: number;
  readonly douqi?: number;
  /** 自定义离散资源，键名由内容作者定义（'uses' / 'charges' / 'ammo' …） */
  readonly counters?: Readonly<Record<string, Counter>>;
}

/** 资源池的引用：角色的 / 内容实例自己的 / 整场共享的。 */
export type ResourcePoolRef =
  | { readonly kind: 'combatant'; readonly combatantId: CombatantId }
  | { readonly kind: 'entity'; readonly entityInstanceId: string }
  | { readonly kind: 'encounter' };
