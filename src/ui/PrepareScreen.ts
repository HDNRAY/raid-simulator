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
 *   - 键盘：← → 在同一个槽位里**移动光标**，↑ ↓（或 Tab）换槽位，
 *     **Enter 确定选择**（见下）
 *   - 触屏 / 鼠标：点卡片 = **移光标 + 确定**（一步到位）；点「开始」进入战斗
 *
 * ⚠️ 触屏**不做**"先点选中再点确认"两步 —— 备战界面不是危险操作，
 * 直接点选更顺（与设置页不同：那里改键需要防误触）。但**键盘**必须
 * 两步：需求原话"用 enter 来确定选择，而不是靠移动到下一项"。
 * 两者不矛盾：方向键**只移动光标**，点击**一次就是确定** —— 这样触屏
 * 也有"确定"这个动作，满足 AGENTS.md §3b「触屏与键盘功能必须对等」。
 *
 * ⚠️ 这个界面**不碰引擎**：它只是一组选择 + 一个开始回调。战斗怎么起
 * 由 `main.ts` 决定。
 *
 * ==================================================================
 * ⚠️ 光标（cursor）≠ 选择（selection）
 * ==================================================================
 *
 * 需求（用户）："选中 和 目前光标 目前颜色是一样的" +
 * "用 enter 来确定选择，而不是靠移动到下一项"。
 *
 * 改之前两者是同一个东西（焦点在哪一格，哪一格就变金色），所以这次：
 *   - `PrepareSelection.cursor`：光标停在哪一项，方向键只动它
 *   - `PrepareSelection.playerId` / `bossId`：**按 Enter 才写**，才是上场的
 *   - 两者的外观差异**不在这个文件里手写** —— 全部走 `prepareRender.ts`
 *     的 `cardSkin()`，那里也是单测覆盖的对象（见那个文件头的表）
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { isDeveloping, type RosterEntry } from '../data/roster';
import type { TranslateFn } from '../i18n/translator';
import {
  PREPARE_LAYOUT,
  canStartBattle,
  confirmCursor,
  cursorFromSelection,
  cursorTarget,
  cycleCursor,
  moveFocus,
  pickOption,
  prepareHitAreas,
  type PrepareSelection,
} from './prepareLogic';
import {
  CARD_RADIUS,
  CARD_STROKE,
  CURSOR_RING_GAP,
  PREPARE_SKIN,
  cardSkin,
  startSkin,
} from './prepareRender';

