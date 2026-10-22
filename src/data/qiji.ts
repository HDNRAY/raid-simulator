/**
 * **炁机内容表** —— 一局肉鸽里能解锁 / 选择的强化方向。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5（炁机系统）。
 * 形状（`QijiEntity` / `QijiUnlock`）住在 `core/types/qiji.ts` ——
 * **本文件是数据，不是机制**：加一个炁机 = 在这里加一条，`core/` 一行不改。
 *
 * ==================================================================
 * 用户 2026-10-13 定下的规则（逐条落在这里，不要"顺手"改口径）
 * ==================================================================
 *
 * 1. **计数 = 本局累计**（`scope: 'run'`）—— 不是跨局、不是单场。
 * 2. **解锁是本局的东西**，而且**选择了才本局生效**（`RunState.unlocked`
 *    vs `RunState.chosen` 是两份状态，见 `core/run/types.ts`）。
 *    ⚠️ **不做跨局成就** —— 用户明说"那是另一件事，以后再说"。
 * 3. **两个开局就解锁的兜底炁机**：+血上限、+炁回复速度
 *    （`unlock: { kind: 'always' }`，§5.4 的"通用炁机"）。
 *    ⚠️ 但**第一场战斗打完才有炁机选择**（`runSession` 判，不是这里）。
 * 4. **三条"用了 3 次"解锁的炁机**：
 *    「截」3 次 / 「卸」3 次 / 「闪」3 次 → 各自解锁**它自己的派生「击」**。
 *    ⚠️ 用户特别叮嘱："**这个整体是一个炁机，不是 击 是炁机**" ——
 *    所以下面三条的 `comboWindow` 才是它们的本体：**关系**（源 → 击）
 *    是炁机，`击` 只是那条关系的出口。
 * 5. ⚠️ **三条改"某个技能本身"的炁机**（2026-10-13 新增）：
 *    「避」3 次 → **用出避之后挂一层蓄势（下一次攻击伤害翻倍，用掉就消耗）**；
 *    「凝」3 次 → **两条一起**解锁（凝减耗 −20 / 凝增伤变成 100%）。它们的落点是 `skillTweak`
 *    （见 `core/types/qiji.ts` 的 `QijiSkillTweak`），
 *    **不是**继承来的 `abilities` —— 那个只能改玩家属性。
 *
 * ==================================================================
 * ⚠️ 名字：文案进 i18n，这里的 `nameKey` 只是键
 * ==================================================================
 *
 * 键位名**不进** i18n（AGENTS.md §3b），但**炁机的名字是文案**，所以
 * 每一条都只有 `nameKey` / `descKey`，正文写在 `i18n/locales/zh-CN.ts` 的
 * `qiji.*` 域。改名字 = 改语言包一行（用户要挑名字，成本就是这一行）。
 *
 * ==================================================================
 * ⚠️ 这些内容**不进 `ContentBundle.entities`**
 * ==================================================================
 *
 * 我们**没有**把它们注册进内容注册表（那是 W8 的另一半，P6）：注册表是
 * "引擎按 id 解析**战斗内**定义"的地方，而炁机的效果走三条**明路**：
 *
 *   `abilities[].modifier` → `app/kit.ts` 的 `buildPlayerKit` → `passiveModifiers`
 *   `comboWindow`          → `app/kit.ts` 的 `buildPlayerKit` → `comboWindows`
 *   `skillTweak`           → `app/kit.ts` 的 `applySkillTweaks` → 覆盖技能表
 *
 * 所以今天"一个炁机引用了不存在的 buff / 技能"没有校验器会拦 —— 记在
 * `docs/specs/2026-10-12-roguelike.md` 的 P6 里，**不要**以为它是安全的。
 * ⚠️ 但 `skillTweak` 那一半**自己会抛错**（`applySkillTweaks`：技能 /
 * 代价项 / buff 修正找不到就崩），见那里的说明。
 */

import type { QijiEntity } from '../core/types/qiji';
import { COMBO_WINDOW, comboWindowFor } from './kits/combo';
import { DODGE_CHARGE } from './kits/dodgeCharge';
import { FOCUS_BUFF } from './kits/shared';
import { HEISHAN_WATCHER, PUNCH_SKILL_ID } from './kits/heishan';

/* ================================================================== *
 * 1. 三条「派生 击」：炁机 = **关系**（源技能 → 击）
 * ================================================================== */

/**
 * 「截」→「击」。
 *
 * 成功定义：**真的打断了一个读条**（`interruptSuccess.sourceSkillId === 'jie'`）。
 * 打空 / 被霸体挡下都**不开窗** —— 这正是用户要的"有代价的选择"
 * （「截」打空要等 10 秒冷却，见 `kits/combo.ts` 的 `JIE`）。
 */
