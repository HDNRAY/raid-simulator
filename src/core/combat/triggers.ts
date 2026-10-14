/**
 * **触发器引擎**：在战斗的既定时机派发 hook，执行挂在其上的能力。
 *
 * ==================================================================
 * 为什么需要它（动手前它是空的）
 * ==================================================================
 *
 * `TriggerDef` 一直有**完整的类型定义与数据校验**，但引擎里**没有任何地方
 * 执行它**：`onHitTaken` 等 hook 只是在 `types/triggers.ts` 里被声明，
 * 没有派发点，仓库里也没有一个内容用过触发器。
 *
 * 「欲望印记」（受伤 → 挂印记 → 印记期间再受伤则反伤）是这个引擎的
 * **第一个使用者**。所以它不是"给反伤写的特例"，而是一套通用机制。
 *
 * ==================================================================
 * ⚠️ 为什么只在"结算已完成"的点派发，不在结算中途插入
 * ==================================================================
 *
 * 中途派发的后果是"反伤 → 又触发反伤 → 再触发…"这类嵌套链**在整个战斗里
 * 到处都可能发生**，很难保证不死循环。而"结算完再派发"天然只有一层，
 * 嵌套深度有上界（见 `DEPTH_LIMIT`）。
 *
 * ⚠️ 但**反伤触发的伤害本身仍要派发一次** `onHitTaken`（设计决定：
 * 反伤算受击）。这是必要的 —— 否则"挨了反伤的人"不会收到受击事件。
 * 它靠两道防线终止：
 *   1. 玩家侧没有同款反伤触发器（内容层面终止）
 *   2. `DEPTH_LIMIT`（机制层面兜底，防止将来内容写出环）
 */

import type { Ability, Combatant, TargetRule, TriggerDef } from '../types';
import type { HitResolutionContext, HitPayload } from './hitResolution';
import { evaluateCondition } from './index';

/**
 * 嵌套深度上限。
 *
 * ⚠️ 这是**兜底**，不是主要的防循环手段 —— 主要靠内容层面不构成环。
 * 取 4 的理由：正常的反伤链只有 1 层（我打你 → 反伤我），留一点余量给
 * 将来"反伤的反伤"这类设计，同时任何环都会在 4 层内被截断并记录下来。
 */
const DEPTH_LIMIT = 4;

/**
 * 本引擎**实际会派发**的 hook（走进 `runTriggers` 的那些）。
 *
 * ⚠️ 只有这 5 个。其余 hook（`onCritTaken` / `onAvoided` / `onKill` …）
 * 类型还在、内容也能写，但引擎**不认** —— 它们会静默无效。
 *
 * ⚠️ 注意 `onCastFinish` **不在**这张表里，但它**是活的**：
 * 技能能力里的 `onCastFinish` 触发器由 `castPipeline` 的读条完成结算
 * 直接处理（不走 `runTriggers`）。所以"引擎会处理的 hook"比这张表更大 ——
 * 完整的集合在 `content/capabilityAudit.ts` 的 `SUPPORTED_HOOKS`
 * （校验器拿它拒绝内容里的死 hook）。
 *
 * 两张表的关系由 `tests/unit/content.test.ts` 断言（单向：本表 ⊆ 那张表）。
 */
export const SUPPORTED_HOOKS: readonly string[] = [
  /**
   * ⚠️ 2026-10-14 新增（「贪婪」的「弱点」是第一个消费者）。
   *
   * 它由 `upkeep.runUpkeep` 对**每个活着的战斗者**每逻辑步派发一次，
   * 而"多久真的一次"由触发器自己的 `cooldownMs` / `cooldownRangeMs`
   * 管 —— 所以"按时间、随机间隔"这两件事都不用引擎再懂一遍。
   */
  'onTick',
  'onHitTaken',
  'onCritDealt',
  'onBuffApplied',
  'onBuffExpired',
];

/** 某个 hook 是否真的会被派发。 */
export function isSupportedHook(hook: string): boolean {
  return SUPPORTED_HOOKS.includes(hook);
}

/** 派发时携带的上下文（不同 hook 的载荷不同）。 */
export interface TriggerPayload extends HitPayload {
  /** 递归深度（由派发方维护，调用者不要传）。 */
  readonly depth?: number;
}

/**
 * 运行 owner 身上**所有**匹配 `hook` 的触发器。
 *
 * @returns 实际触发了几个（便于测试与诊断）
 */
