import { describe, expect, it } from 'vitest';

import { estimatedHeightOf, lineHeightOf } from '../../src/ui/detailText';


describe('行高：实测与估算取大（2026-10-22：Pixi 对折行只报一行高）', () => {
  it('Pixi 报一行高（17）而估算三行时，取估算', () => {
    /** 真实事故读数：`height` 恒为 `lineHeight`=17，而正文折了 2~3 行。 */
    expect(lineHeightOf(17, 51)).toBe(51);
  });

  it('实测比估算大时取实测（不为估算牺牲真实高度）', () => {
    expect(lineHeightOf(60, 34)).toBe(60);
  });

  it('实测为 0 / NaN（还没排版）时退回估算', () => {
    expect(lineHeightOf(0, 34)).toBe(34);
    expect(lineHeightOf(Number.NaN, 34)).toBe(34);
  });

  it('估算三行的行高 = 3 × bodyLine（行距不塌陷）', () => {
    const text = { text: '一'.repeat(60), height: 17, style: { wordWrapWidth: 272 } };
    const est = estimatedHeightOf(text, 13, 17);
    expect(est).toBeGreaterThanOrEqual(51);
    expect(lineHeightOf(text.height, est)).toBe(est);
  });
});
