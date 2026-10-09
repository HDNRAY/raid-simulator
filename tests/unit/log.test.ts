import { describe, expect, it } from 'vitest';
import { LogFormatter } from '../../src/app/logFormat';
import { LAYOUT, LOGICAL } from '../../src/ui/layout';
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  clampUiScale,
  computeCanvasCssSize,
  computeScale,
} from '../../src/render/scaling';
import {
  SETTINGS_PANEL,
  cycleZone,
  moveFocus,
  uiScaleSliderRect,
} from '../../src/ui/settings/logic';
import { LOG_PANEL_METRICS } from '../../src/ui/LogPanel';
import { translator } from '../../src/i18n/translator';
import type { EventDef } from '../../src/core/types';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';

/**
 * 战斗日志的**格式化层**。
 *
 * 需求："log 机制之前如果没有正好加一下，log 面板，log formator，
 * 引擎给 log 的输出，应该分层，尽量低耦合。"
 *
 * 分层能不能守住，全看这一层的行为：
 *   - 它只吃 `EventDef`、只吐 "key + 参数"（不含文案）
 *   - 它决定"哪些事件值得记"
 *   - 渲染层不做任何判断
 */

type DamageEvent = Extract<EventDef, { kind: 'damage' }>;

/**
 * 造一条 damage 事件。
 *
 * ⚠️ 不用 `as EventDef` 强转（AGENTS.md §1 禁止类型断言逃生舱）——
 * 这里靠**精确的可选参数类型**让字面量自己满足 `EventDef`。
 * 缺字段时 TypeScript 会直接报错，比强转更早发现问题。
 */
function damage(over: Partial<DamageEvent> = {}): DamageEvent {
  return {
    kind: 'damage',
    tick: 10,
    sourceId: 'player',
    targetId: 'meiichiro',
    amount: 12,
    crit: false,
    school: 'physical',
    absorbed: 0,
    overkill: 0,
    ...over,
  };
}

