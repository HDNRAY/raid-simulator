/**
 * 派生技的**槽位推导**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 三件事凑到一起把 `viewAdapter.ts` 顶过了 700 行（AGENTS.md §3）：
 *   1. 读派生窗口的**源技能**（从 buff 的 flags）
 *   2. 判定**哪个派生技现在可用**（条件求值）
 *   3. 把它的槽位**插进技能栏**
 *
 * 而这三件事本来就是一个内聚的整体 —— "派生技该不该出现在技能栏、
 * 出现在谁的旁边"。所以抽出来比留在适配器里更清楚。
 */

import type { SkillDef } from '../core/types';
import { PLAYER_SKILL_IDS } from '../data/content';
import { DEFAULT_BINDINGS } from '../input/keyboard';

/** 一个技能格：位置、绑定的键、放哪个技能。 */
export interface SlotBinding {
  readonly index: number;
  readonly key: string;
  readonly skillId: string;
}

/**
 * 从**键位表**推导战斗画面右下角的技能格。
 *
 * ==================================================================
 * 为什么不让调用方手写 slots
 * ==================================================================
 *
 * 原先 `DEFAULT_SLOTS` 是一张**写死的 6 格表**，与键位表各说各话。
 * 于是改键之后画面不跟着变，而"新增一个默认不绑键的技能（「闪」）"
 * 也没法表达 —— 它要么强行占一格，要么根本不出现。
 *
 * 现在**键位表是唯一真相来源**：
 *   - 有键的技能才出现在战斗画面，顺序按 `index`
 *   - 没键的技能（「闪」默认如此）仍然在设置里可绑，但不占画面
 *
 * ⚠️ 需求："暂时不设置最大按键数量" —— 这里不做截断，
 * 技能栏自己按画布宽度收窄（见 `SkillBarView` 的 `max`）。
 */
export function slotsFromBindings(
  bindings: readonly { readonly key: string; readonly skillId: string }[],
  /**
   * 生效中的**派生技**（技能栏要为它挤一个槽位）。
   *
   * 需求："键盘派生技能显示在原技能的上方，快捷键是 ctrl/command +
   * 原技能快捷键。"
   *
   * ⚠️ 派生技**不在绑定表里**（它平时不可用、也不该出现在设置页），
   * 所以只能由"源技能有派生窗口"这一个事实**动态**插进来。
   * 它借用源技能的 `key` —— 因为渲染层要拿这个 key 去找到源槽位、
   * 好把自己画在它上方。
   */
  derived?: { readonly skillId: string; readonly sourceSkillId: string },
): readonly SlotBinding[] {
  const base = bindings
    .filter((b) => b.key !== '')
    .map((b, i) => ({ index: i, key: b.key, skillId: b.skillId }));
  if (derived === undefined) return base;
  const source = base.find((b) => b.skillId === derived.sourceSkillId);
  if (source === undefined) return base;
  /**
   * ⚠️ 插在**最后**（index 最大）：技能栏的槽位是"index 越小越靠左"，
   * 而派生技的显示位置由 `key` 决定的源槽位负责，跟排序无关。
   * 放在末尾是为了不打乱其它槽位的顺序。
   */
  return [...base, { index: base.length, key: source.key, skillId: derived.skillId }];
}

/**
 * 默认技能槽 = **默认键位表推导出的那一份**。
 *
 * ⚠️ 2026-10-12：它现在**直接由 `DEFAULT_BINDINGS` 推导**，不再手抄一张
 * 六格表。原先手抄的那份在"两个角色各有自己的技能"之后立刻就是错的
 * （它还带着 `break`，而那是黛玄的、两个角色都没有）——
 * 这正是本文件开头那段"手写 slots 与键位表各说各话"的同一个坑。
 *
 * ⚠️ 它是**整场游戏**的默认（并集），不是"某个角色的"：真的开一局时
 * `battleSetup` 会用 `bindingsForPlayer` 过滤后再推导（那才是这一局的）。
 * 它主要给测试与"还没有战斗"的场合一个稳定的默认值。
 */