export function runTriggers(
  ctx: HitResolutionContext,
  ownerId: string,
  hook: string,
  payload: TriggerPayload = {},
): number {
  const depth = payload.depth ?? 0;
  if (depth >= DEPTH_LIMIT) return 0;
  if (!isSupportedHook(hook)) return 0;

  const owner = ctx.current(ownerId);
  const tick = ctx.state.tick;
  let fired = 0;

  /**
   * ⚠️ 遍历前先**快照** buff 列表与它们的 cooldown 记录。
   *
   * 触发器会改状态（挂 buff、扣血），而"执行一个触发器时它在列表里的位置
   * 是否还有效"取决于实现细节。先取一份静态清单，行为只取决于**触发时刻**
   * 的状态 —— 这也让重放更可解释。
   */
  const sources = owner.buffs
    .map((buff) => ({ buff, def: buff.def }))
    .filter((entry) => entry.def?.triggers !== undefined);

  for (const { buff, def } of sources) {
    const triggers = def?.triggers ?? [];
    for (let i = 0; i < triggers.length; i += 1) {
      const trigger = triggers[i];
      if (trigger === undefined || trigger.on !== hook) continue;

      const key = triggerKey(trigger, i);
      /** 内建 CD：防抖（设计里反伤给 1s）。 */
      if ((buff.triggerCooldowns[key] ?? 0) > tick) continue;
      /** 整场次数上限。 */
      if (trigger.maxTriggersPerEncounter !== undefined) {
        const left = buff.triggerCounts[key] ?? trigger.maxTriggersPerEncounter;
        if (left <= 0) continue;
      }

      /**
       * `when` 用**触发者自己**作为主语求值（`who` 缺省即 self）。
       * `other` 传对手，这样 `who: 'target'` 也能写。
       */
      if (trigger.when !== undefined) {
        const other = ctx.opponentOf(ownerId);
        if (!evaluateCondition(ctx.current(ownerId), trigger.when, ctx, other)) continue;
      }

      if (trigger.chance !== undefined) {
        if (trigger.chance <= 0) continue;
        /** ⚠️ `>= 1` 时短路，**不消耗随机数** —— 与 `rollCrit` 的规则一致。 */
        if (trigger.chance < 1) {
          if (roll(ctx) >= trigger.chance) continue;
        }
      }

      /**
       * 记 CD 与次数**必须在执行前**：执行本身会改 buff 列表（可能把
       * 印记消耗掉），之后再找这条记录就找不到了。
       */
      /**
       * 记 CD：固定值（`cooldownMs`）或**现掷一个区间内的值**
       * （`cooldownRangeMs`，「贪婪」的「弱点」用后者）。
       *
       * ⚠️ 掷点走 `ctx.rollInt`（种子化），所以重放仍然逐位可复现；
       * 而它**只在真的触发时**才掷（不是每 tick 掷），随机数消耗的顺序
       * 仍由内容决定。
       */
      const cdMs =
        trigger.cooldownRangeMs !== undefined
          ? rollRangeMs(ctx, trigger.cooldownRangeMs)
          : trigger.cooldownMs;
      if (cdMs !== undefined && cdMs > 0) {
        ctx.replaceCombatant(
          withTriggerState(ctx, ownerId, (b) =>
            b.instanceId === buff.instanceId
              ? {
                  ...b,
                  triggerCooldowns: {
                    ...b.triggerCooldowns,
                    [key]: tick + Math.round(cdMs / (1000 / 60)),
                  },
                }
              : b,
          ),
        );
      }
      if (trigger.maxTriggersPerEncounter !== undefined) {
        ctx.replaceCombatant(
          withTriggerState(ctx, ownerId, (b) =>
            b.instanceId === buff.instanceId
              ? {
                  ...b,
                  triggerCounts: {
                    ...b.triggerCounts,
                    [key]: (b.triggerCounts[key] ?? trigger.maxTriggersPerEncounter ?? 0) - 1,
                  },
                }
              : b,
          ),
        );
      }

      runAbilities(ctx, ownerId, trigger.then, { ...payload, depth: depth + 1 });
      fired += 1;
    }
  }

  return fired;
}

/**
 * 触发器在 `triggerCooldowns` / `triggerCounts` 里的键。
 *
 * ⚠️ 用**下标**而不是 `on`：同一个 buff 上两条 `onHitTaken` 是合法的
 * （例如"第一次受伤挂印记、第二次反伤"这种将来可能的设计），
 * 用 `on` 当键会让它们互相覆盖，表现为"只有一条生效"。
 */
function triggerKey(trigger: TriggerDef, index: number): string {
  return `${trigger.on}#${index}`;
}

