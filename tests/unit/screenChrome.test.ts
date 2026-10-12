import { describe, expect, it } from 'vitest';
import { battleGearBoxAt, chromeBlockBoxAt, chromeBoxAt } from '../../src/ui/ScreenChrome';
import { HINT_GAP, iconHintBoxSize, iconHintPlacement, iconWithHintSize } from '../../src/ui/iconHint';
import { LAYOUT, LOGICAL, scaleUiRect } from '../../src/ui/layout';

/**
 * ==================================================================
 * 边角控件的**落位**：贴边 + 随 UI 缩放 —— 一条规则，四条边共用
 * ==================================================================
 *
 * 用户 2026-10-12 三条原话（其实是同一件事）：
 *
 *   1. "**stage 上理论上不挂任何小组件**"
 *   2. "**多个页面的齿轮，应该分别定义**"
 *   3. "**UI 缩放要带上**"
 *
 * 前两条是"组件归它所在的界面所有"（结构，见 `ScreenChrome` 文件头）；
 * 这一份钉的是第三条：**齿轮与返回箭头都要按同一个系数重排**。
 *
 * ⚠️ 为什么这些算术值得单独钉：它们错了的表现是"缩放之后按钮跑出画布"
 * 或者"某一屏的齿轮比别人小一圈"—— 截图上看不出来（每张图单独看都"合理"），
 * 只有把不同系数、不同边角放**一起比**才看得出来。
 *
 * ⚠️ 只测纯函数（不构造 Pixi）：与 `iconButton.test.ts` 同一条纪律
 * （Pixi v8 在 jsdom 里不好跑，而"算得对不对"恰恰是最该钉的部分）。
 */

/** 齿轮（右上）与返回箭头（左上）的基准尺寸 —— 与 `ScreenChrome` 内部常量一致。 */
const GEAR = 20;
const ARROW = 22;
const MARGIN = 8;
/** 齿轮的键位提示文案（与 `ScreenChrome` 的 `f1Label()` 同形：`F1`）。 */
const GEAR_HINT = 'F1';

const gearAt = (scale: number) => chromeBoxAt({ right: true, bottom: false }, GEAR, scale);
const backAt = (scale: number) => chromeBoxAt({ right: false, bottom: false }, ARROW, scale);

/** 齿轮**整块**（图标 + 并排提示）的包围盒 —— 与 `battleGearBoxAt` 同一套几何。 */
function gearBlockAt(scale: number) {
  const box = battleGearBoxAt(scale);
  const hint = iconHintBoxSize(GEAR_HINT, box.size);
  /**
   * ⚠️ 战斗齿轮的提示在**右侧**（齿轮贴画布左缘，右边有的是地方）——
   * 与整屏界面右上角那个齿轮**镜像**（那边配 `'left'`）。
   */
  const placed = iconHintPlacement({
    icon: { x: box.x, y: box.y, w: box.size, h: box.size },
    hintW: hint.w,
    hintH: hint.h,
    side: 'right',
    canvasW: LOGICAL.width,
    canvasH: LOGICAL.height,
  });
  return {
    x: Math.min(box.x, placed.x),
    y: Math.min(box.y, placed.y),
    right: Math.max(box.x + box.size, placed.x + hint.w),
    bottom: Math.max(box.y + box.size, placed.y + hint.h),
    box,
    block: iconWithHintSize(GEAR_HINT, box.size),
  };
}

/** 缩放后的日志面板矩形（与 `UiLayout.logPanel` 同一条锚点：`top-left`）。 */
function logRectAt(scale: number) {
  return scaleUiRect(LAYOUT.log, 'top-left', scale);
}

function overlaps(
  a: { readonly x: number; readonly y: number; readonly right: number; readonly bottom: number },
  b: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.right && a.y < b.y + b.h && b.y < a.bottom;
}


describe('边角落位：贴边（安全区 8px）', () => {
  it('返回箭头贴左上角', () => {
    expect(backAt(1)).toEqual({ x: 8, y: 8, size: 22 });
  });

  it('齿轮贴右上角（右缘 = 画布宽 − 8）', () => {
    const b = gearAt(1);
    expect(b).toEqual({ x: LOGICAL.width - 8 - 20, y: 8, size: 20 });
    /** ⚠️ 右缘精确贴安全区（这就是"贴边"的判据）。 */
    expect(b.x + b.size).toBe(LOGICAL.width - MARGIN);
  });

  it('两条边角是**镜像**的：距自己那侧的边距相同', () => {
    const g = gearAt(1);
    const bk = backAt(1);
    expect(bk.x).toBe(MARGIN);
    expect(LOGICAL.width - (g.x + g.size)).toBe(MARGIN);
  });
});