export const DEFAULT_SLOTS: readonly SlotBinding[] = slotsFromBindings(DEFAULT_BINDINGS);
/** 派生窗口 buff 的 id。 */
const COMBO_WINDOW_ID = 'combo-window';

/** 玩家身上的 buff（只读所需字段）。 */
interface BuffLike {
  readonly defId: string;
  readonly def?: { readonly flags?: { readonly comboWindowSource?: string } } | undefined;
}

export interface DerivedSlotResult {
  /** 生效中的派生技槽位（技能栏要画的那个）。没有则为 `undefined`。 */
  readonly derived: { readonly skillId: string; readonly sourceSkillId: string } | undefined;
  /** 插好派生槽位之后的完整槽位表。 */
  readonly slots: readonly SlotBinding[];
}

/**
 * 推导派生技槽位。
 *
 * ⚠️ **同一个 buff 同时决定"源技能"与"能不能用"**，所以两者不会打架
 * —— 否则会出现"技能栏说能用、按下去被拒"。
 *
 * ⚠️ 判定只看 `requires` 里的 `hasBuff`，与 `viewAdapter.buildSlot` 里
 * 那段判 `conditionOk` 的依据一致（那里也是内联判 `hasBuff` 的）。
 * 两处**必须同源**。
 */
export function deriveSlots(
  baseSlots: readonly SlotBinding[],
  playerBuffs: readonly BuffLike[],
  skills: ReadonlyMap<string, SkillDef>,
): DerivedSlotResult {
  const window = playerBuffs.find((b) => b.defId === COMBO_WINDOW_ID);
  const sourceSkillId = window?.def?.flags?.comboWindowSource;
  if (sourceSkillId === undefined) return { derived: undefined, slots: baseSlots };

  /**
   * 找**当前可用的派生技**。
   *
   * ⚠️ 只遍历玩家技能：Boss 技能也可能带 `requires`（AI 用它做轮转），
   * 但那不该混进玩家的技能栏。
   *
   * ⚠️ 判据是 `PLAYER_SKILL_IDS`，**不是 id 前缀**。原来这里写的是
   * `skill.id.startsWith('boss-')` —— 那对「色欲」失效，因为它的技能 id 是
   * `lust-*`。见 `isBindablePlayerSkill` / `PLAYER_SKILL_IDS` 的说明。
   */
  const held = new Set(playerBuffs.map((b) => b.defId));
  let derivedSkillId: string | undefined;
  for (const skill of skills.values()) {
    const reqs = skill.requires;
    if (reqs === undefined || reqs.length === 0) continue;
    if (!PLAYER_SKILL_IDS.has(skill.id)) continue;
    const ok = reqs.every((c) => c.kind !== 'hasBuff' || held.has(c.buffId));
    if (ok) {
      derivedSkillId = skill.id;
      break;
    }
  }
  if (derivedSkillId === undefined) return { derived: undefined, slots: baseSlots };

  /**
   * ⚠️ **源技能不在绑定表里 → 不报派生技**。
   *
   * 需求是"显示在**原技能的上方**" —— 源技能没上场（例如「闪」默认
   * 无键），就没有"上方"可画，这时派生技也无处可去。
   * 与 `slotsFromBindings` 里那条同源判定必须一致，否则会出现
   * "报了一个画不出来的派生技"（技能栏空着，但键盘认它）。
   */
  const sourceBound = baseSlots.some((s) => s.skillId === sourceSkillId);
  if (!sourceBound) return { derived: undefined, slots: baseSlots };

  return {
    derived: { skillId: derivedSkillId, sourceSkillId },
    slots: slotsFromBindings(
      /* 借用源技能的 key —— 渲染层靠它找到源槽位、把派生技画在它上方 */
      baseSlots.map((s) => ({ key: s.key, skillId: s.skillId })),
      { skillId: derivedSkillId, sourceSkillId },
    ),
  };
}
