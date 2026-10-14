/**
 * **触发器引擎所需的上下文**（定义解析 + 三类落地动作）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一块是**触发器专用**的，与战斗状态机本身无关。留 `battleState.ts`
 * 里会把它顶过 700 行上限（AGENTS.md §3），而且每给触发器加一种能力
 * 都会再顶一次 —— 那种"每次加东西都要挤"的文件说明边界划错了。
 *
 * ==================================================================
 * ⚠️ 这里的每个动作都必须**复用底层管线**，不许另写一套
 * ==================================================================
 *
 * "反伤"如果自己算伤害，就会出现"只有反伤无视护甲 / 不触发飘字 / 不写
 * 日志"这类分歧，而那种分歧极难发现（数值看起来是对的）。
 * 所以三个动作分别走 `applyBuff` / `changeResource` /
 * `computeDamage` + `applyDamage` —— 与普通技能**完全同一条路**。
 */

import type { BuffDef, Combatant, EventDef, SkillDef } from '../types';
import { aggregateFlags, applyBuff } from '../buffs';
import { applyDamage, changeResource, computeDamage } from './index';
import type { HitPayload } from '../types/triggers';

/**
 * **按层削减某条 buff**（`RemoveBuffAbility.stacks` 用）—— 两个执行点共用。
 *
 * @param stacks 要减多少层；缺省 = **整条摘掉**（所有实例一起）
 * @returns 新的 buffs 数组 + 被**完全摘掉**的那些 `defId`（供补 `buffExpired`）
 *
 * ⚠️ 抽成纯函数而不是在两个执行点各写一遍：AGENTS.md §2 的"同一份算法
 * 只许有一个实现" —— 两份"都正确"的实现**也会漂**。
 */
export function reduceBuffStacks(
  buffs: Combatant['buffs'],
  buffId: string,
  stacks?: number,
): { readonly buffs: Combatant['buffs']; readonly expired: readonly string[] } {
  if (stacks === undefined) {
    const had = buffs.some((b) => b.defId === buffId);
    return { buffs: buffs.filter((b) => b.defId !== buffId), expired: had ? [buffId] : [] };
  }
  let left = Math.max(0, stacks);
  const expired: string[] = [];
  const out: Combatant['buffs'][number][] = [];
  for (const buff of buffs) {
    if (buff.defId !== buffId || left <= 0) {
      out.push(buff);
      continue;
    }
    const take = Math.min(buff.stacks, left);
    left -= take;
    const rest = buff.stacks - take;
    if (rest <= 0) expired.push(buffId);
    else out.push({ ...buff, stacks: rest });
  }
  return { buffs: out, expired };
}

import type { HitResolutionContext } from './hitResolution';

/**
 * `battleState` 能提供的东西（只声明真正用到的）。
 *
 * ⚠️ 用**最小接口**而不是直接依赖 `BattleEngine`：这样本文件不 import
 * `battleState`，不会形成 `battleState → triggerContext → battleState`
 * 的**值导入环**（本仓库为此踩过两次，表现是"某个 import 是 undefined"）。
 */
export interface TriggerHost {
  current(id: string): Combatant;
  replaceCombatant(updated: Combatant): void;
  /** 取某单位的当前属性（反伤要按攻击者的属性算）。 */
  statsOf(id: string): Readonly<Record<string, number>>;
  readonly events: EventDef[];
  /**
   * `battleState` 上那份给条件求值用的上下文（提供 `buffDef` / `skillDef` /
   * `currentTick`）。
   *
   * ⚠️ 复用它可以避免两处各写一遍完全相同的方法 —— 而"两处各写一遍"
   * 正是上次误删其中一份、81 个测试挂掉的原因。
   */
  readonly combat: {
    buffDef(id: string): BuffDef | undefined;
    skillDef(id: string): SkillDef | undefined;
    currentTick(): number;
  };
}