describe('边角落位：随 UI 缩放', () => {
  it('边长按系数放大（这是"缩放要带上"最直接的判据）', () => {
    expect(gearAt(1.5).size).toBe(30);
    expect(backAt(0.5).size).toBe(11);
  });

  it('⚠️ 放大了仍然**贴着安全区**（贴边的要从自己那条边长出来）', () => {
    /**
     * 这条是"直接乘系数"那个错法的回归测试：如果 `x` 也乘 1.5，齿轮
     * （原本右缘 952）会跑到 `1386` —— 整块飞出画布。正确的读法是
     * "边距与尺寸都乘系数，位置由右缘反推"。
     */
    for (const scale of [0.5, 0.75, 1, 1.5, 2]) {
      const g = gearAt(scale);
      const bk = backAt(scale);
      const tag = `scale=${scale}`;
      expect(bk.x, tag).toBe(Math.round(MARGIN * scale));
      expect(LOGICAL.width - (g.x + g.size), tag).toBe(Math.round(MARGIN * scale));
      /** 上缘同理：两条边角的 `y` 都是"上方 8×scale"。 */
      expect(g.y, tag).toBe(Math.round(MARGIN * scale));
      expect(bk.y, tag).toBe(Math.round(MARGIN * scale));
    }
  });

  it('【关键】没有"看在哪一半"的分支：同系数下两角走同一套算术', () => {
    /**
     * ⚠️ 用户 2026-10-12 否掉了"按按钮在画布哪一半翻角"的旧设计
     * （"不用看在哪一半，全局统一风格"）。这条断言就是那条否决的回归：
     * 边距与尺寸只由 `scale` 决定，与 `right` / `bottom` **无关**。
     */
    for (const scale of [0.5, 1, 1.5]) {
      const g = gearAt(scale);
      const bk = backAt(scale);
      expect(LOGICAL.width - (g.x + g.size), `scale=${scale}`).toBe(bk.x);
      expect(g.y, `scale=${scale}`).toBe(bk.y);
    }
  });

  it('整块不出画布（两个边角、缩放范围内都不越界）', () => {
    for (const scale of [0.5, 1, 1.5, 2]) {
      for (const b of [gearAt(scale), backAt(scale)]) {
        const tag = `scale=${scale} box=${JSON.stringify(b)}`;
        expect(b.x, tag).toBeGreaterThanOrEqual(0);
        expect(b.y, tag).toBeGreaterThanOrEqual(0);
        expect(b.x + b.size, tag).toBeLessThanOrEqual(LOGICAL.width);
        expect(b.y + b.size, tag).toBeLessThanOrEqual(LOGICAL.height);
      }
    }
  });
});

