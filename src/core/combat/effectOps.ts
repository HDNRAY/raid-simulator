/**
 * **不走命中管线的效果** —— 从 `hitResolution` 横向切出来的一块。
 *
 * ==================================================================
 * 为什么单独一个文件（而不是继续留在 `hitResolution` 里）
 * ==================================================================
 *
 * `hitResolution.ts` 加完这一轮到了 789 行（AGENTS.md §3 的上限是 700），
 * 而新增的两种效果恰好属于**同一个性质**："直接按规则结算，
 * **不经过伤害公式 / 闪避 / 暴击**"：
 *
 * | 效果 | 落在哪 |
 * |---|---|
 * | `transfer`（搬运资源：「夺息」/「妒火」） | 本文件 |
 * | 荆棘反伤（`BuffFlags.reflectFraction`） | 本文件 |
 * | 伤害 / 治疗 / buff / 眩晕 / 打断（**走命中管线**） | 仍留在 `hitResolution` |
 *
 * 判据是**职责**而不是行数：本文件回答"不打架的那部分，规则怎么结算"。
 * 以后再有一种"不走命中管线"的效果，落点就在这里 —— 它不会再顶
 * `hitResolution`（那正是拆它的目的，见 AGENTS.md §3 的"关注分离"）。
 *
 * ==================================================================
 * ⚠️ 本文件里的操作**不消耗随机数**、**不做暴击 / 闪避判定**
 * ==================================================================
 *
 * 与 `triggerContext` 里那条反伤同一条纪律：随机数的消耗顺序必须**只由
 * 内容决定**，否则"哪一次攻击会暴击"会取决于前面发生过什么，
 * 固定种子下的重放就变得无法推理。
 */

import { type EvalContext } from '../expr/eval';
import { aggregateFlags, applyBuff } from '../buffs';
import { resolveCombatantIn } from './battleStateTypes';
import { applyDamage, changeResource, evaluateCondition, type CombatContext } from './index';
import type { HitResolutionContext } from './hitResolution';
import type {
  Combatant,
  CombatantId,
  Condition,
  Effect,
  EventDef,
  Expr,
  StatKey,
  Who,
} from '../types';

/** 事件出口。`HitResolutionContext.events` 是可变的数组，这里只要求"能 push"。 */
type EventSink = readonly EventDef[];

function pushEvents(sink: EventSink, events: readonly EventDef[]): void {
  (sink as EventDef[]).push(...events);
}

/* ================================================================== *
 * 1. 表达式求值上下文（效果 / 行为里写 `Expr` 时用）
 * ================================================================== */

/**
 * 造一个**效果表达式**的求值上下文。
 *
 * ⚠️ `who` 的锚点是**调用方给的**（`self` = 施法者、`target` = 被搬的
 * 那一方）—— 一次结算里可能同时要读两边（`transfer` 的搬运量就是两边
 * 血量之差），"谁是另一方"只有调用方知道，表达式自己找不到。
 *
 * ⚠️ 属性一律取**施法者**的修正树，与 `computeDamage` 读 `casterStats`
 * 同一条口径；资源 / buff 层数则按 `who` 各自解析（`resolveCombatantIn`）。
 */
export function evalContextFor(args: {
  readonly combatants: readonly Combatant[];
  readonly statsOf: (id: CombatantId) => Readonly<Record<StatKey, number>>;
  readonly combatCtx: CombatContext;
  readonly who: { readonly self: CombatantId; readonly target: CombatantId };
}): EvalContext {
  const { combatants, statsOf, combatCtx, who } = args;
  const pick = (w: Who): Combatant => resolveCombatantIn(combatants, who.self, w);

  return {
    getStat: (_w, stat) => statsOf(who.self)[stat] ?? 0,
    getResource: (w, resource) => pick(w).resources[resource],
    getMaxResource: (w, resource) => pick(w).caps[resource],
    getBuffStacks: (w, buffId) =>
      pick(w).buffs.filter((b) => b.defId === buffId).reduce((sum, b) => sum + b.stacks, 0),
    /**
     * ⚠️ 与 `stats.ts` 里那个桩**同一条纪律**：离散计数器还没接线，
     * 读出来恒 0。防线在**校验层** —— 内容里写 `Expr.counter` 会被
     * `validate.ts` 的 `COUNTER_UNIMPLEMENTED` 拦下（默认严格模式即
     * error），所以合法内容读不到这里。实现时两处一起换掉。
     */
    getCounter: () => 0,
    /**
     * `contrib`（"和某命名空间当前值一样多"）—— 见 `stats/pipeline.ts`。
     *
     * ⚠️ **战斗内还没接线，恒 0，而且它没有校验防线**（内容里写它不会
     * 报错）。留一个显式桩在这里，等第一个真实消费者时实现 ——
     * 别让它悄悄长成第二种"看起来支持、其实不生效"的字段。
     */
    getContribution: () => 0,
    evaluateCondition: (condition: Condition) =>
      evaluateCondition(pick('self'), condition, combatCtx, pick('target')),
  };
}

