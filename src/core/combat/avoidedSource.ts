/**
 * `avoided` 事件的**"是谁挡下的"** —— 判定侧的小工具（纯函数）。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.2（炁机接回派生）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `hitResolution.ts` 顶在 AGENTS.md §3 的 700 行上限上（它已经拆出
 * `castPipeline` / `damage` / `stats` 等）。本轮要给 `avoided` 事件补一个
 * `viaBuffId`（炁机靠它区分"这次是「卸」挡的还是「闪」挡的"）——
 * 按那一条纪律：**先横向切割、不许压注释**。
 *
 * 切出来的这一块是一个完整的小职责，而且它**不需要任何引擎能力**：
 * 输入是"挨打者的 buff 列表 + 一次 applyDamage 的事件"，输出是
 * "哪个 buff + 补好字段的事件数组"。所以它能直接单测。
 *
 * ⚠️ 2026-10-13 它多回答了一个问题：**"磨掉一部分"的是哪个 buff**
 * （`>N` 的平减 → `damage.thinned`）。理由与"是谁挡下的"完全一样 ——
 * 炁机「连消带打」要问"这一次是不是**卸**吸收的"，而 `thinned > 0` 只有量。
 *
 * ==================================================================
 * ⚠️ `viaBuffId` 是**观测字段**，不参与判定
 * ==================================================================
 *
 * 挡没挡住是 `hitResolution` 里早就定好的（`invulnerable` / 阈值），
 * 本文件只回答"是哪**一个** buff"。所以它不动确定性语义、
 * 不动 `REPLAY_FORMAT_VERSION`（与 `interruptSuccess.sourceSkillId`
 * 同一条纪律，见 §7.2）。
 */

import type { BuffInstance, Combatant, EventDef } from '../types';

/**
 * **是哪个 buff 的阈值在挡这一击**（`damageThreshold` 取**最大**的那个）。
 *
 * ⚠️ 单独一个函数（而不是塞进 `blockBuffIdOf`）：两问的答案可以不同 ——
 * 同一击上既挂着无敌又挂着阈值时，"完全挡下"是无敌干的、而"磨掉一部分"
 * 只可能来自阈值。`blockBuffIdOf` 的"无敌优先"在那种情况下会**指错人**。
 *
 * 取最大值的理由与 `aggregateFlags` 同源（它就是这么合的）：判据用最大值，
 * "谁挡的"也必须同源，否则会指向一个阈值更低的 buff。
 */
export function thresholdBuffIdOf(target: Combatant): string | undefined {
  const buffs: readonly BuffInstance[] = target.buffs;
  let best: BuffInstance | undefined;
  let bestThreshold = Number.NEGATIVE_INFINITY;
  for (const buff of buffs) {
    const threshold = buff.def?.flags?.damageThreshold;
    if (threshold === undefined) continue;
    if (threshold > bestThreshold) {
      best = buff;
      bestThreshold = threshold;
    }
  }
  return best?.defId;
}

/**
 * **是哪个 buff 挡下了这一击**。
 *
 * 两个来源与 `avoided` 的判据一一对应：
 *   - `invulnerable`：取**第一个**挂着的。无敌是布尔量（多个之间没有强弱），
 *     而"哪一个"只用来区分「闪」与「避」—— 它们属于不同角色、
 *     不会同时挂在同一个人身上。
 *   - `damageThreshold`：取**最大**的那个（`thresholdBuffIdOf`）。
 *
 * 找不到就返回 `undefined`（事件里那个键不写）—— 与
 * `interruptSuccess.sourceSkillId` 同一条约定：`''` 会与"id 恰好是空串"
 * 混淆，所以宁可缺键。
 */
export function blockBuffIdOf(target: Combatant): string | undefined {
  const buffs: readonly BuffInstance[] = target.buffs;

  const invulnerable = buffs.find((b) => b.def?.flags?.invulnerable === true);
  if (invulnerable !== undefined) return invulnerable.defId;

  return thresholdBuffIdOf(target);
}

/** 这一次命中"是谁吸收的"（两个出口各自的 buff id；都可以缺）。 */
export interface AbsorbedBy {
  /** 完全挡下整击的那个 buff（写进 `avoided.viaBuffId`）。 */
  readonly blockedBy: string | undefined;
  /** 用阈值磨掉一部分的那个 buff（写进 `damage.viaBuffId`，仅 `thinned > 0`）。 */
  readonly thinnedBy: string | undefined;
}

