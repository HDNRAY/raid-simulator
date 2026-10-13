/**
 * **选炁机屏**（P3）：每场战斗打完之后，从已解锁的炁机里选 1 个生效。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §3.3 / §5.3 / §5.4。
 *
 * ==================================================================
 * 规则（用户 2026-10-13 定，逐条对应到代码）
 * ==================================================================
 *
 *   - **候选 = 已解锁的**（`app/runSession.ts` 的 `candidates()` →
 *     `core/run/unlock.ts` 的 `nextCandidates`）。没解锁的**不出现**。
 *   - **这一屏只在第一场打完之后出现**：开局那条路（`startRoguelikeRun`）
 *     直接进战斗 —— 判据在 `phaseFlow`，不在这里。
 *   - **选 1 个生效**，而且**选了不能换 / 不能取消**（§5.3）—— 所以本屏
 *     没有"反选 / 取消"，Enter / 点卡片当场生效并离开。
 *   - **一局只能选一次（不叠加）**：选过的那条**不再出现在候选里**
 *     （`nextCandidates` 按 `chosen` 过滤），所以卡片上**没有** `0/3`
 *     这类"还能选几次"的角标（那个字段已删，见 `qijiSelectLogic`）。
 *
 * ==================================================================
 * 交互：与其它选择屏同一套（键盘与触屏**对等**，AGENTS.md §3b）
 * ==================================================================
 *
 *   - ← → ↑ ↓ / Tab：移动光标（两端停住；Tab 环绕）
 *   - Enter：选光标处那一个（**真的生效**）
 *   - 触屏 / 鼠标：**点卡片 = 移光标 + 选它**（一步到位）
 *   - `Esc` / 左上角返回箭头：放弃这一局、回选角色
 *     （箭头是**必需的** —— 触屏按不出 `Esc`）
 *
 * ==================================================================
 * ⚠️ 卡片排版：每张卡两段（名字 / 说明，最多两行）
 * ==================================================================
 *
 * ⚠️ 第三段（右下角的"还能选几次" / "已叠满"）**已删**（2026-10-13）：
 * 肉鸽改成"一局只能选一次、不叠加"之后，候选里的每一条**恒只能选 1 次**，
 * 那个角标永远没有东西可写（`maxStacks` / `remainingStacks` 都删了）。
 * 留一个永远为空的 Label 只会让下一个人以为还有层数。
 *
 * ⚠️ 说明里的换行是**内容里的 `\n`**（i18n 的字符串），渲染层按它切行、
 * 每行一个 `Label` —— 不是让 Pixi 自动换行。理由：Pixi 的 `wordWrap`
 * 对**中文**会在任意字符处断，而本屏的说明是短句（每条 20~30 字），
 * 手工断行能保证"断在语义处"，而且断点跟着文案走（改文案时就近改）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { CARD_RADIUS, CARD_STROKE, CURSOR_RING_GAP, cardSkin } from './prepareRender';
import {
  QIJI_SELECT_LAYOUT,
  QIJI_SELECT_SLOTS,
  canConfirm,
  confirmQiji,
  moveQijiCursor,
  pickQiji,
  qijiCursorTarget,
  qijiHitAreas,
  qijiHintY,
  type QijiCandidate,
} from './qijiSelectLogic';
import type { TranslateFn } from '../i18n/translator';

export interface QijiSelectScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /**
   * **现在能选什么** —— 取值函数，不是快照。
   *
   * ⚠️ 它是**活的**：这一屏可能被打开多次（每场战斗后一次），而每次的
   * 候选都不一样（统计涨了 → 有新解锁的；上一屏刚选走的**不再出现**）。
   * 快照一份会让第二次打开显示第一次的候选。
   *
   * 数据由 app 层从 `runSession.candidates()` + `data/qiji.ts` 拼好之后
   * 传进来（`QijiCandidate` 只带渲染要的字段）—— 本屏**不认识**
   * `RunState` / `QijiEntity`。
   */
  readonly getCandidates: () => readonly QijiCandidate[];
  /** 是否显示键位提示（触屏为假）。 */
  readonly showKeyHints: () => boolean;
  /** `F1` 的显示名（齿轮的键位提示；键名不进 i18n，AGENTS.md §3b）。 */
  readonly f1Label: () => string;
  /** 点右上角的齿轮（打开设置）。 */
  readonly onGear: () => void;
  /** 点左上角的返回箭头（放弃这一局、回选角色）。 */
  readonly onBack?: (() => void) | undefined;
  /** 选定了某个炁机（**当场生效**）。 */
  readonly onChoose: (qijiId: string) => void;
}

