/**
 * **凯丽**（id `'kaili'`）的技能表 —— 斗士，5 招。
 *
 * ==================================================================
 * 定稿（docs/specs/2026-10-12-player-kits.md）
 * ==================================================================
 *
 * | 技能 | id | 代价 | 读条 | CD | 效果 |
 * |---|---|---|---|---|---|
 * | 拳 | `punch` | 炁 15 | 250ms | — | 伤害 6 |
 * | 轰 | `blast` | 缠 50 | 900ms | — | 伤害 30 + 易伤 |
 * | 凝 | `focus` | 缠 50 | 0 | — | 增伤 +20% |
 * | 截 | `jie` | 炁 10 | 0 | 10s | 打断 + **成功退还 CD** |
 * | 闪 | `flash` | 免费 | 0 | 0.6s | 无敌 0.1s |
 *
 * ⚠️ **她没有「避」，也没有「防」/「卸」** —— 她的防御手段是「闪」
 * （用户明确这么设计的：快节奏、注重反应）。GDD 里"凯丽没有避"这一条
 * 在她的技能表里是**结构性**的：这张表里没有那个 id，就不是漏了。
 *
 * ==================================================================
 * 与林晚风的分工（一句话）
 * ==================================================================
 *
 * 凯丽**快**：拳的读条只有「斩」的一半、伤害也低（换来更高的出手频率）；
 * 防御是**免费但窗口只有 0.1 秒**的「闪」—— 要按得准，不花炁。
 */

import { logicMs } from '../../core/loopConstants';
import type { BuffDef, SkillDef } from '../../core/types';
import { C, S } from '../scale';
import { FOCUS } from './shared';
import { COMBO_WINDOW, JIE } from './combo';

/* ================================================================== *
 * buff
 * ================================================================== */

/**
 * 闪：**免费**的短无敌（0.1 秒）。
 *
 * 与「避」并存的理由：避要 15 炁，炁见底时玩家就完全没有防御手段了。
 * 闪补上这个缺口 —— 但它换不来 0.5 秒，只换 0.1 秒，所以它**不能
 * 替代避**，只是"还能挣扎一下"。
 *
 * ⚠️ 定稿之后「避」归林晚风、「闪」归凯丽，所以这两者不再同时出现在
 * 同一个角色身上 —— 上面那段"并存"说的是**设计来源**（闪是为了补避的
 * 缺口才被加出来的），不是"凯丽同时有两个闪避技"。
 */
export const FLASH_IFRAME: BuffDef = {
  id: 'flash-iframe',
  nameKey: 'skill.flash.name',
  icon: 'char_dodge',
  polarity: 'buff',
  color: C.dodge,
  duration: logicMs(1),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { invulnerable: true },
};

/**
 * 玩家给 Boss 挂的易伤。
 *
 * 为什么需要它：如果"轰"只有直接伤害，循环会没有层次。
 * 用一个易伤 debuff 让"先叠层再爆发"成为一种选择。
 *
 * ⚠️ 它随「轰」一起归凯丽（只有她的技能表引用它）。
 */
export const SUNDER_DEBUFF: BuffDef = {
  id: 'sunder',
  nameKey: 'debuff.sunder.name',
  icon: 'debuff_sunder',
  polarity: 'debuff',
  color: C.debuff,
  duration: logicMs(80),
  maxStacks: 3,
  stacking: { mode: 'stackRefresh', max: 3 },
  modifiers: [
    {
      stat: 'vulnerability',
      op: 'perStackAdd',
      value: 0.1,
      sourceKey: 'debuff.sunder.name',
      namespace: 'sunder',
      tier: 'debuff',
    },
  ],
};

/* ================================================================== *
 * 技能
 * ================================================================== */

/**
 * 拳 🆕：凯丽的普攻。**炁耗与「斩」一致（15），读条更快，伤害更低。**
 *
 * 需求原话："（和斩耗炁一致，但是读条快，伤害低点）"
 *
 * | | 斩（林晚风） | 拳（凯丽） |
 * |---|---|---|
 * | 代价 | 炁 15 | 炁 15（**一致**） |
 * | 读条 | 500ms | **250ms**（快） |
 * | 伤害 | 10 | **6**（低点） |
 *
 * ⚠️ **两者都在炁的预算里**（炁每秒回 10）：拳每次只花 15 炁，但
 * 250ms 就能打一次，所以**限制凯丽的是炁而不是读条** —— 她会先打空炁。
 * 这正是"快节奏、注重资源分配"的落点：打得越快，空炁越早。
 */
