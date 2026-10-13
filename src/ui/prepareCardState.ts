/**
 * **一张卡"该画成什么样"**：从选择 / 光标 / 层数算出 `CardPaint`。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把**状态**（这一格是光标吗 / 是已确定的选择吗 / 炁机开着吗）
 * 翻成**画法**（底色 / 描边 / 名字色 / 要不要外环）。
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

import { cardSkin, qijiSkin, type CardSkin } from './prepareRender';
import { PREPARE_LAYOUT, type PrepareHitArea } from './prepareLayout';
import type { PrepareTarget } from './prepareLogic';
import type { PrepareSectionKind } from './prepareTypes';

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
  /**
   * 这条炁机**开着**没有（人物 / Boss 传 `false`）。
   *
   * ⚠️ 是布尔而不是"几层"：炁机激活是开关（见 `ui/freeQiji.ts` 的文件头）。
   */
  readonly on: boolean;
}

/** 状态 → 卡片外观（两个槽位各走自己的皮肤函数）。 */
export function cardAppearance(input: CardAppearanceInput): CardAppearance {
  if (input.kind === 'qiji') {
    const skin = qijiSkin({
      developing: input.developing,
      cursored: input.cursored,
      on: input.on,
    });
    return { ...skin, showPortrait: false };
  }
  const skin = cardSkin({
    developing: input.developing,
    cursored: input.cursored,
    selected: input.selected,
  });
  return { ...skin, showPortrait: input.kind === 'player' };
}

/* ------------------------------------------------------------------ *
 * 一帧里要画的所有卡（状态 → 一组"画在哪、画成什么样"）
 * ------------------------------------------------------------------ */

/**
 * 一张卡这一帧的完整画法：**位置 + 名字 + 皮肤**（渲染层照着画）。
 */
export interface CardDraw extends CardAppearance {
  readonly kind: PrepareSectionKind;
  readonly id: string;
  /** **已本地化**的名字。 */
  readonly name: string;
  /**
   * 这张卡名字的**字号**（逻辑像素）。
   *
   * ⚠️ 它与位置一样是**几何给的数据**（`prepareLayout` 里按块算），不是
   * 渲染层挑的：名字字号决定"卡片能多窄"（`cardMinW` / `qijiMinW` 的
   * 推导就用它），两处各写一个数必然漂。今天人物 / 对手 17、炁机 15。
   */
  readonly nameSize: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CardDrawsArgs {
  /**
   * 这一帧的可点区域（`prepareLayout.prepareHitAreas` 的产物）。
   *
   * ⚠️ **位置只从这里来**：于是"看到的卡片"与"点中的卡片"结构上是同一个
   * 矩形。手风琴之后它只含**展开那一块**的卡（收起的两块只有块头），
   * 所以"看不见的卡片"根本不在这一份里 —— 不会点中幽灵卡。
   */
  readonly areas: readonly PrepareHitArea[];
  /** 取某个选项**已本地化**的名字。 */
  readonly nameOf: (kind: PrepareSectionKind, id: string) => string;
  /** 光标此刻指着的那一项（`undefined` = 不在任何卡片上）。 */
  readonly cursor: PrepareTarget | undefined;
  /** **已确定**的选择。 */
  readonly selection: { readonly playerId: string; readonly bossId: string };
  /** 某条炁机此刻**开着**没有。 */
  readonly on: (id: string) => boolean;
  /** 这个 id 是不是"开发中"。 */
  readonly developing: (id: string) => boolean;
}

/**
 * 把"这一帧要画的每一张卡"算出来（纯函数，不碰 Pixi）。
 *
 * ⚠️ 它替代了旧版 `PrepareScreen.draw()` 里那段 `areas.map(...)`：那段
 * 内联在装配类里，**只能靠截图看对不对**；抽出来之后可以在 node 里断言
 * "光标在 A、选择在 B 时两张卡各是什么皮肤"（`prepareRender` 那套规则的
 * 第一个消费者）。
 *
 * ⚠️ `'start'` 与 `'summary'` 两种区域**不是卡**，直接跳过
 * （`PrepareHitArea.kind` 的收窄在这里一次做完，别处不用再判）。
 */
export function cardDrawsOf(args: CardDrawsArgs): readonly CardDraw[] {
  const out: CardDraw[] = [];
  for (const area of args.areas) {
    if (area.kind === 'start' || area.kind === 'summary') continue;
    const kind = area.kind;
    const appearance = cardAppearance({
      kind,
      cursored: args.cursor !== undefined && args.cursor.kind === kind && args.cursor.id === area.id,
      selected:
        (kind === 'player' && area.id === args.selection.playerId) ||
        (kind === 'boss' && area.id === args.selection.bossId),
      developing: args.developing(area.id),
      on: kind === 'qiji' ? args.on(area.id) : false,
    });
    out.push({
      ...appearance,
      kind,
      id: area.id,
      name: args.nameOf(kind, area.id),
      nameSize: kind === 'qiji' ? PREPARE_LAYOUT.qijiNameSize : PREPARE_LAYOUT.nameSize,
      x: area.x,
      y: area.y,
      w: area.w,
      h: area.h,
    });
  }
  return out;
}

/** 卡片的"已确定"皮肤类型（`CardAppearance` 由它 + `showPortrait` 拼出来）。 */
export type { CardSkin };
