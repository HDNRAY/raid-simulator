/**
 * **「避实击虚」的蓄势 buff**：下一次攻击伤害翻倍，被那次攻击**消耗掉**。
 *
 * ==================================================================
 * 它是什么（一句话）
 * ==================================================================
 *
 * 它是「避」用出后挂在玩家身上的一层状态（授予方是 `data/qiji.ts` 的
 * `QIJI_DODGE_CHARGE`）：**下一次攻击翻倍，然后消失**。
 *
 * ==================================================================
 * 为什么单独一个文件（而不是塞进某个 kit）
 * ==================================================================
 *
 * 它有三个**方向不同**的消费者：
 *
 *   - `kits/linwanfeng.ts` 的「斩」「劈」—— 命中时**消耗**它
 *   - `kits/combo.ts` 的「击」—— 同上（它也会造成伤害）
 *   - `data/qiji.ts` —— 「避」用出时**授予**它
 *
 * 放进这三者中的**任何一个**都会造出方向不对的 import：`combo.ts` 是
 * **两个角色共用**的派生系（凯丽也有「击」），让它 import 林晚风的 kit
 * 是错的；而让 kit 去 import `data/qiji.ts` 更是把内容依赖掉了个头。
 *
 * 所以它取与 `data/scale.ts` 相同的形状：**被多方共用的叶子** ——
 * 谁都可以 import 它，它不 import 任何内容。
 *
 * ==================================================================
 * ⚠️「翻倍」怎么表达：`damageBoost` **加 100 个百分点**
 * ==================================================================
 *
 * `damageBoost` 是**累加器**：值 100 = +100%（`core/stats/aggregate.ts` 的
 * 表 + `core/combat/damage.ts` 的 `value *= 1 + damageBoost / 100`）。
 * 所以与「凝」的 +60 同时开着时是 `×(1 + 1.6)` —— **相加**，不是把最终
 * 伤害再乘一次 2。这与本作"增伤百分比层相加"是同一条规则（两个 +10%
 * 是 +20%，见 `stats/aggregate.ts` 文件头）。
 *
 * ⚠️ 不用 `damageMult`：那是"整体输出 ×N"（`BuffDef.damageMultBoost`，
 * Boss 狂暴那条路），语义是**一个整体开关**；这里要的是"这一击多
 * 100%"，与「凝」同层才符合玩家的心算。
 *
 * ⚠️ 数值**不写死在文案里**：i18n 的说明写"伤害翻倍"，而这个 100 是
 * 它的家 —— 两者不一致 = 玩家看到的与生效的不是一回事。所以
 * `tests/unit/qiji.test.ts` 有一条断言从这个值读出"翻倍"再与文案对账。
 *
 * ==================================================================
 * ⚠️「用掉就消耗」怎么表达：攻击技能里的 `removeBuff`（**已有**机制）
 * ==================================================================
 *
 * 引擎里"用掉一个 buff"的**唯一**已有通路，是"**消耗方**的命中里写一条
 * `removeBuff`"——先例是「击」消耗 `combo-window`（见 `kits/combo.ts` 的
 * `STRIKE.hits`）。**没有**"单次 buff"这类 flag，也**不能**用
 * `Ability: 'consume'`：
 *
 *   - `ConsumeAbility` 的语义是"从资源池扣资源"（`core/types/abilities.ts`），
 *     与 buff 无关
 *   - 而且它**还没有执行点**（`content/capabilityAudit.ts` 的
 *     `UNIMPLEMENTED_ABILITY_KINDS` 会把它当 error 拦下）—— 写它 =
 *     静默无效，正是 AGENTS.md §2 最坏的那一类
 *
 * 所以每个**会造成伤害的玩家技能**的 `hits[].effects` 里都写了：
 *
 *   { kind: 'removeBuff', target: { mode: 'self' }, buffId: DODGE_CHARGE.id }
 *
 * ⚠️ **这是一份必须同步的契约**：将来加一个"林晚风能用的攻击技能"却
 * 忘了加这条，那个技能就**不消耗**蓄势（下一击还能再翻倍）—— 静默，
 * 而且只在"选了这条炁机"时才发生。所以
 * `tests/unit/qijiWiring.test.ts` 有一条**从技能表推导**的断言：
 * 林晚风每个带 `damage` 的技能都必须消耗它。漏了就是红的。
 *
 * ⚠️ 顺序：`damage` 写在 `removeBuff` **之前**（`resolveHit` 按数组顺序
 * 结算）。反过来写数值也不会错（同一次命中的 `casterStats` 是开头取一次
 * 的），但"先打、再消耗"才是读得对的顺序。
 *
 * ⚠️ 被闪掉时**照样消耗**：`removeBuff` 的 `target` 是 `self`，
 * `hitResolution` 的 `actsOnVictim` 因此判它"不作用于挨打者"、闪避不跳过
 * 它 —— 与「击」消耗窗口是同一条判据（你确实挥出了这一刀）。
 *
 * ==================================================================
 * ⚠️ 持续时间**无限**：唯一的终止条件是"打出去"
 * ==================================================================
 *
 * 用户的原话是"buff 下一次攻击伤害翻倍 / 用掉就消耗"——**没有时间维度**。
 * 给一个有限时长等于造出用户没要的第二种结束方式（闪完 5 秒不打，buff
 * 自己没了），而那种"悄悄过期"在画面上与"已经用掉"长得一模一样。
 *
 * 所以用 `Number.POSITIVE_INFINITY`（与「卸」的阈值 buff 同一条理由：
 * 生命周期由**别的东西**驱动，不是时间）。校验器的 `OFF_GRID_TIME` 对
 * `POSITIVE_INFINITY` 有明文豁免（见 `core/content/timeGrid.ts`）。
 *
 * ⚠️ 真要改成有限时长，用 `logicMs(n)` 而不是裸毫秒 —— 时长必须落在
 * 0.1 秒刻度上，否则校验器会拦（`OFF_GRID_TIME`）。
 */

import type { BuffDef } from '../../core/types';
import { C } from '../scale';

/** 蓄势：下一次攻击 +100%（= 伤害翻倍），用掉就消耗。 */
export const DODGE_CHARGE: BuffDef = {
  id: 'dodge-charge',
  nameKey: 'buff.dodgeCharge.name',
  /**
   * 图标沿用「避」的字（`char_dodge`）：攒起这一层的是「避」，
   * 而图标行上区分它的是短标签（`buffShort.dodgeCharge` =「击虚」）。
   */
  icon: 'char_dodge',
  polarity: 'buff',
  color: C.dodge,
  duration: Number.POSITIVE_INFINITY,
  /**
   * **一层，刷新**（不是叠加）：用户要的是"下一次攻击翻倍"，而不是
   * "连闪 3 次就 ×8"。再闪一次只是把同一层重新盖上。
   */
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'damageBoost',
      op: 'addPercent',
      /** 100 = +100% = **翻倍**（单位约定见文件头）。 */
      value: 100,
      sourceKey: 'buff.dodgeCharge.name',
      namespace: 'dodgeCharge',
      tier: 'buff',
    },
  ],
};
