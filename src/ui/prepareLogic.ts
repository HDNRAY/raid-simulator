/**
 * **备战界面的纯逻辑**：光标 / 选择状态 + 命中区域。
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
 *   - 命中测试落在哪张卡片 / 开始键
 *
 * ⚠️ 命中区域也在这里算（渲染与测试**共用同一份几何**）—— 两处各算一遍
 * 必然在改布局时错位，而错位的表现是"点击位置和看到的卡片对不上"。
 *
 * ==================================================================
 * ⚠️ 光标（cursor）与选择（selection）是**两个独立概念**
 * ==================================================================
 *
 * 需求（用户）："选中 和 目前光标 目前颜色是一样的" +
 * "用 enter 来确定选择，而不是靠移动到下一项"。
 *
 * 改之前两者是**同一个东西**：焦点落在哪一格，哪一格就变金色 ——
 * 玩家分不出"我的光标现在停在哪"与"我实际选了谁"。现在：
 *
 *   - `cursor`：光标停在哪一项。方向键 / Tab **只动它**
 *   - `playerId` / `bossId`：**按 Enter 确定下来**的那个，才是会上场的
 *
 * 两者可以任意分离（光标在 B、选择还是 A），所以状态必须分开存 ——
 * 这正是"移动光标不改选择"在类型上的落点。
 *
 * ⚠️ 别把两者合并回一个字段：合并之后"按 Enter 确定"就没有可表达的状态
 * 了，只能退化成"移动即确定"（就是这次要修的那个毛病）。
 */

/** 焦点所在的槽位。 */
export type PrepareFocus = 'player' | 'boss' | 'start';

/**
 * 光标在各槽位里停的那个选项。
 *
 * ⚠️ 每个槽位**各自记一份**：光标往上/往下走一趟再回来时，应该回到
 * 原来那一格，而不是被重置到"已选中的那个"（那会让"我只是路过"变成
 * "我的光标被偷走了"）。
 *
 * `playerId` / `bossId` 与卡片名同名，但语义是"**光标**所在项"——
 * 不叫 `cursor` 而叫 `playerId` 是因为渲染层用它和选择比对来画两种态。
 */