describe('LogFormatter：事件 → 条目', () => {
  it('转义后的条目只含 key + 参数，**不含文案**（i18n 规范 I1）', () => {
    const f = new LogFormatter();
    f.consume([damage()]);
    const [entry] = f.all();
    expect(entry).toBeDefined();
    expect(entry!.key).toBe('log.damage');
    expect(entry!.params).toEqual({ amount: 12 });
    // 整条里不能出现任何中文 —— 文案在 i18n 里，不在数据里
    expect(JSON.stringify(entry)).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('区分"我打出去"和"我挨打"', () => {
    const f = new LogFormatter();
    f.consume([
      damage({ targetId: 'meiichiro' }),
      damage({ targetId: 'player', sourceId: 'meiichiro' }),
    ]);
    expect(f.all()[0]!.category).toBe('deal');
    expect(f.all()[0]!.key).toBe('log.damage');
    expect(f.all()[1]!.category).toBe('take');
    expect(f.all()[1]!.key).toBe('log.takeDamage');
  });

  it('id 单调自增（渲染层靠它判断"这是新的一条"）', () => {
    const f = new LogFormatter();
    f.consume([damage(), damage()]);
    const ids = f.all().map((e) => e.id);
    expect(ids).toEqual([1, 2]);
  });

  it('【关键】噪声事件**不进日志**', () => {
    /**
     * 引擎每秒会发大量 `resourceChanged`（回炁）、`buffApplied`
     * （判定窗口每层都发）。如果照单全收，日志会被瞬间刷满，
     * 真正重要的信息（打断、挨打）被冲走。
     *
     * 这条断言的是**分层的价值**：过滤发生在格式化层，
     * 渲染层永远看不到这些噪声。
     */
    const f = new LogFormatter();
    f.consume([
      { kind: 'resourceChanged', tick: 1, targetId: 'player', resource: 'energy', delta: 1, current: 1 },
      { kind: 'buffApplied', tick: 2, targetId: 'player', buffId: 'x', stacks: 1, sourceId: 'player' },
      { kind: 'buffExpired', tick: 3, targetId: 'player', buffId: 'x', stacks: 0, sourceId: 'player' },
      { kind: 'castFinished', tick: 4, sourceId: 'player', skillId: 'attack' },
    ]);
    expect(f.all()).toEqual([]);
  });

  it('读条只记"开始"，不记"完成"（成对事件只留一条）', () => {
    const f = new LogFormatter();
    f.consume([{ kind: 'castStarted', tick: 1, sourceId: 'player', skillId: 'attack' }]);
    expect(f.all()).toHaveLength(1);
    expect(f.all()[0]!.key).toBe('log.castStarted');
  });

  it('打断相关事件都记下（这是战斗里最需要复盘的信息之一）', () => {
    const f = new LogFormatter();
    f.consume([
      { kind: 'castInterrupted', tick: 1, sourceId: 'meiichiro', skillId: 'boss-cleave', reason: 'interrupted' },
      { kind: 'interruptSuccess', tick: 1, sourceId: 'player', targetId: 'meiichiro', skillId: 'boss-cleave' },
      { kind: 'interruptImmune', tick: 2, targetId: 'meiichiro', skillId: 'boss-armor' },
    ]);
    expect(f.all().map((e) => e.category)).toEqual(['interrupt', 'interrupt', 'interrupt']);
    expect(f.all().map((e) => e.key)).toEqual([
      'log.castInterrupted',
      'log.interruptSuccess',
      'log.interruptImmune',
    ]);
  });

  it('闪躲记为 avoid —— 与"未命中"用不同的 key', () => {
    const f = new LogFormatter();
    f.consume([
      { kind: 'avoided', tick: 1, sourceId: 'meiichiro', targetId: 'player', skillId: 'boss-cleave', reason: 'immune' },
      { kind: 'avoided', tick: 2, sourceId: 'meiichiro', targetId: 'player', skillId: 'boss-cleave', reason: 'dodged' },
    ]);
    expect(f.all()[0]!.key).toBe('log.avoided');
    expect(f.all()[1]!.key).toBe('log.missed');
  });

  it('按 limit 截断最旧的（内存不会无限增长）', () => {
    const f = new LogFormatter({ limit: 3 });
    for (let i = 0; i < 10; i += 1) f.consume([damage({ tick: i })]);
    expect(f.all()).toHaveLength(3);
    // 留下的是**最后**三条
    expect(f.all().map((e) => e.tick)).toEqual([7, 8, 9]);
  });

  it('clear 清空并重置 id（重开一局）', () => {
    const f = new LogFormatter();
    f.consume([damage()]);
    f.clear();
    expect(f.all()).toEqual([]);
    f.consume([damage()]);
    expect(f.all()[0]!.id).toBe(1);
  });
});

describe('日志文案与布局', () => {
  it('格式化层产生的每个 key 都有文案', () => {
    const f = new LogFormatter();
    f.consume([
      damage(),
      damage({ targetId: 'player', sourceId: 'meiichiro' }),
      { kind: 'avoided', tick: 1, sourceId: 'meiichiro', targetId: 'player', skillId: 'boss-cleave', reason: 'immune' },
      { kind: 'avoided', tick: 2, sourceId: 'meiichiro', targetId: 'player', skillId: 'boss-cleave', reason: 'dodged' },
      { kind: 'castStarted', tick: 3, sourceId: 'player', skillId: 'attack' },
      { kind: 'castInterrupted', tick: 4, sourceId: 'x', skillId: 'y', reason: 'replaced' },
      { kind: 'interruptSuccess', tick: 5, sourceId: 'player', targetId: 'boss', skillId: 'z' },
      { kind: 'interruptImmune', tick: 6, targetId: 'boss', skillId: 'z' },
      { kind: 'skillRejected', tick: 7, sourceId: 'player', skillId: 'z', reason: 'cost' },
      { kind: 'heal', tick: 8, sourceId: 'player', targetId: 'player', amount: 5, crit: false, overheal: 0 },
      { kind: 'encounterEnd', tick: 9, result: 'victory', reason: 'hpZero' },
    ]);
    const keys = new Set(f.all().map((e) => e.key));
    expect(keys.size).toBeGreaterThan(8);
    for (const key of keys) {
      // 缺 key 会抛错 —— 这就是断言
      expect(() => translator.t(key as never)).not.toThrow();
      expect(translator.t(key as never)).not.toBe('');
    }
  });

  it('带占位符的文案参数齐全（不会渲染出 {amount}）', () => {
    const f = new LogFormatter();
    f.consume([damage({ amount: 42 })]);
    const entry = f.all()[0]!;
    const text = translator.t(entry.key as never, entry.params as never);
    expect(text).toContain('42');
    expect(text).not.toContain('{');
  });

  it('面板在画布右侧、不越界、也不压技能栏', () => {
    /**
     * 需求："不要显示在屏幕正中，在屏幕右侧"。
     */
    expect(LAYOUT.log.x + LAYOUT.log.w).toBeLessThanOrEqual(LOGICAL.width);
    // 明显在右半边
    expect(LAYOUT.log.x).toBeGreaterThan(LOGICAL.width / 2);
    // 不与技能栏（y 492 起）或顶栏重叠
    expect(LAYOUT.log.y + LAYOUT.log.h).toBeLessThanOrEqual(LAYOUT.skillBar.y);
    expect(LAYOUT.log.y).toBeGreaterThan(LAYOUT.castBar.y + LAYOUT.castBar.h);
  });

  it('面板高度放得下要显示的行数', () => {
    const { LINE_H, LINE_GAP, VISIBLE_LINES } = LOG_PANEL_METRICS;
    const needed = 24 /* 标题 + 内边距 */ + VISIBLE_LINES * (LINE_H + LINE_GAP);
    expect(LAYOUT.log.h).toBeGreaterThanOrEqual(needed);
  });
});

describe('UI 缩放（设置 · 通用页的 slider）', () => {
  /**
   * 需求："设置的通用里，加一个 UI 缩放的 slide，可以调整所有 UI 的比例"
   *
   * 缩放是"乘在自动适配之上的额外倍数"，所以 120% 在任意窗口下
   * 都是"比自动适配再大 20%"，语义与窗口尺寸无关。
   */
  it('倍数被钳到合法范围并对齐步长（浮点尾数不渗进布局）', () => {
    expect(clampUiScale(0.1)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(99)).toBe(UI_SCALE_MAX);
    expect(clampUiScale(Number.NaN)).toBe(1);
    // 步长对齐：1.234 → 1.2（不是 1.234 原样透传）
    expect(clampUiScale(1.234)).toBeCloseTo(1.2, 10);
    // 浮点尾数不渗进布局：结果 × 10 应该是个整数
    for (const v of [0.1 + 0.2, 1.7, 1.3000000000000003]) {
      expect(Math.round(clampUiScale(v) * 10)).toBeCloseTo(clampUiScale(v) * 10, 10);
    }
  });

  it('倍数乘在自动适配之上', () => {
    const base = computeScale(1920, 1080, 'fit');
    expect(computeScale(1920, 1080, 'fit', 1.5)).toBeCloseTo(base * 1.5, 10);
    // 非有限输入不能让画布变成 NaN 宽
    expect(computeCanvasCssSize(1920, 1080, 'fit', 1.5).width).toBe(
      Math.round(LOGICAL.width * base * 1.5),
    );
  });

  it('slider 的矩形在弹窗内、且在 tab 行下方', () => {
    const rect = uiScaleSliderRect();
    expect(rect.x).toBeGreaterThanOrEqual(SETTINGS_PANEL.x);
    expect(rect.x + rect.w).toBeLessThanOrEqual(SETTINGS_PANEL.x + SETTINGS_PANEL.w);
    expect(rect.y).toBeGreaterThan(SETTINGS_PANEL.y);
    expect(rect.y + rect.h).toBeLessThanOrEqual(SETTINGS_PANEL.y + SETTINGS_PANEL.h);
  });

  it('通用页的焦点顺序是 tabs → slider → reset（Tab 能走完）', () => {
    // 通用页：没有技能格、有 slider
    let focus = cycleZone({ zone: 'tabs', index: 0 }, 0, false, true);
    expect(focus.zone).toBe('slider');
    focus = cycleZone(focus, 0, false, true);
    expect(focus.zone).toBe('reset');
    // 再 Tab 回到 tabs
    expect(cycleZone(focus, 0, false, true).zone).toBe('tabs');
    // 按键页没有 slider，Tab 顺序里不应出现它
    let keysFocus = cycleZone({ zone: 'tabs', index: 0 }, 6, false, false);
    expect(keysFocus.zone).toBe('grid');
    keysFocus = cycleZone(keysFocus, 6, false, false);
    expect(keysFocus.zone).toBe('reset');
  });

  it('通用页里从上往下走是 tabs → slider → reset', () => {
    const toSlider = moveFocus({ zone: 'tabs', index: 0 }, 'down', 0, true, false);
    expect(toSlider.zone).toBe('slider');
    const toReset = moveFocus(toSlider, 'down', 0, true, false);
    expect(toReset.zone).toBe('reset');
    // slider 的左右**不移动焦点**（调用方拿它们当调值键）——
    // 模型这一层把左右都当作"回到 tabs"
    expect(moveFocus(toSlider, 'up', 0, true, false).zone).toBe('tabs');
  });
});

describe('能力结算时刻：castStart 与 castFinish', () => {
  /**
   * 需求："重斩加上霸体标签和霸体效果"
   *
   * ⚠️ 这个需求逼出了一个新的能力时刻 `on: 'castStart'`。
   *
   * 原先 skills 的 abilities **只在读条完成时**结算。而霸体的意义是
   * "整个前摇打不断" —— 如果它跟其它能力一样在完成时才挂上，
   * 前摇期间照样能被「破」打断（实测确认过：重斩读条 216 tick，
   * 带霸体 0 tick，3 次「破」全部成功）。
   */
  it('重斩的霸体标了 castStart —— 否则前摇期间不免疫', () => {
    const cleave = ALL_SKILLS.find((s) => s.id === 'boss-cleave');
    expect(cleave).toBeDefined();
    const armorGrant = cleave!.abilities.find(
      (a) => a.kind === 'grant' && a.buff.id === 'boss-cleave-armor',
    );
    expect(armorGrant, '重斩应该有霸体 grant').toBeDefined();
    expect(armorGrant!.kind === 'grant' && armorGrant!.on).toBe('castStart');
  });

  it('霸体时长 == 重斩前摇（读条走完就消失，不会溢出到下一招）', () => {
    const cleave = ALL_SKILLS.find((s) => s.id === 'boss-cleave')!;
    const armor = ALL_BUFFS.find((b) => b.id === 'boss-cleave-armor');
    expect(armor).toBeDefined();
    expect(armor!.flags?.interruptImmune).toBe(true);
    expect(armor!.duration).toBe(cleave.castTime);
  });

  it('重斩的提示标签同时有「高伤」和「霸体」', () => {
    const cleave = ALL_SKILLS.find((s) => s.id === 'boss-cleave')!;
    expect([...(cleave.hintTags ?? [])].sort()).toEqual(['highDamage', 'interruptImmune']);
  });

  it('读条完成时**不会**再结算一次 castStart 的能力', async () => {
    /**
     * 如果在完成时再算一次，霸体会被刷新成"从完成时刻起算"，
     * 于是它溢出到下一招 —— 那正好破坏"整个前摇免疫"的语义，
     * 而且会让「破」在一段时间内莫名其妙失效。
     */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/core/combat/battleState.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(ability\.kind === 'grant' && ability\.on === 'castStart'\) continue;/);
  });

  it('起手时确实有一条结算路径，且放在 castStarted 事件之后', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/core/combat/battleState.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/private applyCastStartAbilities\(/);
    // 顺序：先发 castStarted，再结算 —— 事件流读起来是"开始了 → 因此获得霸体"
    const idx = src.indexOf("kind: 'castStarted'");
    const callIdx = src.indexOf('this.applyCastStartAbilities(');
    expect(idx).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(idx);
  });
});
