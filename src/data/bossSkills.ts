/**
 * Boss 的招式与它们用到的 buff。
 *
 * ==================================================================
 * 为什么从 `content.ts` 里搬出来
 * ==================================================================
 *
 * `content.ts` 是仓库里最大的数据文件，而它的内容其实是**两组互不
 * 相干的东西**：玩家招式 / Boss 招式。新增「闪」时它被推过 700 行
 * （AGENTS.md §3 的上限），于是把 Boss 这一半分出来。
 *
 * 分工：
 *   `content.ts`     常量、玩家 buff 与技能、汇总导出
 *   `scale.ts`       共享刻度 `S` 与配色 `C`（**叶子**，见那里的说明）
 *   `bossSkills.ts`  Boss 的 buff 与技能（本文件）
 */

import type { BuffDef, SkillDef } from '../core/types';
import { logicMs } from '../core/loopConstants';
import { C } from './scale';
import { S } from './scale';

/** Boss 前摇标记（隐藏，只用于让 UI 知道它在读条）。 */
export const BOSS_TELEGRAPH: BuffDef = {
  id: 'boss-telegraph',
  nameKey: 'hud.casting',
  icon: 'telegraph',
  polarity: 'neutral',
  color: C.boss,
  duration: logicMs(30),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  hidden: true,
};

/** Boss 狂暴：伤害翻倍。 */
export const BOSS_ENRAGE: BuffDef = {
  id: 'boss-enrage',
  nameKey: 'screen.defeatedByEnrage',
  icon: 'enrage',
  polarity: 'debuff',
  color: 0xff3030,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  damageMultBoost: 2,
};

/**
 * Boss 的**霸体**。
 *
 * 需求：Boss 的所有招式默认都能被打断 / 闪避 / 格挡，
 * **除非它不是霸体** —— 霸体由一个带 CD 的招式给自己挂上。
 *
 * 用 `flags.interruptImmune` 实现而不是新造机制：这个 flag 在数据模型里
 * 早就定义了、`aggregateFlags` 也一直在算它，但**没有任何地方读它** ——
 * 一个"看起来支持、实际不生效"的字段。把它接上比新增一个字段更好。
 *
 * 持续时间 3 秒：够覆盖一轮出招（Boss 每 1.5–3 秒一动），
 * 又短到玩家可以"等它过去"而不是被迫硬吃。
 * 颜色用青蓝，与 Boss 的红色系区分开 —— 它表达的是"防守"而不是"危险"。
 */
export const BOSS_ARMOR: BuffDef = {
  id: 'boss-armor',
  nameKey: 'boss.armor.name',
  icon: 'boss_armor',
  polarity: 'buff',
  color: 0x30c8d0,
  duration: logicMs(30),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { interruptImmune: true },
};

/**
 * 重斩**自带**的霸体（起手挂上，覆盖整个前摇）。
 *
 * ⚠️ 与 `BOSS_ARMOR` 是**同一个概念、不同时长**，所以是两个 id：
 *   - `BOSS_ARMOR`        3.0 秒，给独立的「霸体」技能用
 *   - `BOSS_CLEAVE_ARMOR` 1.8 秒 = **重斩的前摇时长**，只覆盖这一招
 *
 * 共用一个 id 的话，重斩结束之后霸体会**多留 1.2 秒**，
 * 那段时间里「破」也打不断 —— 玩家会以为工具坏了。
 *
 * 文案/图标/颜色与 `BOSS_ARMOR` 完全一致（同一个东西），
 * 所以 UI 上看起来就是"重斩期间 boss 有一层霸体"。
 */
export const BOSS_CLEAVE_ARMOR: BuffDef = {
  id: 'boss-cleave-armor',
  nameKey: 'boss.armor.name',
  icon: 'boss_armor',
  polarity: 'buff',
  color: 0x30c8d0,
  /** = 重斩的 `castTime`（logicMs(18)），读条走完就消失 */
  duration: logicMs(18),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { interruptImmune: true },
};

