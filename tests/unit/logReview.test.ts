import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LogEntry } from '../../src/app/logFormat';
import {
  CATEGORY_COLORS,
  RESULT_STAT_KEYS,
  REVIEW_FOOTER_H,
  REVIEW_HEADER_H,
  REVIEW_PAD_X,
  REVIEW_RECT,
  REVIEW_ROWS,
  REVIEW_ROW_H,
  REVIEW_TEXT_X,
  REVIEW_TIME_W,
  clampOffset,
  isFinished,
  majorEntries,
  maxOffset,
  pageStep,
  resolveLogParams,
  resultStatCells,
  rowStyle,
  scrollFraction,
  scrollOffset,
  scrollThumbRatio,
  secondsAt,
  tailOffset,
  visibleWindow,
  windowRange,
  type ResultSummary,
} from '../../src/ui/logReview';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import {
  FEED_BREAK_SLACK,
  FEED_PAD_X,
  estimateWidth,
  layoutFeed,
  wrapToWidth,
  type FeedLayoutOptions,
} from '../../src/ui/logFeed';
import { FONT, LAYOUT, LOGICAL } from '../../src/ui/layout';

/**
 * **战报复盘的纯逻辑**（`ui/logReview.ts`）+ **战斗中那列的折行**
 * （`ui/logFeed.ts`）。
 *
 * 需求："一局结束 也显示完整log，玩家好复盘。" 与父 agent 的实测发现：
 * "新的文案比那个小面板宽得多，右半边被裁掉了"。
 *
 * 这两块都不好靠截图验证 —— 图只证明"这一帧看着对"，证明不了
 * "滚到尽头会怎样"、"条数为 0 会怎样"、"一屏到底放得下几条"。
 * 所以窗口计算与折行都提成了纯函数，这一份测试就是它们的验收条件。
 */

/** 读源码（接线/不透明这类"约定"用扫描守，见各组测试的说明）。 */
const read = (path: string): string =>
  readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

/** 造一条日志（默认 `major`，与格式化层的真实形状一致）。 */
function entry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 1,
    tick: 0,
    category: 'deal',
    level: 'major',
    key: 'log.damage',
    ...over,
  };
}

/** 一串 id（方便断言"显示了哪几条"）。 */
function ids(list: readonly LogEntry[]): number[] {
  return list.map((e) => e.id);
}

function series(count: number, level: LogEntry['level'] = 'major'): LogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    entry({ id: i + 1, tick: i * 6, level, key: 'log.heal' }),
  );
}

