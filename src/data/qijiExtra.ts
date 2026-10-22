/**
 * **后加的炁机**（2026-10-20 / 10-22）—— 从 `qiji.ts` 拆出来的第二批。
 *
 * ⚠️ 为什么拆：`qiji.ts` 到 **727 行**（AGENTS.md §3 的上限 700），
 * 按"先拆、不压注释"的规矩横向切割 —— 最早那批（兜底两条 + 三条派生 +
 * 改技能那几条）留在 `qiji.ts`，这里放"后来加的"那几条。池子仍在
 * `qiji.ts` 的 `ALL_QIJI` 里拼（**唯一**真相），这里只出定义。
 */

import type { BuffDef } from '../core/types/buffs';
import type { QijiEntity } from '../core/types/qiji';
import { logicMs } from '../core/loopConstants';
import { ATTACK, PI } from './kits/linwanfeng';
import { FOCUS_BUFF } from './kits/shared';
import { S } from './scale';
import { CHONG_WINDOW } from './kits/daixuan';

/**
 * **全部炁机**（顺序 = `QijiSelect` 的候选顺序 / 光标默认位置）。
 *
 * ⚠️ 顺序必须**确定**（不能按解锁时间或随机排）：`nextCandidates` 与
 * `QijiSelect` 都以"传进来的顺序"为准，而黄金截图要能复现同一屏。
 *
 * ⚠️ **兜底排前面**：`unlock: always` 的两条永远可选，让光标默认落在
 * 它们上面（第一场打完时，玩家能一眼看到"至少能加血 / 加炁"）。
 * 机制炁机排在后面 —— 它们是"够到了才出现"的奖励。
 */
/**
 * **炁能共鸣**（2026-10-22，用户："10秒内再次释放某个大招，增加20%伤害，
 * 上限5层" + "炁能共鸣 的buff应该显示吧 不需要隐藏"）。
 *
 * 落法：一条**可见**的 10 秒 buff（`maxStacks 5`，每层 `damageBoost +20%`），
 * 由 `onCastFinish` + `filter: { by: 'skill', skillId: 'bo' }` 在**每次放「波」**
 * 时挂一层 —— `stackRefresh` 会同时刷新 10 秒的窗口 ✓。
 *
 * ⚠️ 为什么限「波」：用户说"可以给波"（另一条「炁能回收」也是给波的），
 * 两条一起构成"波流"。要扩到别的招只改 `skillId` 一处。
 */
export const QIJI_RESONANCE_BUFF: BuffDef = {
  id: 'qiji-resonance',
  nameKey: 'qiji.qiNengGongMing.name',
  icon: 'char_focus',
  polarity: 'buff',
  color: 0xc8a13a,
  duration: logicMs(100),
  maxStacks: 5,
  stacking: { mode: 'stackRefresh', max: 5 },
  modifiers: [
    {
      stat: 'damageBoost',
      op: 'add',
      value: 0.2,
      sourceKey: 'qiji.qiNengGongMing.name',
    },
  ],
};

export const QIJI_QI_RESONANCE: QijiEntity = {
  id: 'qiNengGongMing',
  kind: 'qiji',
  nameKey: 'qiji.qiNengGongMing.name',
  descKey: 'qiji.qiNengGongMing.desc',
  icon: 'char_focus',
  category: 'tempo',
  rarity: 'epic',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'bo', scope: 'run' },
    value: 3,
  },
  abilities: [],
  passiveBuffs: [
    {
      ...QIJI_RESONANCE_BUFF,
      triggers: [
        {
          on: 'onCastFinish',
          filter: { by: 'skill', skillId: 'bo' },
          then: [{ kind: 'grant', target: { mode: 'self' }, buff: QIJI_RESONANCE_BUFF }],
        },
      ],
    },
  ],
};

/** **炁能回收**（用户："减少这一招的消耗" + "可以给波"）：波的缠消耗 −15。 */
export const QIJI_QI_RECYCLE: QijiEntity = {
  id: 'qiNengHuiShou',
  kind: 'qiji',
  nameKey: 'qiji.qiNengHuiShou.name',
  descKey: 'qiji.qiNengHuiShou.desc',
  icon: 'char_guard',
  category: 'utility',
  rarity: 'rare',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'bo', scope: 'run' },
    value: 10,
  },
  abilities: [],
  skillTweak: {
    skillId: 'bo',
    costDeltas: [{ resource: 'douqi', delta: -15 }],
  },
};

