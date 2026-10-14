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

import type { ActiveSkillDef, BuffDef, Combatant, EventDef, SkillDef } from '../types';
import { DOUQI_PER_INTERNAL_DAMAGE } from '../../data/balance';
import { LOGIC_TICKS_PER_SECOND, TICKS_PER_LOGIC_TICK } from '../loopConstants';
import { changeResource } from './index';

/**
 * 按住消耗的**欠账标度**（欠账以 1/DRAIN_SCALE 点为单位存整数）。
 *
 * 为什么需要它：`holdDrain.perLogicTick` 允许是小数（「卸」是 `1.5`
 * = 15 炁/秒 ÷ 10 步）。而 `changeResource` 的结算是
 * `Math.round(before + delta)` —— 每步扣 1.5 会被舍成只扣 1 点
 * （10 炁/秒，而不是 15），**每步静默少扣 0.5**。
 *
 * 所以每步只把 `Math.round(perLogicTick * DRAIN_SCALE)` 记进欠账
 * （1.5 → 1500，整数），攒够一整个 `DRAIN_SCALE` 才真的扣 1 点。
 * 全程整数：浮点累加 10 次 1.5 得到的是 `14.999999999999998`，
 * "按住 1 秒 = 15 炁"会差 1 点。
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
    /**
     * ⚠️ `holdDrain` 是主动技能专属（被动技能没有按住消耗）—— 按 `kind`
     * 收窄；`skill` 不存在 / 不是主动技能都退化成普通施放，这样输入层
     * 不必区分两种技能。
     */
    if (skill?.kind !== 'activeSkill' || skill.holdDrain === undefined) {
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
      /**
       * ⚠️ 只有主动技能会进 `activeHold`（`startHold` 按 `kind` 收窄过），
       * 所以这里同时判 `kind` —— 被动技能 / 技能没了都按"松开"处理。
       */
      if (skill?.kind !== 'activeSkill' || skill.holdDrain === undefined) {
        endHold(ctx, hold.skillId, id);
        continue;
      }
      const drain = skill.holdDrain;

      const have = (actor.resources as Record<string, number>)[drain.resource] ?? 0;
      /**
       * 每逻辑步欠 `perLogicTick` 点，攒够整点才真扣（见 `DRAIN_SCALE`）。
       *
       * ⚠️ 不能写成 `changeResource(actor, ..., -drain.perLogicTick)`：
       * `Math.round` 会把每步的 0.5 舍掉（1.5 → 只扣 1），结果是
       * **按住每秒只扣 10 点**，而不是内容写的 15。欠账走整数，
       * 所以"按住 1 秒"恰好是 `10 × 1.5 = 15`。
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

/**
 * 一次伤害换算成多少**缠**（整数，展示刻度）。
 *
 * ==================================================================
 * ⚠️ 系数是 0.5（伤害的一半），所以取整规则必须**显式**写出来
 * ==================================================================
 *
 * 乘积会出现 `.5`，而缠是整数资源。这里刻意用 **`Math.floor`（向下取整）**，
 * 不用 `Math.round`：
 *
 *   - `Math.round(1 × 0.5) = 1` —— **1 点伤害也给满 1 缠**，小伤害凭空翻倍。
 *     这是「卸」那次"静默舍入把数值改掉"的同一类陷阱（`Math.round` 会把
 *     `0.3` 吃成 0），所以不能让它再藏在 `Math.round` 里。
 *   - `Math.floor` 永远**不多给**：45 伤害 → **22** 缠（真值 22.5，少 0.5），
 *     10 伤害 → 5，1 伤害 → 0。「绝不超过系数承诺的量」也更容易向玩家解释。
 *
 * ⚠️ 为什么不学 `holdDrain` 用整数欠账累加器：那里小数**每一个逻辑步**
 * 都出现，舍掉就是"整场一点不扣"（100% 失效）；这里的小数**每击**才出现
 * 一次，向下取整不会让收益消失，不值得为它给 `Combatant` 加一个新状态字段。
 * 若将来要"长期精确等于一半"，再把这里换成累加器即可（判据写在这里）。
 *
 * ⚠️ `damage` 是**内部刻度**，用 `DOUQI_PER_INTERNAL_DAMAGE`（已除
 * `DISPLAY_SCALE`）。踩过的坑：直接用展示刻度系数会让缠攒得快 `DISPLAY_SCALE`
 * 倍，玩家一路「轰」秒杀 Boss（实测 7 秒通关一场本该 2 分钟的战斗）。
 */
export function douqiFromDamage(damage: number): number {
  return Math.floor(damage * DOUQI_PER_INTERNAL_DAMAGE);
}

/**
 * 这一击的**施放者**该不该按伤害回缠。
 *
 * ==================================================================
 * 规则（用户 2026-10-12 选 (C)）：**代价里含「缠」的技能，施放者不回缠**
 * ==================================================================
 *
 * 问题：回缠是按**伤害**算的 ⇒ 伤害越高退得越多。于是代价 50 缠的
 * 「劈」（45 伤）打出后会退回 `45 × 0.5 = 22` —— **退回自己 44% 的代价**，
 * 等于用缠的大招在**自我返还**。「轰」（50 缠 / 30 伤）同理，而且以后
 * 出更强的大招会**反复**出现同一个问题：调数值（把代价调高 / 伤害调低）
 * 治不了本。
 *
 * 所以按一条**规则**判：**技能的代价里含 `douqi` → 施放者不回缠**。
 *
 * - 判据是"**代价含 `douqi`**"，**不是**"这个技能贵"、**不是**技能名
 *   （现在没有"炁 + 缠"混付的技能，但按"含 douqi 即不回"写更稳）。
 * - **只管施放者**：挨打的那一方**照旧回缠**（"挨打攒缠"是另一件事，
 *   用户确认过两边都是 `伤害 × 0.5`）。
 * - 代价只有炁的（「斩」10 伤 → 5、「拳」6 伤 → 3）照旧回。
 * - ⚠️ **不在 `gainDouqiFromDamage` 里判**：那个函数不知道"谁、用什么
 *   技能打的"，它只是"把伤害换成缠"的纯换算；这条规则属于**这一击的
 *   上下文**，所以由调用方（`hitResolution.ts`）在调用点判。
 * - ⚠️ **纯函数**：只看静态内容（`skill.cost`），不读时间/随机，
 *   也不会改变 rng 的消耗顺序 —— 确定性语义不变。
 */
export function casterGainsDouqiFromDamage(skill: ActiveSkillDef): boolean {
  return !skill.cost.some((cost) => cost.resource === 'douqi');
}

export function gainDouqiFromDamage(
  ctx: HoldsContext,
  combatantId: string,
  damage: number,
  tick: number,
): void {
    if (damage <= 0) return;
    const gain = douqiFromDamage(damage);
    if (gain <= 0) return;
    const target = ctx.current(combatantId);
    if (!target) return;
    const result = changeResource(target, 'douqi', gain, tick);
    ctx.replaceCombatant(result.combatant);
    ctx.events.push(...result.events);
  }
