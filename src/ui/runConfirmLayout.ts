/**
 * **肉鸽确认屏的几何**（纯几何：两行只读块头 + 「开始战斗」）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏**自己那点几何**的唯一出处：两行块头的**顶边从哪递推**、
 * 栏目标题画在哪、哪一块在不在。
 *
 * ==================================================================
 * ⚠️ 其余几何**一律复用备战屏那一套**（用户说的"老规矩"）
 * ==================================================================
 *
 * | 这一屏的东西 | 从哪来 | 为什么 |
 * |---|---|---|
 * | 块头的矩形 | `prepareGeometry.foldRect` | 与备战屏**同一条**高 40 的块头 |
 * | 块头的命中区（含标题带外扩） | `prepareGeometry.foldHitRect` | 同一句"命中 = 内容盒 ∪ 标题带" |
 * | 块头里那行字 | `prepareFold.foldSummaryOf` | 同一句"块头显示**已确定的选择**" |
 * | 右侧详情面板 | `prepareGeometry.detailRect`（x624 / 宽296 / 通高） | **共用**那块详情区 |
 * | 「开始战斗」+ 提示那一格 | `prepareGeometry.startRect` / `footerHintSlot` | 同一个按钮、同一处（锚定底部） |
 *
 * ⚠️ 所以本文件**只回答一件事**：两行块头在纵向怎么排（`runConfirmBlockTops`）。
 * 抄一份矩形 / 按钮 / 详情区的坐标过来，就是 §2 点名的"同一份几何两份实现"
 * —— 两份都会"看起来对"，然后各改一处时漂开。
 *
 * ==================================================================
 * ⚠️ 纵向链是**按"这一块在不在"递推**的（与备战屏 `rowTopsOf` 同一条）
 * ==================================================================
 *
 * 肉鸽第一场之前**没有已选炁机** —— 那一块（标签 + 块头）**整块不画**，
 * 于是对手那一行**顶上来**（不是留一个空洞）。写死两个 y 就会出现
 * "第一场上面空一块、第三块压住按钮"这种形状。
 *
 * ```
 *   ① 标题            中心 56（32px 楷体）
 *   ② 第几场 / 共几场  中心 92
 *   ③ 第一块标签      中心 124
 *   ④ 第一行块头      148 .. 188
 *   ⑤ 第二块标签      中心 212
 *   ⑥ 第二行块头      236 .. 276
 *   ⑦ 第三块标签      中心 300      ← 「恶魔低语」（永远在）
 *   ⑧ 第三行块头      324 .. 364
 *   （「开始战斗」+ 提示：底边那一排，锚定底部 —— 与备战屏同一处）
 * ```
 */

import { PREPARE_LAYOUT } from './prepareLayout';
import { foldHitRect, foldRect } from './prepareGeometry';
import type { Rect } from './prepareCardGrid';

/**
 * 确认屏的三行块头（顺序 = 从上到下）：**炁机 → 对手 → 恶魔低语**。
 *
 * ⚠️ 「恶魔低语」那一行**永远在**（第 1 层写「本层纯净」）—— 与炁机那一行
 * 不同：炁机没选过就**整块不画**（它在第一场之前确实不存在），而"这一层
 * 有没有惩罚"本身就是要给玩家看的信息（2026-10-16）。
 */
export type RunConfirmBlock = 'qiji' | 'boss' | 'whisper';

export const RUN_CONFIRM_LAYOUT = {
  /** 标题中心 y。 */
  titleY: 56,
  /** 「第 N / M 场」那一行的中心 y。 */
  progressY: 92,
  /**
   * **第一块**的栏目标题中心 y（块头的顶边 = 它 + `labelGap`）。
   *
   * ⚠️ 后面的块由 `runConfirmBlockTops` 递推，**不许**再写 y。
   */
  firstLabelY: 124,
} as const;

