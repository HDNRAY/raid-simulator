/**
 * 按键页底部的**选中技能详情**（名字 + 标签 / 说明 / 代价·冷却）。
 *
 * 只为**当前焦点**那一项显示 —— 十几个格子各塞一段中文会挤成一团，
 * 而玩家一次只关心一个。
 *
 * ==================================================================
 * ⚠️ 2026-10-12：从"截断"改成"换行 + 可滚"（用户原话）
 * ==================================================================
 *
 *   "换行呗，然后做类似 overflow scroll 的效果"
 *
 * 起因：详情区宽度从 608 让位给右下角的键位预览、缩到 **400**，于是
 * 说明一行放不下（原先 46 字的截断阈值失效），文字被切掉加省略号 ——
 * 信息直接丢了。
 *
 * 现在：
 *   - 说明**换行**（Pixi 的 `wordWrap` + `breakWords`，中文没有空格所以
 *     必须 `breakWords`），行数按 `wordWrapWidth` 自动折
 *   - 整个详情块**可以滚**（滚轮 / **拖拽** / ↑↓）
 *   - 右边一条**滚动条** + 底部的"可滚动"提示 —— 让人看得出还有内容
 *     （需求："滚动条/可视范围要看得出还有内容"）
 *
 * ==================================================================
 * ⚠️ 滚动**不是**新发明的一套（AGENTS.md：本仓库已有先例）
 * ==================================================================
 *
 * 窗口数学全部来自 `ui/scrollWindow`（**与复盘面板 `LogReviewPanel` 同一
 * 份**：`clampOffset` / `scrollOffset` / `scrollThumbRatio` / `scrollFraction`）。
 * 复盘那套的三种输入（滚轮 / 方向键 / 拖拽）里，这里实现**滚轮 + 拖拽**
 * （触屏没有滚轮；键盘 ↑↓ 在设置页是"移动焦点"，不能抢）。
 *
 * ⚠️ 两个"单位"与复盘不同：复盘一行 = 一条日志（固定行高），这里的行高
 * 也是固定的 `LINE_H`，所以 `rows = 可视高 / LINE_H` —— 同一套数学。
 *
 * ==================================================================
 * ⚠️ 指针归属：拖拽走 `SettingsPanel` 的既有入口
 * ==================================================================
 *
 * 面板已经有"拖滑块"的先例（`isOnScaleSlider` / `dragScaleSlider`，由
 * `canvasInput` 在 `pointermove` 时转发）。详情区的拖拽走**同一条路**
 * （`isOnDetail` / `dragDetail`）—— 不自己挂 window 监听，否则又是
 * "输入归属没收口"（复盘面板为这件事改过一轮）。
 */

import type { Container, Graphics, Text } from 'pixi.js';
import { FONT } from '../layout';
import { Label, type PixiCtor } from '../primitives';
import { wrapText, type MeasureText } from './wrapText';
import { FONT_FAMILY, PALETTE, css } from '../../render/theme';
import { skillDetailViewport } from './keyGridLayout';
import {
  clampOffset,
  scrollFraction,
  scrollOffset,
  scrollThumbRatio,
} from '../../ui/scrollWindow';
import type { KeyRow } from './rows';
import type { TranslateFn } from '../../i18n/translator';

/**
 * 说明最多折几行。
 *
 * ⚠️ 上限存在的理由是**性能**：`wrapText` 的每一行要做一次二分（每步一次
 * 文本测量），而说明每换一个技能都要折一遍。24 行远超任何现实长度的说明
 * （400px 宽、11px 字号下一行约 30 个字 → 24 行 ≈ 700 字），而它同时是
 * `descLines` 数组的长度（那些 `Text` 对象**一次建好、之后只改字**，
 * 不重建 —— 见 `primitives.Label` 的性能说明）。
 *
 * ⚠️ 另一条上限是"滚动范围"：`totalRows` 由**折出来的行数**决定，
 * 而它若超过 `viewRows()` 就出现滚动。所以这个数不能太小（那会让长说明
 * 被**静默截断**而没有滚动条），也不能太大（浪费 Text 对象）。
 */
const DESC_MAX_LINES = 24;

/**
 * 一行的行距 —— **量出来的，不是估的**。
 *
 * Pixi 的 `Text` 实际占高远大于字号：13px 的字量出来是 **22px**
 * （行高 ≠ 字号）。原先四行用 22 就是三次实测（14 / 15 / 18 都叠字）的
 * 结果。现在说明会折行，所以这个数同时是"折行后的行距"与"滚动的单位"。
 */
