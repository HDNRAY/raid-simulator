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

/* ------------------------------------------------------------------ *
 * 按下 / 按住（2026-10-22，用户线上实测："按住「弹」……按钮也没有按住的
 * 视觉反馈，按了一下，和按住，都需要有，其他技能也是一样，无论是瞬发还是
 * 引导"）
 * ------------------------------------------------------------------ */

/**
 * 一个槽位此刻的**按下状态**（由输入层给出：`InputSource.isHeld` + 本 tick
 * 是否刚按下）。渲染层**不自己监听 DOM** ✗ —— 那会成为同一件事的第二份真相。
 */
export interface SlotPress {
  /** 这一格刚被按下（瞬发技也会亮一下，至少持续到下一次快照） */
  readonly pressed: boolean;
  /** 这一格**正被按住**（按住型技能持续施放中） */
  readonly holding: boolean;
}

/** 没按（缺省）—— 让调用点不用每次写字面量对象。 */
export const NO_PRESS: SlotPress = { pressed: false, holding: false };

/** 一格的**最终画法**（状态配色 + 按下反馈）。 */
export interface SlotVisual extends SlotLook {
  readonly pressed: boolean;
  readonly holding: boolean;
}

/**
 * 状态配色 + 按下反馈 ⇒ 最终画法。
 *
 * ==================================================================
 * 优先级（用户定："不可用 > 按住 > 按下 > 常态"）
 * ==================================================================
 *
 * 1. **不可用**（冷却中 / 读条中 / 买不起）—— 按下**不**让它变亮 ✗：
 *    那一格根本按不动，变亮等于骗玩家"刚才那下生效了"
 * 2. **按住** —— 最亮：底色换成 `readyLine`（亮石板）、描边换成焦点色 `focus`
 * 3. **按下** —— 与按住同一档底色/描边（否则"按了一下"和"按住"看起来是
 *    两件不同的东西 ✗），区别只在**按住多一条底部高亮条**（见 `holdingPulse`
 *    与 `skillBar` 的画法）：持续的东西用"持续的形状"表达
 * 4. **常态** —— `SLOT_LOOKS` 那四档
 *
 * ⚠️ 为什么不用"变亮一点点"：底色四档之间的明暗差本来就不大（`PALETTE.slot`
 * 刻意同色系），再来一档"亮一点"在截图里根本分不出来 ✗。所以按下/按住
 * **换的是色相**（暖石板 → 冷白），这是眼能一眼分辨的维度。
 */
export function slotVisualOf(view: SkillSlotView | undefined, press: SlotPress): SlotVisual {
  const state = view === undefined ? 'blocked' : slotStateOf(view);
  const base = view === undefined ? SLOT_LOOKS.blocked : SLOT_LOOKS[state];
  /** 只有**可用**的格子才有按下反馈（见上面的优先级）。 */
  if (state !== 'ready' || (!press.pressed && !press.holding)) {
    return { ...base, pressed: false, holding: false };
  }
  return {
    ...base,
    fill: PALETTE.slot.readyLine,
    line: PALETTE.focus,
    pressed: true,
    holding: press.holding,
  };
}

/**
 * **按住时的呼吸感**（0..1 的附加不透明度乘子）。
 *
 * 用户："按住时是持续高亮 + 一点点呼吸感，别做花哨动画"。
 * 所以只让**底部那条高亮条**在 0.7~1 之间以 **1 秒**为周期起伏
 * （10 个逻辑步 = 1 秒，`tick` 是战斗 tick ⇒ 与游戏速度同步、不用墙钟）。
 *
 * ⚠️ 用 `tick` 而不是 `Date.now()`：渲染层拿时钟会引入"暂停时还在呼吸"、
 * 以及测试不可复现两件事。
 */
export function holdingPulse(tick: number): number {
  /** 用 `cos` 而不是 `sin`：按下那一刻就是**最亮**（1.0），半秒后最暗 —— 
   *  "刚按住"要和"常态"一眼分开 ✓ */
  return 0.7 + 0.3 * (Math.cos((tick / 10) * Math.PI * 2) * 0.5 + 0.5);
}
