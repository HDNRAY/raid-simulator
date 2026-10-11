/**
 * MVP 内容：玩家六招 + Boss「Verrot, the Fallen」。
 *
 * ==================================================================
 * 数值刻度（重要）
 * ==================================================================
 *
 * 逻辑数值用**小整数**：生命上限 100、伤害 10 级别。
 * 但内部实现按 **10 倍刻度**存储（HP 1000、10 伤害存成 100）。
 *
 * 为什么要这个转换：整数化是硬约束（架构规范 §12），
 * 而"每 0.1 秒恢复 1 点缠"在 0.1 秒粒度上要除以 6 个物理 tick ——
 * 直接用 1 点会导致每 tick 0.167 点，被整数化吃掉。
 * 乘 10 之后每 tick 稳定得到整数，且**玩家看到的数字仍然是 100/10 这种小整数**。
 *
 * 换算规则：一切对外数值 × `DISPLAY_SCALE`。
 *
 * ==================================================================
 * 技能设计（每个技能一个字，图标就用那个字）
 * ==================================================================
 *
 * | 字 | 代价 | 效果 |
 * |----|------|------|
 * | 攻 | 10 炁 | 造成 10 点伤害（普攻） |
 * | 闪 | 30 炁 | 0.5 秒完全无敌 |
 * | 防 | 按住，每 0.1 秒 2 炁 | 减伤 40%，松开即取消 |
 * | 破 | —（5 秒 CD） | 瞬发，打断任何技能 |
 * | 轰 | 50 缠 | 造成 30 点伤害 |
 * | 凝 | 50 缠 | 增伤 20%，持续 30 秒 |
 *
 * 资源模型：
 *   炁（`energy`）—— 每 0.1 秒自动恢复 1 点（= 每秒 10 点）
 *   缠（`douqi`） —— **按伤害换算**：造成 1 点伤害得 1 点，受到 1 点也得 1 点
 *
 * 时间刻度：10 个逻辑步 = 1 秒（0.1 秒/步）；读条时间用毫秒声明。
 */

import { logicTicks, logicMs } from '../core/loopConstants';
import type { BuffDef, SkillDef } from '../core/types';
import { C, S } from './scale';
import { LUST_BUFFS, LUST_SKILLS } from './lustBoss';
import { COMBO_WINDOW, JIE, STRIKE } from './playerSkills';
export { C, S } from './scale';
import { BOSS_ENRAGE, BOSS_TELEGRAPH, KNOCKDOWN } from './bossShared';
/**
 * ⚠️ 只 import **本文件自己要用**的两个汇总（`ALL_SKILLS` / `ALL_BUFFS`）；
 * 逐个技能的转发走下面的 `export { ... } from`。
 *
 * 两件事分开写是因为 `import { X }` + `export { X } from` 会让 `X`
 * 变成"import 了但没用到"（`export ... from` 是从源模块重新导出，
 * 不经过本地绑定），`noUnusedLocals` 会报错。
 */
import { PRIDE_BUFFS, PRIDE_SKILLS } from './bossPride';

/**
 * Boss 的内容从各自的内容文件**转发**，外部 import 路径不变。
 *
 * ⚠️ 分工（与 `bossSkills.ts` 时代不同）：
 *   `bossShared.ts` 两个 Boss 共用的三样（前摇标记 / 狂暴 / 倒地）
 *   `bossPride.ts`  「傲慢」的技能 + buff + 轮转
 *   `lustBoss.ts`   「色欲」的技能 + buff + 轮转
 *
 * 旧的 `BOSS_CLEAVE` / `BOSS_SWEEP` / `BOSS_EMPOWER` / `BOSS_ARMOR` /
 * `BOSS_ARMOR_SKILL` 已随「霸体合并」删除（设计 §6.3）—— 它们不是因为
 * 改名而消失，而是**技能本身没了**：霸体现在是「碾压」自带的属性，
 * 「蓄能」整个删掉（占出招格却不打人）。
 */
export {
  KNOCKDOWN,
  BOSS_ENRAGE,
  BOSS_TELEGRAPH,
} from './bossShared';
export {
  BOSS_HEAVY,
  BOSS_HEAVY_ARMOR,
  BOSS_MEND,
  BOSS_REBUKE,
  BOSS_SCORN,
  PRIDE_BUFFS,
  PRIDE_SKILLS,
} from './bossPride';


