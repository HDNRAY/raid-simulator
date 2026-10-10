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
export { C, S } from './scale';
import {
  BOSS_ARMOR,
  BOSS_CLEAVE_ARMOR,
  BOSS_ENRAGE,
  KNOCKDOWN,
  BOSS_SKILLS,
  BOSS_TELEGRAPH,
} from './bossSkills';

/**
 * Boss 的 buff 与技能从 `./bossSkills` **转发**，外部 import 路径不变。
 */
export {
  KNOCKDOWN,
  BOSS_ARMOR,
  BOSS_ARMOR_SKILL,
  BOSS_CLEAVE,
  BOSS_CLEAVE_ARMOR,
  BOSS_EMPOWER,
  BOSS_ENRAGE,
  BOSS_SKILLS,
  BOSS_SWEEP,
  BOSS_TELEGRAPH,
} from './bossSkills';


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

/** 攻：普攻。代价低、伤害低，是循环的填充。 */
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
  cost: [{ resource: 'energy', value: S(10) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          kind: 'damage',
          damage: {
            base: S(10),
            school: 'physical',
            canCrit: false,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  tags: ['melee'],
  school: 'physical',
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
   *   - 改成 0 之后，闪避又**会打断自己的「攻」**（一次输出 ≈10 伤），
   *     代价太大，实测"会闪反而更差"
   *   - 现在是 1s：保留"读条中闪避 = 放弃这次输出"的取舍，
   *     同时不让连按把炁浪费掉
   */
  cooldown: logicMs(10),
  /** 瞬发无冷却 —— 否则"该躲时躲不了"。 */
  cost: [{ resource: 'energy', value: S(30) }],
  targeting: { mode: 'self' },
  hits: [],
  /**
   * ⚠️ **`dodge` 是"被控时的出路"**：Boss 的「横扫」会造成倒地，倒地
   * 期间（`BuffFlags.restrictToTags`）只有带 `dodge` 的技能可按 ——
   * 也就是"被打倒了还能翻滚躲开下一击"。
   *
   * 与 `defensive` 并存不冲突：`defensive` 是"减伤类"的机械分类
   * （「防」也是它），`dodge` 特指**位移闪避** —— 倒地时按「防」
   * 不合理（你正躺着）。
   */
  tags: ['defensive', 'dodge'],
  school: 'physical',
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
   * ⚠️ **`dodge` 是"被控时的出路"**：Boss 的「横扫」会造成倒地，倒地
   * 期间（`BuffFlags.restrictToTags`）只有带 `dodge` 的技能可按 ——
   * 也就是"被打倒了还能翻滚躲开下一击"。
   *
   * 与 `defensive` 并存不冲突：`defensive` 是"减伤类"的机械分类
   * （「防」也是它），`dodge` 特指**位移闪避** —— 倒地时按「防」
   * 不合理（你正躺着）。
   */
  tags: ['defensive', 'dodge'],
  school: 'physical',
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
  school: 'physical',
  interruptible: false,
};

/** 破：打断任何技能。固定 5 秒 CD，不占公共冷却。 */
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

const BREAK: SkillDef = {
  id: 'break',
  kind: 'activeSkill',
  nameKey: 'skill.break.name',
  descKey: 'skill.break.desc',
  icon: 'char_break',
  abilities: [],
  castTime: 0,
  /**
   * 冷却 **10 秒**（需求："失败则 cd 10 秒"）。
   *
   * ⚠️ 这个值必须与 `onSuccess` 里退还的量**完全相等**，否则
   * "成功不进 CD"就不成立：
   *   - 退多了 → 减到 `tick` 被钳住（看起来对，但掩盖了配置错误）
   *   - 退少了 → 成功之后还剩一截 CD（玩家会以为"怎么还在转"）
   * 所以 `content/validate.ts` 里有一条断言强制两者相等。
   *
   * 演进：5 秒（旧「破」）→ **10 秒**（「截」，因为成功时不消耗 CD，
   * 失败时的惩罚就该更重 —— 否则连按赌运气没有代价）。
   */
  cooldown: logicMs(100),
  /**
   * 代价 **10 炁**（需求："破增加 代价 10点炁"）。
   *
   * 原先免费：打断本身已经用 5 秒冷却计价了。加 10 炁之后，
   * "打断"也要和「攻」「闪」抢同一池炁，取舍更紧。
   */
  cost: [{ resource: 'energy', value: S(10) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        {
          // 打断不区分可打断性：Boss 的所有招式都能被破
          kind: 'interrupt',
          target: { mode: 'primaryEnemy' },
          force: true,
          /**
           * ============================================================
           * **只有真打断到了才结算这两条**（需求："如果成功，不进入 cd"）
           * ============================================================
           *
           *   1. `cooldown` 退还 —— 施放时已经扣了那 10 秒，这里减掉
           *      同样的量。用 `skillId` 不填 = 调"当前这个技能自己"。
           *   2. `grantBuff` 挂 `combo-window` —— 于是「击」被激活。
           *
           * ⚠️ 失败（Boss 没在读条 / 带霸体）时这两条都不结算，
           * 那 10 秒冷却就自然留着 —— 正是需求要的"失败则 cd 10 秒"。
           */
          onSuccess: [
            { kind: 'cooldown', cooldownMs: -logicMs(100) },
            { kind: 'grantBuff', target: { mode: 'self' }, buff: COMBO_WINDOW },
          ],
        },
      ],
    },
  ],
  tags: ['interrupt'],
  /** 提示玩家"这一招会打断目标" */
  hintTags: ['interrupt'],
  school: 'physical',
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
   * **读条 0.9 秒** —— 比「攻」长得多。
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
            school: 'arcane',
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
  school: 'arcane',
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
  school: 'arcane',
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
  BLAST,
  FOCUS,
];



export const ALL_SKILLS: readonly SkillDef[] = [...PLAYER_SKILLS, ...BOSS_SKILLS];

export const ALL_BUFFS: readonly BuffDef[] = [
  DODGE_IFRAME,
  FLASH_IFRAME,
  GUARD_REDUCE,
  FOCUS_BUFF,
  SUNDER_DEBUFF,
  BOSS_TELEGRAPH,
  BOSS_ENRAGE,
  BOSS_ARMOR,
  BOSS_CLEAVE_ARMOR,
  /**
   * 「倒地」（Boss 的「横扫」给玩家的）。
   *
   * ⚠️ 必须注册进 `ALL_BUFFS` —— 内容校验器与 `registry.buffs` 都读它，
   * 漏了会导致"引擎认识这个 buff，但 hittest/校验看不到"。
   */
  KNOCKDOWN,
  /** 派生窗口（「截」成功后挂上，激活「击」）。 */
  COMBO_WINDOW,
];

void logicTicks;