export interface PrepareScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn,
  readonly players: readonly RosterEntry[];
  readonly bosses: readonly RosterEntry[];
  readonly initial: { readonly playerId: string; readonly bossId: string };
  /** 是否显示键位提示（触屏为假）。见 `HomeScreenOptions.showKeyHints`。 */
  readonly showKeyHints: () => boolean;
  /** 点右上角的齿轮（打开设置）。见 `HomeScreenOptions.onGear`。 */
  readonly onGear: () => void;
  /** 点左上角的返回箭头（回首页）—— 触屏对等靠它（AGENTS.md §3b）。 */
  readonly onBack?: (() => void) | undefined;
  /** `F1` 的显示名（齿轮的键位提示）。 */
  readonly f1Label: () => string;
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
  /**
   * 页脚的**第三方素材声明**（页脚常驻）。
   *
   * ⚠️ 它是**权利归属的标示**，不是装饰 —— 本项目角色素材取自
   * 《炎龍騎士團2》（漢堂國際 1995）。文案在 `roster.ui.notice`，
   * 理由与"什么时候该删掉它"写在那里。
   */
  private readonly notice: Label;

  /** 每张卡片的标题 / 副标题 / 说明。 */
  private readonly cards: { readonly name: Label; readonly status: Label }[] = [];

  /**
   * **本屏自己的边角控件**：右上角的齿轮 + 左上角的返回箭头。
   *
   * ⚠️ 用户 2026-10-12："多个页面的齿轮，应该分别定义"、"stage 上理论上
   * 不挂任何小组件" —— 两个按钮都在本屏的 root 里，显隐与缩放跟着本屏走。
   */
  readonly chrome: ScreenChrome;

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
      /** 进界面时光标与已确定的选择**重合**（上次选了谁就停在谁身上）。 */
      cursor: cursorFromSelection(options.initial),
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

    /**
     * 卡片上的文字（人物在前、Boss 在后，与 `prepareHitAreas` 同序）。
     *
     * 每张卡两行：名字 + **状态行**（开发中）。状态行**常驻存在**、
     * 只在需要时填字 —— 每帧新建/销毁 Label 会让 Pixi 反复重建纹理。
     */
    const total = this.players.length + this.bosses.length;
    for (let i = 0; i < total; i += 1) {
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
    /**
     * 页脚声明：贴屏幕**底边**，与「开始」按钮/提示拉开距离。
     *
     * ⚠️ 字号用 `FONT.small`（13）而不是 `FONT.tiny`（11）—— 见 `layout.ts`
     * 的字号表：**中文有 13 的下限**，11 只给拉丁/数字。
     */
    this.notice = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: LOGICAL.height - 18,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(
      this.startGfxLayer,
      this.startGfx,
      this.startLabel.root,
      this.hint.root,
      this.notice.root,
    );

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

  /**
   * 键盘：在同槽位里**移动光标**（`delta` = ±1），到边界**不环绕**。
   *
   * ⚠️ **不改选择**。要它变成选择得按 Enter（`commit`）。
   */
  cycle(delta: number): void {
    this.applyCursor(cycleCursor(this.selection, this.players, this.bosses, delta));
  }

  /**
   * 键盘：上下换槽位（人物 ↔ 对手 ↔ 开始）。
   *
   * `wrap` 给 Tab / Shift+Tab 用（环绕），方向键不环绕。
   */
  moveFocus(delta: number, wrap = false): void {
    this.applyCursor(
      moveFocus(this.selection, delta, {
        wrap,
        players: this.players,
        bosses: this.bosses,
      }),
    );
  }

  /**
   * Enter：把**光标处**的选项**确定**下来。
   *
   * @returns 光标是否停在「开始战斗」上（调用方据此决定要不要开战）
   */
  commit(): boolean {
    const next = confirmCursor(this.selection, this.players, this.bosses);
    if (next !== this.selection) {
      this.applySelection(next, true);
      return false;
    }
    /**
     * 光标在「开始战斗」上（或已经确定过同一项）→ 交给调用方。
     *
     * ⚠️ 不能只看 `focus === 'start'`：光标在卡片上、而那一项**恰好就是**
     * 已确定的选择时，`confirmCursor` 也返回同一个对象（这是它有意的
     * "没变化就别重画"）—— 那时按 Enter 应当是"没反应"，而不是"开战"。
     */
    return this.selection.focus === 'start' && cursorTarget(this.selection, this.players, this.bosses) === undefined;
  }

  /**
   * 键盘 / 触屏：**确定当前光标处的那一项**，若光标停在「开始战斗」
   * 上就直接开战。`main.ts` 的 Enter 走这里。
   */
  confirm(): void {
    if (this.commit()) this.start();
  }

  /** 选中某个人物 / 对手（点卡片 = 移光标 + 确定）。 */
  pick(kind: 'player' | 'boss', id: string): void {
    const next = pickOption(this.selection, this.players, this.bosses, kind, id);
    if (next === this.selection) return;
    this.applySelection(next, true);
  }

  /**
   * 只把**焦点**移到某个槽位（同 Tab / 方向键到达那里之后的那个状态）。
   *
   * ⚠️ 与 `moveFocus` 的区别是"直接指定"而不是"相对移动"：调试入口
   * （`main.ts` 的 `window.__raidBattle.prepare`）用它一步把画面推到
   * "光标在这一行、选择在另一行"的状态再截图，省掉"按几次方向键"的脆弱脚本。
   */
  focusSlot(slot: 'player' | 'boss' | 'start'): void {
    if (slot === this.selection.focus) return;
    this.applyCursor({ ...this.selection, focus: slot });
  }

  /**
   * 当前选择里有没有**开发中**的单位。
   *
   * ⚠️ **可以选中、不能开战**（需求："备战界面里灰掉，写开发中" +
   * "不能开始战斗（选中它们时点开始应当无效，或给明确反馈）"）。
   * 如果连选都不让选，玩家就永远看不到"灰掉 + 开发中"这个状态，
   * 只会以为这个角色根本不存在。
   *
   * 规则本身在 `prepareLogic.canStartBattle`（纯函数，可单测）。
   */
  private get developing(): boolean {
    return !canStartBattle(this.selection, isDeveloping);
  }

  /**
   * ⚠️ **光标移动不改选择**，所以这里**不发 `onChange`**。
   *
   * 需求："用 enter 来确定选择，而不是靠移动到下一项"。如果这里也通知，
   * 调用方（`main.ts` → 存储）就会在"光标只是路过"时把选择持久化下来 ——
   * 下次进来选中的是"路过的那一个"，而不是玩家按 Enter 定的那个。
   */
  private applyCursor(next: PrepareSelection): void {
    if (next === this.selection) return;
    this.selection = next;
    this.redraw();
  }

  /**
   * 写入**已经确定**的选择（Enter / 点击）。
   *
   * `notify` 为真时通知 `onChange` 持久化 —— 只有"确定"这个动作才配写存储。
   */
  private applySelection(next: PrepareSelection, notify: boolean): void {
    const changed = next.playerId !== this.selection.playerId || next.bossId !== this.selection.bossId;
    this.selection = next;
    this.redraw();
    if (notify && changed) this.options.onChange?.(next.playerId, next.bossId);
  }

  /**
   * Enter / 点「开始」。
   *
   * ⚠️ **开发中的单位不能开战**（需求）。这里直接返回，不调 `onStart` ——
   * 反馈由界面上那行"开发中，暂不能出战"给出（它在 `redraw` 里常驻，
   * 玩家点之前就看得见）。
   */
  start(): void {
    if (this.developing) return;
    this.options.onStart(this.selection.playerId, this.selection.bossId);
  }

  /**
   * 点一下（逻辑坐标）。
   *
   * @returns 是否消费了这次点击
   */
  hitTest(px: number, py: number): boolean {
    /** ⚠️ 齿轮 / 返回箭头先于卡片（顺序即优先级，见 `HomeScreen.hitTest`）。 */
    if (this.chrome.hitTest(px, py)) return true;
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
    if (this.root.visible) {
      this.redraw();
      this.chrome.update();
    }
  }

  /**
   * **UI 缩放**：本屏只转发给**它自己的**边角控件（与 `HomeScreen` 同一条）。
   *
   * ⚠️ 卡片 / 标题 / 开始按钮**不随缩放**（现状如此）：这一屏的位置由
   * `PREPARE_LAYOUT` 定死，重排它是一次独立的重构；只有浮在界面之上的
   * 齿轮 / 返回箭头要跟别的界面保持一致的大小。
   */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  private redraw(): void {
    const t = this.options.translate;
    const developing = this.developing;
    this.title.set(t('roster.ui.title'));
    this.playerLabel.set(t('roster.ui.playerLabel'));
    this.bossLabel.set(t('roster.ui.bossLabel'));
    this.startLabel.set(t('roster.ui.start'));
    /**
     * 提示行：正常时是操作说明；**选中开发中的单位时换成反馈**
     * （需求："不能开始战斗（选中它们时点开始应当无效，或给明确反馈）"）。
     *
     * ⚠️ 复用卡片上那句"开发中"文案（同一个 i18n key）——
     * 不一致的两句话会让人以为它们在说两件事。
     */
    this.hint.set(developing ? t('roster.ui.developing') : t('roster.ui.hintCursor'));
    this.notice.set(t('roster.ui.notice'));

    const all = [...this.players, ...this.bosses];
    const areas = prepareHitAreas(this.players, this.bosses);
    /** 光标此刻落在哪一项（`start` 槽位 / 空槽位时为 undefined）。 */
    const cursorAt = cursorTarget(this.selection, this.players, this.bosses);

    this.cardGfx.clear();
    this.cards.forEach((card, i) => {
      const area = areas[i];
      const entry = all[i];
      if (area === undefined || entry === undefined) return;
      /**
       * ⚠️ 三态**各自独立**：一张卡可以同时是"光标在"与"已选中"。
       *
       * `selected` 只认选择（Enter 写进去的那个），`cursored` 只认光标 ——
       * 判据不共用是这一版的核心（旧版两者都只看 `focus`，所以看不出区别）。
       */
      const selected =
        (area.kind === 'player' && entry.id === this.selection.playerId) ||
        (area.kind === 'boss' && entry.id === this.selection.bossId);
      const cursored = cursorAt !== undefined && cursorAt.kind === area.kind && cursorAt.id === entry.id;
      /** 这个条目还没做完 —— 灰掉 + 标"开发中"（见 `start()` 的说明）。 */
      const soon = isDeveloping(entry.id);
      const skin = cardSkin({ developing: soon, cursored, selected });

      /**
       * ⚠️ 卡片上**只有名字**（+ 开发中的状态行）—— 称号与简介是内容，
       * 不由界面顺手编（需求明确纠正过我擅自加"游侠"和一个简介）。
       */
      card.name.set(t(entry.nameKey));
      card.name.setColor(skin.nameColor);
      card.status.set(soon ? t('roster.ui.developing') : '');
      /**
       * 卡里两行的位置：名字在上、状态在下。
       * ⚠️ 状态行**置空也要摆位置**：`Label.set('')` 只是不显示文字，
       * 留着旧坐标会让"先选开发中、再选正常的卡片"时残影错位。
       */
      card.name.root.x = area.x + 18;
      card.status.root.x = area.x + 18;
      if (soon) {
        card.name.root.y = area.y + area.h / 2 - 22;
        card.status.root.y = area.y + area.h / 2 + 4;
      } else {
        card.name.root.y = area.y + area.h / 2 - 10;
        card.status.root.y = area.y + area.h / 2 + 16;
      }

      /**
       * 皮肤来自 `prepareRender.cardSkin()`（纯函数、有单测）。
       * 这里的注释只说"画法为什么是这样"，颜色语义在那边。
       */
      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .fill({ color: skin.fillColor, alpha: skin.fillAlpha });
      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .stroke({ color: skin.strokeColor, width: skin.strokeWidth });

      /**
       * **需要外环**的两种情况（见 `CardSkin.ring`）：
       *   1. 光标 + 选择同一张卡 —— 卡片本身是金的，环标出光标
       *   2. 光标落在"开发中"的卡上 —— 那张卡整体压暗，没有环就看不出来
       *
       * ⚠️ 环画在卡片**外侧**（外扩 `CURSOR_RING_GAP`）：画在内侧会和
       * 卡片自己的描边叠在一起，看起来只是"那条边变粗了"。
       * 环色由皮肤给（两种情况亮度不同，见 `prepareRender`）。
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

    const sr = {
      x: Math.round((PREPARE_LAYOUT.width - PREPARE_LAYOUT.startW) / 2),
      y: PREPARE_LAYOUT.startY,
      w: PREPARE_LAYOUT.startW,
      h: PREPARE_LAYOUT.startH,
    };
    /**
     * 「开始战斗」只有光标态（它不是选项，没有"已选中"）——
     * 见 `prepareRender.startSkin()` 的说明。
     */
    const startCursor = this.selection.focus === 'start';
    const ss = startSkin({ developing, cursored: startCursor });
    this.startGfx.clear();
    this.startGfx
      .roundRect(sr.x, sr.y, sr.w, sr.h, CARD_RADIUS)
      .fill({ color: ss.fillColor, alpha: ss.fillAlpha });
    this.startGfx
      .roundRect(sr.x, sr.y, sr.w, sr.h, CARD_RADIUS)
      .stroke({ color: ss.strokeColor, width: ss.strokeWidth });
    this.startLabel.setColor(ss.labelColor);
    this.hint.setColor(developing ? PREPARE_SKIN.selectionText : PALETTE.textDim);
  }
}
