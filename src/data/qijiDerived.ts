/**
 * **派生技的炁机**（2026-10-22 第三轮）—— 「冲」与「击」各一条。
 *
 * ⚠️ 为什么单独一个文件：`qijiExtra.ts` 加完这两条到了 **724 行**
 * （AGENTS §3 的上限 700）⇒ 按关注点切：这里只放"给派生技加能力"的两条，
 * 其余后加的炁机仍在 `qijiExtra.ts`。池子（`ALL_QIJI`）仍在 `qiji.ts` 拼。
 */

import type { QijiEntity } from '../core/types/qiji';
import { CHONG_WINDOW } from './kits/daixuan';

/* ================================================================== *
 * 2026-10-22 第三轮：两条"派生技"的炁机（用户："冲按2次才消失" / "击可以打断"）
 * ================================================================== */

/**
 * **「冲波再起」**：点开一次「冲」的窗口 ⇒ 窗口挂 **2 层** ⇒ **连按两次**才消失。
 *
 * ⚠️ 与「弹中生波」的关系：那条负责**开窗**（1 层），这条负责"**开窗时是 2 层**"。
 * 两条都带时不是"1+2=3"，因为窗口 `maxStacks: 2` 会把层数**夹在 2** ✓
 * （`stacking.max` 是硬上限，见 `CHONG_WINDOW`）。
 *
 * ⚠️ 为什么用 `onTick` + 4 秒 CD、而不是 `onBuffApplied`：后者会在"授予"里再
 * 授予自己 ⇒ 自我递归 ✗。这里与「弹中生波」**同一个节拍**（按住「弹」满 4 秒
 * 才开窗），所以 `when: hasBuff(弹的节奏)` 就是"你正在按住弹"这个事实。
 */
export const QIJI_CHONG_STACK: QijiEntity = {
  id: 'chongBoZaiQi',
  kind: 'qiji',
  nameKey: 'qiji.chongBoZaiQi.name',
  descKey: 'qiji.chongBoZaiQi.desc',
  icon: 'char_magic2',
  category: 'offense',
  rarity: 'rare',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'chong', scope: 'run' },
    value: 5,
  },
  abilities: [],
  passiveBuffs: [
    {
      id: 'qiji-chong-stack',
      nameKey: 'qiji.chongBoZaiQi.name',
      icon: 'char_magic2',
      polarity: 'buff',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      triggers: [
        {
          on: 'onTick',
          /** 与「弹中生波」同一个节拍（按住弹满 4 秒开一次窗）。 */
          cooldownMs: 4000,
          when: { kind: 'hasBuff', who: 'self', buffId: 'daixuan-tan-rhythm' },
          /** ⚠️ **两条 `grant`**：`applyBuff` 一次加一层 ⇒ 两层的窗口 ✓。 */
          then: [
            { kind: 'grant', target: { mode: 'self' }, buff: CHONG_WINDOW },
            { kind: 'grant', target: { mode: 'self' }, buff: CHONG_WINDOW },
          ],
        },
      ],
    },
  ],
};

/**
 * **「一击破势」**：「击」命中时**打断** Boss 的读条。
 *
 * 用户 2026-10-22："击 的炁机改成 **击 可以打断**，也是 **5次击解锁**"。
 *
 * 实现复用现成两块：`onHitDealt` + `filter: { by:'skill', skillId:'strike' }`
 * （触发器只认"击打中"），然后 `deal` 一条**只含 `interrupt` 效果的命中**。
 *
 * ⚠️ **不带 `force`**（用户 2026-10-22 质疑："击的打断为什么要能打断霸体？？？"）
 * —— `force: true` 的语义是"连霸体也打断"，那是**「破」那条线的特权**
 * （「破」10 炁 + 30 秒冷却，代价买的就是"破霸体"）。「击」是连招的收尾，
 * 拿的只是"打断普通读条"这一档 ⇒ 去掉 `force`，走普通打断 ✓。
 *
 * ⚠️ 它不消耗 combo 窗口（窗口本来就由「击」自己被用掉）；也不改 `STRIKE`
 * 的定义 —— 否则"带不带这条炁机"会变成两个技能 ✗。
 */
export const QIJI_STRIKE_INTERRUPT: QijiEntity = {
  id: 'yiJiPoShi',
  kind: 'qiji',
  nameKey: 'qiji.yiJiPoShi.name',
  descKey: 'qiji.yiJiPoShi.desc',
  icon: 'char_break',
  category: 'offense',
  rarity: 'epic',
  unlock: {
    kind: 'statAtLeast',
    stat: { s: 'skillUses', skillId: 'strike', scope: 'run' },
    value: 5,
  },
  abilities: [],
  passiveBuffs: [
    {
      id: 'qiji-strike-interrupt',
      nameKey: 'qiji.yiJiPoShi.name',
      icon: 'char_break',
      polarity: 'buff',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      triggers: [
        {
          on: 'onHitDealt',
          filter: { by: 'skill', skillId: 'strike' },
          then: [
            {
              kind: 'deal',
              target: { mode: 'primaryEnemy' },
              /** 只有打断、没有伤害 —— 伤害仍由「击」自己那一下给。 */
              hit: {
                at: 0,
                /** ⚠️ 不带 `force`：只打断**非霸体**读条（见上面的说明）。 */
                effects: [{ kind: 'interrupt', target: { mode: 'primaryEnemy' } }],
              },
            },
          ],
        },
      ],
    },
  ],
};
