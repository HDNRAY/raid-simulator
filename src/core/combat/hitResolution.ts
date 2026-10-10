/**
 * 命中结算：**把一次 hit 的效果落到战斗状态上**。
 *
 * ==================================================================
 * 为什么从 `battleState.ts` 里搬出来
 * ==================================================================
 *
 * `battleState.ts` 有 1513 行（AGENTS.md §3）。这一块约 185 行，
 * 是一个**自成一体的阶段**：
 *   伤害 / 治疗 / 暴击 / 霸体拦打断 / 资源改动 / 授予 buff
 *
 * 它原先夹在施法流程与 AI 之间，读者要在一千多行里来回跳。
 *
 * ==================================================================
 * 为什么用 context 接口而不是继续做类方法
 * ==================================================================
 *
 * 这些函数**必须**触碰引擎内部（读状态、发事件、改战斗者）。
 * 但"必须触碰"不等于"必须是它的方法"：
 *
 * 用一个**显式声明的窄接口**把它们需要的那几件事写清楚，好处是
 *   1. 依赖变成**可见的** —— 读接口就知道这一阶段碰了什么
 *   2. 引擎仍独占状态（单一真相来源没变），只是把"怎么算"借出去
 *
 * ⚠️ 接口里每个成员都是真实用到的，没有"以后可能要用"的预留。
 */

import type {
  CastInstance,
  Combatant,
  EventDef,
  DamageSpec,
  Effect,
  HitDef,
  SkillDef,
  StatKey,
} from '../types';
import { aggregateFlags, applyBuff } from '../buffs';
import { applyDamage, applyHeal, changeResource, computeDamage, computeHeal } from './index';
import type { BattleState } from '../types';

/** 命中结算阶段需要的引擎能力。 */
export interface HitResolutionContext {
  /** 当前战斗状态 */
  readonly state: BattleState;
  /** 事件出口（引擎的事件数组 —— 结算会往里 push） */
  readonly events: EventDef[];
  current(id: string): Combatant;
  replaceCombatant(updated: Combatant): void;
  opponentOf(id: string): Combatant | undefined;
  statsOf(combatantId: string): Readonly<Record<StatKey, number>>;
  rollCrit(stats: Readonly<Record<StatKey, number>>, damage: DamageSpec): boolean;
  gainDouqiFromDamage(combatantId: string, damage: number, tick: number): void;
  pushBuffApplied(targetId: string, buffId: string, stacks: number): void;
}

export function resolveHit(
  ctx: HitResolutionContext,
  actor: Combatant,
  skill: SkillDef,
  hit: HitDef,
): void {
    const target = ctx.opponentOf(actor.id);
    if (!target) return;

    const casterStats = ctx.statsOf(actor.id);
    const victimFlags = aggregateFlags(target);

    for (const effect of hit.effects) {
      switch (effect.kind) {
        case 'damage': {
          if (!effect.damage) break;
          /**
           * 暴击判定。
           *
           * ⚠️ 这里长期是硬编码 `crit: false` —— 也就是说引擎**从未做过
           * 暴击判定**，`critChance` 是个死属性，而熵之钟的
           * "暴击后翻倍"触发因此永远不会发生。
           *
           * 抽成 `rollCrit` 而不是内联，是为了让"消耗随机数"这件事
           * 只在一个地方发生 —— 重放的确定性完全取决于它。
           */
          const crit = ctx.rollCrit(casterStats, effect.damage);
          const result = computeDamage(
            effect.damage,
            casterStats,
            victimFlags,
            { crit, multiplier: crit ? 1 + (casterStats.critDamage ?? 0) : 1 },
          );
          // 命中本身也会触发"授予 buff"类效果（例如 Boss 给自己挂前摇标记）
          applyHitEffects(ctx, actor, target, effect, skill.id);
          const applied = applyDamage(
            ctx.current(target.id),
            result,
            actor.id,
            skill.id,
            effect.damage.school,
            ctx.state.tick,
          );
          ctx.replaceCombatant(applied.combatant);
          ctx.events.push(...applied.events);

          /**
           * 炁按伤害换算：**造成伤害的人**与**受到伤害的人**各得一份。
           * 放在这里（而不是内容里）才能覆盖所有伤害来源。
           */
          if (result.amount > 0) {
            ctx.gainDouqiFromDamage(actor.id, result.amount, ctx.state.tick);
            ctx.gainDouqiFromDamage(target.id, result.amount, ctx.state.tick);
          }
          break;
        }
        case 'heal': {
          if (!effect.damage) break;
          const amount = computeHeal(effect.damage, casterStats, { crit: false, multiplier: 1 });
          const healed = applyHeal(ctx.current(actor.id), amount, actor.id, false, ctx.state.tick);
          ctx.replaceCombatant(healed.combatant);
          ctx.events.push(...healed.events);
          break;
        }
        default:
          applyHitEffects(ctx, actor, target, effect, skill.id);
          break;
      }
    }
  }

  /** 非伤害类效果（授予 buff / 改资源 / 打断）。 */