/** 效果表达式求值需要的上下文（`HitResolutionContext` 的子集 + 条件求值）。 */
export interface EffectEvalContext {
  readonly state: HitResolutionContext['state'];
  readonly events: EventSink;
  current(id: CombatantId): Combatant;
  replaceCombatant(updated: Combatant): void;
  /** 由引擎注入：把 `Expr` 接到修正树与双方的资源上。 */
  evalExpr: HitResolutionContext['evalExpr'];
}

/* ================================================================== *
 * 1b. 效果的**路由**：这一条作用在谁身上？
 * ================================================================== */

/**
 * 这个效果是不是**作用在挨打者身上**。
 *
 * ==================================================================
 * 为什么需要它（`avoided` 的判据）
 * ==================================================================
 *
 * 被闪掉 / 无敌的命中**没有碰到人**，所以"挨打者完全不受影响" ——
 * 但**施法者自己的东西照旧**（他确实放了这一招，代价与冷却已经付了）。
 *
 * 所以这条判据必须按**效果作用于谁**来分，不能按"是不是伤害"来分：
 *
 * | 效果 | 作用对象 | 被闪掉时 |
 * |---|---|---|
 * | `grantBuff` / `removeBuff` / `stun` / `interrupt` | 挨打者（默认） | **跳过** |
 * | 同上，但写了 `target: self` | 施法者 | 照常 |
 * | `resource` / `cooldown` | **永远是施法者** | 照常 |
 * | `transfer` | **两边**（扣挨打者、补施法者） | **跳过**（闪掉了就没有这回事） |
 *
 * ⚠️ `resource` / `cooldown` / `transfer` 这三条**必须显式列出来** ——
 * 它们没有（或不该看）`target` 字段，落到"默认 = 挨打者"那一支就会被
 * 误判：于是"被打断"会不退冷却、"派生技消耗资源"会不生效、
 * "闪掉了却照样搬运"，而且症状都是**静默的数值不对**，极难查。
 *
 * ⚠️ 它住在本文件（而不是 `hitResolution`）：这是一条**效果分类**规则，
 * 与"哪一类效果怎么结算"是同一件事；而 `hitResolution` 只需要问一句
 * "这条被跳过吗"。
 */
export function actsOnVictim(effect: Effect): boolean {
  switch (effect.kind) {
    /** 施法者自己的资源收支（`applyHitEffects` 里读的就是 `actor`）。 */
    case 'resource':
    /** 施法者自己的冷却调整（「截」成功不退 CD 靠它）。 */
    case 'cooldown':
      return false;
    case 'transfer':
      return true;
    default:
      return effect.target?.mode !== 'self';
  }
}

/* ================================================================== *
 * 2. `transfer`：按规则搬运一池资源
 * ================================================================== */

/**
 * 结算一条 `transfer` 效果（扣目标、补施法者），返回**真的搬走了多少**。
 *
 * ==================================================================
 * 顺序与"搬走量的算法"都是**结构性保证**，不是巧合
 * ==================================================================
 *
 * 先从**目标**身上搬走，再按"真的搬走了多少"补给施法者：
 *
 *   - 先扣、后用实际 `delta` 加 ⇒ **"你掉多少、它就回多少"永远成立**：
 *     目标只剩 12 点时，施法者也只拿到 12，而不是"按目标上限算出的
 *     那个大数"
 *   - 两边缺一不可 —— 各写一遍表达式必然漂（AGENTS.md §2 的"重复 → 删"）
 *
 * ==================================================================
 * ⚠️ 不走命中管线
 * ==================================================================
 *
 * 不吃护甲 / 减伤 / 暴击，也**不能闪避** —— 这条效果的语义是"按规则
 * 结算"，不是"打你一下"。它的反制手段是**打断那条读条**
 * （见 `EffectKind.transfer` 的说明）。
 *
 * ⚠️ 被闪掉时调用方**不该调用本函数**：`actsOnVictim('transfer')` 返回
 * true，所以 `applyHitEffects` 会在 `avoided` 时整条跳过它。
 */