describe('战斗界面的齿轮：画布**左下角安全区**（不是四条边角之一）', () => {
  /**
   * ================================================================
   * ⚠️ 这一组是用户报告的那个 bug 的回归（"放大时齿轮溢出画布"）
   * ================================================================
   *
   * 旧规则是"日志下方"：`y = (LAYOUT.log.y + LAYOUT.log.h) × scale + 8×scale`
   * —— 而日志矩形**自己也乘系数**，于是 scale=2.0 时 `y = 556`，齿轮
   * 整块掉出画布（`540`）。
   *
   * 现在的规则是**从画布边缘反推**（贴边控件的老规矩）：
   * 图标左下角 = `(8×scale, 画布高 − 8×scale)`。下面用**五个系数**
   * （含 1.4 / 1.5 这两个用户点名的档）把结论钉死。
   */
  it('贴左下角：左缘从安全区起、下缘从画布底反推', () => {
    const b = battleGearBoxAt(1);
    expect(b.x).toBe(MARGIN);
    expect(b.y).toBe(LOGICAL.height - MARGIN - GEAR);
    expect(b.size).toBe(GEAR);
  });

  it('随系数缩放：边距与尺寸都乘系数（与 `chromeBoxAt` 同一条纪律）', () => {
    for (const scale of [0.5, 1, 1.4, 1.5, 2]) {
      const b = battleGearBoxAt(scale);
      expect(b.x, `scale=${scale}`).toBe(Math.round(MARGIN * scale));
      expect(b.size, `scale=${scale}`).toBe(Math.max(1, Math.round(GEAR * scale)));
      /** 下缘**始终**离画布底 `MARGIN × scale` —— 这条就是"不会越界"的来源。 */
      expect(b.y + b.size, `scale=${scale}`).toBe(
        LOGICAL.height - Math.round(MARGIN * scale),
      );
    }
  });

  it('⚠️【硬验收】**整块**（齿轮 + `F1` 提示）在任何系数下都在 960×540 内', () => {
    /**
     * ⚠️ 这是"规则自己就保证不越界"的判据，**不是**"算完再夹"：
     * 提示与图标**同一行**（右边），高度取 `max(图标, 字号)` —— 而字号
     * 永远 ≤ 图标（13 < 20 起步，比例固定），所以整块高度 = 图标高，
     * 于是"下缘 = `画布高 − 边距`"这句就同时是图标与提示的下缘。
     */
    for (const scale of [0.5, 0.75, 1, 1.4, 1.5, 2]) {
      const { x, y, right, bottom } = gearBlockAt(scale);
      const tag = `scale=${scale}`;
      expect(x, tag).toBeGreaterThanOrEqual(0);
      expect(y, tag).toBeGreaterThanOrEqual(0);
      expect(right, tag).toBeLessThanOrEqual(LOGICAL.width);
      expect(bottom, tag).toBeLessThanOrEqual(LOGICAL.height);
    }
  });

  it('⚠️ 与**缩放后的**日志面板不重叠（同一坐标系，不是基准矩形）', () => {
    for (const scale of [0.5, 1, 1.4, 1.5, 2]) {
      const block = gearBlockAt(scale);
      const log = logRectAt(scale);
      expect(
        overlaps(block, log),
        `scale=${scale}：齿轮整块 ${JSON.stringify(block)} 压住了日志 ${JSON.stringify(log)}`,
      ).toBe(false);
    }
  });

  it('提示在 1.5 与 2.0 下**确实变大了**（字号跟着缩放）', () => {
    const a = gearBlockAt(1.5);
    const b = gearBlockAt(2);
    expect(b.block.w).toBeGreaterThan(a.block.w);
    expect(b.box.size).toBeGreaterThan(a.box.size);
    /**
     * ⚠️ 整块**高度**在并排摆法下是 `max(图标, 提示)` —— 两档都是图标
     * （40 / 30）在决定它，所以这里比的是**字号**（提示真正的尺寸）。
     */
    expect(iconHintBoxSize(GEAR_HINT, b.box.size).h).toBeGreaterThan(
      iconHintBoxSize(GEAR_HINT, a.box.size).h,
    );
  });
});

describe('`chromeBlockBoxAt`：按整块贴边（提示也不出界）', () => {
  it('⚠️ 提示在**左**时，贴右缘的是**提示的那一头**（图标被推离右缘）', () => {
    for (const scale of [0.5, 1, 2]) {
      const box = chromeBlockBoxAt(GEAR_HINT, GEAR, 'left', { right: true, bottom: true }, scale);
      const hint = iconHintBoxSize(GEAR_HINT, box.size);
      const margin = Math.round(MARGIN * scale);
      /** 整块的右缘 = 提示的右缘 = 画布宽 − 边距。 */
      expect(box.x + box.size + HINT_GAP + hint.w, `scale=${scale}`).toBe(LOGICAL.width - margin);
      /** 整块的下缘（提示与图标同一行，取较高者）也在安全区上。 */
      expect(box.y + Math.max(box.size, hint.h), `scale=${scale}`).toBe(
        LOGICAL.height - margin,
      );
    }
  });

  it('提示在**右**时，图标自己就是贴边的那一头（左缘 = 安全区）', () => {
    const box = chromeBlockBoxAt('Esc', ARROW, 'right', { right: false, bottom: false }, 1.5);
    expect(box.x).toBe(Math.round(MARGIN * 1.5));
    expect(box.y).toBe(Math.round(MARGIN * 1.5));
    expect(box.size).toBe(Math.round(ARROW * 1.5));
    /** 整块（图标 + 右边的提示）都落在画布内。 */
    const hint = iconHintBoxSize('Esc', box.size);
    expect(box.x + box.size + HINT_GAP + hint.w).toBeLessThan(LOGICAL.width);
  });
});
