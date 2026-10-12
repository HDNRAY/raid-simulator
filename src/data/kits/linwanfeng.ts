/**
 * **林晚风**（id `'player'`）的技能表 —— 剑士，5 招。
 *
 * ==================================================================
 * 定稿（docs/specs/2026-10-12-player-kits.md）
 * ==================================================================
 *
 * | 技能 | id | 代价 | 读条 | CD | 效果 |
 * |---|---|---|---|---|---|
 * | 斩 | `attack` | 炁 15 | 500ms | — | 伤害 10 |
 * | 劈 | `pi` | 缠 50 | 1200ms | — | 伤害 45 |
 * | 凝 | `focus` | 缠 50 | 0 | — | 增伤 +20% |
 * | 卸 | `guard` | 免费·按住 15 炁/秒（净 −5） | 0 | — | **阈值抵消**（见 `GUARD_THRESHOLD`） |
 * | 避 | `dodge` | 炁 15 | 0 | 1s | 无敌 0.5s |
 *
 * ⚠️ **她没有「截」、「闪」**（「截」「闪」都归凯丽）—— 这是用户逐条定过的，
 * 不是漏了。「击」仍然在内容里（P3 由炁机接回），见 `../playerSkills.ts`。
 *
 * ==================================================================
 * 与凯丽的分工（一句话）
 * ==================================================================
 *
 * 林晚风**攻守均衡、节奏偏慢**：重击读条最长、防御是"按住换阈值"
 * （要预判、要付炁）；凯丽快、防御是"免费短无敌"（要按得准）。
 */

import { LOGIC_TICKS_PER_SECOND, logicMs } from '../../core/loopConstants';
import type { BuffDef, SkillDef } from '../../core/types';
import { GUARD_HOLD_DRAIN_PER_SECOND, GUARD_THRESHOLD } from '../balance';
import { C, S } from '../scale';
import { FOCUS } from './shared';

/* ================================================================== *
 * buff
 * ================================================================== */

/** 避：0.5 秒完全无敌。 */
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
 * **卸**：阈值抵消（`≤N` 整击作废 / `>N` 平减 N）。
 *
 * ==================================================================
 * 它是"按住型"，所以**刻意不给持续时间**
 * ==================================================================
 *
 * `Number.POSITIVE_INFINITY` 与旧的「防」同一条理由：生命周期完全由
 * "按住 / 松开"驱动 —— 按下时挂上，松开时由 `endHold` 移除。给一个有限
 * duration 会造出错误语义（玩家一直按着，buff 却自己掉了 → "卸力莫名失效"）。
 *
 * 唯一的结束条件是**炁耗尽**（引擎在 `tickHolds` 里检查并自动松开）。
 *
 * ==================================================================
 * 阈值 N 是 `GUARD_THRESHOLD`，不是这里的字面量
 * ==================================================================
 *
 * 用户的调参口径是"如果太强，阈值可以改成 10" —— 所以那个数住
 * `data/balance.ts`，内容 import 它。**不要**把 15 写死回这里：
 * 那样"改阈值"要改两个地方，而且改漏时不会报错。
 *
 * 两半的复用关系（`≤N` 走 `invulnerable` 同一条 `avoided` 通路、
 * `>N` 接 `damageReduce` 旁边做平减）写在 `BuffFlags.damageThreshold`
 * 的注释里 —— 那是引擎侧的判据，这里只负责给出 N。
 */
export const GUARD_THRESHOLD_BUFF: BuffDef = {
  id: 'guard',
  nameKey: 'skill.guard.name',
  icon: 'char_guard',
  polarity: 'buff',
  color: C.guard,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { damageThreshold: GUARD_THRESHOLD },
};

/* ================================================================== *
 * 技能
 * ================================================================== */

/**
 * 斩：普攻。代价低、伤害低，是循环的填充。
 *
 * ⚠️ 数值与机制**一个字都没动**（定稿："斩 不动"）—— 从
 * `data/content.ts` 原样搬过来，只换了文件位置。
 */
export const ATTACK: SkillDef = {
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
  /** 读条 0.5 秒，所以会被打断 —— 这正是"劈要挑空档放"的博弈来源 */
  interruptible: true,
};

/**
 * 劈 🆕：林晚风的重击。**消耗对齐「轰」（50 缠），读条更长、伤害更高。**
 *
 * 需求原话："（新，但是和现在的轰保持一样的消耗，读条多一点，伤害高一点）"
 *
 * | | 轰（凯丽） | 劈（林晚风） |
 * |---|---|---|
 * | 代价 | 缠 50 | 缠 50（**一样**） |
 * | 读条 | 900ms | **1200ms**（多一点） |
 * | 伤害 | 30 | **45**（高一点） |
 * | 附带 | 易伤 | 无 |
 *
 * ⚠️ 与「轰」的差异**必须在读条上付账**：50 缠换 45 伤是这一招的全部
 * 收益，代价是 1.2 秒——本作最长的读条，所以它几乎只能在 Boss 刚出完招
 * 的空档里放。没有这个读条，它就是"更强的轰"（而且不带易伤反而更差）。
 */
export const PI: SkillDef = {
  id: 'pi',
  kind: 'activeSkill',
  nameKey: 'skill.pi.name',
  descKey: 'skill.pi.desc',
  icon: 'char_blast',
  abilities: [],
  castTime: logicMs(12),
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
            base: S(45),
            canCrit: false,
            countsAsHit: true,
          },
        },
      ],
    },
  ],
  tags: ['melee'],
  /** 读条 1.2 秒 —— 全表最长，所以它也是最容易被抢断的一招 */
  interruptible: true,
};

