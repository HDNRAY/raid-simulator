/**
 * **「恶魔低语」的抽取** —— 每一层抽一条，**种子化、纯函数**（2026-10-16）。
 *
 * ==================================================================
 * 用户口径
 * ==================================================================
 *
 * > 我们以后可以**不止 6 个**，**每一层随机 1 个**，**顺序也是随机的**。
 *
 * 所以这里只做一件事：给"这一局打几层 + 种子 + 抽签池"，返回**每层挂哪
 * 一条**。它不 import 任何内容（池子由调用方传进来）—— 于是这一层逻辑
 * 可以在 Node 里单测，而且池子长大 / 改名字都不会动这里。
 *
 * ==================================================================
 * 三条决定（都写在这里，免得下次重新讨论）
 * ==================================================================
 *
 * 1. **第 1 层纯净**（用户："第一档没有…从第二档开始"）⇒ 返回数组的第 0 位
 *    恒为 `undefined`，第 2..N 层各一条。
 * 2. **不放回**：一轮之内不重复抽（洗一遍池子按顺序发）。池子不够发满
 *    所有层时**再洗一轮**（宁可重复，也不要出现"后期某一层什么惩罚都
 *    没有" —— 那会让难度曲线在那里凭空掉下去）。
 * 3. **种子化**：随机流走 `battleSeed(runSeed, 偏移)`，与 **Boss 顺序**
 *    和 **每场战斗的种子**都分开 —— 理由与 `shuffle.ts` 顶部那段一样：
 *    共用一个流会让"改抽签"顺手改动战斗里的一切概率判定。
 *    偏移取 `1000 + 第几轮`：真实的场次编号是 1..7，撞不上。
 */

import { battleSeed, shuffle } from './shuffle';

/** 抽取用的种子偏移（真实场次编号是 1..7，撞不上）。 */
const WHISPER_SEED_OFFSET = 1000;

export interface DrawWhispersArgs<T> {
  /** 抽签池（顺序无所谓，抽之前会洗）。 */
  readonly pool: readonly T[];
  /** 一局的种子（`RunState.runSeed`）。 */
  readonly runSeed: number;
  /** 这一局打几层（= `order` 的长度）。 */
  readonly length: number;
}

/**
 * 每一层抽到的低语；**第 1 层恒为 `undefined`**（纯净）。
 *
 * @returns 长度 = `length`，下标 `i` = 第 `i + 1` 层。
 */
export function drawWhispers<T>(args: DrawWhispersArgs<T>): readonly (T | undefined)[] {
  const length = Math.max(0, Math.trunc(args.length));
  const plan: (T | undefined)[] = [];
  if (length <= 0) return plan;

  /** 第 1 层：什么都不挂。 */
  plan.push(undefined);
  if (args.pool.length === 0) {
    while (plan.length < length) plan.push(undefined);
    return plan;
  }

  let bag: T[] = [];
  let pass = 0;
  while (plan.length < length) {
    if (bag.length === 0) {
      bag = shuffle(args.pool, battleSeed(args.runSeed, WHISPER_SEED_OFFSET + pass));
      pass += 1;
    }
    plan.push(bag.shift());
  }
  return plan;
}

/**
 * 第 `position` 层（从 1 开始）的低语。
 *
 * ⚠️ 每次调用都重算整张表（纯函数、O(层数)）—— 不缓存是**有意**的：
 * 缓存意味着"哪一份是真的"多了一个真相源，而这张表的计算量可以忽略。
 */
export function whisperAt<T>(args: DrawWhispersArgs<T> & { readonly position: number }): T | undefined {
  const plan = drawWhispers(args);
  const index = Math.trunc(args.position) - 1;
  return index < 0 ? undefined : plan[index];
}
