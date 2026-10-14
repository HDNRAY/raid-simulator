/**
 * **「色欲」** —— 第二个 Boss（诡术型）。
 *
 * ==================================================================
 * 它和「傲慢」的区别是**机制**，不是数值
 * ==================================================================
 *
 * 设计定位（`docs/specs/2026-10-10-lust-boss.md` §0.2）：
 *
 *   傲慢     → "这一下发不发得起 30 炁去躲？"（快慢刀 + 资源分配）
 *   色欲     → "**我现在该不该继续打？**"（反伤 + 3 秒锁死惩罚贪刀）
 *
 * 所以它的伤害**比伪名低**（12 / 30 vs 28 / 36），不靠伤害压制，而是靠
 * "你不敢连打"：
 *   - 连打 → 被「欲望印记」反伤
 *   - 停手 → 时限压力上来
 *   - 刚好在连打中被「魅惑」→ **3 秒白挨**
 *
 * ⚠️ 本作**不分伤害类型**（用户决定），所以技能表里只有伤害数值。
 */

import type { Behavior, BuffDef, SkillDef } from '../core/types';
import type { BossDef } from './bossDefs';
import { logicMs } from '../core/loopConstants';
import { S } from './scale';

/* ------------------------------------------------------------------ *
 * 「欲望印记」—— 反伤被动
 * ------------------------------------------------------------------ */

/**
 * 印记的**触发内 CD**（ms）。
 *
 * ⚠️ 它是"防循环"的**机制层**保障（设计 §3.3）：反伤本身算受击，所以
 * 反伤造成的伤害会**再派发一次** `onHitTaken`。终止主要靠"玩家侧没有
 * 同款触发器"（内容层），但那个保证是**内容约定**而不是机制保证 ——
 * 这一条让它即使内容写出环也不会失控。
 */
const MARK_INTERNAL_CD_MS = 1000;

/** 反伤伤害。相对玩家的 100 血，18 是"值得为它停手"的量级。 */
const REFLECT_DAMAGE = 18;

/**
 * 印记的**公共字段**（不含触发器）。
 *
 */
const MARK_BASE = {
  id: 'lust-mark',
  nameKey: 'lust.mark.name',
  icon: 'lust_mark',
  /**
   * ⚠️ **`neutral`，不是 `debuff`**。
   *
   * 它挂在**色欲自己**身上，语义是"**它的反击已就绪**"（一个技术标记），
   * 而不是"色欲被削弱了"。标成 debuff 会让它出现在**减益那一行**，
   * 读起来像玩家给它上了负面状态 —— 但实际上是**它的**威胁提示。
   */
  polarity: 'neutral' as const,
  color: 0x9868d6,
  duration: logicMs(30),
  maxStacks: 1,
  stacking: { mode: 'refresh' as const },
};


/**
 * 「欲望印记」：受伤后挂上的标记，3 秒内**再受伤**就反伤。
 *
 * ==================================================================
 * ⚠️ 平衡命门：印记**不被刷新**
 * ==================================================================
 *
 * 挂印记那条触发器的条件是 `notHasBuff(lust-mark)` —— 也就是**已有印记
 * 时不再挂**，而不是"刷新持续时间"。
 *
 * 如果改成每次受伤都刷新，那么玩家只要持续攻击，印记就**永不消失** →
 * 每一下都被反伤、规避窗口变成 0。那样反伤就从"博弈"退化成"每次攻击
 * 固定扣 18 血"，玩家唯一的选择是不打 —— 而"不打"在有时限的战斗里
 * 等于输。
 *
 * 现在的规则让每次反伤之后，玩家都拿到一个**明确的 3 秒安全窗口**。
 */
