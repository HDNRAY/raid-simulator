/**
 * **黛玄 —— 魔导士**（2026-10-22，用户："开始做第三个人 黛玄，魔导士，
 * 血量 100，慢节奏，注重资源分配"）。
 *
 * ==================================================================
 * 五招（用户原话 + 后续修订）
 * ==================================================================
 *
 * | 技能 | 用户口径 | 落法 |
 * |---|---|---|
 * | **弹** | "（按住不放）"、"弹 耗炁" | 按住型（`holdDrain` 炁 12/秒）+ 每 0.3 秒 8 伤 |
 * | **波** | "（耗缠，高伤）" | 缠 40、伤害 55、读条 1.4 秒 |
 * | **破** | "破"、"改成 3s cd" | 从 `kits/reserved.ts` 搬进来、CD 改 3 秒 |
 * | **盾** | "耗缠 30，2 层，cd 5s" | 缠 30、`negateHits` 2 层、CD 5 秒 |
 * | **愈** | "愈 耗炁，耗 15 炁 回 20 血，读条 1s" | 炁 15、回 20、读条 1 秒 |
 *
 * ==================================================================
 * 为什么「弹」的伤害走"每 0.3 秒一次的触发器"
 * ==================================================================
 *
 * 按住型（`holdDrain`）在引擎里只表达"**按住期间每逻辑步扣一次资源**"，
 * 它本身**不会打伤害**（「卸」按住只是给自己挂 buff）。而「弹」是"按住不
 * 停地打"，所以：按住 ⇒ 挂一条**隐藏的节奏 buff**，那条 buff 自己带
 * `onTick` 触发器（`cooldownMs: 300`）⇒ 每 0.3 秒打一发 8 点。
 *
 * ⚠️ 为什么不是"给技能一个 0.3 秒的 readTime + 自动连发"：引擎没有
 * "按住自动重放技能"这个机制，也**不该**为它加一个 —— 那会绕过资源扣除
 * 的时机（扣费在技能开始，而按住是持续的）。触发器这条路复用了现成的
 * `onTick` + `cooldownMs`，且"每 0.3 秒"就写在数据里 ✓。
 *
 * ==================================================================
 * 数值口径（对照其他角色的小招）
 * ==================================================================
 *
 * | | 读条 | 代价 | 伤害 | 伤/秒 |
 * |---|---|---|---|---|
 * | 斩 | 0.5s | 免费 | 10 | 20 |
 * | 拳 | 0.3s | 炁 15 | 6 | 20 |
 * | **弹** | **按住** | **炁 12/秒**（净 2/秒） | **8 / 0.3 秒** | **26.7** |
 *
 * 炁自然回 10/秒，所以"按住弹"的**净**代价是 2 炁/秒（同「卸」15/秒 ⇒ 净 5/秒
 * 那条口径）—— 比免费小招高 33% 的 DPS，代价是慢慢地烧炁。
 */

import { logicMs } from '../../core/loopConstants';
import type { ActiveSkillDef, BuffDef, SkillDef } from '../../core/types';
import { S } from '../scale';

/* ================================================================== *
 * 数值（改平衡只动这里）
 * ================================================================== */

/** 「弹」：每发伤害。 */
const TAN_DAMAGE = S(8);
/** 「弹」的节拍（毫秒）—— 0.3 秒 = 3 个逻辑步。 */
const TAN_INTERVAL_MS = 300;
/** 「弹」按住期间的炁消耗（每秒）。净耗 = 这个数 − 10（炁自然回复）。 */
const TAN_ENERGY_PER_SECOND = 12;

/** 「波」：缠消耗与伤害。 */
const BO_DOUQI = S(40);
const BO_DAMAGE = S(55);

/** 「盾」：缠消耗、层数。 */
const DUN_DOUQI = S(30);
const DUN_STACKS = 2;

/** 「愈」：炁消耗与回血量。 */
const YU_ENERGY = S(15);
const YU_HEAL = S(20);

/* ================================================================== *
 * buff
 * ================================================================== */

/**
 * 「弹」的**按住节奏**（隐藏）：它自己不显示，只负责每 0.3 秒打一发。
 *
 * ⚠️ 与「卸」的 buff 同一条生命周期口径：`duration: Infinity` + 按住/松手
 * 驱动（`holdDrain` 耗尽炁时引擎自动松开）。
 * ⚠️ `hidden: true`：它是**实现手段**（节拍器），玩家看到的是"我在按弹"。
 */
export const TAN_RHYTHM: BuffDef = {
  id: 'daixuan-tan-rhythm',
  nameKey: 'skill.dan.name',
  icon: 'char_attack',
  polarity: 'buff',
  hidden: true,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  triggers: [
    {
      on: 'onTick',
      /** 每 0.3 秒一发（时间网格 0.1 秒 ⇒ 3 步）。 */
      cooldownMs: TAN_INTERVAL_MS,
      then: [
        {
          kind: 'deal',
          target: { mode: 'primaryEnemy' },
          hit: {
            at: 0,
            effects: [
              {
                kind: 'damage',
                damage: { base: TAN_DAMAGE, canCrit: false, countsAsHit: true },
              },
            ],
          },
        },
      ],
    },
  ],
};

