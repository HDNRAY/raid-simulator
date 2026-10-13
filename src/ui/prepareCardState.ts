/**
 * **一张卡"该画成什么样"**：从选择 / 光标 / 层数算出 `CardPaint`。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把**状态**（这一格是光标吗 / 是已确定的选择吗 / 开了几层）
 * 翻成**画法**（底色 / 描边 / 名字色 / 要不要外环 / 要不要角标）。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * `PrepareScreen` 在这一轮之后同时扛着：输入状态机、卡片绘制、
 * 详情区驱动、页脚。把"逐张卡算皮肤"这段（含两个槽位分支）再留在里面，
 * 那个类就顶到 700 行了。而这一段**是纯函数**（输入几个布尔与数字，
 * 输出一个数据结构）—— 抽出来之后能在 node 里精确测"光标 + 已选中
 * 同时成立时画成什么"，不必起 Pixi。
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | 本文件 | 状态 → 一张卡的外观数据 |
 * | `prepareCards` | 照着那份数据画（Pixi） |
 * | `PrepareScreen` | 光标与选择怎么走 |
 */

import { cardSkin, qijiSkin, type CardSkin, type QijiSkin } from './prepareRender';

/** 一张卡要画成什么样（**位置除外** —— 位置来自命中区，见 `prepareCards.drawAll`）。 */
export interface CardAppearance {
  readonly nameColor: number;
  readonly fillColor: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeWidth: number;
  readonly ring: boolean;
  readonly ringColor: number;
  /**
   * 画"已开"角标（只有炁机卡会为真）。
   *
   * ⚠️ 两个槽位的皮肤类型**不一样**（`CardSkin` 没有 `badge`），所以这里
   * 用**类型守卫**取值而不是 cast（AGENTS.md §1）。
   */
  readonly badge: boolean;
  /**
   * 名字右边那颗对话头像要不要画。
   *
   * ⚠️ 只有"人物卡"为真（需求："**我们 3 个角色**名字的右边"）：
   * 炁机与 Boss 都没有对话头像素材。
   */
  readonly showPortrait: boolean;
}

export interface CardAppearanceInput {
  readonly kind: 'player' | 'qiji' | 'boss';
  /** 光标停在这一格（**与"已确定"是两件事**，见 `prepareRender` 文件头）。 */
  readonly cursored: boolean;
  /** 这一格是**已确定**的选择（人物 / Boss 才有意义）。 */
  readonly selected: boolean;
  /** 这个条目还在开发中（灰掉 + 不能开战）。 */
  readonly developing: boolean;
  /** 这条炁机已叠层数（0 = 没开；人物 / Boss 传 0）。 */
  readonly stacks: number;
}

/** 状态 → 卡片外观（两个槽位各走自己的皮肤函数）。 */
export function cardAppearance(input: CardAppearanceInput): CardAppearance {
  if (input.kind === 'qiji') {
    const skin = qijiSkin({
      developing: input.developing,
      cursored: input.cursored,
      stacks: input.stacks,
    });
    return { ...withoutBadge(skin), badge: skin.badge, showPortrait: false };
  }
  const skin = cardSkin({
    developing: input.developing,
    cursored: input.cursored,
    selected: input.selected,
  });
  return { ...skin, badge: false, showPortrait: input.kind === 'player' };
}

/**
 * 把皮肤里的画法字段摊平（去掉 `badge` —— 它在两个类型里只有一边有，
 * 由调用方按自己的分支补上）。
 */
function withoutBadge(skin: QijiSkin): Omit<CardAppearance, 'badge' | 'showPortrait'> {
  return {
    nameColor: skin.nameColor,
    fillColor: skin.fillColor,
    fillAlpha: skin.fillAlpha,
    strokeColor: skin.strokeColor,
    strokeWidth: skin.strokeWidth,
    ring: skin.ring,
    ringColor: skin.ringColor,
  };
}

/** `CardSkin` 也满足 `withoutBadge` 的形状（类型上显式声明，便于两处对齐）。 */
export type { CardSkin };
