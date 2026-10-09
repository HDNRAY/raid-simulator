import { describe, expect, it } from 'vitest';
import {
  LOGICAL_ASPECT,
  LOGICAL_H,
  LOGICAL_W,
  computeCanvasCssSize,
  computeScale,
} from '../../src/render/scaling';
import { FONT, LAYOUT, LOGICAL, skillSlotLabels, skillSlotRect } from '../../src/ui/layout';

describe('逻辑分辨率常量', () => {
  it('是 960x540 且为 16:9', () => {
    expect(LOGICAL_W).toBe(960);
    expect(LOGICAL_H).toBe(540);
    expect(LOGICAL_ASPECT).toBeCloseTo(16 / 9, 10);
  });
});

describe('computeScale', () => {
  it('fit 模式按 min(w/960, h/540) 等比缩放', () => {
    // 受限的是宽度：1280/960=1.333，720/540=1.333 -> 1.333...
    expect(computeScale(1280, 720, 'fit')).toBeCloseTo(4 / 3, 10);
    // 超宽屏：高度受限
    expect(computeScale(3840, 1080, 'fit')).toBeCloseTo(2, 10);
    // 竖屏：宽度受限
    expect(computeScale(540, 960, 'fit')).toBeCloseTo(0.5625, 10);
  });

  it('fit 模式在常见分辨率下倍率恰好是整数', () => {
    // 这是选 fit 作为默认模式的关键理由（architecture 规范 §10.2）
    expect(computeScale(1920, 1080, 'fit')).toBeCloseTo(2, 10);
    expect(computeScale(3840, 2160, 'fit')).toBeCloseTo(4, 10);
    expect(computeScale(960, 540, 'fit')).toBeCloseTo(1, 10);
  });

  it('integer 模式向下取整', () => {
    expect(computeScale(1920, 1080, 'integer')).toBe(2);
    // 2560/960 = 2.667 -> 2，而不是 2.667
    expect(computeScale(2560, 1440, 'integer')).toBe(2);
    // 3839/960 = 3.999 -> 3
    expect(computeScale(3839, 2160, 'integer')).toBe(3);
  });

  it('integer 模式至少为 1 倍（小窗口允许被裁切，但不缩到看不见）', () => {
    expect(computeScale(480, 270, 'integer')).toBe(1);
    expect(computeScale(100, 100, 'integer')).toBe(1);
    expect(computeScale(1, 1, 'integer')).toBe(1);
  });

  it('非正数 / NaN / Infinity 输入退回 1 倍，不产生 NaN 尺寸', () => {
    expect(computeScale(0, 0, 'fit')).toBe(1);
    expect(computeScale(-100, -100, 'fit')).toBe(1);
    expect(computeScale(Number.NaN, 540, 'fit')).toBe(1);
    expect(computeScale(960, Number.POSITIVE_INFINITY, 'fit')).toBe(1);
  });
});

describe('computeCanvasCssSize', () => {
  it('CSS 尺寸严格保持 16:9', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [2560, 1440],
      [1366, 768],
      [3440, 1440],
      [800, 600],
      [500, 900],
    ] as const) {
      const size = computeCanvasCssSize(w, h, 'fit');
      expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
      // 不能溢出视口（浮点取整留 1px 容差）
      expect(size.width).toBeLessThanOrEqual(w + 1);
      expect(size.height).toBeLessThanOrEqual(h + 1);
    }
  });

  it('尺寸是整数（避免 CSS 半像素导致边缘发虚）', () => {
    const size = computeCanvasCssSize(1366, 768, 'fit');
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});

