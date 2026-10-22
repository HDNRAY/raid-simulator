/**
 * **详情区正文的滚动视口**：滚到哪、还能滚多少、哪一行**整行**落在视口里、
 * 右侧那条滚动条画在哪。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"正文那一块现在看得见哪一段"的**唯一**出处：输入（滚轮 / 拖拽给的
 * 像素位移）进来，它答复"画出来的偏移是多少、这一行该不该画、滚动条在哪"。
 *
 * ==================================================================
 * 为什么从 `prepareDetailPanel.ts` 切出来（AGENTS.md §3）
 * ==================================================================
 *
 * 2026-10-13 第四轮修"正文画到面板外"时那个文件到了 **778 行**
 * （超上限）。按 §3 先看它混了几件事：
 *
 * | 那一半 | 一句话 |
 * |---|---|
 * | `prepareDetailPanel` | 面板的**画**：底板 / 顶栏 / 正文的文字与摆位 |
 * | 本文件 | 正文的**滚动几何**：偏移 / 视口 / 裁剪 / 滚动条 |
 *
 * 两者输入输出不重叠（这边不认识 `Label`、不认识 i18n），而"滚动到哪"
 * 本来就是 `scrollWindow` 那一族数学的**像素**分支 —— 搬过来之后它可以
 * 单独演进、单独解释边界（滚到尽头 / 内容不足一屏）。
 *
 * ⚠️ 注释与代码一起搬（§3：不留"见 xxx"的摘要）。
 *
 * ==================================================================
 * ⚠️⚠️ 裁剪：2026-10-22 起是**按像素**的（遮罩），不再是"整行"
 * ==================================================================
 *
 * 下面那段"整行可见"的来历**保留**（它修的是一个真 bug：内容画到面板外），
 * 但用户 2026-10-22 明确否掉了那种观感："一段话要么完全显示、要么完全
 * 不显示" 这不是我要的…**我要的是类似 html 那种滚动效果**。
 *
 * 现在的分工：
 *
 * ```
 *   遮罩（`ui/viewportMask`）  → 真正把正文按像素裁在视口里 ✓（本文件不再判"整行"）
 *   `drawnViewTop`            → 不再吸附行顶，直接用像素偏移（吸附 = 一格一格跳）
 *   `shows`                   → 改为"这一行**露出来了吗**"（完全在外才 false）
 * ```
 *
 * ⚠️ 因此**"滚到底最后一行完整"仍然成立**：`maxScroll` 是
 * `内容底边 − 视口底边`，滚到底时内容底边正好贴视口底 ✓（那条是既有测试
 * 在盯的，不受裁切方式影响）。
 *
 * ==================================================================
 * 历史（2026-10-13）：一行**整行**落在视口里才画
 * ==================================================================
 *
 * 用户原话："**boss 详情的内容 出了区域 还是能显示···· 虽然可以滚动**"。
 *
 * 实测：聚焦「傲慢」、滚到顶时最后一招「碾压」被画到 y ≈ 490~520，而
 * 面板底边是 459 —— 那几行压在下面的素材声明上。
 *
 * 根因是**旧版的裁剪从来没生效过**（单位对不上）：
 * `visibleWindow(placed, this.scroll, viewRows)` 的第二个参数是**条目
 * 下标**，而传进去的 `this.scroll` 是**像素** —— `clampOffset(像素, 5 行,
 * 13 行)` 恒等于 0，于是**永远返回全部行**，"看得见哪一段"只剩那个 `dy`
 * 平移，下面自然伸出去。
 *
 * 现在判据是每一行**自己的内容区间**：
 *
 * ```
 *   视口（内容坐标）= [viewTop, viewTop + viewH)
 *   一行            = [nameTop, endTop)
 *   画              ⟺ nameTop ≥ viewTop 且 endTop ≤ 视口底边
 * ```
 *
 * ⚠️ **为什么必须"整行"**：Pixi 的一段 `Text` 不能裁一半 —— "相交就画"
 * 必然让跨在下缘的那一行露半截，露多少取决于它折了几行（Boss 的说明
 * 2~3 行 ⇒ 最多 ~50px）。而**遮罩不能用**：本仓库实测 Pixi 的 `mask` 在
 * headless 里不生效（见 `ui/settings/wrapText.ts`）。
 *
 * ⚠️ 为了"整行"这条判据不产生**奇怪的空白**，画出来的偏移**吸附到行顶**
 * （`drawnViewTop`）：拖拽 / 滚轮仍然按像素累加，落笔却停在某一行的顶边
 * —— 否则跨在上缘的那一行会半截压在**钉住的顶栏**上。
 *
 * ⚠️ **滚到底那一档是例外**（直接用 `maxScroll`）：吸附到上面的行顶会让
 * 最后一行**永远**差一点放不下（"滚到底也看不到最后一招"）。
 */