export const LUST_MARK: BuffDef = {
  ...MARK_BASE,
  triggers: [
    {
      on: 'onHitTaken',
      /**
       * ⚠️ 只在**已经有印记**时反伤。
       *
       * 相关说明）—— 所以这里的 `hasBuff` 是"玩家已经打过我一下了"。
       */
      when: { kind: 'hasBuff', buffId: 'lust-mark' },
      cooldownMs: MARK_INTERNAL_CD_MS,
      then: [
        {
          kind: 'deal',
          target: { mode: 'primaryEnemy' },
          hit: {
            at: 0,
            effects: [
              {
                kind: 'damage',
                /**
                 * ⚠️ `ignoreModifiers: true` —— 反伤**不吃增伤/减伤**。
                 *
                 * 否则玩家开了增伤 buff 之后反伤会跟着放大，变成
                 * "越强越容易被自己打死"这种反直觉的结果。
                 */
                damage: {
                  base: REFLECT_DAMAGE,
                  canCrit: false,
                  countsAsHit: true,
                  ignoreModifiers: true,
                },
              },
              /**
               * 反伤**消耗**印记 —— 这就是"玩家能主动规避"的来源。
               *
               * ⚠️ **必须写 `target: { mode: 'self' }`。**
               *
               * `removeBuff` 的目标缺省是"这次命中的目标"，而这条效果是在
               * **反伤那一次命中**里结算的 —— 那次命中的目标**是玩家**，
               * 于是它会去移除玩家身上的印记（不存在），而 Boss 自己的
               * 印记**留了下来** → 印记永不消耗 → 反伤每次都触发。
               *
               * 实测症状：反伤照常发生，但 Boss 的印记一直在（表现成
               * "被动没有消耗制"，正好毁掉这个机制的核心）。
               */
              { kind: 'removeBuff', buffId: 'lust-mark', target: { mode: 'self' } },
            ],
          },
        },
      ],
    },
  ],
};

/**
 * 「欲望印记」的**挂载者**：常驻、隐藏的被动。
 *
 * ==================================================================
 * ⚠️ 为什么必须有它（自举悖论）
 * ==================================================================
 *
 * 最初我把"受伤就挂印记"写成**印记自己身上的触发器** —— 那是自举悖论：
 * 触发器要生效，印记得先在身上；而印记恰恰靠那条触发器才挂上。
 * 实测症状：受击时 `owner.buffs` 是空的，反伤机制整个不工作。
 *
 * 所以挂载者必须是**另一个始终存在**的 buff。由 `units.ts` 在造「色欲」
 * 时挂上（与 Boss 的霸体标记同一类"引擎状态"）。
 */
export const LUST_PASSIVE: BuffDef = {
  id: 'lust-passive',
  nameKey: 'lust.name',
  icon: 'lust_mark',
  polarity: 'buff',
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  triggers: [
    {
      on: 'onHitTaken',
      /**
       * ⚠️ `notHasBuff` 是**平衡命门**：已有印记时**不再挂**（不刷新），
       * 所以玩家每次反伤之后都拿到一个明确的 3 秒安全窗口。
       *
       * ⚠️ `cooldownMs` 也必须与印记同长：反伤会**消耗**印记，若不设它，
       * 同一次结算里挂载者又会把印记挂回来 → 等价于印记没被消耗，
       * "消耗制 + 可规避"整个失效（实测踩到）。
       */
      cooldownMs: logicMs(30),
      when: { kind: 'notHasBuff', buffId: 'lust-mark' },
      then: [{ kind: 'grant', target: { mode: 'self' }, buff: LUST_MARK }],
    },
  ],
};



/**
 * 眩晕 buff：**3 秒完全不能行动**。
 *
 * ⚠️ `flags.actionLock` 是现成的机制（施法门禁的**第一优先级**，拒绝
 * 原因就是 `locked`），所以眩晕**没有新造输入状态**。
 *
 * ⚠️ 眩晕**没有递减**（用户明确要求），所以它的冷却（14s）必须够长 ——
 * 递减是防止连续控制的手段，没有它就要靠 CD 约束。
 */
export const LUST_STUN: BuffDef = {
  id: 'lust-stun',
  nameKey: 'lust.stun.name',
  icon: 'lust_stun',
  polarity: 'debuff',
  color: 0xd060d0,
  duration: logicMs(30),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { actionLock: true },
};

