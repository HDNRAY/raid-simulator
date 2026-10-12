/**
 * 施法流程：**读条推进 → 起手/完成时刻的能力结算 → 命中**。
 *
 * ==================================================================
 * 为什么从 `battleState.ts` 里搬出来
 * ==================================================================
 *
 * `battleState.ts` 有 1349 行（AGENTS.md §3）。这一个阶段约 465 行，
 * 而且是**完整的因果链**：
 *
 *   advanceCasts            读条逐 tick 推进，到点结算
 *     ├ applyCastStartAbilities  起手时刻（on: 'castStart'，如霸体）
 *     ├ resolveSkillHits         瞬发技能直接结算
 *     └ fireCastFinishTriggers   完成时刻（默认）的能力与触发
 *         └ pushBuffApplied      发事件
 *
 * 它原先夹在 AI / 资源 / 死亡检查之间，读者要在一千多行里反复跳。
 *
 * ==================================================================
 * 为什么是 context 接口
 * ==================================================================
 *
 * 详见 `hitResolution.ts` 的同名说明 —— 这里同样是把**真实用到**的
 * 几项写清楚，让依赖变成可见的，而不是继续散成 `this.xxx`。
 *
 * ⚠️ 工作副本（`work`）**不需要**出现在接口里：`current()` 本来就是
 * work-aware 的（先查工作副本、没有才回落到 state），所以"一次 tick
 * 内所有读写走同一个副本"这条约定由 `current` / `replaceCombatant`
 * 两个成员继续保证。
 */

import type {
  BuffDef,
  CastInstance,
  Combatant,
  EventDef,
  HitDef,
  SkillDef,
  StatKey,
} from '../types';
import { applyBuff } from '../buffs';
import type { MutableCombatant } from './battleStateTypes';
import { resolveHit } from './hitResolution';
import {
  changeResource,
  checkGate,
  hastedCastTime,
  hastedCooldown,
  payCosts,
  syncResourceGateBuff,
  type CombatContext,
} from './index';
import type { HitResolutionContext } from './hitResolution';

/** 施法流程需要的引擎能力。 */
export interface CastPipelineContext {
  readonly tick: number;
  /** 全部战斗者（`advanceCasts` 要按 id 列表遍历） */
  readonly combatants: readonly Combatant[];
  /** 事件出口 */
  readonly events: EventDef[];
  /** 内容注册表（查技能 / buff 定义） */
  readonly skills: ReadonlyMap<string, SkillDef>;
  readonly buffs: ReadonlyMap<string, BuffDef>;
  current(id: string): Combatant;
  replaceCombatant(updated: Combatant): void;
  opponentOf(id: string): Combatant | undefined;
  statsOf(combatantId: string): Readonly<Record<StatKey, number>>;
  /** 命中结算的能力包 */
  hit(): HitResolutionContext;
  /** 技能门禁用的组合上下文（`checkGate` 要它） */
  readonly combatContext: CombatContext;
}