const LINE_H = 22;

/** 滚动条：轨道宽 / 最小滑块高（与复盘面板同一套视觉参数）。 */
const SCROLLBAR_W = 3;
const SCROLLBAR_MIN_H = 20;

/** 滚轮一个"格"折算几行（像素模式的 `deltaY` ÷ 它，与复盘同一口径）。 */
const WHEEL_PX_PER_ROW = 40;

/** 说明与滚动条之间的让位（字不许压在滚动条上）。 */
const SCROLLBAR_PAD = 10;

/**
 * 详情块的**行数**（= 滚动数学里的 `rows`）。
 *
 * ⚠️ 它是**算出来的**（可视高 / 行距）：详情区的高度由
 * `keyGridLayout.skillDetailViewport()` 推出来，写死行数会在几何一变时
 * 立刻错位。
 */
function viewRows(): number {
  return Math.max(1, Math.floor(skillDetailViewport().h / LINE_H));
}

export class SkillDetail {
  readonly root: Container;

  private readonly name: Label;
  private readonly tags: Label;
  private readonly stats: Label;
  /** 右下角的"还能往下滚"提示（`anchorX: 1` 右对齐）。 */
  private readonly moreHint: Label;
  /**
   * 说明的**每一行**一个 `Text`。
   *
   * ⚠️ 一段一整块 + 遮罩是"更省事"的写法，但本仓库的 Pixi 包里遮罩在
   * headless / canvas 渲染器下**不生效**（实测文字直接画到详情区之外）。
   * 所以改成**自己折行、只画看得见的那几行** —— 裁剪行为与渲染器无关
   * （见 `./wrapText` 的文件头）。
   */
  private readonly descLines: Text[] = [];
  /** 量字体宽度用的**隐藏** `Text`（折行要靠它）。 */
  private readonly measureText: Text;
  /** 当前说明折出来的行（`render` 算一次，滚动时直接用）。 */
  private wrapped: readonly string[] = [];
  /** 内容容器：滚动 = 整体上移（`y` 变小）。 */
  private readonly content: Container;
  /** 滚动条 + 背景框都画在这一层（在文字**下面**）。 */
  private readonly frame: Graphics;

  /** 第一条可见的**行号**（与复盘面板的 `offset` 同义）。 */
  private offset = 0;
  /** 上一次算出来的"内容总行数"（滚动范围靠它）。 */
  private totalRows = 0;

  /** 拖拽中：指针 id 与上一次的逻辑 Y。 */
  private drag: { readonly id: number; logicalY: number } | null = null;
  /** 拖拽累计的"不足一行"的零头（慢速拖动不会因为取整而完全不动）。 */
  private dragCarry = 0;
  /** 量文本宽度的注入（折行用；`wrapText` 不认识 Pixi）。 */
  private readonly measure: MeasureText;

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    const vp = skillDetailViewport();
    this.root = new pixi.Container();

    /** 背景 + 滚动条：压在文字下面（先 addChild）。 */
    this.frame = new pixi.Graphics();
    this.root.addChild(this.frame);

    this.content = new pixi.Container();
    this.content.x = vp.x;
    this.content.y = vp.y;
    this.root.addChild(this.content);

