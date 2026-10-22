import { describe, expect, it } from 'vitest';
import { splitRuns } from '../../src/ui/richLine';

describe('splitRuns（`**` → run 切分）', () => {
  it('普通 + 强调 + 普通', () => {
    expect(splitRuns('造成**3**层')).toEqual([
      { text: '造成', emphasis: false },
      { text: '3', emphasis: true },
      { text: '层', emphasis: false },
    ]);
  });

  it('没有 `**` ⇒ 单段（不额外造 Label）', () => {
    expect(splitRuns('没有强调')).toEqual([{ text: '没有强调', emphasis: false }]);
  });

  it('未闭合的 `**` 不抛错，整段按普通文本（星号留着让人看见）', () => {
    expect(splitRuns('造成**3 层')).toEqual([{ text: '造成**3 层', emphasis: false }]);
  });

  it('连续的 `****` 不产生空强调段', () => {
    expect(splitRuns('a****b')).toEqual([
      { text: 'a', emphasis: false },
      { text: 'b', emphasis: false },
    ]);
  });

  it('空串 ⇒ 空数组', () => {
    expect(splitRuns('')).toEqual([]);
  });
});
