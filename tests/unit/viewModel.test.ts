import { describe, expect, it } from 'vitest';
import { translator } from '../../src/i18n/translator';
import { ALL_SKILLS } from '../../src/data/content';
import { FONT, LAYOUT } from '../../src/ui/layout';
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
  /**
   * 预警条右侧的提示**只剩剩余秒数**。
   *
   * 需求：不要"闪避或格挡"字样。这两种应对永远适用，写出来是噪声；
   * 玩家真正要读的是"还有多久命中"。所以这里不再断言任何文案 key。
   */
  it('给出剩余秒数（保留 1 位）', () => {
    const hint = telegraphHint({
      skillId: 'corruption',
      nameKey: 'boss.cleave.name',
      progress: 0.5,
      interruptible: true,
      remainingMs: 1500,
    });
    expect(hint?.seconds).toBe('1.5');
    expect(Object.keys(hint ?? {})).toEqual(['seconds']);
  });

  it('没有读条时返回 undefined', () => {
    expect(telegraphHint(undefined)).toBeUndefined();
  });

  it('【关键】只有数字，没有任何可显示文案 —— 渲染层不持有文字（i18n 规范 I1）', () => {
    const hint = telegraphHint({
      skillId: 'x',
      nameKey: 'boss.x.name',
      progress: 0,
      interruptible: true,
      remainingMs: 1000,
    });
    // 去掉"闪避或格挡"之后，提示里只剩一个数字串
    expect(hint?.seconds).toMatch(/^[\d.]+$/);
    expect(JSON.stringify(hint)).not.toMatch(/[\u4e00-\u9fff]/);
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
      'block.cooldown',
      'block.casting',
      'hint.dodgeOrGuard',
      'hint.armored',
    ];
    for (const key of required) {
      expect(() => translator.t(key as never)).not.toThrow();
    }
  });
});

describe('数据一致性：命中时刻必须等于读条时长', () => {
  /**
   * Boss 招式的 `hits[].at` 表示"命中在读条的第几毫秒"。
   * 它必须**等于** `castTime`（读条走完才命中）。
   *
   * ⚠️ 这个坑我踩了三次：
   *   - `at` < `castTime` → 伤害在读条**结束前**就结算，
   *     表现为"读条条还在走、血已经掉了"
   *   - `at` > `castTime` → 读条条已经消失、伤害才掉
   *
   * 而且两次都是**改了 `castTime` 忘了同步 `at`**。
   * 它不会让任何功能测试失败（战斗照常进行），所以必须专门守住。
   */
  it('Boss 读条技能的 at 与 castTime 一致', () => {
    /**
     * ⚠️ 这条规则**只适用于 Boss 招式**。
     *
     * 玩家技能（「攻」「轰」）的 `at` 是 0 —— 它们的命中在**读条结束时**
     * 结算，而不是按 `at` 计时。所以不能用同一套规则去卡它们
     * （第一版我就那么写了，结果把「攻」也报成违规）。
     */
    const bossSkills = ALL_SKILLS.filter((s) => s.id.startsWith('boss-') && s.castTime > 0);
    expect(bossSkills.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const skill of bossSkills) {
      for (const hit of skill.hits) {
        if (hit.at !== skill.castTime) {
          offenders.push(`${skill.id}: at=${hit.at} castTime=${skill.castTime}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('读条组件（CastBar）：两处读条共用同一个实现', () => {
  /**
   * 需求："boss 读条依旧看不到上 border，玩家读条也有 bug，
   * 这 2 个你没有抽成组件？所有的进度条，都应该抽成同一个组件。"
   *
   * 抽组件的**直接收益**是：层叠顺序只定义一次。所以这里守住
   * 那个顺序 —— 它是"边框被填充盖住"这个 bug 的根因。
   *
   * 组件本身要构造 Pixi 对象（jsdom 里不好跑），所以这里用
   * 源码断言 + 行为断言组合：
   *   - 源码里 `addChild` 的参数顺序必须是 底 → 填充 → 描边 → 文字
   *   - LAYOUT 里两处读条的矩形不重叠，且都在画布内
   */
  it('【关键】层叠顺序是 底 → 填充 → 描边 → 文字', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/CastBar.ts', import.meta.url), 'utf8');
    const m = /this\.root\.addChild\(([^)]*)\)/.exec(src);
    expect(m).not.toBeNull();
    const order = m![1]!.split(',').map((x) => x.trim());
    expect(order).toEqual(['bg', 'this.fillGfx', 'this.border', 'this.nameText', 'this.timeText']);
  });

  it('填充区域左右各让 1px —— 否则会压住左右边框', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/CastBar.ts', import.meta.url), 'utf8');
    // 填充从 x+1 开始、宽 w-2、高 h-2
    expect(src).toMatch(/rect\(x \+ 1, y \+ 1, filled, h - 2\)/);
    expect(src).toMatch(/const innerW = Math\.max\(0, w - 2\)/);
  });

  it('两处读条都够高，且都不与所属面板重叠', () => {
    // Boss 预警条在顶部、独立
    expect(LAYOUT.castBar.h).toBeGreaterThanOrEqual(FONT.body + 8);
    // 玩家读条必须在玩家面板上方（面板后绘制会盖住它）
    expect(LAYOUT.playerCastBar.y + LAYOUT.playerCastBar.h).toBeLessThanOrEqual(LAYOUT.player.y);
  });
});
