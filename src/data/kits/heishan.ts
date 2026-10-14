/**
 * **「黑闪」的 buff 计时链**（炁机 `data/qiji.ts` 的 `heiShan` 用它）。
 *
 * 用户原话（2026-10-14）：
 *
 * > 类似黑闪，使用30次 **拳** 解锁，以固定间隔（1.2s，判定实现上 1.15 到1.25）
 * > 打中拳，**第二拳的伤害翻倍**，并且可以连续，这个也是**用buff实现，
 * > 记录上一次时间**
 *
 * ==================================================================
 * "记录上一次时间"= **一条 buff 的到期时刻**（不是新状态字段）
 * ==================================================================
 *
 * ```
 * 拳**打中** ──onHitDealt──▶ 挂「节拍」(1.2 秒，每次刷新)   ← 这就是"上一次时间"
 * 「节拍」到期 ──onBuffExpired──▶ 挂「黑闪」(0.1 秒，伤害 ×2)
 *                                     ↓
 *                      落在窗口里的那一拳**翻倍** ✓
 *                                     ↓
 *                      它又刷新「节拍」⇒ 保持 1.2 秒节拍就能**一直连** ✓
 * ```
 *
 * ⚠️ **窗口是 [1.2, 1.3] 秒，不是用户写的 [1.15, 1.25]** —— 原因：
 * `BuffDef.duration` 必须落在 **0.1 秒逻辑步**上（`content/timeGrid.ts`
 * 的 `OFF_GRID_TIME`，1.15 秒表达不出来）。最近的刻度选择是"**不早于**
 * 1.2 秒、最晚 1.3 秒"，它同时**顺带禁止了狂按**（按得再快也刷不出窗口）。
 * ⚠️ 实测还会再收一个 tick（见 `tests/unit/heishan.test.ts` 的实测窗口）。
 *
 * ⚠️ **"打中"而不是"按了"**：节拍挂在 `onHitDealt` 上，而它与
 * `onHitTaken` 共用"真的掉血了"（`taken > 0`）那条判据 ⇒ 被闪避的空挥
 * **不刷新**节拍。
 *
 * ⚠️ **提前打会重置节拍**（不产生窗口）：`stacking: 'replace'` 让新的一层
 * 顶掉旧的那条 —— 于是"上一次时间"永远是**最近一次命中**。这正是要的
 * 语义（节奏是"每 1.2 秒一拳"，不是"随便打，凑够 1.2 秒就行"）。
 */

import { logicMs } from '../../core/loopConstants';
import type { BuffDef } from '../../core/types';

/** 拳的技能 id（节拍只认它）。 */
export const PUNCH_SKILL_ID = 'punch';

/**
 * 「黑闪」——窗口本身（**0.1 秒**）。
 *
 * ⚠️ `damageMultBoost: 2` = **伤害 ×2**（这个字段的语义是"逐层相乘"，
 * 见 `combat/stats.ts` 的展开；贪婪的「敛财」用的是 1.1）。
 * ⚠️ 它在这 0.1 秒里放大**所有**伤害 —— 而那 0.1 秒里通常只有那一拳，
 * 所以实际效果就是"第二拳翻倍"。
 */
export const HEISHAN_WINDOW: BuffDef = {
  id: 'heishan-window',
  nameKey: 'buff.heishanWindow.name',
  icon: 'char_attack',
  polarity: 'buff',
  color: 0xf05a5a,
  duration: logicMs(1),
  maxStacks: 1,
  stacking: { mode: 'replace' },
  damageMultBoost: 2,
};

/**
 * 「节拍」——**那条"上一次时间"**。隐藏（它是内部的计时器，不是给玩家看的
 * 状态）；玩家真正该看到的是窗口那 0.1 秒。
 *
 * ⚠️ 时长 **1.2 秒**（`logicMs(12)`）= 用户要的"固定间隔"。
 */
export const HEISHAN_BEAT: BuffDef = {
  id: 'heishan-beat',
  nameKey: 'buff.heishanBeat.name',
  icon: 'char_attack',
  polarity: 'buff',
  hidden: true,
  duration: logicMs(12),
  maxStacks: 1,
  stacking: { mode: 'replace' },
};

/**
 * 炁机装给玩家的**常驻被动**：记录"拳打中了"。
 *
 * ⚠️ 它挂的时机是**战斗开始前**（`makePlayer` 的 `passiveBuffs`），
 * 所以 `appliedAtTick` 从 0 起算、整局都在。
 */
export const HEISHAN_WATCHER: BuffDef = {
  id: 'heishan-watcher',
  nameKey: 'qiji.heiShan.name',
  icon: 'char_attack',
  polarity: 'buff',
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  triggers: [
    {
      on: 'onHitDealt',
      /** ⚠️ 只认**拳**（用户："打中**拳**"）。 */
      filter: { by: 'skill', skillId: PUNCH_SKILL_ID },
      then: [{ kind: 'grant', target: { mode: 'self' }, buff: HEISHAN_BEAT }],
    },
    {
      /**
       * **节拍到期 ⇒ 窗口打开**。
       *
       * ⚠️⚠️ 挂在**这条常驻被动**上，而**不是挂在「节拍」自己身上** ——
       * 这是一个**引擎事实**（2026-10-14 踩到）：
       * `buffExpired` 的派发发生在 `expireBuffs` **之后**，而
       * `runTriggers` 只遍历**当前活着**的 buff ⇒ **一条 buff 自己的
       * `onBuffExpired` 触发器永远不可达**（它那时已经被移除了）。
       * 所以"某条 buff 过期了要做事"只能由**另一条活着的 buff** 来观察。
       *
       * ⚠️ 于是 `filter: {by:'buff'}` 是**必需的**（否则任何 buff 过期都会
       * 开窗）。这个字段此前**没有任何一处被求值**（类型里有、没人读）——
       * 同一轮把它接上了，见 `triggers.hookFilterMatches`。
       *
       * ⚠️ 只有**真的到期**才发 `buffExpired`：被"提前一拳"顶掉的那条
       * **不发**（`applyBuff` 的 `replace` 分支只换实例、不补事件）⇒
       * "提前打"**不会**白送一个窗口 ✓
       */
      on: 'onBuffExpired',
      filter: { by: 'buff', buffId: 'heishan-beat' },
      then: [{ kind: 'grant', target: { mode: 'self' }, buff: HEISHAN_WINDOW }],
    },
  ],
};