/** 重斩：有前摇，可被打断 / 闪避 / 格挡。 */
export const BOSS_CLEAVE: SkillDef = {
  id: 'boss-cleave',
  kind: 'activeSkill',
  nameKey: 'boss.cleave.name',
  descKey: 'boss.cleave.desc',
  icon: 'boss_cleave',
  /**
   * 起手就给自己挂**霸体**（`BOSS_ARMOR`）—— 于是整个前摇期间打不断。
   *
   * 需求："重斩加上 霸体标签和霸体效果"。
   *
   * 语义上这是"重斩是一记压上全部重心的斩击，起手就没有退路"：
   * 玩家看到读条就只能闪/挡，别浪费「破」。
   * 与独立的 `boss-armor` 技能共用同一个 buff 定义（一个概念一处定义）。
   */
  abilities: [
    { kind: 'grant', target: { mode: 'self' }, buff: BOSS_TELEGRAPH },
    { kind: 'grant', target: { mode: 'self' }, buff: BOSS_CLEAVE_ARMOR, on: 'castStart' },
  ],
  castTime: logicMs(18),
  /**
   * 冷却 **4.5 秒**（原 3 秒）。
   *
   * 为什么要加：需求指出"重斩看起来没有 CD"。核实后发现冷却确实存在，
   * 但**真正限制它的是轮转的 `gapMs`**（1.2 秒）—— 冷却还没走完，
   * 轮转这一关就先放行了，所以观感上像"连续重斩"。
   * 冷却与 `gapMs` 一起放大之后间隔才真正拉开（见 ai 里的 rotation）。
   */
  cooldown: logicMs(60),
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      // ⚠️ `at` 必须与 `castTime` 一致：读条走完才命中。
      // 早期 `at` 比 `castTime` 短，于是伤害在读条**结束前**就结算 ——
      // 表现为"读条条还在走，血已经掉了"。
      at: logicMs(18),
      effects: [
        {
          kind: 'damage',
          /**
           * **重攻击**（需求：增加 Boss 的重攻击）。
           *
           * 数值按"不防御就活不下来"倒推，实测（Boss 血 180）：
           *   纯进攻：8.8 秒险胜、**只剩 4 血**
           * 单发 14 点看起来不重，但出招频率提到了约 1.1 秒一次 ——
           * "重"体现在**总压力**上，而不是非要一击半血。
           */
          damage: { base: S(28), school: 'physical', canCrit: false, countsAsHit: true },
        },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
  /**
   * 「高伤」—— 单次 28 点，而玩家的「攻」只有 10。
   * 提示玩家：**闪避比防御更值**（闪避全免，防御只减 55%）。
   */
  hintTags: ['highDamage', 'interruptImmune'],
  interruptible: true,
};

/** 横扫：前摇更长、伤害更高，是"必须躲"的那一招。 */
export const BOSS_SWEEP: SkillDef = {
  id: 'boss-sweep',
  kind: 'activeSkill',
  nameKey: 'boss.sweep.name',
  descKey: 'boss.sweep.desc',
  icon: 'boss_sweep',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: BOSS_TELEGRAPH }],
  // 比重斩（1.8s）更长：它是"必须躲"的那一招
  castTime: logicMs(22),
  /** 冷却 **8 秒**（原 6 秒，同样配合 `gapMs` 一起放大）。 */
  cooldown: logicMs(100),
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      // 同重斩：命中时刻 = 读条结束
      at: logicMs(22),
      effects: [
        {
          kind: 'damage',
          /**
           * 14 点火焰伤害 —— **这是为「闪」准备的那一招**：
           * 前摇 1.2 秒够长，玩家来得及反应；伤害是重斩的近两倍，
           * 所以躲掉它的收益明显。
           */
          /**
           * 横扫是**更重的一击**（28 点，重斩的 1.4 倍）。
           *
           * 前摇更长（长到能看清并闪避），命中更痛 —— 所以"看到横扫
           * 必须反应"是本作的核心节奏。
           */
          damage: { base: S(36), school: 'fire', canCrit: false, countsAsHit: true },
        },
      ],
    },
  ],
  tags: ['spell'],
  school: 'fire',
  /** 「高伤」—— 单次 36 点，全场最高的一击。 */
  hintTags: ['highDamage'],
  interruptible: true,
};

/** 蓄力：不造成伤害，给自己加攻。可以被打断（打断它就等于免掉一轮爆发）。 */
export const BOSS_EMPOWER: SkillDef = {
  id: 'boss-empower',
  kind: 'activeSkill',
  nameKey: 'boss.empower.name',
  descKey: 'boss.empower.desc',
  icon: 'boss_empower',
  abilities: [
    {
      kind: 'grant',
      target: { mode: 'self' },
      buff: {
        id: 'boss-empowered',
        nameKey: 'boss.empower.name',
        icon: 'boss_empower',
        polarity: 'debuff',
        color: C.boss,
        duration: logicMs(100),
        maxStacks: 1,
        stacking: { mode: 'refresh' },
        modifiers: [
          {
            stat: 'damageBoost',
            op: 'addPercent',
            value: 30,
            sourceKey: 'boss.empower.name',
            namespace: 'boss-empowered',
            tier: 'buff',
          },
        ],
      },
    },
  ],
  castTime: logicMs(10),
  cooldown: logicMs(120),
  cost: [],
  targeting: { mode: 'self' },
  hits: [],
  tags: [],
  school: 'physical',
  interruptible: true,
};

/**
 * 霸体招式：给自己挂霸体，前摇很短。
 *
 * 设计意图：它是一个**抢节奏**的招式 —— 玩家看到它就该停手，
 * 之后再继续输出。如果玩家照打不误，「破」会失效并给出
 * 「霸体」提示，从而学会这个规则。
 *
 * 冷却 12 秒：一场 15 秒的战斗里大概出现一次，不至于让人烦躁。
 */
export const BOSS_ARMOR_SKILL: SkillDef = {
  id: 'boss-armor',
  kind: 'activeSkill',
  nameKey: 'boss.armor.name',
  descKey: 'boss.armor.desc',
  icon: 'boss_armor',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: BOSS_ARMOR }],
  castTime: logicMs(4),
  cooldown: logicMs(120),
  cost: [],
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive'],
  school: 'arcane',
  /**
   * 「霸体」—— 提示玩家"无法被打断"，别浪费「破」。
   *
   * 这条与引擎里的 `interruptImmune` 是两个面：引擎负责"真的打不断"，
   * 这个标签负责"提前告诉玩家"。
   */
  hintTags: ['interruptImmune'],
  interruptible: true,
};

export const BOSS_SKILLS: readonly SkillDef[] = [
  BOSS_CLEAVE,
  BOSS_SWEEP,
  BOSS_EMPOWER,
  BOSS_ARMOR_SKILL,
];
