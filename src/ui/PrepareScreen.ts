/**
 * **备战界面**：选人物、选对手、开始战斗。
 *
 * ==================================================================
 * 需求
 * ==================================================================
 *
 * "下一步 先做一个 备战界面，选人物 和 选boss，然后点开始才开始，
 * 目前只有这个boss，和目前这个人物，这个人物目前就叫 林晚风。
 * 记得支持键盘和 移动"
 *
 * ==================================================================
 * 设计：两个槽位 + 一个开始键，键盘与触屏**共用一套状态**
 * ==================================================================
 *
 * 焦点是一个**线性游标**（人物 → 对手 → 开始），而不是三块各自维护：
 *   - 键盘：← → 在同一个槽位里换选项，↑ ↓ 换槽位，Enter 开始
 *   - 触屏：点卡片直接选中；点「开始」进入战斗
 *
 * ⚠️ 触屏**不做**"先点选中再点确认"两步 —— 备战界面不是危险操作，
 * 直接点选更顺（与设置页不同：那里改键需要防误触）。
 *
 * ⚠️ 这个界面**不碰引擎**：它只是一组选择 + 一个开始回调。战斗怎么起
 * 由 `main.ts` 决定。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import type { RosterEntry } from '../data/roster';
import {
  PREPARE_LAYOUT,
  cycleSelection,
  moveFocus,
  pickOption,
  prepareHitAreas,
  type PrepareSelection,
} from './prepareLogic';

export interface PrepareScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: (key: string) => string;
  readonly players: readonly RosterEntry[];
  readonly bosses: readonly RosterEntry[];
  readonly initial: { readonly playerId: string; readonly bossId: string };
  /** 点了「开始」。 */
  readonly onStart: (playerId: string, bossId: string) => void;
  /** 选择变了（用于持久化）。 */
  readonly onChange?: (playerId: string, bossId: string) => void;
}

/** 一块可点区域。 */
export interface PrepareHitArea {
  readonly kind: 'player' | 'boss' | 'start';
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export class PrepareScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly title: Label;
  private readonly playerLabel: Label;
  private readonly bossLabel: Label;
  private readonly startLabel: Label;
  private readonly startGfx: Graphics;
  private readonly hint: Label;

  /** 每张卡片的标题 / 副标题 / 说明。 */
  private readonly cards: { readonly name: Label }[] = [];

  private readonly cardGfx: Graphics;
  private readonly startGfxLayer: Graphics;
  private readonly players: readonly RosterEntry[];
  private readonly bosses: readonly RosterEntry[];
  private readonly options: PrepareScreenOptions;

  private selection: PrepareSelection;