/**
 * 这一击"**是谁吸收的**" —— 两个出口一次算好。
 *
 * ==================================================================
 * ⚠️ 必须在**结算之前**调（这是它作为函数存在的理由）
 * ==================================================================
 *
 * `avoided` / `damage` 事件由 `applyDamage` 发出，而那时挨打者的 buff 可能
 * 已经被**同一击的效果**改过（"命中附带一个 debuff"是很常见的写法）——
 * 事后回读会指向一个刚挂上去的 buff，而"是谁吸收这一击的"是**命中那一刻**
 * 的事实。所以调用方在循环之前调一次、把结果留着（`hitResolution`）。
 *
 * ⚠️ **两个出口问的不是同一个问题**（所以是两个解析器）：
 *   - `blockedBy`（完全挡下）→ `blockBuffIdOf`：无敌优先，否则取阈值最大的
 *   - `thinnedBy`（磨掉一部分）→ `thresholdBuffIdOf`：**只可能是阈值**
 *     干的（无敌不产生平减）—— 同一击上既挂无敌又挂阈值时，
 *     用 `blockBuffIdOf` 会把"磨掉一部分"记到无敌那个 buff 上。
 *
 * ⚠️ 结果里"有 thinnedBy"**不等于**"这一击被它吸收了"：挨打者挂着阈值
 * buff、而这一击没被磨掉一分也是常态。真正的判据在
 * `withAbsorbedByBuffId`（`damage.thinned > 0`）。
 */
export function absorbedByOf(target: Combatant, avoided: boolean): AbsorbedBy {
  return {
    blockedBy: avoided ? blockBuffIdOf(target) : undefined,
    thinnedBy: thresholdBuffIdOf(target),
  };
}

/**
 * 给 `applyDamage` 产出的**伤害 / 免疫**事件补上"是谁吸收的"。
 *
 * 两个出口（与 `AbsorbedBy` 一一对应）：
 *
 * | 事件 | 写什么 | 判据 |
 * |---|---|---|
 * | `avoided` | `viaBuffId = blockedBy` | 命中被整击挡下 |
 * | `damage` | `viaBuffId = thinnedBy` | **且** `thinned > 0`（>N 的平减） |
 *
 * ⚠️ `damage` 那一条**必须看 `thinned > 0`**：没有平减的伤害也会带着
 * `thinnedBy`（同一个挨打者身上可能挂着阈值 buff，却不是它磨的这一击），
 * 不看量就会把"普通挨打"标成"被卸吸收了"。
 *
 * ⚠️ 为什么是"事后补"而不是"传参进去"：`applyDamage` 是**通用**的伤害结算
 * （触发器反伤 / DoT 都走它），它不该知道"谁挡下的"—— 那是命中判定
 * （`hitResolution`）的知识。补的动作只碰上面两种事件，别的原样返回。
 *
 * ⚠️ 返回**新数组**（不改入参）：`applyDamage` 的返回值可能被调用方留着
 * （`applied.combatant` 就来自同一个对象）。
 */
export function withAbsorbedByBuffId(
  events: readonly EventDef[],
  absorbed: AbsorbedBy,
): readonly EventDef[] {
  if (absorbed.blockedBy === undefined && absorbed.thinnedBy === undefined) return events;
  return events.map((event) => {
    if (event.kind === 'avoided' && absorbed.blockedBy !== undefined) {
      return { ...event, viaBuffId: absorbed.blockedBy };
    }
    if (event.kind === 'damage' && event.thinned > 0 && absorbed.thinnedBy !== undefined) {
      return { ...event, viaBuffId: absorbed.thinnedBy };
    }
    return event;
  });
}

/* ================================================================== *
 * 反伤"是谁弹的"（2026-10-22：日志里那条"8 点反伤 · 未知来源"）
 * ================================================================== */

/**
 * **是哪个 buff 把这一击反弹回来的**。
 *
 * 判据必须与 `aggregateFlags` 同源：那里对 `reflectFraction` 取**最大值**
 * （多个来源取最强），所以"是谁弹的"也取最大 —— 否则日志会指向一条
 * 更弱的荆棘，而实际数值来自另一条。
 *
 * 找不到（这一击不是反伤）就返回 `undefined` ⇒ 事件里那个键不写。
 */
export function reflectBuffIdOf(target: Combatant): string | undefined {
  let best: BuffInstance | undefined;
  let bestFraction = 0;
  for (const buff of target.buffs) {
    const fraction = buff.def?.flags?.reflectFraction;
    if (fraction === undefined || !(fraction > 0)) continue;
    if (fraction > bestFraction) {
      best = buff;
      bestFraction = fraction;
    }
  }
  return best?.defId;
}

/**
 * 给**反伤**那几条 `damage` 事件补上"是谁弹的"。
 *
 * ⚠️ 与 `withAbsorbedByBuffId` 同一条纪律：只碰 `reflect === true` 的事件，
 * 其它原样返回（返回新数组，不改入参）。
 *
 * ⚠️ `reflectBuffId` 缺省时**不写这个键**：`''` 会与"id 恰好是空串"混淆
 * （与 `interruptSuccess.sourceSkillId` 同一条约定）。
 */
export function withReflectBuffId(
  events: readonly EventDef[],
  reflectBuffId: string | undefined,
): readonly EventDef[] {
  if (reflectBuffId === undefined) return events;
  return events.map((event) =>
    event.kind === 'damage' && event.reflect === true
      ? { ...event, reflectBuffId }
      : event,
  );
}
