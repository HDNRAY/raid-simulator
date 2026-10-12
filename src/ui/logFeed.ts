/**
 * 战斗中那条**实时日志列**的排版：把一句话折成 1~2 行，再从下往上堆。
 *
 * ==================================================================
 * 为什么需要它（父 agent 实测发现的问题）
 * ==================================================================
 *
 * 日志文案改成"博德之门3"那种完整句子之后，一条有 20+ 字：
 *
 *     傲慢用「轻蔑」击中林晚风，造成 20 点伤害
 *
 * 而战斗中那个小面板只有 **160 逻辑像素宽**（`LAYOUT.log`），
 * `FONT.tiny`(11) 一行只放得下 ~13 个汉字 —— 于是"造成 20 点伤害"
 * 整段跑到面板外面去了。实测截图里那一行是断的。
 *
 * 三种修法里选了**折行**：
 *   - 加宽面板：左边只剩到 Boss 本体（x≈246）那么点余量，加到头也只多
 *     6~7 个字；而且面板的缩放锚点是 `'right'`（见 `uiLayout.logPanel`），
 *     更宽会让 `uiScale > 1` 时它更早跑出画布
 *   - 战斗中显示"短形式"：要新造一套文案 key，且**读起来就不是那句话了**
 *   - **折行**：信息不丢、不加文案、不动别人的几何 —— 代价是面板从
 *     "10 条单行"变成"约 6 条双行"（面板下半部分的留白正好用上）
 *
 * ==================================================================
 * 为什么是"估算宽度"而不是问 Pixi
 * ==================================================================
 *
 * Pixi 的 `Text` 能在设完文本后读 `width/height`，但那样排版就变成
 * **命令式**的：先写、再量、再挪 —— 无法在 Node 里单测，而且每帧都要
 * 触发一次文本光栅化。这里改成**先算好再写**：等宽族（`FONT_FAMILY_MONO`）
 * 的汉字正好一个字宽、半角约 0.6 个字宽，估算足够准；断行也由我们
 * 自己决定，所以"算出来的行"和"画出来的行"**必然是同一批**。
 *
 * 误差只可能让某一行比可用宽度多/少几个像素 —— 不会重叠、不会溢出屏幕。
 */

/** 一条最多折几行。再多的话面板一屏只剩两三条，"实时滚动"就没意义了。 */
export const FEED_MAX_LINES = 2;

/** 省略号。⚠️ U+2026 **不是**中日韩字符，所以不会触发 I1 的硬编码检查。 */
const ELLIPSIS = '…';

/** 半角字符的字宽（相对字号）。等宽族的 ASCII 前进宽度约 0.6em。 */
const NARROW_RATIO = 0.6;

/**
 * 文字列与面板左右边缘的距离。
 *
 * ⚠️ 它与 `LogPanel` 里的用法是**一份约定**（标签的 x 与可用宽度都由它算），
 * 所以放这里而不是各写一个 8 —— 两处对不上时，折行算出来的宽度就不是
 * 屏幕上真正的宽度了。
 */
export const FEED_PAD_X = 6;

/**
 * 断行时"为了不断开一个词"最多允许多占的宽度。
 *
 * 实测的那一条是 `林晚风用「轰」击中傲慢，造成 10 点伤害`：文字列 148px，
 * 而"…击中傲慢，造成"正好 154px —— 多 6px。硬按字符断就会把「造成」
 * 劈成"造 / 成"（截图里很难看）。多给 6px 就能断在空格处，
 * 而这一行**仍然落在面板矩形内**（`FEED_PAD_X + 148 + 6 = 面板宽`）。
 */
export const FEED_BREAK_SLACK = 6;

/** 找空格时往前看几个字符（再远就不值得为它多占宽度了）。 */
const SPACE_LOOKAHEAD = 2;

/**
 * 全角（"一个字宽"）字符的码点区间。
 *
 * 刻意只覆盖**本游戏会出现的**文字：汉字、假名、全角标点（`，。「」`）、
 * 韩文。规则写全了也没用 —— 真正要保证的是"汉字按一个字宽算"，
 * 其余一律按半角。
 */
function isWideCode(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/** 单个字符的估算宽度（逻辑像素）。 */
export function charWidth(ch: string, size: number): number {
  const code = ch.codePointAt(0);
  if (code === undefined) return 0;
  return isWideCode(code) ? size : size * NARROW_RATIO;
}

/** 整串的估算宽度（逻辑像素）。 */
export function estimateWidth(text: string, size: number): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch, size);
  return total;
}

