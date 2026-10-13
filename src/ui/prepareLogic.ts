/**
 * **自由模式（备战屏）的光标 / 选择 / 炁机激活**（纯逻辑，可在 node 里测）。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏的**状态机**：方向键怎么走、Enter 确定什么、点击落在哪一项、
 * 炁机怎么开 / 关 —— 一行 Pixi 都不碰（几何在 `prepareLayout.ts`，
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
 *   - 炁机**一次点击 / 一次 Enter = 开或关**（没有层，见下）
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
 * 而"开还是关"（切换）在 **`ui/freeQiji.ts`** —— 那是纯数据，与
 * "光标停在哪一条"（本文件）没有交集，所以 §3 的横向切割把它挪走了。
 * 本文件只留下"炁机这一块的**光标**怎么走"。
 *
 * ⚠️ **激活是开关，没有层数**（用户 2026-10-13 明确纠正）—— 那张卡
 * **整张可点**，一次点击 = 开 / 关。上一版把它劈成"左半减一层 / 右半加
 * 一层"，0 层时点左半**什么都不做**（正是用户报的"点了能选中但不能
 * 激活"）。判据与来龙去脉写在 `ui/freeQiji.ts` 的文件头。
 */

import type { PrepareFocus, PrepareOption, PrepareSectionKind } from './prepareTypes';
import {
  NO_SCROLL,
  prepareHitAreas,
  sectionColumns,
  type SectionScroll,
} from './prepareGeometry';
import { stepGrid, type GridDirection } from './gridNav';

export type { PrepareFocus, PrepareOption, PrepareSectionKind } from './prepareTypes';
export type { PrepareHitArea, PrepareHitKind } from './prepareLayout';
/**
 * ⚠️ **转发**命中几何（而不是让每个消费者自己去 `./prepareLayout` 取）：
 * `prepareLogic` 是"备战屏的规则"这一层，而"点在哪一项上"是它的一部分
 * （`hitTestPrepare` 就用它）。转发之后消费者只有**一个**入口，
 * 而几何本身仍然只有 `prepareLayout` 那一份实现。
 */
/**
 * ⚠️ **转发炁机开关那一套**（实现在 `./freeQiji`）：
 * 它在 §3 的横向切割里搬走了，而调用方（`app/` 与既有测试）**一行都
 * 不该改** —— 拆文件不该改 import 路径（那是纯噪音）。这里只是通道，
 * 实现只有那一份。
 */
export {
  freeQijiChoices,
  isQijiOn,
  toggleQiji,
  type FreeQiji,
} from './freeQiji';

export {
  cardGrid,
  NO_SCROLL,
  prepareHitAreas,
  prepareLabelY,
  rowTopsOf,
  sectionBlockH,
  sectionColumns,
  sectionMaxScroll,
  sectionRowStep,
  sectionScrollbar,
  sectionStackH,
  sectionsBottom,
  sectionViewport,
  sectionViewportH,
  sectionViewportRows,
  startRect,
  type SectionScroll,
} from './prepareGeometry';

/**
 * 光标在各槽位里停的那个选项。
 *
 * ⚠️ 每个槽位**各自记一份**：光标往上/往下走一趟再回来时，应该回到
 * 原来那一格，而不是被重置到"已选中的那个"（那会让"我只是路过"变成
 * "我的光标被偷走了"）。
 *
 * ⚠️ `qijiId` 与 `playerId` / `bossId` 不同：它**不是选择**，而是
 * "光标停在炁机行的哪一张卡上" —— 炁机的"选择"是激活集合（`freeQiji`），
 * 光标只是键盘用来挑"现在切哪一条"的。
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
  /**
   * **手风琴里展开的那一块**（用户 2026-10-13："同一时间只展开 3 个选择中
   * 的一个，其他的收起来"）。
   *
   * ⚠️ 它**不是**第二个"焦点"：判据只有一条 —— **焦点在哪一块，就展开
   * 哪一块**（`focus` 是三块之一时两者相等）。它之所以要存下来，是因为
   * 焦点会走到「开始战斗」上，而那时**上一块仍然要展开**（总不能三块
   * 全收起来，玩家就看不见卡片了）。所以：
   *
   * ```
   *   focus 是某一块  →  expanded === focus（同一个动作里一起写）
   *   focus === 'start' → expanded 保持上一块不变
   * ```
   *
   * ⚠️ 不许在别处再存一个"当前展开块"（那就成了第二份真相：两处一漂，
   * 画面展开的是 A、焦点却在 B）。
   */
  readonly expanded: PrepareSectionKind;
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
    /** ⚠️ 进场时人物那一块是展开的（焦点就在它上面）。 */
    expanded: 'player',
    cursor: cursorFromSelection(current, qiji),
  };
}

