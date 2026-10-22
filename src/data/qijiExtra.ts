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
