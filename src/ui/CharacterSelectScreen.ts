/**
 * **选角色屏**：从 3 个角色里选 1 个，开始一局肉鸽。
 *
 * ==================================================================
 * 需求（用户 2026-10-12 定的流程）
 * ==================================================================
 *
 * 用户原话："有一个**新的首页**……然后进入肉鸽 才是**选角色**" +
 * "从**现有的 3 个角色**里选（林晚风 / 凯丽 / 黛玄）" +
 * "⚠️ 现在只有**林晚风**能玩，另两个在 `DEVELOPING` 里 →
 * 复用备战界面既有那套「**开发中 → 灰掉**」的做法"。
 *
 * ⚠️ **它不是默认入口**（首页才是）：肉鸽那条路还不完整
 * （炁机选择是 P3、强度曲线是 P4/P5、7 个 Boss 只有 2 个能打）。
 *
 * ==================================================================
 * 交互：**与备战界面共用同一套光标模型**（`prepareLogic`）
 * ==================================================================
 *
 *   - ← →：在卡片间**移动光标**（不改选择，到两端停住）
 *   - Enter：**确定光标处的角色并开始一局**（设计稿 §3.1/§3.5：
 *     CharacterSelect --Enter--> Battle）
 *   - 触屏 / 鼠标：**点卡片 = 移光标 + 确定 + 开始**（一步到位）
 *
 * ⚠️ 键盘一次 Enter、触屏一次点击 —— **数量相同**，满足 AGENTS.md §3b
 * 的"功能对等"。这也是为什么这里**没有**独立的「开始」按钮：
 * 多一个按钮就要多一步，而"点卡片开始"与"Enter 开始"仍然是对等的。
 *
 * ⚠️ **选中"开发中"的角色不会开始**（需求："不能开始战斗（选中它们时
 * 点开始应当无效，或给明确反馈）"）。反馈由底部那行文案给出 ——
 * 它与卡片上的"开发中"**共用同一个 i18n key**（不一致的两句话会让人
 * 以为它们在说两件事，备战界面记着这条）。
 *
 * ==================================================================
 * ⚠️ 临时桩（P2 只跑**一场**）
 * ==================================================================
 *
 * 本屏"开始"之后只打**一场战斗**，结算完回到本屏（而不是推进一局肉鸽）。
 * 这是**刻意的桩**：炁机选择是 P3，所以 P3 才会把它接成
 * "N 场 + 炁机选择"。**不要**为了"看起来完整"而在这里假装有炁机选择。
 * 具体的一次性行为在 `app/runSession.ts`（那里也标了同一个桩）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { isDeveloping, type RosterEntry } from '../data/roster';
import { CARD_RADIUS, CARD_STROKE, CURSOR_RING_GAP, PREPARE_SKIN, cardSkin } from './prepareRender';
import {
  CHARACTER_SELECT_LAYOUT,
  canStartRun,
  characterCursorTarget,
  characterSelectHitAreas,
  characterSelection,
  confirmCharacter,
  cycleCharacter,
  pickCharacter,
} from './characterSelectLogic';
import type { PrepareSelection } from './prepareLogic';
import type { TranslateFn } from '../i18n/translator';

export interface CharacterSelectScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /** 候选角色（顺序 = 卡片顺序）。 */
  readonly players: readonly RosterEntry[];
  /** 初始已确定的角色（上次出战的那个）。 */
  readonly initialPlayerId: string;
  /** 是否显示键位提示（触屏为假）。见 `HomeScreenOptions.showKeyHints`。 */
  readonly showKeyHints: () => boolean;
  /** 点右上角的齿轮（打开设置）。见 `HomeScreenOptions.onGear`。 */
  readonly onGear: () => void;
  /** 点左上角的返回箭头（回首页）—— 触屏对等靠它（AGENTS.md §3b）。 */
  readonly onBack?: (() => void) | undefined;
  /** `F1` 的显示名（齿轮的键位提示）。 */
  readonly f1Label: () => string;
  /** 用这个角色开始一局肉鸽。 */
  readonly onStart: (playerId: string) => void;
}

/**
 * 选角色屏要拼上去的**键名**（键名不进 i18n，见 AGENTS.md §3b 与
 * `HomeScreen` 里同名常量的说明）。
 */
const SELECT_KEY_HINT = '← → · Enter';