/** 就地更新某个 buff 的触发器状态。 */
function withTriggerState(
  ctx: HitResolutionContext,
  ownerId: string,
  update: (b: Combatant['buffs'][number]) => Combatant['buffs'][number],
): Combatant {
  const owner = ctx.current(ownerId);
  return { ...owner, buffs: owner.buffs.map(update) };
}

/** 概率判定（走种子化 RNG）。 */
function roll(ctx: HitResolutionContext): number {
  return ctx.rollChance();
}

/**
 * 从一个 `[min, max]` 区间里现掷一个毫秒值（含两端）。
 *
 * ⚠️ `min > max` 时交换（内容写反了不该崩，也不该得到一个越界值）；
 * 两者相等 ⇒ 退化成固定值。
 */
function rollRangeMs(
  ctx: HitResolutionContext,
  range: readonly [number, number],
): number {
  const lo = Math.min(range[0], range[1]);
  const hi = Math.max(range[0], range[1]);
  if (hi <= lo) return lo;
  return lo + ctx.rollInt(hi - lo + 1);
}

/* ------------------------------------------------------------------ *
 * 执行触发器产出的能力
 * ------------------------------------------------------------------ */

/**
 * 执行一组能力。
 *
 * ⚠️ 只实现**触发器真的会用到**的那几类，其余显式忽略。
 * 写一个"什么都能执行"的通用器等于把结算管线复制一遍，而那种重复几乎
 * 必然与 `castPipeline` / `hitResolution` 的规则漂移。
 *
 * 落地动作全部**委托给 ctx**（由 `battleState` 提供，复用现成的
 * `applyBuff` / `changeResource` / 伤害结算），本文件不自己碰状态。
 */
function runAbilities(
  ctx: HitResolutionContext,
  ownerId: string,
  abilities: readonly Ability[],
  payload: TriggerPayload,
): void {
  for (const ability of abilities) {
    switch (ability.kind) {
      case 'grant': {
        const who = whoOf(ctx, ownerId, ability.target, payload);
        if (who !== undefined) ctx.grantBuffFromTrigger(ctx.current(who), ability.buff, ownerId);
        break;
      }

      case 'resource': {
        const who = whoOf(ctx, ownerId, ability.target, payload);
        if (who !== undefined) {
          const delta = typeof ability.delta === 'number' ? ability.delta : 0;
          ctx.changeResourceFromTrigger(ctx.current(who), ability.resource, delta);
        }
        break;
      }

      /**
       * 移除一个 buff（按 `defId`）—— 「懒惰」的「怠惰」用"挨打清零"。
       * ⚠️ 它**不是** `EffectKind: 'removeBuff'`（那是命中的效果）；
       * 这里是**能力**（触发器产出的动作），所以走 `ctx` 的落地入口。
       */
      case 'removeBuff': {
        const who = whoOf(ctx, ownerId, ability.target, payload);
        if (who !== undefined) ctx.removeBuffFromTrigger(ctx.current(who), ability.buffId);
        break;
      }

      case 'deal': {
        const who = whoOf(ctx, ownerId, ability.target, payload);
        if (who !== undefined) ctx.dealDamageFromTrigger(ownerId, who, ability.hit);
        break;
      }

      /**
       * ⚠️ `modifier` / `derived` / `consume` / `grantSkill` / `trigger`
       * 在本引擎里**不生效**（静默）。
       *
       * 前四类是"持续存在"或"改技能池"的语义，与"某一刻发生"的触发器
       * 不匹配（`consume` / `grantSkill` 是设计过但还没接线的能力，
       * 见 `types/abilities.ts`）；`trigger` 是嵌套触发器，本期不做
       * （没有内容需要它）。这里只保证运行时不崩。
       */
      default:
        break;
    }
  }
}

/**
 * 解析目标规则 —— 返回**单位 id**。
 *
 * ⚠️ 只实现触发器会用到的：`self` / `owner` → 触发器持有者；
 * `primaryEnemy` → 其对手（"反伤打回去"就是这条）。
 * 群体目标在"受伤触发"的语境里没有意义，返回 `undefined` 让调用方跳过 ——
 * 硬实现只会引入没人验证过的分支。
 */
function whoOf(
  ctx: HitResolutionContext,
  ownerId: string,
  rule: TargetRule,
  _payload: TriggerPayload,
): string | undefined {
  switch (rule.mode) {
    case 'self':
    case 'owner':
      return ownerId;
    case 'primaryEnemy':
      return ctx.opponentOf(ownerId)?.id;
    default:
      return undefined;
  }
}