    const line = (row: number, size: number, color: number): Label =>
      new Label(pixi, { x: 0, y: row * LINE_H, size, color });
    this.name = line(0, FONT.body, PALETTE.text);
    /**
     * 标签行取**优先级最高的那一个**标签的颜色 —— 一行小字里混两种颜色
     * 会更乱，而标签本来就是"最该注意的那条"提示。
     */
    this.tags = line(0, FONT.tiny, PALETTE.douqi.bright);
    /**
     * 代价行（消耗 · 冷却 · 施放）。
     *
     * ⚠️ 初始 y 只是占位：真的位置在 `render` 里按**说明折了几行**算
     * （说明可能占 1~4 行）。
     */
    this.stats = line(2, FONT.tiny, PALETTE.textDim);
    this.moreHint = new Label(pixi, {
      x: 0,
      y: 0,
      size: FONT.tiny,
      color: PALETTE.textFaint,
      anchorX: 1,
    });
    /**
     * 量宽度的那个 `Text`：**不进显示列表**（只用来量）。它必须与说明
     * 用**同一套字体/字号**，否则折出来的行与画出来的不一样宽。
     */
    this.measureText = new pixi.Text({
      text: '',
      style: { fontFamily: FONT_FAMILY, fontSize: FONT.tiny },
    });
    this.measure = (text) => {
      this.measureText.text = text;
      return this.measureText.width;
    };
    for (let i = 0; i < DESC_MAX_LINES; i += 1) {
      const t = new pixi.Text({
        text: '',
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: FONT.tiny,
          fill: css(PALETTE.textDim),
        },
      });
      t.x = 0;
      this.descLines.push(t);
      this.content.addChild(t);
    }
    this.content.addChild(this.name.root, this.tags.root, this.stats.root);
    /** ⚠️ 提示**不挂在 `content` 上**：它不该跟着内容滚走。 */
    this.root.addChild(this.moreHint.root);
  }

  /**
   * 内容总行数（滚动数学的单位）：名字 + 说明折行数 + 代价。
   *
   * ⚠️ 必须与 `render` 的摆法一致（`y = 0 / LINE_H / LINE_H×(1+descRows)`）
   * —— 两处各算一遍就会在"说明正好折满"时让代价行悬空或被压住。
   */
  private rowsOf(descRows: number): number {
    return 1 + descRows + 1;
  }

  /**
   * 说明折行的可用宽度：详情区宽 - 滚动条让位。
   *
   * ⚠️ 与 `drawFrame` 画滚动条用的那个 `SCROLLBAR_PAD` 同源 ——
   * 两处各减一次就会让最长的那行压在滚动条上。
   */
  private descWidth(): number {
    return Math.max(1, skillDetailViewport().w - SCROLLBAR_PAD);
  }

  /** 能不能滚（内容比可视区多）。 */
  private scrollable(): boolean {
    return this.totalRows > viewRows();
  }

  /**
   * 当前滚动偏移 / 总行数 / 一屏行数（**调试探针**用）。
   *
   * ⚠️ 验证脚本必须能**读出**"滚了没有"：截图只能证明"这一帧看着对"，
   * 证明不了"内容位移了"（复盘工具里 `pointerRatio()` 也是同一个理由）。
   */
  scrollState(): {
    readonly offset: number;
    readonly total: number;
    readonly rows: number;
    /** 各段是否占了一行（名字 / 说明折行数 / 代价）—— 验证折行用。 */
    readonly lines: readonly number[];
  } {
    return {
      offset: this.offset,
      total: this.totalRows,
      rows: viewRows(),
      lines: [1, Math.max(1, this.wrapped.length), 1],
    };
  }

  /** 清空（离开按键页 / 关面板时调用 —— 不留上一个技能的信息）。 */
  clear(): void {
    for (const label of [this.name, this.tags, this.stats, this.moreHint]) label.set('');
    for (const t of this.descLines) t.text = '';
    this.wrapped = [];
    this.totalRows = 0;
    this.offset = 0;
    this.drag = null;
    this.frame.clear();
    this.content.y = skillDetailViewport().y;
    this.content.visible = false;
  }

  /** 显示某个技能的详情。 */
  render(row: KeyRow): void {
    this.content.visible = true;
    const t = this.translate;

    /**
     * 标签行 = **玩法提示** ∪ **机械 tag**（如「闪避」）。
     *
     * ⚠️ 两类分开取词（前缀不同）：`settings.hintTags.*` 是玩法提示，
     * `settings.mechanicTags.*` 是机械分类里挑出来的。
     */
    const tags = [
      /** ⚠️ `hintTags` 里已经是**完整 i18n key**（见 `app/skillHints.ts`），
       * 不要再拼 `settings.hintTags.` 前缀。 */
      ...(row.hintTags ?? []).map((key) => t(key)),
      ...(row.mechanicTags ?? []).map((tag) => t(`settings.mechanicTags.${tag}`)),
    ].join(' · ');
    /**
     * 说明：**换行**（不再截断）。
     *
     * ⚠️ 文案里可能带 **Markdown 的强调标记**（如"**无法被打断**"）——
     * 那是给文档看的，直接画到 canvas 上会原样显示星号。统一剥掉。
     */
    const desc = row.descKey === undefined ? '' : t(row.descKey).replaceAll('**', '');
    /**
     * **结构化行**：消耗 · 冷却 · 施放。
     *
     * ⚠️ 三段都由上层**格式化好**（走 i18n 模板）—— 这里只负责拼，
     * 不自己造文案。
     */
    const stats = [row.costText, row.cdText, row.castText]
      .filter((x): x is string => x !== undefined && x !== '')
      .join('   ');

    this.name.set(t(row.nameKey));
    this.tags.set(tags);
    this.stats.set(stats);
    /**
     * 说明**自己折行**（不靠 Pixi 的 `wordWrap`）—— 折出来的行要**逐行
     * 画**，这样才能只画看得见的那几行（裁剪不依赖渲染器，见 `./wrapText`）。
     */
    this.wrapped = wrapText({
      text: desc,
      width: this.descWidth(),
      measure: this.measure,
      /**
       * ⚠️ 上限 = `DESC_MAX_LINES` 与"还能画几行"里**更小**的那个。
       *
       * 这是**裁剪的兜底**：详情区只画得下 `viewRows()` 行，而名字与代价
       * 各占一行 —— 所以说明最多占 `viewRows() - 2` 行。折出来的行数
       * 不超过它，就不可能画到区外（本仓库的 Pixi 遮罩在 headless 下
       * 不生效，见 `./wrapText`；所以裁剪**必须在折行这一步**兜住）。
       */
      maxLines: Math.max(1, Math.min(DESC_MAX_LINES, viewRows() - 2)),
    });

    /**
     * ⚠️ 标签的 x 依赖名字的**实际渲染宽度**（`root.width`），所以必须
     * 先 `set` 名字再定位标签 —— 顺序反了会用到上一帧的宽度。
     *
     * 需求："设置里选中的技能，里面显示 tags 会把描述往下推，我觉得不好，
     * 优化一下 layout，比如 tags 放右边，或者下面。" → 放右边，不占行。
     */
    const TAG_GAP = 10;
    this.tags.root.x = this.name.root.width + TAG_GAP;
    this.tags.root.y = 0;

    /**
     * ⚠️ 代价行必须**按说明折了几行**往下摆 —— 写死 `y = LINE_H * 2`
     * 会在说明折成 2 行时被压住（这一轮踩过）。
     */
    const descRows = Math.max(1, this.wrapped.length);
    this.stats.root.y = LINE_H * (1 + descRows);
    for (let i = 0; i < this.descLines.length; i += 1) {
      const line = this.descLines[i];
      if (line === undefined) continue;
      /** ⚠️ 超出折行数的行**清空**（否则会留着上一个技能的尾巴）。 */
      line.text = this.wrapped[i] ?? '';
      line.y = LINE_H * (1 + i);
    }

    this.totalRows = this.rowsOf(descRows);
    /** 换了技能：滚回顶部（否则短说明会停在上一个的滚动位置上）。 */
    this.offset = clampOffset(0, this.totalRows, viewRows());
    this.applyOffset();
    this.drawFrame();
    this.root.visible = true;
  }

  /**
   * 「下面还有」的那点提示（只有滚得动时显示）—— 需求："滚动条/可视范围
   * 要**看得出还有内容**"。
   *
   * ⚠️ 它画在详情区的**右下角**（说明与代价都在左侧），不遮任何字；
   * 文案走 i18n（`settings.detailScrollHint`），与滚动条一起构成两个
   * "还能往下"的信号 —— 只有滚动条的话，玩家不一定意识到**能拖**。
   */
  private drawMoreHint(): void {
    if (!this.scrollable()) return;
    const vp = skillDetailViewport();
    /**
     * ⚠️ 按**当前偏移**选方向：滚到底时还说"往下滚"就是在骗人
     * （玩家会一直拖）。两条都在 `settings.*` 里（i18n 规范 I1）。
     */
    const atEnd = this.offset >= this.totalRows - viewRows();
    this.moreHint.set(
      this.translate(atEnd ? 'settings.detailScrollTop' : 'settings.detailScrollMore'),
    );
    this.moreHint.root.x = vp.x + vp.w - 6;
    this.moreHint.root.y = vp.y + vp.h - 14;
  }

  /** 把偏移套到内容上，并画滚动条。 */
  private applyOffset(): void {
    const vp = skillDetailViewport();
    const rows = viewRows();
    this.offset = clampOffset(this.offset, this.totalRows, rows);
    this.content.y = vp.y - this.offset * LINE_H;
    this.drawFrame();
  }

  /** 滚 `delta` 行（正数 = 往下看）。滚轮与拖拽**共用这一个**入口。 */
  scrollRows(delta: number): void {
    const next = scrollOffset(this.offset, delta, this.totalRows, viewRows());
    if (next === this.offset) return;
    this.offset = next;
    this.applyOffset();
  }

  /** 清空重画（面板每帧的 `redraw` 会调它）。 */
  private drawFrame(): void {
    const vp = skillDetailViewport();
    const g = this.frame;
    g.clear();
    this.moreHint.set('');
    if (!this.content.visible) return;
    /**
     * 详情区画一层**很淡的底**：它让"这一块是可以滚的面板"这件事在
     * 视觉上成立（否则文字直接浮在弹窗底板上，滚动条看起来像无主物）。
     * 与技能格用同一个色号（`PALETTE.slot.blocked`，最暗那档）。
     */
    g.roundRect(vp.x, vp.y, vp.w, vp.h, 3).fill({ color: PALETTE.slot.blocked, alpha: 0.55 });
    this.drawMoreHint();
    /**
     * ⚠️ **滚动条只在真的滚得动时画** —— 内容装得下还画一条满轨，玩家会
     * 以为"下面还有东西"（那是"看不出到底有没有更多"的反面：画了却没有）。
     */
    if (!this.scrollable()) return;
    const trackX = vp.x + vp.w - SCROLLBAR_W - 2;
    g.rect(trackX, vp.y + 2, SCROLLBAR_W, vp.h - 4).fill({ color: PALETTE.panelLine, alpha: 0.6 });
    const trackH = vp.h - 4;
    const thumbH = Math.max(SCROLLBAR_MIN_H, trackH * scrollThumbRatio(this.totalRows, viewRows()));
    const thumbY =
      vp.y + 2 + (trackH - thumbH) * scrollFraction(this.offset, this.totalRows, viewRows());
    g.rect(trackX, thumbY, SCROLLBAR_W, thumbH).fill({ color: PALETTE.textDim, alpha: 0.95 });
  }

  /** 每帧刷新（面板 `redraw` 时调；可见性由页决定）。 */
  update(): void {
    this.drawFrame();
  }

  /** 这一块显示 / 隐藏（切页时由面板控制）。 */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (!visible) return;
    this.drawFrame();
  }

  /* ---------------------------------------------------------------- *
   * 输入（由面板转发；面板的入口在 `hitTest` / `canvasInput`）
   * ---------------------------------------------------------------- */

  /**
   * 滚轮：滚 `deltaY` 对应的行数。
   *
   * ⚠️ 归属判断由 `SettingsPanel.isOnDetail()` 做完才调进来 ——
   * 这里不自己摸 DOM 坐标（那是"两份几何真相"）。
   *
   * @returns 是否**消费**了这次滚轮（滚不动时 `false`，调用方据此决定
   *   要不要 `preventDefault`）
   */
  wheel(deltaY: number, deltaMode: number): boolean {
    if (!this.content.visible || !this.scrollable()) return false;
    /** `deltaMode === 1` 时 `deltaY` 的单位是**行**，否则是像素。 */
    const raw = deltaMode === 1 ? deltaY : deltaY / WHEEL_PX_PER_ROW;
    const step = Math.abs(raw) < 1 ? Math.sign(raw) : Math.round(raw);
    if (step === 0) return false;
    this.scrollRows(step);
    return true;
  }

  /** 按下：记住起点（**逻辑** Y 坐标）。 */
  pointerDown(pointerId: number, logicalY: number): void {
    this.drag = { id: pointerId, logicalY };
    this.dragCarry = 0;
  }

  /**
   * 拖动：**向上拖 = 看下面的**（与"内容跟着手指走"的直觉一致）。
   *
   * ⚠️ 零头要**留着**（`dragCarry`）：慢速拖动时每帧只挪不到一行，
   * 取整会把它抹成 0，表现成"手指慢慢拖、内容纹丝不动"（复盘那轮踩过）。
   */
  pointerMove(pointerId: number, logicalY: number): void {
    const drag = this.drag;
    if (drag === null || pointerId !== drag.id) return;
    const dy = (drag.logicalY - logicalY) / LINE_H;
    this.drag = { id: pointerId, logicalY };
    this.dragCarry += dy;
    const whole = Math.trunc(this.dragCarry);
    if (whole === 0) return;
    this.dragCarry -= whole;
    this.scrollRows(whole);
  }

  /** 松开 / 取消：结束拖拽（`pointercancel` 与 `pointerup` 同义）。 */
  pointerUp(pointerId: number): void {
    if (this.drag !== null && pointerId === this.drag.id) this.drag = null;
  }
}
