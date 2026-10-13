/**
 * **自由模式（备战屏）的光标 / 选择 / 炁机激活**（纯逻辑，可在 node 里测）。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏的**状态机**：方向键怎么走、Enter 确定什么、点击落在哪一项、
 * 炁机怎么叠层 —— 一行 Pixi 都不碰（几何在 `prepareLayout.ts`，
 * 内容模型在 `prepareDetail.ts`）。
 *
 * ==================================================================
 * 为什么把选择逻辑抽出来（而不是留在 `PrepareScreen` 里）
 * ==================================================================
 *
 * `PrepareScreen` 要构造 Pixi 对象，而 Pixi v8 在 jsdom 里不好跑（需要真
 * canvas / WebGL）。逻辑留在类里就只能写"能构造、不报错"这种零信息的
 * 冒烟测试；抽出来之后可以在 node 里精确测：
 *   - 方向键在同槽位里移动**光标**、到边界停住（不环绕）
 *   - 上下 / Tab 换槽位的顺序
 *   - **Enter 才把光标处的选项写进选择**（移动光标不改选择）
 *   - 炁机**点一次叠一层、到 `maxStacks` 封顶、再点重来**（见下）
 *
 * ==================================================================
 * ⚠️ 光标（cursor）与选择（selection）是**两个独立概念**
 * ==================================================================
 *
 * 需求（用户）："选中 和 目前光标 目前颜色是一样的" +
 * "用 enter 来确定选择，而不是靠移动到下一项"。
 *
 *   - `cursor`：光标停在哪一项。方向键 / Tab **只动它**
 *   - `playerId` / `bossId`：**按 Enter 确定下来**的那个，才是会上场的
 *
 * ⚠️ 别把两者合并回一个字段：合并之后"按 Enter 确定"就没有可表达的状态
 * 了，只能退化成"移动即确定"。
 *
 * ==================================================================
 * 2026-10-13：新增**炁机**槽位（自由模式里可以激活任意个）
 * ==================================================================
 *
 * 用户原话："**选了人之后，可以激活任意个他的炁机**"。
 *
 * ⚠️ 与肉鸽里"一局选一条、选了不能换"（`ui/qijiSelectLogic.ts`）**语义
 * 不同**：那边是**每场之后的一次决策**，这边是"随便配着玩"的自由模式。
 * 所以本屏的炁机是一个**可反复开关的集合**，不是一次选择 —— 硬套那边
 * 的"选了就离开这一屏"会造出两个语义打架的屏幕。
 *
 * ⚠️ **状态存在 `PrepareScreen` 之外**（`app/` 层的 `freeQijiStore`），
 * 本文件只提供纯函数：`cycleQijiStack()` 给下一帧的层数。
 * 这样"层数"这件事只有一处真相，而"怎么画"在渲染层。
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

import type { PrepareFocus, PrepareOption } from './prepareTypes';
import { prepareHitAreas } from './prepareLayout';

export type { PrepareFocus, PrepareOption } from './prepareTypes';
export type { PrepareHitArea } from './prepareLayout';
/**
 * ⚠️ **转发**命中几何（而不是让每个消费者自己去 `./prepareLayout` 取）：
 * `prepareLogic` 是"备战屏的规则"这一层，而"点在哪一项上"是它的一部分
 * （`hitTestPrepare` 就用它）。转发之后消费者只有**一个**入口，
 * 而几何本身仍然只有 `prepareLayout` 那一份实现。
 */
export { prepareHitAreas, prepareLabelY, rowTopsOf } from './prepareLayout';

/**
 * 光标在各槽位里停的那个选项。
 *
 * ⚠️ 每个槽位**各自记一份**：光标往上/往下走一趟再回来时，应该回到
 * 原来那一格，而不是被重置到"已选中的那个"（那会让"我只是路过"变成
 * "我的光标被偷走了"）。
 *
 * ⚠️ `qijiId` 与 `playerId` / `bossId` 不同：它**不是选择**，而是
 * "光标停在炁机行的哪一张卡上" —— 炁机的"选择"是层数表（`freeQiji`），
 * 光标只是键盘用来挑"现在改哪一条"的。
 */
export interface PrepareCursor {
  readonly playerId: string;
  readonly bossId: string;
  readonly qijiId: string;
}

/** 备战界面的当前选择 + 光标。 */
export interface PrepareSelection {
  /** **已确定**的人物（Enter / 点击写入）。 */
  readonly playerId: string;
  /** **已确定**的对手（Enter / 点击写入）。 */
  readonly bossId: string;
  /** 光标停在哪个槽位（`'start'` = 停在「开始战斗」上）。 */
  readonly focus: PrepareFocus;
  /** 光标在各槽位里停的选项（移动它**不改**上面的两个 id）。 */
  readonly cursor: PrepareCursor;
}

