/**
 * **备战界面的外观规则**（纯函数：状态 → 颜色 / 线宽）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 需求（用户）："选中 和 目前光标 目前颜色是一样的" +
 * "用 enter 来确定选择，而不是靠移动到下一项" +
 * "颜色，黄色很奇怪" + "设置按钮 有时也会被变黄"。
 *
 * 四条里有三条是**"什么状态画成什么样"**的问题。这类规则留在
 * `PrepareScreen.redraw()` 里就只能在截图里"看一眼觉得对"，一旦
 * 手滑写错（把 cursor 判成 selected）没有任何东西会拦住它 ——
 * 而它的表现恰恰是**用户已经抱怨过一次的那个样子**。
 *
 * 所以把"状态 → 皮肤"抽成纯函数放这里：
 *   - 可以在 node 里精确测（`tests/unit/prepareRender.test.ts`）：
 *     "光标 ≠ 选择"变成一条**可执行的断言**，而不是一句注释
 *   - `PrepareScreen` 只剩"照着返回的颜色画"
 *
 * ⚠️ 颜色值一律取自 `render/theme.ts` 的 `PALETTE`（既有约定：
 * 渲染代码不写死颜色）。这里只是**选择**用哪一个 token。
 *
 * ==================================================================
 * 视觉语言：**冷 = 光标，暖 = 选择**（两者靠色相区分，不靠"谁更亮"）
 * ==================================================================
 *
 * | 状态 | 画法 | 语义 |
 * |---|---|---|
 * | 什么都没有 | 2px 暗灰描边、白 4% 底 | 没被碰过 |
 * | **光标** | **冷白 3px 描边 + 冷色 10% 底** | "我停在这儿，还没定" |
 * | **选择** | **暖金 2px 描边 + 暖金 15% 底** | "就是它，会上场" |
 * | 光标 **且** 选择 | 金色底板 + **外面再套一圈冷白环**（`ring`） | "就选它，光标也在这儿" |
 * | 开发中 | 一起压暗（底/边/字） | 可以选、不能开战 |
 *
 * ⚠️ **为什么不是"粗细不同但同色"**（旧版就是这样：选中 2px、焦点 3px，
 * 都是金色）：同一块屏幕上"亮一点的金"和"更亮一点的金"在截图里几乎
 * 分不出来 —— 这正是用户说的"两者颜色是一样的"。色相（冷/暖）是**一眼
 * 可辨**的维度，而且不依赖显示器对比度。
 */

import { PALETTE } from '../render/theme';

/* ------------------------------------------------------------------ *
 * Token：光标 / 选择 的专用皮肤
 * ------------------------------------------------------------------ */

/**
 * 备战界面专用色 —— 定义在**此处**而不是塞进 `PALETTE`。
 *
 * 理由：`PALETTE` 里的语义色是**战斗**语义（hp / energy / douqi / 预警），
 * 它们被像素美术和 HUD 共用；而"备战的选中金"与"战斗的斗气金"是**两件事**
 * —— 硬塞进 `PALETTE.douqi` 会让"调备战配色"变成"改战斗 HUD 配色"
 * （AGENTS.md 把这叫"两处真相"的变体：一处真相被两个目的争用）。
 *
 * ⚠️ 它们仍然是 token、仍然集中一处：渲染代码照旧不写死颜色。
 */
