/**
 * 熵之钟 —— 数据模型规范 §9 的完整走查内容。
 *
 * 这件奇物是**整个数据模型的验收样本**，它同时用到三种发射方式：
 *   1. `modifier`  被动加属性
 *   2. `derived`   根据属性增伤（带命名空间，可被别处引用）
 *   3. `trigger`   暴击后授予 buff，而 buff 的值**引用命名空间**
 *
 * 于是"动态重算"这条性质可以在这一件装备上被完整验证：
 * 智力一变，势能与涌动必须同时跟着变。
 */

import type { EquipmentEntity, Expr, StatModifier } from '../../core/types';

/** 效果 2 的命名空间。其他内容通过它引用"熵之钟当前的势能值"。 */
export const ENTROPY_CLOCK_POTENTIAL = 'entropy-clock.potential';
/** 暴击触发出来的 buff 的命名空间。 */
export const ENTROPY_CLOCK_SURGE = 'entropy-surge';

/** 每点智力提供多少增伤（累加器语义：0.10 表示每点智力 +0.10）。 */
export const POTENTIAL_PER_INTELLIGENCE = 0.1;

const potentialExpr: Expr = {
  e: 'mul',
  of: [
    { e: 'const', value: POTENTIAL_PER_INTELLIGENCE },
    { e: 'stat', who: 'self', stat: 'intelligence' },
  ],
};

/** 效果 2 的修正（导出以便校验器与测试直接引用）。 */
export const ENTROPY_CLOCK_POTENTIAL_MODIFIER: StatModifier = {
  stat: 'damageBoost',
  op: 'addPercent',
  value: potentialExpr,
  sourceKey: 'entity.entropyClock.name',
  namespace: ENTROPY_CLOCK_POTENTIAL,
  tier: 'item',
};

export const ENTROPY_CLOCK: EquipmentEntity = {
  id: 'entropy-clock',
  kind: 'equipment',
  nameKey: 'entity.entropyClock.name',
  descKey: 'entity.entropyClock.desc',
  icon: 'relic_entropy',
  slot: 'relic',
  rarity: 'legendary',
  // 可同时装备多份 —— 用来验证"多份同内容各自贡献"（G4）
  multiEquip: true,
  // ⚠️ 原先这里有 `tags: ['relic']` —— 全仓零消费者（`GameEntity.tags`
  // 已按"死值先删"删除），所以连同声明一起去掉。
  abilities: [
    // ── 效果 1：被动 +2 智力 / +2 精神 ──────────────────────────
    {
      kind: 'modifier',
      modifier: {
        stat: 'intelligence',
        op: 'add',
        value: 2,
        sourceKey: 'entity.entropyClock.name',
        tier: 'item',
      },
    },
    {
      kind: 'modifier',
      modifier: {
        stat: 'spirit',
        op: 'add',
        value: 2,
        sourceKey: 'entity.entropyClock.name',
        tier: 'item',
      },
    },

    // ── 效果 2：根据智力增伤（动态、可被引用） ────────────────
    {
      kind: 'derived',
      modifier: {
        stat: 'damageBoost',
        op: 'addPercent',
        sourceKey: 'entity.entropyClock.name',
        namespace: ENTROPY_CLOCK_POTENTIAL,
        tier: 'item',
      },
      value: potentialExpr,
    },

    // ── 效果 3：暴击后授予"势能涌动"，持续 10 秒 ──────────────
    {
      kind: 'trigger',
      trigger: {
        on: 'onCritDealt',
        filter: { by: 'self' },
        then: [
          {
            kind: 'grant',
            target: { mode: 'self' },
            buff: {
              id: 'entropy-surge',
              nameKey: 'buff.entropySurge.name',
              icon: 'buff_surge',
              polarity: 'buff',
              duration: 10_000,
              maxStacks: 1,
              stacking: { mode: 'refresh' },
              modifiers: [
                {
                  stat: 'damageBoost',
                  op: 'addPercent',
                  // 关键：不是写死的常量，而是"引用势能命名空间的当前值"。
                  // 这就是"动态重算"能成立的原因 —— 它是引用，不是快照。
                  value: { e: 'contrib', namespace: ENTROPY_CLOCK_POTENTIAL },
                  sourceKey: 'entity.entropyClock.sources.surge',
                  namespace: ENTROPY_CLOCK_SURGE,
                  tier: 'buff',
                },
              ],
            },
          },
        ],
      },
    },
  ],
};
