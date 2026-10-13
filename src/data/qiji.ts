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
 * "引擎按 id 解析**战斗内**定义"的地方，而炁机的效果走两条**明路**：
 *
 *   `abilities[].modifier` → `app/kit.ts` 的 `buildPlayerKit` → `passiveModifiers`
 *   `comboWindow`          → `app/kit.ts` 的 `buildPlayerKit` → `comboWindows`
 *
 * 所以今天"一个炁机引用了不存在的 buff / 技能"没有校验器会拦 —— 记在
 * `docs/specs/2026-10-12-roguelike.md` 的 P6 里，**不要**以为它是安全的。
 */

import type { QijiEntity } from '../core/types/qiji';
import { COMBO_WINDOW, comboWindowFor } from './kits/combo';

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
 * 成功定义：**阈值挡下了整击**（`avoided.viaBuffId === 'guard'`）。
 * 「卸」是按住型、从不发 `interruptSuccess`，所以它走**第二条通道**
 * （`viaBuffId`）。没挡住（`>N` 的平减）**不开窗** —— 那只是"减伤"，
 * 不是"卸掉了"。
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
    /** 「卸」的阈值 buff：它挡下整击时算"用成功了"。 */
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
 * 2. 两个兜底：开局就解锁（§5.4 的"通用炁机"）
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
  /** 叠 3 层（§5.4）：选满一维之后被迫看向机制炁机（§11 风险 #2 的缓解）。 */
  maxStacks: 3,
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
  maxStacks: 2,
  abilities: [
    {
      kind: 'modifier',
      modifier: { stat: 'energyRegen', op: 'add', value: 10, sourceKey: 'qiji.breath' },
    },
  ],
};

/* ================================================================== *
 * 3. 池子
 * ================================================================== */

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
export const ALL_QIJI: readonly QijiEntity[] = [
  QIJI_VITALITY,
  QIJI_BREATH,
  QIJI_JIE_STRIKE,
  QIJI_GUARD_STRIKE,
  QIJI_FLASH_STRIKE,
];

/** 按 id 取一个炁机（`chosen` 里存的是 id，记录 / UI 要还原定义）。 */
export function qijiById(id: string): QijiEntity | undefined {
  return ALL_QIJI.find((qiji) => qiji.id === id);
}

/** 导出基础窗口定义，供测试断言"派生的 buff id 是同一个"。 */
export { COMBO_WINDOW };