/** 光标此刻指着的那一项（槽位 + id）。 */
export interface PrepareTarget {
  readonly kind: 'player' | 'qiji' | 'boss';
  readonly id: string;
}

/* ================================================================== *
 * 状态构造
 * ================================================================== */

/**
 * 光标从**当前选择**出发（进入界面时两者一致）。
 *
 * ⚠️ 用"当前选择"而不是各自列表的第 0 项：玩家上次选了第 7 个 Boss，
 * 回来时光标就该落在第 7 个上。
 *
 * ⚠️ 炁机行没有"当前选择"这种东西（它是一个集合），所以光标从**第一条**
 * 炁机出发 —— 由 `qiji[0]` 的 id 决定；列表为空时给空串（`cursorTarget`
 * 会因此返回 undefined，不会指向一张不存在的卡）。
 */
export function cursorFromSelection(
  sel: { readonly playerId: string; readonly bossId: string },
  qiji: readonly PrepareOption[] = [],
): PrepareCursor {
  return {
    playerId: sel.playerId,
    bossId: sel.bossId,
    qijiId: qiji[0]?.id ?? '',
  };
}

/** 进入界面时的完整选择（光标与选择重合）。 */
export function initialSelection(
  current: { readonly playerId: string; readonly bossId: string },
  qiji: readonly PrepareOption[] = [],
): PrepareSelection {
  return {
    playerId: current.playerId,
    bossId: current.bossId,
    focus: 'player',
    cursor: cursorFromSelection(current, qiji),
  };
}

/* ================================================================== *
 * 槽位与列表
 * ================================================================== */

/** 某个槽位里选项的 id 列表（`start` 槽位没有选项）。 */
function optionsOf(
  focus: PrepareFocus,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  qiji: readonly PrepareOption[],
): readonly PrepareOption[] {
  if (focus === 'player') return players;
  if (focus === 'boss') return bosses;
  if (focus === 'qiji') return qiji;
  return [];
}

/** 槽位里"光标停在哪个 id 上"的那个字段。 */
function cursorIdOf(focus: PrepareFocus, sel: PrepareSelection): string {
  if (focus === 'player') return sel.cursor.playerId;
  if (focus === 'boss') return sel.cursor.bossId;
  return sel.cursor.qijiId;
}

/**
 * 光标此刻停在哪一项（槽位与 id）。
 *
 * ⚠️ 返回 `undefined` 的三种情况都要保留：焦点在「开始」上（它不是选项）、
 * 那一行**是空的**（没有卡可指）、列表里找不到那个 id 且列表也空。
 */
export function cursorTarget(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  qiji: readonly PrepareOption[] = [],
): PrepareTarget | undefined {
  if (sel.focus === 'start') return undefined;
  const list = optionsOf(sel.focus, players, bosses, qiji);
  if (list.length === 0) return undefined;
  const id = cursorIdOf(sel.focus, sel);
  const entry = list.find((e) => e.id === id) ?? list[0];
  if (entry === undefined) return undefined;
  return { kind: sel.focus, id: entry.id };
}

/**
 * 同槽位内移动**光标**。**到边界停住，不环绕**。
 *
 * ⚠️ 这个函数**不碰** `playerId` / `bossId` —— 移动光标不等于确定选择。
 *
 * ⚠️ 不环绕是有意的：只有一两个选项时，环绕会让"按一下方向键画面没变"
 * （它绕回自己），玩家会以为按键没生效。
 *
 * ⚠️ 光标**从已选中的那一项**出发会产生"按一下方向键，光标跳回去又回来"，
 * 所以这里始终从**光标自己**的位置算下标。
 */
export function cycleCursor(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  delta: number,
  qiji: readonly PrepareOption[] = [],
): PrepareSelection {
  const at = cursorTarget(sel, players, bosses, qiji);
  if (at === undefined) return sel;
  const list = optionsOf(at.kind, players, bosses, qiji);
  const idx = Math.max(0, list.findIndex((e) => e.id === at.id));
  const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))];
  if (next === undefined || next.id === at.id) return sel;
  return at.kind === 'player'
    ? { ...sel, cursor: { ...sel.cursor, playerId: next.id } }
    : at.kind === 'boss'
      ? { ...sel, cursor: { ...sel.cursor, bossId: next.id } }
      : { ...sel, cursor: { ...sel.cursor, qijiId: next.id } };
}

/**
 * 光标上下换槽位：人物 → 炁机 → 对手 → 开始。
 *
 * ⚠️ 炁机排在人物**之后、对手之前**：它是"选了人物之后"的动作
 * （需求原文："选了人之后，可以激活任意个他的炁机"），所以紧贴人物；
 * 而对手是另一件事（打谁），排在后面。
 *
 * `wrap` 为假（方向键）：两端**停住** —— 与槽位内一致，避免"按了没反应"。
 * `wrap` 为真（Tab / Shift+Tab）：**环绕**（Tab 的通用语义就是循环）。
 *
 * ⚠️ 没有选项的槽位会被跳过（`canFocus`）：否则 Tab 会把光标送进一个
 * 空槽位，那里既没有卡片可高亮、按 Enter 也没有意义。
 */
