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
  /**
   * 卡片高 **148**（2026-10-22 用户："卡片可以高一点，写不下的可以换行"）。
   *
   * 演进 104 → 108（加解锁条件）→ 132（加说明）→ **148**（说明与条件都折行）。
   * 148 是"名字 + 最多 3 行说明 + 最多 2 行条件"排得下的最小高度
   * （算式在 `cardTextPlan` 里，由单测钉住）—— 再矮就得砍行数。
   */
  cardH: 148,
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
   * ⚠️ **卡片高度固定、内容允许超出视口**（2026-10-22 用户："图鉴应该支持
   * 滚动"）。第一版是"按行数把卡片压矮到刚好一屏" —— 那样**永远不用滚** ✗，
   * 一旦池子再长就变成 5 行挤在 356 像素里（字全糊）。
   * 现在：卡片保持 `L.cardH`，超出的行靠**滚动**看（`CodexScreen.scrollBy`）。
   * 边缘那一行被 `mask` **按像素切**（见 `ui/viewportMask`）—— 这里只算几何，
   * 不负责裁剪 ✓。
   */
  const cardH = L.cardH;
  /** 整块网格在标题与提示之间**纵向**居中（`firstCardY` 是它的下限）。 */
  /**
   * 内容从 `firstCardY` 起、**不再纵向居中** —— 居中会让"内容比视口高"时
   * 顶部出现负偏移（滚不动 / 首行被切）✗。滚动坐标必须有一个**固定的原点**。
   */
  const top = L.firstCardY;

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
export function wrapByChars(text: string, args: {
  readonly perLine: number;
  /** 最多几行；**省略 = 不限行**（解锁条件那类"必须写完"的文本用）。 */
  readonly maxLines?: number;
}): readonly string[] {
  const perLine = Math.max(1, Math.trunc(args.perLine));
  const maxLines = Math.max(1, Math.trunc(args.maxLines ?? Number.MAX_SAFE_INTEGER));
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

/* ------------------------------------------------------------------ *
 * 滚动（2026-10-22，用户："图鉴应该支持 滚动"）
 * ------------------------------------------------------------------ */

/**
 * 滚动的**上界**（内容比视口高多少）。内容比视口矮 ⇒ 0（不滚）。
 *
 * ⚠️ 这是一个**纯函数**，因为"能滚多大"是布局的性质，不是状态的性质 ——
 * 状态（`offset`）只该被夹在这个范围内（`clampScrollOffset`）。
 */
export function maxScrollOffset(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, Math.round(contentHeight - viewportHeight));
}

/** 把偏移夹进 `[0, max]`（滚轮 / 拖拽 / 键盘都走它，判据只有一处）。 */
export function clampScrollOffset(offset: number, max: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.round(offset)), Math.max(0, Math.round(max)));
}


/* ------------------------------------------------------------------ *
 * 卡片里的三行字（2026-10-22）
 * ------------------------------------------------------------------ */

/** 卡片里三行字的排版计划（坐标 = **相对卡片上沿的中心线**）。 */
export interface CardTextPlan {
  /** 名字那一行的中心。 */
  readonly nameY: number;
  /** 效果说明**整块**的中心（多行时以块中心对齐 —— `Label` 的 `anchorY` 是 0.5）。 */
  readonly descY: number;
  /** 效果说明最多几行。 */
  readonly descLines: number;
  /** 解锁条件**整块**的中心。 */
  readonly condY: number;
  /** 解锁条件最多几行。 */
  readonly condLines: number;
}

/** 小字行高（`FONT.small` = 13，中文行高约 1.3 倍）。 */
export const CODEX_LINE_H = 17;

/**
 * **卡片内三行文字的左内边距**（唯一一处；用户 2026-10-22：
 * "解锁条件左侧为什么有padding…三行必须同一条左基线"）。
 *
 * ⚠️ 之前名字是 `rect.x + 18`、说明与条件**居中** —— 两种对齐混着，
 * 一眼就能看出"这一行左边多了一块空" ✗。现在三行**统一左对齐 + 同一个
 * inset**，数字只有这一个。
 */