/** 生命上限（展示值）。 */
export const HP_MAX = 100;
/** 缠上限（展示值）。 */
export const ENERGY_MAX = 100;
/** 炁上限（展示值）。 */
export const DOUQI_MAX = 100;

/** 每 0.1 秒恢复的缠。 */
export const ENERGY_PER_LOGIC_TICK = 1;

/**
 * 每点伤害换多少炁。
 *
 * 1 = "造成 1 点伤害得 1 点炁"，受到伤害同理。
 * 于是打满 100 伤害或挨满 100 伤害各攒满一次炁。
 */
export const DOUQI_PER_DAMAGE = 1;


/* ================================================================== *
 * 玩家图标配色（单色方块占位）
 * ================================================================== */


/* ================================================================== *
 * 共享 buff
 * ================================================================== */

/** 闪：0.5 秒完全无敌。 */
export const DODGE_IFRAME: BuffDef = {
  id: 'dodge-iframe',
  nameKey: 'skill.dodge.name',
  icon: 'char_dodge',
  polarity: 'buff',
  color: C.dodge,
  duration: logicMs(5),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { invulnerable: true },
};

/**
 * 「闪」的无敌窗口：**0.1 秒**（1 个逻辑步）。
 *
 * 与「避」（`DODGE_IFRAME`，0.5 秒）是**两个 buff**，不是一个 buff
 * 的两种时长 —— 因为它们服务于两种不同的取舍：
 *   避  花 30 炁换 0.5 秒，有余炁时的正解
 *   闪  不花钱换 0.1 秒，炁见底时的兜底
 *
 * 0.1 秒 = 6 个物理 tick。Boss 单次伤害在**结算的那一 tick**判定，
 * 所以这个窗口足以躲掉一击，但要求按得更准。
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
 * 防：减伤 40%。
 *
 * **刻意不给持续时间**（`Number.POSITIVE_INFINITY`）。
 *
 * 它的生命周期完全由"按住 / 松开"驱动：按下时挂上，松开时由
 * `endHold` 移除。加一个有限 duration 反而会产生错误的语义 ——
 * 玩家一直按着，而 buff 却因为到期自己掉了（表现为"格挡莫名其妙失效"）。
 *
 * 唯一的结束条件是**缠耗尽**（引擎在 `tickHolds` 里检查并自动松开）。
 */
export const GUARD_REDUCE: BuffDef = {
  id: 'guard',
  nameKey: 'skill.guard.name',
  icon: 'char_guard',
  polarity: 'buff',
  color: C.guard,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  /**
   * 减伤 **55%**（早期是 40%）。
   *
   * 调整理由（平衡目标："不防御就算完美进攻也打不过，但防住 2–3 次就行"）：
   * Boss 单次重攻击已经提到 18/26（含易伤后一次能打掉 33 点血），
   * 40% 减伤只省下 ~7–13 点，**收益盖不住"按住防浪费的时间"**
   * （按住期间不能出招，战斗被拉长反而多挨打）。
   * 55% 让一次格挡省下 ~10–18 点，三次格挡就能换来一次容错。
   */
  flags: { damageReduce: 0.55 },
};

/** 凝：增伤 20%，持续 30 秒。 */
export const FOCUS_BUFF: BuffDef = {
  id: 'focus',
  nameKey: 'skill.focus.name',
  icon: 'char_focus',
  polarity: 'buff',
  color: C.focus,
  duration: logicMs(300),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'damageBoost',
      op: 'addPercent',
      value: 20,
      sourceKey: 'skill.focus.name',
      namespace: 'focus',
      tier: 'buff',
    },
  ],
};

/* ================================================================== *
 * Boss 专用
 * ================================================================== */





/**
 * 玩家给 Boss 挂的易伤。
 *
 * 为什么需要它：玩家只有 6 招，如果全是"直接伤害"，循环会没有层次。
 * 用一个易伤 debuff 让"先叠层再爆发"成为一种选择。
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
 * 玩家技能：六招，每招一个字
 * ================================================================== */

