/**
 * **按住型技能**的生命周期 + 「炁」的伤害换算。
 *
 * ==================================================================
 * 为什么从 `battleState.ts` 里搬出来
 * ==================================================================
 *
 * `battleState.ts` 有 1028 行（AGENTS.md §3）。这一段约 115 行，
 * 是**一块独立的机制**：
 *
 *   startHold / endHold / tickHolds   按住型技能的施放、松手、逐逻辑步扣费
 *   gainDouqiFromDamage               "造成/承受伤害都换炁"的换算
 *
 * ⚠️ 它**不碰工作副本**（`work` map）：`current()` 本来就是 work-aware
 * 的（先查工作副本、没有才回落到 state），所以"一次 tick 内所有读写
 * 走同一个副本"这条约定由 `current` / `replaceCombatant` 继续保证 ——
 * 原先的 `this.work?.get(id)` 是冗余的。
 *
 * 依赖用 `HoldsContext` 写清楚（见 `hitResolution.ts` 的同名说明）。
 */

import type { BuffDef, Combatant, EventDef, SkillDef } from '../types';
import { DOUQI_PER_INTERNAL_DAMAGE } from '../../data/balance';
import { LOGIC_TICKS_PER_SECOND, TICKS_PER_LOGIC_TICK } from '../loopConstants';
import { changeResource } from './index';

/**
 * 按住消耗的**欠账标度**（欠账以 1/DRAIN_SCALE 点为单位存整数）。
 *
 * 为什么需要它：`holdDrain.perLogicTick` 允许是小数（「卸」是 `0.3`
 * = 3 炁/秒 ÷ 10 步）。而 `changeResource` 的结算是
 * `Math.round(before + delta)` —— 每步扣 0.3 会被舍回原值，**一点不扣**，
 * 而且是静默的。
 *
 * 所以每步只把 `Math.round(perLogicTick * DRAIN_SCALE)` 记进欠账
 * （0.3 → 300，整数），攒够一整个 `DRAIN_SCALE` 才真的扣 1 点。
 * 全程整数：浮点累加 10 次 0.3 得到的是 `2.9999999999999996`，
 * "按住 1 秒 = 3 炁"会差 1 点。
 *
 * ⚠️ 取 1000 是为了给内容留出比 0.1 更细的代价（`0.001`/步）；
 * 它同时决定了"代价能表达到几位小数"。
 */
const DRAIN_SCALE = 1000;

/**
 * 按住消耗的**显示口径**：每逻辑步 → 每秒。
 *
 * 设置页（`app/keyRows.ts`）与技能栏（`app/viewAdapter.ts`）都用它，
 * 于是"界面写的数"永远等于"引擎按 `perLogicTick` 扣的数 × 每秒步数"，
 * 不存在两边各写一个 3 的可能 —— 这次的 10 倍偏差就是显示与实现
 * 各写各的造成的（见 `docs/specs/2026-10-12-player-kits.md` §9）。
 */
export function holdDrainPerSecond(drain: {
  readonly perLogicTick: number;
}): number {
  return drain.perLogicTick * LOGIC_TICKS_PER_SECOND;
}

/** 按住型技能需要的引擎能力。 */
export interface HoldsContext {
  readonly tick: number;
  /** 全部战斗者（`tickHolds` 要遍历） */
  readonly combatants: readonly Combatant[];
  readonly skills: ReadonlyMap<string, SkillDef>;
  readonly buffs: ReadonlyMap<string, BuffDef>;
  readonly events: EventDef[];
  current(id: string): Combatant;
  replaceCombatant(updated: Combatant): void;
  /** 真正施放一个技能（按住型的首次施放走它） */
  tryUseSkill(skillId: string, actorId: string): void;
}

export function startHold(
  ctx: HoldsContext,
  skillId: string,
  actorId: string,
): void {
    const actor = ctx.current(actorId);
    if (!actor) return;
    const skill = ctx.skills.get(skillId);
    if (!skill?.holdDrain) {
      // 不是按住型技能 → 退化成普通施放，这样输入层不必区分两种技能
      ctx.tryUseSkill(skillId, actorId);
      return;
    }
    if (actor.activeHold?.skillId === skillId) return;

    ctx.tryUseSkill(skillId, actorId);
    const after = ctx.current(actorId);
    if (!after) return;
    // 只有施放真的成功（身上有它授予的 buff）才进入按住状态
    const granted = skill.abilities.some(
      (a) => a.kind === 'grant' && after.buffs.some((b) => b.defId === a.buff.id),
    );
    if (!granted) return;
    /**
     * 欠账从 0 起算：同一个技能重复按下会被上面的 `activeHold` 判断挡掉，
     * 所以这里是"一次新的按住"，不能继承上一次的欠账。
     */
    ctx.replaceCombatant({ ...after, activeHold: { skillId, drainDebt: 0 } });
  }