/* ================================================================== *
 * 2026-10-20 新增两条（用户："接下来增加这2个炁机 斩+凝流派（凝对斩的加成
 * 更高），重击流（劈回缠，闪避也回缠）"）
 * ================================================================== */

/**
 * **「凝神斩意」**（斩 + 凝流派：**凝生效时，斩额外造成伤害**）。
 *
 * ==================================================================
 * 为什么是"额外一次命中"而不是"提高倍率"
 * ==================================================================
 *
 * 引擎里**没有"只对某个技能生效的伤害倍率"**：`damageBoost` / `damageMult`
 * 都是**整局属性**（对所有技能生效）。而 `skillTweak` 只能改代价 / 用出时
 * 挂 buff / 覆盖某条 buff 的修正值 —— 都改不了"斩这一刀的伤害"。
 *
 * 所以用**触发器 + `deal`**：`onHitDealt` 命中「斩」且玩家身上有「凝」
 * 时，**追加一次命中**（6 点，不吃暴击）。数值上就等于"凝对斩的加成更高"
 * （斩基础 10 → 凝期间 16），而且**只有斩吃**（劈 / 轰不受影响）✓。
 *
 * ⚠️ `cooldownMs: 100` 是**防递归**：追加的那一次命中也会派发
 * `onHitDealt`（同一个 skillId），没有冷却就会在同 tick 里自我触发。
 * 100ms 短于「斩」的读条（0.6 秒），所以正常连击不会被吞。
 */