export const PREPARE_SKIN = {
  /**
   * **选择**：暖金，但比旧版**深、暗**一档（旧版直接用 `douqi` 的
   * `base 0xe4a840` / `bright 0xffc860`）。
   *
   * 需求："颜色，黄色很奇怪"。旧版那种高饱和琥珀**在整屏里像一个警告
   * 图标**（本项目的黄同时是 `interrupt` 可用色）；备战的"已确定"是
   * **静止状态**，不该比战斗预警还抢眼。这里压低明度、去掉一点橙，
   * 变成"黄铜"而不是"荧光黄"。
   */
  selectionLine: 0xb8892f,
  selectionFill: 0x8a6520,
  /** 卡片名字被确定时的颜色（比描边亮一点，保证小字号可读）。 */
  selectionText: 0xe8c884,
  /**
   * **光标**：冷白（略带蓝）。
   *
   * 选它是因为它**色相与金色相反**、且亮度足够高：无论卡片是暗底还是
   * 金底，这一圈都读得出来。它就是设置按钮的焦点色（`PALETTE.focus`）
   * ——"光标"在本作里只有一种颜色语言，跨界面一致。
   */
  cursorLine: PALETTE.focus,
  cursorFill: PALETTE.focus,
  /**
   * **光标落在开发中的卡片上**时的环色：同一色相、压暗一档。
   *
   * ==================================================================
   * 为什么需要它（截图里发现的真问题）
   * ==================================================================
   *
   * 第一版把"开发中"整张卡（含光标环）一起压暗/跳过，于是**光标移到
   * 开发中的卡上时屏幕上没有任何变化** —— 玩家会以为方向键坏了。
   * 实测：光标停在第 2 张卡（凯丽 · 开发中）时，那张卡与"没被碰过"
   * 完全一样。
   *
   * 但也不能给它正常的光标环：亮冷白环会被读成"这一项可以选"，
   * 而它其实**不能开战**。所以取"同色相、低亮度、低饱和"：
   * 它传达的是"**光标在这儿，但这一格是灰的**"。
   */
  cursorLineMuted: PALETTE.focusMuted,
  /** 卡片默认（既不是光标也不是选择）。 */
  idleLine: 0x3c3e50,
  idleFill: 0xffffff,
} as const;

/** 卡片/开始键的圆角（与命中区域无关，纯外观）。 */
export const CARD_RADIUS = 6;

/**
 * 各状态的线宽。
 *
 * ⚠️ 光标用 3px、选择用 2px：这是**第二重**区分（色相是第一重）。
 * 需求明确说了要"颜色 / 描边粗细 / 亮度 / 角标，你挑一种并说明"——
 * 这里挑了色相为主、线宽为辅，因为它们叠加之后在**灰度**打印或
 * 色弱视角下也还分得出来。
 */
export const CARD_STROKE = {
  idle: 2,
  selected: 2,
  cursor: 3,
} as const;

/**
 * 光标套在已选中卡片外面时的外扩量（逻辑像素）。
 *
 * ⚠️ 为什么不用"同一圈描边但换色"：那会让卡片边长在"只是光标"和
 * "光标+选择"之间**看起来变了**。外扩 2px 之后：
 *   - 单选：金边（内）+ 冷白环（外）同时存在 = "就选它，光标也在这"
 *   - 单光标：只有冷白边 = "我停在这儿，还没定"
 * 两种情况都不是"另一种边框样式"，而是"**边框有几层**"。
 *
 * 2px 是 `cardGap`(16) 与 `pad`(40) 都吃得下的值，不会与邻卡相碰。
 */
export const CURSOR_RING_GAP = 2;

/* ------------------------------------------------------------------ *
 * 卡片皮肤
 * ------------------------------------------------------------------ */

export interface CardSkin {
  readonly fillColor: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeWidth: number;
  readonly nameColor: number;
  /**
   * 是否在卡片**外面**套一圈光标环。
   *
   * 两种情形为真：
   *   1. **光标 + 选择落在同一张卡** —— 卡片本身是金的，需要一个
   *      不属于"选择"的元素来标出光标
   *   2. **光标落在"开发中"的卡上** —— 那张卡整体压暗，没有环就
   *      完全看不出光标在哪（实测过）
   */
  readonly ring: boolean;
  /** 环色（只有 `ring` 为真时有意义）。 */
  readonly ringColor: number;
}

export interface CardSkinInput {
  readonly developing: boolean;
  /** 光标停在这一格。 */
  readonly cursored: boolean;
  /** 这一格是**已确定**的选择。 */
  readonly selected: boolean;
}

