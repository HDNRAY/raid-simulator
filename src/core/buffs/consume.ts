/**
 * **buff 的消费结算**：把"这一 tick 发生在某人身上的事"翻译成
 * "谁身上的哪个 buff 该消失"。
 *
 * ==================================================================
 * 这个文件是什么（一句话）
 * ==================================================================
 *
 * 它读**已经发生完的事件流**，按每个 buff 自己的 `consume.on` 决定
 * 要不要把它消费掉 —— 判定与改状态都在这里，不依赖引擎的其它能力
 * （所以能在 Node 里直接单测）。
 *
 * ==================================================================
 * ⚠️ 为什么是"扫事件"而不是在每个判定点各写一行
 * ==================================================================
 *
 * 与 `combat/buffHookDispatch.ts` 同一条理由：引擎里"一次攻击打出来了"
 * 的证据出现在好几条路径上（`resolveHit` 的伤害分支、触发器的反伤、
 * 未来的 DoT…），逐处插一行"记得消费 buff"**必然漏掉某一处**，
 * 而漏掉的表现是静默的（那个 buff 不消失，下一击还能再吃一次）。
 *
 * 所以以**事件**为准：任何路径造成了伤害 / 闪避 / 挡下，消费都会发生，
 * 将来新增路径也不例外。
 *
 * ==================================================================
 * ⚠️ 它取代的是"消耗方手写 removeBuff"
 * ==================================================================
 *
 * 在它之前，内容作者要表达"用掉就消耗"只能在**每个会造成伤害的技能**
 * 的 `hits[].effects` 里写一条 `removeBuff`。那是一份跨文件的契约：
 * 加一个攻击技能忘记写 → 静默失效，而且只在"玩家选了某条炁机"时才发生。
 *
 * 现在真相只有一处：buff 自己的 `consume.on`（类型见
 * `types/buffs.ts` 的 `BuffConsumeTrigger`）。攻击技能**不需要知道**
 * 任何 buff 的存在 —— 「避实击虚」的迁移就是这么做的
 * （`data/kits/dodgeCharge.ts`）。
 *
 * ⚠️ 两条纪律与它同源：
 *   - `removeBuff` 效果**没有被删** —— 它仍然表达"**某一次特定的命中**
 *     要移除某个 buff"（例如 Boss 的反伤消耗自己的印记，那条效果写在
 *     `data/lustBoss.ts` 的反伤命中里）。删掉它是另一件事。
 *   - 本模块**不认 buff id** —— 判据只有 `consume.on`，所以新 buff
 *     天然支持这四个触发，不需要改这里。
 */

import type {
  BuffConsumeTrigger,
  BuffDef,
  BuffId,
  BuffInstance,
  Combatant,
  EventDef,
} from '../types';

/**
 * **这一 tick 发生在某个战斗者身上的事**（消费的输入）。
 *
 * 四个字段与 `BuffConsumeTrigger` 一一对应 —— 但判据只有一处来源：
 * 两者都从下面这个函数里对事件的解读得出。所以"哪一刻算打出去了"
 * 只有一个答案。
 */
export interface ConsumeFacts {
  /** 它**打出了**一次伤害（`damage.sourceId === 它`）。 */
  readonly attacked: boolean;
  /** 它**挨了**一次伤害（`damage.targetId === 它`）。 */
  readonly damaged: boolean;
  /** 它**闪掉了**一击（`avoided` + `invulnerable` 判据）。 */
  readonly dodged: boolean;
  /** 它**挡下了**一击（`avoided` + `damageThreshold` 判据）。 */
  readonly blocked: boolean;
}

/** 四个触发名 → `ConsumeFacts` 的字段名。 */
const TRIGGER_SOURCES: Readonly<Record<BuffConsumeTrigger, keyof ConsumeFacts>> = {
  onAttack: 'attacked',
  onDamaged: 'damaged',
  onDodge: 'dodged',
  onBlock: 'blocked',
};