describe('logReview：时间轴', () => {
  it('60 tick = 1 秒（向下取整）', () => {
    expect(secondsAt(0)).toBe(0);
    expect(secondsAt(59)).toBe(0);
    expect(secondsAt(60)).toBe(1);
    expect(secondsAt(119)).toBe(1);
    expect(secondsAt(3600)).toBe(60);
  });

  it('负数 / 非有限值当 0（数值纪律：不能把 NaN 画到屏幕上）', () => {
    expect(secondsAt(-5)).toBe(0);
    expect(secondsAt(Number.NaN)).toBe(0);
    expect(secondsAt(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('logReview：一局是否结束', () => {
  it('只有 victory / defeat 算结束', () => {
    expect(isFinished('victory')).toBe(true);
    expect(isFinished('defeat')).toBe(true);
    // ⚠️ idle 不算：进战斗前的空快照会让复盘面板闪一下
    expect(isFinished('idle')).toBe(false);
    expect(isFinished('running')).toBe(false);
  });
});

describe('logReview：该显示哪几条', () => {
  it('offset = 第一条可见条目的下标（时间顺序，旧的在前）', () => {
    const all = series(5);
    expect(ids(visibleWindow(all, 0, 3))).toEqual([1, 2, 3]);
    expect(ids(visibleWindow(all, 2, 3))).toEqual([3, 4, 5]);
  });

  it('偏移越界会被钳住（滚过头不会画出空白页）', () => {
    const all = series(5);
    expect(ids(visibleWindow(all, 99, 3))).toEqual([3, 4, 5]);
    expect(ids(visibleWindow(all, -99, 3))).toEqual([1, 2, 3]);
    expect(maxOffset(5, 3)).toBe(2);
    expect(maxOffset(2, 10)).toBe(0);
    expect(clampOffset(Number.NaN, 5, 3)).toBe(2);
  });

  it('条数不足一屏时全都显示（不会切出空条目）', () => {
    const all = series(2);
    expect(ids(visibleWindow(all, 0, 10))).toEqual([1, 2]);
    expect(visibleWindow([], 0, 10)).toEqual([]);
  });

  it('一局刚结束停在**最新**那几条（先看"最后发生了什么"）', () => {
    expect(tailOffset(137, 28)).toBe(109);
    expect(tailOffset(3, 28)).toBe(0);
  });

  it('翻页留一行重叠（不然会"跳丢"一行）', () => {
    expect(pageStep(28)).toBe(27);
    expect(pageStep(1)).toBe(1);
    expect(scrollOffset(0, -5, 100, 28)).toBe(0);
    expect(scrollOffset(70, 99, 100, 28)).toBe(72);
    expect(scrollOffset(10, 0, 100, 28)).toBe(10);
  });

  it('当前窗口的区间：第 X-Y 条 / 共 N 条', () => {
    expect(windowRange(5, 3, 0)).toEqual({ from: 1, to: 3, count: 5 });
    expect(windowRange(5, 3, 2)).toEqual({ from: 3, to: 5, count: 5 });
    expect(windowRange(1, 28, 0)).toEqual({ from: 1, to: 1, count: 1 });
    expect(windowRange(0, 28, 0)).toEqual({ from: 0, to: 0, count: 0 });
  });

  it('滚条：位置与长度都是纯比例（几何由渲染层乘上去）', () => {
    expect(scrollFraction(0, 100, 28)).toBe(0);
    expect(scrollFraction(72, 100, 28)).toBe(1);
    expect(scrollFraction(36, 100, 28)).toBeCloseTo(0.5, 5);
    // 不足一屏 → 没有可滚的
    expect(scrollFraction(0, 10, 28)).toBe(0);
    expect(scrollThumbRatio(10, 28)).toBe(1);
    expect(scrollThumbRatio(100, 28)).toBeCloseTo(0.28, 5);
  });
});

describe('logReview：major / minor 的分工（冻结契约）', () => {
  it('战斗中那条实时列**只吃 major**（minor 会把面板刷爆）', () => {
    const all = [
      entry({ id: 1, level: 'major' }),
      entry({ id: 2, level: 'minor' }),
      entry({ id: 3, level: 'major' }),
    ];
    expect(ids(majorEntries(all))).toEqual([1, 3]);
  });

  it('minor 更小、更淡；major 带底纹（需求："次要的更轻更淡"）', () => {
    const major = rowStyle(entry({ level: 'major' }));
    const minor = rowStyle(entry({ level: 'minor' }));
    expect(minor.size).toBeLessThan(major.size);
    expect(minor.alpha).toBeLessThan(major.alpha);
    expect(minor.stripeAlpha).toBe(0);
    expect(major.stripeAlpha).toBeGreaterThan(0);
  });

  it('每个类别都有配色（Record 类型 + 这条断言一起守）', () => {
    const categories: Array<LogEntry['category']> = [
      'deal',
      'take',
      'avoid',
      'interrupt',
      'cast',
      'resource',
      'system',
    ];
    for (const category of categories) {
      expect(typeof CATEGORY_COLORS[category]).toBe('number');
    }
  });
});

describe('logReview：取词', () => {
  it('**值是 key** 的参数会被翻掉（否则屏幕上出现 boss.cleave.name）', () => {
    const translate = (key: string): string => (key === 'boss.cleave.name' ? '碾压' : key);
    expect(resolveLogParams({ amount: 20, skill: 'boss.cleave.name' }, translate)).toEqual({
      amount: 20,
      skill: '碾压',
    });
  });

  it('数字原样留着（它是插值，不是 key）', () => {
    const translate = (key: string): string => `T(${key})`;
    expect(resolveLogParams({ amount: 20 }, translate)).toEqual({ amount: 20 });
  });

  it('没有参数时原样返回 undefined', () => {
    expect(resolveLogParams(undefined, (k) => k)).toBeUndefined();
  });
});

describe('logReview：几何（一屏放得下、不越界）', () => {
  it('行数 × 行高 + 头 + 脚 ≤ 面板高', () => {
    expect(REVIEW_ROWS).toBeGreaterThan(0);
    expect(REVIEW_ROWS * REVIEW_ROW_H + REVIEW_HEADER_H + REVIEW_FOOTER_H).toBeLessThanOrEqual(
      REVIEW_RECT.h,
    );
  });

  it('面板在画布内（含内边距，描边不会被裁）', () => {
    expect(REVIEW_RECT.x).toBeGreaterThanOrEqual(0);
    expect(REVIEW_RECT.y).toBeGreaterThanOrEqual(0);
    expect(REVIEW_RECT.x + REVIEW_RECT.w).toBeLessThanOrEqual(LOGICAL.width);
    expect(REVIEW_RECT.y + REVIEW_RECT.h).toBeLessThanOrEqual(LOGICAL.height);
  });

  it('正文列在面板里，且宽度够放一条完整句子', () => {
    // 列的位置 = 左内边距 + 时间列 + 空隙 + 色条 + 空隙
    expect(REVIEW_TEXT_X).toBeGreaterThan(REVIEW_RECT.x + REVIEW_PAD_X + REVIEW_TIME_W);
    const available = REVIEW_RECT.x + REVIEW_RECT.w - REVIEW_PAD_X - REVIEW_TEXT_X;
    // 最长的一条（博德之门3 那种句子，含两个名字）必须放得下
    expect(available).toBeGreaterThan(estimateWidth('林晚风用「熵之钟」击中傲慢，造成 120 点伤害', 13));
  });
});

describe('logFeed：战斗中那一列的折行（父 agent 实测的裁切问题）', () => {
  /**
   * 真实的小面板文字区：160 宽 - 左右各 `FEED_PAD_X` 内边距。
   *
   * ⚠️ 从 `LAYOUT.log` 算出来而不是写死 144/148 —— 面板变宽变窄时
   * 这组断言要跟着走，否则它守的就是一个不存在的宽度。
   */
  const MAX_PX = LAYOUT.log.w - FEED_PAD_X * 2;
  const SIZE = FONT.tiny;

  it('【关键】长句折成两行，**每一行都在面板里**（不再被裁掉）', () => {
    const text = '傲慢用「轻蔑」击中林晚风，造成 20 点伤害';
    const lines = wrapToWidth(text, MAX_PX, SIZE);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      // 允许为"不断词"多占 `FEED_BREAK_SLACK`，但连它一起仍必须在面板内
      expect(estimateWidth(line, SIZE)).toBeLessThanOrEqual(MAX_PX + FEED_BREAK_SLACK);
    }
    expect(FEED_PAD_X + MAX_PX + FEED_BREAK_SLACK).toBeLessThanOrEqual(LAYOUT.log.w);
  });

  it('短句不折行', () => {
    expect(wrapToWidth('战斗结束', MAX_PX, SIZE)).toEqual(['战斗结束']);
  });

  it('断点选在空格处（"造成" 与数字之间），不在名字/词中间切开', () => {
    const lines = wrapToWidth('傲慢用「轻蔑」击中林晚风，造成 20 点伤害', MAX_PX, SIZE);
    expect(lines[1]).toBe('造成 20 点伤害');
    // 这一条更紧：多 6px 的宽容正是为了让「造成」不被劈成"造 / 成"
    const tight = wrapToWidth('林晚风用「轰」击中傲慢，造成 10 点伤害', MAX_PX, SIZE);
    expect(tight[0]).toBe('林晚风用「轰」击中傲慢，造成');
    expect(tight[1]).toBe('10 点伤害');
  });

  it('真的放不下时**省略而不是静默丢**（复盘里那句话是完整的）', () => {
    const text = '傲慢用「碾压」击中林晚风，造成 120 点伤害，然后又是很长很长的一段话';
    const lines = wrapToWidth(text, MAX_PX, SIZE);
    expect(lines.length).toBe(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
    for (const line of lines) {
      expect(estimateWidth(line, SIZE)).toBeLessThanOrEqual(MAX_PX + FEED_BREAK_SLACK);
    }
  });

  it('半角比全角窄（估算宽度的基本假设）', () => {
    expect(estimateWidth('20', SIZE)).toBeLessThan(estimateWidth('二十', SIZE));
    expect(estimateWidth('傲', SIZE)).toBe(SIZE);
  });

  const layout: FeedLayoutOptions = {
    bottomY: 262,
    topY: 92,
    maxPx: MAX_PX,
    size: SIZE,
    lineH: 13,
    rowGap: 1,
    maxBlocks: 10,
  };

  it('最新的排在最下面，往上越来越旧', () => {
    const blocks = layoutFeed(['a', 'b', 'c'], layout);
    expect(blocks.length).toBe(3);
    expect(blocks[0]?.lines).toEqual(['c']);
    expect(blocks[0]?.y).toBe(layout.bottomY - layout.lineH);
    expect(blocks[1]?.y).toBeLessThan(blocks[0]?.y ?? 0);
  });

  it('排不下就停（不会画到标题上）', () => {
    const long = '傲慢用「轻蔑」击中林晚风，造成 20 点伤害';
    const blocks = layoutFeed(Array.from({ length: 40 }, () => long), layout);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.y).toBeGreaterThanOrEqual(layout.topY);
    }
    // 10 条标签是上限
    expect(blocks.length).toBeLessThanOrEqual(layout.maxBlocks);
  });

  it('标签用完就停（标签是建一次复用的，不能越界）', () => {
    const blocks = layoutFeed(Array.from({ length: 40 }, () => '短'), { ...layout, maxBlocks: 3 });
    expect(blocks.length).toBe(3);
  });

  it('空输入 → 不画', () => {
    expect(layoutFeed([], layout)).toEqual([]);
  });
});

describe('logReview：结算摘要并进复盘头部（需求："一局结束**也**显示完整 log"）', () => {
  /** 结算数据（形状与 `render/viewModel.ts` 的 `ResultView` 一致）。 */
  const result: ResultSummary = {
    victory: true,
    titleKey: 'screen.victory',
    reasonKey: 'screen.wonByKill',
    reasonParams: { name: 'boss.pride.name' },
    /** ⚠️ `seconds` 在 view-model 里已经是**格式化好的字符串**（"20.4"） */
    seconds: '20.4',
    remainingHp: 40,
    remainingHpCap: 100,
    totalDamage: 70,
    dps: 3,
  };

  it('四格 = 用时 / 剩余生命 / 造成伤害 / DPS，值**直接来自 result**（渲染层不自己算）', () => {
    expect(resultStatCells(result)).toEqual([
      { key: 'screen.statTime', value: '20.4s' },
      { key: 'screen.statRemainingHp', value: '40/100' },
      { key: 'screen.statTotalDamage', value: '70' },
      { key: 'screen.statDps', value: '3' },
    ]);
  });

  it('用的全是**已有**的 `screen.stat*` key（`zh-CN.ts` 贴 700 行，一条新 key 都不加）', () => {
    const flat = flattenCatalog(zhCN);
    for (const key of RESULT_STAT_KEYS) {
      expect(flat.has(key)).toBe(true);
    }
    expect(RESULT_STAT_KEYS).toHaveLength(4);
  });

  it('【关键】复盘面板**不透明**：结算文字不会从底下透出来', () => {
    const review = read('ui/LogReviewPanel.ts');
    expect(review).toMatch(/fillAlpha: 1,/);
    // 结算摘要从 view.result 拿，不是我算的
    expect(review).toMatch(/this\.result = view\.result/);
    expect(review).toMatch(/resultStatCells\(result\)/);
  });

  it('结算面板的矩形**完全落在**复盘面板内（不会露在面板外）', () => {
    const rw = LAYOUT.result.w;
    const rh = LAYOUT.result.h;
    const rx = Math.round((LOGICAL.width - rw) / 2);
    const ry = Math.round((LOGICAL.height - rh) / 2) - 20;
    expect(REVIEW_RECT.x).toBeLessThanOrEqual(rx);
    expect(REVIEW_RECT.y).toBeLessThanOrEqual(ry);
    expect(REVIEW_RECT.x + REVIEW_RECT.w).toBeGreaterThanOrEqual(rx + rw);
    expect(REVIEW_RECT.y + REVIEW_RECT.h).toBeGreaterThanOrEqual(ry + rh);
  });

  it('头部是两行（标题/结局 + 结算摘要）', () => {
    expect(REVIEW_HEADER_H).toBeGreaterThanOrEqual(40);
  });
});

describe('logReview：渲染层的接线（源码扫描）', () => {
  it('实时列只喂 major，复盘喂**全部**（含 minor）', () => {
    const panel = read('ui/LogPanel.ts');
    // 实时列：经过 majorEntries 过滤
    expect(panel).toMatch(/majorEntries\(entries\)/);
    expect(panel).toMatch(/this\.review\.update\(entries, view\)/);
  });

  it('复盘面板不判 `entry.key` 是什么（i18n 规范 I1：渲染层不做判断）', () => {
    const review = read('ui/LogReviewPanel.ts');
    // 文案一律 translate(entry.key, ...)
    expect(review).toMatch(/t\(entry\.key, resolveLogParams/);
    // 不许出现 "entry.key === 'log.xxx'" 这种分支
    expect(review).not.toMatch(/key === 'log\./);
  });

  it('一局结束把**整份 view** 传进去（BattleScene 那一行）', () => {
    const scene = read('render/BattleScene.ts');
    expect(scene).toMatch(/this\.logPanel\.update\(ctx\.logEntries, ctx\.view\)/);
  });
});