export function moveFocus(
  sel: PrepareSelection,
  delta: number,
  options: {
    readonly wrap?: boolean;
    readonly players?: readonly PrepareOption[];
    readonly bosses?: readonly PrepareOption[];
    readonly qiji?: readonly PrepareOption[];
  } = {},
): PrepareSelection {
  const players = options.players ?? [];
  const bosses = options.bosses ?? [];
  const qiji = options.qiji ?? [];
  const order: readonly PrepareFocus[] = ['player', 'qiji', 'boss', 'start'];
  const canFocus = (f: PrepareFocus): boolean =>
    f === 'start' || optionsOf(f, players, bosses, qiji).length > 0;
  const step = delta >= 0 ? 1 : -1;
  const from = Math.max(0, order.indexOf(sel.focus));

  if (options.wrap === true) {
    for (let i = 1; i <= order.length; i += 1) {
      const idx = (from + step * i + order.length) % order.length;
      const candidate = order[idx];
      if (candidate !== undefined && canFocus(candidate)) return { ...sel, focus: candidate };
    }
    return sel;
  }

  for (let idx = from + step; idx >= 0 && idx < order.length; idx += step) {
    const candidate = order[idx];
    if (candidate !== undefined && canFocus(candidate)) return { ...sel, focus: candidate };
  }
  return sel;
}

/**
 * 直接指定焦点槽位（调试入口用；`focusSlot` 的实现）。
 *
 * ⚠️ 与 `moveFocus` 的区别是"一步到位"而不是"相对移动"：截图脚本要
 * 把画面推到"光标在这一行、选择在另一行"的状态，省掉"按几次方向键"。
 * ⚠️ 仍然**跳过空槽位**（与 `moveFocus` 同一条判据）：否则会造出
 * "焦点在一个没有卡片的行上"这种正常操作到不了的状态。
 */
export function focusTarget(
  sel: PrepareSelection,
  slot: PrepareFocus,
  options: {
    readonly players?: readonly PrepareOption[];
    readonly bosses?: readonly PrepareOption[];
    readonly qiji?: readonly PrepareOption[];
  } = {},
): PrepareSelection {
  const players = options.players ?? [];
  const bosses = options.bosses ?? [];
  const qiji = options.qiji ?? [];
  if (slot !== 'start' && optionsOf(slot, players, bosses, qiji).length === 0) return sel;
  /**
   * ⚠️ 进炁机行时把光标**摆到第一条上**（若它还指着空串）：否则
   * "焦点进了炁机行，但光标指着一个不存在的 id"，画面上一张卡都不高亮。
   */
  if (slot === 'qiji' && qiji.length > 0 && !qiji.some((q) => q.id === sel.cursor.qijiId)) {
    return { ...sel, focus: slot, cursor: { ...sel.cursor, qijiId: qiji[0]!.id } };
  }
  if (slot === sel.focus) return sel;
  return { ...sel, focus: slot };
}

/**
 * 确定（Enter）：把**光标处**的选项写进选择。
 *
 * - 光标在人物 / 对手卡上 → 把那一项确定为上场单位
 * - 光标在炁机卡上 → **不改选择**（炁机的改动走 `cycleQijiStack`，
 *   由调用方把它落到 `freeQiji` 层数表上）
 * - 光标在「开始战斗」上 → 什么都不做，返回**同一个对象**
 *   （调用方据此知道"这一下交给 `start()` 去处理"）
 *
 * ⚠️ 没有变化时返回同一个对象（而不是新造一个）：调用方用 `next === sel`
 * 判断"要不要重画 / 要不要通知 onChange"。
 */
export function confirmCursor(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  qiji: readonly PrepareOption[] = [],
): PrepareSelection {
  const at = cursorTarget(sel, players, bosses, qiji);
  if (at === undefined) return sel;
  /** 炁机不是"选择"（它是一个集合）—— 见文件头。 */
  if (at.kind === 'qiji') return sel;
  const current = at.kind === 'player' ? sel.playerId : sel.bossId;
  if (current === at.id) return sel;
  return at.kind === 'player' ? { ...sel, playerId: at.id } : { ...sel, bossId: at.id };
}

/**
 * 选中某个人物 / 对手（**鼠标 / 触屏点卡片**，一步到位）。
 *
 * ⚠️ 点击 = **移光标 + 确定**（两步合一）。理由：备战界面不是危险操作，
 * 而且需求要"点击 = 秒选"的顺手感；更关键的是**键盘与触屏功能对等**
 * （AGENTS.md §3b）——键盘按 Enter 能确定，触屏就必须有一次点击能确定。
 *
 * ⚠️ 列表里没有这个 id 就**忽略**（不写进选择）：否则 `current` 会指向一个
 * 不存在的单位，起战斗时拿到空的配置。
 */
