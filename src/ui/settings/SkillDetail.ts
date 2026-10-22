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
 * ⚠️⚠️ 2026-10-12 第二轮：`maxLines` 那一下"**放开**"（行为真的变了）
 * ==================================================================
 *
 * 用户原话："**放开**"。
 *
 * ⚠️ 上面那三样**当时其实一样都走不到**：折行上限写的是
 * `min(DESC_MAX_LINES, viewRows() - 2)`，而总行数是
 * `1 + 说明行数 + 1` —— 于是 `total ≤ viewRows()` **恒成立**，
 * `scrollable()` 永远为假。表现是："滚轮 / 拖拽 / 滚动条 / 方向提示"
 * 全写好了却**不可达**，超长说明被**静默截断**。
 *
 * 现在上限只由 `DESC_MAX_LINES` 决定（推导与判据在 `./detailWindow`），
 * 所以**行为变化**是：
 *
 *   | | 之前 | 现在 |
 *   |---|---|---|
 *   | 比一屏高的说明 | 被静默截断到一屏，**看不出来少了** | **能滚出来**，右边有滚动条、底部有方向提示 |
 *   | 一屏内的说明 | 不滚、不画滚动条 | **一样**（滚不动就不画 —— 这条没变）|
 *   | 裁剪 | 靠"折行时就不许折满" | 靠 `clipToWindow()` 按 `offset` 逐行判可见性 |
 *
 * ⚠️ 最后一行是**必须**的连带改动：放开之后窗口外的行会被画到详情区
 * 外面（本仓库的 Pixi 遮罩在 headless 下不生效，见 `./wrapText`）。
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
import { paintScrollBar } from '../scrollBarPaint';
import {
  currentSettingsMetrics,
  detailContentRect,
  detailViewport,
  scaledFont,
} from './settingsScale';
import { DESC_MAX_LINES } from './detailWindow';
import { attachViewportMask, drawViewportClip, fullyOutside } from '../viewportMask';
import {
  clampOffset,
  scrollOffset,
} from '../../ui/scrollWindow';
import type { KeyRow } from './rows';
import type { TranslateFn } from '../../i18n/translator';

/**
 * ⚠️ **折行上限**与**"这一行在不在窗口里"**的判据搬到了 `./detailWindow`。
 *
 * 那是这一轮修掉的一行算术（`min(DESC_MAX_LINES, viewRows() - 2)` 让
 * `total > rows` 结构上永不可能成立 → 滚动那四样永远走不到），而它是
 * **纯函数**、能在 node 里真的断言；留在这个 Pixi 组件里就只能靠看截图猜。
 * 理由与踩过的坑随代码一起搬过去了，这里不重复。
 */

/**
 * 一行的行距 —— **量出来的，不是估的**。
 *
 * Pixi 的 `Text` 实际占高远大于字号：13px 的字量出来是 **22px**
 * （行高 ≠ 字号）。原先四行用 22 就是三次实测（14 / 15 / 18 都叠字）的
 * 结果。现在说明会折行，所以这个数同时是"折行后的行距"与"滚动的单位"。
 *
 * ⚠️ 它现在**跟 UI 缩放走**（`settingsScale` 的 `lineH`）—— 字号放大了
 * 行距不放大就会叠字，而叠字是"看不清"而不是"紧凑"。基准仍是那个量出来的 22。
 */
function lineH(): number {
  return currentSettingsMetrics().lineH;
}

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
 * ⚠️ 它是**算出来的**（**内框**高 / 行距）：高度由
 * `keyGridLayout.skillDetailContentRect()` 推出来（外框减 padding），
 * 写死行数会在几何一变时立刻错位。
 *
 * ⚠️ 必须用**内框**：用户要求给说明加 padding（`SKILL_DETAIL.padding`），
 * 上下那两圈是从"看得见的空间"里扣掉的 —— 拿外框高算行数就会在滚到底时
 * **把最后一行裁掉**（差的就是那 2×padding）。
 */