/**
 * 换**焦点**，并顺带把手风琴的"展开块"跟上去。
 *
 * ⚠️ 这是这条规则**唯一**的实现（`moveFocus` / `focusTarget` / `pickOption`
 * / `pickQiji` 全走它）：焦点落在某一块上就展开那一块；落在「开始战斗」上
 * 时展开块**不动**（见 `PrepareSelection.expanded`）。
 */
function withFocus(sel: PrepareSelection, focus: PrepareFocus): PrepareSelection {
  const expanded: PrepareSectionKind = focus === 'start' ? sel.expanded : focus;
  if (focus === sel.focus && expanded === sel.expanded) return sel;
  return { ...sel, focus, expanded };
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
 *
 * ⚠️ `delta` 是**线性**的 ±1：它对应 ← →（同一行内），也对应
 * `stepCursor` 里"非炁机块"的 ↑ ↓ —— 那些块只有一行，上下本来就是
 * "没有下一行"。而炁机那一块是**两行**，所以它的 ↑ ↓ 走 `gridNav.stepGrid`
 * （见 `stepCursor`）。
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
 * 方向键：在**当前这一块内部**移动光标（← → ↑ ↓）。
 *
 * ==================================================================
 * ⚠️⚠️ 2026-10-13 第三轮：这是"炁机内部无法用方向键选择"的**修法**
 * ==================================================================
 *
 * 用户原话："炁机内部无法用方向键选择，所以把人物 炁机 对手的切换换成 tab"。
 *
 * 旧版的 ↑ ↓ **不是"块内导航"而是"换块"**（`moveFocus`），于是：
 *
 * ```
 *   炁机摊成 2 行（今天 8 条 → 5 + 3）
 *   ← →  在"第一行 / 第二行"里走，走到行尾**没反应**（不环绕）
 *   ↑ ↓  直接从炁机块跳到人物块 / 对手块      ← 到不了第二行（这是 bug）
 * ```
 *
 * 结果是**炁机块里有一半的卡（第二行）永远选不到**，而"能选到第一行"
 * 又会在行尾看起来像卡住了。两件事叠起来就是用户看到的那句
 * "炁机内部无法用方向键选择"。
 *
 * 修法：
 *
 * ```
 *   块【内】的导航 = 方向键（本函数）：← → 行内、↑ ↓ 同列换行
 *   块【间】的切换 = Tab / Shift+Tab（`moveFocus`，唯一的路）
 * ```
 *
 * ⚠️ 非炁机的两块是**一行**，所以它们的 ↑ ↓ 退化成"没有下一行"（返回原
 * 对象）—— 这正是"块内导航"的应有语义：**在边界停住，不跨块**。
 *
 * @param dir ← → ↑ ↓。
 */
export function stepCursor(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  dir: GridDirection,
  qiji: readonly PrepareOption[] = [],
): PrepareSelection {
  const at = cursorTarget(sel, players, bosses, qiji);
  if (at === undefined) return sel;
  const horizontal: GridDirection = dir === 'left' ? 'left' : dir === 'right' ? 'right' : dir;
  if (at.kind !== 'qiji') {
    /**
     * ⚠️ 人物 / 对手只有一行：← → 线性走，↑ ↓ **不动**（到边界停住）。
     * 走 `cycleCursor` 而不是自己算下标 —— "一维里的 ±1"它已经有一份了。
     */
    const delta = horizontal === 'left' ? -1 : horizontal === 'right' ? 1 : 0;
    if (delta === 0) return sel;
    return cycleCursor(sel, players, bosses, delta, qiji);
  }
  const list = qiji;
  const idx = Math.max(0, list.findIndex((e) => e.id === at.id));
  const next = stepGrid(idx, dir, { count: list.length, columns: sectionColumns('qiji') });
  const entry = list[next];
  if (entry === undefined || entry.id === at.id) return sel;
  return { ...sel, cursor: { ...sel.cursor, qijiId: entry.id } };
}

/**
 * **块与块之间**换焦点：人物 → 炁机 → 对手 → 开始。
 *
 * ==================================================================
 * ⚠️⚠️ 2026-10-13 第三轮：它现在是 **Tab / Shift+Tab 专用**
 * ==================================================================
 *
 * 用户原话："**炁机内部无法用方向键选择，所以把人物 炁机 对手的切换换成
 * tab**"。
 *
 * 旧版 ↑ ↓ 也走这个函数（`wrap = false`，"到两端停住"），于是"换块"与
 * "块内导航"抢同一个键 —— 而块内一旦是**两行**（炁机今天 5+3），
 * ↑ ↓ 就永远到不了第二行。现在分工是**互斥**的：
 *
 * ```
 *   块【间】= Tab / Shift+Tab（本函数，永远环绕）
 *   块【内】= ← → ↑ ↓（`stepCursor`，永远不跨块）
 * ```
 *
 * ⚠️ `wrap` 参数**保留**是因为它表达的是调用方的意图（Tab 环绕），
 * 而"环绕"是 Tab 的通用语义：在「开始战斗」上按 Tab 应该回到第一块，
 * 而不是毫无反应（那正是"以为按键坏了"的形状）。
 *
 * ⚠️ 炁机排在人物**之后、对手之前**：它是"选了人物之后"的动作
 * （需求原文："选了人之后，可以激活任意个他的炁机"），所以紧贴人物；
 * 而对手是另一件事（打谁），排在后面。
 *
 * ⚠️ 没有选项的槽位会被跳过（`canFocus`）：否则 Tab 会把光标送进一个
 * 空槽位，那里既没有卡片可高亮、按 Enter 也没有意义。
 *
 * ⚠️ **它不移动块内的光标**：焦点换了块，块内光标停在它自己上次的位置
 * （`PrepareCursor` 每个槽位各记一份）—— 这正是"路过一趟回来还在原处"。
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
      if (candidate !== undefined && canFocus(candidate)) return withFocus(sel, candidate);
    }
    return sel;
  }

  for (let idx = from + step; idx >= 0 && idx < order.length; idx += step) {
    const candidate = order[idx];
    if (candidate !== undefined && canFocus(candidate)) return withFocus(sel, candidate);
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
    return withFocus({ ...sel, cursor: { ...sel.cursor, qijiId: qiji[0]!.id } }, slot);
  }
  return withFocus(sel, slot);
}

/**
 * 这个字符串是不是一个**块**（`'player' | 'qiji' | 'boss'`）。
 *
 * ⚠️ 用途只有一个：点「块头」时命中区给的是 `{ kind: 'summary', id: <槽位> }`，
 * 而 `id` 的类型是 `string`。**类型守卫**（而不是 `as PrepareSectionKind`）
 * 让"命中区给了一个不是槽位的 id"这件事在编译期就不成立
 * （AGENTS.md §1：不许用断言把类型问题按下去）。
 */
export function isSectionKind(id: string): id is PrepareSectionKind {
  return id === 'player' || id === 'qiji' || id === 'boss';
}

/**
 * **展开某一块**（收起态那块「块头」被点/被敲时走它）。
 *
 * ⚠️ 它与"点卡片"是**两件事**：点块头**只**换焦点（于是那一块展开），
 * **不改选择**（块头显示的正是"当前选了什么"，点它不该把它改掉）。
 * 触屏靠它才能展开收起的块（AGENTS.md §3b 的功能对等）。
 *
 * ⚠️ 光标**跟着**焦点走：展开之后"光标停在这一块里"，详情区于是立刻
 * 显示这一块当前那一项（与点卡片同一条体验）。
 */
export function expandSection(
  sel: PrepareSelection,
  slot: PrepareSectionKind,
): PrepareSelection {
  return withFocus(sel, slot);
}

/**
 * 确定（Enter）：把**光标处**的选项写进选择。
 *
 * - 光标在人物 / 对手卡上 → 把那一项确定为上场单位
 * - 光标在炁机卡上 → **不改选择**（炁机的改动走 `toggleQiji`，
 *   由调用方把它落到激活集合上）
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
    ? withFocus({ ...sel, playerId: id, cursor: { ...sel.cursor, playerId: id } }, 'player')
    : withFocus({ ...sel, bossId: id, cursor: { ...sel.cursor, bossId: id } }, 'boss');
}

/** 把光标移到某张炁机卡上（点它 / 悬停它）。 */
export function pickQiji(
  sel: PrepareSelection,
  qiji: readonly PrepareOption[],
  id: string,
): PrepareSelection {
  if (!qiji.some((e) => e.id === id)) return sel;
  if (sel.focus === 'qiji' && sel.cursor.qijiId === id) return sel;
  return withFocus({ ...sel, cursor: { ...sel.cursor, qijiId: id } }, 'qiji');
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
 * 而按钮叠在整屏之上），然后才轮到卡片与**收起态的块头**
 * （`kind === 'summary'`，点它 = 展开那一块，见 `expandSection`）。
 *
 * ⚠️ **同一次点击只返回一项**（命中即返回）：继续往下找会同时点中底下的卡。
 * ⚠️ 收起的那两块**只有块头**在命中区里 —— 它们的卡片不画、也点不到
 * （不会出现"看不见却能点中的幽灵卡片"）。
 *
 * ⚠️ **滚动状态要一起传进来**（第三个参数是 `scroll`）：滚过之后卡片的
 * y 变了，命中区必须与画面上那一份**逐像素相同** —— 各算一遍偏移的话，
 * "点到的卡"与"看到的卡"会差正好一个滚动量（而那看起来像"点击乱跳"）。
 */
export function hitTestPrepare(
  px: number,
  py: number,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  qiji: readonly PrepareOption[] = [],
  expanded: PrepareSectionKind = 'player',
  scroll: SectionScroll = NO_SCROLL,
): { readonly kind: 'player' | 'qiji' | 'boss' | 'start' | 'summary'; readonly id: string } | undefined {
  const intent = pointerIntentOf(px, py, players, bosses, qiji, expanded, scroll);
  if (intent.kind === 'none') return undefined;
  if (intent.kind === 'start') return { kind: 'start', id: 'start' };
  if (intent.kind === 'expand') return { kind: 'summary', id: intent.slot };
  return { kind: intent.kind === 'qiji' ? 'qiji' : intent.option, id: intent.id };
}

/**
 * 一次点击的**意图**（纯数据：屏幕照它改状态，不再自己判一遍"点了什么"）。
 *
 * ==================================================================
 * 为什么单独一个类型（而不是让屏幕直接改状态）
 * ==================================================================
 *
 * `PrepareScreen.hitTest` 里原来是一串 `if (at.kind === …)`：先点按钮、
 * 再点块头、再点炁机的左/右半边、最后是人物的确定 —— 四件事挤在一个
 * Pixi 类里，**只能靠截图看对不对**（而"点炁机左半边是退一层"这件事
 * 截图上根本看不出来）。
 *
 * 抽成意图之后：
 *   - 判定在 node 里可以精确测（`tests/unit/prepareLogic.test.ts`）
 *   - 屏幕那一层只剩一个 `switch`（谁改状态仍然只有一处）
 *
 * ⚠️ `qiji` 那一支**不含"左半 / 右半"**：激活是开关，**整张卡**只有
 * 一种含义（一次点击 = 切一次）。上一版的左/右半边分裂见
 * `ui/freeQiji.ts` 的文件头（用户报的"点了不能激活"就是它）。
 */
export type PreparePointerIntent =
  /** 没点中任何东西（调用方据此"不消费这次点击"）。 */
  | { readonly kind: 'none' }
  /** 点「开始战斗」。 */
  | { readonly kind: 'start' }
  /** 点收起的**块头** → 只展开那一块（不改选择）。 */
  | { readonly kind: 'expand'; readonly slot: PrepareSectionKind }
  /** 点炁机卡的**任意位置** → 开 / 关它（整张卡一个含义）。 */
  | { readonly kind: 'qiji'; readonly id: string }
  /** 点人物 / 对手卡 → 移光标 + 确定（一步到位）。 */
  | { readonly kind: 'pick'; readonly option: 'player' | 'boss'; readonly id: string };

/**
 * 这个逻辑点上的点击**是什么意思**。
 *
 * ⚠️ 几何来自 `prepareHitAreas`（与渲染**同一份**，含滚动偏移）——
 * 这里不自己算任何矩形。
 * ⚠️ 顺序即优先级（按钮 → 块头 → 卡片），而且**命中即返回**：继续往下
 * 找会同时点中底下的卡。
 */
export function pointerIntentOf(
  px: number,
  py: number,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  qiji: readonly PrepareOption[] = [],
  expanded: PrepareSectionKind = 'player',
  scroll: SectionScroll = NO_SCROLL,
): PreparePointerIntent {
  const areas = prepareHitAreas(players, bosses, qiji, expanded, scroll);
  const hit = areas.find((a) => inRect(px, py, a));
  if (hit === undefined) return { kind: 'none' };
  if (hit.kind === 'start') return { kind: 'start' };
  if (hit.kind === 'summary') {
    return isSectionKind(hit.id) ? { kind: 'expand', slot: hit.id } : { kind: 'none' };
  }
  if (hit.kind === 'qiji') {
    /** ⚠️ 整张卡一个含义（哪一半都一样）—— 见 `PreparePointerIntent` 的说明。 */
    return { kind: 'qiji', id: hit.id };
  }
  return { kind: 'pick', option: hit.kind, id: hit.id };
}

function inRect(
  px: number,
  py: number,
  r: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