/**
 * 「盾」：**消耗式护盾**（`negateHits`）—— 每层吃掉一次完整的来袭结算，
 * **含控制技**（用户原话："可以无视 1 次技能效果，包括控制技，可叠加"）。
 *
 * ⚠️ 层数走 `maxStacks`（2 层），而 `flags.negateHits: 1` 表示"**每层**挡一次"
 * —— 聚合时按 `negateHits × stacks` 求和（见 `BuffFlags.negateHits`）。
 */
export const DUN_SHIELD: BuffDef = {
  id: 'daixuan-shield',
  nameKey: 'skill.dun.name',
  icon: 'char_guard',
  polarity: 'buff',
  duration: logicMs(80),
  maxStacks: DUN_STACKS,
  stacking: { mode: 'stack', max: DUN_STACKS },
  flags: { negateHits: 1 },
};

/* ================================================================== *
 * 技能
 * ================================================================== */

/**
 * **弹**：按住不放，每 0.3 秒打一发（8 伤）。
 *
 * ⚠️ **没有读条**（用户："弹 耗炁，为什么有读条？"）—— 按住型没有读条，
 * 0.3 秒是**伤害的节拍**，不是前摇。
 * ⚠️ `holdDrain.perLogicTick` 的单位是"每逻辑步"（0.1 秒）：
 * 12 炁/秒 ⇒ 每步 1.2 点。写成 12 就是 120 炁/秒（「卸」那边记着这个坑）。
 */
export const DAN: ActiveSkillDef = {
  id: 'dan',
  kind: 'activeSkill',
  nameKey: 'skill.dan.name',
  descKey: 'skill.dan.desc',
  icon: 'char_attack',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: TAN_RHYTHM }],
  castTime: 0,
  cooldown: 0,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  /** ⚠️ 没有 hit —— 伤害由节奏 buff 的 `onTick` 打（见文件头）。 */
  hits: [],
  holdDrain: {
    resource: 'energy',
    perLogicTick: TAN_ENERGY_PER_SECOND / 10,
  },
  tags: [],
  interruptible: false,
};

/** **波**：耗缠、高伤、慢读条（1.4 秒）。 */
export const BO: ActiveSkillDef = {
  id: 'bo',
  kind: 'activeSkill',
  nameKey: 'skill.bo.name',
  descKey: 'skill.bo.desc',
  icon: 'char_attack',
  abilities: [],
  castTime: logicMs(14),
  cooldown: 0,
  cost: [{ resource: 'douqi', value: BO_DOUQI }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: logicMs(14),
      effects: [
        {
          kind: 'damage',
          damage: { base: BO_DAMAGE, canCrit: false, countsAsHit: true },
        },
      ],
    },
  ],
  tags: [],
  interruptible: false,
};

/**
 * **盾**：耗缠加盾（2 层、CD 5 秒）。
 *
 * ⚠️ 与「卸」的区别写在 `BuffFlags.negateHits` 上：卸是"每次挨打按点数判"，
 * 盾是"**消耗层数**的整段免疫"，而且**必中的招也吃** —— 那正是"包括控制技"。
 */
export const DUN: ActiveSkillDef = {
  id: 'dun',
  kind: 'activeSkill',
  nameKey: 'skill.dun.name',
  descKey: 'skill.dun.desc',
  icon: 'char_guard',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: DUN_SHIELD }],
  castTime: 0,
  cooldown: logicMs(50),
  cost: [{ resource: 'douqi', value: DUN_DOUQI }],
  targeting: { mode: 'self' },
  hits: [],
  tags: [],
  interruptible: false,
};

/** **愈**：耗炁 15、回 20 血、读条 1 秒。 */
export const YU: ActiveSkillDef = {
  id: 'yu',
  kind: 'activeSkill',
  nameKey: 'skill.yu.name',
  descKey: 'skill.yu.desc',
  icon: 'char_focus',
  abilities: [],
  castTime: logicMs(10),
  cooldown: 0,
  cost: [{ resource: 'energy', value: YU_ENERGY }],
  targeting: { mode: 'self' },
  hits: [
    {
      at: logicMs(10),
      effects: [
        {
          kind: 'heal',
          damage: { base: YU_HEAL, canCrit: false, countsAsHit: false },
        },
      ],
    },
  ],
  tags: [],
  interruptible: false,
};

/**
 * **破**：稳定打断（10 炁、**CD 3 秒**、不派生）。
 *
 * ⚠️ 2026-10-22 从 `kits/reserved.ts` **搬进来**（它原来在"待接线"桶里，
 * 归属就是黛玄）；CD 按用户要求从 5 秒改成 **3 秒**。
 */
