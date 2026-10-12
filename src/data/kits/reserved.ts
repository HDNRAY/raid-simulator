/**
 * **已实现、但今天没有任何角色带**的玩家技能 + 它们的"待接线"标注。
 *
 * ==================================================================
 * 这个文件的存在本身是一个"待接线"的标记（AGENTS.md §2）
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
 * 「击」按 `AGENTS.md` §2 的"未实现 → 保留 + 标注"处理（见 `combo.ts`）。
 * 「破」属于**同一类**，处理方式也同一条线，但它的悬空状态曾经更隐蔽 ——
 * 见下。
 *
 * ==================================================================
 * ⚠️ 「破」的机制选择（2026-10-12，第二次重标定）
 * ==================================================================
 *
 * **上一版的做法是"保留在 `PLAYER_SKILLS`（玩家技能全集）里"**，
 * 理由是：黄金重放（`tests/golden/replay.test.ts`）的参考策略用
 * `interruptSkillId: 'break'` 打断 Boss，而"若动了黄金基线，停下来问"。
 * 那个取舍表面上保住了绿测，实际造成的后果更糟：
 *
 *   **黄金重放测的是一个"游戏里不可能发生的场景"** —— 夹具用「破」，
 *   而没有任何角色带「破」。绿色的测试因此给出**虚假的安全感**。
 *
 * 用户看了这个取舍，选了 **(B) 重标定一次**：
 *
 *   - 黄金夹具改用**林晚风**建模（她的 5 招，没有打断技）→ 基线重标定
 *   - 「破」**不再进 `PLAYER_SKILLS`**（所以设置页不列它、不可绑键、
 *     不属于任何角色）
 *
 * ⚠️ **但定义不删**：用户明确说过「破」将来归黛玄（`AGENTS.md` §2 的
 * 三分法：这是"未实现 / 待接线"，不是"重复"）。删除会丢设计，也会让
 * 黛玄接线时要重写一遍。
 *
 * 所以现在的机制是**第三类技能桶**（`PENDING_SKILLS`）：
 *
 *   | 桶 | 谁在里面 | 进注册表吗 | 可绑键吗 |
 *   |---|---|---|---|
 *   | `PLAYER_SKILLS` | 两个角色的技能 + 派生技 | ✅ | ✅（派生技除外） |
 *   | `BOSS_SKILLS` | 两个 Boss 的招 | ✅ | ❌ |
 *   | **`PENDING_SKILLS`（本文件）** | **「破」** | ✅（引擎要能按 id 解析） | ❌ |
 *
 * "不可绑 / 不属于任何角色"不是靠这里写一句注释成立的，而是**结构性的**：
 * 设置页的行来自 `PLAYER_SKILL_IDS`（`app/keyRows.ts` 的
 * `isBindablePlayerSkill`），而「破」不在那个集合里。
 * `tests/unit/playerKits.test.ts` 把这个状态钉成了断言（见那里的
 * 「「破」：黛玄的待接线技能」一节）。
 *
 * ⚠️ 等黛玄做完时：把 `BREAK` 移进 `kits/daixuan.ts`、把整个
 * `PENDING_SKILLS` 从 `ALL_SKILLS` 里拿掉即可 —— 那时它就有角色带了。
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

/**
 * 一个"设计好了、但今天没有角色带"的技能 + 它的**归属与原因**。
 *
 * 之所以不是裸的 `SkillDef[]`：那样"它将来归谁、为什么现在不能上"只存在
 * 于注释里，而下一个人最需要知道的恰好就是这两件事。
 * 写成字段之后，它是**可被机器检查的**（`playerKits.test.ts` 断言
 * `pendingFor` 是一个真实的、还在 `DEVELOPING` 里的角色）。
 */
export interface PendingSkill {
  /** 技能定义（保留，不删 —— 见文件头）。 */
  readonly skill: SkillDef;
  /**
   * 它将来归属的角色 id（`data/roster.ts` 的 `PLAYER_ROSTER` 里那个）。
   * ⚠️ 用 `daixuan` 而不是显示名 —— 显示名会改，id 是存档键。
   */
  readonly pendingFor: string;
  /**
   * 它为什么今天接不上线 —— **机器可读的短码**，不是文案。
   *
   * ⚠️ 刻意用英文短码：这个字段是**开发者元数据**（今天没有任何界面显示
   * 它），而 `src/` 不许硬编码中文文案（i18n 规范 I1，由 eslint 强制）。
   * 中文说明写在文件头与下面那条的注释里。
   *
   * 取值：
   *   `owner-not-implemented` —— 归属的角色还没做（本文件的「破」）
   *   （将来有别的种类时往这里加，别改成一个自由字符串）
   */
  readonly blockedBy: 'owner-not-implemented';
}

/**
 * **待接线技能**：进了内容注册表，但不进 `PLAYER_SKILLS`、不属于任何角色、
 * 不可绑键。判据与"为什么不是删掉"见文件头。
 */
export const PENDING_SKILLS: readonly PendingSkill[] = [
  {
    /**
     * 黛玄还没做（她在 `data/roster.ts` 的 `DEVELOPING` 里），她的技能表
     * 不存在，所以「破」今天没有产出者 —— 这正是它进待接线桶的原因。
     */
    skill: BREAK,
    pendingFor: 'daixuan',
    blockedBy: 'owner-not-implemented',
  },
];
