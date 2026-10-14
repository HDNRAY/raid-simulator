/**
 * **一个技能槽位视图怎么造** —— 技能栏与触屏按钮**共用同一段**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `app/viewAdapter.ts` 顶到 700 行上限（AGENTS.md §3）。按那里的规则 ——
 * **不许靠删/压注释解决，要拆 util 或横向切割** —— 把"槽位视图"这一撮
 * 横向切出来：它只依赖**技能定义 + 引擎状态**，与适配器持有的瞬时状态
 * （飘字、闪光、受击反馈）没有交集。
 *
 * ⚠️ 切出来还有一个**功能上的**理由（2026-10-12）：触屏按钮可以放任何
 * 可选技能，包括"没绑键、因此没上技能栏"的那些 —— 那正是用户要解开的
 * 死结（没绑键的技能在触屏上根本没有按钮，而触屏又进不去改键）。
 * 那些按钮的字 / 代价 / 冷却必须来自**同一段构造**，否则会出现
 * "按钮亮着、按下去没反应"这种最难查的状态（见 `slotViewOfSkill`）。
 *
 * ⚠️ 抽取时**注释整段搬过来**，不留摘要（AGENTS.md §3）。
 */

import { holdDrainPerSecond } from '../core/combat/holds';
import type { BattleEngine } from '../core/combat/battleState';
import type { SkillDef } from '../core/types';
import type { SlotBinding } from './derivedSlots';
import { BLOCK_KEYS, type SkillSlotView, type SlotCost } from '../render/viewModel';

/**
 * **单独造一个槽位视图**（这个技能**不需要**在技能栏里）。
 *
 * ==================================================================
 * 为什么需要它（2026-10-12）
 * ==================================================================
 *
 * 触屏按钮可以放**任何可选技能**，包括"没绑键、因此没上技能栏"的那些 ——
 * 那正是用户要解开的死结（没绑键的技能在触屏上没有按钮，而触屏又进不去
 * 改键）。但按钮上的字 / 代价 / 冷却都来自 `view.skills`，而那张表只有
 * 上了技能栏的技能 → 新放上去的按钮是一个**空圆**（实测）。
 *
 * ⚠️ 这里**复用 `buildSlotView`**（同一段：冷却、资源够不够、派生条件、
 * 代价、固有 CD），而不是另写一份"静态近似"：复制一遍必然漂 ——
 * 玩家会看到"按钮亮着、按下去没反应"这种最难查的状态。
 *
 * ⚠️ `key` 给空串：它没有键盘键。技能栏那边按 `key !== ''` 过滤，
 * 所以本函数**不会**把触屏专属技能漏进桌面技能栏 —— 调用方只把它喂给
 * 触屏按钮层。
 */
export function slotViewOfSkill(
  skills: ReadonlyMap<string, SkillDef>,
  engine: BattleEngine,
  skillId: string,
  index: number,
): SkillSlotView | undefined {
  const state = engine.snapshot;
  const playerRaw = state.combatants.find((c) => c.side === 'ally');
  if (!playerRaw) return undefined;
  const haste = engine.statsOf(playerRaw.id).haste ?? 0;
  /** 派生窗口的判据与 `build` 里那份同源（同一个 buff）。 */
  const comboWindowOpen = playerRaw.buffs.some((b) => b.defId === 'combo-window');
  return buildSlotView(
    skills,
    engine,
    { index, key: '', skillId },
    state.tick,
    haste,
    comboWindowOpen,
    undefined,
  );
}

/**
 * 造一个技能槽位视图（技能栏的每一格都是它造的）。
 *
 * ⚠️ **纯函数**（收 `skills` 注册表当参数）而不是适配器的私有方法：
 * 「一个技能槽位怎么造」是**一撮自成一体的知识**（冷却 / 资源 / 派生条件 /
 * 代价 / 固有 CD），与"适配器持有的瞬时状态"没有交集。切出来之后
 * `viewAdapter.ts` 也回到 700 行以内（AGENTS.md §3）。
 */
