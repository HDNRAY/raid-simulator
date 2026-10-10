/** 技能簿、装备方案与实例。 */

import type { BuffId, EntityId, SkillId } from './ids';
import type { ResourcePool } from './resources';

/* ================================================================== *
 * 10. 实例与装备方案
 * ================================================================== */

export interface GameEntityInstance {
  readonly instanceId: string;
  readonly defId: EntityId;
  /** 内容实例自己的资源池（使用次数、充能） */
  readonly pool: ResourcePool;
  /**
   * 每个实例独立的技能冷却。
   *
   * 旧项目把冷却存在角色身上，于是**两个物品共享同一个技能冷却会互相打架**
   * （装两件同样有主动技能的奇物，按一个另一边也进 CD）。
   */
  readonly cooldowns: Record<SkillId, number>;
  /** 附魔 / 词条等随机化变体（仅装备类） */
  readonly affixes?: readonly string[];
  readonly equippedAt?: number;
}

/** 技能来源，用于 UI 显示"这个技能是哪来的"。 */
export type SkillOrigin =
  | { readonly kind: 'innate' }
  | { readonly kind: 'talent'; readonly talentId: EntityId }
  | { readonly kind: 'item'; readonly entityInstanceId: string; readonly entityId: EntityId }
  | { readonly kind: 'buff'; readonly buffId: BuffId };

export interface KnownSkill {
  readonly skillId: SkillId;
  readonly origin: SkillOrigin;
  /** 数字大的赢（innate 100 > talent 60 > item 40 > buff 20） */
  readonly priority: number;
}

export interface SkillBarSlot {
  readonly index: number;
  readonly key: string;
  readonly skillId: SkillId | null;
}

export interface SkillBook {
  readonly known: readonly KnownSkill[];
  readonly bar: readonly SkillBarSlot[];
  readonly barSlotCount: number;
}

export interface Loadout {
  readonly items: readonly GameEntityInstance[];
  readonly talents: readonly EntityId[];
  readonly skillBar: readonly SkillBarSlot[];
  readonly barSlotCount: number;
}
