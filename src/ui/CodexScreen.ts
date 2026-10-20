/**
 * **图鉴**（2026-10-20，用户："首页加一个'图鉴'按钮，目前暂时所有的'已解锁'
 * 炁机（未解锁的 保持 UI 然后内容 '？？？'）"）。
 *
 * ==================================================================
 * 它是什么（一句话）
 * ==================================================================
 *
 * 首页进来的**只读**清单：所有炁机各一张卡 —— 已解锁的显示**名字**，
 * 未解锁的卡片照画、名字画成 **？？？**。
 *
 * ```
 *   首页（默认入口）
 *     ├─ 「肉鸽模式」 → 选角色屏 → 一局肉鸽
 *     ├─ 「自由模式」 → 备战界面
 *     └─ 「图鉴」     → 本屏（Esc / 返回箭头回首页）
 * ```
 *
 * ==================================================================
 * ⚠️ 它不判断解锁、也不认识 `RunState`
 * ==================================================================
 *
 * 两条都收在入口那一侧（`app/screenSetup.ts` 的取值函数）：
 *   - **解锁判定**只有一份（`core/run/unlock.isUnlocked`）
 *   - **"有没有一局"** 由 `app/` 回答（有 ⇒ 用那一局的统计；没有 ⇒ 只认
 *     `always`）
 *
 * 这一屏拿到的只是 `CodexEntry[]`（名字 key 可能是 `undefined` = ？？？）。
 *
 * ==================================================================
 * 交互（键盘与触屏对等，AGENTS.md §3b）
 * ==================================================================
 *
 *   - 键盘 `Esc` / 返回箭头 / 点屏幕任意处：回首页（本屏是**只读**的，
 *     没有"选中"可言 —— 所以没有光标，也没有 `Enter` 的语义）
 *   - 齿轮：打开设置（与其它整屏界面同一条）
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { cardSkin } from './prepareRender';
import { CODEX_LAYOUT, codexCardRects, type CodexEntry } from './codexLogic';
import type { TranslateFn } from '../i18n/translator';

export interface CodexScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /** 这一屏要显示的条目（**每次显示现取**：开发模式可能中途切）。 */
  readonly getEntries: () => readonly CodexEntry[];
  /** 有没有进过一局（只影响摘要那行怎么措辞）。 */
  readonly hasRun: () => boolean;
  readonly showKeyHints: () => boolean;
  readonly f1Label: () => string;
  readonly onGear: () => void;
  /** 返回首页（`Esc` / 返回箭头 / 点屏幕任意处都走它）。 */
  readonly onBack: () => void;
  /** 开发模式（摘要那行加一个标记，免得"全都解锁了"被当成 bug）。 */
  readonly devMode: () => boolean;
}

export class CodexScreen {
  readonly root: Container;

  private readonly options: CodexScreenOptions;
  private readonly bg: Graphics;
  private readonly gfx: Graphics;
  private readonly title: Label;
  private readonly summary: Label;
  private readonly hint: Label;
  /** 每张卡片的两个 Label（名字 / 状态）；卡片数量按最大池子预建。 */
  private readonly nameLabels: Label[] = [];
  private readonly stateLabels: Label[] = [];
  /** 解锁条件那一行（小字、暗色；**未解锁的也照写** —— 那正是玩家要知道的）。 */
  private readonly conditionLabels: Label[] = [];
  readonly chrome: ScreenChrome;

  constructor(options: CodexScreenOptions) {
    this.options = options;
    const { pixi } = options;

    this.root = new pixi.Container();
    this.root.visible = false;

    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.gfx = new pixi.Graphics();
    this.root.addChild(this.bg, this.gfx);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: CODEX_LAYOUT.titleY,
      size: 32,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.summary = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: CODEX_LAYOUT.summaryY,
      size: FONT.body,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: CODEX_LAYOUT.hintY,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.title.root, this.summary.root, this.hint.root);

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

  /** 这一屏此刻画了几条、其中几条已解锁（调试 / 验收读数）。 */
  get current(): { readonly total: number; readonly unlocked: number } {
    const entries = this.options.getEntries();
    return {
      total: entries.length,
      unlocked: entries.filter((entry) => entry.unlocked).length,
    };
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (visible) this.redraw();
  }

  /** `Esc` / 返回箭头：回首页。 */
  back(): void {
    this.options.onBack();
  }

