/**
 * **可滚内容窗口的数学**（"现在该显示哪一段"）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一段原先长在 `ui/logReview.ts` 里（复盘面板的滚动）。这一轮设置页的
 * **技能详情区**也要滚动（需求："换行呗，然后做类似 overflow scroll 的
 * 效果"），而 AGENTS.md 的纪律是"**不要另发明一套**滚动"——所以把
 * "该显示哪一段"的数学下沉成**叶子模块**，两处共用：
 *
 *   `ui/LogReviewPanel`（整屏战报）→ 一屏 `REVIEW_ROWS` 行
 *   `ui/settings/SkillDetail`（设置页详情区）→ 一屏按像素算出来的行数
 *
 * 两份实现会漂的地方恰恰是**边界**：滚到尽头、内容不足一屏、空内容 ——
 * 那些在一条路径上漏掉时，另一条路径看起来还是好的（本仓库反复踩过）。
 *
 * ⚠️ 这里全是**像素 / 行数**，不认识日志、也不认识技能：`count` 是
 * "内容有多少个单位"，`rows` 是"一屏放几个单位"。调用方决定一个单位
 * 是什么（日志 = 一条，详情区 = 一行文字）。
 *
 * ⚠️ 纯函数、零依赖 —— 能在 node 里精确测。
 */

/**
 * 一屏放几个 —— 非有限值 / 小于 1 时**至少 1**。
 *
 * 调用方给的行数是从高度**算**出来的（`可用高 / 行高`），几何一旦被改小
 * 就可能得到 0 或负数；不兜住的话后面全是 `Infinity` / `NaN`，
 * 表现成"内容凭空消失"。
 */
export function safeRows(rows: number): number {
  if (!Number.isFinite(rows)) return 1;
  return Math.max(1, Math.floor(rows));
}

/**
 * 最大偏移：等于"把头滚出屏幕"。
 *
 * `0` 表示总共不到一屏（没有可滚的）；否则是 `count - 一屏`。
 */
export function maxOffset(count: number, rows: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Math.max(0, safeCount - safeRows(rows));
}

/** 把偏移钳进 `[0, maxOffset]`（非有限值当"滚到底"）。 */
export function clampOffset(offset: number, count: number, rows: number): number {
  const max = maxOffset(count, rows);
  if (!Number.isFinite(offset)) return max;
  return Math.min(max, Math.max(0, Math.floor(offset)));
}

/**
 * 可见的那一段（**从旧到新**，偏移是"第一项的下标"）。
 *
 * ⚠️ `offset` 是"第一条可见条目在数组里的下标"，不是"距末尾多少条" ——
 * 前者才能直接 `slice`，也不会在追加新条目时让画面跳。
 */
export function visibleWindow<T>(entries: readonly T[], offset: number, rows: number): readonly T[] {
  const start = clampOffset(offset, entries.length, rows);
  return entries.slice(start, start + safeRows(rows));
}

/** 滚到最新（"先看最后发生了什么"）。 */
export function tailOffset(count: number, rows: number): number {
  return maxOffset(count, rows);
}

/** 翻页：`delta` 行，**正数 = 往新的翻**（与滚轮向下 / PageDown 一致）。 */
export function scrollOffset(
  offset: number,
  delta: number,
  count: number,
  rows: number,
): number {
  const step = Number.isFinite(delta) ? Math.round(delta) : 0;
  return clampOffset(offset + step, count, rows);
}

/**
 * 翻页一次的步长：**留一行重叠**。
 *
 * 一页正好翻 `rows` 行的话，上一页的最后一行正好落在下一页的视野之外 ——
 * 玩家会觉得"跳了一行"。留一行重叠是分页的通用做法。
 */
export function pageStep(rows: number): number {
  return Math.max(1, safeRows(rows) - 1);
}

