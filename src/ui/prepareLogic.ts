/**
 * **备战界面的纯逻辑**：选择状态 + 命中区域。
 *
 * ==================================================================
 * 为什么把选择逻辑抽出来（而不是留在 `PrepareScreen` 里）
 * ==================================================================
 *
 * `PrepareScreen` 要构造 Pixi 对象，而 Pixi v8 在 jsdom 里不好跑（需要真
 * canvas / WebGL）。逻辑留在类里就只能写"能构造、不报错"这种零信息的
 * 冒烟测试；抽出来之后可以在 node 里精确测：
 *   - 方向键在同槽位里换选项、到边界停住（不环绕）
 *   - 上下换槽位的顺序
 *   - 命中测试落在哪张卡片 / 开始键
 *
 * ⚠️ 命中区域也在这里算（渲染与测试**共用同一份几何**）—— 两处各算一遍
 * 必然在改布局时错位，而错位的表现是"点击位置和看到的卡片对不上"。
 */

/** 焦点所在的槽位。 */
export type PrepareFocus = 'player' | 'boss' | 'start';

/** 备战界面的当前选择。 */
export interface PrepareSelection {
  readonly playerId: string;
  readonly bossId: string;
  readonly focus: PrepareFocus;
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
 * 同槽位内换选项。**到边界停住，不环绕**。
 *
 * ⚠️ 不环绕是有意的：只有一两个选项时，环绕会让"按一下方向键画面没变"
 * （它绕回自己），玩家会以为按键没生效。
 */
export function cycleSelection(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  bosses: readonly PrepareOption[],
  delta: number,
): PrepareSelection {
  if (sel.focus === 'start') return sel;
  const list = sel.focus === 'player' ? players : bosses;
  if (list.length === 0) return sel;
  const currentId = sel.focus === 'player' ? sel.playerId : sel.bossId;
  const idx = Math.max(0, list.findIndex((e) => e.id === currentId));
  const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))];
  if (next === undefined) return sel;
  return sel.focus === 'player' ? { ...sel, playerId: next.id } : { ...sel, bossId: next.id };
}

/** 上下换槽位：人物 → 对手 → 开始（两端停住）。 */
export function moveFocus(sel: PrepareSelection, delta: number): PrepareSelection {
  const order: readonly PrepareFocus[] = ['player', 'boss', 'start'];
  const i = order.indexOf(sel.focus);
  const next = order[Math.min(order.length - 1, Math.max(0, i + delta))];
  return next === undefined ? sel : { ...sel, focus: next };
}

/**
 * 选中某个人物 / 对手。
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
  const same = kind === 'player' ? sel.playerId === id && sel.focus === 'player' : sel.bossId === id && sel.focus === 'boss';
  if (same) return sel;
  return kind === 'player' ? { ...sel, playerId: id, focus: 'player' } : { ...sel, bossId: id, focus: 'boss' };
}