export const QIJI_FOCUS_SLASH: QijiEntity = {
  id: 'ningShenZhanYi',
  kind: 'qiji',
  nameKey: 'qiji.ningShenZhanYi.name',
  descKey: 'qiji.ningShenZhanYi.desc',
  icon: 'char_focus',
  category: 'offense',
  rarity: 'epic',
  /**
   * 用「斩」**3 次** + 用「凝」**3 次**（2026-10-20 用户："条件降低一点吧，
   * 各 3 次就行了"—— 原来斩要 30 次，太靠后）。
   */
  unlock: {
    kind: 'all',
    of: [
      { kind: 'statAtLeast', stat: { s: 'skillUses', skillId: ATTACK.id, scope: 'run' }, value: 3 },
      { kind: 'statAtLeast', stat: { s: 'skillUses', skillId: 'focus', scope: 'run' }, value: 3 },
    ],
  },
  abilities: [],
  passiveBuffs: [
    {
      id: 'qiji-focus-slash',
      nameKey: 'qiji.ningShenZhanYi.name',
      icon: 'char_focus',
      polarity: 'buff',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      triggers: [
        {
          on: 'onHitDealt',
          filter: { by: 'skill', skillId: ATTACK.id },
          when: { kind: 'hasBuff', who: 'self', buffId: FOCUS_BUFF.id },
          /** ⚠️ 防递归：追加的那一刀也会派发 `onHitDealt`（见上）。 */
          cooldownMs: 100,
          then: [
            {
              kind: 'deal',
              target: { mode: 'primaryEnemy' },
              hit: {
                at: 0,
                effects: [
                  {
                    kind: 'damage',
                    damage: { base: S(6), canCrit: false, countsAsHit: true },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

/** 「劈」用出时回多少缠。 */
const CHONGJI_DOUQI_BACK = 10;
/** **成功闪避**（躲掉一次命中）回多少缠。 */
const DODGE_DOUQI_BACK = 5;

/**
 * **「重击回缠」**：**用出「劈」就回缠**（重击流的一半）。
 *
 * ⚠️ 2026-10-20 用户："重击回缠，拆3成2个 炁机" —— 原先"劈回缠 + 闪避回缠"
 * 挤在一条里，现在拆成两条（这条管**劈**，闪避那条见 `QIJI_DODGE_DOUQI`）。
 * 拆开的好处是**解锁条件可以分开**（想玩重击的人先拿到劈，爱闪的人另有路）。
 *
 * `skillTweak.onUse` 的 `resource`（`castFinish` 结算）回
 * `CHONGJI_DOUQI_BACK` 点缠 —— 劈的代价本来就是缠（50），这是部分返还。
 */
export const QIJI_CHONGJI: QijiEntity = {
  id: 'chongJiHuiChan',
  kind: 'qiji',
  nameKey: 'qiji.chongJiHuiChan.name',
  descKey: 'qiji.chongJiHuiChan.desc',
  icon: 'char_attack',
  category: 'offense',
  rarity: 'rare',
  /** ⚠️ 2026-10-20 用户："劈 5次 就解锁"（原来 30 —— 太靠后）。 */
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: PI.id, scope: 'run' },
    value: 5,
  },
  abilities: [],
  skillTweak: {
    skillId: PI.id,
    onUse: {
      kind: 'resource',
      target: { mode: 'self' },
      resource: 'douqi',
      delta: CHONGJI_DOUQI_BACK,
    },
  },
};

/**
 * **「闪避回缠」**：**成功躲掉一击就回缠**（重击流的另一半）。
 *
 * 判据是 `onAvoided`（"真的躲掉了"），不是"按了几次避" —— 用户原话
 * "闪避也回缠"。于是林晚风的「避」、凯丽的「闪」、乃至炁机带来的无敌
 * 窗口都算 ✓（它们都走 `invulnerable` 的 `avoided` 通路）。
 *
 * ⚠️ 解锁看 `dodges`（成功闪避的次数），不是 `skillUses`：这条炁机讲的
 * 就是"闪避"，用 `skillUses(dodge)` 会把凯丽（没有「避」）排除在外 ✗。
 */
export const QIJI_DODGE_DOUQI: QijiEntity = {
  id: 'shanBiHuiChan',
  kind: 'qiji',
  nameKey: 'qiji.shanBiHuiChan.name',
  descKey: 'qiji.shanBiHuiChan.desc',
  icon: 'char_dodge',
  category: 'defense',
  rarity: 'uncommon',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'dodges', scope: 'run' },
    value: 3,
  },
  abilities: [],
  passiveBuffs: [
    {
      id: 'qiji-dodge-douqi',
      nameKey: 'qiji.shanBiHuiChan.name',
      icon: 'char_dodge',
      polarity: 'buff',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      triggers: [
        {
          on: 'onAvoided',
          then: [
            { kind: 'resource', target: { mode: 'self' }, resource: 'douqi', delta: DODGE_DOUQI_BACK },
          ],
        },
      ],
    },
  ],
};

/* ================================================================== *
 * 2026-10-22 第二轮（用户："就叫 冲，开工吧" + 已确认的四条）
 * ================================================================== */

/** 「回炁生息」的窗口：4 秒内炁回复 ×1.5。 */
const QIJI_YU_ENERGY_BUFF: BuffDef = {
  id: 'qiji-yu-energy',
  nameKey: 'qiji.huiQiShengXi.name',
  icon: 'char_focus',
  polarity: 'buff',
  color: 0x8ac06a,
  duration: logicMs(40),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'energyRegenScale',
      op: 'add',
      value: 0.5,
      sourceKey: 'qiji.huiQiShengXi.name',
    },
  ],
};

/**
 * **回炁生息**：用完「愈」之后 4 秒内炁回复 **+50%**。
 *
 * 用途：黛玄的「弹」是炁换伤害，所以"回炁加速"直接等于"多打几发"。
 */
export const QIJI_YU_ENERGY: QijiEntity = {
  id: 'huiQiShengXi',
  kind: 'qiji',
  nameKey: 'qiji.huiQiShengXi.name',
  descKey: 'qiji.huiQiShengXi.desc',
  icon: 'char_focus',
  category: 'utility',
  rarity: 'rare',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'yu', scope: 'run' },
    value: 3,
  },
  abilities: [],
  passiveBuffs: [
    {
      ...QIJI_YU_ENERGY_BUFF,
      triggers: [
        {
          on: 'onCastFinish',
          filter: { by: 'skill', skillId: 'yu' },
          then: [{ kind: 'grant', target: { mode: 'self' }, buff: QIJI_YU_ENERGY_BUFF }],
        },
      ],
    },
  ],
};

/** 「破军之势」的窗口：10 秒内伤害 +15%。 */
const QIJI_BREAK_MIGHT_BUFF: BuffDef = {
  id: 'qiji-break-might',
  nameKey: 'qiji.poJunZhiShi.name',
  icon: 'char_break',
  polarity: 'buff',
  color: 0xc8a13a,
  duration: logicMs(100),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    { stat: 'damageBoost', op: 'add', value: 0.15, sourceKey: 'qiji.poJunZhiShi.name' },
  ],
};

/** **破军之势**：用「破」**成功打断**之后 10 秒，伤害 +15%。 */
export const QIJI_BREAK_MIGHT: QijiEntity = {
  id: 'poJunZhiShi',
  kind: 'qiji',
  nameKey: 'qiji.poJunZhiShi.name',
  descKey: 'qiji.poJunZhiShi.desc',
  icon: 'char_break',
  category: 'offense',
  rarity: 'rare',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillInterrupts', skillId: 'break', scope: 'run' },
    value: 3,
  },
  abilities: [],
  passiveBuffs: [
    {
      ...QIJI_BREAK_MIGHT_BUFF,
      triggers: [
        {
          on: 'onInterruptSuccess',
          filter: { by: 'skill', skillId: 'break' },
          then: [{ kind: 'grant', target: { mode: 'self' }, buff: QIJI_BREAK_MIGHT_BUFF }],
        },
      ],
    },
  ],
};