describe('技能格内三个标签都不越界、互不重叠', () => {
  /**
   * 这条约束以前只存在于坐标算术里，没有测试保护 —— 结果连着踩了三次：
   *   1. 冷却数字放正中 → 与技能字完全重叠
   *   2. 按键提示移到格子外下方 → 落到 y=531，画布只有 540，被截断
   *   3. 冷却数字又放底部居中 → 与右下角的按键提示挤在一起
   *
   * 画布固定 960×540 不随窗口变化，所以"画到外面"在截图里看起来
   * 像"没画"，很难发现。用算术断言就一目了然。
   */
  it('6 个槽位：三个标签都在格子内', () => {
    const total = 6;
    for (let i = 0; i < total; i += 1) {
      const rect = skillSlotRect(i, total);
      const pos = skillSlotLabels(rect);
      for (const [name, p] of Object.entries(pos)) {
        expect(p.x, `${name} 的 x 越界（槽位 ${i}）`).toBeGreaterThanOrEqual(rect.x);
        expect(p.x, `${name} 的 x 越界（槽位 ${i}）`).toBeLessThanOrEqual(rect.x + rect.w);
        expect(p.y, `${name} 的 y 越界（槽位 ${i}）`).toBeGreaterThanOrEqual(rect.y);
        expect(p.y, `${name} 的 y 越界（槽位 ${i}）`).toBeLessThanOrEqual(rect.y + rect.h);
      }
    }
  });

  it('【关键】所有标签都在画布内 —— 不能贴到底边之外', () => {
    const total = 6;
    /** 标签的字号上限：技能字 26、其它 13。加它是为了估算文字高度。 */
    const heights: Record<string, number> = { glyph: 17, cooldown: 18, key: 13 };
    for (let i = 0; i < total; i += 1) {
      const rect = skillSlotRect(i, total);
      const pos = skillSlotLabels(rect);
      for (const [name, p] of Object.entries(pos)) {
        expect(p.y + (heights[name] ?? 0), `${name} 超出画布高度`).toBeLessThanOrEqual(
          LOGICAL.height,
        );
      }
    }
  });

  it('三个标签的**实际文字矩形**互不重叠', () => {
    /**
     * 用实测尺寸做矩形重叠检测，而不是靠"y 坐标谁大谁小"。
     *
     * 早先我写的是"数字的 y 必须 ≥ 技能字底部"，那条断言假设了两个
     * 标签**左右对齐**；但数字是居中的、技能字也在中间，两者本来就
     * 在垂直方向交叠 —— 真正避免重叠的是**水平错开**（数字居中、
     * 按键右对齐）与**垂直错开**（字在上、数字在中下）。
     * 只有矩形相交检测能同时覆盖这两种情况。
     *
     * 尺寸来自浏览器实测（探针读 `getBounds()`）：
     *   技能字 26x28、冷却数字 11x18、按键提示 7x13
     */
    /**
     * 尺寸来自浏览器实测（探针读 `getBounds()`）：
     *   技能字 15px 楷体 → 15x17
     *   冷却秒数 13px     → 9x18（含描边）
     *   按键提示 11px     → 7x13
     */
    const sizes = { glyph: { w: 15, h: 17 }, cooldown: { w: 11, h: 18 }, key: { w: 7, h: 13 } };
    const total = 6;
    for (let i = 0; i < total; i += 1) {
      const rect = skillSlotRect(i, total);
      const pos = skillSlotLabels(rect);
      // 把 anchor 折算成左上角
      const boxes = [
        { name: 'glyph', x: pos.glyph.x - sizes.glyph.w / 2, y: pos.glyph.y, ...sizes.glyph },
        {
          name: 'cooldown',
          x: pos.cooldown.x - sizes.cooldown.w / 2,
          y: pos.cooldown.y,
          ...sizes.cooldown,
        },
        // 按键提示现在是**左对齐**（左上角）
        { name: 'key', x: pos.key.x, y: pos.key.y, ...sizes.key },
      ];

      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const A = boxes[a]!;
          const B = boxes[b]!;
          const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
          const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
          // 允许 1px 的抗锯齿交叠
          const overlapping = ox > 1 && oy > 1;
          expect(overlapping, `${A.name} 与 ${B.name} 重叠（槽位 ${i}）`).toBe(false);
        }
      }
    }
  });

  it('槽位右对齐：最后一格的右边缘贴合安全边距', () => {
    const total = 6;
    const last = skillSlotRect(total - 1, total);
    expect(last.x + last.w).toBe(LOGICAL.width - 8);
  });
});

