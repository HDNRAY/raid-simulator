/**
 * **改键的语义** —— 触碰绑定表的那几个纯函数。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `ui/settings/logic.ts` 再次顶到 700 行上限（AGENTS.md §3）。按那里的
 * 规则 —— **不许靠删/压注释解决，要拆 util 或横向切割** —— 把"改键"
 * 这一撮横向切出来：它们只依赖 `EMPTY_KEY` 与绑定表的形状，
 * 与焦点、命中、tab、几何都没有交集。
 *
 * ⚠️ 与 `keyNames.ts` 是**同一个做法、同一个原因**（那一次也是
 * logic.ts 顶到上限）。抽取时**注释整段搬过来**，不留摘要。
 *
 * ⚠️ 这些函数**不碰 DOM、不碰 Pixi**，是纯的 —— 所以可以直接单测。
 */

import { EMPTY_KEY } from './keyNames';

/* ------------------------------------------------------------------ *
 * 改键
 * ------------------------------------------------------------------ */

export interface RebindResult {
  readonly bindings: readonly { readonly key: string; readonly skillId: string }[];
  /** 改键失败的原因；成功时为 undefined */
  readonly error?: 'conflict';
  /** 被顶掉绑定的技能（成功时可能有） */
  readonly unbound?: string;
}


/**
 * 把一个技能改绑到某个键。
 *
 * ------------------------------------------------------------------
 * 冲突策略：**顶掉旧占用者，而不是拒绝**
 * ------------------------------------------------------------------
 *
 * 两种做法都常见。选"顶掉"的理由：玩家改键的意图很明确
 * （"我要让闪避是这个键"），如果因为冲突被拒绝，他还得先去把
 * 旧技能改成别的键、再回来改这个 —— 两次操作做一件事。
 *
 * 但**同一个技能内部**的冲突要拒绝：那是"列表里出现两个相同按键"
 * 这种真错误（例如内容里写错了默认键位）。
 */
export function applyRebind(
  bindings: readonly { readonly key: string; readonly skillId: string }[],
  skillId: string,
  key: string,
): RebindResult {
  if (bindings.some((b) => b.skillId === skillId && b.key === key)) {
    // 已经是这个键了，无事发生
    return { bindings };
  }

  const previous = bindings.find((b) => b.skillId === skillId);
  const mapped = bindings.map((b) => {
    if (b.skillId === skillId) return { ...b, key };
    // 顶掉占用同一个键的其它技能
    if (b.key === key) return { ...b, key: EMPTY_KEY };
    return b;
  });

  /**
   * ⚠️ 技能**不在表里时要追加**，不能只 `map`。
   *
   * ==================================================================
   * 这是一个真实踩过的 bug（「截」绑不上键）
   * ==================================================================
   *
   * `map` **只改已存在的条目、从不新增**。所以只要某个技能没被写进
   * `DEFAULT_BINDINGS`（或玩家存档里的旧绑定表），`applyRebind` 就
   * **静默什么都不做** —— 界面显示"已进入改键"、按了键、看起来也完成了，
   * 但那一条绑定从来没被写进去。
   *
   * 失败之所以难发现：设置页的行来自**技能注册表**，与这张绑定表是两个
   * 数据源。注册表里有「截」所以它显示得出来，绑定表里没有所以绑不上。
   *
   * 所以这里不假设调用方给的表是全的 —— 缺失就补上。
   */
  const next =
    previous === undefined ? [...mapped, { key, skillId }] : mapped;

  const unbound = previous?.key;
  return unbound === undefined ? { bindings: next } : { bindings: next, unbound };
}