export function applyHitEffects(
  ctx: HitResolutionContext,
  actor: Combatant,
  target: Combatant,
  effect: Effect,
  /** 触发这个效果的技能 —— `cooldown` 效果默认调它自己的冷却。 */
  skillId?: string,
): void {
    if (effect.kind === 'grantBuff' && effect.buff) {
      const who = effect.target?.mode === 'self' ? actor : target;
      const applied = applyBuff(ctx.current(who.id), effect.buff, actor.id, ctx.state.tick);
      ctx.replaceCombatant({ ...ctx.current(who.id), buffs: applied.buffs });
      ctx.events.push({
        kind: 'buffApplied',
        tick: ctx.state.tick,
        targetId: who.id,
        buffId: effect.buff.id,
        stacks: applied.stacks,
        sourceId: actor.id,
      });
      return;
    }

    if (effect.kind === 'removeBuff') {
      /**
       * 移除 buff。
       *
       * 用途：**派生技消耗掉它自己的开启条件**。
       * 没有这一步时，`combo-window` 在窗口期内可被反复利用，
       * 派生技会完全取代基础技（实测 152 次派生 vs 38 次基础）。
       * 移除之后，一次基础技只能换来一次派生。
       */
      const buffId = effect.buff?.id ?? effect.buffId;
      if (buffId) {
        const who = effect.target?.mode === 'self' ? actor : target;
        const current = ctx.current(who.id);
        if (current.buffs.some((b) => b.defId === buffId)) {
          ctx.replaceCombatant({
            ...current,
            buffs: current.buffs.filter((b) => b.defId !== buffId),
          });
          ctx.events.push({
            kind: 'buffExpired',
            tick: ctx.state.tick,
            targetId: who.id,
            buffId,
            stacks: 0,
            sourceId: actor.id,
          });
        }
      }
      return;
    }

    if (effect.kind === 'resource' && effect.resource) {
      const delta = typeof effect.resource.delta === 'number' ? effect.resource.delta : 0;
      const result = changeResource(ctx.current(actor.id), effect.resource.key, delta, ctx.state.tick);
      ctx.replaceCombatant(result.combatant);
      ctx.events.push(...result.events);
      return;
    }

    if (effect.kind === 'cooldown') {
      /**
       * 调整某个技能的冷却。
       *
       * 需求（「截」）："如果成功，不进入 cd，失败则 cd 10 秒" ——
       * 施放时已经扣了 10 秒，成功后这里**减去**同样的量即"不进 CD"。
       *
       * ⚠️ 直接改 `combatant.cooldowns` 而不是挂一个"加 CD"的 buff：
       * 那样冷却状态会分裂成两处（真实 CD 与 buff），而 UI 的冷却圈
       * 与 gate 的判定都读真实 CD，就会显示不一致。
       *
       * ⚠️ 下限钳到 `tick`：冷却语义是"`readyAt <= tick` 即可用"
       * （见 `checkGate`），所以减到"现在"就是"已就绪"，再小没有意义
       * —— 而且负值会让 UI 的剩余比例算出负数。
       */
      const who = ctx.current(actor.id);
      const which = effect.skillId ?? skillId;
      if (which !== undefined) {
        const readyAt = who.cooldowns[which];
        if (readyAt !== undefined) {
          const delta = effect.cooldownMs ?? 0;
          ctx.replaceCombatant({
            ...who,
            cooldowns: {
              ...who.cooldowns,
              [which]: Math.max(ctx.state.tick, readyAt + delta),
            },
          });
        }
      }
      return;
    }

    if (effect.kind === 'interrupt') {
      /**
       * **霸体（`interruptImmune`）拦截一切打断，包括「破」的强制打断。**
       *
       * 需求：所有 Boss 招式默认都能被打断 / 闪避 / 格挡，
       * 除非 Boss 处于霸体状态 —— 霸体由一个有 CD 的招式给自己挂上。
       *
       * 这里刻意**不看 `effect.force`**：`force` 的语义是"无视技能的
       * 可打断标记"，但霸体是**更上层的状态**，它必须连强制打断也挡住，
       * 否则霸体招式就没有意义了。
       *
       * 踩过的坑：`BuffFlags.interruptImmune` 早就定义了、`aggregateFlags`
       * 也一直在算它，但**没有任何地方读它** —— 一个"看起来支持但实际
       * 不生效"的字段。接上它比新造一个 flag 好：语义更准，
       * 而且不用动数据模型。
       */
      if (aggregateFlags(target).interruptImmune) {
        ctx.events.push({
          kind: 'interruptImmune',
          tick: ctx.state.tick,
          targetId: target.id,
          // 记录"本来会被打断的那个读条"，供 UI 提示用
          skillId: target.casts[0]?.skillId ?? '',
        });
        return;
      }

      if (target.casts.length > 0) {
        /**
         * `force: true` 时**不看可打断性** —— 这是「破」的语义
         * （需求：可以打断任何技能）。默认仍尊重目标技能的可打断性。
         */
        const interrupted = effect.force
          ? [...target.casts]
          : target.casts.filter((c: CastInstance) => c.interruptible);
        if (interrupted.length > 0) {
          const interruptedIds = new Set(interrupted.map((c: CastInstance) => c.skillId));
          ctx.replaceCombatant({
            ...ctx.current(target.id),
            casts: ctx.current(target.id).casts.filter(
              (c: CastInstance) => !interruptedIds.has(c.skillId),
            ),
          });
          for (const cast of interrupted) {
            ctx.events.push({
              kind: 'castInterrupted',
              tick: ctx.state.tick,
              sourceId: target.id,
              skillId: cast.skillId,
              reason: 'interrupted',
            });
            ctx.events.push({
              kind: 'interruptSuccess',
              tick: ctx.state.tick,
              sourceId: actor.id,
              targetId: target.id,
              skillId: cast.skillId,
            });
          }
          /**
           * **真打断到了** → 结算 `onSuccess`。
           *
           * 需求（「截」）："瞬发，打断 boss 技能，**如果成功**，不进入 cd"。
           *
           * ⚠️ 只有走到这里才算成功。上面两条早返回都是失败：
           *   - `interruptImmune`（霸体）→ return
           *   - 目标没在读条 / 读条不可打断 → 不进这个分支
           * 正好对应需求里的"失败则 cd 10 秒"（CD 是施放时就扣的，
           * 不退还就自然留着）。
           */
          applyEffects(ctx, actor, target, effect.onSuccess, skillId);
        }
      }
    }
  }

  /**
   * 结算一组效果（供 `onSuccess` 链式递归用）。
   *
   * 抽出来是因为 `applyHitEffects` 里已经有一层 `if` 链，
   * 再嵌一层 `for` + 递归会让那个函数难以阅读。
   */
  function applyEffects(
    ctx: HitResolutionContext,
    actor: Combatant,
    target: Combatant,
    effects: readonly Effect[] | undefined,
    skillId: string | undefined,
  ): void {
    if (effects === undefined) return;
    for (const next of effects) applyHitEffects(ctx, actor, target, next, skillId);
  }