export const BREAK: ActiveSkillDef = {
  id: 'break',
  kind: 'activeSkill',
  nameKey: 'skill.break.name',
  descKey: 'skill.break.desc',
  icon: 'char_break',
  abilities: [],
  castTime: 0,
  cooldown: logicMs(30),
  cost: [{ resource: 'energy', value: S(10) }],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        { kind: 'interrupt', target: { mode: 'primaryEnemy' }, force: true },
      ],
    },
  ],
  tags: [],
  interruptible: false,
};

/**
 * **派生窗口**：按住「弹」满 4 秒后出现的那扇门（2026-10-22）。
 *
 * ⚠️ 它由**炁机「弹中生波」**的触发器授予（不是技能自己给的）—— 所以
 * 没有那条炁机时，`CHONG` 的 `requires` 永远不满足 ⇒ 不出现在技能栏 ✓
 * （与「击」同一条：`requires` 不满足的派生技不占栏位）。
 */
export const CHONG_WINDOW: BuffDef = {
  id: 'daixuan-chong-window',
  nameKey: 'skill.chong.name',
  icon: 'char_magic2',
  polarity: 'buff',
  hidden: true,
  /** 3 秒内可用 —— 够按一下，不够攒两发。 */
  duration: logicMs(30),
  /**
   * **最多 2 层**（2026-10-22 用户："加一个炁机 使用5次冲解锁，**冲按2次才消失**"）。
   *
   * - 没有那条炁机时：窗口只挂 **1 层** ⇒ 一次就用完（旧行为）✓
   * - 有「冲波再起」时：窗口一次挂 **2 层** ⇒ 连按两次 ✓
   * ⚠️ 用 `stack` 而不是 `refresh`：`refresh` 只刷新时长、**不加层数** ✗。
   */
  maxStacks: 2,
  stacking: { mode: 'stack', max: 2 },
  /**
   * ⚠️ **不挂 `flags.comboWindow`**：那个旗标是"渲染层把派生技画在源技能上方"
   * 的提示，而它会被内容校验器当作"引用了一个技能"来检查（`MISSING_SKILL`）。
   * 黛玄的这套是**按 buff 门禁**（`CHONG.requires`），不经过 combo-window
   * 通路 ⇒ 不需要那个旗标，也就不需要在**每个角色**的注册表里都有 `chong`
   * （实测：没有它时 runLoop 的 scoped 注册表会报错）。
   */
};

/**
 * **冲**：按住「弹」满 4 秒后的**派生技** —— 瞬发、无消耗、**20 伤**。
 *
 * 用户 2026-10-22："弹 按住超过4或者5秒，派生一个 瞬发 无消耗 伤害只有20 的波…
 * 就叫 冲"。
 *
 * ⚠️ 名字是「冲」不是「波」：**波** 是攒满的那一发（40 缠 / 55 伤 / 1.4 秒），
 * **冲** 是"弹打久了顺出来的小光束"（0 缠 / 20 伤 / 0 读条）。
 * ⚠️ 用完就收（`removeBuff` 吃掉窗口）—— 一次窗口只换一发。
 */
export const CHONG: ActiveSkillDef = {
  id: 'chong',
  kind: 'activeSkill',
  nameKey: 'skill.chong.name',
  descKey: 'skill.chong.desc',
  icon: 'char_magic2',
  abilities: [
    /**
     * ⚠️ **只减 1 层**（`stacks: 1`），不是整条摘掉：窗口可能有 2 层
     * （「冲波再起」给的）⇒ 用完一次还剩一次 ✓。层数减到 0 时引擎自己摘掉。
     */
    { kind: 'removeBuff', target: { mode: 'self' }, buffId: CHONG_WINDOW.id, stacks: 1 },
  ],
  castTime: 0,
  cooldown: 0,
  cost: [],
  targeting: { mode: 'primaryEnemy' },
  hits: [
    {
      at: 0,
      effects: [
        { kind: 'damage', damage: { base: S(20), canCrit: false, countsAsHit: true } },
      ],
    },
  ],
  /** ⚠️ 只有当窗口开着时才有这个技能（`requires` 不满足 ⇒ 不进技能栏）。 */
  requires: [{ kind: 'hasBuff', who: 'self', buffId: CHONG_WINDOW.id }],
  tags: [],
  interruptible: false,
};

/** 黛玄的那一套（顺序 = 技能栏顺序 = 默认键位顺序）。 */
export const DAIXUAN_SKILLS: readonly SkillDef[] = [DAN, BO, BREAK, DUN, YU, CHONG];

/** 她带的两条常驻 buff（`negateHits` 那条由技能授予，不在这里）。 */
export const DAIXUAN_BUFFS: readonly BuffDef[] = [TAN_RHYTHM, DUN_SHIELD, CHONG_WINDOW];
