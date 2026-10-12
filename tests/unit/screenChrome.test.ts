import { describe, expect, it } from 'vitest';
import { battleGearBoxAt, chromeBoxAt } from '../../src/ui/ScreenChrome';
import { LAYOUT, LOGICAL } from '../../src/ui/layout';

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

const gearAt = (scale: number) => chromeBoxAt({ right: true, bottom: false }, GEAR, scale);
const backAt = (scale: number) => chromeBoxAt({ right: false, bottom: false }, ARROW, scale);

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

describe('战斗界面的齿轮：日志下方（不是四条边角之一）', () => {
  it('贴着日志的左缘与下缘（引用 `LAYOUT.log`，不是写死的数字）', () => {
    const b = battleGearBoxAt(1);
    expect(b.x).toBe(LAYOUT.log.x + MARGIN);
    expect(b.y).toBe(LAYOUT.log.y + LAYOUT.log.h + MARGIN);
    expect(b.size).toBe(GEAR);
  });

  it('随系数缩放，且始终**跟着日志走**（日志动了它就跟）', () => {
    for (const scale of [0.5, 1, 1.5]) {
      const b = battleGearBoxAt(scale);
      expect(b.x, `scale=${scale}`).toBe(Math.round(LAYOUT.log.x * scale) + Math.round(MARGIN * scale));
      expect(b.size, `scale=${scale}`).toBe(Math.max(1, Math.round(GEAR * scale)));
    }
  });

  it('⚠️ 齿轮的**图标**不与日志的提示文字打架（左缘对齐，往右下长）', () => {
    /**
     * 战斗日志是 160 宽（`LAYOUT.log.w`），齿轮钉在它左缘往内 8px。
     * 位置提示（`F1`）从图标左上角往**右下**长，所以它必须仍然落在
     * 日志宽度之内 —— 越界就会压到日志正文上。
     */
    for (const scale of [0.5, 1, 1.5, 2]) {
      const b = battleGearBoxAt(scale);
      expect(b.x + b.size, `scale=${scale}`).toBeLessThan(LAYOUT.log.x * scale + LAYOUT.log.w * scale);
    }
  });
});