import type { Graphics } from 'pixi.js';
import { PREPARE_LAYOUT } from './prepareLayout';
import { pixelViewport } from './scrollWindow';
import { paintScrollBar } from './scrollBarPaint';

/** 一行在**内容坐标**里的区间（`endTop` 不含 `rowGap`）。 */
export interface DetailRowExtent {
  /** 名字那一行的顶边（也是这一行的顶边）。 */
  readonly nameTop: number;
  /** 这一行的底边。 */
  readonly endTop: number;
}

/**
 * 一行文字的**实测**高度（纹理还没量出来时退回估算）。
 *
 * ⚠️ 为什么实测：内容底边决定 `maxScroll` 与"整行放得下吗"，而估算每行
 * 最多偏几十像素 —— 偏大时最后一行在滚到底时仍被判"放不下"，偏小时那一行
 * 会露到面板外（用户报的正是后者）。
 *
 * ⚠️ 仍然留估算兜底：`Label.root.height` 在 jsdom / 纹理未就绪时可能是 0，
 * 而"0 行高"会让所有行叠在一起（比多留一行空难查得多）。
 */
export function measuredHeight(measured: number, fallback: number): number {
  return Number.isFinite(measured) && measured > 0 ? measured : fallback;
}

/**
 * ⚠️ **`snapToRowTop` 已删**（2026-10-22）：它服务的是"整行可见"时代的
 * 补丁（落笔停在行顶，免得半行压在钉住的顶栏上）。有了遮罩之后那条不再
 * 需要，而吸附会让滚动一格一格跳 —— 与"HTML 式滚动"相反 ✗。
 * 历史与判据记在文件头"裁剪"那一节。
 */


/**
 * ⚠️ **滑块几何搬去了 `scrollWindow.scrollBarGeometry`**（2026-10-13 第六轮：
 * AGENTS.md §2 去重）。
 *
 * 原先这里有一份 `detailScrollThumb(viewportPx, maxScrollPx, scrollPx,
 * trackLenPx, minLengthPx)` —— 它是**对的**（就是把
 * `scrollThumbRatio` 的两个参数写反那次修出来的），但备战屏卡片区的
 * `sectionScrollbar` 另有一份**也是对的**实现，而两份的**参数顺序不同**
 * （一份 `(内容, 视口)`、一份 `(视口, 内容, 偏移, 轨道)`）：
 * 两份正确实现下一个人抄错一次，就又回到"滑块 = 整条轨道、永远贴顶端"。
 *
 * 现在全仓库只有 `scrollBarGeometry({ viewportPx, maxScrollPx, scrollPx,
 * trackLenPx, minLengthPx })` 一处，而且入参是**具名结构** —— 那串同型
 * number 没法再"静默传反"（写反的病史与两条性质都记在那个函数头上）。
 */

export class DetailViewport {
  /** 顶栏下缘（正文视口的顶边，**面板坐标**）—— 每帧由 `measure` 写。 */
  private bodyTopPx = 0;
  /** 正文视口的高。 */
  private viewHPx = 0;
  /** 当前滚动位置（像素；0 = 顶部）。 */
  private scrollPx = 0;
  /** 可滚动的最大值（内容底边 − 视口底边；0 = 不用滚）。 */
  private maxScrollPx = 0;