/** 斩：普攻。代价低、伤害低，是循环的填充。 */
const ATTACK: SkillDef = {
  id: 'attack',
  kind: 'activeSkill',
  nameKey: 'skill.attack.name',
  descKey: 'skill.attack.desc',
  icon: 'char_attack',
  abilities: [],
  /**
   * **读条 0.5 秒**（原先瞬发、靠公共冷却限速）。
   *
   * 公共冷却被删掉了 —— 它对玩家是**看不见的**（唯一的反馈就是按了
   * 没反应），而读条同样是限速，却是**看得见的**。代价也一样真实：
   * 读条时改用别的技能会把它打断，而代价在开始时已经扣了、不退。
   */
  castTime: 500,
  cooldown: 0,
  /**
   * **15 炁**（需求："斩 和 避 的炁耗都改成 15"）。
   *
   * ⚠️ 原先 10 炁 = 恰好"每秒一次"（炁每秒回 10）。改成 15 之后
   * 节奏变成**每 1.5 秒一次** —— 炁养得起的持续输出上限从 10/s 降到
   * **6.7/s**，这是有意抬高的"输出税"：闪避变便宜了，代价是打得慢了。
   */
  cost: [{ resource: 'energy', value: S(15) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: S(10),
            canCrit: false,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  tags: ['melee'],
  /** 读条 0.5 秒，所以会被打断 —— 这正是"轰要挑空档放"的博弈来源 */
  interruptible: true,
};

/** 闪：0.5 秒完全无敌。代价是 **30 炁**（满炁的 30%）。 */
const DODGE: SkillDef = {
  id: 'dodge',
  kind: 'activeSkill',
  nameKey: 'skill.dodge.name',
  descKey: 'skill.dodge.desc',
  icon: 'char_dodge',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: DODGE_IFRAME }],
  castTime: 0,
  /**
   * **1 秒冷却**。
   *
   * 演进：0 → 1.5s → 0 → **1s**。
   *   - 1.5s 时 Boss 每 1.5–2.2 秒一招，闪避总是差一点赶不上，
   *     实测只减掉 6.5% 的伤害（等于技能不存在）
   *   - 改成 0 之后，闪避又**会打断自己的「斩」**（一次输出 ≈10 伤），
   *     代价太大，实测"会闪反而更差"
   *   - 现在是 1s：保留"读条中闪避 = 放弃这次输出"的取舍，
   *     同时不让连按把炁浪费掉
   */
  cooldown: logicMs(10),
  /**
   * **15 炁**（30 → 15，需求："斩 和 避 的炁耗都改成 15"）。
   *
   * ⚠️ 原来是 30 = **3 次「斩」的代价**（旧注释原话就是"花 30 炁去闪不划算"）。
   * 降成 15 = 少打 1 次斩，于是"该躲时躲得起"这件事才真正成立 ——
   * 这也是设计里「轻蔑」敢说"硬吃"的原因：现在闪它只亏 5 点输出了。
   */
  cost: [{ resource: 'energy', value: S(15) }],
  targeting: { mode: 'self' },
  hits: [],
  /**
   * ⚠️ **`dodge` 是"被控时的出路"**：Boss 的「碾压」会造成倒地，倒地
   * 期间（`BuffFlags.restrictToTags`）只有带 `dodge` 的技能可按 ——
   * 也就是"被打倒了还能翻滚躲开下一击"。
   *
   * 与 `defensive` 并存不冲突：`defensive` 是"减伤类"的机械分类
   * （「防」也是它），`dodge` 特指**位移闪避** —— 倒地时按「防」
   * 不合理（你正躺着）。
   */
  tags: ['defensive', 'dodge'],
  interruptible: false,
};

/**
 * 闪：**免费**的短无敌（0.1 秒）。
 *
 * 与「避」并存的理由：避要 30 炁，炁见底时玩家就完全没有防御手段了。
 * 闪补上这个缺口 —— 但它换不来 0.5 秒，只换 0.1 秒，所以它**不能
 * 替代避**，只是"还能挣扎一下"。
 *
 * ⚠️ **初始不绑定任何按键**（需求）。它仍出现在设置里可被绑定；
 * 而战斗画面右下角**只显示已绑定按键的技能**。
 */
