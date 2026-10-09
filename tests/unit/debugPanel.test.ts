import { describe, expect, it } from 'vitest';
import { formatDebugValue, type DebugValues } from '../../src/ui/debug/DebugPanel';

/**
 * 调试面板的**格式化逻辑**是纯函数，可以在 node 环境测。
 *
 * 之所以把它从类里抽出来导出，就是为了这个 ——
 * 否则要为了测几个数字格式去搭 jsdom + Pixi。
 */

const base: DebugValues = {
  tick: 1234,
  steps: 1,
  alpha: 0.25,
  droppedMs: 0,
  fps: 59.6,
  scale: 1.3333,
  usingWorker: true,
  snapshotTick: 1200,
};

describe('formatDebugValue', () => {
  it('fps 取整', () => {
    expect(formatDebugValue('fps', base)).toBe('60');
    expect(formatDebugValue('fps', { ...base, fps: 12.4 })).toBe('12');
  });

  it('tick 原样显示', () => {
    expect(formatDebugValue('tick', base)).toBe('1234');
  });

  it('还没有快照时显示 -- 而不是 -1', () => {
    expect(formatDebugValue('snapshotTick', { ...base, snapshotTick: -1 })).toBe('--');
    expect(formatDebugValue('snapshotTick', base)).toBe('1200');
  });

  it('alpha 保留两位', () => {
    expect(formatDebugValue('alpha', base)).toBe('0.25');
    expect(formatDebugValue('alpha', { ...base, alpha: 0.98765 })).toBe('0.99');
  });

  it('droppedMs 为 0 时显示 0（不显示 0.0）', () => {
    expect(formatDebugValue('droppedMs', base)).toBe('0');
    expect(formatDebugValue('droppedMs', { ...base, droppedMs: 4916.7 })).toBe('4917');
  });

  it('scale 带 x 后缀', () => {
    expect(formatDebugValue('scale', base)).toBe('1.33x');
    expect(formatDebugValue('scale', { ...base, scale: 2 })).toBe('2.00x');
  });

  it('thread 显示 worker / main', () => {
    expect(formatDebugValue('thread', base)).toBe('worker');
    expect(formatDebugValue('thread', { ...base, usingWorker: false })).toBe('main');
  });
});