  /** 换了聚焦项时把滚动归零（停在上一项的第三行上会让新那一项从中间开始）。 */
  reset(): void {
    this.scrollPx = 0;
  }

  /** 正文视口的顶边（**面板坐标**）：顶栏下缘。 */
  get bodyTop(): number {
    return this.bodyTopPx;
  }

  /** 真能滚吗（0 = 内容不足一屏）。 */
  get scrollable(): boolean {
    return this.maxScrollPx > 0;
  }

  /**
   * 滚轮 / 拖拽滚 **delta 像素**（触屏没有滚轮，拖拽那条路见
   * `PrepareScreen.dragDetail`）。
   *
   * ⚠️ 钳位走 `pixelViewport`（**像素**那一套）。曾经写成
   * `clampOffset(this.scroll + delta, this.maxScroll, 1)` —— 而
   * `clampOffset` 是**行**那一套（第三个数是"一屏几行"），拿它钳像素会让
   * 上界差 1（滚到底时最后一行差一点点才露全）。
   *
   * @returns 有没有真的动（调用方据此决定要不要重画）。
   */
  scrollBy(delta: number): boolean {
    if (this.maxScrollPx <= 0) return false;
    const next = pixelViewport(
      this.viewHPx + this.maxScrollPx,
      this.viewHPx,
      this.scrollPx + delta,
    ).offsetPx;
    if (next === this.scrollPx) return false;
    this.scrollPx = next;
    return true;
  }

  /**
   * 这个逻辑点是不是落在**正文视口**里（拖拽要在里面才算"滚详情"）。
   *
   * ⚠️ 上界是 `bodyTop`（**顶栏下缘**）而不是面板顶边：顶栏是钉住的，
   * 在它上面拖动不该滚正文 —— 那会让玩家"想点标题却把内容滚走了"。
   */
  isOnDetail(
    rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
    px: number,
    py: number,
  ): boolean {
    const top = this.bodyTopPx === 0 ? rect.y + PREPARE_LAYOUT.detailPad : this.bodyTopPx;
    return (
      this.maxScrollPx > 0 &&
      px >= rect.x &&
      px <= rect.x + rect.w &&
      py >= top &&
      py <= rect.y + rect.h
    );
  }

  /**
   * 正文比视口高时，按 `scroll` 决定**看得见哪一段**（而不是"末尾优先"）。
   *
   * ==================================================================
   * ⚠️ 为什么从"末尾优先"改成"可滚"（实测逼出来的）
   * ==================================================================
   *
   * 第一版是"溢出就把整层顶到末尾"（`QijiSelectScreen` 的做法）：内容底边
   * 对齐视口底边。可是**详情区的头两行（标题 / 生命上限）会被顶出面板**
   * ——实测「色欲」那四条招式说明一进来，**「生命上限 420」就看不见了**，
   * 而那一行是"这个 Boss 多硬"的唯一线索。
   *
   * ==================================================================
   * ⚠️⚠️ 2026-10-13 第三轮：顶栏**钉住**，只让正文滚
   * ==================================================================
   *
   * 上一版把标题 / 副标题塞进那个"整体上移"的内容层里 —— 于是**滚到底**
   * 时"生命上限 420"仍然会被滚出面板（那正是用户报的"详情区顶栏随内容
   * 滚动会滚出面板"）。现在：
   *
   * ```
   *   顶栏（标题 + 关键数值 + 头像）→ 钉在面板顶部，不参与滚动
   *   正文（招式 / 说明 / 键值行）  → 在 [bodyTop, 面板底 − 内边距] 里滚
   * ```
   *
   * ⚠️ 视口顶边是**顶栏下缘**（`bodyTop`）而不是面板顶边：正文滚到顶栏
   * 底下就停住，不会与标题叠在一起。
   *
   * ⚠️ **先摆行、后调本函数**的顺序不能反（`prepareDetailPanel.update`
   * 里有说明）：它要的是**这一帧算出来的**内容底边，而"看得见哪一段"
   * 依赖它 —— 用上一帧的数会让最后一行差一帧才露出来。
   */
  measure(
    rect: { readonly y: number; readonly h: number },
    bodyTop: number,
    contentBottom: number,
  ): void {
    this.bodyTopPx = bodyTop;
    this.viewHPx = Math.max(0, rect.y + rect.h - PREPARE_LAYOUT.detailPad - bodyTop);
    this.maxScrollPx = pixelViewport(contentBottom - bodyTop, this.viewHPx, 0).maxPx;
    this.scrollPx = pixelViewport(contentBottom - bodyTop, this.viewHPx, this.scrollPx).offsetPx;
  }