const FLASH: SkillDef = {
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
   * 也就是"被打倒了还能翻滚躲开下一击"。
   *
   * 与 `defensive` 并存不冲突：`defensive` 是"减伤类"的机械分类
   * （「防」也是它），`dodge` 特指**位移闪避** —— 倒地时按「防」
   * 不合理（你正躺着）。
   */
  tags: ['defensive', 'dodge'],
  interruptible: false,
};

/**
 * 防：按住持续减伤，松开取消。
 *
 * `holdDrain` 是引擎里"按住"机制的表达：每个逻辑步扣一次资源，
 * 资源耗尽或松手就自动取消。这样"一直按着"会有明确代价。
 */
const GUARD: SkillDef = {
  id: 'guard',
  kind: 'activeSkill',
  nameKey: 'skill.guard.name',
  descKey: 'skill.guard.desc',
  icon: 'char_guard',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: GUARD_REDUCE }],
  castTime: 0,
  cooldown: 0,
  cost: [],
  /** 按住期间每 0.1 秒扣 2 点缠。 */
  holdDrain: { resource: 'energy', perLogicTick: 2 },
  targeting: { mode: 'self' },
  hits: [],
  tags: ['defensive'],
  interruptible: false,
};

/** 破：打断任何技能。固定 5 秒 CD，不占公共冷却。 */
const BREAK: SkillDef = {
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
   * 现在「破」恢复成**稳定的基础打断**：CD 固定、不派生。
   * ⚠️ 与「截」的分工见 `JIE` 的说明。
   */
  cooldown: logicMs(50),
  /**
   * 代价 **10 炁**（需求："破增加 代价 10点炁"）。
   *
   * 原先免费：打断本身已经用 5 秒冷却计价了。加 10 炁之后，
   * "打断"也要和「斩」「闪」抢同一池炁，取舍更紧。
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
           * 机制。两者刻意分开：`破` 稳定（固定 CD）、`截` 高风险高回报。
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
   * ⚠️ 原先这里还有 `hintTags: ['interrupt']`，已删 —— 与上面 `tags`
   * 同一个理由：**打断靠 `hits[].effects` 里的 `interrupt` 效果实现**，
   * 提示现在也从那个效果推导（见 `app/skillHints.ts`）。
   * 手写一份必然与效果漂。
   */
  interruptible: false,
};

/** 轰：消耗 50 炁，造成 30 点伤害。 */
const BLAST: SkillDef = {
  id: 'blast',
  kind: 'activeSkill',
  nameKey: 'skill.blast.name',
  descKey: 'skill.blast.desc',
  icon: 'char_blast',
  abilities: [],
  /**
   * **读条 0.9 秒** —— 比「斩」长得多。
   *
   * 这是有意的取舍：轰是最高伤害的一招（30 点，普攻的 3 倍），
   * 代价是"酝酿得久、更容易被打断"。玩家得挑 Boss 刚出完招的
   * 空档来放，而不是无脑按。
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
        // 轰会打裂目标，叠易伤 —— 让"攒炁打轰"有额外收益
        { kind: 'grantBuff', target: { mode: 'primaryEnemy' }, buff: SUNDER_DEBUFF },
      ],
    },
  ],
  tags: ['spell'],
  /** 读条 0.9 秒 —— 最高伤害的代价就是最容易被打断 */
  interruptible: true,
};

/** 凝：消耗 50 炁，增伤 20%，持续 30 秒。 */
const FOCUS: SkillDef = {
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
  cost: [{ resource: 'douqi', value: S(50) }],
  targeting: { mode: 'self' },
  hits: [],
  tags: [],
  interruptible: false,
};

/* ================================================================== *
 * Boss 技能
 * ================================================================== *
 *
 * 设计约束（来自需求）：**Boss 的所有招式都默认可以被打断 / 闪避 / 格挡**。
 * 所以每个招式都是 `interruptible: true`，且伤害都走正常判定路径。
 */




/* ================================================================== *
 * 导出
 * ================================================================== */

