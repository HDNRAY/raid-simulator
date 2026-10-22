/**
 * **选角色屏的三张"详情卡"**（2026-10-22 从 `CharacterSelectScreen` 拆出来）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `CharacterSelectScreen.ts` 加完「开始游戏」按钮后到了 **737 行**（AGENTS §3
 * 的上限 700）。按"先拆 util、不许压注释"的规矩，切出来的这一块是
 * **"一张卡由哪些部件组成、每一帧怎么摆"** —— 它不碰输入、不碰选择状态，
 * 只回答"给定进度，这张卡长什么样"。
 *
 * ⚠️ 屏幕那边只剩"谁被选中 → 目标进度 → 调这一层画"三件事。
 *
 * ==================================================================
 * 一张卡的部件（自下而上）
 * ==================================================================
 *
 * ```
 *   holder（卡片容器；局部原点 = 卡片左上角）
 *     ├─ skin        底色 + 边框（金边只属于展开那张）
 *     ├─ portrait    收起时短条上的小头像（复用 PortraitSprite）
 *     ├─ name        收起时短条上的名字（展开时淡出：详情自带标题）
 *     └─ detailHolder  详情内容（被 mask 裁住；每帧按高度平移对齐）
 *          └─ PrepareDetailController.root
 * ```
 *
 * ⚠️ 遮罩节点挂在 **holder** 里、再 `detailHolder.mask = mask`：
 * `detailHolder` 被平移 (-624,-88) 去对齐详情内容，遮罩若挂在它身上会跟着
 * 平移 ⇒ 落到画布外、把内容整块裁掉（实测踩到过：展开后一片空白）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { CARD_RADIUS } from './prepareRender';
import { detailRect } from './prepareGeometry';
import { drawViewportClip } from './viewportMask';
import { PrepareDetailController } from './prepareDetailController';
import { PORTRAIT_PIXELS, portraitFor } from '../render/portraitAssets';
import { PortraitSprite } from '../render/portraitSprite';
import {
  CHARACTER_CARD_LAYOUT,
  characterCardRect,
  type CharacterCardColumn,
} from './characterSelectLogic';
import type { DetailContext } from './prepareDetail';
import type { TranslateFn } from '../i18n/translator';

/** 一张卡的**视图部件**（每张卡一套；没有"共享的详情面板"）。 */
export interface CardView {
  readonly id: string;
  readonly column: CharacterCardColumn;
  /** 卡片容器（局部原点 = 卡片左上角）。 */
  readonly holder: Container;
  /** 卡片底色 + 边框。 */
  readonly skin: Graphics;
  /** 收起时那个短条上的名字。 */
  readonly name: Label;
  /** 收起时短条上的**小头像**（与详情面板同一个 `PortraitSprite`）。 */
  readonly portrait: PortraitSprite | undefined;
  /** 详情内容的平移层。 */
  readonly detailHolder: Container;
  readonly panel: PrepareDetailController;
  /** 详情内容的遮罩（每帧重画成"这张卡现在的矩形"）。 */
  readonly mask: Graphics;
}

/** 造三张卡（部件一次性装配；之后每帧只调 `paintCard`）。 */
export function buildCardViews(args: {
  readonly pixi: PixiCtor;
  readonly parent: Container;
  readonly translate: TranslateFn;
  readonly context: DetailContext;
  readonly players: readonly { readonly id: string; readonly nameKey: string }[];
  readonly columns: readonly CharacterCardColumn[];
}): readonly CardView[] {
  const { pixi } = args;
  return args.players.map((player, index) => {
    const column = args.columns[index] ?? { x: 0, w: CHARACTER_CARD_LAYOUT.w };
    const holder = new pixi.Container();
    holder.x = column.x;
    args.parent.addChild(holder);

    const skin = new pixi.Graphics();
    holder.addChild(skin);

    /**
     * **收起态的小头像**（用户 2026-10-22："收起时也要显示头像"）。
     * ⚠️ 复用详情面板那颗 `PortraitSprite`（**唯一**的头像渲染），只是 box
     * 小一些 —— 不另找一份素材表、也不自己画图片。
     */
    const asset = portraitFor(player.id);
    const portrait = asset === undefined
      ? undefined
      : new PortraitSprite(pixi, holder, asset, PORTRAIT_BOX);

    const name = new Label(pixi, {
      x: 0,
      y: 0,
      size: FONT.title,
      color: PALETTE.text,
      anchorX: 0,
      anchorY: 0.5,
      kai: true,
    });
    if (portrait !== undefined) portrait.root.alpha = 1;
    holder.addChild(name.root);

    const detailHolder = new pixi.Container();
    holder.addChild(detailHolder);
    const panel = new PrepareDetailController({
      pixi,
      translate: args.translate,
      context: args.context,
      parent: detailHolder,
    });
    const mask = new pixi.Graphics();
    /** ⚠️ 遮罩挂在 **holder** 里（见文件头那条坑），再指给 `detailHolder`。 */
    holder.addChild(mask);
    detailHolder.mask = mask;

    return { id: player.id, column, holder, skin, name, portrait, detailHolder, panel, mask };
  });
}

