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
  BuffDef,

  CastInstance,
  Combatant,
  CombatantId,
  EventDef,
  DamageSpec,
  Effect,
  Expr,
  HitDef,
  ActiveSkillDef,
  SkillDef,
  StatKey,
} from '../types';
import { aggregateFlags, applyBuff } from '../buffs';
import { runAbilities, runTriggers } from './triggers';
import { absorbedByOf, withAbsorbedByBuffId } from './avoidedSource';
import { casterGainsDouqiFromDamage } from './holds';
import {
  actsOnVictim,
  absorbShieldDamage,
  firePostHitHooks,
  applyStunEffect,
  applyThornReflect,
  transferResources,
} from './effectOps';
import {
  applyDamage,
  applyHeal,
  changeResource,
  computeDamage,
  computeHeal,
  evaluateCondition,
  flatBlocked,
} from './index';
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
  /**
   * 求值一个 `Expr`：`who: 'self'/'caster'` 锚在 `actor`、`'target'` 锚在
   * `target`。
   *
   * ⚠️ **锚点必须由调用方显式给出** —— 一次结算里可能同时要读两边
   * （`transfer` 的搬运量就是"双方血量百分比之差"），谁是"另一方"
   * 只有调用方知道。属性一律走**施法者**的修正树，与 `computeDamage`
   * 读 `casterStats` 同一条口径。
   */
  evalExpr(
    expr: Expr,
    who: {
      readonly self: CombatantId;
      readonly target: CombatantId;
      /**
       * **触发器载荷里的数**（缺省 0）。
       * ⚠️ 只有触发器执行器会传它（`Expr: 'payloadCustom'` 唯一的来源）。
       */
      readonly payloadCustom?: number;
    },
  ): number;
  pushBuffApplied(targetId: string, buffId: string, stacks: number): void;

  /* ---- 触发器引擎需要的能力（见 `triggers.ts`） ---- */

  /**
   * 概率判定（走种子化 RNG）。
   *
   * ⚠️ 与 `rollCrit` 一样，调用方要在**确定要消耗**时才调 ——
   * `chance >= 1` 会短路，不消耗随机数，这样重放的随机数消耗只由内容决定。
   */
  rollChance(): number;
  /**
   * 掷一个 `[0, maxExclusive)` 的整数（种子化 RNG）。
   *
   * 用途：触发器的 `cooldownRangeMs`（"每次现掷一个 3–5 秒的间隔"）。
   * ⚠️ 与 `rollChance` 一样，**调用即消耗**随机数 —— 只在真的要掷时调。
   */
  rollInt(maxExclusive: number): number;
  /**
   * 解析 buff / 技能定义，以及当前 tick。
   *
   * ⚠️ 这三项是 `CombatContext` 要求的形状（`evaluateCondition` 要它）。
   * 触发器判 `when` 时会把自己的 ctx 直接传进去，所以必须满足该接口 ——
   * 与其在触发器里造一个适配器对象（每帧分配），不如让 ctx 本身满足它。
   */
  buffDef(buffId: string): BuffDef | undefined;
  skillDef(skillId: string): SkillDef | undefined;
  currentTick(): number;
  /** 按 id 挂一个 buff（复用 `applyBuff` 的语义）。 */
  grantBuffFromTrigger(
    target: Combatant,
    def: BuffDef,
    sourceId: string,
    /** ⚠️ 只在"这次授予带一个数"时给（「血盾」：这次偷了多少）。 */
    custom?: number,
  ): void;
  /** 按 `defId` 移除一个 buff（同 defId 的实例一起摘）。 */
  /** 移除某个 buff：`stacks` 给了只减那么多层（见 `RemoveBuffAbility`），不给 = 整条摘掉。 */
  removeBuffFromTrigger(target: Combatant, buffId: string, stacks?: number): void;
  /** 一次性资源变动。 */
  changeResourceFromTrigger(target: Combatant, resource: string, delta: number): void;
  /**
   * 由触发器造成一次伤害。
   *
   * ⚠️ 它会**再派发一次** `onHitTaken`（设计决定：反伤算受击、要进日志与
   * 飘字）。终止靠"内容不构成环" + `triggers.ts` 的 `DEPTH_LIMIT`。
   */
  dealDamageFromTrigger(actorId: string, targetId: string, hit: HitDef): void;
}

