/**
 * **自由模式的炁机层数表**：一条炁机开了几层、怎么加、怎么退、
 * 以及怎么变成 `buildPlayerKit` 要的形状。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"炁机激活"这件事的**纯数据层**：`id → 层数` 的表怎么变（加 / 退 /
 * 封顶归零）、怎么读、怎么翻译给引擎 —— 不认识光标、不认识卡片、不碰 Pixi。
 *
 * ==================================================================
 * 为什么从 `prepareLogic.ts` 切出来（AGENTS.md §3）
 * ==================================================================
 *
 * 2026-10-13 第三轮（卡片区可滚 + Tab 切块）之后那个文件到了 **749 行**
 * （超上限）。按 §3 先看它混了几件事：
 *
 * | 那一半 | 一句话 |
 * |---|---|
 * | 本文件 | 炁机**层数**怎么变（纯数据） |
 * | `prepareLogic` | 光标 / 选择 / 焦点怎么走（状态机） |
 *
 * 两者的输入输出完全不重叠（层数表里没有 `playerId` 这种字段），而
 * `prepareLogic` 的**状态机**那一半才是"这一屏的操作规则"—— 层数表挪走
 * 之后它对"炁机"只剩下"光标停在哪一条"。
 *
 * ⚠️ `prepareLogic` **转发**这些名字（`export type { … }` / `export { … }`），
 * 所以 `app/` 与既有测试的 import 一行都不用改 —— 拆文件不该改调用方的
 * 路径（那是纯噪音，还会让 review 看不出真正动了什么）。
 *
 * ⚠️ 注释与代码一起搬（§3：不留"见 xxx"的摘要）。

 *

 * ==================================================================
 * ⚠️ 炁机层数：**沿用 `maxStacks`**，不另开一套自由模式规则
 * ==================================================================
 *
 * 判据（AGENTS.md §2 的"同一件事不许有第二份表达"）：`data/qiji.ts` 的
 * `maxStacks` 已经是"一个炁机最多生效几层"的**唯一**声明 ——
 * `core/run` 的候选生成读它、`buildPlayerKit` 按 `stacks` 展开修正也读它。
 * 自由模式若无视它、让每条都能无限叠，同一个字段就会有**两种含义**
 * （肉鸽里 3 层、自由模式里 ∞），而那种漂移不会报错、只会让数值对不上。
 *
 * 于是"任意个"落在**条数**上（8 条炁机想开几条开几条，随时改），
 * 而每条自己的**层数**仍然认 `maxStacks`（默认 1）：
 *
 *   「固本培元」(maxStacks 3) 可以点 3 次 = +90 生命
 *   「周天运转」(maxStacks 2) 可以点 2 次 = +20 炁/秒
 *   其余 6 条（无 `maxStacks`）**只能一层**，再点就归零重来
 *
 * ⚠️ **封顶之后继续点 = 归零**（而不是"没反应"）：层数就是卡上的角标，
 * 而"点到底了却什么都看不出"正是本仓库点名过的那种"以为按键坏了"。
 * 归零给了它一个**看得见的下一个状态**，也让"取消"不必再学第二个键。
 * 想往下退一层用 `Shift+Enter`（或在卡片左半边点一下）。
 */

/* ================================================================== *
 * 炁机激活（层数）
 * ================================================================== */

/**
 * 一条炁机在自由模式里的层数上限。
 *
 * ⚠️ `maxStacks` 缺省 **1**（与 `QijiEntity.maxStacks` 的文档一致）——
 * 判据只有内容表那一处，这里不写第二份名单。
 * ⚠️ 上限至少 1：内容里写 `maxStacks: 0` 是没意义的（那条炁机永远开不了），
 * 但真写了也不该让界面无路可走 —— 夹到 1 然后由内容测试去拦它。
 */
export function stackCapOf(maxStacks: number | undefined): number {
  if (maxStacks === undefined) return 1;
  if (!Number.isFinite(maxStacks)) return 1;
  return Math.max(1, Math.floor(maxStacks));
}

/** 自由的炁机**层数表**：`id → 已叠层数`（缺键 = 没开、0 层）。 */
export type FreeQiji = Readonly<Record<string, number>>;

/** 这个 id 现在开了几层（不在表里 = 0）。 */
export function stacksIn(free: FreeQiji, id: string): number {
  return free[id] ?? 0;
}

/** 结果：下一帧的层数表 + 这次动作之后这个 id 的层数（渲染层画角标要用）。 */
export interface QijiCycle {
  readonly free: FreeQiji;
  readonly stacks: number;
}

/**
 * 把一条炁机**往上叠一层**；已经到顶就**归零重来**。
 *
 * 需求："勾选 / 取消 ✓ 任意个"。一个键同时承担两件事的代价是"到顶之后
 * 再点是什么"必须有答案 —— 见文件头：归零（而不是"没反应"），因为层数
 * 就画在卡上，归零是**看得见**的下一步。
 *
 * ⚠️ 没变化的路径返回**同一个对象**（调用方据此跳过写存储 / 重画）。
 */
export function cycleQijiStack(
  free: FreeQiji,
  id: string,
  maxStacks: number | undefined,
): QijiCycle {
  const cap = stackCapOf(maxStacks);
  const cur = stacksIn(free, id);
  const next = cur >= cap ? 0 : cur + 1;
  if (next === cur) return { free, stacks: cur };
  return { free: withStacks(free, id, next), stacks: next };
}

/**
 * 把一条炁机**退一层**（`Shift+Enter` / 点卡片左半边）。
 *
 * 0 层再退就是 0（不变），所以"退到底"是稳定的，不会绕回上限。
 */
export function unstackQiji(free: FreeQiji, id: string): QijiCycle {
  const cur = stacksIn(free, id);
  if (cur <= 0) return { free, stacks: 0 };
  return { free: withStacks(free, id, cur - 1), stacks: cur - 1 };
}

/**
 * 写一层数。**0 层 = 删掉这个键**（而不是留一个 `{ id: 0 }`）：
 * 两份"没开"的表达（缺键 / 0）会让"这个 id 到底开没开"变成要看两个地方。
 */
function withStacks(free: FreeQiji, id: string, stacks: number): FreeQiji {
  if (stacks <= 0) {
    const { [id]: _dropped, ...rest } = free;
    return rest;
  }
  return { ...free, [id]: stacks };
}

/**
 * 层数表 → **`buildPlayerKit` 要的形状**（`{ qijiId, stacks }[]`）。
 *
 * ⚠️ 这个函数是"自由模式的炁机怎么进战斗"的**唯一翻译点**：产物直接喂给
 * `data/kit.buildPlayerKit`（与肉鸽那条路**同一个函数**），所以"两个模式
 * 的效果不一样"从结构上不可能 —— 差别只在**谁来填这张表**。
 *
 * ⚠️ **顺序按 `order`（内容表的顺序）排**，不按对象键顺序：
 * `buildPlayerKit` 的展开与 `Object.keys` 的插入顺序有关，而黄金截图 /
 * 断言要能复现同一份修正列表。
 * ⚠️ 不在 `order` 里的键被丢掉（内容表换了名字之后的陈旧存档）。
 */
export function freeQijiChoices(
  free: FreeQiji,
  order: readonly { readonly id: string }[],
): readonly { readonly qijiId: string; readonly stacks: number }[] {
  return order.flatMap((entry) => {
    const stacks = stacksIn(free, entry.id);
    return stacks > 0 ? [{ qijiId: entry.id, stacks }] : [];
  });
}

