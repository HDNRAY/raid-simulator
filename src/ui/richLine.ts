/**
 * **一行"富文本"**：把 `**…**` 强调段画成**另一个颜色**（2026-10-22）。
 *
 * ==================================================================
 * 为什么需要它
 * ==================================================================
 *
 * 用户两次提到同一件事：
 *
 * > 数字前后不要加空格，**可以用不同颜色表示数值**
 * > 之前说的 数字之前不要空格，**改成数字有颜色**，刚才没改？
 *
 * 而 Pixi 的**一个 `Text` 不能行内变色**（`style.fill` 是整段一个值）——
 * 所以以前只能拿 `stripEmphasis` 把 `**` 抹掉，数字与正文同色 ✗。
 *
 * 这里把一行切成若干 **run**（普通 / 强调），**每个 run 一个 `Label`**，
 * 按"前一段的实测宽度"依次向右排。只有真的出现 `**` 时才多造 Label
 * —— 图鉴一屏几十张卡，多造对象是实打实的开销。
 *
 * ==================================================================
 * ⚠️ 折行**不归它管**
 * ==================================================================
 *
 * 调用方先用**纯文本**折好行（`codexLogic.wrapByChars`，它保证不把
 * `100%` 拆成 `100`/`%`），再把**每一行**交给 `layout()`。run 切分不能
 * 反过来影响折行结果（否则行宽会随颜色变化而跳 ✗）。
 *
 * ==================================================================
 * ⚠️ 为什么只接了图鉴卡片
 * ==================================================================
 *
 * 详情面板（`ui/prepareDetailPanel`）的正文用的是 Pixi 自带 `wordWrap`
 * —— 它自己决定断行位置，**我们拿不到行首/行尾**，所以没法按行切 run ✗。
 * 那边仍走 `stripEmphasis`（数字与正文同色）。真要统一，得先把它的折行
 * 换成我们自己的（`wrapText` 那一套）—— 属独立改动，不在本次范围。
 */

import type { Container } from 'pixi.js';
import { Label, type PixiCtor } from './primitives';

/** 一段（同色）文本。 */
export interface RichRun {
  readonly text: string;
  /** 是否来自 `**…**`（⇒ 用强调色画）。 */
  readonly emphasis: boolean;
}

/**
 * 把一行切成 run（**纯函数**，可在 node 里测）。
 *
 * - `'造成**3**层'` ⇒ `[造成][3*][层]`
 * - 未闭合的 `**`、空串、连续 `****` 都**不抛错**：多余的分隔符当普通字符
 *   处理（宁可显示两个星号，也不要因为文案写错就白屏 ✗）
 */
/**
 * **带标记折行**：按**纯文本**折（宽度、`100%` 不拆开都由 `wrapByChars` 保证），
 * 但返回的每一行**保留 `**` 标记** ⇒ 交给 `RichLine.layout()` 就能上色。
 *
 * ⚠️ 为什么需要它：`RichLine.layout()` 要求"行内可能含 `**`"，而折行必须按
 * **抹掉标记后**的字符数算（否则 `**` 占的宽度会让折行位置随颜色跳 ✗）。
 * 2026-10-22 的 bug 就是"先 `stripEmphasis` 再喂 layout"——标记没了，颜色也就没了 ✗。
 */
export function wrapMarked(
  text: string,
  spec: { readonly perLine: number; readonly maxLines?: number },
  wrap: (plain: string, spec: { readonly perLine: number; readonly maxLines?: number }) => readonly string[],
): readonly string[] {
  /** 逐字记下"这个可见字符是否处于 `**…**` 里"。 */
  const flags: boolean[] = [];
  const plainChars: string[] = [];
  let emph = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith('**', i)) {
      emph = !emph;
      i += 1;
      continue;
    }
    plainChars.push(text[i] ?? '');
    flags.push(emph);
  }
  const plain = plainChars.join('');
  const lines = wrap(plain, spec);
  /** 按 `wrap` 给出的每行长度，从标记串里切回对应片段。 */
  const out: string[] = [];
  let cursor = 0;
  for (const line of lines) {
    const length = [...line].length;
    const slice = plainChars.slice(cursor, cursor + length);
    const sliceFlags = flags.slice(cursor, cursor + length);
    let built = '';
    let lastEmph = false;
    for (const [index, ch] of slice.entries()) {
      const isEmph = sliceFlags[index] === true;
      if (isEmph !== lastEmph) {
        built += '**';
        lastEmph = isEmph;
      }
      built += ch;
    }
    if (lastEmph) built += '**';
    out.push(built);
    cursor += length;
  }
  return out;
}