/**
 * 卸 🆕：按住持续"阈值抵消"，松开取消。
 *
 * ==================================================================
 * ⚠️ 显示名是「卸」，但 id 与常量名仍是 `guard` / `GUARD_*`
 * ==================================================================
 *
 * 用户 2026-10-12 晚定的显示名是**「卸」**（原「格」）：
 * "格"更像**盾牌**的动作，而她是剑士；「招 / 架」又都是**一次性**动作，
 * 与"按住不放"矛盾 —— 只有「卸」同时说得通那两半规则
 * （`≤N` "卸掉了" / `>N` "卸掉 N 点"），也说得通"按住卸"。
 *
 * ⚠️ **id 与常量名刻意不改**，因为 `skillId` 是**持久化键**：
 * 键位表（`app/settingsStore.ts` 的 localStorage）按 skillId 存，
 * 改名会让老玩家给这一招改过的键**静默丢失**（回落到默认 `G`）。
 * 而且技能 id 也是 `RunRecord` 里 `battleStats` 的键（那是另一套版本号）。
 *
 * 本仓库已有同样的先例：`douqi` / `energy` 的中文名在 2026-10-09 对调过，
 * 标识符出于历史原因保留（见 `data/balance.ts` 文件头）。
 * 所以规矩是：**改中文名只动 i18n**；`guard` 这个名字不准确是**已知的**，
 * 写在这里，而不是让下一个人重新怀疑一遍。完整判断见
 * `docs/specs/2026-10-12-player-kits.md` §3.0。
 *
 * `holdDrain` 是引擎里"按住"机制的表达：每个逻辑步扣一次资源，
 * 资源耗尽或松手就自动取消。这样"一直按着"会有明确代价。
 *
 * ⚠️ 代价取自 `GUARD_HOLD_DRAIN_PER_SECOND`（**15 炁/秒**，旧值 3 免费）；
 * 它和阈值一样是**具名常量**，所以**不要**把 15 写死回这里。
 *
 * ⚠️ 15 不是随手定的：炁自然回 **10 炁/秒**，所以"按住「卸」"的**净**
 * 消耗 = 15 − 10 = **5 炁/秒**（> 0 才有代价）。**调强要调低**（但不能
 * ≤ 10，否则按住又变免费还回炁），**调弱要调高**。完整口径与那条作废的
 * "太强 → 5 炁/秒"见 `data/balance.ts` 该常量的注释。
 *
 * ⚠️ 单位换算是**除法**：`holdDrain.perLogicTick` 是"每逻辑步"，
 * 而杠杆是"每秒"。`15 炁/秒` ⇒ `perLogicTick: 1.5`；写成 `15` 就是 150 炁/秒。
 * 显示侧由 `core/combat/holds.ts` 的 `holdDrainPerSecond()` 乘回来。
 */
export const GUARD: SkillDef = {
  id: 'guard',
  kind: 'activeSkill',
  nameKey: 'skill.guard.name',
  descKey: 'skill.guard.desc',
  icon: 'char_guard',
  abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: GUARD_THRESHOLD_BUFF }],
  castTime: 0,
  cooldown: 0,
  cost: [],
  /**
   * 按住期间每 0.1 秒扣 `perLogicTick` 点炁。
   *
   * ⚠️ 1.5 这种小数**不能**直接进 `changeResource`（`Math.round` 会把
   * 每步的 0.5 舍掉 → 实际变成 10 炁/秒）；`holds.ts` 用整数欠账累加器
   * 结算，所以"按住 1 秒 = 15 炁"。
   */
  holdDrain: {
    resource: 'energy',
    perLogicTick: GUARD_HOLD_DRAIN_PER_SECOND / LOGIC_TICKS_PER_SECOND,
  },
  targeting: { mode: 'self' },
  /**
   * ⚠️ **没有 hit** —— 它不是一个"打出去"的技能，只是给自己挂 buff。
   * 但它照样要有这个字段（`SkillDef` 的形状），空数组是它的真实语义。
   */
  hits: [],
  /**
   * ⚠️ **不带 `dodge` tag**：「卸」不是位移，倒地时按它不合理
   * （你正躺着）。倒地期间的出路是「避」—— 它带 `dodge`。
   * 凯丽那边同理，她的出路是「闪」。
   */
  tags: ['defensive'],
  interruptible: false,
};

/** 避：0.5 秒完全无敌。代价是 15 炁。 */
export const DODGE: SkillDef = {
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
   * 降成 15 = 少打 1 次斩，于是"该躲时躲得起"这件事才真正成立。
   */
  cost: [{ resource: 'energy', value: S(15) }],
  targeting: { mode: 'self' },
  hits: [],
  /**
   * ⚠️ **`dodge` 是"被控时的出路"**：Boss 的「碾压」会造成倒地，倒地
   * 期间（`BuffFlags.restrictToTags`）只有带 `dodge` 的技能可按 ——
   * 也就是"被打倒了还能翻滚躲开下一击"。
   */
  tags: ['defensive', 'dodge'],
  interruptible: false,
};

/** 林晚风的 5 招。顺序 = 技能栏/设置页的展示顺序。 */
export const LIN_WANFENG_SKILLS: readonly SkillDef[] = [
  ATTACK,
  PI,
  FOCUS,
  GUARD,
  DODGE,
];

/* ================================================================== *
 * 资源上限
 * ================================================================== */

/**
 * 生命上限 **150**（角色文档 §1："林晚风 剑士 150 适中 攻守均衡"）。
 *
 * ⚠️ 它**不是** `data/content.ts` 的 `HP_MAX`（那是全默认值 / 兜底）。
 * 每个角色自己的血上限住在各自的 kit 里，由 `data/units.ts` 的
 * `makePlayer(id)` 装配到 `combatant.caps.hp`。见
 * `docs/specs/2026-10-12-player-kits.md` 的 W6 一节。
 */
export const LIN_WANFENG_HP = 150;