/** `triggerContextFor` 产出的那部分（触发器引擎按这些名字调用）。 */
export type TriggerContext = Pick<
  HitResolutionContext,
  | 'rollChance'
  | 'buffDef'
  | 'skillDef'
  | 'currentTick'
  | 'grantBuffFromTrigger'
  | 'removeBuffFromTrigger'
  | 'changeResourceFromTrigger'
  | 'dealDamageFromTrigger'
>;

/** 造出触发器引擎需要的那部分上下文。 */
export function triggerContextFor(host: TriggerHost, roll: () => number): TriggerContext {
  return {
    rollChance: roll,
    buffDef: (id) => host.combat.buffDef(id),
    skillDef: (id) => host.combat.skillDef(id),
    currentTick: () => host.combat.currentTick(),

    grantBuffFromTrigger: (target, def, sourceId, custom) => {
      const applied = applyBuff(
        host.current(target.id),
        custom === undefined ? def : { ...def, custom },
        sourceId,
        host.combat.currentTick(),
      );
      host.replaceCombatant({ ...host.current(target.id), buffs: applied.buffs });
      host.events.push({
        kind: 'buffApplied',
        tick: host.combat.currentTick(),
        targetId: target.id,
        buffId: def.id,
        stacks: applied.stacks,
        sourceId,
      });
    },

    /**
     * 移除一个 buff（按 `defId`，同 defId 的实例一起摘）。
     *
     * ⚠️ 与 `applyBuff` 的"复用实例"相反：这里**按 defId 过滤**，
     * 所以 `independent` 叠层的多个实例也会一起清掉 —— 这正是
     * "清零"要的语义（引擎里已有一处同源实现：`EffectKind: 'removeBuff'`）。
     */
    removeBuffFromTrigger: (target, buffId, stacks) => {
      const current = host.current(target.id);
      if (!current.buffs.some((b) => b.defId === buffId)) return;
      /**
       * ⚠️ `stacks` 给了就**只减那么多层**（减到 0 的实例摘掉）——
       * 那是「暴怒」的"每 2 秒 −1 层"要的语义；不给就整条摘掉（原样）。
       */
      const { buffs, expired } = reduceBuffStacks(current.buffs, buffId, stacks);
      host.replaceCombatant({ ...current, buffs });
      for (const id of expired) {
        host.events.push({
          kind: 'buffExpired',
          tick: host.combat.currentTick(),
          targetId: target.id,
          buffId: id,
          stacks: 0,
          sourceId: target.id,
        });
      }
    },

    changeResourceFromTrigger: (target, resource, delta) => {
      const result = changeResource(host.current(target.id), resource, delta, host.combat.currentTick());
      host.replaceCombatant(result.combatant);
      host.events.push(...result.events);
    },

    /**
     * 触发器造成的一次伤害（反伤）。
     *
     * ⚠️ `crit: false`：反伤**不做暴击判定**，因此**不消耗随机数** ——
     * 否则"哪一次攻击会暴击"会取决于前面有没有触发过反伤，重放会变得
     * 很难推理（与 `rollCrit` 的短路规则同一考虑）。
     */
    dealDamageFromTrigger: (actorId, targetId, hit) => {
      for (const effect of hit.effects) {
        if (effect.kind !== 'damage' || !effect.damage) continue;
        const target = host.current(targetId);
        const result = computeDamage(
          effect.damage,
          host.statsOf(actorId),
          aggregateFlags(target),
          { crit: false, multiplier: 1 },
        );
        /**
         * ⚠️ 最后两个参数：`skillId: ''`（**不是技能打的**）+
         * `reflect: true`（日志要标注"反伤"）。
         *
         * 不标的话日志里反伤和普通伤害长得一样（都是"受到 18 伤害"），
         * 玩家会以为 Boss 有个自己不知道的 18 点技能。
         */
        const applied = applyDamage(target, result, actorId, '', host.combat.currentTick(), true);
        host.replaceCombatant(applied.combatant);
        host.events.push(...applied.events);
      }
    },
  };
}

/** 供 `hitResolution` 构造派发载荷用（避免它 import 两处）。 */
export type { HitPayload };
