/**
 * 一格的**状态 → 配色**（技能栏**与**触屏圆钮**共用）。
 *
 * ==================================================================
 * 为什么单独一个文件（这是"单一真相"那条纪律）
 * ==================================================================
 *
 * 需求（用户 2026-10-12）："触屏圆钮要不要跟技能栏统一 → **要统一**"。
 *
 * 统一的意思是两件事**同时**成立：
 *   1. 色号只有一个来源（`render/theme.PALETTE.slot`）—— 触屏层**不许**
 *      抄一份四档的色值
 *   2. **状态到颜色的映射**一致：可用最亮、买不起最暗
 *
 * 而"状态"本身是 `app/slotViews.ts` 算好的（`usable` / `blockedKey` /
 * `cooldownRatio`）—— 渲染层**不许**自己再推一遍"炁够不够"
 * （那是本仓库反复踩过的"两份会漂的真相"）。
 *
 * 所以这一块从 `render/skillBar.ts` 里**抽出来**：技能栏（圆矩形格子）与
 * 触屏按钮层（圆钮）都读它。形状不同（圆 vs 圆矩形）是**有意的**，但
 * "什么状态配什么色"只有一处 —— 否则两套映射迟早会在某个边界上分叉
 * （比如"又买不起又在冷却"的先后顺序）。
 *
 * ⚠️ 纯数据 + 纯函数，零 Pixi 依赖。
 */

import { PALETTE } from './theme';
import { BLOCK_KEYS, type SkillSlotView } from './viewModel';

/**
 * 一格的**视觉状态** —— 四档，各有自己的底色。
 *
 * 需求（用户原话）："键盘的时候技能按钮还是加一个背景色，要不然
 * **资源不够用不了的技能看着太不清楚了**。"
 */
export type SlotState =
  /** 可用 */
  | 'ready'
  /** 冷却中 */
  | 'cooldown'
  /** 条件型不可用：读条中 / 派生窗口未开 */
  | 'waiting'
  /** **资源不足**（"买不起"）—— 用户点名要一眼看得出来的那一档 */
  | 'blocked';

/** 一档状态怎么画：底色 / 描边 / 技能字 / 键名 / 代价数字。 */
export interface SlotLook {
  readonly fill: number;
  readonly line: number;
  readonly glyph: number;
  readonly key: number;
  /** 代价数字要不要压灰（只有"买不起"要 —— 见 `PALETTE.slot.blockedCost`）。 */
  readonly costDimmed: boolean;
}

/**
 * 四档状态的配色表。
 *
 * 色号全部来自 `PALETTE.slot`（唯一配色真相源）—— 那里写着为什么这四档
 * **共用一个色相**、而不是"买得起绿、买不起红"。
 *
 * ⚠️ `ready` 与 `cooldown` **底色相同**：冷却由白色遮罩 + 中间的大数字
 * 表达，底色再变一次就是同一个状态两套表达 —— 两套表达必然在某个
 * 边界上互相矛盾（"看着亮、其实在冷却"）。
 */
export const SLOT_LOOKS: Readonly<Record<SlotState, SlotLook>> = {
  ready: {
    fill: PALETTE.slot.ready,
    line: PALETTE.slot.readyLine,
    glyph: 0xffffff,
    key: 0xd8d8e4,
    costDimmed: false,
  },
  cooldown: {
    fill: PALETTE.slot.ready,
    line: PALETTE.slot.readyLine,
    glyph: 0xb0b0be,
    key: 0x8a8a98,
    costDimmed: false,
  },
  waiting: {
    fill: PALETTE.slot.waiting,
    line: PALETTE.slot.waitingLine,
    glyph: 0xa8aabc,
    key: 0x8a8a98,
    costDimmed: false,
  },
  blocked: {
    fill: PALETTE.slot.blocked,
    line: PALETTE.slot.blockedLine,
    glyph: PALETTE.slot.blockedGlyph,
    key: 0x6a6c7c,
    costDimmed: true,
  },
};

/**
 * 这一格该按哪一档画。
 *
 * ⚠️ 「买不起」的判据就是 `slotViews.ts` 写进 `blockedKey` 的那个 key
 * （`BLOCK_KEYS.cost`）—— 不在渲染层重新推"资源够不够"，也不重新排序：
 * 那一格的 `blockedKey` 是谁，这里就照着画。**一份判据。**
 *
 * ⚠️ 冷却必须排在 `cost` **之后**判断，与 `slotViews.ts` 里算
 * `blockedKey` 的先后一致（那里也是先资源、后冷却）：否则"又买不起、
 * 又在冷却"的格子会被画成"只是冷却"。
 */
export function slotStateOf(view: SkillSlotView): SlotState {
  if (view.usable) return 'ready';
  if (view.blockedKey === BLOCK_KEYS.cost) return 'blocked';
  if (view.cooldownRatio > 0.001) return 'cooldown';
  return 'waiting';
}

/** 状态 → 配色（`slotStateOf` + `SLOT_LOOKS` 的合成，调用方一次拿到）。 */
export function slotLookOf(view: SkillSlotView | undefined): SlotLook {
  /**
   * ⚠️ 快照里没有这个技能（布局刚变、快照还没跟上）→ 画成**最暗**那档，
   * 而不是留上一个状态的亮色（那会误导玩家"这一招能按"）。
   */
  if (view === undefined) return SLOT_LOOKS.blocked;
  return SLOT_LOOKS[slotStateOf(view)];
}