export const QIJI_JIE_STRIKE: QijiEntity = {
  id: 'jieShengJi',
  kind: 'qiji',
  nameKey: 'qiji.jieShengJi.name',
  descKey: 'qiji.jieShengJi.desc',
  icon: 'char_break',
  category: 'offense',
  rarity: 'uncommon',
  /**
   * ⚠️ `scope: 'run'` = **本局累计**（用户第 1 条规则）。
   * 用 `skillUses`（**用了 3 次**）而不是 `skillInterrupts`（**打断成功 3 次**）：
   * 用户的原话是"用了 3 次"，而且"用"是最直白、最容易复现的口径
   * （打断成功还要 Boss 恰好有可打断读条，条件更苛刻）。
   */
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'jie', scope: 'run' },
    value: 3,
  },
  abilities: [],
  comboWindow: {
    sourceSkillId: 'jie',
    derivedSkillId: 'strike',
    /**
     * ⚠️ 用 `comboWindowFor('jie')` 而不是直接给 `COMBO_WINDOW`：
     * 前者会把 `flags.comboWindowSource` 设成 `'jie'`（渲染层靠它把「击」
     * 画在「截」上方）。直接给基础定义的话，窗口会自称"从截来的"——
     * 那对「卸」「闪」两条就是**错的**，而错的表现只是"派生技画错位置"。
     */
    buff: comboWindowFor('jie'),
  },
};

/**
 * 「卸」→「击」。
 *
 * 成功定义（**2026-10-13 放宽过一次**）：**阈值吸收了 > 0 的伤害** ——
 * 完全卸掉（`≤N`，走 `avoided.viaBuffId === 'guard'`）✓
 * 只减伤（`>N` 的平减，走 `damage.thinned > 0` + `damage.viaBuffId === 'guard'`）✓
 * 用户原话："**卸不需要完全卸掉，吸收了一部分也能派生「击」**"。
 * 「卸」是按住型、从不发 `interruptSuccess`，所以它走**第二条通道**
 * （`viaBuffId`）。没按卸 / 一点都没吸收 → 不开窗。
 */
export const QIJI_GUARD_STRIKE: QijiEntity = {
  id: 'xieShengJi',
  kind: 'qiji',
  nameKey: 'qiji.xieShengJi.name',
  descKey: 'qiji.xieShengJi.desc',
  icon: 'char_guard',
  category: 'defense',
  rarity: 'uncommon',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'guard', scope: 'run' },
    value: 3,
  },
  abilities: [],
  comboWindow: {
    sourceSkillId: 'guard',
    derivedSkillId: 'strike',
    buff: comboWindowFor('guard'),
    /** 「卸」的阈值 buff：它**吸收 ≥1 点**（完全卸掉或部分减伤）就算"用成功了"。 */
    viaBuffId: 'guard',
  },
};

/**
 * 「闪」→「击」。
 *
 * 成功定义：**无敌窗口真的吃掉了一击**（`avoided.viaBuffId === 'flash-iframe'`）。
 *
 * ⚠️ 与「避」的区别（这一条是 `viaBuffId` 存在的全部理由）：「闪」与「避」
 * 都靠 `flags.invulnerable`，**只看 flag 分不出来**。而「避」是林晚风的、
 * 「闪」是凯丽的 —— 不区分的话，"按了避"会给"闪派生击"开窗。
 */
export const QIJI_FLASH_STRIKE: QijiEntity = {
  id: 'shanShengJi',
  kind: 'qiji',
  nameKey: 'qiji.shanShengJi.name',
  descKey: 'qiji.shanShengJi.desc',
  icon: 'char_dodge',
  category: 'tempo',
  rarity: 'uncommon',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'flash', scope: 'run' },
    value: 3,
  },
  abilities: [],
  comboWindow: {
    sourceSkillId: 'flash',
    derivedSkillId: 'strike',
    buff: comboWindowFor('flash'),
    viaBuffId: 'flash-iframe',
  },
};

/* ================================================================== *
 * 2. 三条**改某个技能本身**的炁机（2026-10-13 加）
 * ================================================================== */