/** 开发中的卡片：底/边/字一起压暗，"灰掉"才不是一句空话。 */
const DEVELOPING_SKIN: CardSkin = {
  fillColor: PREPARE_SKIN.idleFill,
  fillAlpha: 0.02,
  strokeColor: 0x2a2c38,
  strokeWidth: 2,
  nameColor: PALETTE.textDim,
  ring: false,
  ringColor: PREPARE_SKIN.cursorLineMuted,
};

/**
 * 开发中 **且光标在它上面**。
 *
 * ⚠️ 除环色之外与 `DEVELOPING_SKIN` 完全一致：不能因为"光标路过"就把它
 * 画得像可选（需求要的是"灰掉 + 写开发中"）。变的只有**光标环的亮度**。
 */
const DEVELOPING_CURSOR_SKIN: CardSkin = {
  ...DEVELOPING_SKIN,
  ring: true,
  ringColor: PREPARE_SKIN.cursorLineMuted,
};

/**
 * 状态 → 卡片皮肤。**渲染的唯一出处**（`PrepareScreen` 不再自己写 if）。
 */
export function cardSkin(input: CardSkinInput): CardSkin {
  if (input.developing) return input.cursored ? DEVELOPING_CURSOR_SKIN : DEVELOPING_SKIN;

  if (input.selected) {
    return {
      fillColor: PREPARE_SKIN.selectionFill,
      fillAlpha: 0.26,
      strokeColor: PREPARE_SKIN.selectionLine,
      strokeWidth: CARD_STROKE.selected,
      nameColor: PREPARE_SKIN.selectionText,
      /** 光标也在这儿 → 加外环（否则"光标在哪"从这张卡上看不出来）。 */
      ring: input.cursored,
      ringColor: PREPARE_SKIN.cursorLine,
    };
  }

  if (input.cursored) {
    return {
      fillColor: PREPARE_SKIN.cursorFill,
      fillAlpha: 0.1,
      strokeColor: PREPARE_SKIN.cursorLine,
      strokeWidth: CARD_STROKE.cursor,
      nameColor: PALETTE.text,
      ring: false,
      ringColor: PREPARE_SKIN.cursorLine,
    };
  }

  return {
    fillColor: PREPARE_SKIN.idleFill,
    fillAlpha: 0.04,
    strokeColor: PREPARE_SKIN.idleLine,
    strokeWidth: CARD_STROKE.idle,
    nameColor: PALETTE.text,
    ring: false,
    ringColor: PREPARE_SKIN.cursorLine,
  };
}

/* ------------------------------------------------------------------ *
 * 炁机卡皮肤
 * ------------------------------------------------------------------ */

export interface QijiSkin {
  readonly fillColor: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeWidth: number;
  readonly nameColor: number;
  readonly ring: boolean;
  readonly ringColor: number;
  /**
   * 是否画"已开几层"的角标。
   *
   * ⚠️ **只在 `stacks > 1` 时为真**：1 层是默认态，给它角标会让"开了一条"
   * 与"开了三条"看起来差不多 —— 角标的意义就没了。
   */
  readonly badge: boolean;
}

/**
 * 状态 → 炁机卡皮肤（`PrepareScreen` 不再自己写 if）。
 *
 * ==================================================================
 * ⚠️ 为什么与人物卡分开（而不是给 `cardSkin` 多加一个字段）
 * ==================================================================
 *
 * 人物 / Boss 卡是**二选一**（"我选它上场"）：金 = 已确定、冷白 = 光标。
 * 炁机卡是**开关**（不叠层的选一个，叠层的选 0..N 层）：它没有"光标与
 * 选择分离"这回事 —— 开着就是开着，与光标在不在它上面无关。
 *
 * 硬合进 `cardSkin` 会让那个函数同时服务两种语义，而它的**判据**
 * （`selected` vs `stacks`）会变成一个"看 kind 决定读哪个"的分支。
 *
 * ⚠️ **"已开"用金色**（`selectionLine`）：与人物卡的"已确定"是同一个
 * 语义 —— "这个东西**生效了**"。本作里"生效"只有一种颜色。
 */