  constructor(options: PrepareScreenOptions) {
    this.options = options;
    this.players = options.players;
    this.bosses = options.bosses;
    this.selection = {
      playerId: options.initial.playerId,
      bossId: options.initial.bossId,
      focus: 'player',
    };

    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    /** 整屏底色（备战界面要盖住战斗场景）。 */
    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.root.addChild(this.bg);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: 54,   // 标题基线（见 `prepareLogic` 的布局表）
      size: 32,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.playerLabel = new Label(pixi, {
      x: PREPARE_LAYOUT.pad,
      y: PREPARE_LAYOUT.playerRowY - 22,
      size: FONT.small,
      color: PALETTE.textDim,
    });
    this.bossLabel = new Label(pixi, {
      x: PREPARE_LAYOUT.pad,
      y: PREPARE_LAYOUT.bossRowY - 22,
      size: FONT.small,
      color: PALETTE.textDim,
    });

    /** 卡片底板与「开始」都画在同一层 Graphics 上（少一个对象）。 */
    this.cardGfx = new pixi.Graphics();
    this.startGfxLayer = new pixi.Graphics();
    this.startGfx = new pixi.Graphics();

    this.root.addChild(this.cardGfx, this.playerLabel.root, this.bossLabel.root, this.title.root);

    /** 卡片上的文字（人物在前、Boss 在后，与 `prepareHitAreas` 同序）。 */
    const total = this.players.length + this.bosses.length;
    for (let i = 0; i < total; i += 1) {
      const name = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.title,
        color: PALETTE.text,
        kai: true,
      });
      this.cards.push({ name });
      this.root.addChild(name.root);
    }

    this.startLabel = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: PREPARE_LAYOUT.startY + PREPARE_LAYOUT.startH / 2,
      size: FONT.title,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: PREPARE_LAYOUT.startY + PREPARE_LAYOUT.startH + 26,
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.startGfxLayer, this.startGfx, this.startLabel.root, this.hint.root);

    this.redraw();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    /**
     * ⚠️ 切回来时要**重画一次**：`Label.set` 只在文本变化时写 Pixi，
     * 而"隐藏期间选择被改了"（例如用代码重置）不会自动反映出来。
     */
    if (visible) this.redraw();
  }

  /** 当前选择（`main.ts` 用它起战斗、也用它持久化）。 */
  get current(): PrepareSelection {
    return this.selection;
  }

  /** 键盘：在同槽位内换选项（`delta` = ±1），到边界**不环绕**。 */
  cycle(delta: number): void {
    this.applySelection(cycleSelection(this.selection, this.players, this.bosses, delta));
  }

  /** 键盘：上下换槽位（人物 ↔ 对手 ↔ 开始）。 */
  moveFocus(delta: number): void {
    this.applySelection(moveFocus(this.selection, delta));
  }

  /** 选中某个人物 / 对手。 */
  pick(kind: 'player' | 'boss', id: string): void {
    const next = pickOption(this.selection, this.players, this.bosses, kind, id);
    if (next === this.selection) return;
    this.applySelection(next);
  }

  private applySelection(next: PrepareSelection): void {
    const changed = next.playerId !== this.selection.playerId || next.bossId !== this.selection.bossId;
    this.selection = next;
    this.redraw();
    if (changed) this.options.onChange?.(next.playerId, next.bossId);
  }

  /** Enter / 点「开始」。 */
  start(): void {
    this.options.onStart(this.selection.playerId, this.selection.bossId);
  }

  /**
   * 点一下（逻辑坐标）。
   *
   * @returns 是否消费了这次点击
   */
  hitTest(px: number, py: number): boolean {
    for (const area of prepareHitAreas(this.players, this.bosses)) {
      if (px < area.x || px > area.x + area.w) continue;
      if (py < area.y || py > area.y + area.h) continue;
      if (area.kind === 'start') this.start();
      else this.pick(area.kind, area.id);
      return true;
    }
    return false;
  }

  /** 每帧：只需要在"可见"时保证画面与选择一致（选择是离散的，很便宜）。 */
  frame(): void {
    if (this.root.visible) this.redraw();
  }

  private redraw(): void {
    const t = this.options.translate;
    this.title.set(t('roster.ui.title'));
    this.playerLabel.set(t('roster.ui.playerLabel'));
    this.bossLabel.set(t('roster.ui.bossLabel'));
    this.startLabel.set(t('roster.ui.start'));
    this.hint.set(t('roster.ui.hint'));

    const all = [...this.players, ...this.bosses];
    const areas = prepareHitAreas(this.players, this.bosses);

    this.cardGfx.clear();
    this.cards.forEach((card, i) => {
      const area = areas[i];
      const entry = all[i];
      if (area === undefined || entry === undefined) return;
      const selected =
        (area.kind === 'player' && entry.id === this.selection.playerId) ||
        (area.kind === 'boss' && entry.id === this.selection.bossId);
      const focused = area.kind === this.selection.focus;

      /**
       * ⚠️ 卡片上**只有名字** —— 称号与简介是内容，不由界面顺手编
       * （需求明确纠正过我擅自加"游侠"和一个简介）。
       */
      card.name.set(t(entry.nameKey));
      /** 名字在卡片里**垂直居中**（只有一行，贴顶会显得空）。 */
      card.name.root.x = area.x + 18;
      card.name.root.y = area.y + area.h / 2 - 10;

      /**
       * 选中 = 亮底 + 亮边；焦点 = **更粗的边**。两者可以同时存在：
       * 选中表示"就选它"，焦点表示"键盘现在在这儿"。
       */
      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, 6)
        .fill({
          color: selected ? PALETTE.douqi.base : 0xffffff,
          alpha: selected ? 0.14 : 0.04,
        });
      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, 6)
        .stroke({
          color: selected || focused ? PALETTE.douqi.bright : 0x3c3e50,
          width: focused ? 3 : 2,
          alpha: selected || focused ? 1 : 0.9,
        });
      card.name.setColor(selected ? PALETTE.douqi.bright : PALETTE.text);
    });

    const sr = {
      x: Math.round((PREPARE_LAYOUT.width - PREPARE_LAYOUT.startW) / 2),
      y: PREPARE_LAYOUT.startY,
      w: PREPARE_LAYOUT.startW,
      h: PREPARE_LAYOUT.startH,
    };
    const startFocused = this.selection.focus === 'start';
    this.startGfx.clear();
    this.startGfx
      .roundRect(sr.x, sr.y, sr.w, sr.h, 6)
      .fill({ color: PALETTE.douqi.base, alpha: startFocused ? 0.34 : 0.18 });
    this.startGfx
      .roundRect(sr.x, sr.y, sr.w, sr.h, 6)
      .stroke({ color: PALETTE.douqi.bright, width: startFocused ? 3 : 2 });
    this.startLabel.setColor(startFocused ? PALETTE.douqi.bright : PALETTE.text);
  }
}