  /**
   * 点一下：齿轮 / 返回箭头优先；其余位置 = 回首页（只读屏，"点哪都走"）。
   *
   * ⚠️ 与 `RunOverScreen` 同一条顺序（先问 chrome）—— 否则点齿轮会顺带离开。
   */
  hitTest(px: number, py: number): boolean {
    if (this.chrome.hitTest(px, py)) return true;
    this.options.onBack();
    return true;
  }

  frame(): void {
    if (this.root.visible) {
      this.redraw();
      this.chrome.update();
    }
  }

  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  private redraw(): void {
    const t = this.options.translate;
    const entries = this.options.getEntries();
    const rects = codexCardRects(entries.length);

    this.title.set(t('screen.codex.title'));
    const unlocked = entries.filter((entry) => entry.unlocked).length;
    const dev = this.options.devMode() ? ` · ${t('screen.codex.devMode')}` : '';
    this.summary.set(
      `${t('screen.codex.summary', {
        unlocked: String(unlocked),
        total: String(entries.length),
      })}${dev}`,
    );

    this.gfx.clear();
    this.ensureLabels(entries.length);

    entries.forEach((entry, index) => {
      const rect = rects[index];
      const nameLabel = this.nameLabels[index];
      const stateLabel = this.stateLabels[index];
      if (rect === undefined || nameLabel === undefined || stateLabel === undefined) return;

      /**
       * 卡片皮肤：**所有卡片同一种**（2026-10-20 用户："黄色的是初始就能
       * 解锁的？**不需要这种区别**"）。
       *
       * 状态已经由**文字**说清了（名字 vs ？？？、已解锁 / 未解锁、解锁条件），
       * 再给已解锁的卡片换一套暖色皮肤只是多一层"这只在首页/图鉴里才有"的
       * 视觉语言 —— 图鉴是清单，不是选择界面。
       */
      const skin = cardSkin({ developing: false, cursored: false, selected: false });
      this.gfx
        .roundRect(rect.x, rect.y, rect.w, rect.h, 8)
        .fill({ color: skin.fillColor, alpha: skin.fillAlpha });
      this.gfx
        .roundRect(rect.x, rect.y, rect.w, rect.h, 8)
        .stroke({ color: skin.strokeColor, width: skin.strokeWidth });

      nameLabel.root.x = rect.x + rect.w / 2;
      nameLabel.root.y = rect.y + 34;
      nameLabel.set(entry.nameKey === undefined ? t('screen.codex.locked') : t(entry.nameKey));
      nameLabel.setColor(entry.nameKey === undefined ? PALETTE.textDim : PALETTE.text);
      nameLabel.root.visible = true;

      stateLabel.root.x = rect.x + rect.w / 2;
      stateLabel.root.y = rect.y + 60;
      stateLabel.set(
        entry.unlocked ? t('screen.codex.unlocked') : t('screen.codex.notUnlocked'),
      );
      stateLabel.root.visible = true;

      const conditionLabel = this.conditionLabels[index];
      if (conditionLabel !== undefined) {
        conditionLabel.root.x = rect.x + rect.w / 2;
        conditionLabel.root.y = rect.y + rect.h - 30;
        conditionLabel.set(entry.unlockText);
        conditionLabel.root.visible = true;
      }
    });

    /** 多余的 Label（池子变小）藏起来。 */
    for (let i = entries.length; i < this.nameLabels.length; i += 1) {
      this.nameLabels[i]?.root && (this.nameLabels[i]!.root.visible = false);
      this.stateLabels[i]?.root && (this.stateLabels[i]!.root.visible = false);
      this.conditionLabels[i]?.root && (this.conditionLabels[i]!.root.visible = false);
    }

    /**
     * ⚠️ 键名当**参数**拼（AGENTS.md §3b：键位不是文案）；触屏整行留空
     * （这一屏能做的事就是"点一下回去"）。
     */
    this.hint.set(
      this.options.showKeyHints()
        ? `${t('screen.codex.hint')}${t('screen.keyHint', { keys: 'Esc' })}`
        : '',
    );
  }

  private ensureLabels(count: number): void {
    const { pixi } = this.options;
    while (this.nameLabels.length < count) {
      const name = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.body,
        color: PALETTE.text,
        anchorX: 0.5,
        anchorY: 0.5,
        kai: true,
      });
      const state = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.small,
        color: PALETTE.textDim,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      const condition = new Label(pixi, {
        x: 0,
        y: 0,
        size: FONT.tiny,
        color: PALETTE.textDim,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      this.root.addChild(name.root, state.root, condition.root);
      this.nameLabels.push(name);
      this.stateLabels.push(state);
      this.conditionLabels.push(condition);
    }
  }
}
