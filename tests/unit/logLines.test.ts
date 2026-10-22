import { describe, expect, it } from 'vitest';
import { logLineTexts, resolveLogParams } from '../../src/ui/logReview';
import { LogFormatter } from '../../src/app/logFormat';
import { translator } from '../../src/i18n/translator';
import type { EventDef } from '../../src/core/types';

/**
 * `__raidBattle.logLines()` 的文本（2026-10-23）。
 *
 * ==================================================================
 * 它为什么值得一条 UT
 * ==================================================================
 *
 * 这一轮修的两个 bug（「弹」的伤害被标成反伤、"未知来源"）只有**文本**
 * 能验收 —— 引擎事件对不对是另一回事，玩家看的是屏幕上那行字。
 * 而调试口如果自己拼一遍字符串，"调试看到的"就会与"面板显示的"漂 ✗。
 *
 * 所以这条 UT 钉两件事：
 *   1. 文本 == `translate(key, resolveLogParams(params))`（面板那两步）
 *   2. 真的能读出一句"「弹」对…造成 8 点伤害"，且**不含"未知"**
 */

/** 造一台只装"名字 → 名字 key"的表，让 `translate` 不依赖真实内容表。 */
function makeFormatter(): LogFormatter {
  return new LogFormatter({
    buffNameKeys: new Map([['daixuan-tan-rhythm', 'skill.dan.name']]),
    skillNameKeys: new Map([['attack', 'skill.attack.name']]),
    combatantNameKey: (id) => (id === 'wrath' ? 'wrath.name' : 'roster.daixuan.name'),
  });
}

const DAN_HIT: EventDef = {
  kind: 'damage',
  tick: 1,
  sourceId: 'daixuan',
  targetId: 'wrath',
  amount: 8,
  crit: false,
  absorbed: 0,
  thinned: 0,
  overkill: 0,
  skillId: '',
  sourceBuffId: 'daixuan-tan-rhythm',
};

describe('logLineTexts：调试口读到的就是面板显示的', () => {
  it('文本 == 面板的两步（translate + resolveLogParams）', () => {
    const formatter = makeFormatter();
    formatter.consume([DAN_HIT]);
    const entries = formatter.all();
    const texts = logLineTexts(entries, (key, params) => translator.t(key as never, params as never));
    const expected = entries.map((entry) =>
      translator.t(
        entry.key as never,
        resolveLogParams(entry.params, (key) => translator.t(key as never)) as never,
      ),
    );
    expect(texts).toEqual(expected);
  });

  it('「弹」的伤害：点名「弹」，不含"未知"、不含"反伤"', () => {
    const formatter = makeFormatter();
    formatter.consume([DAN_HIT]);
    const [text] = logLineTexts(formatter.all(), (key, params) =>
      translator.t(key as never, params as never),
    );
    expect(text).toBeDefined();
    expect(text).toContain('弹');
    expect(text).toContain('8');
    expect(text).not.toContain('未知');
    expect(text).not.toContain('反伤');
  });

  it('`n` 只取最近几条（0 / 负数 = 全部）', () => {
    const formatter = makeFormatter();
    formatter.consume([DAN_HIT, { ...DAN_HIT, tick: 2 }, { ...DAN_HIT, tick: 3 }]);
    const all = logLineTexts(formatter.all(), (key) => key, 0);
    expect(all).toHaveLength(3);
    expect(logLineTexts(formatter.all(), (key) => key, 2)).toHaveLength(2);
  });
});
