import { describe, expect, it } from 'vitest';

import {
  WIDE_VIEWPORT_PX,
  parseStageScale,
  resolveStageScale,
} from '../../src/render/stageScale';

/**
 * **渲染缓冲倍率**（`STAGE_SCALE`，2026-10-20）。
 *
 * 逻辑空间仍是 960×540；这个数只决定"一个逻辑像素用几个设备像素画"。
 * 这里钉的是**判据**（覆盖优先 / 触屏 1 / 大屏 2），不是某一台设备的结果。
 */

describe('「渲染缓冲倍率」怎么定', () => {
  it('`?scale=` 覆盖一切（1 和 2 都认）', () => {
    expect(parseStageScale('1')).toBe(1);
    expect(parseStageScale('2')).toBe(2);
    expect(resolveStageScale({ touch: true, viewportWidth: 400, override: 2 })).toBe(2);
    expect(resolveStageScale({ touch: false, viewportWidth: 2560, override: 1 })).toBe(1);
  });

  it('写错的 `?scale=` 当没传（与 `?runlen=` 同一条口径）', () => {
    for (const raw of ['3', '0', '1.5', 'two', '', '  ']) {
      expect(parseStageScale(raw), raw).toBeUndefined();
    }
    expect(parseStageScale(null)).toBeUndefined();
  });

  it('**触屏一律 1 倍**（960 的缓冲在手机上本来就是被缩小显示的）', () => {
    expect(resolveStageScale({ touch: true, viewportWidth: 2560 })).toBe(1);
  });

  it('桌面：视口够宽才上 2 倍', () => {
    expect(resolveStageScale({ touch: false, viewportWidth: WIDE_VIEWPORT_PX })).toBe(2);
    expect(resolveStageScale({ touch: false, viewportWidth: WIDE_VIEWPORT_PX - 1 })).toBe(1);
  });
});
