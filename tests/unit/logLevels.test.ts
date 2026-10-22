import { describe, expect, it } from 'vitest';
import { LogFormatter } from '../../src/app/logFormat';

/**
 * ==================================================================
 * 日志的**分量**与**新增事件**（需求："增强log，信息尽可能多些"）
 * ==================================================================
 *
 * 这一组原先塞在 `log.test.ts` 里，把那个文件顶到 702 行、超过 `AGENTS.md`
 * §3 的上限。按那里的规则（**不许靠删/压注释解决，要拆 util 或横向切割**）
 * 切出来 —— 而且"记什么、算哪一层"本来就和"事件怎么转成条目"可以分开读。
 *
 * 背景（用户原话）：
 *   "比如boss的什么能力，造成的反伤之类的，boss二阶段了，发生了什么事情，
 *    一局结束 也显示完整log，玩家好复盘"
 *
 * 所以这一组的主题是两件事：
 *   1. **该记的都要记**（出招、反伤、阶段 buff、死亡、狂暴）
 *   2. **但不是所有条目都塞进战斗中那个三条的小面板** ——
 *      靠 `level` 分流：`major` 进面板，`minor` 只进战报
 */

describe('日志的分量与新增事件', () => {
  it('⚠️ 闪避是 major（玩家会想知道自己躲掉了），免疫是 minor', () => {
    const f = new LogFormatter();
    f.consume([
      { kind: 'avoided', tick: 1, sourceId: 'm', targetId: 'player', skillId: 's', reason: 'dodged' },
      { kind: 'avoided', tick: 2, sourceId: 'm', targetId: 'player', skillId: 's', reason: 'immune' },
    ]);
    expect(f.all()[0]!.level).toBe('major');
    expect(f.all()[1]!.level).toBe('minor');
  });

  it('【需求】Boss 出招记为 major —— "boss 的什么能力"', () => {
    const f = new LogFormatter({
      skillNameKeys: new Map([['boss-heavy', 'boss.heavy.name']]),
    });
    f.consume([
      { kind: 'skillUsed', tick: 1, sourceId: 'meiichiro', skillId: 'boss-heavy' },
      { kind: 'skillUsed', tick: 2, sourceId: 'player', skillId: 'attack' },
    ]);
    const [boss, player] = f.all();
    expect(boss!.level, 'Boss 出招必须进实时面板').toBe('major');
    expect(boss!.params?.skill).toBe('boss.heavy.name');
    expect(player!.level, '玩家自己按的不必占面板').toBe('minor');
  });

  it('【需求】"二阶段了" —— 值得记的 buff 才进日志，且由调用方筛', () => {
    const notable = new Set(['boss-heavy-armor', 'knockdown']);
    const f = new LogFormatter({ notableBuffIds: notable });
    f.consume([
      { kind: 'buffApplied', tick: 1, targetId: 'meiichiro', buffId: 'boss-heavy-armor', stacks: 1, sourceId: 'meiichiro' },
      { kind: 'buffExpired', tick: 2, targetId: 'meiichiro', buffId: 'boss-heavy-armor', stacks: 0, sourceId: 'meiichiro' },
      { kind: 'buffApplied', tick: 3, targetId: 'player', buffId: 'some-noise-buff', stacks: 1, sourceId: 'player' },
    ]);
    /** 不重要的 buff 一条都不记 —— 否则日志会被印记层数刷爆。 */
    expect(f.all()).toHaveLength(2);
    expect(f.all()[0]!.key).toBe('log.buffApplied');
    expect(f.all()[0]!.level, '上 buff 要立刻知道').toBe('major');
    expect(f.all()[1]!.level, 'buff 结束晚点知道没关系').toBe('minor');
  });

  it('【需求】反伤单独成条，且属性对调（打出去的人自己挨了）', () => {
    const f = new LogFormatter();
    f.consume([
      { kind: 'damage', tick: 1, sourceId: 'player', targetId: 'meiichiro', amount: 12, skillId: 'attack', crit: false, absorbed: 0, thinned: 0, overkill: 0, reflect: true },
    ]);
    const [e] = f.all();
    /**
     * ⚠️ 2026-10-22：**没有来源 buff** 的反伤走 `log.reflectShort`
     * （"受到 N 点反伤"，不提来源）—— 原先这里写的是 `log.reflect`，
     * 而那会把 `skillId: ''` 查成「未知来源」✗（用户实测报的就是那条）。
     */
    expect(e!.key).toBe('log.reflectShort');
    expect(e!.params?.actor).toBeDefined();
    expect(e!.params?.amount).toBe(12);
    /** ⚠️ 反伤没有 `{target}` —— 挨打的就是出招的人。 */
    expect(e!.params?.target).toBeUndefined();
  });

  it('【需求】死亡与狂暴都进日志', () => {
    const f = new LogFormatter();
    f.consume([
      { kind: 'death', tick: 1, targetId: 'player' },
      { kind: 'enrageStarted', tick: 2, bossId: 'meiichiro' },
    ]);
    expect(f.all().map((e) => e.key)).toEqual(['log.death', 'log.enrage']);
    expect(f.all().every((e) => e.level === 'major')).toBe(true);
  });

  it('【需求】默认不截断 —— 一局打完要能复盘整场', () => {
    /**
     * ⚠️ 默认上限从 **60 改成 5000**。60 条打满 95 秒的傲慢根本不够，
     * 复盘时看到的是被砍掉开头的残卷 ✗
     *
     * 这里造 200 条（远超旧的 60）并断言一条都没丢。
     */
    const f = new LogFormatter();
    /** 造一条最小的伤害事件（不依赖 `log.test.ts` 的辅助函数）。 */
    const hit = (tick: number) => ({
      kind: 'damage' as const,
      tick,
      sourceId: 'player',
      targetId: 'meiichiro',
      amount: 1,
      skillId: 'attack',
      crit: false,
      absorbed: 0,
      thinned: 0,
      overkill: 0,
    });
    for (let i = 0; i < 200; i += 1) f.consume([hit(i)]);
    expect(f.all()).toHaveLength(200);
    expect(f.all()[0]!.tick).toBe(0);
  });
});
