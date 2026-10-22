/**
 * **图鉴的纯逻辑**（2026-10-20）。
 *
 * ==================================================================
 * 它回答两个问题（一个不多）
 * ==================================================================
 *
 *   1. 图鉴里**每一条**炁机显示什么：已解锁 ⇒ 真名字 + 说明；
 *      未解锁 ⇒ **？？？**（卡片本身照画，用户："保持 UI 然后内容 ？？？"）
 *   2. 卡片在 960×540 里**摆在哪**（渲染与命中测试共用，与首页/备战同一条）
 *
 * ⚠️ **它不判断"解锁"本身**：那条判据只有一份（`core/run/unlock.isUnlocked`
 * 求值 `QijiUnlock`）—— 这里只是"把结果翻译成界面要的形状"。
 *
 * ⚠️ 没有进行中的一局时（首页进来的图鉴）拿不到统计 ⇒ 只认
 * `unlock.kind === 'always'` 的那几条（它们本来就不需要统计）。这是
 * **有意的**：图鉴不该伪造"整局统计"，那会让"已解锁"变成一个说不清的数字。
 */

/**
 * **图鉴的条目形状 + 几何**（2026-10-20）。
 *
 * ⚠️ **解锁判定不在这里**：`ui/` 不许 import `core/` 的内部模块
 * （架构规范 C3，`raid/render/no-core-internals` 守着）—— 所以"哪条已解锁"
 * 在 `app/codexEntries.ts` 里算，这里只收结果。
 */

/** 图鉴里的一条。 */
export interface CodexEntry {
  readonly id: string;
  /** 已解锁的名字 key；未解锁是 `undefined`（界面画「？？？」）。 */
  readonly nameKey: string | undefined;
  readonly descKey: string | undefined;
  readonly unlocked: boolean;
  /**
   * **解锁条件的人话**（2026-10-20，用户："要显示 炁机解锁条件"）。
   *
   * ⚠️ 已解锁的也照写（"怎么来的"也是图鉴该说的）—— 由 `app/unlockText`
   * 从 `QijiUnlock` **推导**，不是手写的第二份。
   */
  readonly unlockText: string;
}

/* ------------------------------------------------------------------ *
 * 几何：5 列 × N 行
 * ------------------------------------------------------------------ */

export interface CodexLayout {
  readonly width: number;
  readonly height: number;
  /** 标题中心 y。 */
  readonly titleY: number;
  /** 摘要（已解锁 N / 共 M）中心 y。 */
  readonly summaryY: number;
  /** 第一行卡片的上边缘。 */
  readonly firstCardY: number;
  readonly cardW: number;
  readonly cardH: number;
  readonly gapX: number;
  readonly gapY: number;
  /** 一行几张。 */
  readonly cols: number;
  /** 提示行中心 y。 */
  readonly hintY: number;
}

export const CODEX_LAYOUT: CodexLayout = {
  width: 960,
  height: 540,
  titleY: 56,
  summaryY: 92,
  firstCardY: 132,
  /**
   * ⚠️ 2026-10-20：卡片加高（104 → 132）—— 多了一行"解锁条件"
   * （用户："要显示 炁机解锁条件"）。5 列 × 2 行仍然装得下（高 280）。
   */
  /**
   * ⚠️ 2026-10-20：池子 10 → **12** 条（两条新炁机）⇒ 3 行；列从 5 降到 **4**。
   *
   * 判据是**字号**（`ui/layout.ts`：中文 ≥ 13）：解锁条件要按 `FONT.small`
   * 画，5 列 176 宽一行只放得下 ~13 个字，长条件（"同时满足：…"）会溢到邻卡上。
   * 4 列 × 210 宽一行 ~15 个字 → 两行放得下；`108 + 12` 让三行收在 480，
   * 不压 `hintY 500`。
   */
  /**
   * ⚠️ 2026-10-20 又一条（「重击回缠」拆成两条 ⇒ 池子 13）⇒ 回到 **5 列**。
   * 5×180 + 4×8 = 932 宽；3 行（5+5+3）收在 476，提示行下移到 524。
   */
  cardW: 180,
  cardH: 108,
  gapX: 8,
  gapY: 10,
  cols: 5,
  hintY: 524,
};

export interface CodexRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 每一张卡片的矩形（顺序 = 条目顺序；行优先）。
 *
 * ⚠️ **逐行居中**，不是"整块网格居中"：条目数不是列数的整数倍时
 * （今天 10 条 = 5×2 正好，但池子会长），最后一行不满就**按这一行自己的
 * 宽度居中** —— 否则少一张就会堆在左边，看起来像漏画了。
 */
export function codexCardRects(
  count: number,
  L: CodexLayout = CODEX_LAYOUT,
): readonly CodexRect[] {
  if (count <= 0) return [];
  const rows = Math.ceil(count / L.cols);
  /**
   * ⚠️ 池子会长（2026-10-22 已 19 条 = 4 行）⇒ **卡片高度按行数自适应**：
   * 行数多了就把每张压矮，而不是让它压到提示行 / 越出画布。
   * 可用高度 = 提示行之上（`firstCardY` 起，到 `hintY - 16`）。
   */
  const availH = Math.max(1, L.hintY - 16 - L.firstCardY);
  const cardH = Math.max(64, Math.min(L.cardH, Math.floor((availH - (rows - 1) * L.gapY) / rows)));
  const totalH = rows * cardH + (rows - 1) * L.gapY;
  /** 整块网格在标题与提示之间**纵向**居中（`firstCardY` 是它的下限）。 */
  const top = Math.max(L.firstCardY, Math.round((L.height - totalH) / 2));

  const out: CodexRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    const inRow = Math.min(L.cols, count - row * L.cols);
    const rowW = inRow * L.cardW + (inRow - 1) * L.gapX;
    const left = Math.round((L.width - rowW) / 2);
    for (let col = 0; col < inRow; col += 1) {
      out.push({
        x: left + col * (L.cardW + L.gapX),
        y: top + row * (cardH + L.gapY),
        w: L.cardW,
        h: cardH,
      });
    }
  }
  return out;
}

/**
 * 把一段**中文**按字数折行（给卡片上的解锁条件用）。
 *
 * ⚠️ 为什么不量像素：`Label` 的宽度要等 Pixi 排完版才知道，而这里要的是
 * "画几行"的**确定性**（布局测试要能算）。中文是等宽的，所以"一行几个字"
 * 已经够准；拉丁字符按 1 个字算（保守）。
 *
 * ⚠️ 超过 `maxLines` 就**截断加省略号**：条件再长也不许压到下一张卡上。
 */
export function wrapByChars(text: string, args: { readonly perLine: number; readonly maxLines: number }): readonly string[] {
  const perLine = Math.max(1, Math.trunc(args.perLine));
  const maxLines = Math.max(1, Math.trunc(args.maxLines));
  const chars = [...text];
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += perLine) {
    lines.push(chars.slice(i, i + perLine).join(''));
    if (lines.length === maxLines) break;
  }
  if (lines.length === maxLines && chars.length > perLine * maxLines) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = `${[...last].slice(0, Math.max(1, perLine - 1)).join('')}…`;
  }
  return lines;
}
