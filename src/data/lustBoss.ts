/**
 * **「色欲」** —— 第二个 Boss（诡术型）。
 *
 * ==================================================================
 * 它和「伪名一郎」的区别是**机制**，不是数值
 * ==================================================================
 *
 * 设计定位（`docs/specs/2026-10-10-lust-boss.md` §0.2）：
 *
 *   伪名一郎 → "这一下该**打断、闪避、还是格挡**？"（前摇是唯一线索）
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
 * 触发器的 `when` 是 `notHasBuff(自己)` —— 也就是**已有印记时不再挂**，
 * 而不是"刷新持续时间"。
 *
 * 如果改成每次受伤都刷新，那么玩家只要持续攻击，印记就**永不消失** →
 * 每一下都被反伤、规避窗口变成 0。那样反伤就从"博弈"退化成"每次攻击
 * 固定扣 18 血"，玩家唯一的选择是不打 —— 而"不打"在有时限的战斗里
 * 等于输。
 *
 * 现在的规则让每次反伤之后，玩家都拿到一个**明确的 3 秒安全窗口**。
 */

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
      effects: [{ kind: 'damage', damage: { base: S(12), canCrit: false, countsAsHit: true } }],
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
      effects: [{ kind: 'damage', damage: { base: S(30), canCrit: false, countsAsHit: true } }],
    },
  ],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  hintTags: ['highDamage'],
  interruptible: true,
};

/**
 * 「魅惑」：**眩晕**。玩家锁死 3 秒 + 打断当前施法。
 *
 * ⚠️ **格挡无效**（只能打断或闪避）—— 这是它和另外两个伤害技的区别。
 * 实现上没有"格挡无效"这个字段：眩晕是**非伤害效果**，而格挡
 * （`damageReduce`）只在伤害结算里生效，所以它天然挡不住眩晕。
 * 这条必须在**技能描述**里写明（见 i18n），否则玩家会以为格挡坏了。
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
  hintTags: ['highDamage'],
  interruptible: true,
};

/** 「色欲」的全部技能。 */
export const LUST_SKILLS: readonly SkillDef[] = [LUST_HUM, LUST_ENTANGLE, LUST_CHARM];

/**
 * `DUP_ID`。而且它本来也不该注册：`grant` 是**按对象内联** buff 的
 * （见 `GrantAbility.buff`），不走 id 查表。
 */
export const LUST_BUFFS: readonly BuffDef[] = [LUST_MARK, LUST_STUN, LUST_PASSIVE];

/* ------------------------------------------------------------------ *
 * 行为（轮转）
 * ------------------------------------------------------------------ */

/**
 * 「色欲」的轮转。
 *
 * ⚠️ 和「伪名一郎」一样，**阶段转换用"血量阈值 + 授予 buff"表达**，
 * 引擎不知道"阶段"是什么。这里简化为一套轮转（先不加二阶段）——
 * 先让它能打完，二阶段等实测手感之后再补。
 *
 * ⚠️ `gapMs` 必须**短于**技能冷却，否则轮转会空转（
 * `VERROT_BEHAVIORS` 记过这个坑：Boss 会大部分时间站着不动）。
 *   - 「轻吟」CD 40 逻辑步 → gap 3.0s
 *   - 「缠绕」CD 90 → gap 8.0s
 *   - 「魅惑」CD 140 → gap 12.0s
 */
export const LUST_BEHAVIORS: readonly Behavior[] = [
  { kind: 'timeLimit', ms: 180_000 },
  { kind: 'enrage', atMs: 120_000, dmgMult: 2 },
  /** 开场先「轻吟」：第一次就让它是一记**快招**，与伪名的重斩形成对比。 */
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
       * 轮转空转（记在 `VERROT_BEHAVIORS` 的坑）：
       *   魅惑 CD 6s → gap 5s
       *   缠绕 CD 9s → gap 8s
       *   轻吟 CD 2s → gap 1.5s
       */
      { skillId: 'lust-charm', gapMs: 5_000 },
      { skillId: 'lust-entangle', gapMs: 8_000 },
      { skillId: 'lust-hum', gapMs: 1_500 },
    ],
  },
];
