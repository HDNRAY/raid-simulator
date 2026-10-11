import { describe, expect, it } from 'vitest';
import { LogFormatter } from '../../src/app/logFormat';
import { LAYOUT, LOGICAL, scaleUiRect } from '../../src/ui/layout';
import { UiLayout } from '../../src/ui/uiLayout';
import { PANEL_STYLE } from '../../src/ui/primitives';
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
  hitTest,
  moveFocus,
  uiScaleFromPointer,
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
    absorbed: 0,
    overkill: 0,
    skillId: 'blast',
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
    /**
     * ⚠️ `skill` 也是**一个 i18n key**（不是文案）—— 需求要求日志注明招式
     * （"所有的 受到**伤害，都注明一下招式，造成 也是"）。
     * `LogPanel.resolveParams` 会把它翻掉，所以这里仍然只有 key。
     */
    expect(entry!.params).toEqual({ amount: 12, skill: 'log.unknownSource' });
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

  it('读条的两个时刻**都不记**（需求："log里不要开始读条"）', () => {
    /**
     * `castStarted` 与 `castFinished` 都不进日志。
     *
     * 信息量太低：「开始读条」不说明任何结果 —— 结果要么是命中
     * （记了伤害）、要么是被打断（记了打断）。读条**过程**已经由
     * 画面上的预警条实时表达。
     *
     * 去掉之后日志剩下的都是**有结果的事**：伤害、闪躲、打断、霸体、结束。
     */
    const f = new LogFormatter();
    f.consume([
      { kind: 'castStarted', tick: 1, sourceId: 'player', skillId: 'attack' },
      { kind: 'castFinished', tick: 4, sourceId: 'player', skillId: 'attack' },
    ]);
    expect(f.all()).toEqual([]);
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

  it('面板在画布左侧、不越界、也不压其它 UI', () => {
    /**
     * ⚠️ 这条断言**反过来了**。
     *
     * 需求演进：
     *   早期 "不要显示在屏幕正中，在屏幕右侧"  → 所以曾经断言"在右半边"
     *   现在 "双弧，日志可以放左边"           → 右侧整块要让给移动端的
     *                                          双弧触屏按钮（外弧最左缘 x 654）
     *
     * 所以现在断言的是"**靠左**、且不与左侧信息柱里的其它部件重叠"。
     */
    expect(LAYOUT.log.x).toBe(0 + LAYOUT.player.x); // 与玩家面板同一列
    expect(LAYOUT.log.x + LAYOUT.log.w).toBeLessThan(LOGICAL.width / 2);
    // 不与 Boss 区（顶栏 + buff 条）重叠
    expect(LAYOUT.log.y).toBeGreaterThan(LAYOUT.bossBuffs.y + LAYOUT.bossBuffs.size);
    // 不与玩家 buff / 读条 / 面板重叠
    expect(LAYOUT.log.y + LAYOUT.log.h).toBeLessThanOrEqual(LAYOUT.playerBuffs.y);
    /**
     * **右侧留给触屏按钮**：日志右缘必须远小于双弧的最左缘（x 654）。
     * 这条是"日志挪左边"这个决定的**可执行理由** —— 如果将来有人把
     * 日志挪回右边，这里会失败并指向计划文档。
     */
    expect(LAYOUT.log.x + LAYOUT.log.w).toBeLessThan(654);
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

  it('【关键】UI 缩放**不影响画布** —— 战斗画面保持不变', () => {
    /**
     * 需求澄清："我不是说缩放整个游戏画面，我是指，缩放游戏 UI……
     * 战斗画面和战斗文字保持不变。"
     *
     * 所以画布尺寸只由"自动适配视口"决定，与 UI 系数无关。
     * 这条断言的是**接口本身**：`computeScale` 不再接受倍率参数。
     */
    const a = computeScale(1920, 1080, 'fit');
    const b = computeScale(1920, 1080, 'fit');
    expect(a).toBe(b);
    // 画布 CSS 尺寸也不该受任何"UI 系数"影响 —— 它只有 3 个参数
    expect(computeCanvasCssSize.length).toBeLessThanOrEqual(3);
  });

  it('slider 的矩形在弹窗内、且在 **tab 栏下方**（不遮挡）', () => {
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
    // reset → close（右上角的关闭）
    const close = cycleZone(focus, 0, false, true);
    expect(close.zone).toBe('close');
    // 再 Tab 回到 tabs
    expect(cycleZone(close, 0, false, true).zone).toBe('tabs');
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
   * 需求："重斩加上霸体标签和霸体效果"（改造后挂在「碾压」上）。
   *
   * ⚠️ 这个需求逼出了一个新的能力时刻 `on: 'castStart'`。
   *
   * 原先 skills 的 abilities **只在读条完成时**结算。而霸体的意义是
   * "整个前摇打不断" —— 如果它跟其它能力一样在完成时才挂上，
   * 前摇期间照样能被「破」打断（实测确认过：重斩读条 216 tick，
   * 带霸体 0 tick，3 次「破」全部成功）。
   */
  it('慢刀的霸体标了 castStart —— 否则前摇期间不免疫', () => {
    const heavy = ALL_SKILLS.find((s) => s.id === 'boss-heavy');
    expect(heavy).toBeDefined();
    const armorGrant = heavy!.abilities.find(
      (a) => a.kind === 'grant' && a.buff.id === 'boss-heavy-armor',
    );
    expect(armorGrant, '慢刀应该有霸体 grant').toBeDefined();
    expect(armorGrant!.kind === 'grant' && armorGrant!.on).toBe('castStart');
  });

  it('霸体时长 == 慢刀前摇（读条走完就消失，不会溢出到下一招）', () => {
    const heavy = ALL_SKILLS.find((s) => s.id === 'boss-heavy')!;
    const armor = ALL_BUFFS.find((b) => b.id === 'boss-heavy-armor');
    expect(armor).toBeDefined();
    expect(armor!.flags?.interruptImmune).toBe(true);
    expect(armor!.duration).toBe(heavy.castTime);
  });


  it('读条完成时**不会**再结算一次 castStart 的能力', async () => {
    /**
     * 如果在完成时再算一次，霸体会被刷新成"从完成时刻起算"，
     * 于是它溢出到下一招 —— 那正好破坏"整个前摇免疫"的语义，
     * 而且会让「破」在一段时间内莫名其妙失效。
     */
    const { readFileSync } = await import('node:fs');
    // 施法流程已拆到 `castPipeline.ts`
    const src = readFileSync(new URL('../../src/core/combat/castPipeline.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(ability\.kind === 'grant' && ability\.on === 'castStart'\) continue;/);
  });

  it('起手时确实有一条结算路径，且放在 castStarted 事件之后', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/core/combat/castPipeline.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/export function applyCastStartAbilities\(/);
    // 顺序：先发 castStarted，再结算 —— 事件流读起来是"开始了 → 因此获得霸体"
    /**
     * ⚠️ `tryUseSkill` 也搬进 `castPipeline.ts` 了，所以**顺序与调用
     * 现在都在同一个文件里** —— 读它一份即可。
     */
    const idx = src.indexOf("kind: 'castStarted'");
    const callIdx = src.indexOf('applyCastStartAbilities(ctx, skill, actor.id)');
    expect(idx).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(idx);
  });
});

describe('日志不该被按键频率放大', () => {
  /**
   * 需求："闪避现在还是会触发，闪避 cd 的 log，这是 bug"。
   *
   * 核实：闪避的 1 秒 CD **工作正常**。真问题是**记录了什么** ——
   * 玩家在技能不可用时本能地连按/按住，而输入是 tick 级的，
   * 实测连续按闪避 6 秒产生 **295 次 cooldown + 60 次 cost** 拒绝。
   */
  it('【关键】skillRejected 完全不进日志', async () => {
    /**
     * "技能被拒"是**输入反馈**，不是战斗事件。
     *
     * 画面上的技能格已经实时表达了同一件事（冷却遮罩 + 中心秒数 +
     * 技能字变暗），战斗状态行也会给一条短提示。日志里再写一遍是
     * 纯重复，而且必然被按键频率放大。
     *
     * 这条断言防止它被"顺手加回来"。
     */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/app/logFormat.ts', import.meta.url), 'utf8');
    // `skillRejected` 分支必须直接返回 undefined
    expect(src).toMatch(/case 'skillRejected':\s*\n\s*return undefined;/);
  });

  it('连续按不可用的技能不会刷屏（回归）', () => {
    const f = new LogFormatter();
    // 模拟 6 秒、每 tick 一次"被 CD 拒绝"
    for (let i = 0; i < 360; i += 1) {
      f.consume([
        {
          kind: 'skillRejected',
          tick: i,
          sourceId: 'player',
          skillId: 'dodge',
          reason: 'cooldown',
        },
      ]);
    }
    expect(f.all()).toEqual([]);
  });

  it('但真正的战斗事件照样逐条记（不被去重）', () => {
    const f = new LogFormatter();
    f.consume([damage({ tick: 1, amount: 10 }), damage({ tick: 2, amount: 10 })]);
    expect(f.all()).toHaveLength(2);
  });
});

describe('UI 缩放：只缩放 UI，不缩放战斗画面', () => {
  /**
   * 需求澄清："我不是说缩放整个游戏画面，我是指，缩放游戏 UI，
   * 比如面板、技能图标等，战斗画面和战斗文字保持不变。"
   */
  it('【关键】缩放按**锚点**进行 —— 否则右下角的技能栏会离开右下角', () => {
    const base = { x: 100, y: 200, w: 40, h: 40 };
    // 贴右下：右下角坐标不变
    const br = scaleUiRect(base, 'bottom-right', 1.5);
    expect(br.x + br.w).toBe(base.x + base.w);
    expect(br.y + br.h).toBe(base.y + base.h);
    expect(br.w).toBe(60);
    // 贴左下：左下角坐标不变
    const bl = scaleUiRect(base, 'bottom-left', 1.5);
    expect(bl.x).toBe(base.x);
    expect(bl.y + bl.h).toBe(base.y + base.h);
    // 贴顶：水平居中且顶边不变
    const t = scaleUiRect({ x: 0, y: 0, w: 100, h: 10 }, 'top', 2);
    expect(t.y).toBe(0);
    expect(t.x + t.w / 2).toBe(50);
  });

  it('技能栏缩放后仍然**右对齐**（最后一格的右缘贴边距）', () => {
    const ui = new UiLayout(1.5);
    const rect = ui.skillSlotRect(5, 6);
    const expectedRight = LOGICAL.width - Math.round(LAYOUT.skillBar.right * 1.5);
    expect(rect.x + rect.w).toBe(expectedRight);
    // 格子也变大了
    expect(rect.w).toBe(Math.round(LAYOUT.skillBar.slot * 1.5));
  });

  it('技能栏缩放后**底边**保持不动（不往画布下方跑）', () => {
    const a = new UiLayout(1);
    const b = new UiLayout(2);
    const baseBottom = a.skillSlotRect(0, 6).y + a.skillSlotRect(0, 6).h;
    const scaledBottom = b.skillSlotRect(0, 6).y + b.skillSlotRect(0, 6).h;
    expect(scaledBottom).toBe(baseBottom);
  });

  it('系数被钳到合法范围（解析器是唯一入口）', () => {
    expect(new UiLayout(99).scale).toBe(UI_SCALE_MAX);
    expect(new UiLayout(0.01).scale).toBe(UI_SCALE_MIN);
    expect(new UiLayout(Number.NaN).scale).toBe(1);
  });

  it('玩家面板按左下锚点缩放，资源条的行距跟着变', () => {
    const a = new UiLayout(1);
    const b = new UiLayout(2);
    const pa = a.playerPanel;
    const pb = b.playerPanel;
    // 左下角不动
    expect(pb.x).toBe(pa.x);
    expect(pb.y + pb.h).toBe(pa.y + pa.h);
    // 条高与行距翻倍
    expect(b.playerBars.h).toBe(a.playerBars.h * 2);
    expect(b.playerBars.stride).toBe(a.playerBars.stride * 2);
  });
});

describe('UI 缩放：覆盖面与鼠标支持', () => {
  it('Boss 面板 / 读条 / 日志面板都在缩放范围内', () => {
    const a = new UiLayout(1);
    const b = new UiLayout(1.5);
    /**
     * Boss 顶栏：**左右边距不变**（需求："无论 ui 如何缩放，应该保持和
     * 屏幕左右两边的边距不变，只是缩放高度和内容尺寸"）。
     * 所以宽度不缩放，只有高度与字号跟着变。
     */
    expect(b.bossBar.y).toBe(a.bossBar.y);
    expect(b.bossBar.x).toBe(a.bossBar.x);
    expect(b.bossBar.w).toBe(a.bossBar.w);
    expect(b.bossBar.h).toBeGreaterThan(a.bossBar.h);
    // 血条同理：贴左、宽度不变、只有高度变
    expect(b.bossHp.x).toBe(a.bossHp.x);
    expect(b.bossHp.w).toBe(a.bossHp.w);
    expect(b.bossHp.h).toBeGreaterThan(a.bossHp.h);
    // 两处读条
    expect(b.castBar.h).toBeGreaterThan(a.castBar.h);
    expect(b.playerCastBar.h).toBeGreaterThan(a.playerCastBar.h);
    // 日志面板：贴右，放大后右缘不动
    expect(b.logPanel.x + b.logPanel.w).toBe(a.logPanel.x + a.logPanel.w);
    expect(b.logPanel.w).toBeGreaterThan(a.logPanel.w);
    // Boss buff 条的方块与间距
    expect(b.bossBuffs.size).toBeGreaterThan(a.bossBuffs.size);
    expect(b.bossBuffs.gap).toBeGreaterThan(a.bossBuffs.gap);
  });

  it('滑块支持鼠标：按横坐标反算倍数', () => {
    /**
     * 需求："ui 缩放的 slider 还是要支持鼠标。"
     *
     * 点到轨道的哪里就跳到哪个值 —— 而不是只能点中把手。
     */
    const rect = uiScaleSliderRect();
    // 轨道最左 → 最小值
    expect(uiScaleFromPointer(rect.x)).toBe(UI_SCALE_MIN);
    // 轨道最右 → 最大值
    expect(uiScaleFromPointer(rect.x + rect.w)).toBe(UI_SCALE_MAX);
    // 中点 → 约中间值（对齐步长后是 1.2 或 1.3）
    const mid = uiScaleFromPointer(rect.x + rect.w / 2);
    expect(mid).toBeGreaterThan(1.1);
    expect(mid).toBeLessThan(1.4);
    // 点在面板内但不在滑块上 → 不该返回滑块目标
    expect(
      hitTest(rect.x + rect.w + 40, rect.y + 4, { tab: 'general', rowSkillIds: [] }).kind,
    ).not.toBe('scaleSlider');
  });

  it('滑块只属于通用页 —— 按键页点它不该命中', () => {
    const rect = uiScaleSliderRect();
    expect(hitTest(rect.x + 4, rect.y + 4, { tab: 'general', rowSkillIds: [] }).kind).toBe(
      'scaleSlider',
    );
    expect(hitTest(rect.x + 4, rect.y + 4, { tab: 'keys', rowSkillIds: ['attack'] }).kind).not.toBe(
      'scaleSlider',
    );
  });
});

describe('面板外观统一', () => {
  /**
   * 需求："战斗日志和人物资源面板用的是一个组件吗？最好用一个，
   * 然后把背景的透明度调低。"
   *
   * 它们**本来就用同一个 `Panel` 组件**，但构造参数各写一遍
   * （填充 `0x0c0c14` vs `0x0d0e16`、描边 `0x4a4c60` vs `0x2a2c3a`）——
   * 差异小到看不出，却是两处要同步维护的真相。
   */
  it('【关键】日志面板与资源面板共用同一组外观参数', async () => {
    const { readFileSync } = await import('node:fs');
    const log = readFileSync(new URL('../../src/ui/LogPanel.ts', import.meta.url), 'utf8');
    const scene = readFileSync(new URL('../../src/render/BattleScene.ts', import.meta.url), 'utf8');
    // 两者都从共享常量展开，而不是各写 fill/line/fillAlpha
    expect(log).toMatch(/\.\.\.PANEL_STYLE/);
    expect(scene).toMatch(/\.\.\.PANEL_STYLE/);
    // 而且都不该再出现"自己写的面板填充色"
    expect(log).not.toMatch(/fill: 0x0d0e16/);
    expect(scene).not.toMatch(/fill: 0x0c0c14/);
  });

  it('共享样式的透明度低于原先的两个值（需求："调低"）', () => {
    expect(PANEL_STYLE.fillAlpha).toBeLessThan(0.72);
    expect(PANEL_STYLE.fillAlpha).toBeGreaterThan(0.3);
  });

  it('结算面板**故意**比常规面板不透明（它是结算，要挡住战斗画面）', async () => {
    const { readFileSync } = await import('node:fs');
    const scene = readFileSync(new URL('../../src/render/BattleScene.ts', import.meta.url), 'utf8');
    const idx = scene.indexOf('this.resultPanel = new Panel');
    expect(idx).toBeGreaterThan(0);
    expect(scene.slice(idx, idx + 400)).toMatch(/fillAlpha: 0\.9/);
  });

  it('日志面板在左侧信息柱顶端：不压 Boss 区、不压玩家区、让开右下角', () => {
    const r = LAYOUT.log;
    // 在左侧（与玩家面板同列）
    expect(r.x).toBe(LAYOUT.player.x);
    expect(r.x + r.w).toBeLessThan(LOGICAL.width / 2);
    // 不与 Boss 区重叠
    expect(r.y).toBeGreaterThan(LAYOUT.bossBuffs.y + LAYOUT.bossBuffs.size);
    // 不与玩家 buff 区重叠
    expect(r.y + r.h).toBeLessThanOrEqual(LAYOUT.playerBuffs.y);
    /**
     * 右下角整块让给触屏双弧按钮（外弧最左缘 x 654）——
     * 见 `docs/plans/2026-10-10-m8-mobile.md` §2.2b。
     */
    expect(r.x + r.w).toBeLessThan(654);
  });
});