function viewRows(): number {
  return Math.max(1, Math.floor(detailContentRect().h / lineH()));
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
  /**
   * **内容层的遮罩**（2026-10-22）：把说明按像素裁在详情区里
   * （用户："我要的是类似 html 那种滚动效果"）。
   */
  private readonly maskGfx: Graphics;

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
  /**
   * 上一次渲染的**原始文本**（未折行）—— `relayout()` 重折时要用它。
   *
   * ⚠️ 存的是"说明原文 + 名字 + 标签 + 代价"，不是折好的行：缩放一变，
   * 折行结果就作废了（行是拿旧字号量出来的）。
   */
  private last:
    | { readonly name: string; readonly tags: string; readonly stats: string; readonly desc: string }
    | undefined;

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    const inner = detailContentRect();
    this.root = new pixi.Container();

    /** 背景 + 滚动条：压在文字下面（先 addChild）。 */
    this.frame = new pixi.Graphics();
    this.root.addChild(this.frame);

    /**
     * ⚠️ 内容容器挂在**内框**的左上角：文字四周那圈留白就是
     * `SKILL_DETAIL.padding`（背景仍然铺外框，见 `drawFrame`）。
     */
    this.content = new pixi.Container();
    this.content.x = inner.x;
    this.content.y = inner.y;
    this.root.addChild(this.content);
    /**
     * 遮罩：**画在 `content` 自己的局部坐标里**（左上角 = 内容原点），
     * 所以内容整体上移（滚动）时遮罩不动 ✓ —— 这就是"窗口不动、内容在窗后滚"。
     */
    this.maskGfx = new pixi.Graphics();
    attachViewportMask(this.maskGfx, this.content);

    const line = (row: number, size: number, color: number): Label =>
      new Label(pixi, { x: 0, y: row * lineH(), size, color });
    this.name = line(0, scaledFont(FONT.body), PALETTE.text);
    /**
     * 标签行取**优先级最高的那一个**标签的颜色 —— 一行小字里混两种颜色
     * 会更乱，而标签本来就是"最该注意的那条"提示。
     */
    this.tags = line(0, scaledFont(FONT.tiny), PALETTE.douqi.bright);
    /**
     * 代价行（消耗 · 冷却 · 施放）。
     *
     * ⚠️ 初始 y 只是占位：真的位置在 `render` 里按**说明折了几行**算
     * （说明可能占 1~4 行）。
     */
    this.stats = line(2, scaledFont(FONT.tiny), PALETTE.textDim);
    this.moreHint = new Label(pixi, {
      x: 0,
      y: 0,
      size: scaledFont(FONT.tiny),
      color: PALETTE.textFaint,
      anchorX: 1,
    });
    /**
     * 量宽度的那个 `Text`：**不进显示列表**（只用来量）。它必须与说明
     * 用**同一套字体/字号**，否则折出来的行与画出来的不一样宽。
     */
    this.measureText = new pixi.Text({
      text: '',
      style: { fontFamily: FONT_FAMILY, fontSize: scaledFont(FONT.tiny) },
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
          fontSize: scaledFont(FONT.tiny),
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
   * 说明折行的可用宽度：**内框**宽 - 滚动条让位。
   *
   * ⚠️ 内框 = 外框减 `SKILL_DETAIL.padding`（左右各一圈）—— 用户要求加
   * padding，而**折行必须按减完之后的宽度算**，否则长行会压到右边框上
   * （绘制时再挪一下是治不了的：已经把行折错了）。
   *
   * ⚠️ 与 `drawFrame` 画滚动条用的那个 `SCROLLBAR_PAD` 同源 ——
   * 两处各减一次就会让最长的那行压在滚动条上。
   */
  private descWidth(): number {
    return Math.max(1, detailContentRect().w - SCROLLBAR_PAD);
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
      lines: [1, this.descRows(), 1],
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
    this.content.y = detailContentRect().y;
    this.content.visible = false;
  }

  /**
   * **缩放变了**：重设字号 → 重新量宽 → 重新折行 → 重新摆位。
   *
   * ⚠️ 折行**必须**重来：行是拿 `measure` 量出来的，字号一变，同一段文字
   * 折的行数就变了（不重折 = 按旧字号折、按新字号画 → 长行溢出）。
   *
   * ⚠️ 字号**只在真的变了才设**（`Label.setSize` 内部短路，Pixi 的
   * `fontSize` 一变就重新光栅化纹理 —— 那是每帧路径上不能有的开销）。
   */
  relayout(): void {
    const size = scaledFont(FONT.tiny);
    this.name.setSize(scaledFont(FONT.body));
    this.tags.setSize(size);
    this.stats.setSize(size);
    this.moreHint.setSize(size);
    this.measureText.style.fontSize = size;
    for (const t of this.descLines) t.style.fontSize = size;
    if (this.last === undefined) return;
    /** ⚠️ 缩放变了但技能没变：**保留**当前滚动位置（`resetScroll: false`）。 */
    this.applyText(this.last, false);
  }

  /** 按**当前字号**把一段说明折成行（`render` 与 `relayout` 共用）。 */
  private wrapDescription(desc: string): readonly string[] {
    return wrapText({
      text: desc,
      width: this.descWidth(),
      measure: this.measure,
      /**
       * ⚠️ **放开**（2026-10-12 用户："放开"）：上限**只**由
       * `DESC_MAX_LINES` 决定。
       *
       * 修之前这里是 `Math.min(DESC_MAX_LINES, viewRows() - 2)` ——
       * 那个 `viewRows() - 2` 让 `total ≤ viewRows()` **结构上恒成立**，
       * 于是 `scrollable()` 永远为假：滚轮 / 拖拽 / 滚动条 / 方向提示
       * **四样全都走不到**，超长说明只是被静默截断。推导见
       * `./detailWindow` 的文件头。
       *
       * ⚠️ 放开之后裁剪**不能再靠折行兜**（行数真的会比一屏多）——
       * 改由 `clipToWindow` 按 `offset` 逐行判可见性，见那里。
       */
      maxLines: DESC_MAX_LINES,
    });
  }

  /**
   * 把**文本与摆位**套上去（换技能 / 缩放变了都走它）。
   *
   * ⚠️ 标签行（tags）的 x 依赖名字的**实际渲染宽度**，所以它在 `this.name`
   * 设完之后才定位 —— 顺序反了会用到上一帧的宽度。
   */
  private applyText(
    t: { readonly name: string; readonly tags: string; readonly stats: string; readonly desc: string },
    /** 换了技能 = `true`（滚回顶部）；缩放变了 = `false`（留在原处）。 */
    resetScroll: boolean,
  ): void {
    this.name.set(t.name);
    this.tags.set(t.tags);
    this.stats.set(t.stats);
    this.wrapped = this.wrapDescription(t.desc);

    const TAG_GAP = 10;
    this.tags.root.x = this.name.root.width + TAG_GAP;
    this.tags.root.y = 0;

    /**
     * ⚠️ 代价行必须**按说明折了几行**往下摆 —— 写死 `y = LINE_H * 2`
     * 会在说明折成 2 行时被压住（这一轮踩过）。
     */
    const descRows = this.descRows();
    this.stats.root.y = lineH() * (1 + descRows);
    for (let i = 0; i < this.descLines.length; i += 1) {
      const line = this.descLines[i];
      if (line === undefined) continue;
      /** ⚠️ 超出折行数的行**清空**（否则会留着上一个技能的尾巴）。 */
      line.text = this.wrapped[i] ?? '';
      line.y = lineH() * (1 + i);
    }

    this.totalRows = this.rowsOf(descRows);
    /**
     * ⚠️ 换了技能必须**滚回顶部**（否则短说明会停在上一个的滚动位置上）；
     * 只是缩放变了则**保留**位置（`clampOffset` 会按新的行数钳好）。
     */
    this.offset = clampOffset(resetScroll ? 0 : this.offset, this.totalRows, viewRows());
    this.applyOffset();
    this.root.visible = true;
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
     *
     * ⚠️ **`descParams` 必须透传**：说明里的秒数（`{seconds}`）由
     * `app/keyRows.ts` 从 buff 的 `duration` 推导 —— 不透传的话
     * `t()` 会把 `{seconds}` 原样画出来（本仓库踩过一次同样的坑，
     * 见 `rows.ts` 的 `castText` 与 `lintRules.test.ts` 那条扫描）。
     */
    const desc =
      row.descKey === undefined
        ? ''
        : t(row.descKey, row.descParams).replaceAll('**', '');
    /**
     * **结构化行**：消耗 · 冷却 · 施放。
     *
     * ⚠️ 三段都由上层**格式化好**（走 i18n 模板）—— 这里只负责拼，
     * 不自己造文案。
     */
    const stats = [row.costText, row.cdText, row.castText]
      .filter((x): x is string => x !== undefined && x !== '')
      .join('   ');

    /**
     * 说明**自己折行**（不靠 Pixi 的 `wordWrap`）—— 折出来的行要**逐行
     * 画**，这样才能只画看得见的那几行（裁剪不依赖渲染器，见 `./wrapText`）。
     */
    this.last = { name: t(row.nameKey), tags, stats, desc };
    this.applyText(this.last, true);
  }

  /**
   * 说明占了几行（**唯一**算法：至少 1 行 —— 空说明也占掉名字下面那一行，
   * 否则代价行会顶上来）。
   *
   * ⚠️ 抽成方法而不是在两处各写一遍 `Math.max(1, wrapped.length)`：
   * `render`（摆代价行）与 `applyOffset`（判窗口）都要它，两处漂了就会
   * 出现"代价行在窗口外却还画着"。
   */
  private descRows(): number {
    return Math.max(1, this.wrapped.length);
  }

  /**
   * **按当前 `offset` 把窗口外的行藏起来**（自己做的裁剪）。
   *
   * ==================================================================
   * ⚠️ 为什么放开 `maxLines` 之后必须有它
   * ==================================================================
   *
   * `content` 容器靠 `y` 上移实现滚动，而 `descLines` 这一池 `Text` 是
   * **内容行**的槽位（第 i 槽放 `wrapped[i]`，第 i 槽的内容行号是 `1 + i`
   * —— 第 0 行是名字）。
   *
   * 内容没超过一屏时，一行都不会跑到区外（旧代码正是靠这条）。一旦长说明
   * 真的比一屏高，窗口外的行就会被画到详情区**外面**，压在下面的提示行上
   * （本仓库的 Pixi 遮罩在 headless 下不生效，见 `./wrapText`）—— 所以
   * 裁剪只能自己做，判据是 `./detailWindow.contentRowVisible`。
   *
   * ⚠️ 只切 `visible`、**不改 `text`**：`text` 由 `render` 填一次（换技能
   * 才变），滚动时反复写同样的字串只会白花测量/重绘的开销。
   */
  private clipToWindow(): void {
    /**
     * **遮罩几何 = 内容视口**（`content` 的局部坐标：左上角就是内容原点）。
     *
     * ⚠️ 2026-10-22 口径变更：这里**不再**"整行可见才画"（那条会把跨在
     * 下缘的行整行藏起来 —— 用户："一段话要么完全显示、要么完全不显示"
     * 这不是我要的）。现在按像素裁：部分露出的行照画，越界的那截由
     * `mask` 切掉 ✓
     */
    const vp = detailContentRect();
    drawViewportClip(this.maskGfx, { x: 0, y: 0, w: vp.w, h: vp.h });

    /**
     * ⚠️ 行的**可见性**仍要判一次：**完全滑出视口**的行不必画（性能；而且
     * `descLines` 是复用池，不藏会带着上一段说明的字留在屏上）。
     * 判据用"行的上沿 / 下沿 vs 视口"，与内容容器自己的位移（`content.y`）同源。
     */
    const rows = viewRows();
    const offset = this.offset;
    const descRows = this.descRows();
    const line = lineH();
    /**
     * 视口在**内容坐标**里：`[offset × 行高, 再往下 rows 行)`。
     * 判据用 `viewportMask.fullyOutside` 的**反面**（与图鉴 / 详情区同一份
     * "露出来了吗"，没有第二套写法）。
     */
    const viewport = { x: 0, y: offset * line, w: vp.w, h: Math.max(1, rows * line) };
    const visible = (row: number): boolean =>
      !fullyOutside({ x: 0, y: row * line, w: vp.w, h: line }, viewport);

    this.name.root.visible = visible(0);
    this.tags.root.visible = visible(0);
    this.stats.root.visible = visible(1 + descRows);
    for (let i = 0; i < this.descLines.length; i += 1) {
      const t = this.descLines[i];
      if (t === undefined) continue;
      t.visible = visible(1 + i);
    }
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
    /** ⚠️ 摆在内框的右下角（外框那圈是 padding，提示贴到边上就白加了）。 */
    const vp = detailContentRect();
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

  /**
   * 把偏移套到内容上：**钳位 → 上移 → 裁掉窗口外的行 → 重画**。
   *
   * ⚠️ `clipToWindow()` 必须在这里（而不是只在 `render` 里）：滚动会换
   * 窗口，而"哪些行画得出来"完全由 `offset` 决定 —— 漏了它就会在**滚起来
   * 之后**把内容画到详情区外面（这正是"放开 `maxLines`"带来的新情况）。
   */
  private applyOffset(): void {
    const rows = viewRows();
    this.offset = clampOffset(this.offset, this.totalRows, rows);
    /** ⚠️ 从**内框**顶开始上移（留白不参与滚动 —— 它是边框，不是内容）。 */
    this.content.y = detailContentRect().y - this.offset * lineH();
    this.clipToWindow();
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
    const vp = detailViewport();
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
    /**
     * **画滚动条 = 共用画笔**（2026-10-22，用户："请统一"）。
     *
     * ⚠️ 这一条是**行式**滚动（按行算位置），而画笔的入参叫 `…Px` ——
     * 但 `scrollBarGeometry` 本质是**比例**运算，所以 **三个入参都用"行"
     * 当单位**传进去，结果与按像素算逐位相同 ✓（这与备战卡片区那条像素式
     * 调用共用**同一份**几何和**同一份**画法，只是单位不同）。
     * 于是这里不再自己算 `scrollThumbRatio` / `scrollFraction` ✗
     * —— 那正是用户说的"各自画"。
     */
    paintScrollBar({
      gfx: g,
      track: { x: vp.x + vp.w - SCROLLBAR_W - 2, top: vp.y + 2, len: vp.h - 4 },
      viewportPx: viewRows(),
      maxScrollPx: Math.max(0, this.totalRows - viewRows()),
      scrollPx: this.offset,
      width: SCROLLBAR_W,
      minLengthPx: SCROLLBAR_MIN_H,
    });
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
    const dy = (drag.logicalY - logicalY) / lineH();
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