/** 当前窗口的条数区间（1 基、闭区间；空内容给 `0-0`）。 */
export interface WindowRange {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

export function windowRange(count: number, rows: number, offset: number): WindowRange {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safeCount === 0) return { from: 0, to: 0, count: 0 };
  const start = clampOffset(offset, safeCount, rows);
  const len = Math.min(safeRows(rows), safeCount - start);
  return { from: start + 1, to: start + len, count: safeCount };
}

/** 滑块位置比例 0..1（`0` = 顶部/最旧，`1` = 底部/最新）。 */
export function scrollFraction(offset: number, count: number, rows: number): number {
  const max = maxOffset(count, rows);
  if (max === 0) return 0;
  return clampOffset(offset, count, rows) / max;
}

/** 滑块长度比例 0..1（内容不足一屏时 = 1，即滑块占满轨道）。 */
export function scrollThumbRatio(count: number, rows: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safeCount <= safeRows(rows)) return 1;
  return safeRows(rows) / safeCount;
}

/* ================================================================== *
 * 滚动条滑块：**偏移 → 几何**（唯一一份，入参具名）
 * ================================================================== */

/**
 * 一个滚动条滑块：`offset` 相对**轨道顶边**，`length` 是滑块长。
 *
 * ⚠️ 用具名结构而不是 `[number, number]`：数组里那两个都是数字，谁先谁后
 * 只能靠**记忆** —— 而这条数学上一次坏掉，坏的就是"两个同型值传反了"。
 */
export interface ScrollBarThumb {
  /** 滑块顶边到轨道顶边的距离（像素）。 */
  readonly offset: number;
  /** 滑块长度（像素）。 */
  readonly length: number;
}

/** `scrollBarGeometry` 的入参 —— 字段名就是那一串数字的**名字**。 */
export interface ScrollBarInput {
  /** 视口高 / 宽（可见的那一段）。 */
  readonly viewportPx: number;
  /** 还能滚多少（`0` = 内容不足一屏）。 */
  readonly maxScrollPx: number;
  /** 当前偏移（`0` = 顶部）。 */
  readonly scrollPx: number;
  /** 轨道长（滑块能走的那一段）。 */
  readonly trackLenPx: number;
  /** 滑块的**最小**长度（太短就抓不住；同时保证 `轨道 − 长度` 不为负 ——
   * 那条差正是"滑块能走多远"）。默认 24。 */
  readonly minLengthPx?: number;
}

/**
 * **偏移 → 滑块的位置与长度**（全仓库**唯一**一份滑动条几何）。
 *
 * ==================================================================
 * ⚠️⚠️ 它为什么长成"具名入参"（这里真咬过人）
 * ==================================================================
 *
 * 旧版是 `scrollThumbRatio(this.viewHPx, this.maxScrollPx + this.viewHPx)`
 * —— 而那个函数的签名是 `(count, rows)` = `(内容, 视口)`。参数一颠倒，
 * `safeCount(视口) <= safeRows(内容)` 就**恒成立**，于是它永远返回 `1`：
 * 滑块长度 = 整条轨道，而 `(轨道 − 滑块)` 恒为 0 —— **滑块永远贴在轨道
 * 顶端不动**（画面上是一条与轨道等长的亮条，看起来就像"没有滑块"）。
 *
 * 那正是用户报的"滚动内容 滚动条没动"：内容确实滚了（`scrollPx` 在变），
 * 滑块却一直是全长。
 *
 * ⚠️ **两份正确实现也会漂**，而且当时场上正是两份 —— 备战屏卡片区的
 * `sectionScrollbar`（`scrollThumbRatio(内容, 视口)`）与详情区的
 * `detailScrollThumb`（`(viewportPx, maxScrollPx, scrollPx, trackLenPx,
 * minLengthPx)`）：**两者参数顺序不同**，下一个人抄错一次就又回来。
 *
 * 所以这一版把两件事一起做掉，缺一件都白做：
 *
 * ```
 *   ① 收成一处      —— 调用点只拿一个函数，没有可抄错的第二份
 *   ② 入参具名      —— 那串同型 number 变成 { viewportPx, maxScrollPx,
 *                      scrollPx, trackLenPx, minLengthPx }，字段名没法
 *                      "静默传反"；返回同理是 { offset, length }
 * ```
 *
 * ⚠️ 只做 ① 不做 ② 的话，下次谁把 `viewportPx` 与 `maxScrollPx` 写反，
 * 编译器**照样不响**（两个都是 number）。
 *
 * 两条性质（单测钉的就是它们）：
 *
 * ```
 *   长度 = 视口 / 内容 的比例 × 轨道长   （不是固定长度、不是整条轨道）
 *   位置 = 进度 × (轨道长 − 长度)         ⇒ 滚到底时滑块**下缘贴轨道末端**
 * ```
 *
 * ## 单位
 *
 * 全是**像素**，不认识日志行、也不认识卡片：`viewportPx` / `maxScrollPx`
 * 由调用方给（详情的 `DetailViewport` 从 `pixelViewport` 拿，卡片区从
 * `sectionViewport` 拿）。**按行**的那些滚动条（复盘 / 设置页技能详情）
 * 不走这里 —— 它们的单位是"行"，见 `scrollThumbRatio` / `scrollFraction`。
 *
 * ⚠️ 非有限值的偏移当"滚到底"（与 `pixelViewport` 同一条口径）：拖拽
 * 累加久了可能出现 `NaN`，而 `NaN` 会一路穿过取整变成 `offset = NaN` ——
 * 那一条 `roundRect` 会静默画不出来（比画错更难查）。
 */
