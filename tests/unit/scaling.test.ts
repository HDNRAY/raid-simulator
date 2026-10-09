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
    /**
     * 各自的实际占位 + 锚点。
     *
     * 需求把信息分到了四角（左上按键 / 右上代价 / 左下冷却 / 正中图标），
     * 所以每个标签的**锚点都不同**，不能再套同一个公式估算 ——
     * 冷却现在是左下角（anchorY = 1），它的下边缘是 `pos.y` 本身。
     */
    const layout: Record<string, { h: number; ax: number; ay: number }> = {
      glyph: { h: 21, ax: 0.5, ay: 0.5 },
      cooldown: { h: 20, ax: 0, ay: 1 },
      key: { h: 13, ax: 0, ay: 0 },
      cost: { h: 13, ax: 1, ay: 0 },
    };
    for (let i = 0; i < total; i += 1) {
      const rect = skillSlotRect(i, total);
      const pos = skillSlotLabels(rect);
      for (const [name, p] of Object.entries(pos)) {
        const spec = layout[name];
        expect(spec, `未声明的标签 ${name}`).toBeDefined();
        const bottom = p.y + spec!.h * (1 - spec!.ay);
        expect(bottom, `${name} 超出画布高度`).toBeLessThanOrEqual(LOGICAL.height);
      }
    }
  });

  it('按键提示与技能字/数字**不**重叠（这两个必须让开）', () => {
    /**
     * 需求演进："数字应该盖在按键 icon 上" ——
     * 所以 **技能字与冷却数字是故意重叠的**（同心叠放），
     * 旧版这条断言"三者互不重叠"已经和需求冲突，删掉了。
     *
     * 仍然必须互不重叠的是**按键提示**：它是小字，被压住就读不出来。
     *
     * 尺寸按当前字号折算（格子从 52 收到 40 之后三者都缩了）：
     *   技能字 13px 楷体 → 13x15
     *   冷却秒数 18px     → 17x23（含描边）
     *   按键提示 11px     → 7x13
     */
    const sizes = { glyph: { w: 26, h: 21 }, cooldown: { w: 17, h: 20 }, key: { w: 7, h: 13 }, cost: { w: 15, h: 13 } };
    const total = 6;
    for (let i = 0; i < total; i += 1) {
      const rect = skillSlotRect(i, total);
      const pos = skillSlotLabels(rect);
      /** 把 anchor 折算成左上角 */
      const box = (c: { x: number; y: number }, s: { w: number; h: number }, ax = 0.5, ay = 0) => ({
        x: c.x - s.w * ax,
        y: c.y - s.h * ay,
        w: s.w,
        h: s.h,
      });
      const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

      const key = box(pos.key, sizes.key, 0, 0);
      const glyph = box(pos.glyph, sizes.glyph);
      const cd = box(pos.cooldown, sizes.cooldown);

      expect(overlap(key, glyph), `按键与技能字重叠（槽位 ${i}）`).toBe(false);
      expect(overlap(key, cd), `按键与冷却数字重叠（槽位 ${i}）`).toBe(false);
    }
  });


  it('格子尺寸与需求一致：40×40', () => {
    /**
     * 需求明确指定："技能按钮改成 40px*40px，所有元素相应调整，
     * 包括按钮间距。"
     *
     * 40 是**硬约束**（不是算出来的），所以这里直接钉死；
     * 格子里的元素（数字 18px、技能字 13px）是**为它让步**的。
     */
    const rect = skillSlotRect(0, 6);
    expect(rect.w).toBe(40);
    expect(rect.h).toBe(40);
    // 间距也从 6 收到 4
    expect(LAYOUT.skillBar.gap).toBe(4);
    // 冷却数字必须仍放得进格子（18px 字约 23px 高）
    expect(rect.h).toBeGreaterThanOrEqual(23 + 4);
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
    expect(LAYOUT.player.h).toBeLessThanOrEqual(84);
    // 条必须是"细条"，不能靠加粗去填面板
    expect(LAYOUT.playerBars.h).toBeLessThanOrEqual(18);
  });

  it('【关键】三根条在面板里**上下留白相等**', () => {
    /**
     * 需求反复提过："使上下 padding 一致"。
     *
     * 根因是"面板高度"和"条的位置"分散在两处算，
     * 谁都不会主动保证对称 —— 所以之前几轮改来改去都对不上。
     * 现在三个值都在 `LAYOUT.playerBars` 里，并且**由这条断言守住**：
     *
     *   h = top + barH×3 + gap×2 + bottom
     *   且 top === bottom
     */
    const { h: barH, top, stride, bottom } = LAYOUT.playerBars;
    const gap = stride - barH;
    expect(LAYOUT.player.h).toBe(top + barH * 3 + gap * 2 + bottom);
    expect(top).toBe(bottom);
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

describe('技能格：图标尺寸与冷却时的可读性', () => {
  it('技能字（图标）为 26px，且四周留出呼吸空间', () => {
    /**
     * 演进 13 → 32 → **26**。
     *
     * 需求先要求"至少 32"，之后下调到 26 —— 这是**信息密度**的取舍：
     * 四角都有东西（按键 / 代价 / 冷却），32px 几乎占满整格。
     *
     * ⚠️ 估算能否放下要用 `measureText` 的 `actualBoundingBox`
     * （楷体字形高约 0.79×字号），**不能看行高** —— 行高远大于字形，
     * 按行高算会误判为放不下。
     */
    expect(FONT.skillIcon).toBe(26);
    const glyphH = FONT.skillIcon * 0.79;
    // 上下各留至少 5px，四角的小字才有地方站
    expect(LAYOUT.skillBar.slot - glyphH).toBeGreaterThanOrEqual(10);
    // 横向也要留（楷体是等宽方块字）
    expect(LAYOUT.skillBar.slot - FONT.skillIcon).toBeGreaterThanOrEqual(8);
  });

  it('图标比冷却数字**大**，冷却时"数字盖住图标"才成立', () => {
    expect(FONT.skillIcon).toBeGreaterThan(FONT.cd);
  });

});

describe('角落快捷键提示（Esc）的可读性', () => {
  it('描边 3px 且文字用亮色 —— 深色字压在浅色图标上会糊', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/IconButton.ts', import.meta.url), 'utf8');
    /**
     * 需求："esc 的描边没有让它看起来足够清晰"。
     *
     * 根因不是描边不够粗，而是**文字本身太暗**：Esc 压在浅色齿轮上，
     * 深灰字与齿轮笔画糊在一起。所以两件事都要保证。
     */
    expect(src).toMatch(/cornerStroke: 3,/);
    expect(src).toMatch(/color: corner \? PALETTE\.text : PALETTE\.textDim/);
  });
});

describe('技能格四角布局', () => {
  /**
   * 需求："左上保持快捷键，左下显示 cd 数字，单位秒，单位不显示，
   * 右上显示资源代价，炁 / 缠 / 甚至血，用相应的颜色代表那种资源。"
   *
   * 40px 的格子塞四类信息，所以每个角的位置与锚点都必须钉死 ——
   * 一旦谁越界，就会和相邻的角叠在一起。
   */
  const rect = () => skillSlotRect(2, 6);

  it('按键在左上角，代价在右上角（同一行）', () => {
    const r = rect();
    const pos = skillSlotLabels(r);
    expect(pos.key.y).toBe(pos.cost.y);
    expect(pos.key.x).toBeLessThan(r.x + r.w / 2);
    expect(pos.cost.x).toBeGreaterThan(r.x + r.w / 2);
    // 代价是右对齐的（渲染层用 anchorX = 1）
    expect(pos.cost.x).toBeGreaterThan(pos.key.x);
  });

  it('冷却数字在左下角', () => {
    const r = rect();
    const pos = skillSlotLabels(r);
    expect(pos.cooldown.x).toBeLessThan(r.x + r.w / 2);
    expect(pos.cooldown.y).toBeGreaterThan(r.y + r.h / 2);
    // 左下角且是"底对齐"，所以它离格子底边很近
    expect(r.y + r.h - pos.cooldown.y).toBeLessThanOrEqual(4);
  });

  it('图标在正中', () => {
    const r = rect();
    const pos = skillSlotLabels(r);
    expect(pos.glyph.x).toBeCloseTo(r.x + r.w / 2, 5);
    expect(pos.glyph.y).toBeCloseTo(r.y + r.h / 2, 5);
  });

  it('代价只给数字，不给单位 —— 40px 的角落放不下"30炁"', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/render/BattleScene.ts', import.meta.url), 'utf8');
    // 代价那行必须是 String(Math.round(...))，不能拼上资源名或单位
    expect(src).toMatch(/s\.cost\.set\(String\(Math\.round\(view\.cost\.value\)\)\)/);
  });

  it('冷却秒数不带单位 —— "4" 而不是 "4s"', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/render/BattleScene.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/s\.cd\.set\(view\.cooldownRatio > 0\.001 \? Math\.ceil\(view\.cooldownSec\)\.toString\(\) : ''\)/);
  });
});
