/**
 * **两个角色共用的技能与 buff**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 「凝」(`focus`) 与它的 buff 是**林晚风与凯丽都有**的一招 —— 两份技能表
 * 都必须 import 它。如果把它留在某一个角色的文件里、让另一个角色去 import
 * 那一边，依赖就变成了"凯丽依赖林晚风"，那是在用文件边界描述一个
 * 并不存在的从属关系（换个角色顺序就要改 import）。
 *
 * 所以共用件放这里：两边都 import 它，谁都不 import 谁。
 *
 * ⚠️ 这也是**循环引用**的预防：`kits/linwanfeng.ts` 与 `kits/kaili.ts`
 * 都读这里，而这个文件**不读任何角色**（本仓库在 `data/scale.ts` 上
 * 踩过一次环，表现是"某个 import 是 undefined"，很难查）。
 */

import { logicMs } from '../../core/loopConstants';
import type { ActiveSkillDef, BuffDef } from '../../core/types';
import { C, S } from '../scale';

/** 凝：增伤 60%，持续 10 秒。 */
export const FOCUS_BUFF: BuffDef = {
  id: 'focus',
  nameKey: 'skill.focus.name',
  icon: 'char_focus',
  polarity: 'buff',
  color: C.focus,
  /**
   * **10 秒 = `logicMs(100)`**（用户 2026-10-13 重标定："凝改成增伤 60%
   * 持续 10 秒，代价 40 缠"）。
   *
   * ⚠️ 必须落在 **100ms 的整数格**上：内容校验器的 `OFF_GRID_TIME` 会拦
   * 非整格的时长（`logicMs(100)` = 10 秒 ✓；`logicMs(105)` = 10.5 秒 ✗）。
   */
  duration: logicMs(100),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'damageBoost',
      op: 'addPercent',
      value: 60,
      sourceKey: 'skill.focus.name',
      namespace: 'focus',
      tier: 'buff',
    },
  ],
};

/**
 * 凝：消耗 40 缠，增伤 60%，持续 10 秒。**两个角色共用同一个定义。**
 *
 * ⚠️ **2026-10-13 重标定**（用户原话："**凝改成增伤 60% 持续 10 秒，
 * 代价 40 缠**"）：数值 20 → **60**、时长 30 秒 → **10 秒**、
 * 代价 50 缠 → **40 缠**。说明文案**一个字都没改** ——
 * `{percent}` / `{seconds}` 是从这里（`FOCUS_BUFF`）推导的，
 * 代价由 `keyRows` 从 `cost` 推导（`app/descParams.ts` 的"一份真相"）。
 *
 * ⚠️ 共用是**有意的**（不是偷懒）：两人的「凝」在定稿里是同一个技能 ——
 * 同代价、同读条、同效果。分成两份会立刻漂（改了一个忘了另一个），
 * 而"两个技能 id 也叫 focus"会在注册表里直接 `DUP_ID` 报错。
 */
export const FOCUS: ActiveSkillDef = {
  id: 'focus',
  kind: 'activeSkill',
  nameKey: 'skill.focus.name',
  descKey: 'skill.focus.desc',
  icon: 'char_focus',
  abilities: [
    {
      kind: 'grant',
      target: { mode: 'self' },
      buff: FOCUS_BUFF,
    },
  ],
  castTime: 0,
  cooldown: 0,
  cost: [{ resource: 'douqi', value: S(40) }],
  targeting: { mode: 'self' },
  hits: [],
  tags: [],
  interruptible: false,
};
