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
  confirmCursor,
  cursorTarget,
  cycleCursor,
  pickOption,
  type PrepareOption,
  type PrepareSelection,
} from './prepareLogic';
import { PREPARE_LAYOUT, type PrepareHitArea, type PrepareLayout } from './prepareLayout';


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
  /**
   * ⚠️ 这一屏**没有主标题下面那两行**（选角色屏的标题是它自己画的），
   * 而卡片行的 y 现在由 `titleY` 推出来（见 `rowTopsOf`）—— 所以"把卡片
   * 往下挪"这件事落在 `titleY` 上。
   */
  titleY: 140,
  cardH: 110,
  cardGap: 20,
  /**
   * ⚠️ 挤在**左列**里（右列这一屏没有详情区，但列宽仍是共用的那一个）：
   * 卡片满高 110，而"名字 + 头像"的排布由 `prepareCards` 按 `showPortrait`
   * 决定，不需要这一屏另开一套尺寸。
   */
  playerColumns: 3,
};

/**
 * **选角色屏 = 三张"人物详情卡"**（2026-10-22 第三次重做，用户原话）：
 *
 * > 本来就是 **3 张 人物详情卡**，只是**没有选中的时候收起来**，
 * > 另外**收起来也是要有动画的**！
 *
 * ==================================================================
 * 几何（全部推出来，没有手调）
 * ==================================================================
 *
 * ```
 *   卡宽   = 详情区宽（`PREPARE_LAYOUT.detailW` = 296）
 *   间距   = 12
 *   左右边 = (960 − 3×296 − 2×12) / 2 = 24
 *   收起高 = 96（一条"名字短条"）
 *   展开高 = 详情区高（`PREPARE_LAYOUT.detailH` = 371）
 *   底边   = 详情区下缘（`detailY + detailH`）—— **三张共用这一条线**
 * ```
 *
 * ⚠️ **底边固定、向上长**（用户："展开是向上长、收起是向下缩（这样切换时
 * 整排不会上下跳）"）⇒ 卡片矩形 = `y = bottom - h`、`h = lerp(96, 371, 进度)`。
 * 宽度**全程 296 不变** ⇒ 详情面板的排版可以原样搬进这块矩形（不用缩放）。
 *
 * ⚠️ **命中/悬停区 = 展开后的整块矩形**（不是"当前动画矩形"）：
 * 动画中的矩形每帧都在变，用它当命中区会让指针在边缘"忽进忽出" ✗。
 * 展开后的整块**包含**收起态 ✓ 且三块互不重叠（间距 12）✓ ⇒ 判据稳定。
 */
/** 内容区上沿（标题之下）。 */
const CONTENT_TOP = 96;
/** 内容区下沿（底部提示之上）—— 提示行固定在 `CONTENT_TOP + CONTENT_H + …`。 */
const CONTENT_H = 380;

export const CHARACTER_CARD_LAYOUT = {
  /** ⚠️ 与详情区**同宽**（`PREPARE_LAYOUT.detailW`）：这是"卡片就是详情卡"的前提。 */
  w: PREPARE_LAYOUT.detailW,
  /** 收起时的高度（一条名字短条）。 */
  barH: 96,
  /** 展开时的高度（= 详情区高）。 */
  fullH: PREPARE_LAYOUT.detailH,
  gap: 12,
  /**
   * **内容区的垂直中心线**（2026-10-22 用户："还是没有居中… 改成每张卡
   * 各自垂直居中"）。
   *
   * ⚠️ 上一版是"底边固定、按展开高度算一条带子居中" ⇒ **短条全贴在带子
   * 底部**，视觉上整排偏下 ✗。现在每张卡**各自**以这条线为中心：
   *
   * ```
   *   y = centerY - h / 2      （h = 这一张当前的高度）
   * ```
   *
   * 于是收起时短条在中间、展开时向**上下同时**长；中心线不动 ⇒ 切换时
   * 整排不上下跳 ✓，两张短条也自然**同高对齐** ✓。
   */
  get centerY(): number {
    return CONTENT_TOP + Math.round(CONTENT_H / 2);
  },
} as const;

/** 一张卡片的矩形（逻辑坐标）。 */
export interface CharacterCardRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 某张卡所在的**列**（x 由张数摊开，横向居中）。 */
export interface CharacterCardColumn {
  readonly x: number;
  readonly w: number;
}

/**
 * 三张卡各自的**列**（顺序 = 角色顺序；横向等距、整体居中）。
 *
 * @param count 角色数（今天 3；不是 3 时仍然居中：按实际张数重新摊开）
 */
export function characterSelectColumns(
  count: number,
  L: typeof CHARACTER_CARD_LAYOUT = CHARACTER_CARD_LAYOUT,
): readonly CharacterCardColumn[] {
  if (count <= 0) return [];
  const totalW = count * L.w + (count - 1) * L.gap;
  const left = Math.round((960 - totalW) / 2);
  return Array.from({ length: count }, (_unused, index) => ({
    x: left + index * (L.w + L.gap),
    w: L.w,
  }));
}

/**
 * 某张卡在**当前展开进度**下的矩形（渲染用）。
 *
 * @param progress 0 = 收起（96 高）、1 = 展开（371 高）；底边固定、向上长
 */