/** 本屏要拼上去的**键名**（键名不进 i18n，见 AGENTS.md §3b）。 */
const QIJI_KEY_HINT = '← → · Enter';

/** 每张卡的固定 Label 槽位（名字 / 说明最多两行）。 */
interface QijiCardLabels {
  readonly name: Label;
  /** 说明最多两行（第二行常驻、空着就不显示字）。 */
  readonly desc: readonly [Label, Label];
}

export class QijiSelectScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly title: Label;
  private readonly hint: Label;
  private readonly cardGfx: Graphics;
  private readonly cards: QijiCardLabels[] = [];
  /** 本屏自己的边角控件（齿轮 + 返回箭头），与其它整屏界面同一套。 */
  readonly chrome: ScreenChrome;
  private readonly options: QijiSelectScreenOptions;

  /** 光标位置（候选下标）。⚠️ 本屏**没有**"选择"这个中间态（选了就走）。 */
  private cursor = 0;

  constructor(options: QijiSelectScreenOptions) {
    this.options = options;
    const { pixi } = options;

    this.root = new pixi.Container();
    this.root.visible = false;

    this.bg = new pixi.Graphics();
    this.bg
      .rect(0, 0, LOGICAL.width, LOGICAL.height)
      .fill({ color: PALETTE.bgTop });
    this.root.addChild(this.bg);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: QIJI_SELECT_LAYOUT.titleY,
      size: 32,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.cardGfx = new pixi.Graphics();
    this.root.addChild(this.cardGfx, this.title.root);

    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      /**
       * ⚠️ 提示行的 y **算出来**（`qijiHintY`：排满时卡片块的底边 + 间隔）。
       * 旧版是布局表里一个手调的 `470`，而它正落在**第二行卡片里面**
       * （用户报的重叠 bug，坐标证明见 `qijiHintY` 的说明）。
       */
      y: qijiHintY(QIJI_SELECT_LAYOUT),
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.hint.root);

    /**
     * ⚠️ **卡片 Label 一次建到一个上限**（不是每帧新建 / 销毁）。
     *
     * 上限是 `QIJI_SELECT_SLOTS`（布局那一份）：它同时决定"提示行放在哪"
     * —— 两处各写一个 6 的话，"池子能画几张"与"卡片块多高"会漂，
     * 而漂的表现就是这次那个重叠 bug。超过的部分不画（也不会崩）。
     * 每帧新建 Label 会让 Pixi 反复重建纹理（`PrepareScreen` 记着这条）。
     */
    for (let i = 0; i < QIJI_SELECT_SLOTS; i += 1) {
      this.cards.push(this.makeCardLabels(pixi));
    }

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
     * ⚠️ **每次显示都把光标归零**：候选每次都不一样（解锁 / 叠层都在变），
     * 保留上一次的下标会指到一个不同的炁机上 —— 而"默认选中的是哪个"
     * 直接决定玩家随手按 Enter 会拿到什么。归零 = 落在第一条候选
     * （`data/qiji.ts` 把两条兜底通用炁机排在最前，正是为了这一点）。
     */
    if (visible) {
      this.cursor = 0;
      this.redraw();
    }
  }

  /** 当前光标下标（调试入口读它）。 */
  get current(): { readonly cursor: number; readonly candidates: readonly string[] } {
    return {
      cursor: this.cursor,
      candidates: this.options.getCandidates().map((c) => c.qiji.id),
    };
  }

  /** ← →：在行内移动光标。 */
  cycle(delta: number): void {
    this.moveCursor(delta, 'x', false);
  }

  /** ↑ ↓：换行（两端停住）。 */
  moveFocus(delta: number, wrap = false): void {
    this.moveCursor(delta, 'y', wrap);
  }

  /**
   * Enter：选光标处那一个。
   *
   * ⚠️ 没有候选时**什么都不做**（`canConfirm`）—— 不能"确认一个不存在的
   * 炁机"（那会让 `onChoose` 收到 `undefined`，而调用方要么断言要么再判一次）。
   */
  confirm(): void {
    const candidates = this.options.getCandidates();
    if (!canConfirm(candidates)) return;
    const id = confirmQiji(candidates, this.cursor);
    if (id !== undefined) this.options.onChoose(id);
  }

  /**
   * 点一下（逻辑坐标）。@returns 是否消费了这次点击
   *
   * ⚠️ 齿轮 / 返回箭头**先于卡片**（顺序即优先级，与其余整屏界面同一条）。
   */
  hitTest(px: number, py: number): boolean {
    if (this.chrome.hitTest(px, py)) return true;
    const picked = pickQiji(this.options.getCandidates(), px, py, QIJI_SELECT_LAYOUT);
    if (picked === undefined) return false;
    this.cursor = picked.cursor;
    this.redraw();
    this.options.onChoose(picked.qijiId);
    return true;
  }

  /** 每帧：只在可见时保证画面与光标一致。 */
  frame(): void {
    if (this.root.visible) {
      this.redraw();
      this.chrome.update();
    }
  }

  /**
   * **UI 缩放**：本屏只转发给**它自己的**边角控件（与其它整屏界面同一条）。
   *
   * ⚠️ 卡片与标题不随缩放：这一屏是满屏布局，卡片位置由布局表定死；
   * 只有浮在界面之上的齿轮 / 返回箭头要跟别的界面保持一致的大小。
   */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  /** 改光标（两个入口共用：越界时夹回 `0..n-1`）。 */
  private moveCursor(delta: number, axis: 'x' | 'y', wrap: boolean): void {
    const candidates = this.options.getCandidates();
    const next = moveQijiCursor(candidates, this.cursor, delta, axis, wrap, QIJI_SELECT_LAYOUT);
    if (next === this.cursor) return;
    this.cursor = next;
    this.redraw();
  }

  /** 造一张卡的全部 Label（一次建好，之后只改文本 / 位置）。 */
  private makeCardLabels(pixi: PixiCtor): QijiCardLabels {
    const name = new Label(pixi, {
      x: 0,
      y: 0,
      size: FONT.body,
      color: PALETTE.text,
      kai: true,
      anchorX: 0.5,
    });
    const desc0 = new Label(pixi, {
      x: 0,
      y: 0,
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 0.5,
    });
    const desc1 = new Label(pixi, {
      x: 0,
      y: 0,
      size: FONT.tiny,
      color: PALETTE.textDim,
      anchorX: 0.5,
    });
    this.root.addChild(name.root, desc0.root, desc1.root);
    return { name, desc: [desc0, desc1] };
  }

  private redraw(): void {
    const t = this.options.translate;
    const candidates = this.options.getCandidates();

    this.title.set(t('screen.qijiSelect.title'));
    /**
     * 提示 = 标签 + （键名）。触屏不拼后半段（键名不是文案）。
     * ⚠️ 没有候选时给一句能读的话（`none`）—— 而不是留一个空屏。
     */
    const keys = this.options.showKeyHints() ? t('screen.keyHint', { keys: QIJI_KEY_HINT }) : '';
    this.hint.set(
      candidates.length === 0
        ? t('screen.qijiSelect.none')
        : `${t('screen.qijiSelect.hint')}${keys}`,
    );

    const areas = qijiHitAreas(candidates, QIJI_SELECT_LAYOUT);
    const cursorAt = qijiCursorTarget(candidates, this.cursor);

    this.cardGfx.clear();
    this.cards.forEach((card, i) => {
      const area = areas[i];
      const candidate = candidates[i];
      /** 超出候选张数 / 超过 Label 槽位的卡片：全部藏起来（不画、不留字）。 */
      if (area === undefined || candidate === undefined) {
        card.name.set('');
        card.desc[0].set('');
        card.desc[1].set('');
        return;
      }

      const cursored = cursorAt !== undefined && cursorAt.qiji.id === candidate.qiji.id;
      /**
       * ⚠️ 皮肤复用备战界面的 `cardSkin`（纯函数、有单测）：
       * **冷白 = 光标**。`selected` 恒为假 —— 本屏没有"已确定"这个中间态
       * （选了当场生效并离开），传 `true` 会画出"金框卡片"而那个状态
       * 在这一屏没有含义。
       */
      const skin = cardSkin({ developing: false, cursored, selected: false });

      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .fill({ color: skin.fillColor, alpha: skin.fillAlpha });
      this.cardGfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .stroke({ color: skin.strokeColor, width: skin.strokeWidth });
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

      const centerX = area.x + area.w / 2;
      card.name.set(t(candidate.qiji.nameKey));
      card.name.setColor(skin.nameColor);
      card.name.root.x = centerX;
      card.name.root.y = area.y + 30;

      /** 说明：按内容里的 `\n` 切行（见文件头"卡片排版"那段）。 */
      const desc = candidate.qiji.descKey === undefined ? '' : t(candidate.qiji.descKey);
      const lines = desc.split('\n');
      card.desc[0].set(lines[0] ?? '');
      card.desc[1].set(lines[1] ?? '');
      card.desc[0].root.x = centerX;
      card.desc[0].root.y = area.y + 72;
      card.desc[1].root.x = centerX;
      card.desc[1].root.y = area.y + 92;
    });
  }
}