export function advanceCasts(
  ctx: CastPipelineContext,
): void {
    // ⚠️ 遍历 **id 列表**而不是 `ctx.combatants` 的元素快照。
    //
    // 原因：`applyActions` 会用新对象替换 combatant（例如扣了炁）。
    // 如果这里持有循环开始时的旧引用，读到的是**过期状态**，
    // 随后的写回会把 applyActions 刚做的改动覆盖掉。
    // （症状：`resourceChanged` 事件发了，但资源回到原值。）
    for (const id of ctx.combatants.map((c: Combatant) => c.id)) {
      const actor = ctx.current(id);
      if (actor.casts.length === 0) continue;

      const stillCasting: CastInstance[] = [];

      // 同样遍历副本：循环体里 resolveHit 会改状态
      for (const cast of [...actor.casts]) {
        // 来源消失（技能被移除）→ 立即中断。见 i18n/数据模型规范 §7.2 规则 4
        const skill = ctx.skills.get(cast.skillId);
        if (!skill) {
          ctx.events.push({
            kind: 'castInterrupted',
            tick: ctx.tick,
            sourceId: actor.id,
            skillId: cast.skillId,
            reason: 'sourceLost',
          });
          continue;
        }

        /**
         * **刚在本 tick 创建的读条不结算**（进度从下一帧开始算）。
         *
         * 踩过的坑：「斩」的 `hit.at` 是 0（伤害在读条结束时结算），
         * 而读条创建后**同一个 tick** 就会被推进到这里 ——
         * `elapsedMs = 0`、`0 <= 0` 成立，于是伤害**立刻**打出去，
         * 读条形同虚设（实测按下「斩」当场掉 10 血）。
         *
         * 从"读条"的语义看这也更对：读条是跨时间的动作，
         * 它不应该在开始的那一帧就完成。
         */
        if (cast.startedAtTick === ctx.tick) {
          stillCasting.push(cast);
          continue;
        }

        const elapsedMs = (ctx.tick - cast.startedAtTick) * (1000 / 60);

        /**
         * ⚠️ **读条没走完，任何 hit 都不许结算。**
         *
         * 这是需求"所有技能的效果，如果要读条，都应该在读条之后"的
         * 技术落地，也是踩出来的 bug：
         *
         * 原先的条件只有 `hit.at <= elapsedMs`。而**玩家技能的 `at` 是 0**
         * （「斩」「轰」都写 `at: 0`）—— 于是读条创建后的**下一 tick**
         * 就满足 `0 <= 16.67`，伤害当场结算，读条形同虚设。
         *
         * 观感上就是"读条还在走、血已经掉了"（Boss 与玩家两边都有，
         * 玩家的最明显：按下「斩」血就掉）。
         *
         * 现在多一个 `elapsedMs >= cast.castTimeMs` 的前提：
         *   - 读条技能的 `at` 语义变成"读条走完之后的第几毫秒"
         *     （Boss 技能本来就写 `at === castTime`，行为不变）
         *   - 瞬发技能（`castTime === 0`）不走这里，仍由
         *     `resolveSkillHits` 立即结算
         *
         * 注意 `castTimeMs` 是**已经算过急速**的值，所以这条判断
         * 对急速同样成立。
         */
        const castDone = elapsedMs >= cast.castTimeMs;
        const dueHits = skill.hits.filter(
          (hit: HitDef, index: number) =>
            index >= cast.resolvedHits && castDone && hit.at <= elapsedMs,
        );

        /**
         * ⚠️ **顺序很重要：先发 `castFinished`，再结算伤害。**
         *
         * 需求："所有技能的效果，如果要读条，都应该在读条之后。"
         *
         * 事件顺序是这句话最直接的证据 —— 消费者（渲染层的飘字、
         * 测试里的断言、未来的日志）都按事件顺序理解发生了什么。
         * 原先伤害先发、`castFinished` 后发，于是时间线上看起来
         * 仍然是"伤害在读条结束之前"。
         */
        const finished = elapsedMs >= cast.castTimeMs;
        if (finished) {
          ctx.events.push({
            kind: 'castFinished',
            tick: ctx.tick,
            sourceId: actor.id,
            skillId: cast.skillId,
          });
          fireCastFinishTriggers(ctx, actor, skill);
        }

        // CastInstance 是 readonly（状态设计如此），所以用新对象推进计数
        let resolved = cast.resolvedHits;
        for (const hit of dueHits) {
          resolveHit(ctx.hit(), actor, skill, hit);
          resolved += 1;
        }

        if (!finished) {
          stillCasting.push({ ...cast, resolvedHits: resolved });
        }
      }

      // ⚠️ 用**当前 state** 而不是循环开头缓存的 `next`：
      // resolveHit 会在循环中间修改双方状态（扣血、挂 buff），
      // 写回旧快照会把那些改动覆盖掉。
      ctx.replaceCombatant({ ...ctx.current(actor.id), casts: stillCasting });
    }
  }

  /**
   * 结算 `on: 'castStart'` 的能力。
   *
   * 与 `fireCastFinishTriggers` 是**两套**：那个处理"完成时的结果"，
   * 这个处理"施法期间的状态"。分成两个方法而不是加一个参数，
   * 是因为它们的**写入对象不同** —— 完成时的结算必须操作累积对象
   * （见那里的长注释），而起手时 `state` 已经是最新的。
   */