export function pickOption(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  kind: 'player' | 'boss',
  id: string,
): PrepareSelection {
  const list = kind === 'player' ? players : bosses;
  if (!list.some((e) => e.id === id)) return sel;
  const same =
    kind === 'player'
      ? sel.playerId === id && sel.focus === 'player' && sel.cursor.playerId === id
      : sel.bossId === id && sel.focus === 'boss' && sel.cursor.bossId === id;
  if (same) return sel;
  return kind === 'player'
    ? { ...sel, playerId: id, focus: 'player', cursor: { ...sel.cursor, playerId: id } }
    : { ...sel, bossId: id, focus: 'boss', cursor: { ...sel.cursor, bossId: id } };
}

/** 把光标移到某张炁机卡上（点它 / 悬停它）。 */
export function pickQiji(
  sel: PrepareSelection,
  qiji: readonly PrepareOption[],
  id: string,
): PrepareSelection {
  if (!qiji.some((e) => e.id === id)) return sel;
  if (sel.focus === 'qiji' && sel.cursor.qijiId === id) return sel;
  return { ...sel, focus: 'qiji', cursor: { ...sel.cursor, qijiId: id } };
}

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

/* ================================================================== *
 * 能否开战
 * ================================================================== */

/**
 * 这个选择**能不能开战**。
 *
 * 需求："之前没开发的角色和 boss，你可以先把相关文件创建，相关资源导入，
 * 备战界面里灰掉，写开发中" + "不能开始战斗（选中它们时点开始应当无效，
 * 或给明确反馈）"。
 *
 * ⚠️ 判据由**调用方注入**（生产路径传 `data/roster.ts` 的 `isDeveloping`），
 * 而不是在这里 import 那张名单：名单会随着"做完一个 Boss"变短，
 * 这条规则不该跟着改（它只管"名单说不能就不能"）。
 *
 * ⚠️ **炁机不参与这条判定**：它是可选强化，不是出战单位 —— 一条都没开
 * 也照样能开战（自由模式本来就是"随便配着玩"）。
 */
export function canStartBattle(
  sel: PrepareSelection,
  developing: (id: string) => boolean,
): boolean {
  return !developing(sel.playerId) && !developing(sel.bossId);
}

/* ================================================================== *
 * 命中测试
 * ================================================================== */

/**
 * 点在哪一项上（逻辑坐标）。
 *
 * ⚠️ 几何来自 `prepareLayout.prepareHitAreas`（**与渲染共用同一份**）——
 * 两处各算一遍必然在改布局时错位，而错位的表现是"点击位置和看到的卡片
 * 对不上"。
 *
 * ⚠️ 顺序即优先级：`start` 会**先**被问（它不是卡片，是一颗按钮，
 * 而按钮叠在整屏之上），然后才轮到卡片。
 * ⚠️ **同一次点击只返回一项**（命中即返回）：继续往下找会同时点中底下的卡。
 */
export function hitTestPrepare(
  px: number,
  py: number,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  qiji: readonly PrepareOption[] = [],
): { readonly kind: 'player' | 'qiji' | 'boss' | 'start'; readonly id: string } | undefined {
  const areas = prepareHitAreas(players, bosses, qiji);
  /** 按钮优先（见上）。 */
  const start = areas.find((a) => a.kind === 'start');
  if (start !== undefined && inRect(px, py, start)) return { kind: 'start', id: start.id };
  for (const area of areas) {
    if (area.kind === 'start') continue;
    if (inRect(px, py, area)) return { kind: area.kind, id: area.id };
  }
  return undefined;
}

function inRect(
  px: number,
  py: number,
  r: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/**
 * 一次点击落在卡片的**哪一半**（炁机卡的"加一层 / 退一层"）。
 *
 * ⚠️ 触屏没有 hover、也没有 Shift（AGENTS.md §3b 的功能对等）：所以
 * "退一层"必须有**纯指针**的入口。按横向中线分：
 *
 *   - 右半 → 加一层（与 Enter 同义，也是绝大多数点击会发生的那一半）
 *   - 左半 → 退一层（与 Shift+Enter 同义）
 *
 * ⚠️ 左半正是"头像 / 图标"那一侧 —— 而炁机卡上画的正是图标，
 * 所以这个划分在**触屏**上也看得出来（不是一条看不见的分界线）。
 */
export function halfOfCard(
  px: number,
  card: { readonly x: number; readonly w: number },
): 'left' | 'right' {
  return px < card.x + card.w / 2 ? 'left' : 'right';
}