/**
 * 派发 hook 时携带的载荷。
 *
 * 只带**触发器判条件真的用得上**的字段（谁打的、打了多少、哪个技能），
 * 不是把整个 `HitDef` 塞进来 —— 载荷越大，"哪些字段在哪个 hook 上有值"
 * 越难说清。
 */
export function resolveHit(
  ctx: HitResolutionContext,
  actor: Combatant,
  /** ⚠️ 只有主动技能有 `hits`（被动技能没有命中段）。 */
  skill: ActiveSkillDef,
  hit: HitDef,
): void {
    const target = ctx.opponentOf(actor.id);
    if (!target) return;

    const casterStats = ctx.statsOf(actor.id);
    /**
     * ⚠️ 判定旗标（buff 带来的）+ **目标自己的 `damageTakenMult`**
     * （属性管道里的"易伤 / 弱点"）。
     *
     * 分开取是因为它们是两套东西：旗标是 `BuffFlags`（`invulnerable` /
     * `damageThreshold` 那种"整击作废"的判定），而 `damageTakenMult` 是
     * **属性**（`statsOf` 算出来的乘子）。`computeDamage` 只认后者做乘法。
     */
    const victimFlags = {
      ...aggregateFlags(target),
      damageTakenMult: ctx.statsOf(target.id).damageTakenMult,
    };

    /**
     * 这一击里的全部伤害效果 —— 「卸」的阈值判定需要**看完整一击**。
     *
     * ⚠️ 取出来不是为了遍历（下面的 switch 仍然按顺序结算），
     * 而是因为判据属于"整次命中"：见下面 `guardBlocked` 的说明。
     */
    const damageSpecs = hit.effects
      .filter((e) => e.kind === 'damage' && e.damage !== undefined)
      .map((e) => e.damage)
      .filter((d): d is NonNullable<typeof d> => d !== undefined);

    /**
     * **这一击是不是被「卸」的阈值完全挡下了**（`伤害 ≤ N`）。
     *
     * ==================================================================
     * 为什么是"整次命中一个判据"
     * ==================================================================
     *
     * 用户的规则是两句：
     *   `≤N` → 完全抵消，且【连它带的效果一起免】（如眩晕）
     *   `>N`  → 伤害 − N，效果【照吃】
     *
     * 而"效果一起免"在引擎里**已经有实现** —— `avoided` 通路：
     * `applyHitEffects` 里对"作用在挨打者身上的效果"直接跳过
     * （那条注释记录了"我闪躲了还是倒地了"这个真实 bug）。
     *
     * 所以这里**不新写一套免效果逻辑**，只回答一个问题：
     * "这一击够不够低，低到整击作废？" —— 答是，就让它走同一条
     * `avoided` 通路，于是"连眩晕一起免"是天然的。
     *
     * ⚠️ 多个伤害效果时取**全部都要 ≤N 才算挡住**：只要有一段超过，
     * 那一段就要吃 `伤害−N`，而"效果照吃"是整次命中的约定 ——
     * 一半免效果一半不免会造出一个没人能预期的中间状态。
     *
     * ⚠️ 判据用 `crit: false`：这里问的是"**基础伤害**够不够低"，
     * 而当前内容全部 `canCrit: false`，所以两者本来就相等。
     * 更重要的是**不在这里调 `rollCrit`** —— 那会消耗随机数，
     * 而"这次卸力判没判"不该影响后面的暴击结果（重放会因此变得
     * 极难推理，与 `rollCrit` 自己的短路理由同源）。
     */
    const guardBlocked =
      victimFlags.invulnerable !== true &&
      flatBlocked(damageSpecs, casterStats, victimFlags, { crit: false, multiplier: 1 });

    /**
     * 这次命中**有没有碰到人**。
     *
     * ⚠️ **在循环之前判定一次**，不要在每个效果里现算：
     * 判据属于"整次命中"，与效果的顺序、种类都无关（见 `applyHitEffects`
     * 里那段"我闪躲了还是倒地了"的说明）。
     *
     * ⚠️ 两个来源：无敌（`invulnerable`）与「卸」的阈值（`guardBlocked`）。
     * 后者也算"没碰到人"，所以它带的效果同样被免掉 —— 这正是需求。
     */
    const avoided = victimFlags.invulnerable === true || guardBlocked;

    /**
     * **是谁吸收的这一击**（`avoided.viaBuffId` / `damage.viaBuffId` 的来源）。
     *
     * ⚠️ 两个出口一次算好、而且**必须在结算之前**读 —— 理由（"命中附带的
     * buff 会改掉挨打者的 buff 列表"、"两个出口为什么用两个解析器"）写在
     * `avoidedSource.absorbedByOf` 上，这里不再抄第二遍。
     * ⚠️ 它**不参与判定**（挡没挡住上面已经定了），只写进事件给统计 / 日志 /
     * 炁机读 —— 与 `interruptSuccess.sourceSkillId` 同一条纪律：
     * 不动确定性语义、不动 `REPLAY_FORMAT_VERSION`。
     */
    const absorbedBy = absorbedByOf(target, avoided);

    /** 本次命中实际扣掉的血（用于判断"是否算受伤"，见函数末尾）。 */
    let taken = 0;

    for (const effect of hit.effects) {
      switch (effect.kind) {
        case 'damage': {
          if (!effect.damage) break;
          /**
           * ============================================================
           * **「卸」挡下整击**：发 `avoided` 事件，不走进伤害公式。
           * ============================================================
           *
           * ⚠️ 为什么必须在这里分叉，而不是"让 `computeDamage` 把伤害减到 0"：
           *
           *   - `≤N` 的语义是**整击作废**（连效果一起免），而"减到 0"的
           *     那一击仍会发出 `damage` 事件 —— 飘字会显示「-0」，
           *     玩家看不出自己挡住了，而**闪避与卸力的反馈就分不清了**
           *   - `>N` 才是"减伤"（`computeDamage` 的平减），它会正常发
           *     `damage` 事件并带上 `thinned`
           *
           * ⚠️ `avoidReason: 'invulnerable'` 是**复用**：`applyDamage` 据此
           * 发 `reason: 'immune'`（而不是 `'dodged'`）。语义上是"这一击被
           * 完全免疫了"，与无敌一致 —— 两者在引擎里的区别只有"判定来源"。
           */
          if (guardBlocked) {
            const blocked = applyDamage(
              ctx.current(target.id),
              {
                amount: 0,
                absorbed: 0,
                thinned: 0,
                crit: false,
                avoided: true,
                avoidReason: 'invulnerable',
              },
              actor.id,
              skill.id,
              ctx.state.tick,
            );
            ctx.events.push(...withAbsorbedByBuffId(blocked.events, absorbedBy));
            break;
          }
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
          /**
           * 命中本身也会触发"授予 buff"类效果（例如 Boss 给自己挂前摇标记）
           * —— 那类效果写的是 `target: self`，所以**被闪掉时照样生效**；
           * 而挂在挨打者身上的（如「倒地」）会被 `avoided` 挡掉。
           */
          applyHitEffects(ctx, actor, target, effect, skill.id, avoided);
          /**
           * ⚠️ **先过吸收壳**（「血盾」），⚠️ 按**未过 `damageReduce`** 的伤害
           * 吃（用户："血盾不吃这个减伤"）。"打穿壳要跑它自己的 `onBreak`"
           * （把偷走的血还给玩家）—— 实现与理由收在 `effectOps.absorbShieldDamage`。
           */
          const reduce = victimFlags.damageReduce ?? 0;
          const preReduce = reduce > 0 ? result.amount / (1 - reduce) : result.amount;
          const shield = absorbShieldDamage({
            ctx,
            target: ctx.current(target.id),
            damage: preReduce,
            damageReduce: reduce,
          });
          for (const brokenBuff of shield.broken) {
            for (const ability of brokenBuff.def?.onBreak ?? []) {
              runAbilities(ctx, target.id, [ability], { custom: brokenBuff.custom ?? 0 });
            }
          }
          const leaked = shield.leaked;
          const applied = applyDamage(
            ctx.current(target.id),
            /**
             * `absorbed` 记**壳吃掉的那部分**（供飘字 / 日志显示"被护盾挡了"）——
             * 它原先恒为 0（`computeDamage` 里 `damageReduce` 那条从没算过它），
             * 所以这里填上不会与任何既有语义冲突。
             */
            shield.absorbedByShield <= 0
              ? result
              : { ...result, amount: leaked, absorbed: shield.absorbedByShield },
            actor.id,
            skill.id,
            ctx.state.tick,
          );
          ctx.replaceCombatant(applied.combatant);
          ctx.events.push(...withAbsorbedByBuffId(applied.events, absorbedBy));
          taken += Math.max(0, result.amount);

          /**
           * **暴击 → 派发 `onCritDealt`**（挂在**造成暴击的人**身上）。
           *
           * 这条链以前从来没跑过：`rollCrit` 有了、但没有任何地方派发这个
           * hook，于是熵之钟"暴击后授予势能涌动"永远不触发（那个内容示例
           * 被当成"完整的被动装备例子"，其实是死的）。
           *
           * ⚠️ 判据是"**真的打出去了**"（`result.amount > 0`）：被无敌 /
           * 闪避吃掉的暴击不算"造成暴击"，否则"闪避反而白送对手一个增益"。
           * 与 `onHitTaken` 的 `taken > 0` 判据同一条原则。
           */
          if (crit && result.amount > 0) {
            runTriggers(ctx, actor.id, 'onCritDealt', {
              amount: result.amount,
              skillId: skill.id,
            });
          }

          /**
           * 缠按伤害换算：**造成伤害的人**与**受到伤害的人**各得一份。
           * 放在这里（而不是内容里）才能覆盖所有伤害来源。
           *
           * ⚠️ **但用缠付账的技能不给施放者回缠**（规则 C，2026-10-12）：
           * 回缠按伤害算 ⇒ 代价 50 缠的「劈」（45 伤）会退回 `45 × 0.5 = 22`
           * —— **退回自己 44% 的代价**，用缠的大招一直在自我返还。判据是
           * "**这个技能的代价里含 `douqi`**"（`casterGainsDouqiFromDamage`），
           * 只看静态内容，不读时间/随机、不改 rng 消耗顺序。
           *
           * ⚠️ **挨打方照旧回缠**（下面 `target` 那行不动）—— "挨打攒缠"
           * 是另一件事，用户确认过两边都是 `伤害 × 0.5`。
           */
          if (result.amount > 0) {
            if (casterGainsDouqiFromDamage(skill)) {
              ctx.gainDouqiFromDamage(actor.id, result.amount, ctx.state.tick);
            }
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
          applyHitEffects(ctx, actor, target, effect, skill.id, avoided);
          break;
      }
    }

    /**
     * **整次命中结算完成后**的一对钩子（`onHitTaken` / `onHitDealt`）——
     * 判据（`taken > 0`）与理由收在 `effectOps.firePostHitHooks`。
     */
    firePostHitHooks({
      ctx,
      actor,
      target,
      skillId: skill.id,
      taken,
      /** ⚠️ 在这里绑好 `ctx`（它本来就是 `HitResolutionContext`）—— 见那边的说明。 */
      runTriggers: (ownerId, hook, payload) => runTriggers(ctx, ownerId, hook, payload),
    });

    /**
     * **荆棘反伤**：受击者身上带 `reflectFraction` 时，按比例把**实际受到
     * 的伤害**反弹给攻击者。
     *
     * ⚠️ 它是**另一条独立的路**（不是上面那套触发器的替代）：荆棘每次
     * 受伤都触发、不消耗、无内部 CD —— "这一段时间内你别碰我"。
     * 完整理由在 `effectOps.ts` 的 `applyThornReflect`。
     */
    applyThornReflect({ ctx, attacker: actor, victim: target, taken, skillId: skill.id });
  }

/** 非伤害类效果（授予 buff / 改资源 / 打断）。 */
export function applyHitEffects(
  ctx: HitResolutionContext,
  actor: Combatant,
  target: Combatant,
  effect: Effect,
  /** 触发这个效果的技能 —— `cooldown` 效果默认调它自己的冷却。 */
  skillId?: string,
  /**
   * 这次命中是否**被闪掉 / 免疫**了（见 `resolveHit`）。
   *
   * ⚠️ 默认 `false` 是**有意**的：调用方（触发器、派生技）绝大多数
   * 不经过"命中判定"，它们的效果本来就该生效。只有 `resolveHit`
   * 知道闪避结果，所以只有它传 `true`。
   */
  avoided = false,
): void {
    /**
     * ⚠️ **被闪掉的命中不改变挨打者。**
     *
     * 踩过的坑（玩家原话）："我闪躲了还是倒地了。"
     *
     * 傲慢的「碾压」把「倒地」和伤害放在**同一个 hit** 里，设计原话是
     * "闪掉了就不会倒地"。但伤害的免疫判定只在 `damage` 分支里发生
     * （`computeDamage` 返回 `avoided`），而 `grantBuff` 走 `default`
     * 分支、**无条件执行** —— 于是设计意图从来没被引擎实现过。
     *
     * 顺带一提：当时能"看起来对"是因为 `damage` 排在 `grantBuff` **前面**。
     * 顺序一换（或某个 hit 只有 buff 没有伤害），同一个 bug 会以
     * 另一种面貌出现。所以判据要**整次命中判定一次**，不能靠效果顺序。
     */
    if (avoided && actsOnVictim(effect)) return;

    /**
     * **`effect.when`：整条效果的开关。**
     *
     * ⚠️ 这个字段**声明了很久但引擎从没求值过** —— 它一直是静默无效的：
     * 内容写 `when` 不报错、效果照样结算。第一个真实消费者是「嫉妒」的
     * 「夺息」（"你的炁高于 60% 才偷"），所以在这里接上。这类"看起来支持、
     * 其实不生效"的字段是本仓库反复清的病（`interruptImmune` /
     * `ccImmune` / `damageTakenMult` 都踩过）。
     *
     * 判据里的 `who` 与触发器同一套解析：这里的 `actor` 是"自己"，
     * 所以 `who: 'target'` 落到挨打的那一方。
     */
    if (effect.when !== undefined && !evaluateCondition(actor, effect.when, ctx, target)) return;

    if (effect.kind === 'grantBuff' && effect.buff) {
      const who = effect.target?.mode === 'self' ? actor : target;
      /**
       * ⚠️ 带上 `custom`（「血盾」记"**这次偷了多少**"）—— 它可以是一个
       * 表达式，与 `transfer` 读**同一个**式子 ⇒ 两个数必然一致。
       * 求值走 `evalExpr`（`HitResolutionContext` 已经实现它，见 `effectOps`
       * 的 `EffectEvalContext`）。
       */
      const customValue =
        effect.custom === undefined
          ? undefined
          : typeof effect.custom === 'number'
            ? effect.custom
            : ctx.evalExpr(effect.custom, { self: actor.id, target: target.id });
      /**
       * ⚠️ `custom` **同时写进 `absorbValue`**：对「血盾」那种 buff 来说
       * "这次偷了多少"就是"这层壳能挡多少" —— 而那是**运行期**才知道的数，
       * 静态的 `BuffDef.absorbValue` 表达不了。别的 buff 带 `custom` 时
       * 多写一个 `absorbValue` 没有副作用（它们本来就不吃伤害）。
       */
      const def =
        customValue === undefined
          ? effect.buff
          : { ...effect.buff, custom: customValue, absorbValue: customValue };
      const applied = applyBuff(ctx.current(who.id), def, actor.id, ctx.state.tick);
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
        /**
         * ⚠️ `effect.target` **要读**（这里曾经漏读，永远取"命中的目标"）。
         *
         * 踩过的坑：「欲望印记」的反伤里要"消耗**自己**的印记"，但那条
         * 效果是在**反伤那一次命中**里结算的 —— 那次命中的目标**是玩家**。
         * 漏读 `target` 于是去移除玩家身上的印记（不存在），Boss 的印记
         * 留下来 → 印记永不消耗 → 反伤每次都触发，正好毁掉这个机制。
         */
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

    if (effect.kind === 'stun') {
      /**
       * ⚠️ 实现搬到了 `effectOps.ts` 的 `applyStunEffect`
       * （AGENTS.md §3："不走命中管线的特殊效果"归那一处）。
       */
      applyStunEffect({ ctx, actor, target, effect });
      return;
    }

    if (effect.kind === 'transfer' && effect.transfer) {
      transferResources({ ctx, actor, target, transfer: effect.transfer });
      return;
    }

    if (effect.kind === 'interrupt') {
      /**
       * **霸体（`interruptImmune`）拦截一切打断，包括「破」的强制打断。**
       *
       * 需求：所有 Boss 招式默认都能被打断 / 闪避 / 卸力，
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
              // 同上面的眩晕分支：打断者用的招式，只在有值时写键
              ...(skillId === undefined ? {} : { sourceSkillId: skillId }),
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
