/**
 * 「恶魔低语」—— 肉鸽里**每一层抽一条**的难度惩罚（2026-10-16）。
 *
 * ==================================================================
 * 它是什么（用户口径）
 * ==================================================================
 *
 * > 这个惩罚 起一个名字，比如"**恶魔低语**"…我们以后可以**不止 6 个**，
 * > **每一层随机 1 个**，**顺序也是随机的**。
 *
 * 于是这一层 = **一局肉鸽里第几场**（不是 Boss、不是档位）：
 * 第 1 层**纯净**（什么都不挂），第 2 层起每层**抽一条**。
 * 一局打 7 场 ⇒ 需要 6 条 —— 池子比 6 大时每次抽到的组合不同，
 * 那就是肉鸽的重玩性（抽取是**种子化**的，见 `core/run/whispers.ts`）。
 *
 * ==================================================================
 * 三条硬线（写新的一条之前先过一遍）
 * ==================================================================
 *
 * 1. **玩家必须有解**（`AGENTS.md` §2）：不许有"无法规避的伤害"，
 *    `avoidable: false` 只许用在**不造成伤害**的效果上
 * 2. **加"防御的难度"，不加伤害**（用户 2026-10-16）："狂暴 就已经是
 *    加伤了…我们游戏挨几次打就死了，加太多伤没意义"
 * 3. **单挑**（`AGENTS.md` §2）：惩罚只作用于"玩家"或"那一个 Boss"
 *
 * ==================================================================
 * ⚠️ 数值的家在 `data/balance.ts`
 * ==================================================================
 *
 * 这里的 `apply` 只负责"挂给谁、挂什么"，**不写数**：
 * 5 / 3 / 0.8 三个数都是 `balance.ts` 的具名常量（用户会反复调）。
 */

import {
  WHISPER_ENERGY_REGEN_SCALE,
  WHISPER_MEND_HEAL,
  WHISPER_FLAT_REDUCE,
  WHISPER_FLAT_REDUCE_FLOOR,
} from './balance';
import { logicMs } from '../core/loopConstants';
import { BOSS_TELEGRAPH } from './bossShared';
import type { ActiveSkillDef, Behavior, BuffDef, SkillDef } from '../core/types';

export const WHISPER_IDS = ['enrage', 'blunt', 'slowBreath', 'cutDouqi', 'mend'] as const;

export type WhisperId = (typeof WHISPER_IDS)[number];

/**
 * 一条「恶魔低语」：**名字 + 说明 + 它挂什么**。
 *
 * ⚠️ `apply` 是**判别联合**（不是"一个可选的 buff 字段 + 一堆 flag"）：
 * 三种挂法在引擎里走三条完全不同的路（行为裁剪 / Boss 光环 / 玩家光环），
 * 写成联合之后**漏掉一种**会在 `switch` 里被穷尽性检查抓到。
 */
export interface WhisperDef {
  readonly id: WhisperId;
  /** 显示名（确认屏左栏那一条、buff 行上也用它）。 */
  readonly nameKey: string;
  /** 详情（右侧共用面板里显示的那段说明）。 */
  readonly descKey: string;
  readonly apply:
    /** **不裁掉** Boss 自己那条 `enrage` 行为（这一层它才会狂暴）。 */
    | { readonly kind: 'bossEnrage' }
    /** 挂给 **Boss** 的光环（玩家打出来的伤害会受影响）。 */
    | { readonly kind: 'bossBuff'; readonly buff: BuffDef }
    /** 挂给 **玩家** 的光环（防御预算 / 资源曲线受影响）。 */
    | { readonly kind: 'playerBuff'; readonly buff: BuffDef }
    /**
     * 给 **Boss 的行为表**追加一条（"这一层它多会一件事"）。
     *
     * ⚠️ 这是唯一能让 Boss **多学一招**的路：`grantSkill` 那类能力**还没实现**
     * （见 `core/content/capabilityAudit.ts`），所以"让它在某一层学会读条回血"
     * 只能靠**行为表 + 一条已经注册好的技能**（技能本身在 `WHISPER_SKILLS` 里，
     * 与"哪个 Boss 的常规表"无关 —— 抽到这条低语的 Boss 才会用它）。
     */
    | { readonly kind: 'bossBehavior'; readonly behaviors: readonly Behavior[] };
}