/**
 * 「避」用出后**获得一层蓄势**：下一次攻击伤害翻倍，用掉就消耗
 * （用户 2026-10-13 改的效果：**原来的"回 20 缠"整条删掉**）。
 *
 * ==================================================================
 * ⚠️ 效果为什么是"挂 buff"而不是"回缠"（读法的第二次变化）
 * ==================================================================
 *
 * 第一版是"避回 20 缠"（`onUse: { kind: 'resource', delta: 20 }`），
 * 读法依据是「避」的代价只有 15 炁、一点缠都不花（见
 * `data/kits/linwanfeng.ts` 的 `DODGE.cost`）。用户现在的原话是
 * **"避实击虚 的效果改为，buff 下一次攻击伤害翻倍"** —— 整条换掉，
 * 于是 `resource` 那一支不再需要，连那个 delta 一起删（**不留死值**：
 * 留着它就成了"看起来还在回缠"的第二份真相）。
 *
 * ==================================================================
 * 它是怎么表达出来的
 * ==================================================================
 *
 *   ① 挂 buff：`onUse` 写一条 **`grant`**（引擎已有、`castPipeline` 在
 *      `castFinish` 真的会执行的那两种能力之一，另一种是 `resource`）。
 *   ② 翻倍：buff 带一条 `damageBoost +100`（累加器；100 = +100%）。
 *   ③ 消耗：**由 buff 自己声明** —— `DODGE_CHARGE.consume.on = ['onAttack']`
 *      （引擎级的消费机制，判定在 `core/buffs/consume.ts`）。攻击技能里
 *      **不再有任何 `removeBuff`**。
 *
 * ⚠️ ③ 在 2026-10-13 之前是"攻击技能的命中里手写一条 `removeBuff`"
 * （契约式耦合：漏写一条就静默不消耗）。迁移的来龙去脉见
 * `data/kits/dodgeCharge.ts` 的文件头。
 *
 * ⚠️ **不是** `Ability: 'consume'`：那个能力是"从**资源池**扣资源"，与
 * buff 无关，而且**它还没有执行点**（`content/capabilityAudit.ts` 的
 * `UNIMPLEMENTED_ABILITY_KINDS` 会拦下内容里的它）。参见 `onUse` 的类型
 * 说明（`core/types/qiji.ts`）。
 *
 * ⚠️ **解锁条件不变**：仍然是"本局「避」用出 3 次"（下面那条
 * `statAtLeast`）—— 改的只是效果，不是门槛。
 */
export const QIJI_DODGE_CHARGE: QijiEntity = {
  id: 'biShiJiXu',
  kind: 'qiji',
  nameKey: 'qiji.biShiJiXu.name',
  descKey: 'qiji.biShiJiXu.desc',
  icon: 'char_dodge',
  category: 'utility',
  rarity: 'uncommon',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'dodge', scope: 'run' },
    value: 3,
  },
  abilities: [],
  skillTweak: {
    skillId: 'dodge',
    onUse: { kind: 'grant', target: { mode: 'self' }, buff: DODGE_CHARGE },
  },
};

/**
 * 「凝」的缠消耗 **−20**（50 → 40 → **20**；40 是 2026-10-13 的重标定）。
 *
 * ⚠️ 与下一条**同一个解锁条件**，两条会**一起**出现在候选里
 * （用户："3 次凝解锁 2 个契机"）—— 所以 `unlock` 逐字相同是**有意的**，
 * 不是抄漏了一处。
 */
export const QIJI_FOCUS_COST: QijiEntity = {
  id: 'ningShenJuQi',
  kind: 'qiji',
  nameKey: 'qiji.ningShenJuQi.name',
  descKey: 'qiji.ningShenJuQi.desc',
  icon: 'char_focus',
  category: 'tempo',
  rarity: 'uncommon',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'focus', scope: 'run' },
    value: 3,
  },
  abilities: [],
  skillTweak: {
    skillId: 'focus',
    costDeltas: [{ resource: 'douqi', delta: -20 }],
  },
};

/**
 * 「凝」的增伤**变成 100%**（⚠️ **覆盖**，不是 +100%）。
 *
 * ==================================================================
 * 用户原话是"变成 100%"，所以是 `setOverride` 的语义 —— 但**没违反**
 * §5.3 的"禁止 setOverride"
 * ==================================================================
 *
 * §5.3 禁的是**属性修正**里的 `op: 'setOverride'`（那会让叠加顺序有影响）。
 * 这里改的是**一条 buff 定义里的那个数**：目标值是**绝对**的 100，
 * 与"先加后加"无关，所以交换律照旧成立（两条炁机的效果互不冲突：
 * 一条改代价、一条改增伤值）。
 *
 * ⚠️ **与其它来源仍然相加**：这里改的是「凝」这条 buff 贡献的百分比；
 * 若别处还有 `addPercent`（装备 / 别的 buff），玩家最终是 `100 + 那些`。
 * 这与 `core/stats/aggregate.ts` 的"增伤百分比层相加"是同一条规则。
 */