export const CARD_TEXT_INSET = 12;
/** 卡片内边距（上下各留一点，不然描边会贴字）。 */
const CARD_PAD_TOP = 10;
const CARD_PAD_BOTTOM = 10;
/** 名字那一行占的高度（含与下面两块的间距）。 */
const NAME_BAND = 24;

/**
 * 按**卡片高度**算出三行字怎么排（行数是溢出的唯一判据）。
 *
 * ```
 *   名字      从顶 + 10 起，占 24
 *   条件      **贴底**（1~2 行，按卡片够不够高）
 *   说明      吃掉名字与条件之间的**剩余行数**（最多 4 行）
 * ```
 *
 * ⚠️ 为什么"条件贴底、说明吃剩余"：条件每一行都是"解锁条件：xxx"，玩家
 * 找它时视线在卡片底部（与图鉴选择屏的卡片一致）；而说明长短差别最大，
 * 让它吸收剩余空间，卡片就不必为最长的那条说明变得特别高 ✓
 *
 * ⚠️ 纯函数：`cardH` 是唯一的输入，所以"卡片多高 ⇒ 每块几行"能在 node 里
 * 直接测（`tests/unit/codexCardText.test.ts`）。
 */
export function cardTextPlan(args: {
  readonly cardH: number;
  /**
   * 解锁条件**实际**几行（由内容折行算出来，不是预估）。
   *
   * ⚠️ 用户 2026-10-22："解锁条件 写不下换行 **不要省略**…锚点设在底部，
   * 内容多可以被挤上来" ⇒ 条件**不定上限**，行数由内容说了算；被挤的是
   * 上面的说明（`descLines` 跟着变少，甚至 0 行）。
   */
  readonly condLines: number;
}): CardTextPlan {
  const h = Math.max(CODEX_LINE_H * 3, Math.round(args.cardH));
  const condLines = Math.max(1, Math.trunc(args.condLines));
  const condH = condLines * CODEX_LINE_H;
  const condTop = h - CARD_PAD_BOTTOM - condH;
  const descTop = CARD_PAD_TOP + NAME_BAND;
  /**
   * 说明能吃几行：**条件占剩下的高度先扣掉**（条件优先），说明拿剩下的。
   * 可以是 **0**（条件太占地方 ⇒ 说明整块不画，而不是压到条件上）。
   */
  const room = Math.floor((condTop - 4 - descTop) / CODEX_LINE_H);
  const descLines = Math.max(0, Math.min(4, room));
  const descH = descLines * CODEX_LINE_H;
  return {
    /** 名字的中心：名字带的正中。 */
    nameY: CARD_PAD_TOP + NAME_BAND / 2,
    descY: descTop + descH / 2,
    descLines,
    condY: condTop + condH / 2,
    condLines,
  };
}

/**
 * **按硬换行分段折行**（2026-10-22）。
 *
 * 解锁条件那串文案是 `"解锁条件\n<条件正文>"`（前缀由 `app/unlockText` 统一
 * 加，见那里）—— 前缀自己一行，正文再按宽度折。
 *
 * ⚠️ 不能整串直接 `wrapByChars`：那会把 `\n` 当成一个普通字符计数，折出来的
 * 行会把两段黏在一起（"解锁条件局内用「斩」…"）✗。
 * ⚠️ **不限行数、不省略**（用户："写不下换行 不要省略"）。
 */
export function wrapHardLines(text: string, perLine: number): readonly string[] {
  const out: string[] = [];
  for (const segment of text.split('\n')) {
    const trimmed = segment.trim();
    if (trimmed === '') continue;
    out.push(...wrapByChars(trimmed, { perLine }));
  }
  return out;
}
