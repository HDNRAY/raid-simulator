/**
 * ==================================================================
 * `scrollBarGeometry`：**偏移 → 滑块的位置与长度**（2026-10-13 第六轮）
 * ==================================================================
 *
 * ⚠️ 这一份**从 `prepareDetailViewport.test.ts` 整段搬来**（AGENTS.md §2
 * 去重）：那条数学从详情区搬进了 `scrollWindow`，测试跟着它搬 ——
 * **一条断言都没删**（搬走的是位置，不是判据）。
 *
 * ==================================================================
 * 它为什么是"滚动条几何"的唯一一份
 * ==================================================================
 *
 * 用户原话："**滚动内容 滚动条没动**"。
 *
 * 根因不是"没重画"（`prepareDetailPanel.update` 每帧都调
 * `drawScrollBar`），而是那条**数学本身写错了**：旧版把
 * `scrollThumbRatio(count, rows)` 的两个参数写反（传的是
 * `(视口, 内容)`），于是它恒返回 `1` —— 滑块长度 = 整条轨道，
 * `(轨道 − 滑块)` 恒为 0，**滑块永远贴在顶端不动**。
 *
 * 修好之后场上却成了**两份**实现（详情区 `detailScrollThumb`、卡片区
 * `sectionScrollbar`），而且**参数顺序不同** —— 下一个人抄错一次就复发。
 * 所以现在两处都走这里，入参是**具名结构**（那串同型 number 没法静默传反）。
 *
 * 这一份钉的是**几何**（不是"有没有画"）：
 *
 * ```
 *   长度 = 视口 / 内容 的比例 × 轨道长   （不是固定长度、不是整条轨道）
 *   位置 = 进度 × (轨道长 − 长度)         ⇒ 滚到底时下缘贴轨道末端
 * ```
 *
 * ⚠️ 这些断言用不着 Pixi：被测量的是**纯函数**，所以能在 node 里跑到
 * 精确的整数（AGENTS.md §4：几何要算出来、逻辑要有单测）。
 */
import { describe, expect, it } from 'vitest';
import { scrollBarGeometry } from '../../src/ui/scrollWindow';

/** 一个"能滚"的视口：视口 300、还能滚 900 ⇒ 内容 1200（4 倍）。 */
const TRACK = 300;

/**
 * 把"轨道长 300 的详情区"那组入参写成具名结构。
 *
 * ⚠️ 这就是这一轮的形状：`viewportPx` / `maxScrollPx` 各写各的名字，
 * 写反了**读起来就不对**（编译器不再被两个同型 number 骗过去）。
 */
const thumb = (
  viewportPx: number,
  maxScrollPx: number,
  scrollPx: number,
  trackLenPx: number = TRACK,
  minLengthPx?: number,
): ReturnType<typeof scrollBarGeometry> =>
  scrollBarGeometry({
    viewportPx,
    maxScrollPx,
    scrollPx,
    trackLenPx,
    /** ⚠️ 只在给了下限时才带上这个字段（`exactOptionalPropertyTypes`）。 */
    ...(minLengthPx === undefined ? {} : { minLengthPx }),
  });

describe('scrollBarGeometry：长度 = 视口/内容 的比例', () => {
  it('内容 4 倍视口 ⇒ 滑块 = 轨道长的 1/4', () => {
    expect(thumb(300, 900, 0).length).toBe(75);
  });

  it('⚠️【回归】旧 bug 的形状：滑块**不**等于整条轨道', () => {
    /**
     * 参数写反时 `scrollThumbRatio(视口, 内容)` 恒为 1 ⇒ 长度 = 300。
     * 这一条是那个 bug 的墓碑：以后再把它写反会在这里红。
     */
    const { length } = thumb(300, 900, 0);
    expect(length).toBeLessThan(TRACK);
    expect(length).toBe(Math.round((300 / 1200) * TRACK));
  });

  it('内容越多 ⇒ 滑块越短（长度真的在跟着内容走）', () => {
    const a = thumb(300, 900, 0).length;
    const b = thumb(300, 2700, 0).length;
    expect(b).toBeLessThan(a);
  });

  it('内容不足一屏 ⇒ 滑块占满轨道（那一条也不画，见 `drawScrollBar`）', () => {
    expect(thumb(300, 0, 0)).toEqual({ length: TRACK, offset: 0 });
  });
});

describe('scrollBarGeometry：位置跟着偏移走', () => {
  it('滚到顶 ⇒ 滑块贴轨道**顶端**', () => {
    expect(thumb(300, 900, 0).offset).toBe(0);
  });

  it('滚到底 ⇒ 滑块**下缘贴轨道末端**（offset + length = 轨道长）', () => {
    const t = thumb(300, 900, 900);
    expect(t.offset).toBe(TRACK - t.length);
    expect(t.offset + t.length).toBe(TRACK);
  });

  it('中途 ⇒ 位置按进度线性插值（走一半 = 行程的一半）', () => {
    const t = thumb(300, 900, 450);
    expect(t.offset).toBe(Math.round((TRACK - t.length) * 0.5));
  });

  it('⚠️ 同一个偏移算两次是同一个结果（每帧从当前偏移算，不是缓存）', () => {
    expect(thumb(300, 900, 123)).toEqual(thumb(300, 900, 123));
    /** 顶 / 中 / 底三个位置**互不相同** —— 那正是"滑块在动"。 */
    const tops = [0, 450, 900].map((s) => thumb(300, 900, s).offset);
    expect(new Set(tops).size).toBe(3);
  });
});

describe('scrollBarGeometry：边界', () => {
  it('滑块有最小长度（太短抓不住），但不越过轨道', () => {
    /** 内容 100 倍视口 ⇒ 比例 1/100 ⇒ 3px，被抬到 24。 */
    expect(thumb(300, 29700, 0).length).toBe(24);
    /** 轨道比最小长度还短 ⇒ 滑块 = 轨道，且 offset 不为负。 */
    const tiny = thumb(300, 29700, 29700, 10);
    expect(tiny.length).toBe(10);
    expect(tiny.offset).toBe(0);
  });

  it('最小长度可覆盖（卡片区 / 设置页各用各的下限）', () => {
    /** 上限是轨道：下限比轨道大时滑块就是轨道。 */
    expect(thumb(300, 29700, 0, TRACK, 40).length).toBe(40);
    expect(thumb(300, 29700, 0, 10, 40).length).toBe(10);
  });

  it('偏移越界被钳住（拖拽累加会产生越界值）', () => {
    const bottom = thumb(300, 900, 900);
    expect(thumb(300, 900, 1e9)).toEqual(bottom);
    expect(thumb(300, 900, -1e9).offset).toBe(0);
  });

  it('非有限值不产生 NaN（NaN 的 roundRect 会静默画不出来）', () => {
    const t = thumb(300, 900, Number.NaN);
    expect(Number.isFinite(t.offset)).toBe(true);
    expect(Number.isFinite(t.length)).toBe(true);
    /** 与 `pixelViewport` 同一条口径：非有限值的偏移当"滚到底"。 */
    expect(t.offset).toBe(TRACK - t.length);
  });

  it('轨道为 0（视口还没量出来）时是 0/0，不炸', () => {
    expect(thumb(0, 0, 0, 0)).toEqual({ length: 0, offset: 0 });
  });
});
