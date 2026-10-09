import { describe, expect, it } from 'vitest';
import { translator } from '../../src/i18n/translator';
import {
  formatClock,
  isTightWindow,
  ratioOf,
  telegraphHint,
  type BuffView,
} from '../../src/render/viewModel';

/**
 * 渲染层的**格式化与规则**是纯函数，在 node 环境测 ——
 * 不需要 pixi、不需要 DOM。这是把 UI 拆成"数据规则 + 绘制"的收益。
 */

describe('ratioOf', () => {
  it('正常比例', () => {
    expect(ratioOf({ current: 50, cap: 100 })).toBe(0.5);
    expect(ratioOf({ current: 0, cap: 100 })).toBe(0);
    expect(ratioOf({ current: 100, cap: 100 })).toBe(1);
  });

  it('超过上限被钳到 1，负数钳到 0', () => {
    expect(ratioOf({ current: 150, cap: 100 })).toBe(1);
    expect(ratioOf({ current: -10, cap: 100 })).toBe(0);
  });

  it('cap 为 0 或 NaN 时返回 0（不产生 NaN 宽度）', () => {
    expect(ratioOf({ current: 10, cap: 0 })).toBe(0);
    expect(ratioOf({ current: 10, cap: Number.NaN })).toBe(0);
    expect(ratioOf({ current: Number.NaN, cap: 100 })).toBe(0);
  });
});

describe('formatClock', () => {
  it('M:SS 格式', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(1000)).toBe('0:01');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(180_000)).toBe('3:00');
  });

  it('向上取整（剩 0.1 秒也显示 1 秒，不会提前显示 0）', () => {
    expect(formatClock(100)).toBe('0:01');
    expect(formatClock(1801_000)).toBe('30:01');
  });

  it('负数与 Infinity 安全', () => {
    expect(formatClock(-500)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('--:--');
  });
});

describe('telegraphHint —— 预警必须告诉玩家该做什么', () => {
  it('可打断的技能给出"可打断"的 key 与剩余秒数', () => {
    const hint = telegraphHint({
      skillId: 'corruption',
      nameKey: 'boss.cleave.name',
      progress: 0.5,
      interruptible: true,
      remainingMs: 1500,
    });
    expect(hint?.key).toBe('hint.interruptible');
    expect(hint?.seconds).toBe('1.5');
  });

  it('不可打断的技能给出"闪避或格挡"的 key', () => {
    const hint = telegraphHint({
      skillId: 'crimson-arc',
      nameKey: 'boss.crimsonArc.name',
      progress: 0.5,
      interruptible: false,
      remainingMs: 800,
    });
    expect(hint?.key).toBe('hint.dodgeOrGuard');
    expect(hint?.seconds).toBe('0.8');
  });

  it('没有读条时返回 undefined', () => {
    expect(telegraphHint(undefined)).toBeUndefined();
  });

  it('【关键】返回的是 key 而不是文案 —— 渲染层不持有可显示文字', () => {
    const hint = telegraphHint({
      skillId: 'x',
      nameKey: 'boss.x.name',
      progress: 0,
      interruptible: true,
      remainingMs: 1000,
    });
    // 断言它不含中文（i18n 规范 I1：渲染层不许硬编码文案）
    expect(hint?.key).not.toMatch(/[\u4e00-\u9fff]/);
  });
});

describe('isTightWindow', () => {
  const buff = (over: Partial<BuffView>): BuffView => ({
    id: 'dodge-iframe',
    nameKey: 'hud.dodged',
    icon: 'i',
    polarity: 'buff',
    color: 0xff7a55,
    shortLabelKey: 'buffShort.dodgeIframe',
    stacks: 1,
    remainingMs: 300,
    durationMs: 300,
    isDefensive: true,
    ...over,
  });

  it('判定窗口且剩余时间很短 → 需要高亮', () => {
    expect(isTightWindow(buff({ remainingMs: 150 }))).toBe(true);
  });

  it('判定窗口但时间还长 → 不高亮', () => {
    expect(isTightWindow(buff({ remainingMs: 500 }))).toBe(false);
  });

  it('非判定类 buff 永远不高亮', () => {
    expect(isTightWindow(buff({ isDefensive: false, remainingMs: 50 }))).toBe(false);
  });
});


describe('本地化 key 契约（i18n 规范 I1）', () => {
  it('所有不可用原因的 key 都能在语言包中找到', () => {
    // 这些 key 由 viewAdapter 产出，必须真实存在于语言包
    const required = [
      'block.comboWindow',
      'block.cost',
      'block.gcd',
      'block.cooldown',
      'block.casting',
      'hint.dodgeOrGuard',
      'hint.interruptible',
    ];
    for (const key of required) {
      expect(() => translator.t(key as never)).not.toThrow();
    }
  });
});