export const QIJI_FOCUS_BOOST: QijiEntity = {
  id: 'ningShenRuDao',
  kind: 'qiji',
  nameKey: 'qiji.ningShenRuDao.name',
  descKey: 'qiji.ningShenRuDao.desc',
  icon: 'char_focus',
  category: 'offense',
  rarity: 'uncommon',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'focus', scope: 'run' },
    value: 3,
  },
  abilities: [],
  skillTweak: {
    skillId: 'focus',
    buffOverrides: [
      { buffId: FOCUS_BUFF.id, modifiers: [{ stat: 'damageBoost', value: 100 }] },
    ],
  },
};

/* ================================================================== *
 * 3. 两个兜底：开局就解锁（§5.4 的"通用炁机"）
 * ================================================================== */

/**
 * **加血上限**（用户点名的第①个兜底）。
 *
 * ⚠️ 效果落点是 `modifier: maxHp` —— **不是** `caps`：引擎的 `maxHp` 修正
 * 今天**还没接线**（`changeResource` 只读 `combatant.caps.hp`，见
 * `docs/specs/2026-10-12-roguelike.md` 的 W6）。所以实际生效的那一步在
 * `app/kit.ts` 的 `buildPlayerKit`：它把 `maxHp` 修正**累加进 `caps.hp`**。
 * 这里仍然写标准的 `modifier`（而不是给一个"改 caps"的专属字段）——
 * W6 做完之后这一条的**数据不用改**，改的只是 `buildPlayerKit` 里那一步。
 *
 * 数值 +30（§5.4 表的建议值；用户原话"如果 30 血只能选 1 次，就多加几个兜底"）。
 *
 * ⚠️ **一局只能选一次**（用户 2026-10-13 定死，原话："肉鸽也改成一局
 * 只能选一次（不叠加）"）—— 所以这里**没有** `maxStacks`
 * （那个字段已整条删除，见 `core/types/qiji.ts` 的作废段）。
 * 用户当年那句"如果 30 血只能选 1 次，就**多加几个兜底**"的答案就是
 * 池子里有**多条** `unlock: always` 的通用炁机（今天两条，见下面的池子），
 * 而不是"同一条叠 3 层"。
 */
export const QIJI_VITALITY: QijiEntity = {
  id: 'vitality',
  kind: 'qiji',
  nameKey: 'qiji.vitality.name',
  descKey: 'qiji.vitality.desc',
  icon: 'char_guard',
  category: 'generic',
  rarity: 'common',
  /** 开局即解锁（**但第一场打完才出现选择屏** —— 那是 `runSession` 的事）。 */
  unlock: { kind: 'always', of: [] },
  abilities: [
    {
      kind: 'modifier',
      modifier: { stat: 'maxHp', op: 'add', value: 30, sourceKey: 'qiji.vitality' },
    },
  ],
};

/**
 * **炁回复速度**（用户点名的第②个兜底）。
 *
 * ⚠️ 效果落点是 `modifier: energyRegen` —— 它是**每秒**的速率
 * （`core/stats/aggregate.ts` 的"资源回复（每秒）"口径）。引擎里
 * `regenerate()` 原先只回固定的 `ENERGY_PER_LOGIC_TICK`（10 炁/秒）、
 * **不读这个属性**；P3 把它接线（每逻辑步多加 `floor(energyRegen / 10)`）。
 *
 * ⚠️ **数值必须 ≥ 10/秒**：引擎按逻辑步结算，`floor(5 / 10) = 0`
 * 会把一半的配置静默吃掉（那条规则的推导在 `core/combat/index.ts` 的
 * `regenerate` 里）。所以这里用 **+10 炁/秒**（= 每步 +1）——
 * 基础回复翻倍，选一层就有明显的手感差别。
 */
export const QIJI_BREATH: QijiEntity = {
  id: 'breath',
  kind: 'qiji',
  nameKey: 'qiji.breath.name',
  descKey: 'qiji.breath.desc',
  icon: 'char_focus',
  category: 'generic',
  rarity: 'common',
  unlock: { kind: 'always', of: [] },
  abilities: [
    {
      kind: 'modifier',
      modifier: { stat: 'energyRegen', op: 'add', value: 10, sourceKey: 'qiji.breath' },
    },
  ],
};