/* ------------------------------------------------------------------ *
 * 技能
 * ------------------------------------------------------------------ */

/** 「轻吟」：快招，短前摇、低伤、频繁。 */
export const LUST_HUM: SkillDef = {
  id: 'lust-hum',
  kind: 'activeSkill',
  nameKey: 'lust.hum.name',
  descKey: 'lust.hum.desc',
  icon: 'lust_hum',
  abilities: [],
  castTime: logicMs(9),
  /**
   * 冷却 **40 → 20 逻辑步（4s → 2s）**（需求："轻吟 1 2 秒吧"）。
   *
   * ⚠️ `LUST_BEHAVIORS` 里的 `gapMs` 必须跟着降（必须**短于**冷却，
   * 否则轮转空转 → Boss 站着不动）。
   */
  cooldown: logicMs(20),
  cost: [],
  hits: [
    {
      at: logicMs(9),
      effects: [{ kind: 'damage', damage: { base: S(9), canCrit: false, countsAsHit: true } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  interruptible: true,
};

/** 「缠绕」：慢招，长前摇、中伤。 */
export const LUST_ENTANGLE: SkillDef = {
  id: 'lust-entangle',
  kind: 'activeSkill',
  nameKey: 'lust.entangle.name',
  descKey: 'lust.entangle.desc',
  icon: 'lust_entangle',
  abilities: [],
  castTime: logicMs(20),
  cooldown: logicMs(90),
  cost: [],
  hits: [
    {
      at: logicMs(20),
      effects: [{ kind: 'damage', damage: { base: S(20), canCrit: false, countsAsHit: true } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  interruptible: true,
};

/**
 * 「魅惑」：**眩晕**。玩家锁死 3 秒 + 打断当前施法。
 *
 * ⚠️ **「卸」无效**（只能打断或闪避）—— 这是它和另外两个伤害技的区别。
 * 实现上没有"对眩晕无效"这个字段：「卸」的判据是"这一击结算出来的
 * **伤害值**"（`damageThreshold`），而眩晕是**非伤害效果** —— 没有伤害就
 * 没有那一次比较，所以它天然卸不掉。这条必须在**技能描述**里写明
 * （见 i18n），否则玩家会以为「卸」坏了。
 */
export const LUST_CHARM: SkillDef = {
  id: 'lust-charm',
  kind: 'activeSkill',
  nameKey: 'lust.charm.name',
  descKey: 'lust.charm.desc',
  icon: 'lust_charm',
  abilities: [],
  castTime: logicMs(14),
  /**
   * 冷却 **140 → 60 逻辑步（14s → 6s）**（需求："魅惑6秒"）。
   *
   * 眩晕 3s / CD 6s ⇒ **有一半时间在挨晕**。这是用户明确要的强度
   * （眩晕没有递减，所以强度**完全由 CD 控制** —— 见 `LUST_STUN`）。
   */
  cooldown: logicMs(60),
  cost: [],
  hits: [{ at: logicMs(14), effects: [{ kind: 'stun', buff: LUST_STUN }] }],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  /**
   * ⚠️ **没有 `hintTags`** —— 它原先写的是 `['highDamage']`，**是错的**：
   * 这一招唯一的 `hit` 效果是 `stun`，**一点伤害都没有**。
   *
   * 这正是"手写 hint 会漂"的**第二个方向**（第一个是「碾压」漏标倒地）：
   * 玩家报告"色欲的魅惑好像没有眩晕标签"，查下来不但**漏了「眩晕」**，
   * 还**错标了「高伤」**。
   *
   * 现在两件事都不用写：`LUST_STUN` 带 `actionLock`，所以「眩晕」由
   * `app/skillHints.ts` 自动推出，而「高伤」本来就不该有。
   */
  interruptible: true,
};

/**
 * 「缚」的**荆棘**：引导期间，**每一次**受伤都按比例反弹。
 *
 * ==================================================================
 * 与「欲望印记」那套反伤的区别（两条并存，不是替代）
 * ==================================================================
 *
 * | | 「污堕印记」 | 「缚」（本 buff） |
 * |---|---|---|
 * | 触发 | 有印记时**再挨一下** | **每一次**受伤 |
 * | 次数 | 触发即**消耗**印记 | **不消耗**，buff 在就一直在 |
 * | 数值 | 固定 18 点 | **受到伤害的 50%** |
 * | 防抖 | 有内部 CD（30 逻辑步） | 无 —— 约束是"窗只有 2.2 秒" |
 *
 * 所以印记表达的是"你打一下，我回你一下，然后你有 3 秒安全窗口"；
 * 缚表达的是"**这两秒内你别碰我**"。两条一起存在时，色欲的**惩罚贪刀**
 * 这条主题被加强了一档 —— 第一次标定时如果太狠，先调的是印记那 18，
 * 不是这里（印记是常驻的，缚是 12 秒一次的窗口）。
 *
 * ⚠️ 时长 = 引导 2.0 秒 + 0.2 秒余量。**不能**只给 2.0 秒：这个 buff 在
 * `castStart` 那一刻挂上，而读条本身要走 2.0 秒 —— 掐得太准会让最后
 * 一两帧落在窗口外（表现是"明明还在引导，最后一下没反伤"）。
 */
export const LUST_BIND_THORNS: BuffDef = {
  id: 'lust-bind-thorns',
  nameKey: 'lust.bind.name',
  icon: 'lust_stun',
  /** 从**色欲自己**的角度看这是增益（它的窗口），所以极性是 buff。 */
  polarity: 'buff',
  color: 0xd060d0,
  duration: logicMs(22),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { reflectFraction: 0.5 },
};

/**
 * 「缚」：**引导 2 秒，期间任何伤害按 50% 反弹**。
 *
 * ==================================================================
 * 为什么它一点伤害都没有
 * ==================================================================
 *
 * 这一招的威胁**完全**来自荆棘：引导的 2 秒里，你可以继续打它（它不还手），
 * 但每一击都会弹回来一半。所以它逼的决定是
 * "**我这两秒忍不忍得住**" —— 与色欲的主题（惩罚贪刀）同源，
 * 而手段与印记那套**不同**（那是"打一下停三秒"，这是"整段停手"）。
 *
 * ⚠️ **引导窗口就是读条窗口**：命中放在 `at: castTime`（2 秒），
 * 所以那 2 秒里它不产出任何攻击 —— 引擎的"引导"不需要新机制。
 *
 * ⚠️ 荆棘挂在 `castStart`（读条一开始就生效），不是命中那一刻：
 * 挂在命中就晚了整整 2 秒，"引导期间反伤"会变成"引导结束后反伤"。
 */
export const LUST_BIND: SkillDef = {
  id: 'lust-bind',
  kind: 'activeSkill',
  nameKey: 'lust.bind.name',
  descKey: 'lust.bind.desc',
  icon: 'lust_stun',
  abilities: [
    {
      kind: 'grant',
      on: 'castStart',
      target: { mode: 'self' },
      buff: LUST_BIND_THORNS,
    },
  ],
  castTime: logicMs(20),
  cooldown: logicMs(120),
  cost: [],
  /**
   * ⚠️ **空 hits 是有意的**：这一招只有荆棘，没有伤害。
   * 引擎不需要"空命中"的特判 —— `hits: []` 就是"读完条什么都不结算"。
   * ⚠️ 但**读条本身照走**（`castStarted` / 读条条 / 可打断），那正是
   * 玩家看到的东西。
   */
  hits: [],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  interruptible: true,
};

/** 「色欲」的全部技能。 */
export const LUST_SKILLS: readonly SkillDef[] = [LUST_HUM, LUST_ENTANGLE, LUST_CHARM, LUST_BIND];

/**
 * `DUP_ID`。而且它本来也不该注册：`grant` 是**按对象内联** buff 的
 * （见 `GrantAbility.buff`），不走 id 查表。
 */
export const LUST_BUFFS: readonly BuffDef[] = [
  LUST_MARK,
  LUST_STUN,
  LUST_PASSIVE,
  LUST_BIND_THORNS,
];



/* ------------------------------------------------------------------ *
 * 行为（轮转）
 * ------------------------------------------------------------------ */

/**
 * 「色欲」的轮转。
 *
 * ⚠️ 和旧的「伪名一郎」一样，**阶段转换用"血量阈值 + 授予 buff"表达**，
 * 引擎不知道"阶段"是什么。这里简化为一套轮转（先不加二阶段）——
 * 先让它能打完，二阶段等实测手感之后再补。
 *
 * ⚠️ `gapMs` 必须**短于**技能冷却，否则轮转会空转（
 * `PRIDE_BEHAVIORS`（原 `VERROT_BEHAVIORS`）记过这个坑：Boss 会大部分时间站着不动）。
 *   - 「轻吟」CD 40 逻辑步 → gap 3.0s
 *   - 「缠绕」CD 90 → gap 8.0s
 *   - 「魅惑」CD 140 → gap 12.0s
 */
export const LUST_BEHAVIORS: readonly Behavior[] = [
  { kind: 'enrage', atMs: 120_000, dmgMult: 2 },
  /** 开场先「轻吟」：第一次就让它是一记**快招**，与傲慢的「碾压」形成对比。 */
  { kind: 'opener', skillId: 'lust-hum', delayMs: 1000 },
  {
    kind: 'rotation',
    steps: [
      /**
       * ================================================================
       * ⚠️ 顺序必须**冷却从长到短**（长 CD 在前）
       * ================================================================
       *
       * 轮转的规则是"**取第一个「冷却已好 且 距上次使用超过 gapMs」的技能**"
       * （见 `core/ai`），所以：
       *
       *   最短 CD 的技能放前面 → 它**永远可用** → 后面的技能被**饿死**。
       *
       * 实测踩到（用户看不到眩晕、只看到挨打）：日志里连着 8 条
       * 「受到 12 伤害」全是「轻吟」，**「魅惑」一次都没放出来** ——
       * 而它才是这个 Boss 的辨识点。
       *
       * CD：魅惑 60 逻辑步(6s) > 缠绕 90(9s) …
       * ⚠️ 顺序按"**优先出更稀有的招**"：魅惑(眩晕，最有辨识度)在前，
       * 缠绕次之，轻吟(填充)最后。
       *
       * ⚠️ `gapMs` **必须短于各自的冷却**，否则那一步永远不满足条件、
       * 轮转空转（记在 `PRIDE_BEHAVIORS` 的坑）：
       *   缚   CD 12s → gap 10s
       *   魅惑 CD 6s → gap 5s
       *   缠绕 CD 9s → gap 8s
       *   轻吟 CD 2s → gap 1.5s
       *
       * ⚠️ 「缚」排**最前**：它 CD 最长（12s），而且辨识度来自"那两秒你
       * 什么都打不得" —— 被填充技挤掉会让这个机制几乎看不见。
       */
      { skillId: 'lust-bind', gapMs: 10_000 },
      { skillId: 'lust-charm', gapMs: 5_000 },
      { skillId: 'lust-entangle', gapMs: 8_000 },
      { skillId: 'lust-hum', gapMs: 1_500 },
    ],
  },
];

/* ================================================================== *
 * 「色欲」的**定义**
 * ================================================================== */

/**
 * ⚠️ 血量与另外两个 Boss **暂时相同**（420）。它不是"实测出来的那个
 * 420"—— 那个数是**傲慢**的（为本文件里没有的东西标定过）。
 * 色欲自己的值等实测之后填（现在先与傲慢同量级）。
 */
export const LUST_HP = 420;

export const LUST_BOSS: BossDef = {
  id: 'lust',
  hp: LUST_HP,
  nameKey: 'lust.name',
  skills: LUST_SKILLS,
  buffs: LUST_BUFFS,
  behaviors: LUST_BEHAVIORS,
};

