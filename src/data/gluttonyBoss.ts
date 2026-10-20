/**
 * **「暴食」** —— 地魔神。
 *
 * 设计记录：`docs/specs/2026-10-12-seven-sins.md` §12。
 *
 * ==================================================================
 * 它的题型
 * ==================================================================
 *
 * | Boss | 逼你决定的 |
 * |---|---|
 * | 傲慢 | "这一下发不发得起 30 炁去躲？" |
 * | 色欲 | "我现在该不该继续打？" |
 * | 嫉妒 | "我攒着的东西，还敢不敢留着？" |
 * | 贪婪 | "它的层数还在涨 —— 现在不爆发，等什么时候？" |
 * | 懒惰 | "它不动、血在回 —— 你打算什么时候动手？" |
 * | **暴食** | "**它刚咬了我一口 —— 那 5 秒我打不打得穿那层壳？**" |
 *
 * ==================================================================
 * 三块机制（用户 2026-10-14 定）
 * ==================================================================
 *
 * 1. **「啃噬」三条**（血 / 炁 / 缠）—— **放哪个池就吃哪个**
 * 2. **「血盾」**（只有血那条）：偷你【当前血的 30%，最少 10 点、
 *    **不致死**（最多留你 1 点）】→ 变成它身上一层壳，窗口 **5 秒**：
 *      - **5 秒内打穿** → 偷走的血**还给你**
 *      - **没打穿** → 它拿走（那些血**变成它的血**，不造成额外伤害）
 * 3. **被动「饕餮」**：**单场累计** 3 次**成功**的啃噬（被闪避的不算）
 *    → 获得「饱食」：持续一段时间、**减伤 30%**；然后计数清零、可再触发
 *    ⚠️ 但**血盾那层壳不吃这个减伤**（打壳的伤害不打折 —— 用户点名）
 *
 * ==================================================================
 * ⚠️ 数值：伤害刻意压得很低
 * ==================================================================
 *
 * 用户："**暴食的技能伤害不要太高了，他有偷取效果**" —— 所以两条伤害技
 * 按傲慢的**一半左右**给（14 / 26）。它靠啃噬活着，不靠打人。
 */

import type { ActiveSkillDef, Behavior, BuffDef, Expr, PassiveSkillDef, SkillDef } from '../core/types';
import type { BossDef } from './bossDefs';
import { logicMs } from '../core/loopConstants';
import { S } from './scale';
import { BOSS_TELEGRAPH } from './bossShared';

/** 读条标记（时长 = 自己的 `castTime`）。 */
function tel(skillId: string, ms: number): BuffDef {
  return { ...BOSS_TELEGRAPH, id: `boss-${skillId}-telegraph`, duration: ms };
}

/* ================================================================== *
 * 1. 「饱食」：3 次啃噬之后的减伤（先定义，计数那条要引用它）
 * ================================================================== */

/**
 * 「饱食」——减伤 **30%**，持续一段时间。
 *
 * ⚠️ `damageReduce: 0.3` 是**判定层**的旗标（`computeDamage` 读它），
 * 与「卸」的平减走同一条路 —— 不是"属性修正"。
 *
 * ⚠️ 它**不作用于血盾那层壳**：壳在 `absorbFromBuffs` 里**先吃掉全额伤害**
 * （那一步在 `computeDamage` 之前），所以"打壳"不打折 ——
 * 这正是用户点名的那条（"如果 血盾不吃这个减伤"）。
 */
export const GLUTTONY_SATED: BuffDef = {
  id: 'gluttony-sated',
  nameKey: 'gluttony.sated.name',
  icon: 'greed_idle',
  polarity: 'buff',
  color: 0x8ad0a0,
  duration: logicMs(80),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { damageReduce: 0.3 },
};

/* ================================================================== *
 * 2. 「饕餮」：计数**就是这条 buff 的层数**
 * ================================================================== */

/**
 * 「饕餮」——**buff 层数就是那个计数器**（用户原话："buff 累计 3 层
 * 自己触发别的，然后把自己消掉"）。
 *
 * ==================================================================
 * 计数怎么涨、怎么归零
 * ==================================================================
 *
 * - **+1 层**：`GLUTTONY_COUNT_PASSIVE` 的 `onHitTaken` 挂它 —— 而
 *   `onHitTaken` **只在"真的掉血了"时派发**（引擎既有语义），所以
 *   **被闪避 / 被免疫的那一次天然不计数**（用户："被闪避的 没偷成功
 *   不计数"）✓ 不需要额外写一条判据
 * - **满 3 层**：它自己的 `onBuffApplied` 触发器醒一次，判到 3 层 →
 *   给「饱食」+ **把自己清掉**（`Ability: 'removeBuff'`）
 * - **单场累计**：`duration` 是 30 秒（每次啃噬 `stackRefresh` 刷新），
 *   一局只打它一场 ⇒ "单场"与"这条 buff 的寿命"重合 ✓
 */
