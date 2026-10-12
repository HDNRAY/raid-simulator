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

/**
 * 装备方案。
 *
 * ⚠️⚠️ **引擎目前没有消费者 —— 本类型是设计稿，不是可用的机制。**
 *
 * 全仓没有任何地方构造 `Loadout` 并把它交给引擎/内容注册表：注册用的
 * `entities` 是空数组，"装配"这一步不存在。所以 `items` 里放什么都不会
 * 影响战斗 —— 写了不会有报错，也不会有任何效果。
 *
 * 为什么**不删**：它是设计过但**还没实现**的系统（与"重复/陈旧"的死值
 * 性质不同），删掉会丢失设计。所以按"让代码与文档不再说谎"处理：
 * 保留形状 + 在这里和 `README` 里显式标注未实现。
 *
 * 已知与它配套但同样未接线的东西：`GameEntityInstance.pool`（离散计数器
 * 未实现，见 `resources.ts`）、`EquipmentEntity.grantsSkills`、
 * `EquipmentEntity` / `ConsumableEntity` / `PassiveEntity` 三种实体 kind、
 * `SkillBook` / `KnownSkill` 都没有运行期消费者。
 *
 * 真要实现，最小闭环需要：内容注册表接受 `entities` → 按 `items` 展开成
 * `passiveModifiers` / 已学技能表 → 一条单测证明"装上装备真的改变了数值"。
 */
export interface Loadout {
  readonly items: readonly GameEntityInstance[];
  readonly talents: readonly EntityId[];
  readonly skillBar: readonly SkillBarSlot[];
  readonly barSlotCount: number;
}