/* ------------------------------------------------------------------ *
 * 逐条的 buff 定义
 * ------------------------------------------------------------------ */

/**
 * 「钝击」：**所有伤害 −5（保底 3）**。
 *
 * ⚠️ 挂给 **Boss**（受击方）—— 平减读的就是**受击方**的 flag，
 * 所以玩家打它才会被削。
 */
export const WHISPER_BLUNT: BuffDef = {
  id: 'whisper-blunt',
  nameKey: 'whisper.blunt.name',
  icon: 'boss_cleave',
  polarity: 'debuff',
  color: 0xb08c5a,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: {
    flatDamageReduce: { amount: WHISPER_FLAT_REDUCE, floor: WHISPER_FLAT_REDUCE_FLOOR },
  },
};

/**
 * 「迟炁」：**回炁变慢 20%**（10/秒 → 8/秒）。
 *
 * ⚠️ 走 `energyRegenScale`（乘子、基准 1）而不是改 `ENERGY_PER_LOGIC_TICK`：
 * 前者是**这一局这一层**的事，后者是全局常数。
 */
export const WHISPER_SLOW_BREATH: BuffDef = {
  id: 'whisper-slow-breath',
  nameKey: 'whisper.slowBreath.name',
  icon: 'greed_idle',
  polarity: 'debuff',
  color: 0x6f8fb0,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [
    {
      stat: 'energyRegenScale',
      op: 'mult',
      value: WHISPER_ENERGY_REGEN_SCALE,
      sourceKey: 'whisper.slowBreath.name',
    },
  ],
};

/**
 * 「断缠」：**挨打不再获得缠**。
 *
 * ⚠️ 关的是**承受**那一半（"造成伤害换缠"照旧）—— 于是"防住"第一次
 * 有了资源上的正收益。规则在 `core/combat/holds.ts` 的
 * `gainsDouqiOnHitTaken`。
 */
export const WHISPER_CUT_DOUQI: BuffDef = {
  id: 'whisper-cut-douqi',
  nameKey: 'whisper.cutDouqi.name',
  icon: 'boss_sweep',
  polarity: 'debuff',
  color: 0x8a5ab0,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  flags: { noDouqiOnHitTaken: true },
};

/* ------------------------------------------------------------------ *
 * 「自愈」：周期性读条回血（**可打断**）
 * ------------------------------------------------------------------ */

/**
 * 这一条读条有多长（逻辑步）—— **2.0 秒**。
 *
 * 判据（用户对这条的原话是"回血读条"）：读条必须**长到来得及反应**，
 * 否则"可打断"是一句空话。2 秒与「敛财」同量级（那条也是 2 秒、也可打断）。
 */
const WHISPER_MEND_CAST = logicMs(20);

/** 两次「自愈」之间 **9 秒**（一场里大概放 3~5 次，够玩家决定要不要留打断）。 */
const WHISPER_MEND_COOLDOWN = logicMs(90);

/**
 * 读条标记（`BOSS_TELEGRAPH` 的一份拷贝，**时长 = 这一招的 `castTime`**）。
 *
 * ⚠️ 与各 Boss 文件里那个本地 `tel()`/`telegraphFor()` 同一条约定：
 * 玩家靠它**看见**它在读条（同时也是"可以打断"的提示）。
 */
export const WHISPER_MEND_TELEGRAPH: BuffDef = {
  ...BOSS_TELEGRAPH,
  id: 'whisper-mend-telegraph',
  duration: WHISPER_MEND_CAST,
};

/**
 * 「自愈」——**周期性、可打断**的回血读条。
 *
 * ⚠️ 结算在 `castFinish`（`resource` 不带 `on` 就是这个语义）⇒
 * **打断它就一点血都不回**。这正是这条低语的全部内容：
 * "把打断留给它"（与「敛财」同族：那条是叠增伤、这条是回血）。
 *
 * ⚠️ `hits: []`：它**不造成伤害** ⇒ 顺带绕开了"急速会让 `hits[].at`
 * 落在读条之外"那个坑（见 `core/combat/castPipeline.ts` 的说明）。
 */
