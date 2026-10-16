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
  WHISPER_FLAT_REDUCE,
  WHISPER_FLAT_REDUCE_FLOOR,
} from './balance';
import type { BuffDef } from '../core/types';

export const WHISPER_IDS = ['enrage', 'blunt', 'slowBreath', 'cutDouqi'] as const;

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
    | { readonly kind: 'playerBuff'; readonly buff: BuffDef };
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
];

/** 按 id 找一条；找不到给 `undefined`（调用方回落"没有低语"）。 */
export function whisperById(id: string): WhisperDef | undefined {
  return WHISPER_POOL.find((w) => w.id === id);
}