export const GLUTTONY_COUNT: BuffDef = {
  id: 'gluttony-count',
  nameKey: 'gluttony.count.name',
  icon: 'greed_idle',
  polarity: 'buff',
  color: 0xd8b34a,
  duration: logicMs(300),
  maxStacks: 3,
  stacking: { mode: 'stackRefresh', max: 3 },
  triggers: [
    {
      on: 'onBuffApplied',
      when: { kind: 'buffStacks', who: 'self', buffId: 'gluttony-count', minStacks: 3 },
      then: [
        { kind: 'grant', target: { mode: 'self' }, buff: GLUTTONY_SATED },
        { kind: 'removeBuff', target: { mode: 'self' }, buffId: 'gluttony-count' },
      ],
    },
  ],
};

/**
 * 给「饕餮」加层的**常驻被动**。
 *
 * ⚠️ 判据是"这一击真的扣到了东西"（`taken > 0`）—— 所以**闪避不计数**
 * 是天然的（`onHitTaken` 只在真的掉血时派发）。
 */
export const GLUTTONY_COUNT_PASSIVE: BuffDef = {
  id: 'gluttony-count-passive',
  nameKey: 'gluttony.name',
  icon: 'greed_idle',
  polarity: 'buff',
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  triggers: [
    {
      on: 'onHitTaken',
      then: [{ kind: 'grant', target: { mode: 'self' }, buff: GLUTTONY_COUNT }],
    },
  ],
};

/* ================================================================== *
 * 3. 「血盾」：偷来的血，5 秒内可以赎回去
 * ================================================================== */

/** 偷你当前血的 30%，但**最少 10 点、且不致死**（最多留你 1 点）。 */
export const GRAB_HP_AMOUNT: Expr = {
  e: 'clamp',
  value: {
    e: 'min',
    of: [
      { e: 'mul', of: [{ e: 'resource', who: 'target', resource: 'hp' }, { e: 'const', value: 0.3 }] },
      { e: 'add', of: [{ e: 'resource', who: 'target', resource: 'hp' }, { e: 'const', value: -1 }] },
    ],
  },
  min: { e: 'const', value: 10 },
  max: { e: 'const', value: 1e9 },
};

/**
 * 「血盾」本体 —— **打穿它就把血还给你**。
 *
 * ==================================================================
 * "打穿"由引擎实现，"还钱"由这条 buff 自己的触发器做
 * ==================================================================
 *
 * `absorbValue` 是"壳能吃多少伤害"，**扣光时引擎会把这条 buff 摘掉并补发
 * `buffExpired`**（见 `hitResolution` 的伤害路径 + `effectOps.absorbFromBuffs`）。
 * 所以"打穿"= **这条 buff 被摘掉**，而下面那条 `onBuffExpired` 就是
 * "碎"的那一刻。
 *
 * ⚠️ **到期 vs 打碎**：`duration` 5 秒到点也会派发 `buffExpired` ——
 * 那时**不该还钱**（用户："没打碎 → 它拿走"）。两者靠**`absorb` 还有没有剩**
 * 分：打碎 → 壳被扣到 0 并摘掉；到期 → 壳还在（有剩）。
 * 而触发器读得到它：`buffCustom` 读的是 `custom`（**当初偷了多少**），
 * 壳被扣过时 `absorb` 会变小 —— 这里用一条**只有"碎"才成立**的判据
 * （见下面的 `when`）。
 *
 * ⚠️ `custom`（这次偷了多少）与 `absorbValue`（壳的耐久）**是两个数**：
 * 一发打穿时它们不一样（壳 30、被打 50 → 只能还 30）。`custom` 由
 * `GLUTTONY_STEAL_PASSIVE` 那条 `grant` 带进来。
 */