export class CharacterSelectScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly title: Label;
  private readonly hint: Label;
  private readonly cardGfx: Graphics;
  private readonly cards: { readonly name: Label; readonly status: Label }[] = [];
  /**
   * **本屏自己的边角控件**：右上角的齿轮 + 左上角的返回箭头。
   *
   * ⚠️ 用户 2026-10-12："多个页面的齿轮，应该分别定义"、"stage 上理论上
   * 不挂任何小组件" —— 所以两个按钮都在本屏的 root 里，显隐与缩放都跟着
   * 本屏走（不再是挂在 stage 上、靠 `setScreen` 挪位置的那一个）。
   */
  readonly chrome: ScreenChrome;
  private readonly players: readonly RosterEntry[];
  private readonly options: CharacterSelectScreenOptions;

  private selection: PrepareSelection;

  constructor(options: CharacterSelectScreenOptions) {
    this.options = options;
    this.players = options.players;
    this.selection = characterSelection(options.initialPlayerId);

    const { pixi } = options;
    this.root = new pixi.Container();
    this.root.visible = false;

    /** 整屏底色（与备战界面一致：这个界面要盖住战斗场景）。 */
    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.root.addChild(this.bg);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: 54,
      size: 32,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.cardGfx = new pixi.Graphics();
    this.root.addChild(this.cardGfx, this.title.root);

    /**
     * 每张卡两行：名字 + **状态行**（开发中）。状态行**常驻存在**、
     * 只在需要时填字 —— 每帧新建 / 销毁 Label 会让 Pixi 反复重建纹理
     * （`PrepareScreen` 记着这条）。
     */
    for (let i = 0; i < this.players.length; i += 1) {
      const name = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.title,
        color: PALETTE.text,
        kai: true,
      });
      const status = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.small,
        color: PALETTE.textDim,
      });
      this.cards.push({ name, status });
      this.root.addChild(name.root, status.root);
    }

    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      /**
       * ⚠️ 位置由布局表算出来（`height - 100`），不写死 `440`：
       * 卡片行的 y 一改，提示就该跟着走，而两处各写一个数字必然漂。
       */
      y: CHARACTER_SELECT_LAYOUT.height - 100,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.hint.root);

    /** 齿轮 + 返回箭头（最后加 = 最上层；见 `HomeScreen` 里同一条说明）。 */
    this.chrome = new ScreenChrome({
      pixi,
      showKeyHints: options.showKeyHints,
      f1Label: options.f1Label,
      onGear: options.onGear,
      onBack: options.onBack,
    });
    this.root.addChild(this.chrome.root);

    this.redraw();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (visible) this.redraw();
  }

  /** 当前选择 + 光标（调试入口读它）。 */
  get current(): PrepareSelection {
    return this.selection;
  }

  /** ← →：**只移动光标**（不改已确定的角色）。 */
  cycle(delta: number): void {
    const next = cycleCharacter(this.selection, this.players, delta);
    if (next === this.selection) return;
    this.selection = next;
    this.redraw();
  }

  /**
   * Enter：确定光标处的角色；能开始就开始一局。
   *
   * ⚠️ 光标**已经**在已确定的角色上时，`confirmCharacter` 返回同一个对象
   * （它有意的"没变化就别重画"），这里仍然要 `begin()` —— 否则
   * "选中的是林晚风、光标也在林晚风上，按 Enter 没反应"。
   */
  confirm(): void {
    const next = confirmCharacter(this.selection, this.players);
    if (next !== this.selection) {
      this.selection = next;
      this.redraw();
    }
    this.begin();
  }

  /** 点卡片：移光标 + 确定 + 开始（一步到位；开发中的角色只会被选中）。 */
  pick(id: string): void {
    const next = pickCharacter(this.selection, this.players, id);
    if (next !== this.selection) {
      this.selection = next;
      this.redraw();
    }
    this.begin();
  }

  /** 点一下（逻辑坐标）。@returns 是否消费了这次点击 */
  hitTest(px: number, py: number): boolean {
    /** ⚠️ 齿轮 / 返回箭头先于卡片（顺序即优先级，见 `HomeScreen.hitTest`）。 */
    if (this.chrome.hitTest(px, py)) return true;
    for (const area of characterSelectHitAreas(this.players)) {
      if (px < area.x || px > area.x + area.w) continue;
      if (py < area.y || py > area.y + area.h) continue;
      this.pick(area.id);
      return true;
    }
    return false;
  }

  /** 每帧：只在可见时保证画面与选择一致。 */
  frame(): void {
    if (this.root.visible) {
      this.redraw();
      this.chrome.update();
    }
  }

  /**
   * **UI 缩放**：本屏只转发给**它自己的**边角控件（与 `HomeScreen` 同一条）。
   *
   * ⚠️ 卡片与标题**不随缩放**（现状如此）：这一屏是满屏布局，卡片位置由
   * `CHARACTER_SELECT_LAYOUT` 定死；只有浮在界面之上的齿轮 / 返回箭头要
   * 跟别的界面保持一致的大小。
   */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  /**
   * 真正开始一局。
   *
   * ⚠️ **开发中的角色不开局**（需求）。反馈由 `redraw` 里那行常驻提示给出 ——
   * 玩家点之前就看得见，不是"点了没反应"。
   */
  private begin(): void {
    if (!canStartRun(this.selection, isDeveloping)) return;
    this.options.onStart(this.selection.playerId);
  }

  private redraw(): void {
    const t = this.options.translate;
    /** 已确定的角色是不是开发中 —— 决定底部提示写操作说明还是"开发中"。 */
    const developing = !canStartRun(this.selection, isDeveloping);

    this.title.set(t('screen.characterSelect.title'));
    /**
     * 提示 = 标签 + （键名）；**选中开发中的角色时换成"开发中"**
     * （需求："不能开始战斗……或给明确反馈"），与卡片上的状态行同一个 key。
     */
    const keys = this.options.showKeyHints() ? t('screen.keyHint', { keys: SELECT_KEY_HINT }) : '';
    this.hint.set(developing ? t('roster.ui.developing') : `${t('screen.characterSelect.hint')}${keys}`);
    this.hint.setColor(developing ? PREPARE_SKIN.selectionText : PALETTE.textDim);

    const areas = characterSelectHitAreas(this.players);
    const cursorAt = characterCursorTarget(this.selection, this.players);

    this.cardGfx.clear();
    this.cards.forEach((card, i) => {
      const area = areas[i];
      const entry = this.players[i];
      if (area === undefined || entry === undefined) return;
      /**
       * ⚠️ 三态与备战界面**完全同源**（这是"复用同一套"的落点）：
       * `selected` 只认已确定的角色，`cursored` 只认光标 —— 两者可以分离。
       * 皮肤来自 `prepareRender.cardSkin()`（纯函数、有单测）。
       */
      const selected = entry.id === this.selection.playerId;
      const cursored = cursorAt !== undefined && cursorAt.id === entry.id;
      const soon = isDeveloping(entry.id);
      const skin = cardSkin({ developing: soon, cursored, selected });

      card.name.set(t(entry.nameKey));
      card.name.setColor(skin.nameColor);
      card.status.set(soon ? t('roster.ui.developing') : '');
      card.name.root.x = area.x + 18;
      card.status.root.x = area.x + 18;
      if (soon) {
        card.name.root.y = area.y + area.h / 2 - 22;
        card.status.root.y = area.y + area.h / 2 + 4;
      } else {
        card.name.root.y = area.y + area.h / 2 - 10;
        card.status.root.y = area.y + area.h / 2 + 16;
      }

      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .fill({ color: skin.fillColor, alpha: skin.fillAlpha });
      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .stroke({ color: skin.strokeColor, width: skin.strokeWidth });
      /**
       * 外环：光标 + 选择同一张卡（卡片本身是金的，环标出光标）、
       * 或光标落在开发中的卡上（那张卡整体压暗，没有环看不出来）——
       * 与 `PrepareScreen` 同一段理由，见 `prepareRender.CardSkin.ring`。
       */
      if (skin.ring) {
        this.cardGfx
          .roundRect(
            area.x - CURSOR_RING_GAP,
            area.y - CURSOR_RING_GAP,
            area.w + CURSOR_RING_GAP * 2,
            area.h + CURSOR_RING_GAP * 2,
            CARD_RADIUS + CURSOR_RING_GAP,
          )
          .stroke({ color: skin.ringColor, width: CARD_STROKE.cursor });
      }
    });
  }
}