export function qijiSkin(input: {
  readonly developing: boolean;
  readonly cursored: boolean;
  /** 已叠层数（0 = 没开）。 */
  readonly stacks: number;
}): QijiSkin {
  const on = input.stacks > 0;
  if (input.developing) {
    return {
      fillColor: PREPARE_SKIN.idleFill,
      fillAlpha: 0.02,
      strokeColor: 0x2a2c38,
      strokeWidth: 2,
      nameColor: PALETTE.textDim,
      ring: input.cursored,
      ringColor: PREPARE_SKIN.cursorLineMuted,
      badge: false,
    };
  }
  if (on) {
    return {
      fillColor: PREPARE_SKIN.selectionFill,
      fillAlpha: 0.3,
      strokeColor: PREPARE_SKIN.selectionLine,
      strokeWidth: 2,
      nameColor: PREPARE_SKIN.selectionText,
      /** ⚠️ 开着 + 光标在它上面 → 加外环（否则"光标在哪"看不出来）。 */
      ring: input.cursored,
      ringColor: PREPARE_SKIN.cursorLine,
      badge: input.stacks > 1,
    };
  }
  if (input.cursored) {
    return {
      fillColor: PREPARE_SKIN.cursorFill,
      fillAlpha: 0.1,
      strokeColor: PREPARE_SKIN.cursorLine,
      strokeWidth: CARD_STROKE.cursor,
      nameColor: PALETTE.text,
      ring: false,
      ringColor: PREPARE_SKIN.cursorLine,
      badge: false,
    };
  }
  return {
    fillColor: PREPARE_SKIN.idleFill,
    fillAlpha: 0.04,
    strokeColor: PREPARE_SKIN.idleLine,
    strokeWidth: CARD_STROKE.idle,
    nameColor: PALETTE.text,
    ring: false,
    ringColor: PREPARE_SKIN.cursorLine,
    badge: false,
  };
}

/* ------------------------------------------------------------------ *
 * 开始键皮肤
 * ------------------------------------------------------------------ */

export interface StartSkin {
  readonly fillColor: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeWidth: number;
  readonly labelColor: number;
  /** 见 `CardSkin.ring`（光标停在开始键上时套一圈）。 */
  readonly ring: boolean;
}

/**
 * 状态 → 开始键皮肤。
 *
 * ⚠️ 开始键**没有"选中"态**（它不是二选一里的选项）：光标停在它上面就
 * 只是"在这儿"，按 Enter 才真的开战。所以它只用**光标皮肤**，不借用
 * 卡片的金色选中色 —— 混用会让"金框的按钮"看起来像"已经选中了一个叫
 * 开始战斗的选项"。
 */
export function startSkin(input: {
  readonly developing: boolean;
  readonly cursored: boolean;
}): StartSkin {
  if (input.developing) {
    return {
      fillColor: PREPARE_SKIN.idleFill,
      fillAlpha: 0.04,
      strokeColor: 0x2a2c38,
      strokeWidth: 2,
      labelColor: PALETTE.textDim,
      ring: false,
    };
  }
  if (input.cursored) {
    return {
      fillColor: PREPARE_SKIN.cursorFill,
      fillAlpha: 0.12,
      strokeColor: PREPARE_SKIN.cursorLine,
      strokeWidth: CARD_STROKE.cursor,
      labelColor: PALETTE.text,
      ring: false,
    };
  }
  return {
    fillColor: PREPARE_SKIN.selectionFill,
    fillAlpha: 0.18,
    strokeColor: PREPARE_SKIN.selectionLine,
    strokeWidth: 2,
    labelColor: PALETTE.text,
    ring: false,
  };
}
