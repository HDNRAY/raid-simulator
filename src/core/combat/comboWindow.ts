/**
 * **派生窗口的产出者** —— 「截」成功打断之后开窗口，「击」才可用。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.2（炁机接回派生）。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把"**某个技能成功用出来了**"翻译成"**给玩家挂上派生窗口 buff**"。
 * 判定读完就完了，它不改任何别的状态。
 *
 * ==================================================================
 * ⚠️ 为什么这段住在引擎里，而不是写在技能内容里
 * ==================================================================
 *
 * 2026-10-12 用户要求"把现在的截的派生去掉"，理由写在
 * `data/kits/combo.ts` 的文件头 —— 派生不能白送，它是**炁机**给的。
 * 于是「截」的 `hits[].effects[].onSuccess` 里**没有** `grantBuff`，
 * 那条链断了。
 *
 * 接回来的位置只有两个候选：
 *
 * | 候选 | 为什么不行 |
 * |---|---|
 * | 炁机内容里的 `Ability`（`grant` / `trigger`） | 那些执行点跑在**技能自己的** `abilities` 上，而解锁是"按 id 打开一个开关"。用 `trigger onCastFinish` 会在**每一次**施放都开窗口（包括打空的那次），用 `filter: {by:'skill'}` 又需要引擎知道"哪个技能正在结算" —— 两处都要造第二套判据 |
 * | **本文件（引擎里唯一的产出者）** | 判据只有一处：**成功事件**（打断成功 / 卸挡下 / 闪无敌生效）里带着 `sourceSkillId`，拿它去对"这一局开了哪几个窗口"。 |
 *
 * ⚠️ **"成功"的定义逐条写死**（免得下一个人以为漏了）：
 *
 * | 源技能 | 什么叫成功 | 依据事件 |
 * |---|---|---|
 * | 「截」 | **真的打断了**一个读条 | `interruptSuccess.sourceSkillId === 'jie'` |
 * | 「卸」 | 阈值**挡下了整击**（`≤N`） | `avoided.viaBuffId === 'guard'` |
 * | 「闪」 | 无敌窗口**真的吃掉了一击** | `avoided.viaBuffId === 'flash-iframe'` |
 *
 * 三个都是"玩家做成了某件事"才开的窗口 —— 打空 / 没挨打都不开。
 * 这与用户在 §5.2 反复强调的"**有代价的选择**"是同一条：
 * 窗口本身就是那个回报。
 *
 * ==================================================================
 * ⚠️ 事件字段：`sourceSkillId` / `viaBuffId` 都是**观测字段**
 * ==================================================================
 *
 * `interruptSuccess.sourceSkillId`（**③**，P0 已做）与
 * `avoided.viaBuffId`（本轮加的）都**不参与伤害 / 命中的任何判定**：
 * 它们只被"谁打出了这一下"这类消费者读（统计、日志、本文件）。
 * 所以它们的加入**不改变确定性语义**，`REPLAY_FORMAT_VERSION` 保持 2
 * （判据见 `docs/specs/2026-10-12-roguelike.md` §7.2 的两张表）。
 *
 * ⚠️ 反过来：本模块**是**判定（它决定挂不挂 buff），但它的输入是
 * **已经算完的事件**，而且只有"这一局开了窗口"这一个开关 ——
 * 没有窗口时它对战斗是**完全的空操作**（一条事件都不产生）。
 * 黄金重放（没有炁机）因此逐位不变。
 */

import type { EventDef } from '../events';

/**
 * 一个"派生窗口产出者"：**哪个技能成功时开哪个窗口**。
 *
 * 一局里可以有几个（理论上截 / 卸 / 闪各一个），但**同一个源技能只有一个**
 * —— 判据是 `sourceSkillId`，`comboWindowsFor` 只取第一个匹配的。
 * 这与"同一个 buff id 不能被两个东西同时挂"是同一条一致性要求。
 */
export interface ComboWindowSpec {
  /** 成功之后开哪个 buff（派生技的 `requires` 认的就是它）。 */
  readonly buffId: string;
  /** **哪个技能**成功时开窗口（「截」= `'jie'` / 「卸」= `'guard'` / 「闪」= `'flash'`）。 */
  readonly sourceSkillId: string;
  /**
   * 可选的"第二条成功通道"：**这个 buff 挡下整击**时也算成功。
   *
   * 用途：「卸」的阈值（`buff id = 'guard'`）与「闪」的无敌
   * （`buff id = 'flash-iframe'`）都不是"打断"，它们从来没有
   * `interruptSuccess` 事件 —— 它们的成功证据是 `avoided.viaBuffId`。
   *
   * ⚠️ 不给这个字段的窗口**只认打断**（「截」就是这种）：
   * 它不该因为"挨打时恰好挂着别的无敌"而开窗。
   */
  readonly viaBuffId?: string;
}

/**
 * 这一 tick 该开哪些窗口。**纯函数**（读事件数组，返回要挂的 buff id）。
 *
 * 返回**新数组**（可能为空）：调用方逐个挂。
 *
 * ⚠️ **同 tick 去重**：一次「截」可能同时打断两个读条（双读条），
 * 那时 `interruptSuccess` 会发两条 —— 窗口只该开一次（开两次只是发两条
 * 重复的 `buffApplied`，但那会让日志里出现两次"派生窗口"，看起来像 bug）。
 * 所以按 `buffId` 去重。
 *
 * @param events 本 tick 产生的**全部**事件（含打断 / 闪避 / 免疫）
 * @param windows 这一局生效的窗口产出者（没有炁机时是空数组）
 */
export function comboWindowsFor(
  events: readonly EventDef[],
  windows: readonly ComboWindowSpec[],
): readonly string[] {
  if (windows.length === 0) return [];

  const opened: string[] = [];
  /**
   * ⚠️ 循环变量叫 `spec` 而**不是** `window`：`window` 是浏览器的全局名，
   * 在 `src/core/` 里当变量名会被 lint 拦下（`core/` 零依赖、不许碰 DOM，
   * AGENTS.md §2）—— 那不只是风格问题，"core 里出现 window"意味着
   * 这段代码可能在 Node 单测里炸。
   */
  for (const spec of windows) {
    if (opened.includes(spec.buffId)) continue;

    const fired = events.some((event) => {
      /**
       * 通道 1：**打断成功**。`sourceSkillId` 是"打断者用的招式"——
       * 没有它就无法区分"用截打断"与"用破打断"（那是 ③ 的全部意义）。
       */
      if (event.kind === 'interruptSuccess') {
        return event.sourceSkillId === spec.sourceSkillId;
      }
      /**
       * 通道 2（可选）：**某个 buff 挡下了整击**。
       *
       * ⚠️ 只认 `viaBuffId` 指定的那一个：`invulnerable` 这个 flag 被
       * 「闪」与「避」共用，而它们属于不同角色 —— 按 flag 认会让
       * "闪 派生 击"因为玩家按了「避」而开窗。
       */
      if (event.kind === 'avoided' && spec.viaBuffId !== undefined) {
        return event.viaBuffId === spec.viaBuffId;
      }
      return false;
    });

    if (fired) opened.push(spec.buffId);
  }
  return opened;
}