export const WHISPER_MEND: ActiveSkillDef = {
  id: 'whisper-mend',
  kind: 'activeSkill',
  nameKey: 'whisper.mend.name',
  descKey: 'whisper.mend.skillDesc',
  icon: 'boss_armor',
  abilities: [
    { kind: 'grant', on: 'castStart', target: { mode: 'self' }, buff: WHISPER_MEND_TELEGRAPH },
    { kind: 'resource', resource: 'hp', delta: WHISPER_MEND_HEAL, target: { mode: 'self' } },
  ],
  castTime: WHISPER_MEND_CAST,
  cooldown: WHISPER_MEND_COOLDOWN,
  cost: [],
  hits: [],
  targeting: { mode: 'primaryEnemy' },
  tags: ['spell'],
  interruptible: true,
};

/** 「自愈」的行为：**CD 一好就出**（不看轮转 —— 它是"这一层多出来的事"）。 */
const WHISPER_MEND_BEHAVIOR: readonly Behavior[] = [
  { kind: 'onCooldown', skillId: WHISPER_MEND.id },
];

/* ------------------------------------------------------------------ *
 * 池子
 * ------------------------------------------------------------------ */

/**
 * 抽签池 —— ⚠️ **顺序不是难度顺序**（每一层抽到什么由种子决定），
 * 池子变大时也不需要动任何档位表。
 */
export const WHISPER_POOL: readonly WhisperDef[] = [
  {
    id: 'enrage',
    nameKey: 'whisper.enrage.name',
    descKey: 'whisper.enrage.desc',
    apply: { kind: 'bossEnrage' },
  },
  {
    id: 'blunt',
    nameKey: 'whisper.blunt.name',
    descKey: 'whisper.blunt.desc',
    apply: { kind: 'bossBuff', buff: WHISPER_BLUNT },
  },
  {
    id: 'slowBreath',
    nameKey: 'whisper.slowBreath.name',
    descKey: 'whisper.slowBreath.desc',
    apply: { kind: 'playerBuff', buff: WHISPER_SLOW_BREATH },
  },
  {
    id: 'cutDouqi',
    nameKey: 'whisper.cutDouqi.name',
    descKey: 'whisper.cutDouqi.desc',
    apply: { kind: 'playerBuff', buff: WHISPER_CUT_DOUQI },
  },
  {
    id: 'mend',
    nameKey: 'whisper.mend.name',
    descKey: 'whisper.mend.desc',
    apply: { kind: 'bossBehavior', behaviors: WHISPER_MEND_BEHAVIOR },
  },
];

/**
 * 低语自己带的技能（**给战斗注册表用**）。
 *
 * ⚠️ 必须在每一局战斗的注册表里：Boss 的行为表按 id 引用它，而"引擎不
 * 认识这个 id"的症状是**静默的**（每 9 秒一次 `skillRejected`，画面上
 * 什么都看不到）。落点在 `app/deps.ts` 的 `registryFor`。
 */
export const WHISPER_SKILLS: readonly SkillDef[] = [WHISPER_MEND];

/**
 * 低语自己带的 buff（**给内容注册表用**）。
 *
 * ⚠️ 逐条列出（与 `ALL_BUFFS` 里那份"看得见谁注册了"的清单同一条理由）：
 * 漏注册的后果是"引擎认识、校验器看不见"。
 */
export const WHISPER_BUFFS: readonly BuffDef[] = [
  WHISPER_BLUNT,
  WHISPER_SLOW_BREATH,
  WHISPER_CUT_DOUQI,
  WHISPER_MEND_TELEGRAPH,
];

/** 按 id 找一条；找不到给 `undefined`（调用方回落"没有低语"）。 */
export function whisperById(id: string): WhisperDef | undefined {
  return WHISPER_POOL.find((w) => w.id === id);
}