describe('玩家面板：读条在顶部、三根条不越界', () => {
  /**
   * 这组断言守的是**面板内部的空间分配** —— 玩家读条与三根状态条
   * 挤在同一个 228×140 的框里，靠坐标算术排布。这类错误在截图里
   * 很难看出来（"字没画"和"画到框外"长得一样）。
   */
  const pf = LAYOUT.player;
  const pcb = LAYOUT.playerCastBar;

  it('读条在面板上方、与面板同宽同左边界', () => {
    // 早期这条断言写的是"读条落在面板**内**" —— 而那正是导致
    // "面板盖住读条"的布局。现在它必须在面板**上方**（见下一条）。
    expect(pcb.x).toBe(pf.x);
    expect(pcb.w).toBe(pf.w);
    expect(pcb.y).toBeLessThan(pf.y);
  });

  it('读条比 Boss 预警条矮 —— 它不是威胁提示', () => {
    // Boss 预警条要抢注意力（红色 + 高）；自己的读条只需"知道在放什么"
    expect(pcb.h).toBeLessThan(LAYOUT.castBar.h);
  });

  it('【关键】读条不与玩家面板重叠 —— 面板是后绘制的，会盖住读条', () => {
    /**
     * 这是一次真实踩坑：读条原先和面板**重叠**，而面板在
     * `hud.addChild` 里排在读条之后，于是深色面板填充直接把读条盖住。
     * 表现为"读条一片暗"，用户报了两次，而我改了好几轮颜色都不见效 ——
     * 因为根本不是颜色问题。
     *
     * 绘制顺序是"后加的在上面"，所以这条几何约束必须成立。
     */
    expect(pcb.y + pcb.h).toBeLessThanOrEqual(pf.y);
  });

  it('三根状态条都在面板内、且纵向分布均匀', () => {
    const { h: barH, top, stride, bottom } = LAYOUT.playerBars;
    const firstTop = pf.y + top - pf.y; // 相对面板顶部
    const lastBottom = top + 2 * stride + barH;
    // 第一根条不能与面板顶部打架
    expect(firstTop).toBeGreaterThan(0);
    // 最后一根条不能超出面板
    expect(lastBottom).toBeLessThanOrEqual(pf.h);
    // 底部留白不能超过面板高度的 40% —— 否则就是"空了一大截"（用户报过）
    expect(pf.h - lastBottom).toBeLessThanOrEqual(pf.h * 0.4);
    // 顶部与底部留白应当接近（不然视觉重心偏移）
    expect(Math.abs(bottom - top)).toBeLessThanOrEqual(20);
    void bottom;
  });

  it('面板不越出画布底边', () => {
    // 玩家面板贴在左下角，最容易"长高之后掉出画布"
    expect(pf.y + pf.h).toBeLessThanOrEqual(LOGICAL.height);
    expect(pcb.y + pcb.h).toBeLessThanOrEqual(LOGICAL.height);
  });
});

describe('玩家面板：读条与资源条都是"实心填充进度条"', () => {
  it('面板高度压到很紧（需求：整体变矮）', () => {
    /**
     * 需求演进：140 → 122 → **90**。
     *
     * ⚠️ 我中间把"面板内部留黑"误读成"把条加高去填满面板"
     * （条高 16 → 30，面板反而更高）。正确做法是**减少留白**：
     *   8（上边距）+ 16×3 + 8×2 + 18（下边距）= 90
     */
    expect(LAYOUT.player.h).toBeLessThanOrEqual(96);
    // 条必须是"细条"，不能靠加粗去填面板
    expect(LAYOUT.playerBars.h).toBeLessThanOrEqual(18);
  });

  it('三根条铺满面板，底部留白不超过面板的 30%', () => {
    const { h: barH, top, stride } = LAYOUT.playerBars;
    const lastBottom = top + 2 * stride + barH;
    const slack = LAYOUT.player.h - lastBottom;
    expect(slack).toBeGreaterThan(0);
    expect(slack).toBeLessThanOrEqual(LAYOUT.player.h * 0.3);
  });

  it('布局表声明的 bottom 与实际留白一致（防止两处漂移）', () => {
    const { h: barH, top, stride, bottom } = LAYOUT.playerBars;
    expect(LAYOUT.player.h - (top + 2 * stride + barH)).toBe(bottom);
  });

  it('两处读条都够高：要放"技能名 + 剩余秒数"一行字', () => {
    /**
     * 进度改用**整块背景色**表达之后，读条里不再有独立的进度条，
     * 所以高度只需保证"一行 15px 的字 + 上下呼吸空间"。
     * 早期这里断言的是"要放得下 5px 的进度条"——那个形态已经不用了。
     */
    expect(LAYOUT.castBar.h).toBeGreaterThanOrEqual(FONT.body + 8);
    expect(LAYOUT.playerCastBar.h).toBeGreaterThanOrEqual(FONT.body + 6);
  });

  it('玩家读条不与面板重叠（面板后绘制会盖住它）', () => {
    const pcb = LAYOUT.playerCastBar;
    const pf = LAYOUT.player;
    expect(pcb.y + pcb.h).toBeLessThanOrEqual(pf.y);
  });
});