export function transferResources(args: {
  readonly ctx: EffectEvalContext;
  readonly actor: Combatant;
  readonly target: Combatant;
  readonly transfer: { readonly pool: 'hp' | 'energy' | 'douqi'; readonly amount: number | Expr };
}): number {
  const { ctx, actor, target, transfer } = args;
  const value =
    typeof transfer.amount === 'number'
      ? transfer.amount
      : ctx.evalExpr(transfer.amount, { self: actor.id, target: target.id });
  /** 负数 / 0 = 这一条不成立（例：我的血量百分比不低于你）。 */
  if (!(value > 0)) return 0;

  const drained = changeResource(ctx.current(target.id), transfer.pool, -value, ctx.state.tick);
  ctx.replaceCombatant(drained.combatant);
  pushEvents(ctx.events, drained.events);

  const moved = Math.abs(
    drained.events.reduce((sum, e) => sum + (e.kind === 'resourceChanged' ? e.delta : 0), 0),
  );
  if (moved > 0) {
    const gained = changeResource(ctx.current(actor.id), transfer.pool, moved, ctx.state.tick);
    ctx.replaceCombatant(gained.combatant);
    pushEvents(ctx.events, gained.events);
  }
  return moved;
}

/* ================================================================== *
 * 3. 荆棘反伤（`BuffFlags.reflectFraction`）
 * ================================================================== */

/**
 * 受击者身上带**荆棘**时，把**实际受到的伤害**按比例反弹给攻击者。
 *
 * ==================================================================
 * 与「欲望印记」那套反伤是**两条独立的路**（不是替代）
 * ==================================================================
 *
 * `runTriggers(onHitTaken)` 走的是**触发器**：印记有内部 CD、被打一下
 * 要**消耗**掉 —— 所以它是"你打一下，我回你一下，然后你有 3 秒安全
 * 窗口"。荆棘要表达的是另一件事："**这一段时间内你别碰我**" ——
 * 所以它**每次受伤都触发**，不消耗、不受内部 CD 约束（窗口期本身就是
 * 它的约束）。
 *
 * ==================================================================
 * ⚠️ 终止靠 `skillId === ''`
 * ==================================================================
 *
 * 反伤自己也是走 `resolveHit` 结算的一次命中（`skillId: ''`，与
 * `triggerContext` 里那条反伤同源），所以"反伤再触发反伤"被**结构性**
 * 挡住了 —— 否则两个带荆棘的角色会互相弹到死。
 *
 * 用空 `skillId` 当判据而不是新加一个参数：那条"空 skillId = 不是技能
 * 打的"约定本来就已经在事件与日志里用着了（见 `applyDamage` 的
 * `reflect` 参数）。
 *
 * ⚠️ 反弹**不做暴击判定、不消耗随机数**，与印记反伤同一条纪律。
 */
export function applyThornReflect(args: {
  readonly ctx: EffectEvalContext;
  readonly attacker: Combatant;
  readonly victim: Combatant;
  readonly taken: number;
  readonly skillId: string;
}): void {
  const { ctx, attacker, victim, taken, skillId } = args;
  if (taken <= 0 || skillId === '') return;
  const fraction = aggregateFlags(victim).reflectFraction ?? 0;
  if (!(fraction > 0)) return;
  const reflected = Math.round(taken * fraction);
  if (reflected <= 0) return;

  const applied = applyDamage(
    ctx.current(attacker.id),
    { amount: reflected, absorbed: 0, thinned: 0, crit: false, avoided: false },
    victim.id,
    '',
    ctx.state.tick,
    true,
  );
  ctx.replaceCombatant(applied.combatant);
  pushEvents(ctx.events, applied.events);
}

/* ================================================================== *
 * 4. `stun`：眩晕（挂 buff + 打断施法）
 * ================================================================== */