export function scrollBarGeometry(input: ScrollBarInput): ScrollBarThumb {
  const track = Number.isFinite(input.trackLenPx) ? Math.max(0, input.trackLenPx) : 0;
  const view = Number.isFinite(input.viewportPx) ? Math.max(0, input.viewportPx) : 0;
  const max = Number.isFinite(input.maxScrollPx) ? Math.max(0, input.maxScrollPx) : 0;
  /** ⚠️ 默认 24 与旧的两处调用点一致（卡片区写死的那个数就是它）。 */
  const minLength =
    input.minLengthPx === undefined || !Number.isFinite(input.minLengthPx)
      ? 24
      : Math.max(0, input.minLengthPx);
  /** ⚠️ 参数顺序 = `(内容, 视口)`；写反就是文件头记着的那个 bug。 */
  const contentPx = view + max;
  const ratio = scrollThumbRatio(contentPx, view);
  const length = Math.min(track, Math.max(minLength, Math.round(ratio * track)));
  const offset = Number.isFinite(input.scrollPx) ? input.scrollPx : max;
  const progress = max <= 0 ? 0 : Math.min(1, Math.max(0, offset / max));
  return { offset: Math.max(0, Math.round((track - length) * progress)), length };
}

/* ================================================================== *
 * 像素偏移的视口（同一套数学，另一种单位）
 * ================================================================== */

/**
 * 一个**像素偏移**的可滚视口（"现在该显示哪一段"）。
 *
 * ==================================================================
 * 为什么同一件东西有两种单位（这是有意的，不是重复）
 * ==================================================================
 *
 * | 单位 | 谁在用 | 为什么不能用另一种 |
 * |---|---|---|
 * | **行**（`count` / `rows`） | 复盘（`ui/logReview`）、设置页技能详情 | 它们的"一个单位"就是一行文字，按行翻页是玩家预期 |
 * | **像素**（`countPx` / `viewPx`） | 备战屏三块卡片区 | 卡片**有高有矮**（人物 40 / 炁机 40 / 行距不同），而滚轮 / 手指给的是像素 —— 换算成"第几行"再滚会让一次滚动变成"跳一整行"（手指的连续感没了） |
 *
 * ⚠️ 两者共用**同一批边界规则**（`safeRows` / `maxOffset` / `clampOffset`
 * / `scrollThumbRatio` / `scrollBarGeometry`）：这就是把它们放进同一个文件
 * 的原因 —— 两份实现会漂的地方恰恰是边界（滚到尽头、内容不足一屏、空内容），
 * 而本仓库反复踩过"一条路径漏了、另一条看起来还是好的"。
 */
