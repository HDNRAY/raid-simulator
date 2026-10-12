import { describe, expect, it } from 'vitest';
import {
  capsOf,
  operationModeOverride,
  parseSavedMode,
  resolveOperationMode,
} from '../../src/render/platform';

/**
 * 操作方式 = **全应用唯一的 flag**（用户 2026-10-12："所有 决定 是 键盘
 * 还是触屏的 只用唯一 flag"）。
 *
 * ⚠️ 这一组测试**故意不测任何 `matchMedia`**：探测那一套已经按用户要求
 * 整块删掉了（见 `render/platform.ts` 文件头）。剩下要守的是两件事：
 *
 *   1. 三个来源的**优先级**（URL > 存档 > 默认 `keyboard`）
 *   2. `caps` 是**派生**出来的（`showKeyHints` 不是第二个来源）
 */

describe('操作方式（唯一 flag）', () => {
  it('默认是键盘 —— 用户接受"真手机第一次进来默认键盘界面"', () => {
    expect(resolveOperationMode('', null)).toBe('keyboard');
  });

  it('存档里的选择生效（「通用」页切过之后）', () => {
    expect(resolveOperationMode('', 'touch')).toBe('touch');
    expect(resolveOperationMode('', 'keyboard')).toBe('keyboard');
  });

  it('坏存档 / 旧版本写的别的值 → 当"没存过"（回落默认）', () => {
    expect(parseSavedMode('mobile')).toBeUndefined();
    expect(parseSavedMode('')).toBeUndefined();
    expect(parseSavedMode(null)).toBeUndefined();
    expect(resolveOperationMode('', 'true')).toBe('keyboard');
  });

  it('【关键】`?touch=1` / `?touch=0` 覆盖存档', () => {
    expect(resolveOperationMode('?touch=1', 'keyboard')).toBe('touch');
    expect(resolveOperationMode('?touch=0', 'touch')).toBe('keyboard');
    expect(resolveOperationMode('?prepare=skip&touch=1', null)).toBe('touch');
    expect(resolveOperationMode('?touch=0&boss=lust', 'touch')).toBe('keyboard');
  });

  it('参数只认 1 / 0 —— 别的值当"没给"（一个含义过载的参数比没有更糟）', () => {
    expect(operationModeOverride('?touch=true')).toBeUndefined();
    expect(operationModeOverride('?touch=')).toBeUndefined();
    expect(operationModeOverride('?touch=2')).toBeUndefined();
    expect(resolveOperationMode('?touch=true', 'touch')).toBe('touch');
  });
});

describe('caps 是 flag 的派生（不是第二个来源）', () => {
  it('键盘：showKeyHints 为真、touch 为假', () => {
    const caps = capsOf('keyboard');
    expect(caps.mode).toBe('keyboard');
    expect(caps.touch).toBe(false);
    expect(caps.showKeyHints).toBe(true);
  });

  it('触屏：反过来', () => {
    const caps = capsOf('touch');
    expect(caps.mode).toBe('touch');
    expect(caps.touch).toBe(true);
    expect(caps.showKeyHints).toBe(false);
  });

  it('两个字段都与 mode 反/正相关 —— 形状上没有第三个来源', () => {
    for (const mode of ['keyboard', 'touch'] as const) {
      const caps = capsOf(mode);
      expect(caps.touch).toBe(mode === 'touch');
      expect(caps.showKeyHints).toBe(mode === 'keyboard');
      expect(Object.keys(caps).sort()).toEqual(['mode', 'showKeyHints', 'touch']);
    }
  });
});