export function applyCastStartAbilities(
  ctx: CastPipelineContext,
  skill: SkillDef,
  actorId: string,
): void {
    for (const ability of skill.abilities) {
      if (ability.kind !== 'grant' || ability.on !== 'castStart') continue;
      const targetId = ability.target.mode === 'self' ? actorId : (ctx.opponentOf(actorId)?.id ?? actorId);
      const target = ctx.current(targetId);
      const applied = applyBuff(target, ability.buff, actorId, ctx.tick);
      ctx.replaceCombatant({ ...target, buffs: applied.buffs });
      ctx.events.push({
        kind: 'buffApplied',
        tick: ctx.tick,
        targetId,
        buffId: ability.buff.id,
        stacks: applied.stacks,
        sourceId: actorId,
      });
    }
  }

  /** 瞬发技能：立刻结算全部 hit 段。 */
export function resolveSkillHits(
  ctx: CastPipelineContext,
  actor: Combatant,
  skill: SkillDef,
): void {
    for (const hit of skill.hits) {
      resolveHit(ctx.hit(), actor, skill, hit);
    }
    fireCastFinishTriggers(ctx, actor, skill);
  }

  /**
   * 技能完成时结算它自己的 abilities。
   *
   * 两种形态都要处理，**不能只处理 trigger**：
   *
   *   1. **直接 grant**：`{ kind:'grant', buff: dodgeBuff }`
   *      —— 闪避 / 卸力这类"用了就给自己挂 buff"的技能走这条。
   *      （踩过的坑：一开始只实现了 trigger 形态，于是 dodge 施放成功
   *        但 buff 从未挂上，表现为"闪避没效果"。）
   *   2. **trigger onCastFinish**：派生窗口走这条。
   */
  /**
   * 结算技能自带的 abilities。
   *
   * ⚠️ 这里**必须操作传入的累积对象 `actor`，不能回读 `this.current()`**。
   *
   * 踩过的坑：回读会拿到 state 里的旧版本（此时冷却还没写回），
   * 于是挂上 buff 后用旧的 buffs 数组整条覆盖回去 ——
   * 表现为"dodge 施放成功、buffApplied 事件也发了，但 buff 立刻消失"。
   *
   * 所以：改动累积对象 → 同步到 state → 继续改。
   */