/**
 * **交换两个槽位上的技能**（「按键」页改键时点另一格）。
 *
 * ==================================================================
 * ⚠️ 为什么不能复用 `applyRebind`
 * ==================================================================
 *
 * `applyRebind` **只交换键、不动数组顺序** —— 所以换完之后**槽位顺序
 * 一点变化都没有**，"选 slot 再选技能换 slot"是**假的**。
 *
 * ⚠️ 这个函数原先的理由是"触屏按钮顺序 = 绑定表里有键的技能的顺序"
 * （`touchButtonsFromBindings`）。2026-10-12 用户推翻了那条派生
 * （见 AGENTS.md §3b 的作废标注），所以现在它服务的是**技能栏槽位**
 * （`slotsFromBindings` 按同一张表的顺序取）。结论不变，受益者换了。
 *
 * 需求："有一个方案是把 双弧 缩小放在 按键设置的右下角，然后选slot，
 * 再选技能就换slot" —— 核心诉求是**换位置**，不是换键。
 *
 * 这个函数直接**交换两个位置的技能**，于是：
 *   - 槽位顺序跟着变（那正是玩家要的）
 *   - 空键位（未上场的技能）也留在原位，不会被挤走
 *
 * @param from 源下标（`rowSkillIds` 里的位置）
 * @param to   目标下标
 */
export function swapSlotSkills<T extends { readonly key: string; readonly skillId: string }>(
  bindings: readonly T[],
  from: number,
  to: number,
): readonly T[] {
  if (from === to) return bindings;
  const a = bindings[from];
  const b = bindings[to];
  if (a === undefined || b === undefined) return bindings;
  const next = [...bindings];
  next[from] = { ...a, skillId: b.skillId };
  next[to] = { ...b, skillId: a.skillId };
  return next;
}


/**
 * **点一次技能格该做什么** —— 键盘、鼠标、触屏共用一套语义。
 *
 * 需求："移动端和键盘的功能需要是一样的"（AGENTS.md §3b），
 * 以及玩家原话："enter 或者点击 hover 的 才进绑定"。
 *
 * | 情形 | 结果 |
 * |---|---|
 * | 正在改键中 | `bind` —— 绑到这个格子 |
 * | 点到**已选中**的格子 | `capture` —— 进改键（等价键盘的 Enter） |
 * | 其它 | `focus` —— 只选中 |
 *
 * ==================================================================
 * ⚠️ 这里原本有个 `isTouch` 条件，是个**错误的假设**
 * ==================================================================
 *
 * 原文：'"再点一次已选中的格子"**只在触屏**上生效：鼠标双击进改键会与
 * "点=选中"的语义打架，而且**鼠标本来就有键盘可用**。'
 *
 * 最后那句是错的，而且代价很大：**纯鼠标用户根本进不去改键** ——
 * 键盘的 `Enter` 是唯一入口，鼠标点多少次都只会换来 `focus`。
 * 玩家实测反馈："我现在任意一个都绑不了了。"
 *
 * 而且它同时违反 §3b：触屏**按不出 Enter**，所以触屏唯一的改键入口
 * 是"再点一次已选中的格子"；桌面却把这个入口关掉了 —— 两边各缺一半。
 *
 * 现在**两边合用同一条规则**：点已选中的格子就进改键。
 * 先点一下选中、再点一下进改键，与键盘的"方向键选中 → Enter"完全对齐。
 *
 * ⚠️ **「触屏」页不走这里**（2026-10-12）：那一页点格子 = 放上 / 取下触屏
 * 按钮，判定在 `panelDispatch.resolvePanelDispatch` 里**先于**本函数分流
 * （触屏玩家按不出键，"进改键"对他们没有意义）。
 */
export function resolveRowTap(input: {
  readonly focusedSkillId: string | undefined;
  readonly capturingSkillId: string | undefined;
  readonly touchedSkillId: string;
}):
  | { readonly kind: 'focus' }
  | { readonly kind: 'capture' }
  | { readonly kind: 'bind'; readonly skillId: string } {
  if (input.capturingSkillId !== undefined) {
    return { kind: 'bind', skillId: input.touchedSkillId };
  }
  if (input.focusedSkillId === input.touchedSkillId) {
    return { kind: 'capture' };
  }
  return { kind: 'focus' };
}