/**
 * 「盾壁森严」额外送的那一层盾。
 *
 * ⚠️ 与 `daixuan-shield` **同一个 id 前缀但不同 id**：`applyBuff` 按 id 复用
 * 实例，同 id 会把它和技能自带的两层叠成"同一条 buff 的 3 层"—— 那其实也行，
 * 但**消耗顺序**会变成"先扣技能的那一层"（不符直觉）。这里单独一条，
 * 语义是"额外的一层，先扣它"。
 */
const QIJI_EXTRA_SHIELD_BUFF: BuffDef = {
  id: 'qiji-thick-shield',
  nameKey: 'skill.dun.name',
  icon: 'char_guard',
  polarity: 'buff',
  duration: logicMs(80),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { negateHits: 1 },
};

/** **盾壁森严**：盾的层数 **2 → 3**（缠消耗 30 → 45，CD 不变）。 */
export const QIJI_THICK_SHIELD: QijiEntity = {
  id: 'dunBiSenYan',
  kind: 'qiji',
  nameKey: 'qiji.dunBiSenYan.name',
  descKey: 'qiji.dunBiSenYan.desc',
  icon: 'char_guard',
  category: 'defense',
  rarity: 'rare',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'dun', scope: 'run' },
    value: 10,
  },
  abilities: [],
  skillTweak: {
    skillId: 'dun',
    /** 30 → **45**（用户："消耗也等比增加"）。 */
    costDeltas: [{ resource: 'douqi', delta: 15 }],
  },
  passiveBuffs: [
    {
      ...QIJI_EXTRA_SHIELD_BUFF,
      triggers: [
        {
          on: 'onCastFinish',
          filter: { by: 'skill', skillId: 'dun' },
          then: [{ kind: 'grant', target: { mode: 'self' }, buff: QIJI_EXTRA_SHIELD_BUFF }],
        },
      ],
    },
  ],
};

/**
 * **爆裂护盾**：盾的**每一层被消耗**时，对 Boss 造成 10 点伤害（不触发反伤）。
 *
 * 判据用 `onBuffStackChanged`（`by: 'buff', buffId: 'daixuan-shield'`）——
 * 那正是"层数 −1"的那一刻 ✓，比"整段盾过期时触发一次"精确。
 *
 * ⚠️ `deal` 走的是普通伤害通路，所以**会不会触发反伤**取决于伤害来源 ——
 * 用户要求"不触发反伤"，而 `deal` 的伤害来源是**玩家**（不是"反射伤害"），
 * 因此不会走 `reflect` 分支 ✓（反射只在挨打时产生，见 `damage.ts`）。
 */