export function buildSlotView(
  skills: ReadonlyMap<string, SkillDef>,
  engine: BattleEngine,
  slot: SlotBinding,
  tick: number,
  haste: number,
  comboWindowOpen: boolean,
  /** 派生窗口的源技能（没有窗口时为 undefined）。 */
  derivedFrom: string | undefined,
): SkillSlotView | undefined {
  const skill = skills.get(slot.skillId);
  if (!skill) return undefined;
  /**
   * ⚠️ 槽位只造**主动技能**：代价 / 冷却 / 按住消耗都是主动技能专属 ——
   * 被动技能没有"施放"这回事，不该占一个格子。
   */
  if (skill.kind !== 'activeSkill') return undefined;
  const state = engine.snapshot.combatants.find((c) => c.side === 'ally');
  if (!state) return undefined;

  // 冷却：引擎把"下次可用 tick"存在 cooldowns 里
  const readyAt = state.cooldowns[slot.skillId] ?? 0;
  const totalTicks = Math.max(1, Math.round((skill.cooldown * (1 - haste)) / (1000 / 60)));
  const remainTicks = Math.max(0, readyAt - tick);
  const cooldownRatio = skill.cooldown > 0 ? Math.min(1, remainTicks / totalTicks) : 0;

  // 资源是否够（UI 需要提前变灰，而不是等玩家按了才拒绝）
  let costOk = true;
  for (const cost of skill.cost) {
    const need = typeof cost.value === 'number' ? cost.value : 0;
    const has = (state.resources as Record<string, number>)[cost.resource] ?? 0;
    if (has < need) costOk = false;
  }

  // 前置条件（派生窗口）
  let conditionOk = true;
  for (const cond of skill.requires ?? []) {
    if (cond.kind === 'hasBuff' && cond.buffId === 'combo-window' && !comboWindowOpen) {
      conditionOk = false;
    }
  }

  const casting = state.casts.length > 0;
  const usable = costOk && conditionOk && cooldownRatio <= 0.001 && !casting;

  // 不可用原因用**本地化 key**表达，UI 层负责取文案。
  // ⚠️ key 的字面量住在 `render/viewModel.ts` 的 `BLOCK_KEYS`（那边有说明：
  // 技能栏的底色也认这两个 key，两边各写一份会静默漂）。
  let blockedKey: string | undefined;
  if (!conditionOk) blockedKey = BLOCK_KEYS.comboWindow;
  else if (!costOk) blockedKey = BLOCK_KEYS.cost;
  else if (cooldownRatio > 0.001) blockedKey = BLOCK_KEYS.cooldown;
  else if (casting) blockedKey = BLOCK_KEYS.casting;

  /**
   * 资源代价 —— 取**第一项**。
   *
   * 现在的技能都只有一项代价；如果以后出现"同时消耗炁和缠"，
   * 这里要改成数组（格子右上角放不下两项，得换表达方式）。
   * 按住技（「卸」）的代价在 `holdDrain` 里，不是 `cost`。
   */
  const firstCost = skill.cost[0];
  const drain = skill.holdDrain;
  const cost: SlotCost | undefined =
    firstCost !== undefined && typeof firstCost.value === 'number'
      ? toSlotCost(firstCost.resource, firstCost.value)
      : drain !== undefined
        ? // 按住技：代价按**逻辑步**扣，技能栏写的是"每秒多少"。
          // 换算与设置页共用 `holdDrainPerSecond()` —— 曾把 `perLogicTick`
          // 直接当成每秒，显示成 3/s 而实际 30/s（10 倍偏差）。
          toSlotCost(drain.resource, holdDrainPerSecond(drain), '/s')
        : undefined;

  return {
    index: slot.index,
    key: slot.key,
    skillId: slot.skillId,
    nameKey: skill.nameKey,
    icon: skill.icon,
    usable,
    cooldownRatio,
    ...(cost === undefined ? {} : { cost }),
    cooldownSec: (remainTicks * (1000 / 60)) / 1000,
    // 固有冷却（满值）—— 左下角显示的那个
    skillCdSec: skill.cooldown / 1000,
    comboReady: (skill.requires?.length ?? 0) > 0 && conditionOk,
    /**
     * 只有**派生技**才带 `derivedFrom` —— 判断依据是"它有 requires"。
     * 渲染层据此把它画在源技能旁边，而不是占一个正常槽位。
     */
    ...((skill.requires?.length ?? 0) > 0 && comboWindowOpen && derivedFrom !== undefined
      ? { derivedFrom }
      : {}),
    ...(blockedKey === undefined ? {} : { blockedKey }),
  };
}

/**
 * 把「资源 key + 数值」收敛成渲染层要的 `SlotCost`。
 *
 * ⚠️ 数据层（`core/types.ts`）把 `resource` 声明成了宽泛的 `string`，
 * 而视图层要的是 `'hp' | 'energy' | 'douqi'`。用**类型守卫**收敛，
 * 不用 `as` 断言（AGENTS.md §1）。守卫失败就当作"没有代价可显示"，
 * 这比让一个未知字符串漏进渲染层更安全。
 *
 * ⚠️ 它**只在本模块用**（`buildSlotView` 的按住技分支），所以不对外导出；
 * 要复用它就把想要的东西一起搬过来，**别复制一份** —— `perLogicTick → 每秒`
 * 的换算曾经在复制品里出过 10 倍偏差（见上面按住技那段）。
 */
function toSlotCost(resource: string, value: number, suffix?: string): SlotCost | undefined {
  if (resource === 'hp' || resource === 'energy' || resource === 'douqi') {
    return suffix === undefined ? { resource, value } : { resource, value, suffix };
  }
  return undefined;
}
