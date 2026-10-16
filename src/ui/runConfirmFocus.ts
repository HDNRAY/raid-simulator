/**
 * **肉鸽确认屏的焦点**（2026-10-16）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是确认屏**四站**的顺序与状态：**炁机 → 对手 → 恶魔低语 → 开始战斗**
 * （`Tab` / `Shift+Tab` / `↑` / `↓` 走它，点块头直接跳）。
 *
 * ==================================================================
 * ⚠️ 为什么不复用 `prepareLogic` 那台状态机（判据写在这里）
 * ==================================================================
 *
 * 走位**算法**是同一段 —— 它在 `./focusOrder.ts` 的 `stepFocus`，两处都调
 * 它（§2 要的"只许有一份实现"是这么满足的）。**不复用**的是那台状态机的
 * **状态形状**：
 *
 * | | 备战屏（`PrepareSelection`） | 确认屏（本文件的 `RunConfirmSelection`） |
 * |---|---|---|
 * | 站 | 人物 → 炁机 → 对手 → 开始 | 炁机 → 对手 → **恶魔低语** → 开始 |
 * | 块内光标 | 每个槽位各记一份（`PrepareCursor`） | **没有**（这一屏只读，不能改选） |
 * | 展开块 | `PrepareSectionKind` = 手风琴那三块 | 三行**只读**块头（含低语那一行） |
 *
 * `PrepareFocus` / `PrepareSectionKind` 是**备战屏**那两个概念的名字，而且
 * `PrepareSectionKind` 已经被 `prepareFrame` 用作 `Record<..., Label>` 的键
 * （备战屏的边框要三块各一个标题）—— 把 'whisper' 塞进去会让**备战屏**
 * 也被迫多认一个它永远没有的块 ✗（那正是"为了复用而让两边都变糊"）。
 *
 * 所以：**算法共用、状态各自**。`expanded` 与备战屏同一条语义（"焦点在
 * 开始键上时仍显示上一块"），只是它的取值是这三行。
 */

import { stepFocus } from './focusOrder';
import type { RunConfirmBlock } from './runConfirmLayout';
import type { DetailUnit } from './prepareDetail';

/** 确认屏的四个**焦点站**（顺序 = `Tab` 的方向）。 */
export type RunConfirmFocus = 'qiji' | 'boss' | 'whisper' | 'start';

/**
 * 站的顺序。
 *
 * ⚠️ 后三项与 `RunConfirmBlock` 同序（炁机 → 对手 → 恶魔低语），因为它们
 * 就是那三行；「开始战斗」多出来的一站。
 */
export const RUN_CONFIRM_FOCUS_ORDER: readonly RunConfirmFocus[] = [
  'qiji',
  'boss',
  'whisper',
  'start',
];

/** 确认屏的焦点状态。 */
export interface RunConfirmSelection {
  readonly focus: RunConfirmFocus;
  /**
   * **右侧详情画哪一块**（焦点在「开始战斗」上时保持上一块，不忽隐忽现）。
   *
   * ⚠️ 它是 `RunConfirmBlock`（`'qiji' | 'boss' | 'whisper'`）—— 没有
   * `'start'`：详情区没有"开始战斗"这一项（与备战屏 `expanded` 同一条）。
   */
  readonly expanded: RunConfirmBlock;
}

/**
 * 初值：**有已选炁机就停在炁机**（刚选的那条最该被确认），否则停在对手。
 *
 * ⚠️ 与备战屏同一条判据（"光标从当前选择出发"）：这一屏没有"当前选择"
 * 之外的记忆，所以每次显示都重造（见 `RunConfirmScreen.setVisible`）。
 * ⚠️ 「恶魔低语」那一行**永远在**，所以初值不可能是它 —— 初值只由
 * "有没有已选炁机"决定（玩家最想看的是刚选的东西）。
 */
export function runConfirmSelection(info: {
  readonly boss: DetailUnit;
  readonly qiji: readonly DetailUnit[];
}): RunConfirmSelection {
  const focus: RunConfirmFocus = info.qiji.length === 0 ? 'boss' : 'qiji';
  return { focus, expanded: focus };
}

/** 焦点在某一站时，右侧详情该画哪一块（`'start'` 保持上一块）。 */
function expandedOf(current: RunConfirmSelection, focus: RunConfirmFocus): RunConfirmBlock {
  return focus === 'start' ? current.expanded : focus;
}

/**
 * 走一步（`Tab` / `Shift+Tab` / `↑` / `↓`，**环绕**）。
 *
 * ⚠️ 不能停的站只有一处：**没有一点已选炁机时的「炁机」**（那一行整块
 * 不画）—— 与备战屏"跳过空槽位"是同一条判据，走的是同一个 `stepFocus`。
 */
export function moveRunConfirmFocus(args: {
  readonly selection: RunConfirmSelection;
  readonly delta: number;
  readonly hasQiji: boolean;
}): RunConfirmSelection {
  const focus = stepFocus({
    current: args.selection.focus,
    order: RUN_CONFIRM_FOCUS_ORDER,
    delta: args.delta,
    wrap: true,
    canFocus: (candidate) => candidate !== 'qiji' || args.hasQiji,
  });
  if (focus === args.selection.focus) return args.selection;
  return { focus, expanded: expandedOf(args.selection, focus) };
}

/**
 * **直接**把焦点放到某一行（点块头；与 `Tab` 同一个状态机）。
 *
 * @returns 那一行不在时返回原状态（点了不存在的行 = 什么都不做）
 */
export function focusRunConfirmBlock(args: {
  readonly selection: RunConfirmSelection;
  readonly block: RunConfirmBlock;
  readonly hasQiji: boolean;
}): RunConfirmSelection {
  if (args.block === 'qiji' && !args.hasQiji) return args.selection;
  if (args.block === args.selection.focus) return args.selection;
  return { focus: args.block, expanded: args.block };
}