export const QIJI_EXPLOSIVE_SHIELD: QijiEntity = {
  id: 'baoLieHuDun',
  kind: 'qiji',
  nameKey: 'qiji.baoLieHuDun.name',
  descKey: 'qiji.baoLieHuDun.desc',
  icon: 'char_guard',
  category: 'offense',
  rarity: 'epic',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'dun', scope: 'run' },
    value: 20,
  },
  abilities: [],
  passiveBuffs: [
    {
      id: 'qiji-explosive-shield',
      nameKey: 'qiji.baoLieHuDun.name',
      icon: 'char_guard',
      polarity: 'buff',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      triggers: [
        {
          on: 'onBuffStackChanged',
          filter: { by: 'buff', buffId: 'daixuan-shield' },
          then: [
            {
              kind: 'deal',
              target: { mode: 'primaryEnemy' },
              hit: {
                at: 0,
                effects: [
                  { kind: 'damage', damage: { base: S(10), canCrit: false, countsAsHit: true } },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

/** 「弹中生波」：按住「弹」满 4 秒 ⇒ 开一次「冲」的窗口。 */
export const QIJI_HOLD_WAVE: QijiEntity = {
  id: 'danZhongShengBo',
  kind: 'qiji',
  nameKey: 'qiji.danZhongShengBo.name',
  descKey: 'qiji.danZhongShengBo.desc',
  icon: 'char_attack',
  category: 'offense',
  rarity: 'epic',
  unlock: {
    /** ⚠️ "发 10 次弹" = **命中 10 次**（按住只算 1 次 `skillUses` ✗）。 */
    kind: 'statAtLeast',
    stat: { s: 'skillHits', skillId: 'dan', scope: 'run' },
    value: 10,
  },
  abilities: [],
  passiveBuffs: [
    {
      id: 'qiji-hold-wave',
      nameKey: 'qiji.danZhongShengBo.name',
      icon: 'char_attack',
      polarity: 'buff',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      triggers: [
        {
          on: 'onTick',
          /** 每按住满 4 秒开一次窗口（`when` 保证"只在你按着弹的时候"）。 */
          cooldownMs: 4000,
          when: { kind: 'hasBuff', who: 'self', buffId: 'daixuan-tan-rhythm' },
          then: [
            { kind: 'grant', target: { mode: 'self' }, buff: CHONG_WINDOW },
          ],
        },
      ],
    },
  ],
};

/** 「缠尽还生」：缠见底时自己回一点。 */
export const QIJI_CHAN_REGEN: QijiEntity = {
  id: 'chanJinHuanSheng',
  kind: 'qiji',
  nameKey: 'qiji.chanJinHuanSheng.name',
  descKey: 'qiji.chanJinHuanSheng.desc',
  icon: 'char_focus',
  category: 'utility',
  rarity: 'rare',
  /** 「累计消耗 500 缠」（2026-10-22 加了这个统计维度之后按用户原话落）。 */
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'resourceSpent', resource: 'douqi', scope: 'run' },
    value: 500,
  },
  abilities: [],
  passiveBuffs: [
    {
      id: 'qiji-chan-regen',
      nameKey: 'qiji.chanJinHuanSheng.name',
      icon: 'char_focus',
      polarity: 'buff',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      triggers: [
        {
          on: 'onTick',
          cooldownMs: 5000,
          when: { kind: 'resourceBelow', who: 'self', resource: 'douqi', value: 20 },
          then: [
            { kind: 'resource', target: { mode: 'self' }, resource: 'douqi', delta: 10 },
          ],
        },
      ],
    },
  ],
};

/** 「轰雷贯耳」的窗口：3 秒内「拳」伤害 +50%。 */
const QIJI_BLAST_ECHO_BUFF: BuffDef = {
  id: 'qiji-blast-echo',
  nameKey: 'qiji.hongLeiGuanEr.name',
  icon: 'char_attack',
  polarity: 'buff',
  color: 0xd05a2a,
  duration: logicMs(30),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    { stat: 'damageBoost', op: 'add', value: 0.5, sourceKey: 'qiji.hongLeiGuanEr.name' },
  ],
};

/**
 * **轰雷贯耳**（2026-10-22，补凯丽「轰」的缺口）：**「轰」命中后 3 秒内
 * 伤害 +50%**。
 *
 * ⚠️ 为什么是"全局 damageBoost"而不是"只对拳"：引擎**没有"只对某个技能
 * 生效的伤害倍率"**（`damageBoost` / `damageMult` 都是整局属性；`skillTweak`
 * 只能改代价 / 用出时挂 buff / 覆盖某条 buff 的数值）。所以这条写成了
 * "轰之后的三秒里，任何招都更疼" —— 而凯丽的循环本来就是 轰 → 拳，
 * 手感上等价于"拳头更重" ✓（同一条理由见「凝神斩意」用 `deal` 追加伤害）。
 */
export const QIJI_BLAST_ECHO: QijiEntity = {
  id: 'hongLeiGuanEr',
  kind: 'qiji',
  nameKey: 'qiji.hongLeiGuanEr.name',
  descKey: 'qiji.hongLeiGuanEr.desc',
  icon: 'char_attack',
  category: 'offense',
  rarity: 'rare',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillHits', skillId: 'blast', scope: 'run' },
    value: 10,
  },
  abilities: [],
  passiveBuffs: [
    {
      ...QIJI_BLAST_ECHO_BUFF,
      triggers: [
        {
          on: 'onHitDealt',
          filter: { by: 'skill', skillId: 'blast' },
          then: [{ kind: 'grant', target: { mode: 'self' }, buff: QIJI_BLAST_ECHO_BUFF }],
        },
      ],
    },
  ],
};