/**
 * 按宽度断行（**不**自动省略）。
 *
 * 断点优先选**空格**：文案里的 `造成 {amount} 点伤害` 在数字两边各有一个
 * 空格，那是天然的断点（"…造成" / "20 点伤害"），比在汉字中间切开好读得多。
 * 两级：
 *   1. 已经吃进来的部分里有空格 → 断在那儿（但空格太靠左时不用，否则
 *      第一行会空掉一大截）
 *   2. 放不下的那个字**后面紧跟空格** → 连它一起带上（多占 `FEED_BREAK_SLACK`
 *      以内），这样"造成"不会被劈成两半
 *   都不成立才按字符断。
 */
function breakLines(text: string, maxPx: number, size: number): string[] {
  const chars = [...text];
  const lines: string[] = [];
  let start = 0;

  while (start < chars.length) {
    let end = start;
    let width = 0;
    while (end < chars.length) {
      const w = charWidth(chars[end] ?? '', size);
      // `end > start` 保证"一个字比整行还宽"时不会死循环
      if (end > start && width + w > maxPx) break;
      width += w;
      end += 1;
    }
    if (end >= chars.length) {
      lines.push(chars.slice(start).join(''));
      break;
    }

    const lineChars = chars.slice(start, end);
    const spaceAt = lineChars.lastIndexOf(' ');
    if (spaceAt > 0 && estimateWidth(lineChars.slice(0, spaceAt).join(''), size) > maxPx * 0.4) {
      lines.push(lineChars.slice(0, spaceAt).join(''));
      start += spaceAt + 1;
      continue;
    }

    const nextSpace = chars.indexOf(' ', end);
    if (nextSpace > 0 && nextSpace - end <= SPACE_LOOKAHEAD) {
      const head = chars.slice(start, nextSpace).join('');
      if (estimateWidth(head, size) <= maxPx + FEED_BREAK_SLACK) {
        lines.push(head);
        start = nextSpace + 1;
        continue;
      }
    }

    lines.push(lineChars.join(''));
    start = end;
  }
  return lines;
}

/** 从头截断到 `maxPx`，末尾加省略号（保证结果 ≤ `maxPx`）。 */
function ellipsize(text: string, maxPx: number, size: number): string {
  let out = text;
  while (out.length > 0 && estimateWidth(`${out}${ELLIPSIS}`, size) > maxPx) {
    out = out.slice(0, -1);
  }
  return `${out}${ELLIPSIS}`;
}

/**
 * 折成最多 `maxLines` 行。
 *
 * 超出的部分**合并进最后一行再省略**，而不是直接丢掉 —— 丢掉会让玩家
 * 以为"这句话就到这儿了"，而省略号至少诚实地说"还有，但放不下"。
 * （复盘界面里这句话是完整的，那才是读全文的地方。）
 */
export function wrapToWidth(
  text: string,
  maxPx: number,
  size: number,
  maxLines = FEED_MAX_LINES,
): readonly string[] {
  if (text.length === 0) return [''];
  if (!(maxPx > 0) || !(size > 0)) return [text];

  const all = breakLines(text, maxPx, size);
  if (all.length <= maxLines) return all;
  const head = all.slice(0, Math.max(1, maxLines) - 1);
  const tail = all.slice(Math.max(1, maxLines) - 1).join('');
  return [...head, ellipsize(tail, maxPx, size)];
}

/** 排版参数（全部来自面板几何，不写死）。 */
export interface FeedLayoutOptions {
  /** 文字区的底缘（最新的那一条贴在这里，往上排）。 */
  readonly bottomY: number;
  /** 文字区的顶缘（标题下方）。到顶就停 —— 不会画到标题上。 */
  readonly topY: number;
  /** 文字列可用宽度。 */
  readonly maxPx: number;
  readonly size: number;
  /** 单行高（含行距）。 */
  readonly lineH: number;
  /** 条与条之间的额外空隙。 */
  readonly rowGap: number;
  /** 最多几条（= 一次性建好的标签数，不能超）。 */
  readonly maxBlocks: number;
}

/** 排好的一条：折好的行 + 文字块顶部的 y。 */
export interface FeedBlock {
  readonly lines: readonly string[];
  readonly y: number;
}

/**
 * 从**最新**往上排，直到顶缘或标签用完。
 *
 * 返回的顺序是"新 → 旧"（第 0 条 = 面板最下面那条），调用方按这个顺序
 * 对应它自己那排标签即可（标签 0 在底部）。
 */
export function layoutFeed(
  texts: readonly string[],
  options: FeedLayoutOptions,
): readonly FeedBlock[] {
  const out: FeedBlock[] = [];
  let cursor = options.bottomY;
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    if (out.length >= Math.max(1, options.maxBlocks)) break;
    const lines = wrapToWidth(texts[i] ?? '', options.maxPx, options.size);
    const h = lines.length * options.lineH;
    const top = cursor - h;
    if (top < options.topY) break;
    out.push({ lines, y: top });
    cursor = top - options.rowGap;
  }
  return out;
}
