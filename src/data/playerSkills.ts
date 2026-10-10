/**
 * 玩家的**派生/强打断系**技能与它们的派生窗口。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `data/content.ts` 顶到了 700 行上限（AGENTS.md §3）。这一块是**内聚的
 * 一小撮**：`COMBO_WINDOW`（派生窗口 buff）、`STRIKE`（派生技「击」）、
 * `JIE`（强打断「截」）—— 三者互相引用，且与基础技能没有交集。
 *
 * ⚠️ 这两个块**必须放同一个文件**：把 `COMBO_WINDOW` 留在 `content.ts`
 * 而把 `JIE` 放这里，就会造出 `content ↔ playerSkills` 的**循环引用**
 * （本仓库在 `data/scale.ts` 上踩过一次，那种错误表现为"某个 import
 * 是 undefined"，很难查）。
 */

import { logicMs } from '../core/loopConstants';
import type { BuffDef, SkillDef } from '../core/types';
import { C, S } from './scale';

/**
 * 「派生窗口」：**只有这个 buff 在时，派生技能才会被激活**。
 *
 * ==================================================================
 * ⚠️ 「派生」与「限制」是两种机制（用户强调过）
 * ==================================================================
 *
 *   派生（本 buff + 技能的 `requires`）— **正向、激活**、**单技**
 *     "只有这个 buff 在时，这个技能才被激活"（平时它根本不可用）
 *   限制（`restrictToTags` / `actionLock`）— **负向、排除**、**全局**
 *     "除了白名单里的，其它都不行"
 *
 * 派生**不需要新引擎机制**：`checkGate` 已经会执行技能的 `requires`
 * （失败返回 `condition`），所以派生技只要写
 * `requires: [{ kind: 'hasBuff', buffId: 'combo-window' }]` 就行。
 *
 * ==================================================================
 * ⚠️ 为什么把"源技能"记在 flags 里
 * ==================================================================
 *
 * 需求："用掉就消失了，键盘派生技能显示在**原技能的上方**"
 *       "同一时间同一个派生出来的技能只能出现一个（如果另一个技能
 *        也能派生『击』，同时也只能派生一个击，**后派生的顶掉先派生的**）"
 *
 * UI 必须知道"这次派生是从谁那儿来的"才能画在它上方。而"顶掉"意味着
 * **源是动态的** —— 静态的 `SkillDef.derivedFrom` 表达不了"这一轮是
 * 「截」派的、下一轮可能是别的"。记在 flags 上则天然满足顶掉：
 * 同一个 buff id 刷新时 flags 一起被覆盖。
 */
export const COMBO_WINDOW: BuffDef = {
  id: 'combo-window',
  nameKey: 'buff.comboWindow.name',
  icon: 'char_combo',
  polarity: 'buff',
  color: C.focus,
  /**
   * 窗口时长 0.8 秒 = 8 个逻辑步。
   *
   * 短到"必须马上用掉"、长到"按得过来"：比一个「击」的施放稍长，
   * 但短于任何一次 Boss 前摇 —— 所以它是"看到打断成功立刻接一发"
   * 的节奏，而不是可以一直捏着的资源。
   */
  duration: logicMs(8),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  /** UI 靠它把派生技画在源技能上方。见上面的说明。 */
  flags: { comboWindowSource: 'break' },
};

/**
 * 「截」：**瞬发强打断** —— 成功则冷却归零并派生「击」，失败进入完整冷却。
 *
 * 需求（用户澄清）："我不是说加一个『截』吗 和 破是不一样的，截 才派生
 * 『击』"。
 *
 * ==================================================================
 * ⚠️ 与「破」的分工（两者**并存**，不是同一个技能）
 * ==================================================================
 *
 * | | 「破」 | 「截」 |
 * |---|---|---|
 * | 定位 | **稳定**的基础打断 | **高风险高回报**的强打断 |
 * | 冷却 | 固定 5 秒 | 10 秒，**成功则退还** |
 * | 派生 | 无 | **派生「击」** |
 * | 代价 | 10 炁 | 10 炁 |
 *
 * 设计意图：`破` 是"随时能用的打断"，`截` 是"赌一把"—— 打中了白赚一发
 * 「击」，打空了要等 10 秒。对玩家是"要不要为一次派生机会冒险"的选择。
 *
 * ⚠️ 默认**不绑键**（需求："不绑"）—— 玩家要在设置里自己绑。
 * 所以它默认不出现在技能栏与触屏按钮上，但**不是不能绑**。
 */
