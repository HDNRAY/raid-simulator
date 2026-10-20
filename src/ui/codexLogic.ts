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
  cardW: 160,
  cardH: 104,
  gapX: 16,
  gapY: 16,
  cols: 5,
  hintY: 500,
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
  const totalH = rows * L.cardH + (rows - 1) * L.gapY;
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
        y: top + row * (L.cardH + L.gapY),
        w: L.cardW,
        h: L.cardH,
      });
    }
  }
  return out;
}