export function characterCardRect(
  column: CharacterCardColumn,
  progress: number,
  L: typeof CHARACTER_CARD_LAYOUT = CHARACTER_CARD_LAYOUT,
): CharacterCardRect {
  const k = Math.min(1, Math.max(0, progress));
  const h = Math.round(L.barH + (L.fullH - L.barH) * k);
  /** ⚠️ **每张卡各自垂直居中**（中心线不动 ⇒ 切换时整排不跳）。 */
  return { x: column.x, y: L.centerY - Math.round(h / 2), w: L.w, h };
}


/**
 * 三张卡**此刻**的矩形（顺序 = 角色顺序）—— 渲染、命中、滚动视口共用这一份。
 *
 * ⚠️ 2026-10-22 用户报的 bug："鼠标 hover 展开的范围比未展开卡片的范围大多了"
 * ⇒ 命中**必须跟着这一张当前的矩形**（收起时就是那条 96 高的短条），
 * 而不是"展开后的整块"。
 *
 * @param progressOf 第 `index` 张此刻的展开进度（缺省 0 = 全部收起）
 */
export function characterSelectCardRects(
  count: number,
  progressOf: (index: number) => number = () => 0,
): readonly CharacterCardRect[] {
  return characterSelectColumns(count).map((column, index) =>
    characterCardRect(column, progressOf(index)),
  );
}

/**
 * 卡片命中区域。
 *
 * ⚠️ 2026-10-22 起**直接用 `characterSelectCardRects`**（与渲染同一份）——
 * 之前走 `cardGrid`，那是"备战屏的列布局"，而这一屏现在是"三张与详情等宽的
 * 大卡"，两套几何会漂（画在一处、点在一处）。
 */
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
  progressOf: (index: number) => number = () => 0,
): readonly PrepareHitArea[] {
  return characterSelectCardRects(players.length, progressOf).map((rect, i) => ({
    kind: 'player' as const,
    id: players[i]!.id,
    ...rect,
  }));
}


/**
 * 指针划过时**详情区该显示谁**（hover 的命中判据）。
 *
 * ⚠️ 它是纯函数、与 `characterSelectHitAreas` **同一份矩形**：鼠标"划过哪张卡"
 * 与"点中哪张卡"必须是同一个判据 —— 两份各算一遍就会漂出"看着停在 A 上、
 * 详情却是 B"（备战屏的 `pointerIntentOf` 记着同一条）。
 *
 * @returns 没划过任何卡（含划过镂空处 / 画布外）时 `undefined` ——
 *   调用方据此把悬停清掉（否则详情会一直停在最后划过的那一项）
 */
export function characterHoverTarget(
  players: readonly PrepareOption[],
  px: number,
  py: number,
  progressOf: (index: number) => number = () => 0,
): { readonly kind: 'player'; readonly id: string } | undefined {
  for (const area of characterSelectHitAreas(players, progressOf)) {
    if (px < area.x || px > area.x + area.w) continue;
    if (py < area.y || py > area.y + area.h) continue;
    return { kind: 'player', id: area.id };
  }
  return undefined;
}

/**
 * **点某张卡该做什么**（纯判定；触屏与鼠标**同一条**）。
 *
 * ```
 *   点的不是**已确定**的那个角色 → 只选中它（详情区跟着切）
 *   点的就是**已确定**的那个角色 → 开局
 * ```
 *
 * ==================================================================
 * ⚠️ 为什么要多这一步（用户 2026-10-15："显示当前 hover 角色的详情"）
 * ==================================================================
 *
 * 鼠标 / 键盘看得到"选中之前"的详情（hover / ← →），而**触屏没有 hover**
 * —— 若点一下就直接开局，触屏玩家**永远看不到别的角色的详情**（点谁就
 * 开谁），那是 AGENTS.md §3b 点名的"某个功能只有键盘能用"。
 *
 * ⚠️ 判据**不看操作方式**（`OperationMode`）：两套输入走同一条规则，
 * 于是不会出现"鼠标一个行为、手指另一个行为"（那正是 §3b 要避免的）。
 * 而代价是零：默认选中的是**上次出战的那个**，手指点它就开局（一步，
 * 与改之前**逐字相同**）。
 */
export function tapCharacterIntent(
  sel: PrepareSelection,
  id: string,
): 'start' | 'select' {
  return id === sel.playerId ? 'start' : 'select';
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
    /**
     * ⚠️ 手风琴的"展开块"在这一屏**只有人物那一个**（没有炁机行、没有 Boss
     * 行）—— 于是它恒等于 `'player'`，本屏没有"换一块"这回事。
     */
    expanded: 'player',
    /**
     * ⚠️ `qijiId` 是空串：这一屏没有炁机行，而 `PrepareCursor` 要求
     * 每个槽位各记一格（见 `prepareLogic` 的 `cursorFromSelection`）。
     * 空串在 `cursorTarget` 那里会落到"列表里找不到 → 用第 0 项"，
     * 而这一屏的列表里根本没有 qiji 槽位 —— 走不到。
     */
    cursor: { playerId, bossId: '', qijiId: '' },
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