export const GLUTTONY_SHIELD: BuffDef = {
  id: 'gluttony-shield',
  nameKey: 'gluttony.shield.name',
  icon: 'boss_armor',
  polarity: 'buff',
  color: 0xd06b6b,
  duration: logicMs(50),
  maxStacks: 1,
  stacking: { mode: 'replace' },
  /**
   * ⚠️ **`absorbValue` 说明不了这里的厚度**：壳的耐久 = **这次偷到的数**
   * （每次都不一样），而那是**运行期**才知道的 ⇒ 由「啃噬·血」那条
   * `grantBuff` 的 `custom` 带进来，引擎在 `grantBuff` 里把它**同时写进**
   * `absorb`（见 `hitResolution`：`absorb: custom` 与 `custom: custom`）。
   *
   * 所以这里的 10 只是**兜底**（万一有别的路挂了它）—— 「啃噬·血」那条
   * 路不会用它。
   */
  absorbValue: 10,
  /**
   * ⚠️ **打穿 = 撤销那次"偷"**（用户："5s内你要打破这个护盾，打破，**血还回来**"）。
   *
   * 走 `onBreak`（引擎在"壳被扣光"那条路上跑它），而不是 `onBuffExpired`
   * —— 后者**到期也会响**，那时不该还（用户："没打穿 → 它拿去"）。
   *
   * ==================================================================
   * 为什么是**两条**能力（这是 2026-10-14 修掉的一个真 bug）
   * ==================================================================
   *
   * `啃噬·血` 用的是 `transfer`，它是**双向**的：玩家 −N **且它 +N**。
   * 所以"还钱"必须**把两边都撤销**：
   *
   *   ① 玩家 **+N**        ← 血还给你
   *   ② 它 **−N**          ← ⚠️ 这一条以前**漏了**
   *
   * 只做① 的话：玩家净值 0、它 +N ⇒ **每打穿一次凭空多出 N 点血** ✗
   * （实测确认过；症状是"打穿反而让它更肥"，而血条上完全看不出破绽）
   *
   * ⚠️ 那条 `−N` 不会"多扣"：它扣的正是它当初偷到的那 N —— 所以净效果
   * 恰好等于"**那次偷取从没发生过**"（中间挨的打照算）。
   *
   * ⚠️ 数值走 `payloadCustom`（引擎把"当初偷了多少"随载荷带进来）：
   * 壳此刻**已经被摘掉**，`buffCustom` 也读不到它了。
   *
   * ==================================================================
   * ⚠️ 已知边界：**它满血时**，这两条不对称
   * ==================================================================
   *
   * `transfer` 的"加"会被 `caps.hp` **夹掉**（满血 ⇒ 它一点都没拿到），
   * 而这里的"撤销 −N"**照扣** ⇒ 打穿一次它会**净掉 N**（而不是 0）。
   *
   * 净效果是"**血被销毁**"而不是"凭空造出"（比原来那个 bug 轻得多，
   * 而且是**偏向玩家**的），所以先记在这里、不另外造"实际到账多少"的
   * 追踪。要根治得让那次偷取**只在壳到期时才真的补给它**（而不是先给、
   * 打穿再退）—— 那需要"到期时也能读到壳的 `custom`"，属于另一条改动。
   */
  onBreak: [
    /**
     * ⚠️ **二阶段「饥馑」：打穿也不还**（2026-10-20）。
     * 两条能力都加同一条门禁 —— 形态 buff 在 ⇒ 这次"还"整个不发生。
     */
    /** ① 把当初偷的血**还回玩家**。 */
    {
      kind: 'resource',
      target: { mode: 'primaryEnemy' },
      resource: 'hp',
      delta: { e: 'payloadCustom' },
      when: { kind: 'notHasBuff', who: 'self', buffId: 'gluttony-phase2' },
    },
    /** ② 同时从**它自己**身上扣掉那 N（撤销 `transfer` 的另一半）。 */
    {
      kind: 'resource',
      target: { mode: 'self' },
      resource: 'hp',
      delta: { e: 'mul', of: [{ e: 'payloadCustom' }, { e: 'const', value: -1 }] },
      when: { kind: 'notHasBuff', who: 'self', buffId: 'gluttony-phase2' },
    },
  ],
};

/* ================================================================== *
 * 4. 啃噬：血 / 炁 / 缠 三条
 * ================================================================== */

/** 偷当前值的 30%（炁 / 缠用）。 */
function grabRatio(pool: 'energy' | 'douqi'): Expr {
  return {
    e: 'mul',
    of: [{ e: 'resource', who: 'target', resource: pool }, { e: 'const', value: 0.3 }],
  };
}

