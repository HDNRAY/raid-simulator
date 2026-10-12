/**
 * **已实现但当前没有角色带**的玩家技能（以及它们为什么还在这里）。
 *
 * ==================================================================
 * 这个文件的存在本身是一个"待接线"的标记
 * ==================================================================
 *
 * 用户的要求是把"一套通用玩家技能"拆成**林晚风 5 招 / 凯丽 5 招**。
 * 拆完之后有一类技能**掉在两套之外**：
 *
 * | 技能 | 原本给谁 | 现状 |
 * |---|---|---|
 * | **破** (`break`) | 黛玄（"破"在她的技能表里） | 她还没做（`DEVELOPING`），所以没人带 |
 * | **击** (`strike`) | 派生技 | 见 `kits/combo.ts`：P3 由炁机接回 |
 *
 * ⚠️ **为什么"破"不能就这么从内容里删掉**：
 *
 * 它是**黄金重放**（`tests/golden/replay.test.ts`）里参考策略用的打断技
 * （`interruptSkillId: 'break'`）。如果技能表里没有它，`roughlyUsable`
 * 会返回 false，那段策略就**再也不打断 Boss** —— 实测整场结果从
 * "剩 20 血 / 5696 tick"变成"满血 / 5816 tick"。
 *
 * 那不是数值改动，是**参考策略的输入变了**。而用户的硬验收是
 * "`tests/golden/replay.test.ts` 必须仍然全绿"、并且
 * "**若动了黄金基线，停下来问我**"。所以：
 *
 *   - 「破」的定义**保留**（它本来就在玩家技能全集里，属于"未实现的
 *     角色"，不是"删掉的功能"）
 *   - 它**不在任何角色的技能表里**，所以正常玩法里按不出来
 *     （注册表按角色裁剪，见 `app/deps.ts`）
 *   - 玩家技能**全集**里仍有它 → 设置页能绑、黄金夹具仍能解析、
 *     **黄金基线一分不动**
 *
 * ⚠️ 等黛玄做完（或用户明确要求把「破」也从全集里去掉）时，
 * 把这个文件并回 `kits/daixuan.ts` / 直接删掉 —— 那时黄金基线
 * **本来就该**重新标定，而且要在用户知情的前提下做。
 */

import { logicMs } from '../../core/loopConstants';
import type { SkillDef } from '../../core/types';
import { S } from '../scale';

/** 破：打断任何技能。固定 5 秒 CD，不占公共冷却。 */
export const BREAK: SkillDef = {
  id: 'break',
  kind: 'activeSkill',
  nameKey: 'skill.break.name',
  descKey: 'skill.break.desc',
  icon: 'char_break',
  abilities: [],
  castTime: 0,
  /**
   * 冷却 **5 秒**。
   *
   * ⚠️ 这里曾经是 10 秒 + "成功退 CD + 派生「击」" —— 那是**「截」的
   * 机制，不是「破」的**。我当初把两者混成一个技能了。
   * 现在「破」是**稳定的基础打断**：CD 固定、不派生。
   */
  cooldown: logicMs(50),
  /**
   * 代价 **10 炁**（需求："破增加 代价 10点炁"）。
   *
   * 原先免费：打断本身已经用 5 秒冷却计价了。加 10 炁之后，
   * "打断"也要和普攻抢同一池炁，取舍更紧。
   */
  cost: [{ resource: 'energy', value: S(10) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          /**
           * 打断不区分可打断性：Boss 的所有招式都能被「破」打断。
           *
           * ⚠️ **没有 `onSuccess`** —— "成功退 CD + 派生「击」"是「截」的
           * 机制（而那条派生现在也被拿掉了，见 `kits/combo.ts`）。
           */
          kind: 'interrupt',
          target: { mode: 'primaryEnemy' },
          force: true,
        },
      ],
    },
  ],
  /**
   * ⚠️ 空数组是**有意**的：原先这里是 `['interrupt']`，但引擎并不需要
   * 这个分类 —— 打断靠 `hits[].effects` 里的 `interrupt` 效果实现，
   * 不是靠 tag 匹配。那份是纯冗余，已按需求删除。
   */
  tags: [],
  /**
   * ⚠️ 提示（"可打断"）从 `hits[].effects` 推导，见 `app/skillHints.ts`。
   * 手写一份 `hintTags` 必然与效果漂。
   */
  interruptible: false,
};
