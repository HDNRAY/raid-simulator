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

  it('数字自动上色（不再依赖 `**` 标记）', () => {
    const runs = splitRuns('造成3层，每5秒回10缠。');
    expect(runs.map((r) => r.text)).toEqual(['造成', '3', '层，每', '5', '秒回', '10', '缠。']);
    expect(runs.filter((r) => r.emphasis).map((r) => r.text)).toEqual(['3', '5', '10']);
  });

  it('百分号 / 小数 / 负数都算数字段', () => {
    const runs = splitRuns('增加100%，减少1.5秒');
    expect(runs.filter((r) => r.emphasis).map((r) => r.text)).toEqual(['100%', '1.5']);
  });

  it('空串 ⇒ 空数组', () => {
    expect(splitRuns('')).toEqual([]);
  });
});
