/**
 * **按像素宽度折行**（中文没有空格，所以不能靠"按词断行"）。
 *
 * ==================================================================
 * 为什么自己折（而不是用 Pixi 的 `wordWrap`）
 * ==================================================================
 *
 * 需求要"说明换行 + 放不下时可以滚"。滚动这一侧需要知道**每一行是什么**，
 * 因为详情区要**只画看得见的那几行** —— 而 Pixi v8 的 `Text` 不给这个
 * 信息（`style.wordWrap` 只在内部光栅化时折行，外面拿不到 `lines`）。
 *
 * 另外试过 `Container.mask`：本仓库的 Pixi 包里 `StencilMask` 是给
 * **WebGL/WebGPU** 的（canvas 渲染器另有 `CanvasStencilMaskPipe`，而
 * headless 实测遮罩**完全不生效**：文字直接画到详情区之外）。所以
 * **不靠遮罩**做裁剪 —— 只画该画的行，行为与渲染器无关。
 *
 * ⚠️ 纯函数 + 注入测量：`measure` 由调用方给（它要一个真实的 Pixi
 * `Text` 去量字体宽度）。于是本文件能在 node 里直接测（喂一个假的
 * `measure` 即可），与 `ui/scrollWindow` 同一种"可测层"。
 */

/** 量一段文本的像素宽度（注入 —— 生产里是 Pixi 的 `Text`）。 */
export type MeasureText = (text: string) => number;

export interface WrapInput {
  readonly text: string;
  /** 一行最多多宽（像素）。 */
  readonly width: number;
  readonly measure: MeasureText;
  /** 最多折几行（超出的丢掉 —— 详情区另有"还能往下滚"的提示）。 */
  readonly maxLines?: number;
}

/**
 * 把 `text` 折成不超过 `width` 的行。
 *
 * 算法是**逐字符贪心 + 二分**：对每一行先二分出"能放下的最长前缀"
 * （`measure` 单调，所以二分成立），再从那里断开。中文一个字就是一格，
 * 拉丁字母会按字符拆（`breakWords` 的语义，与 Pixi 的行为一致）。
 *
 * ⚠️ **不丢字符**：不在行首/行尾吃掉空格以外的任何东西（断了的话
 * 玩家看到的说明就与内容里的不一样了）。
 */
export function wrapText(input: WrapInput): readonly string[] {
  const { text, width, measure } = input;
  const maxLines = Math.max(1, input.maxLines ?? Number.MAX_SAFE_INTEGER);
  if (text === '') return [];
  if (width <= 0 || !Number.isFinite(width)) return [text];

  const lines: string[] = [];
  let rest = text;
  while (rest !== '' && lines.length < maxLines) {
    if (measure(rest) <= width) {
      lines.push(rest);
      rest = '';
      break;
    }
    /** 二分：最大的 `n`，使 `rest.slice(0, n)` 放得下（至少 1 个字）。 */
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (measure(rest.slice(0, mid)) <= width) lo = mid;
      else hi = mid - 1;
    }
    /**
     * 尽量断在**标点之后**（中文标点挂在行尾比挂在行首自然）——
     * 在 `lo` 前面往回找最多 4 个字符里的标点。
     */
    let cut = lo;
    for (let back = 0; back < 4 && cut > 1; back += 1) {
      const ch = rest[cut - 1];
      if (ch !== undefined && '，。、；：！？）」』…'.includes(ch)) break;
      cut -= 1;
    }
    if (cut < 1) cut = lo;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    /** 行首的空格不该占一格（视觉上会莫名缩进）。 */
    rest = rest.replace(/^ +/, '');
  }
  return lines;
}