export interface PrepareCursor {
  readonly playerId: string;
  readonly bossId: string;
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

/** 可选项（只要 id —— 显示名由渲染层按 i18n 取）。 */
export interface PrepareOption {
  readonly id: string;
}

/** 一块可点区域。 */
export interface PrepareHitArea {
  readonly kind: 'player' | 'boss' | 'start';
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PrepareLayout {
  readonly width: number;
  readonly height: number;
  readonly pad: number;
  readonly playerRowY: number;
  readonly bossRowY: number;
  readonly cardH: number;
  readonly cardGap: number;
  readonly cardMaxW: number;
  readonly startW: number;
  readonly startH: number;
  readonly startY: number;
}

/** 默认布局（逻辑坐标系，960×540）。 */
export const PREPARE_LAYOUT: PrepareLayout = {
  width: 960,
  height: 540,
  pad: 40,
  playerRowY: 150,
  bossRowY: 300,
  cardH: 96,
  cardGap: 16,
  cardMaxW: 360,
  startW: 200,
  startH: 44,
  startY: 430,
};

function cardRect(
  index: number,
  count: number,
  topY: number,
  L: PrepareLayout,
): { x: number; y: number; w: number; h: number } {
  /**
   * ⚠️ 卡片等分可用宽度并**居中**：目前每行只有 1 张，写死宽度会在加第二个
   * 人物时立刻显得歪。
   */
  const usable = L.width - L.pad * 2;
  const w = Math.min(L.cardMaxW, Math.floor((usable - L.cardGap * (count - 1)) / Math.max(1, count)));
  const totalW = w * count + L.cardGap * (count - 1);
  const x0 = Math.round((L.width - totalW) / 2);
  return { x: x0 + index * (w + L.cardGap), y: topY, w, h: L.cardH };
}

/** 当前布局下的可点区域（渲染与命中测试**共用**）。 */
export function prepareHitAreas(
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  L: PrepareLayout = PREPARE_LAYOUT,
): readonly PrepareHitArea[] {
  return [
    ...players.map((p, i) => ({
      kind: 'player' as const,
      id: p.id,
      ...cardRect(i, players.length, L.playerRowY, L),
    })),
    ...bosses.map((b, i) => ({
      kind: 'boss' as const,
      id: b.id,
      ...cardRect(i, bosses.length, L.bossRowY, L),
    })),
    {
      kind: 'start' as const,
      id: 'start',
      x: Math.round((L.width - L.startW) / 2),
      y: L.startY,
      w: L.startW,
      h: L.startH,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 选择状态
 * ------------------------------------------------------------------ */

/**
 * 光标从**当前选择**出发（进入界面时两者一致）。
 *
 * ⚠️ 用"当前选择"而不是各自列表的第 0 项：玩家上次选了第 7 个 Boss，
 * 回来时光标就该落在第 7 个上。
 */
export function cursorFromSelection(sel: {
  readonly playerId: string;
  readonly bossId: string;
}): PrepareCursor {
  return { playerId: sel.playerId, bossId: sel.bossId };
}

/** 某个槽位里选项的 id 列表（`start` 槽位没有选项）。 */
function optionsOf(
  focus: PrepareFocus,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
): readonly PrepareOption[] {
  if (focus === 'player') return players;
  if (focus === 'boss') return bosses;
  return [];
}

/** 光标此刻停在哪一项（槽位与 id）。 */
export function cursorTarget(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
): { readonly kind: 'player' | 'boss'; readonly id: string } | undefined {
  if (sel.focus === 'start') return undefined;
  const list = optionsOf(sel.focus, players, bosses);
  if (list.length === 0) return undefined;
  const id = sel.focus === 'player' ? sel.cursor.playerId : sel.cursor.bossId;
  const entry = list.find((e) => e.id === id) ?? list[0];
  if (entry === undefined) return undefined;
  return { kind: sel.focus, id: entry.id };
}

/**
 * 同槽位内移动**光标**。**到边界停住，不环绕**。
 *
 * ⚠️ 这个函数**不碰** `playerId` / `bossId` —— 移动光标不等于确定选择。
 * 需求原话："用 enter 来确定选择，而不是靠移动到下一项"。
 *
 * ⚠️ 不环绕是有意的：只有一两个选项时，环绕会让"按一下方向键画面没变"
 * （它绕回自己），玩家会以为按键没生效。
 *
 * ⚠️ 光标**不从已选中的那一项**出发，而是从**光标自己**的位置出发：
 * 光标在 B、选择是 A 时，再按一下 → 应该到 C，而不是从 A 跳到 B。
 * 旧的 `cycleSelection` 用的是"已选中项"，在两者分离之后那会变成
 * "按一下方向键，光标跳回去又回来"。
 */
export function cycleCursor(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  delta: number,
): PrepareSelection {
  const at = cursorTarget(sel, players, bosses);
  if (at === undefined) return sel;
  const list = optionsOf(at.kind, players, bosses);
  const idx = Math.max(0, list.findIndex((e) => e.id === at.id));
  const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))];
  if (next === undefined || next.id === at.id) return sel;
  return at.kind === 'player'
    ? { ...sel, cursor: { ...sel.cursor, playerId: next.id } }
    : { ...sel, cursor: { ...sel.cursor, bossId: next.id } };
}

/**
 * 光标上下换槽位：人物 → 对手 → 开始。
 *
 * `wrap` 为假（方向键）：两端**停住** —— 与槽位内一致，避免"按了没反应"。
 * `wrap` 为真（Tab / Shift+Tab）：**环绕**（Tab 的通用语义就是循环，
 * 而且 Tab 有 `Shift+Tab` 做反向，不存在"分不清方向"的问题）。
 *
 * ⚠️ 没有选项的槽位会被跳过（`canFocus`）：否则 Tab 会把光标送进一个
 * 空槽位，那里既没有卡片可高亮、按 Enter 也没有意义，看起来像"焦点丢了"。
 */
export function moveFocus(
  sel: PrepareSelection,
  delta: number,
  options: {
    readonly wrap?: boolean;
    readonly players?: readonly PrepareOption[];
    readonly bosses?: readonly PrepareOption[];
  } = {},
): PrepareSelection {
  const players = options.players ?? [];
  const bosses = options.bosses ?? [];
  const order: readonly PrepareFocus[] = ['player', 'boss', 'start'];
  const canFocus = (f: PrepareFocus): boolean =>
    f === 'start' || optionsOf(f, players, bosses).length > 0;
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
 * 确定（Enter）：把**光标处**的选项写进选择。
 *
 * - 光标在卡片上 → 把那一项确定为上场单位
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
): PrepareSelection {
  const at = cursorTarget(sel, players, bosses);
  if (at === undefined) return sel;
  const current = at.kind === 'player' ? sel.playerId : sel.bossId;
  if (current === at.id) return sel;
  return at.kind === 'player' ? { ...sel, playerId: at.id } : { ...sel, bossId: at.id };
}

/**
 * 选中某个人物 / 对手（**鼠标 / 触屏点卡片**，一步到位）。
 *
 * ⚠️ 点击 = **移光标 + 确定**（两步合一）。理由：备战界面不是危险操作
 * （与设置页改键不同，那里需要防误触），而且需求要"点击 = 秒选"的顺手感；
 * 更关键的是**键盘与触屏功能对等**（AGENTS.md §3b）——键盘按 Enter 能确定，
 * 触屏就必须有一次点击能确定，否则触屏玩家永远停在"只是移动了光标"。
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
  /**
   * ⚠️ **没有变化时返回同一个对象**（而不是新造一个）：调用方用
   * `next === sel` 判断"要不要重画 / 要不要通知 onChange"。新造对象会让
   * 那个判断永远为真，于是每次点同一张卡片都白重画一次、还多写一次存储。
   */
  const same =
    kind === 'player'
      ? sel.playerId === id && sel.focus === 'player' && sel.cursor.playerId === id
      : sel.bossId === id && sel.focus === 'boss' && sel.cursor.bossId === id;
  if (same) return sel;
  return kind === 'player'
    ? { ...sel, playerId: id, focus: 'player', cursor: { ...sel.cursor, playerId: id } }
    : { ...sel, bossId: id, focus: 'boss', cursor: { ...sel.cursor, bossId: id } };
}

/**
 * 这个选择**能不能开战**。
 *
 * 需求："之前没开发的角色和 boss，你可以先把相关文件创建，相关资源导入，
 * 备战界面里灰掉，写开发中" + "不能开始战斗（选中它们时点开始应当无效，
 * 或给明确反馈）"。
 *
 * ==================================================================
 * 为什么放这里（纯函数）而不是留在界面类里
 * ==================================================================
 *
 * "能不能开战"是**规则**，不是画面：界面只负责把它画成"开始键灰掉 +
 * 提示那两个字"。
 *
 * `PrepareScreen` 要构造 Pixi 对象（jsdom 里跑不动，见文件头），
 * 规则留在类里就只能写"能构造、不报错"的冒烟测试 —— 而那对
 * "选了个开发中的 Boss 结果照样进了战斗"这种 bug 一点用都没有。
 *
 * ⚠️ 判据由**调用方注入**（生产路径传 `data/roster.ts` 的 `isDeveloping`），
 * 而不是在这里 import 那张名单：名单会随着"做完一个 Boss"变短，
 * 这条规则不该跟着改（它只管"名单说不能就不能"）。
 */
export function canStartBattle(
  sel: PrepareSelection,
  developing: (id: string) => boolean,
): boolean {
  return !developing(sel.playerId) && !developing(sel.bossId);
}