/**
 * 两行块头的**顶边**（按"炁机那一块在不在"递推）。
 *
 * 递推规则与备战屏 `rowTopsOf` **同一个**（见那个函数的说明）：
 *
 * ```
 *   下一块的行顶 = 上一块的底边 + rowGap + 标题行框 + labelGap
 * ```
 *
 * ⚠️ `qiji` 为 `undefined` = 这一局还没有已选炁机 → 那一块（标签 + 块头）
 * 整块不画，对手顶上来。
 */
export function runConfirmBlockTops(hasQiji: boolean): {
  readonly qiji: number | undefined;
  readonly boss: number;
  /** 「恶魔低语」那一行的顶边 —— **永远存在**（见 `RunConfirmBlock`）。 */
  readonly whisper: number;
} {
  /** 标题的行框（与布局测试同一个保守估计：`1.3 × labelSize`）。 */
  const labelBox = Math.ceil(PREPARE_LAYOUT.labelSize * 1.3);
  /** 第一块的顶边：标签中心 + `labelGap`（备战屏的 `prepareLabelY` 是反过来的）。 */
  const first = RUN_CONFIRM_LAYOUT.firstLabelY + PREPARE_LAYOUT.labelGap;
  /**
   * 下一块的顶边（与 `prepareGeometry.rowTopsOf` 的 `below()` 逐字同一条）。
   *
   * 少了 `labelGap` 就会让下一行的**命中区**（`foldHitRect` 向上多吃一条
   * 标题带）压到上一行上 —— 那正是"点上一行却切到下一行"的形状，而截图
   * 完全看不出来（两行画得都不重叠，重叠的是命中区）。
   */
  const below = (top: number): number =>
    top + PREPARE_LAYOUT.foldH + PREPARE_LAYOUT.rowGap + labelBox + PREPARE_LAYOUT.labelGap;
  if (!hasQiji) return { qiji: undefined, boss: first, whisper: below(first) };
  const boss = below(first);
  return { qiji: first, boss, whisper: below(boss) };
}

/**
 * 某一块的**栏目标题**中心 y（在块头上边）。
 *
 * ⚠️ 它由**块头的顶边**反推（`top - labelGap`），与备战屏
 * `prepareLabelY` 同一条：标题与它那一行是同一次推导里的东西 ——
 * 各写一个 y 就会漂出"标题压在块头上"。
 */
export function runConfirmBlockLabelY(top: number): number {
  return top - PREPARE_LAYOUT.labelGap;
}

/**
 * 某一块**画出来**的矩形（= 备战屏那条块头，见 `prepareGeometry.foldRect`）。
 *
 * @returns 这一块**不在**时 `undefined`（调用方不该画它 —— 连标题也不画）
 */
export function runConfirmBlockRect(
  block: RunConfirmBlock,
  hasQiji: boolean,
): Rect | undefined {
  const top = blockTop(block, hasQiji);
  return top === undefined ? undefined : foldRect(top);
}

/**
 * 某一块的**可点矩形**（块头 ∪ 它上面那行标题，见 `foldHitRect`）。
 *
 * ⚠️ 比画出来的那一条大一圈是**有意**的（触屏点的是"整块"，而画出来的
 * 只有 40px）—— 与备战屏同一个 `foldHitRect`。
 */
export function runConfirmBlockHitRect(
  block: RunConfirmBlock,
  hasQiji: boolean,
): Rect | undefined {
  const top = blockTop(block, hasQiji);
  return top === undefined ? undefined : foldHitRect(top);
}

/** 这个逻辑点是不是落在某一块上（点它 = 把焦点 / 右侧详情切到它）。 */
export function isOnRunConfirmBlock(
  block: RunConfirmBlock,
  hasQiji: boolean,
  px: number,
  py: number,
): boolean {
  const rect = runConfirmBlockHitRect(block, hasQiji);
  if (rect === undefined) return false;
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/** 某一块的块头顶边（不在时 `undefined`）。 */
function blockTop(block: RunConfirmBlock, hasQiji: boolean): number | undefined {
  const tops = runConfirmBlockTops(hasQiji);
  if (block === 'qiji') return tops.qiji;
  return block === 'boss' ? tops.boss : tops.whisper;
}