/* ================================================================== *
 * 4. 两条「用 30 次」解锁的炁机（2026-10-14 用户点名）
 * ================================================================== *
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.6。
 *
 * ⚠️ **解锁条件零新代码**：`statAtLeast` + `skillUses` + `scope:'run'`
 * 都是既有机器（§5.2.1 / §5.2.2）—— 30 次用出去就解锁。
 *
 * ⚠️ 它们是**两条**（拳 / 斩各一条），与前面"同一个技能解锁两条"
 * （凝减耗 + 凝增伤）不同：这里**没有任何共享条件**。
 */

/**
 * **「黑闪」** —— 拳 30 次解锁。
 *
 * 效果全在那条**常驻 buff** 里（`kits/heishan.ts`）：打中拳 → 挂 1.2 秒
 * 节拍 → 节拍到期开 0.1 秒窗口 → 落在窗口里的那一拳**伤害 ×2**，而且它
 * 又刷新节拍 ⇒ **保持 1.2 秒的节拍就能一直连**。
 *
 * ⚠️ 这是 `QijiEntity.passiveBuffs` 的**第一个消费者**（用户："这个也是
 * 用 buff 实现，记录上一次时间"）—— 此前三条出口都挂不了 buff。
 */
export const QIJI_HEISHAN: QijiEntity = {
  id: 'heiShan',
  kind: 'qiji',
  nameKey: 'qiji.heiShan.name',
  descKey: 'qiji.heiShan.desc',
  icon: 'char_attack',
  category: 'offense',
  rarity: 'rare',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: PUNCH_SKILL_ID, scope: 'run' },
    value: 30,
  },
  abilities: [],
  passiveBuffs: [HEISHAN_WATCHER],
};

/**
 * **「斩法」** —— 斩 30 次解锁：**读条减半 + 伤害 +30%**。
 *
 * ⚠️ 落点是 `skillTweak`（改**技能定义本身**），与「凝」那两条同一条路。
 * ⚠️ **读条 500ms 的一半是 250ms —— 落在 0.1 秒刻度之外**，而刻度是硬
 * 规则（`content/timeGrid.ts`：显示与实现必须同刻度）⇒ `applySkillTweaks`
 * 会把它对齐到**最近的刻度 300ms**（= 减 40%）。那 50ms 的差是**刻度的
 * 代价**，理由写在 `data/skillTweak.ts` 的 `roundToLogicStep` 上。
 */
export const QIJI_ZHAN: QijiEntity = {
  id: 'zhanFa',
  kind: 'qiji',
  nameKey: 'qiji.zhanFa.name',
  descKey: 'qiji.zhanFa.desc',
  icon: 'char_attack',
  category: 'offense',
  rarity: 'rare',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'attack', scope: 'run' },
    value: 30,
  },
  abilities: [],
  skillTweak: {
    skillId: 'attack',
    castTimeScale: 0.5,
    damageScale: 1.3,
  },
};

import {
  QIJI_BREAK_MIGHT,
  QIJI_CHONGJI,
  QIJI_DODGE_DOUQI,
  QIJI_EXPLOSIVE_SHIELD,
  QIJI_FOCUS_SLASH,
  QIJI_QI_RECYCLE,
  QIJI_QI_RESONANCE,
  QIJI_CHAN_REGEN,
  QIJI_HOLD_WAVE,
  QIJI_THICK_SHIELD,
  QIJI_YU_ENERGY,
} from './qijiExtra';

export const ALL_QIJI: readonly QijiEntity[] = [
  QIJI_VITALITY,
  QIJI_BREATH,
  QIJI_JIE_STRIKE,
  QIJI_GUARD_STRIKE,
  QIJI_FLASH_STRIKE,
  QIJI_DODGE_CHARGE,
  QIJI_FOCUS_COST,
  QIJI_FOCUS_BOOST,
  QIJI_HEISHAN,
  QIJI_ZHAN,
  QIJI_FOCUS_SLASH,
  QIJI_CHONGJI,
  QIJI_DODGE_DOUQI,
  QIJI_QI_RESONANCE,
  QIJI_QI_RECYCLE,
  QIJI_YU_ENERGY,
  QIJI_BREAK_MIGHT,
  QIJI_THICK_SHIELD,
  QIJI_EXPLOSIVE_SHIELD,
  QIJI_HOLD_WAVE,
  QIJI_CHAN_REGEN,
];

/** 按 id 取一个炁机（`chosen` 里存的是 id，记录 / UI 要还原定义）。 */
export function qijiById(id: string): QijiEntity | undefined {
  return ALL_QIJI.find((qiji) => qiji.id === id);
}

/** 导出基础窗口定义，供测试断言"派生的 buff id 是同一个"。 */
export { COMBO_WINDOW };