/**
 * 玩家技能表。
 *
 * ⚠️ 这是**可用技能的全集**，不等于"战斗里会显示的技能"。
 * 战斗画面右下角只画**绑定了按键**的那些（见 `SkillBarView`）——
 * 「闪」默认没有按键，所以默认不出现在战斗画面里，但它在设置里可绑。
 */
export const PLAYER_SKILLS: readonly SkillDef[] = [
  ATTACK,
  /**
   * ⚠️ 「击」在这里（技能全集），但**不在键位表**里 —— 它靠派生出现。
   * 放在合集里是为了让 `registry.skill('strike')` 能解析到它
   * （引擎与 UI 都按 id 查技能定义）。
   */
  STRIKE,
  DODGE,
  FLASH,
  GUARD,
  BREAK,
  JIE,
  BLAST,
  FOCUS,
];

/**
 * **玩家技能 id 集合** —— "这个技能是不是玩家的"的**唯一真相**。
 *
 * ==================================================================
 * ⚠️ 为什么需要它（踩过的坑）
 * ==================================================================
 *
 * 判断"是不是 Boss 技能"曾经靠在 **id 前缀**上猜（`startsWith('boss-')`）。
 * 那在「色欲」加入后就静默失效了 —— 它的技能 id 是
 * `lust-hum` / `lust-entangle` / `lust-charm`，**全都不以 `boss-` 开头**，
 * 于是漏过检查。症状：**Boss 的技能出现在设置页的按键列表里**，
 * 玩家可以给 Boss 的招绑键。
 *
 * 同一个前缀约定还被另外两处依赖（`derivedSlots.ts` 的派生槽、
 * `viewModel.test.ts` 的读条时长护栏），它们**同时**对色欲失效。
 *
 * ⚠️ **所以不要再用 id 前缀判断技能归属。** 7 宗罪各有一套前缀，
 * 前缀约定每加一个 Boss 就要记得维护一次，而漏掉时**不会报错**。
 *
 * `ALL_SKILLS` 是由 `PLAYER_SKILLS` + 各 Boss 的技能表拼出来的，
 * 所以"在不在这个集合里"是**结构性的** —— 新加 Boss 时自动生效，
 * 不需要任何人记得改哪里。
 */
export const PLAYER_SKILL_IDS: ReadonlySet<string> = new Set(
  PLAYER_SKILLS.map((s) => s.id),
);

/**
 * 全部技能。
 *
 * ⚠️ **两个 Boss 的技能都在这里**，各自由自己的 `Behavior` 轮转决定实际
 * 放哪些（见 `LUST_BEHAVIORS` vs `PRIDE_BEHAVIORS`）。所以"注册"不等于
 * "会用"—— 这也是为什么加 Boss 只需要加它的轮转。
 *
 * ⚠️ 注意 `ALL_SKILLS` 里**混着 Boss 技能**，所以想"只要玩家技能"时
 * 不要按 id 前缀过滤，用 `PLAYER_SKILL_IDS`（见那里的说明）。
 */
export const ALL_SKILLS: readonly SkillDef[] = [
  ...PLAYER_SKILLS,
  ...PRIDE_SKILLS,
  ...LUST_SKILLS,
];

export const ALL_BUFFS: readonly BuffDef[] = [
  DODGE_IFRAME,
  FLASH_IFRAME,
  GUARD_REDUCE,
  FOCUS_BUFF,
  SUNDER_DEBUFF,
  BOSS_TELEGRAPH,
  BOSS_ENRAGE,
  ...PRIDE_BUFFS,
  ...LUST_BUFFS,
  /**
   * 「倒地」（Boss 的「碾压」给玩家的）。
   *
   * ⚠️ 必须注册进 `ALL_BUFFS` —— 内容校验器与 `registry.buffs` 都读它，
   * 漏了会导致"引擎认识这个 buff，但 hittest/校验看不到"。
   *
   * ⚠️ 它**不在** `PRIDE_BUFFS` 里：两个 Boss 都会用到它（设计 §6.4 的
   * "共享"边界），所以它由 `bossShared.ts` 定义、在这里单独列出。
   */
  KNOCKDOWN,
  /** 派生窗口（「截」成功后挂上，激活「击」）。 */
  COMBO_WINDOW,
];

void logicTicks;