/**
 * 从事件流里读出**某个战斗者**在这一 tick 发生了什么。
 *
 * ==================================================================
 * 判据逐条（这几行就是"什么叫被攻击 / 被受击 / 被闪避 / 被格挡"）
 * ==================================================================
 *
 * `attacked` / `damaged`：都要求**真的掉血了**（`amount > 0`）。
 *   - 被闪掉 / 被整击挡下的命中**没有** `damage` 事件（`applyDamage`
 *     在 `avoided` 分支只发 `avoided`），所以它们天然不算"打出去了"
 *     —— 与 `onHitTaken` 触发器同一条口径（"没碰到人就不算受击"）。
 *   - `attacked` 还要求 `skillId !== ''`：触发器产出的**反伤**不算
 *     "你攻击了一次"（它是 `reflect: true` 的伤害事件，若算作攻击，
 *     "挂着反伤的 Boss"会用自己的反伤消耗掉自己的攻击 buff）。
 *
 * `dodged` / `blocked`：两者都是 `avoided` 事件，靠**挡下这一击的 buff**
 * 区分（`avoided.viaBuffId` → 那个 buff 的 `flags`）：
 *
 *   | 挡下的机制 | buff 的 flag | 判定 |
 *   |---|---|---|
 *   | 无敌（「闪」/「避」/「卸」的 `≤N`） | `invulnerable` | `dodged` |
 *   | 阈值平减（「卸」的「按住」） | `damageThreshold` | `blocked` |
 *
 * ⚠️ **不要用 `avoided.reason` 区分二者** —— 它是一个**粗粒度**字段，
 * 只回答"这一击是不是被完全免掉了"（`'dodged'` = 没有挡住机制、
 * 单纯被判定为落空；`'immune'` = 有机制挡下了）。而引擎里**两种挡下**
 * 都发 `'immune'`：`hitResolution` 对「卸」的阈值整击作废写的是
 * `avoidReason: 'invulnerable'`（复用无敌那条通路，见那里的说明）。
 * 只看 `reason` 会把"格挡"认成"闪避"——这正是本次实测发现的那个坑。
 *
 * 所以判据是 `viaBuffId` 指向的 buff 自己的 flag：**谁挡下的，按谁的
 * 语义算**。这也与 `blockBuffIdOf` 的"取最大值 / 取第一个"同源
 * （它就是 `viaBuffId` 的生产者）。
 *
 * ⚠️ 解析不到那个 buff（`viaBuffId` 缺失 / buff 已经被同一 tick 的效果
 * 移除）时**不猜**：宁可两条都不算，也不要把它错算成闪避（那会消费掉
 * 一个本不该动的 buff）。缺 `viaBuffId` 只可能是触发器等来源的免伤，
 * 那种来源没有"哪个 buff"可言。
 *
 * ⚠️ 只认 `tick === tick` 的事件：`events` 数组跨 tick 累积（由
 * `drainEvents` 清空），不按 tick 过滤就会把上一 tick 的攻击算进来。
 */
export function consumeFactsFor(
  combatant: Combatant,
  events: readonly EventDef[],
  tick: number,
): ConsumeFacts {
  let attacked = false;
  let damaged = false;
  let dodged = false;
  let blocked = false;

  for (const event of events) {
    if (event.tick !== tick) continue;

    if (event.kind === 'damage') {
      if (event.amount > 0) {
        if (event.sourceId === combatant.id && event.skillId !== '') attacked = true;
        if (event.targetId === combatant.id) damaged = true;
      }
      continue;
    }

    if (event.kind === 'avoided' && event.targetId === combatant.id) {
      const by = event.viaBuffId;
      if (by === undefined) continue;
      const instance = combatant.buffs.find((b) => b.defId === by);
      if (instance?.def?.flags?.invulnerable === true) dodged = true;
      else if (instance?.def?.flags?.damageThreshold !== undefined) blocked = true;
    }
  }

  return { attacked, damaged, dodged, blocked };
}

/**
 * 某个 buff 的 `consume.on` 里，**这一 tick 真的发生了**的那几条。
 *
 * 返回**原始触发名**（不是布尔），因为报事件与测试都要说
 * "是哪一条触发把它消耗掉的"。
 *
 * ⚠️ 顺序是 `buff.consume.on` **自己的顺序**（不是 `TRIGGER_SOURCES` 的），
 * 这样内容作者读到的第一条就是命中的第一条 —— 而内容定义是不可变的，
 * 顺序因此是稳定的（重放友好）。
 */
export function matchedConsumeTriggers(
  def: BuffDef,
  facts: ConsumeFacts,
): readonly BuffConsumeTrigger[] {
  const rule = def.consume;
  if (rule === undefined) return [];
  const matched: BuffConsumeTrigger[] = [];
  for (const trigger of rule.on) {
    if (facts[TRIGGER_SOURCES[trigger]]) matched.push(trigger);
  }
  return matched;
}

