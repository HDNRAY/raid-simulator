import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  type PlatformCaps,
  type PlatformProbe,
} from '../../src/render/platform';

/**
 * 把一组"命中哪些媒体查询"装成探测接口。
 *
 * ⚠️ 这不是绕过类型检查 —— 它把"这里是一份构造出来的探测结果"
 * 写在了名字上，而且只有这一处（AGENTS.md §1 的"有名字的构造器"）。
 */
function probeOf(hits: readonly string[], hasPointerEvents = true): PlatformProbe {
  const set = new Set(hits);
  return { matches: (q) => set.has(q), hasPointerEvents };
}

const capsOf = (hits: readonly string[], hasPointerEvents = true): PlatformCaps =>
  detectPlatform(probeOf(hits, hasPointerEvents));

describe('平台能力探测', () => {
  it('桌面（细指针 + 能悬停）：不是触屏，显示键名提示', () => {
    const caps = capsOf([]);
    expect(caps.touch).toBe(false);
    expect(caps.showKeyHints).toBe(true);
  });

  it('手机（粗指针 + 不能悬停）：是触屏，不显示键名提示', () => {
    const caps = capsOf(['(pointer: coarse)', '(hover: none)']);
    expect(caps.touch).toBe(true);
    expect(caps.showKeyHints).toBe(false);
  });

  it('【关键】只命中 `pointer: coarse` 也算触屏', () => {
    // 有些设备（接了触控板的平板）`hover: none` 不命中
    const caps = capsOf(['(pointer: coarse)']);
    expect(caps.touch).toBe(true);
  });

  it('【关键】只命中 `hover: none` 也算触屏', () => {
    // 补充信号：宁可多认成触屏（代价只是不显示键名提示）
    const caps = capsOf(['(hover: none)']);
    expect(caps.touch).toBe(true);
  });

  it('没有 Pointer Events 时不算触屏 —— 触屏输入层根本没法工作', () => {
    /**
     * 需求要求触屏支持"按住"，而按住靠 `pointerId` 跟踪多指。
     * 没有 Pointer Events 就退化成"只能点一下"，那时**不该**
     * 把键名提示藏起来（用户其实还得用键盘）。
     */
    const caps = capsOf(['(pointer: coarse)', '(hover: none)'], false);
    expect(caps.touch).toBe(false);
    expect(caps.showKeyHints).toBe(true);
  });

  it('showKeyHints 与 touch 反相关，但**是两个字段**', () => {
    const desktop = capsOf([]);
    const mobile = capsOf(['(pointer: coarse)']);
    expect(desktop.showKeyHints).toBe(!desktop.touch);
    expect(mobile.showKeyHints).toBe(!mobile.touch);
    // 形状断言：两个字段都存在（将来可以各自独立变化）
    expect(Object.keys(desktop).sort()).toEqual(['showKeyHints', 'touch']);
  });
});