export function splitRuns(text: string): readonly RichRun[] {
  if (text === '') return [];
  const runs: RichRun[] = [];
  let rest = text;
  while (rest !== '') {
    const open = rest.indexOf('**');
    if (open < 0) {
      runs.push({ text: rest, emphasis: false });
      break;
    }
    const close = rest.indexOf('**', open + 2);
    if (close < 0) {
      /** 未闭合：整段按普通文本（保留星号，让写错的人一眼看见）。 */
      runs.push({ text: rest, emphasis: false });
      break;
    }
    if (open > 0) runs.push({ text: rest.slice(0, open), emphasis: false });
    const inner = rest.slice(open + 2, close);
    /** 连续 `****` 切成空的强调段 —— 直接跳过，别造空 Label。 */
    if (inner !== '') runs.push({ text: inner, emphasis: true });
    rest = rest.slice(close + 2);
  }
  return runs;
}

export interface RichLineOptions {
  readonly pixi: PixiCtor;
  readonly size: number;
  /** 普通段颜色。 */
  readonly baseColor: number;
  /** 强调段颜色（`**…**` 里的数字）。 */
  readonly emphasisColor: number;
  /**
   * 每行**最多几段**；超过就整行退回单段（不配色）。
   *
   * ⚠️ 这是**上限保护**：正常说明一行最多 2~3 个数字，但内容写错时
   * （比如满屏 `**`）不该让一张卡造出几十个 Label ✗。
   */
  readonly maxRunsPerLine?: number;
  /**
   * 行内对齐：`'left'`（默认，图鉴卡片）或 `'center'`（炁机选择屏的卡片
   * 是居中排版的）。
   *
   * ⚠️ center 不是"给 Label 设 anchor=0.5"：那样每一段都会各转各的，
   * 段与段之间会**重叠** ✗。正确做法是先量出整行宽度，再整体左移一半
   * （见 `layout` 的两遍走法）。
   */
  readonly align?: 'left' | 'center';
}

/** 一行的行高（与 `Label` 的字号同源 —— 首行基线由调用方给）。 */
export class RichLine {
  readonly root: Container;

  private readonly options: RichLineOptions;
  private readonly labels: Label[] = [];

  constructor(options: RichLineOptions) {
    this.options = options;
    this.root = new options.pixi.Container();
  }

  /**
   * 按行布局（每行先切 run，再逐段右排）。
   *
   * @param lines 已经折好的行（**纯文本**，可能含 `**`）
   * @param x 行首
   * @param y **首行顶部**（后续行按 `lineH` 下移）
   * @param lineH 行高
   */
  layout(lines: readonly string[], x: number, y: number, lineH: number): void {
    const cap = this.options.maxRunsPerLine ?? 4;
    const centered = this.options.align === 'center';
    let used = 0;
    let cursorY = y;
    for (const line of lines) {
      const raw = splitRuns(line);
      const runs = raw.length > cap ? [{ text: line.replaceAll('**', ''), emphasis: false }] : raw;
      /**
       * 居中：先把这一行的段按"从 0 开始"摆一遍量总宽，再整体平移。
       * ⚠️ 不能给每个 Label 设 `anchor.x = 0.5` —— 那样每段各自居中会重叠 ✗。
       */
      let lineWidth = 0;
      if (centered) {
        let probeX = 0;
        for (const [i, run] of runs.entries()) {
          const label = this.labelAt(used + i);
          label.set(run.text);
          label.setSize(this.options.size);
          probeX += label.root.width;
        }
        lineWidth = probeX;
      }
      let cursorX = centered ? x - lineWidth / 2 : x;
      for (const run of runs) {
        const label = this.labelAt(used);
        used += 1;
        label.set(run.text);
        label.setSize(this.options.size);
        label.setColor(run.emphasis ? this.options.emphasisColor : this.options.baseColor);
        label.root.x = cursorX;
        label.root.y = cursorY;
        label.root.visible = true;
        /** ⚠️ `set()` 之后 `root.width` 才是这一段的真实宽度。 */
        cursorX += label.root.width;
      }
      cursorY += lineH;
    }
    for (let i = used; i < this.labels.length; i += 1) {
      const idle = this.labels[i];
      if (idle !== undefined) idle.root.visible = false;
    }
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 惰性扩池 —— 只有真的用到那么多段才会造 Label。 */
  private labelAt(index: number): Label {
    const existing = this.labels[index];
    if (existing !== undefined) return existing;
    const label = new Label(this.options.pixi, {
      x: 0,
      y: 0,
      size: this.options.size,
      color: this.options.baseColor,
      anchorY: 0,
    });
    this.labels[index] = label;
    this.root.addChild(label.root);
    return label;
  }
}