/**
 * 「啃噬·血」：偷血 → 变壳（5 秒）。
 *
 * ⚠️ 它**不直接扣血**（`transfer` 会把血搬进它自己）—— 用户要的是
 * "**变成它身上一层壳**，打破就还"。所以这一条**只负责扣玩家**：
 * 用 `transfer` 的 `pool: 'hp'` 扣玩家，再靠**常驻被动**在"它挨打"时
 * 把偷来的量挂成壳（`grant.custom` 带上那个数）。
 *
 * ⚠️ 现在这一版**少了一半**（打穿还钱）—— 见文件末尾。
 */
export const GLUTTONY_GRAB_HP: ActiveSkillDef = {
  id: 'gluttony-grab-hp',
  kind: 'activeSkill',
  nameKey: 'gluttony.grabHp.name',
  descKey: 'gluttony.grabHp.desc',
  icon: 'boss_cleave',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('gluttony-grab-hp', logicMs(10)) },
  ],
  castTime: logicMs(10),
  cooldown: logicMs(60),
  cost: [],
  hits: [
    {
      at: logicMs(10),
      effects: [
        /** 先偷（这一步扣玩家、把同样的数补给施法者）。 */
        { kind: 'transfer', transfer: { pool: 'hp', amount: GRAB_HP_AMOUNT } },
        /**
         * ⚠️ **血盾由这一招自己挂**（用户 2026-10-14："血盾 是用那个主动技能
         * 偷血 挂的"）—— 早先是打算让一个常驻被动在挨打时挂，那一步**没写完**，
         * 所以"偷血 → 变壳 → 打穿还钱"整条链当时是**断的**。
         *
         * ⚠️ `custom` = **这次偷了多少**（与 `transfer` 读**同一个**表达式 ⇒
         * 两个数一致）。破壳时按它还钱（`onBreak` 用 `payloadCustom`）。
         */
        {
          kind: 'grantBuff',
          target: { mode: 'self' },
          buff: GLUTTONY_SHIELD,
          custom: GRAB_HP_AMOUNT,
        },
      ],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/* ================================================================== *
 * 5. 两条伤害技（刻意压低）
 * ================================================================== */

export const GLUTTONY_BITE: ActiveSkillDef = {
  id: 'gluttony-bite',
  kind: 'activeSkill',
  nameKey: 'gluttony.bite.name',
  descKey: 'gluttony.bite.desc',
  icon: 'boss_sweep',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('gluttony-bite', logicMs(8)) },
  ],
  castTime: logicMs(8),
  cooldown: logicMs(30),
  cost: [],
  hits: [
    {
      at: logicMs(8),
      effects: [
        { kind: 'damage', damage: { base: S(15), canCrit: false, countsAsHit: true } },
        /**
         * ⚠️ **偷炁并进这一招**（用户 2026-10-14："偷炁和偷缠的效果，直接
         * 加到 噬咬 / 大嚼 上"）—— 所以「暴食」只有**三条**技能：
         * 噬咬（伤害 + 偷炁）/ 大嚼（伤害 + 偷缠）/ 啃噬·血（偷血 + 血盾）。
         */
        { kind: 'transfer', transfer: { pool: 'energy', amount: grabRatio('energy') } },
      ],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

export const GLUTTONY_GORGE: ActiveSkillDef = {
  id: 'gluttony-gorge',
  kind: 'activeSkill',
  nameKey: 'gluttony.gorge.name',
  descKey: 'gluttony.gorge.desc',
  icon: 'boss_cleave',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: tel('gluttony-gorge', logicMs(16)) },
  ],
  castTime: logicMs(16),
  cooldown: logicMs(80),
  cost: [],
  hits: [
    {
      at: logicMs(16),
      effects: [
        { kind: 'damage', damage: { base: S(30), canCrit: false, countsAsHit: true } },
        /** ⚠️ 偷缠并进这一招（同「噬咬」那条说明）。 */
        { kind: 'transfer', transfer: { pool: 'douqi', amount: grabRatio('douqi') } },
      ],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['melee'],
  interruptible: true,
};

/* ================================================================== *
 * 6. 定义
 * ================================================================== */

export const GLUTTONY_SKILLS: readonly SkillDef[] = [
  GLUTTONY_BITE,
  GLUTTONY_GORGE,
  GLUTTONY_GRAB_HP,
];

/**
 * **暴食·二阶段「饥馑」**：血盾**打穿也不还**你（一阶段是"打穿 = 撤销那次偷"）。
 *
 * ⚠️ 它自己**没有**任何效果 —— 它只是那条"不还"判据的**主语**：
 * `GLUTTONY_SHIELD.onBreak` 的两条能力都加了
 * `when: notHasBuff(gluttony-phase2)`（`Ability.when` 是 2026-10-20 为此加的）。
 */
export const GLUTTONY_PHASE2: BuffDef = {
  id: 'gluttony-phase2',
  nameKey: 'phase2.gluttony.name',
  icon: 'boss_armor',
  polarity: 'buff',
  color: 0xd06b6b,
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
};

export const GLUTTONY_BUFFS: readonly BuffDef[] = [
  GLUTTONY_PHASE2,
  GLUTTONY_SATED,
  GLUTTONY_COUNT_PASSIVE,
  GLUTTONY_COUNT,
  GLUTTONY_SHIELD,
  tel('gluttony-bite', logicMs(8)),
  tel('gluttony-gorge', logicMs(16)),
  tel('gluttony-grab-hp', logicMs(10)),
];

/** 行为：**攻速高** —— `gapMs` 比傲慢的 4000 短不少；三条啃噬优先。 */
export const GLUTTONY_BEHAVIORS: readonly Behavior[] = [
  /**
   * **「恶魔低语·二阶段」的开关**（2026-10-20）：血量 ≤40% 时切「饥馑」。
   */
  {
    kind: 'onHpBelow',
    ratio: 0.4,
    then: [
      { kind: 'grant', target: { mode: 'self' }, buff: GLUTTONY_PHASE2, when: { kind: 'hasBuff', who: 'self', buffId: 'whisper-phase2' } },
    ],
  },
  { kind: 'enrage', atMs: 120_000, dmgMult: 2 },
  {
    kind: 'rotation',
    steps: [
      { skillId: 'gluttony-grab-hp' },
      { skillId: 'gluttony-gorge' },
      { skillId: 'gluttony-bite' },
    ],
  },
];

/** ⚠️ 血量与其它几个 Boss 暂时相同（等实测）。 */
export const GLUTTONY_HP = 420;

/**
 * **「饕餮」被动**（`PassiveSkillDef`）—— 成功啃噬 3 次 → 「饱食」减伤 30%。
 *
 * ⚠️ 与贪婪那条同病：以前只是个 `BuffDef`，引擎不挂 ⇒ **计数从不累加**。
 */
export const GLUTTONY_APPETITE_SKILL: PassiveSkillDef = {
  id: 'gluttony-appetite',
  kind: 'passive',
  nameKey: 'gluttony.count.name',
  descKey: 'gluttony.count.desc',
  icon: 'greed_idle',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: GLUTTONY_COUNT_PASSIVE }],
  tags: [],
};

export const GLUTTONY_BOSS: BossDef = {
  id: 'gluttony',
  hp: GLUTTONY_HP,
  nameKey: 'gluttony.name',
  skills: GLUTTONY_SKILLS,
  buffs: GLUTTONY_BUFFS,
  /**
   * ⚠️ **整场都在的被动**（开战前就挂上）。与 `buffs` 分开的理由见
   * `BossDef.passives` —— 这里的每一条都是**引擎真的会挂**的。
   */
  passives: [GLUTTONY_APPETITE_SKILL],
  behaviors: GLUTTONY_BEHAVIORS,
};

/**
 * ==================================================================
 * 两条曾经"表达不出来"的东西，现在都接线了（记下来免得重走）
 * ==================================================================
 *
 * 1. **"打穿壳 → 把偷走的血还给你"**：靠 `BuffDef.onBreak`（引擎在
 *    **扣光**那条路上**额外**跑的一串能力）+ `payload.custom`
 *    （把"当初偷了多少"随载荷带进去 —— 壳此刻已经摘掉，表达式读不到）。
 * 2. **"没打穿 → 它拿走"**：**不需要写内容** —— 因为 `transfer` 在偷的
 *    那一刻**已经把血给了它**，而"打穿"才会还回去。所以"到期什么都不做"
 *    正是默认行为 ✓（这也是 `onBreak` 与 `onBuffExpired` 必须分开的原因：
 *    后者到期也会响，用它还钱就等于"无论打没打穿都还"，那这一招白设计了）。
 */