export const PUNCH: SkillDef = {
  id: 'punch',
  kind: 'activeSkill',
  nameKey: 'skill.punch.name',
  descKey: 'skill.punch.desc',
  icon: 'char_attack',
  abilities: [],
  castTime: logicMs(2.5),
  cooldown: 0,
  cost: [{ resource: 'energy', value: S(15) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: S(6),
            canCrit: false,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  tags: ['melee'],
  interruptible: true,
};

/**
 * 轰：消耗 50 缠，造成 30 点伤害，并给目标叠易伤。
 *
 * ⚠️ 数值与机制**一个字都没动**（定稿："轰 不动"）。
 */
export const BLAST: SkillDef = {
  id: 'blast',
  kind: 'activeSkill',
  nameKey: 'skill.blast.name',
  descKey: 'skill.blast.desc',
  icon: 'char_blast',
  abilities: [],
  /**
   * **读条 0.9 秒** —— 比「拳」长得多。
   *
   * 这是有意的取舍：轰是凯丽最高伤害的一招，代价是"酝酿得久、
   * 更容易被打断"。玩家得挑 Boss 刚出完招的空档来放。
   */
  castTime: 900,
  cooldown: 0,
  cost: [{ resource: 'douqi', value: S(50) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: S(30),
            canCrit: false,
            countsAsHit: true,
          },
        },
        // 轰会打裂目标，叠易伤 —— 让"攒缠打轰"有额外收益
        { kind: 'grantBuff', target: { mode: 'primaryEnemy' }, buff: SUNDER_DEBUFF },
      ],
    },
  ],
  tags: ['spell'],
  /** 读条 0.9 秒 —— 高伤害的代价就是容易被打断 */
  interruptible: true,
};

/**
 * 闪：**免费**的短无敌（0.1 秒）。
 *
 * ⚠️ **初始不绑定任何按键**（需求）。它仍出现在设置里可被绑定；
 * 而战斗画面右下角**只显示已绑定按键的技能**。
 */
export const FLASH: SkillDef = {
  id: 'flash',
  kind: 'activeSkill',
  nameKey: 'skill.flash.name',
  descKey: 'skill.flash.desc',
  icon: 'char_dodge',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: FLASH_IFRAME }],
  castTime: 0,
  /**
   * ⚠️ 冷却 **0.6 秒**，而不是 0。
   *
   * 需求只说了"没有消耗 + 0.1 秒无敌"。但**真的给 0 会让这个技能
   * 退化成"永久无敌"**：输入是 tick 级的（按住就是每秒 60 次），
   * 连按就能让 0.1 秒的窗口首尾相接。
   *
   * 0.6 秒 = 6 个逻辑步，让免费窗口最多只占 **1/6 的时间**；
   * 同时短到"被连招时来得及按第二次"。
   */
  cooldown: logicMs(6),
  cost: [],
  targeting: { mode: 'self' },
  hits: [],
  /**
   * ⚠️ **`dodge` 是"被控时的出路"**：Boss 的「碾压」会造成倒地，倒地
   * 期间（`BuffFlags.restrictToTags`）只有带 `dodge` 的技能可按 ——
   * 凯丽**没有「避」**，所以这一个 tag 就是她倒地时唯一的出路。
   */
  tags: ['defensive', 'dodge'],
  interruptible: false,
};

/**
 * 凯丽的 5 招。
 *
 * ⚠️ 顺序 = 技能栏/设置页的展示顺序，**不是**绑定顺序
 * （绑定顺序由 `input/keyboard.ts` 的 `DEFAULT_BINDINGS` 决定）。
 */
export const KAILI_SKILLS: readonly SkillDef[] = [
  PUNCH,
  BLAST,
  FOCUS,
  JIE,
  FLASH,
];

/**
 * 生命上限 **120**（角色文档 §1："凯丽 斗士 120 快 注重反应、节奏把控"）。
 *
 * ⚠️ 比林晚风少 30 点 —— 这是"快"的价格：她能更快出手，但容错更低。
 */
export const KAILI_HP = 120;

/** 「截」成功后要激活的那个窗口 —— 与技能表一起导出，供 P3 的炁机使用。 */
export { COMBO_WINDOW };