export interface PixelViewport {
  /** 内容总高（逻辑像素）。 */
  readonly countPx: number;
  /** 视口高（逻辑像素）。 */
  readonly viewPx: number;
  /** 当前偏移（第一行内容上缘在视口里的位置，取负之前的值）。 */
  readonly offsetPx: number;
  /** 还能往下滚多少（0 = 内容不足一屏）。 */
  readonly maxPx: number;
}

/**
 * 从"内容多高 / 视口多高 / 现在滚到哪"算出这个视口。
 *
 * ⚠️ `offsetPx` 会被**钳进** `[0, maxPx]`：调用方（滚轮 / 拖拽）给的是
 * 相对位移，累加久了必然越界；不钳的话内容会滚出面板留下空白。
 */
export function pixelViewport(countPx: number, viewPx: number, offsetPx: number): PixelViewport {
  const count = Number.isFinite(countPx) ? Math.max(0, countPx) : 0;
  const view = Number.isFinite(viewPx) ? Math.max(0, viewPx) : 0;
  const max = Math.max(0, count - view);
  const offset = !Number.isFinite(offsetPx) ? max : Math.min(max, Math.max(0, offsetPx));
  return { countPx: count, viewPx: view, offsetPx: offset, maxPx: max };
}

/**
 * 第几个单位（行）落在视口顶部 —— `floor(offset / step)`。
 *
 * ⚠️ **行高固定时用这个**（备战屏三块都是固定行高）：它把"像素偏移"翻成
 * "第一行是第几行"，于是卡片网格可以只算**可见的那几行**（不必算全部再
 * 裁掉，也不必让命中的矩形跟着滚）。
 */
export function firstUnit(offsetPx: number, step: number): number {
  if (!Number.isFinite(offsetPx) || !Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, Math.floor(offsetPx / step));
}

/**
 * 一个"一格一行"的视口：**行数由调用方给**，本函数只把像素偏移翻成
 * "第一行是第几行"并钳进边界。
 *
 * ==================================================================
 * ⚠️ 为什么行数**不在**这里算（踩过一次的坑）
 * ==================================================================
 *
 * 第一版是 `rows = floor(视口高 / 行距)`。它对**刚好放得下行**的视口是
 * **错的**：2 行卡片是 `2 × 40 + 1 × 6 = 86`，而 `floor(86 / 46) = 1`
 * —— 于是"视口说放得下 2 行"而这里只报 1 行，画面上第二行**凭空消失**
 * （命中区也跟着只剩第一行）。
 *
 * 根因是**视口高里没有最后一行的行距**（`rows × 卡片高 + (rows − 1) ×
 * 行距`），而这个函数不知道卡片高是多少。所以现在：
 *
 * ```
 *   行数     ← 调用方（布局表）给：它知道"我打算放几行"（见 `visibleRows`）
 *   第一行   ← 本函数按 offsetPx / 行距 算，并钳进 [0, maxOffset]
 * ```
 *
 * ⚠️ 这不是把责任推出去：**"一屏放几行"本来就是布局的一部分**
 * （`prepareLayout.visibleRows` 是反推出来的常量），而"滚到哪"才是
 * 这份共享数学的职责。
 */
export interface SteppedViewport {
  /** 内容摊成几行。 */
  readonly count: number;
  /** 一屏放几行（**至少 1**）。 */
  readonly rows: number;
  /** 视口顶部那一行的下标（`count = 0` 时是 0）。 */
  readonly first: number;
}

export function steppedViewport(
  count: number,
  rows: number,
  offsetPx: number,
  rowStep: number,
): SteppedViewport {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const step = Number.isFinite(rowStep) && rowStep > 0 ? rowStep : 1;
  const view = safeRows(rows);
  const maxFirst = maxOffset(total, view);
  const first = Math.min(maxFirst, firstUnit(offsetPx, step));
  return { count: total, rows: view, first };
}