  /**
   * 这一帧**画出来的视口顶边**（内容坐标）。
   *
   * ⚠️ 非"滚到底"时吸附到行顶（见文件头）；滚到底时直接用 `maxScroll`
   * —— 那是唯一能让最后一行整行露出来的位置。
   */
  drawnViewTop(rows: readonly DetailRowExtent[], bodyTop: number): number {
    /**
     * ⚠️ 2026-10-22：**不再吸附行顶**（参数保留是为了不动调用点与测试的
     * 形状；语义上"画出来的顶边 = 正文顶 + 像素偏移"）。
     *
     * 吸附是"整行可见"时代的补丁：那时半行会压在钉住的顶栏上，所以落笔
     * 要停在行顶。现在有遮罩，跨边界的行被**按像素切掉**，吸附只会让
     * 滚动一格一格跳 —— 那正是用户要避免的观感 ✗。
     */
    void rows;
    return bodyTop + this.scrollPx;
  }

  /** 这一行**整行**落在视口里吗（配合 `drawnViewTop` 用）。 */
  shows(row: DetailRowExtent, viewTop: number): boolean {
    /**
     * **这一行有没有露出来一点**（2026-10-22 语义变更：从"整行可见"
     * 改成"与视口相交"）—— 越界的那部分由遮罩切掉，所以"露一点就画"。
     *
     * ⚠️ 半个像素的宽容：`maxScroll + viewH` 与内容底边在浮点上可能差一个
     * ulp，"恰好贴边"的那一行不该因为 1e-13 整行消失。
     */
    const bottom = viewTop + this.viewHPx;
    return row.nameTop < bottom + 0.5 && row.endTop > viewTop - 0.5;
  }

  /** 画出来的**像素偏移**（正文层整体上移多少）—— 与 `drawnViewTop` 同源。 */
  scrollOffset(): number {
    return this.scrollPx;
  }

  /** 画出来的**滚动量**（= 视口顶边 − 面板顶栏下缘）：行 y 减它。 */
  offsetOf(viewTop: number, bodyTop: number): number {
    return viewTop - bodyTop;
  }

  /**
   * 右侧那条滚动条（只有真能滚时才画；轨道只在**正文视口**那一段）。
   *
   * ⚠️ 滑块的**长度与位置每帧从当前偏移算**（`scrollBarGeometry`）——
   * 它不是"内容变化时算一次"的缓存值。这一点是用户报的"滚动内容
   * 滚动条没动"的落点：那条数学的参数曾经写反，滑块成了整条轨道；
   * 现在它与卡片区共用 `scrollWindow` 里那**唯一**一份（入参具名）。
   */
  drawScrollBar(
    gfx: Graphics,
    rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  ): void {
    gfx.clear();
    if (this.maxScrollPx <= 0) return;
    /**
     * ⚠️ 2026-10-22：**画**也收进 `ui/scrollBarPaint.paintScrollBar`（与图鉴
     * 同一份）。这里只剩"轨道画在哪"这一条几何 ——
     * 两份"画"不会算错，却会**长得不一样**（粗细 / 颜色 / 圆角各写一遍），
     * 而那正是用户问"图鉴的滚动条与详情区是不是同一个组件"的原因。
     */
    paintScrollBar({
      gfx,
      track: {
        x: rect.x + rect.w - 5,
        top: this.bodyTopPx,
        len: Math.max(0, rect.y + rect.h - PREPARE_LAYOUT.detailPad - this.bodyTopPx),
      },
      viewportPx: this.viewHPx,
      maxScrollPx: this.maxScrollPx,
      scrollPx: this.scrollPx,
    });
  }
}