export function fireCastFinishTriggers(
  ctx: CastPipelineContext,
  actor: Combatant,
  skill: SkillDef,
): void {
    /**
     * 本次结算的**唯一工作副本**。
     *
     * ⚠️ 这是踩坑最密集的地方，规则只有一条但必须严格遵守：
     * **每改一次 state，就立刻把 working 同步成最新版本。**
     *
     * 违反它会怎样：working 是方法开头捕获的旧对象，
     * 方法末尾又用它写回 —— 中间所有改动（挂 buff、加炁）全被抹掉。
     * 症状是"`resourceChanged` / `buffApplied` 事件都发了，但状态没变"，
     * 极难从事件流上看出来。
     */
    let working = ctx.current(actor.id);

    /** 改 working 并同步到工作副本（单一入口，避免忘记同步）。 */
    const commit = (next: Combatant): void => {
      working = next as MutableCombatant;
      ctx.replaceCombatant(next);
    };

    const targetIdOf = (mode: string): string =>
      mode === 'self' ? working.id : (ctx.opponentOf(working.id)?.id ?? working.id);

    const grantTo = (buff: BuffDef, targetId: string): void => {
      if (targetId === working.id) {
        const applied = applyBuff(working, buff, working.id, ctx.tick);
        commit({ ...working, buffs: applied.buffs });
        pushBuffApplied(ctx, working.id, buff.id, applied.stacks);
        return;
      }
      const target = ctx.current(targetId);
      const applied = applyBuff(target, buff, working.id, ctx.tick);
      commit({ ...target, buffs: applied.buffs });
      pushBuffApplied(ctx, target.id, buff.id, applied.stacks);
    };

    /**
     * 把一个 buff 加到**施法者以外的目标**上（会被打上施法者来源）。
     *
     * 用于"大招打中后给 Boss 挂易伤"这类内容 —— 与 grantTo 的区别是
     * `sourceId` 记成施法者而不是目标自己。
     */
    const applyBuffTo = (buff: BuffDef, targetId: string): void => {
      const target = targetId === working.id ? working : ctx.current(targetId);
      const applied = applyBuff(target, buff, working.id, ctx.tick);
      commit({ ...target, buffs: applied.buffs });
      ctx.events.push({
        kind: 'buffApplied',
        tick: ctx.tick,
        targetId: target.id,
        buffId: buff.id,
        stacks: applied.stacks,
        sourceId: working.id,
      });
    };

    /** 加入一个 buff 实例（用对象字面量直接写内容，不必先定义 BuffDef）。 */
    const addBuff = (buff: BuffDef, targetId: string): void => applyBuffTo(buff, targetId);

    /**
     * 炁满时自动挂上的标记 buff。
     *
     * 为什么需要它：终结技的门槛是"炁已满"，而 `requires` 只能检查
     * buff / 资源阈值。用一条"满炁"标记 buff 表达它，内容层就能写
     * `requires: [{ kind:'hasBuff', buffId:'douqi-full' }]` ——
     * **不用给引擎加新条件类型**（这正是可扩展性的验证方式）。
     */
    const syncDouqiFull = (): void => {
      const result = syncResourceGateBuff(working, 'douqi', 'douqi-full', {
        id: 'douqi-full',
        nameKey: 'resource.douqi',
        icon: 'buff_douqi',
        polarity: 'buff',
        color: 0xffd050,
        duration: Number.POSITIVE_INFINITY,
        maxStacks: 1,
        stacking: { mode: 'refresh' },
      });
      if (result) {
        commit({ ...working, buffs: result.buffs });
        for (const e of result.events) ctx.events.push(e);
      }
    };

    const grantResource = (resource: string, delta: number, targetId: string): void => {
      if (delta === 0) return;
      const target = targetId === working.id ? working : ctx.current(targetId);
      const result = changeResource(target, resource, delta, ctx.tick);
      commit(result.combatant);
      ctx.events.push(...result.events);
    };

    /**
     * ⚠️ 这里只结算**读条完成**时刻的能力。
     *
     * `on: 'castStart'` 的那组在起手时就结算过了（见 `tryUseSkill`），
     * 如果在完成时再算一次，霸体会被刷新成"从完成时刻起算"——
     * 那正好把"整个前摇都免疫"这个语义破坏掉。
     */
    for (const ability of skill.abilities) {
      if (ability.kind === 'grant' && ability.on === 'castStart') continue;
      if (ability.kind === 'grant') {
        grantTo(ability.buff, targetIdOf(ability.target.mode));
        continue;
      }

      if (ability.kind === 'resource') {
        // 一次性资源变动（"基础技产生 18 点炁"）。
        // 与 `douqiRegen` 修正的区别：那是持续速率，这是一次性。
        const delta = typeof ability.delta === 'number' ? ability.delta : 0;
        grantResource(ability.resource, delta, targetIdOf(ability.target.mode));
        syncDouqiFull();
        continue;
      }

      if (ability.kind === 'trigger') {
        if (ability.trigger.on !== 'onCastFinish') continue;
        for (const then of ability.trigger.then) {
          if (then.kind === 'grant') grantTo(then.buff, targetIdOf(then.target.mode));
          if (then.kind === 'resource') {
            const delta = typeof then.delta === 'number' ? then.delta : 0;
            grantResource(then.resource, delta, targetIdOf(then.target.mode));
            syncDouqiFull();
          }
        }
      }
    }

    // 本次结算结束后复查一次：内容可能直接写了 addBuff 形式的标记
    void addBuff;
  }

