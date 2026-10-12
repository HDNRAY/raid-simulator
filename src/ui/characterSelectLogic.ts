/**
 * **选角色屏的纯逻辑**：复用备战界面的光标模型，但只有**一行**。
 *
 * ==================================================================
 * 它是什么（用户 2026-10-12 定的流程）
 * ==================================================================
 *
 * 用户原话："有一个**新的首页**……然后进入肉鸽 才是**选角色**。"
 *
 * ```
 * 首页 ─「肉鸽模式」→ 选角色屏（本文件）→ 一局肉鸽
 * ```
 *
 * ⚠️ **选角色屏不是默认入口**：肉鸽那条路还不完整（炁机选择是 P3、
 * 强度曲线是 P4/P5、7 个 Boss 只有 2 个能打）。首页才是安全的正门。
 *
 * ==================================================================
 * 为什么是"薄薄一层"，而不是把备战界面改造成通用的
 * ==================================================================
 *
 * 备战界面的交互模型里已经有两条来之不易的结论（`prepareLogic.ts`
 * 文件头）：**光标（cursor）≠ 选择（selection）**、**点击 = 移光标 + 确定**。
 * 用户明确要求选角色屏"复用同一套"。
 *
 * 两条路可以复用：
 *   (a) 把 `PrepareScreen` 参数化成"几行槽位" —— 设计稿 §3.3 的建议，
 *       但那会**动 `PrepareScreen` 与它的测试**（用户："如果抽公共逻辑会动
 *       `PrepareScreen` 及其测试，先告诉我，别自己扩范围"）
 *   (b) **把备战模型的"Boss 槽位"传空** —— 于是同一批纯函数原样可用
 *
 * 这里走 (b)：`cycleCursor` / `confirmCursor` / `pickOption` / `cursorTarget`
 * 都接受 `bosses` 参数，传 `[]` 就是"只有一行"。
 *
 * ⚠️ 因此本文件**一个 `PrepareScreen` 的字都没改**，备战界面的行为与
 * 测试完全不受影响。
 *
 * ==================================================================
 * ⚠️ `focus` 恒为 `'player'`
 * ==================================================================
 *
 * `PrepareSelection.focus` 的取值是 `'player' | 'boss' | 'start'`。选角色屏
 * **没有 Boss 行、也没有「开始」按钮**（Enter 就是"以该角色开始一局"，
 * 见设计稿 §3.5：CharacterSelect ←→ 移光标 / Enter 确定）。
 *
 * 所以这里**不调 `moveFocus`** —— 一旦把焦点移到 `'start'`，画面上会
 * 出现一个并不存在的槽位，`confirmCursor` 也会改成"没有可确定的项"。
 * 用 `characterSelection()` 造出来的状态永远停在 `'player'` 上。
 */

import {
  PREPARE_LAYOUT,
  confirmCursor,
  cursorTarget,
  cycleCursor,
  pickOption,
  prepareHitAreas,
  type PrepareHitArea,
  type PrepareLayout,
  type PrepareOption,
  type PrepareSelection,
} from './prepareLogic';

/**
 * 选角色屏的布局。
 *
 * ⚠️ 它**派生自** `PREPARE_LAYOUT`（只改该改的）而不是另写一份常数表：
 * 卡片宽度 / 圆角 / 起始边距这些与备战界面**共用同一套视觉**，改一处
 * 两个界面一起变 —— 用户要的正是"同一套交互"。
 *
 * 改的是两件属于选角色屏的事：卡片行下移（上面没有 Boss 行，居中更稳）、
 * 卡片更高（只有一行，可以给名字更多呼吸空间）。
 */
export const CHARACTER_SELECT_LAYOUT: PrepareLayout = {
  ...PREPARE_LAYOUT,
  playerRowY: 190,
  cardH: 110,
  cardGap: 20,
  cardMaxW: 320,
};

/**
 * 卡片命中区域。
 *
 * 直接复用 `prepareHitAreas(players, [])` 的几何（空 Boss 行 → 只剩人物卡
 * 与一个「开始」区域），再把 `start` 那块**滤掉** —— 选角色屏没有开始键。
 *
 * ⚠️ 过滤而不是"把 start 放到屏幕外"：`hitTest` 会遍历这份区域，
 * 留一块看不见的可点区域就等于留一个幽灵按钮。
 */
export function characterSelectHitAreas(
  players: readonly PrepareOption[],
  L: PrepareLayout = CHARACTER_SELECT_LAYOUT,
): readonly PrepareHitArea[] {
  return prepareHitAreas(players, [], L).filter((area) => area.kind === 'player');
}

/**
 * 初始状态：光标与选择**重合**在"上次出战的那个角色"上。
 *
 * ⚠️ `bossId` 是空串：选角色屏没有 Boss 槽位，这个字段永远不会被读
 * （所有传 `bosses: []` 的纯函数都只碰 `playerId`）。不写 `undefined`
 * 是因为 `PrepareSelection` 把它声明成 `string`，而改类型会动
 * `PrepareScreen`（本次范围外）。
 */
export function characterSelection(playerId: string): PrepareSelection {
  return {
    playerId,
    bossId: '',
    focus: 'player',
    cursor: { playerId, bossId: '' },
  };
}

/** 同 ← →：**只移动光标**，不改已确定的角色。 */
export function cycleCharacter(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  delta: number,
): PrepareSelection {
  return cycleCursor(sel, players, [], delta);
}

/** Enter：把**光标处**的角色写进选择（不改就直接返回同一个对象）。 */
export function confirmCharacter(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
): PrepareSelection {
  return confirmCursor(sel, players, []);
}

/** 点击卡片：移光标 + 确定（一步到位，与备战界面同一条规则）。 */
export function pickCharacter(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
  id: string,
): PrepareSelection {
  return pickOption(sel, players, [], 'player', id);
}

/** 光标此刻停在哪张卡（渲染层用它画"光标环"）。 */
export function characterCursorTarget(
  sel: PrepareSelection,
  players: readonly PrepareOption[],
): { readonly kind: 'player'; readonly id: string } | undefined {
  const at = cursorTarget(sel, players, []);
  return at === undefined ? undefined : { kind: 'player', id: at.id };
}

/**
 * 这个角色**能不能开一局肉鸽**。
 *
 * 需求："现在只有林晚风能玩，另两个在 `DEVELOPING` 里 → 复用备战界面
 * 既有那套「开发中 → 灰掉」的做法"。
 *
 * ⚠️ 判据由**调用方注入**（生产路径传 `data/roster.ts` 的 `isDeveloping`），
 * 与 `prepareLogic.canStartBattle` 是同一条纪律：名单会随着"做完一个角色"
 * 变短，而这条规则只管"名单说不能就不能"，不该跟着改。
 *
 * ⚠️ 与 `canStartBattle` 的区别：备战要同时看人物与对手，选角色只看人物。
 */
export function canStartRun(
  sel: PrepareSelection,
  developing: (id: string) => boolean,
): boolean {
  return !developing(sel.playerId);
}