/** 短条上那颗小头像的显示边长（详情面板那颗的 0.6 倍）。 */
const PORTRAIT_BOX = Math.round(PORTRAIT_PIXELS * 0.6);

/**
 * 画一张卡（**唯一**写这张卡几何的地方）。
 *
 * @param progress 这张卡此刻的展开进度（0 = 短条 / 1 = 完整详情）
 * @param focused 是不是"选中"那张（决定底色深浅；**金边只由 progress 决定**）
 */
export function paintCard(args: {
  readonly card: CardView;
  readonly progress: number;
  readonly focused: boolean;
  readonly nameKey: string;
  readonly translate: TranslateFn;
}): void {
  const { card, focused } = args;
  const eased = args.progress;
  const rect = characterCardRect(card.column, eased);

  /** 卡片容器：x 固定（列），y 由"每张卡各自垂直居中"给出。 */
  card.holder.x = card.column.x;
  card.holder.y = rect.y;

  /**
   * 底色 + 边框。
   * ⚠️ **金边只属于"展开"那张**（用户 2026-10-22："黄/金边框只出现在展开
   * 那张卡上"）：按 `eased` 插值透明度，收起态必须是 0。
   */
  card.skin.clear();
  card.skin
    .roundRect(0, 0, rect.w, rect.h, CARD_RADIUS)
    .fill({
      color: focused ? PALETTE.panel : PALETTE.panelLine,
      alpha: focused ? 0.55 : 0.35,
    });
  if (eased > 0.02) {
    card.skin
      .roundRect(0, 0, rect.w, rect.h, CARD_RADIUS)
      .stroke({ color: PALETTE.douqi.base, width: 2, alpha: eased });
  } else {
    /** 收起的两张：中性细边（不是金色，也不是"光标框"）。 */
    card.skin
      .roundRect(0, 0, rect.w, rect.h, CARD_RADIUS)
      .stroke({ color: PALETTE.panelLine, width: 1 });
  }

  /**
   * 短条上的头像 + 名字：展开时淡出（详情自带标题，不能叠字）。
   * ⚠️ 短条在卡片**底部**（卡片向上长），所以 y 跟着 `rect.h` 走。
   */
  const barCenterY = rect.h - CHARACTER_CARD_LAYOUT.barH / 2;
  const barLeft = 14;
  if (card.portrait !== undefined) {
    card.portrait.root.x = barLeft + PORTRAIT_BOX / 2;
    card.portrait.root.y = barCenterY;
    card.portrait.root.alpha = 1 - eased;
    card.portrait.root.visible = eased < 0.98;
  }
  card.name.root.x = barLeft + PORTRAIT_BOX + 14;
  card.name.root.y = barCenterY;
  card.name.root.alpha = 1 - eased;
  card.name.root.visible = eased < 0.98;
  card.name.set(args.translate(args.nameKey));

  /**
   * 详情内容：底部对齐到卡片底边（`h - fullH`），再减掉它自己的绝对原点
   * `detailRect()` ⇒ 内容在卡片局部坐标里正好铺满整张卡。
   */
  const detail = detailRect();
  card.detailHolder.x = -detail.x;
  card.detailHolder.y = rect.h - detail.h - detail.y;
  card.detailHolder.alpha = eased;

  /** 遮罩 = 这张卡**现在**的矩形（局部坐标；每帧重画）。 */
  drawViewportClip(card.mask, { x: 0, y: 0, w: rect.w, h: rect.h });

  /** 每张卡固定显示**自己**那个人（不跟 hover / 光标）。 */
  card.panel.update({ kind: 'player', id: card.id });
}