/**
 * **眩晕** = 挂一个带 `actionLock` 的 buff（禁行动）+ **打断当前施法**。
 *
 * ⚠️ 两件事**必须同时做**，所以合成一个 `kind` 而不是让内容写两行：
 * 只挂 buff 不打断 → "不能动但读条还在走"的半晕状态；只打断不挂 buff
 * → 打断完立刻又能出招。
 *
 * ⚠️ **打断不退冷却**（`casts` 直接移除）：冷却本来就在施放时扣过 ——
 * 退冷却会让眩晕变成"免费重置"，反而削弱这一击的分量。
 *
 * ⚠️ 从 `hitResolution` 搬到本文件（AGENTS.md §3）：它是"不走命中管线的
 * 特殊效果"，与 `transfer` / 荆棘同类。
 */
export function applyStunEffect(args: {
  readonly ctx: EffectEvalContext;
  readonly actor: Combatant;
  readonly target: Combatant;
  readonly effect: Effect;
}): void {
  const { ctx, actor, target, effect } = args;
      /**
       * **眩晕** = 挂一个带 `actionLock` 的 buff（禁行动）+ 打扰断当前施法。
       *
       * ⚠️ 两件事**必须同时做**，所以合成一个 `kind` 而不是让内容写两行：
       * 只挂 buff 不打打断 → "不能动但读条还在走"的半晕状态；
       * 只打断不挂 buff → 打断完立刻又能出招。
       *
       * ⚠️ **打断不退冷却**（`casts` 直接移除即可，冷却本来就在施放时扣过）。
       * 这是有意的：玩家在关键读条快完成时被晕，那个技能照样进 CD ——
       * 退冷却会让眩晕变成"免费重置"，反而削弱这一击的分量。
       */
      const who = effect.target?.mode === 'self' ? actor : target;
      const stunned = ctx.current(who.id);
      const def = effect.buff;

      /**
       * ⚠️ **`ccImmune`（免控）在这里生效。**
       *
       * 这个 flag 早就定义了、`aggregateFlags` 也一直在算它，但
       * **没有任何地方读它** —— 又一个"看起来支持但实际不生效"的字段
       * （`interruptImmune` 也踩过同一个坑）。眩晕是它唯一合理的消费者，
       * 所以在这里接上，而不是新造一个 flag。
       */
      if (aggregateFlags(stunned).ccImmune) {
        (ctx.events as EventDef[]).push({
          kind: 'interruptImmune',
          tick: ctx.state.tick,
          targetId: stunned.id,
          skillId: stunned.casts[0]?.skillId ?? '',
        });
        return;
      }

      if (def !== undefined) {
        const applied = applyBuff(stunned, def, actor.id, ctx.state.tick);
        ctx.replaceCombatant({ ...ctx.current(who.id), buffs: applied.buffs });
        (ctx.events as EventDef[]).push({
          kind: 'buffApplied',
          tick: ctx.state.tick,
          targetId: who.id,
          buffId: def.id,
          stacks: applied.stacks,
          sourceId: actor.id,
        });
      }

      /** 打断它当前**所有**读条（眩晕不看可打断性 —— 人都动不了了）。 */
      const casting = ctx.current(who.id);
      if (casting.casts.length > 0) {
        ctx.replaceCombatant({ ...casting, casts: [] });
        for (const cast of casting.casts) {
          (ctx.events as EventDef[]).push({
            kind: 'castInterrupted',
            tick: ctx.state.tick,
            sourceId: who.id,
            skillId: cast.skillId,
            reason: 'interrupted',
          });
          (ctx.events as EventDef[]).push({
            kind: 'interruptSuccess',
            tick: ctx.state.tick,
            sourceId: actor.id,
            targetId: who.id,
            skillId: cast.skillId,
            /**
             * 打断者（`actor`）用的招式 = 触发这条效果的技能的 id
             * （`Effect.skillId`，与 `hitResolution` 里那条 `cooldown` 效果同一个字段）。
             *
             * ⚠️ 只在**有值**时写这个键（条件展开），因为
             * `ExactOptionalPropertyTypes` 下 `sourceSkillId: undefined`
             * 与"没有这个键"是两件事，而"没有招式"才是真的语义。
             * 触发器产出的眩晕没有 `skillId`，那时这个键就不该出现。
             */
            ...(effect.skillId === undefined ? {} : { sourceSkillId: effect.skillId }),
          });
        }
      }
  return;
}