export const JIE: SkillDef = {
  id: 'jie',
  kind: 'activeSkill',
  nameKey: 'skill.jie.name',
  descKey: 'skill.jie.desc',
  icon: 'char_break',
  abilities: [],
  castTime: 0,
  /**
   * 冷却 10 秒 —— 与 `onSuccess` 里退还的量**必须完全相等**。
   *
   * ⚠️ 不相等会静默坏掉：退多了被"减到 `tick` 以下"钳住（看起来对，
   * 但掩盖了配置错误）；退少了成功之后还剩一截 CD（玩家会以为
   * "怎么还在转"）。所以 `content/validate.ts` 有一条断言强制相等。
   */
  cooldown: logicMs(100),
  cost: [{ resource: 'energy', value: S(10) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'interrupt',
          target: { mode: 'primaryEnemy' },
          force: true,
          /**
           * ============================================================
           * **只有真打断到了才结算这两条**（需求："如果成功，不进入 cd"）
           * ============================================================
           *
           *   1. `cooldown` 退还 —— 施放时已经扣了那 10 秒，这里减掉
           *      同样的量。不填 `skillId` = 调"当前这个技能自己"。
           *   2. `grantBuff` 挂 `combo-window` —— 于是「击」被激活。
           *
           * ⚠️ 失败（Boss 没在读条 / 带霸体）时两条都不结算，那 10 秒
           * 冷却就自然留着 —— 正是需求要的"失败则 cd 10 秒"。
           */
          onSuccess: [
            { kind: 'cooldown', cooldownMs: -logicMs(100) },
            { kind: 'grantBuff', target: { mode: 'self' }, buff: COMBO_WINDOW },
          ],
        },
      ],
    },
  ],
  tags: [],
  /** 提示玩家"这一招会打断目标" */
  hintTags: ['interrupt'],
  school: 'physical',
  interruptible: false,
};

/**
 * 「击」：**派生技**，无消耗，伤害是「攻」的一半。
 *
 * 需求："新增『击』这个技能，伤害比攻少一半，但是没有消耗。"
 *
 * ⚠️ 它**不在任何键位里**、也不由玩家直接按出：
 *   - 键盘：`Ctrl/Cmd + 原技能键`（见 `input/keyboard.ts`）
 *   - 触屏：画在原按钮上的角标环
 * 平时它**不可用**（`requires` 不满足），所以不占技能栏。
 */
export const STRIKE: SkillDef = {
  id: 'strike',
  kind: 'activeSkill',
  nameKey: 'skill.strike.name',
  icon: 'char_attack',
  descKey: 'skill.strike.desc',
  abilities: [],
  /** 瞬发 —— 它接在打断之后，不该再让玩家等读条。 */
  castTime: 0,
  cooldown: 0,
  /** 需求："没有消耗"。 */
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  /**
   * ⚠️ **这就是"派生"的开关**：没有 `combo-window` buff 时，这一条
   * 让 `checkGate` 直接以 `condition` 拒掉 —— 也就是"这个技能根本
   * 不可用"，而不是"可用但被排除"（那是「限制」的语义）。
   */
  requires: [{ kind: 'hasBuff', who: 'self', buffId: 'combo-window' }],
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          /** 「攻」是 `S(10)`，所以这里 `S(5)` —— "伤害比攻少一半"。 */
          damage: { base: S(5), school: 'physical', canCrit: false, countsAsHit: true },
        },
        /**
         * **用掉就消失**（需求）。
         *
         * 移除派生窗口本身 —— 于是"一次打断只换来一次「击」"。
         * 不这么做的话窗口期内能反复放，派生技会完全取代基础技。
         */
        { kind: 'removeBuff', target: { mode: 'self' }, buffId: 'combo-window' },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  interruptible: false,
};