/** 一次消费：新的 buff 列表 + 真的发生了什么（发事件用）。 */
export interface ConsumeOutcome {
  readonly buffs: readonly BuffInstance[];
  /**
   * 被完全移除的实例（层数归零）—— 每一个都要发一条 `buffExpired`。
   *
   * 与"到点过期"（`expireBuffs`）走**同一种事件**：对 UI / 日志 /
   * `onBuffExpired` 触发器来说，"用掉了"与"到点了"都是"这个 buff 结束了"。
   */
  readonly expired: readonly BuffInstance[];
  /**
   * 只是掉了层、仍存在的实例（`consume.stacks` 的部分消费）。
   * 调用方据此发 `buffStackChanged`。
   */
  readonly stackChanged: readonly BuffInstance[];
}

/**
 * **按 `consume` 规则消费掉一个战斗者身上该消费的 buff**（纯函数）。
 *
 * 每个 buff 每个 tick 最多消费**一次**（见 `matchedConsumeTriggers`）：
 * 同一 tick 里既命中了又挨打了也只扣一次，否则消耗速度会取决于
 * "这一 tick 有几段命中"，而玩家看到的是一次技能。
 *
 * `consume.stacks`：
 *   - 不写 → 整个 buff 消失（一次性的蓄势 / 窗口）
 *   - `n`  → 扣 `n` 层；扣到 0 才消失（"N 层护盾，挨一下碎一层"）
 *
 * ⚠️ `independent` 叠层下消费的单位是**实例**，不是层：那种模式里
 * **每个实例只有 1 层**（"各自计时"就是靠多实例表达的，见 `BuffDef` 的
 * `StackingRule` 注释）。所以：
 *   - `independent` + 不写 `stacks` → 全部实例消失（"用掉就没了"）
 *   - `independent` + `stacks: 1`    → 掉**一个**实例，从**最接近自然
 *     过期**的那个开始（先施加的先没，与"先到期"同序）
 *   - `independent` + `stacks: n`    → 掉 n 个实例（同一 tick 只消费一次）
 *
 *   ⚠️ 这里容易写错（本文件的第一次实现就写错了）：若把"1 层实例"按
 *   `amount >= stacks` 当成"层数归零"处理，`stacks: 1` 会**一次删光所有
 *   实例** —— 而作者写 `stacks: 1` 的意思恰恰是"一次掉一层"。所以那两种
 *   模式在代码里是**分开**的分支。
 */
export function applyConsume(
  combatant: Combatant,
  defs: ReadonlyMap<BuffId, BuffDef>,
  facts: ConsumeFacts,
): ConsumeOutcome {
  let buffs: readonly BuffInstance[] = combatant.buffs;
  const expired: BuffInstance[] = [];
  const stackChanged: BuffInstance[] = [];

  /** 已经处理过的 buff defId —— 同一个 buff 每 tick 只消费一次。 */
  const done = new Set<BuffId>();

  for (const buff of combatant.buffs) {
    if (done.has(buff.defId)) continue;
    const def = defs.get(buff.defId) ?? buff.def;
    if (def === undefined) continue;
    if (matchedConsumeTriggers(def, facts).length === 0) continue;

    done.add(buff.defId);
    const rule = def.consume;
    const amount = rule?.stacks;

    /**
     * 整条消失有两种情况（都不看层数）：
     *   - 没写 `stacks`：这个 buff 的语义就是"用掉就没了"（一次性的蓄势 / 窗口）
     *   - `independent`：每个实例**只有 1 层**，"消费"的单位本来就是**实例**
     *     （所以 `stacks: 1` 在那里恰恰是"一次掉一层" = 掉一个实例）
     */
    const wholeBuff =
      amount === undefined || def.stacking.mode === 'independent';

    if (wholeBuff) {
      /**
       * 一次消费掉几个实例：`stacks` 不写 = 全部（"用掉就没了"）；
       * `independent` 写了 `stacks: n` = 掉 n 个（从最接近自然消失的开始）。
       */
      const instances = buffs.filter((b) => b.defId === buff.defId);
      const take = amount === undefined ? instances.length : Math.min(amount, instances.length);
      const removed = [...instances]
        .sort((a, b) => a.expiresAtTick - b.expiresAtTick)
        .slice(0, take);
      const removedIds = new Set(removed.map((b) => b.instanceId));
      expired.push(...removed);
      buffs = buffs.filter((b) => !removedIds.has(b.instanceId));
      continue;
    }

    // 部分消费：多层实例扣层数（层数归零才消失）
    const target = buffs.find((b) => b.defId === buff.defId);
    if (target === undefined) continue;
    if (target.stacks <= amount) {
      expired.push(target);
      buffs = buffs.filter((b) => b !== target);
      continue;
    }
    const updated: BuffInstance = { ...target, stacks: target.stacks - amount };
    buffs = buffs.map((b) => (b === target ? updated : b));
    stackChanged.push(updated);
  }

  return { buffs, expired, stackChanged };
}