export function pushBuffApplied(
  ctx: CastPipelineContext,
  targetId: string,
  buffId: string,
  stacks: number,
): void {
    ctx.events.push({
      kind: 'buffApplied',
      tick: ctx.tick,
      targetId,
      buffId,
      stacks,
      sourceId: targetId,
    });
  }

export function tryUseSkill(
  ctx: CastPipelineContext,
  skillId: string,
  actorId: string,
): void {
    /**
     * ⚠️ 必须从**工作副本**读 actor，不能读 `ctx.state`。
     *
     * 踩过的坑：同一 tick 内的第二个技能会读到"还没扣掉代价"的旧状态，
     * 于是 `strike` 和 `riposte` 能在**同一个 tick 里都施放成功** ——
     * 门禁形同虚设，实测 DPS 因此虚高 3 倍以上。
     *
     * 教训与工作副本那条一致：一次 tick 内的所有读写都必须走同一个副本。
     */
    let actor = ctx.current(actorId);

    const skill = ctx.skills.get(skillId);
    if (!skill) return;

    const stats = ctx.statsOf(actor.id);
    const opponent = ctx.opponentOf(actor.id);

    /**
     * 谁能打断读条：**只有瞬发技能**。
     *
     * ------------------------------------------------------------------
     * 规则（需求明确）
     * ------------------------------------------------------------------
     *
     *   - **瞬发**（`castTime === 0`）：读条中放行 → 打断当前读条。
     *     包括「闪」「破」「凝」，以及**「防」这种按住型**。
     *   - **有读条的**（攻 / 轰）：读条中被 `casting` 拒绝，
     *     所以**不会**打断自己，必须等当前读条结束。
     *
     * 这条规则很自然：读条技能之间互相打断会让"读条"失去意义
     * （永远在被打断，永远读不完）；而瞬发技能本来就是"零耗时"的
     * 应对手段（闪避、打断、增益），随时可用才合理。
     *
     * 踩过的坑：早期这里写的是 `!isHold`，方向正好取反 —— 变成
     * "只有按住型被拒绝、其它全部放行"，与需求完全相反。
     */
    const isInstant = skill.castTime === 0;

    /* ------------------------------------------------------------------ *
     * 读条中施放**其它**技能 → 打断当前读条。
     *
     * 需求：「读条的时候如果使用其他技能，就打断当前的读条」。
     *
     * 这是删掉公共冷却之后的**主要限速机制**，也是"攻 / 轰 要挑空档"
     * 这一博弈的来源。注意代价在开始读条时就已扣除、**中断不退** ——
     * 所以"酝酿大招被打断"是有真实损失的。
     * ------------------------------------------------------------------ */

    // 先做门禁检查（含资源、冷却）
    const gate = checkGate(actor, skill, ctx.combatContext, {
      hasTarget: opponent !== undefined,
      allowedWhileCasting: isInstant,
    });

    /**
     * ⚠️ 顺序很重要：**门禁通过之后才能打断**。
     *
     * 踩过的坑：早期把打断放在门禁之前，于是"资源不足被拒绝"也会
     * 顺手把正在读的条打断 —— 玩家按下幻想的「轰」（缠不够），
     * 结果连「斩」的读条也没了。用日志才看出来：同一 tick 里
     * 先 `castInterrupted`、再 `skillRejected`。
     */
    /**
     * **瞬发技能都会打断自己的读条** —— 包括「闪」（需求明确）。
     *
     * 我一度给「闪」开了豁免（"瞬发自保不该有双重代价"），
     * 但需求要的是它**必须**打断：读条中按闪避 = 放弃这次输出
     * 换取生存，这个取舍本身就是玩法。
     *
     * ⚠️ 代价确实很大（放弃这次读条 ≈10 伤 + 闪避本身的 15 炁），所以给「闪」
     * 加了 **1 秒冷却** —— 既保留"要打断"的取舍，又避免连按浪费。
     */
    const isDefensiveReaction = false;
    if (gate.ok && actor.casts.length > 0 && !isDefensiveReaction) {
      for (const cast of actor.casts) {
        ctx.events.push({
          kind: 'castInterrupted',
          tick: ctx.tick,
          sourceId: actor.id,
          skillId: cast.skillId,
          reason: 'replaced',
        });
      }
      ctx.replaceCombatant({ ...actor, casts: [] });
      actor = ctx.current(actor.id);
    }

    if (!gate.ok) {
      ctx.events.push({
        kind: 'skillRejected',
        tick: ctx.tick,
        sourceId: actor.id,
        skillId,
        reason: gate.reason ?? 'condition',
      });
      return;
    }

    // 扣代价
    const paid = payCosts(actor, skill, ctx.tick);
    ctx.events.push(...paid.events);
    let next = paid.combatant;

    // 技能冷却（受急速影响）
    if (skill.cooldown > 0) {
      const cooldownMs = hastedCooldown(skill.cooldown, stats);
      const readyAt = ctx.tick + Math.round(cooldownMs / (1000 / 60));
      next = { ...next, cooldowns: { ...next.cooldowns, [skillId]: readyAt } };
    }

    // 记使用次数
    next = { ...next, uses: { ...next.uses, [skillId]: (next.uses[skillId] ?? 0) + 1 } };

    // 读条 or 立刻结算。
    //
    // ⚠️ 状态写回只有两处，且**互斥**。这个方法是踩坑最密集的地方，
    // 记录一下根因：早先的版本在方法末尾统一写回 `next`，而
    // `resolveSkillHits` 也会通过 replaceCombatant 改 state，
    // 于是最后那次写回把刚挂上的 buff / 刚扣的血全部覆盖掉
    // ——表现为"事件发了但状态没变"。教训：**一个方法里只在一个地方
    // 写回同一个对象**，或者干脆让下游函数自己写。
    const castTimeMs = hastedCastTime(skill.castTime, stats);
    if (castTimeMs > 0) {
      // 读条：把 cast 写回 state 即可，hit 由 advanceCasts 逐段结算
      ctx.replaceCombatant({
        ...next,
        casts: [
          ...next.casts,
          {
            skillId,
            startedAtTick: ctx.tick,
            castTimeMs,
            resolvedHits: 0,
            interruptible: skill.interruptible,
          },
        ],
      });
      ctx.events.push({
        kind: 'castStarted',
        tick: ctx.tick,
        sourceId: actor.id,
        skillId,
      });
      /**
       * **起手就生效**的能力（`on: 'castStart'`）。
       *
       * 需求："重斩加上霸体标签和霸体效果" —— 霸体的意义是"整个前摇
       * 打不断"，所以它必须在起手时挂上。之前 skills 的 abilities 只在
       * 读条**完成**时结算，于是前摇期间照样能被「破」打断，
       * 霸体等于没有（实测确认过）。
       *
       * 时机放在 `castStarted` 事件之后：事件流上读起来是
       * "开始了 → 因此获得霸体"，消费者按顺序理解不会歧义。
       */
      applyCastStartAbilities(ctx, skill, actor.id);
    } else {
      // 瞬发：先同步冷却，再结算 —— 之后**不再写回**
      ctx.replaceCombatant(next);
      resolveSkillHits(ctx, next, skill);
    }

    ctx.events.push({
      kind: 'skillUsed',
      tick: ctx.tick,
      sourceId: actor.id,
      skillId,
    });
  }