export function endHold(
  ctx: HoldsContext,
  skillId: string,
  actorId: string,
): void {
    const actor = ctx.current(actorId);
    if (!actor) return;
    if (actor.activeHold?.skillId !== skillId) return;

    const skill = ctx.skills.get(skillId);
    const grantedIds = new Set(
      (skill?.abilities ?? [])
        .filter((a): a is Extract<typeof a, { kind: 'grant' }> => a.kind === 'grant')
        .map((a) => a.buff.id),
    );

    ctx.replaceCombatant({
      ...actor,
      activeHold: undefined,
      buffs: actor.buffs.filter((b) => !grantedIds.has(b.defId)),
    });
  }

export function tickHolds(ctx: HoldsContext): void {
    if (ctx.tick % TICKS_PER_LOGIC_TICK !== 0) return;

    for (const id of ctx.combatants.map((c: Combatant) => c.id)) {
      const actor = ctx.current(id);
      const hold = actor?.activeHold;
      if (!actor || !hold) continue;

      const skill = ctx.skills.get(hold.skillId);
      const drain = skill?.holdDrain;
      if (!drain) {
        endHold(ctx, hold.skillId, id);
        continue;
      }

      const have = (actor.resources as Record<string, number>)[drain.resource] ?? 0;
      /**
       * 每逻辑步欠 `perLogicTick` 点，攒够整点才真扣（见 `DRAIN_SCALE`）。
       *
       * ⚠️ 不能写成 `changeResource(actor, ..., -drain.perLogicTick)`：
       * `Math.round` 会把每步的 0.3 吃掉，结果是**按住整场也不扣炁**。
       * 欠账走整数，所以"按住 1 秒"恰好是 `10 × 0.3 = 3`。
       */
      const debt = (hold.drainDebt ?? 0) + Math.round(drain.perLogicTick * DRAIN_SCALE);
      const whole = Math.floor(debt / DRAIN_SCALE);
      if (have < whole) {
        // 资源耗尽 → 自动松开，并告诉玩家原因
        endHold(ctx, hold.skillId, id);
        ctx.events.push({
          kind: 'skillRejected',
          tick: ctx.tick,
          sourceId: id,
          skillId: hold.skillId,
          reason: 'cost',
        });
        continue;
      }
      const settled: Combatant = {
        ...actor,
        activeHold: { skillId: hold.skillId, drainDebt: debt - whole * DRAIN_SCALE },
      };
      if (whole <= 0) {
        // 还没攒够 1 点 —— 欠账照记，本步不产生资源变动
        ctx.replaceCombatant(settled);
        continue;
      }
      const result = changeResource(settled, drain.resource, -whole, ctx.tick);
      ctx.replaceCombatant(result.combatant);
      ctx.events.push(...result.events);
    }
  }

export function gainDouqiFromDamage(
  ctx: HoldsContext,
  combatantId: string,
  damage: number,
  tick: number,
): void {
    if (damage <= 0) return;
    /**
     * `damage` 是**内部刻度**，而系数是展示刻度的 —— 必须用换算过的版本。
     *
     * 踩过的坑：直接用展示刻度系数会让炁攒得快 `DISPLAY_SCALE` 倍，
     * 玩家一路「轰」秒杀 Boss（实测 7 秒通关一场本该 2 分钟的战斗）。
     * 而且单点伤害小到 10 内部点时，`Math.round` 会把 1 点炁算成 1 ——
     * 所以系数的换算必须在这里做，不能靠调用方记得。
     */
    const gain = Math.round(damage * DOUQI_PER_INTERNAL_DAMAGE);
    if (gain <= 0) return;
    const target = ctx.current(combatantId);
    if (!target) return;
    const result = changeResource(target, 'douqi', gain, tick);
    ctx.replaceCombatant(result.combatant);
    ctx.events.push(...result.events);
  }
