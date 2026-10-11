import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { PRIDE_BEHAVIORS } from '../../src/data/bossPride';
import { registry } from './fixtures';
import { makeGoldenEngineOptions } from './fixtures';

/**
 * 「傲慢」的**霸体**机制：唯一挡得住打断的东西。
 *
 * ==================================================================
 * 为什么从 `encounter.test.ts` 里分出来
 * ==================================================================
 *
 * 那个文件本来就贴着 AGENTS.md §3 的 700 行上限（698 行）。改造「傲慢」
 * 时霸体从"一个独立技能"变成"慢刀自带的属性"（设计 §5.2/§5.4），
 * 这组测试必须整段重写 —— 于是按**职责**横向切出本文件：
 *
 *   encounter.test.ts   Boss 的常规机制（施法 / 读条 / 伤害 / 结算 / 招式本身）
 *   bossArmor.test.ts   **打断与霸体**这一条单独的对抗线（玩家「破」 vs Boss）
 *
 * 这样切是因为霸体的断言天然是"两边对着看"的（同一个「破」在 40 与 60
 * 上必须给出相反结论），它和"Boss 会不会读条"不是同一类问题。
 */
describe('Boss 霸体：唯一挡得住打断的东西', () => {
  it('【核心】霸体期间「破」打不断 Boss —— 连强制打断也挡', () => {
    /**
     * 用一个**不还手**的 Boss，这样能干净地控制它读什么。
     *
     * ⚠️ 改造后霸体**不是一个独立技能**（设计 §5.4）：它是「碾压」起手
     * 自带的属性。所以这条测试不再"先放霸体、再读条"，而是在
     * 「碾压」**自己的前摇**里被打断 —— 那才是这条机制真正要守的场景。
     */
    const base = makeGoldenEngineOptions();
    const e = new BattleEngine({
      ...base,
      combatants: [base.combatants[0]!, { ...base.combatants[1]!, behaviors: [] }],
    });
    e.tick();
    e.drainEvents();

    // Boss 起「碾压」：起手挂霸体 + 开始读条
    e.tick([{ type: 'useSkill', skillId: 'boss-heavy', atTick: e.snapshot.tick }], 'meiichiro');
    e.drainEvents();
    const boss = () => e.snapshot.combatants.find((c) => c.side === 'enemy')!;
    expect(boss().casts.length).toBe(1);
    expect(boss().buffs.some((b) => b.defId === 'boss-heavy-armor')).toBe(true);

    // 玩家用「破」打断 → 必须被霸体挡下
    e.tick([{ type: 'useSkill', skillId: 'break', atTick: e.snapshot.tick }]);
    const events = e.drainEvents();

    expect(events.some((ev) => ev.kind === 'interruptImmune')).toBe(true);
    expect(events.some((ev) => ev.kind === 'interruptSuccess')).toBe(false);
    // 读条必须还在
    expect(boss().casts.length).toBe(1);
  });

  it('没有霸体时「破」能打断 Boss 的任意招式', () => {
    const e = new BattleEngine(makeGoldenEngineOptions());
    e.tick([], 'meiichiro');
    e.drainEvents();
    // 「呵斥」是中刀 —— 它**不带**霸体（那正是它是「破」的靶子的前提）
    e.tick([{ type: 'useSkill', skillId: 'boss-rebuke', atTick: e.snapshot.tick }], 'meiichiro');
    e.drainEvents();
    expect(e.snapshot.combatants.find((c) => c.side === 'enemy')!.casts.length).toBe(1);

    e.tick([{ type: 'useSkill', skillId: 'break', atTick: e.snapshot.tick }]);
    const events = e.drainEvents();
    expect(events.some((e2) => e2.kind === 'interruptSuccess')).toBe(true);
    expect(events.some((e2) => e2.kind === 'interruptImmune')).toBe(false);
  });

  it('「破」对慢刀失效、对中刀有效 —— 这就是两条通道的分界', () => {
    /**
     * 这条是设计 §1.3 的核心断言：三刀各走一条通道，40 是「破」的靶子、
     * 60 是霸体（破完全无效）。上面两条分别覆盖了两侧，这里把
     * "同一个玩家动作在两刀上的结论必须相反"写成一条断言 ——
     * 否则两边各自改坏了、方向相反也看不出来。
     */
    const base = makeGoldenEngineOptions();
    const e = new BattleEngine({
      ...base,
      combatants: [base.combatants[0]!, { ...base.combatants[1]!, behaviors: [] }],
    });
    const immuneFor = (skillId: string): boolean => {
      e.tick([], 'meiichiro');
      e.drainEvents();
      e.tick([{ type: 'useSkill', skillId, atTick: e.snapshot.tick }], 'meiichiro');
      e.drainEvents();
      e.tick([{ type: 'useSkill', skillId: 'break', atTick: e.snapshot.tick }]);
      return e.drainEvents().some((ev) => ev.kind === 'interruptImmune');
    };
    expect(immuneFor('boss-heavy')).toBe(true);
    expect(immuneFor('boss-rebuke')).toBe(false);
  });

  it('霸体只挂在慢刀上 —— 它不再是一个独立的出招格', () => {
    /**
     * 旧实现在轮转里有一条独立的 `boss-armor` 步骤（还要 `when: 有二阶段
     * buff` 才敢放，因为"占掉的那一格会把 Boss 出招挤后"，实测把战斗从
     * 897 tick 拉到 1094 tick）。
     *
     * 改造后**霸体是慢刀自带的属性**（设计 §5.2/§5.4）：它不再是任何一条
     * 轮转步骤，而是 `boss-heavy` 的 `castStart` 能力。这条断言就是
     * 那个"合并"的护栏 —— 谁要是又加回一条独立步骤，它会失败。
     */
    const rotations = PRIDE_BEHAVIORS.filter(
      (b) => b.kind === 'rotation' || b.kind === 'weightedRotation',
    );
    const skillIds = rotations.flatMap((b) => {
      if (b.kind === 'rotation' || b.kind === 'weightedRotation') return b.steps.map((s) => s.skillId);
      return [];
    });
    expect(skillIds).not.toContain('boss-heavy-armor');
    // 三个伤害技能 + 半血的回补，**没有第四个"纯增益"格**
    expect([...new Set(skillIds)].sort()).toEqual([
      'boss-heavy',
      'boss-mend',
      'boss-rebuke',
      'boss-scorn',
    ]);
  });

  it('霸体 buff 有明确时长，且等于慢刀的前摇（读条走完就消失）', () => {
    /**
     * ⚠️ 这个等式（`armor.duration === heavy.castTime`）是设计 §5.2 的第一条
     * 规则。`tests/unit/log.test.ts` 里对**同一件事**也有一条断言 ——
     * 两处都在守它，因为这条错了会表现为"读条结束后还霸体"，
     * 玩家会以为「破」坏了。
     */
    const armor = makeGoldenEngineOptions().buffs.get('boss-heavy-armor')!;
    expect(armor.flags?.interruptImmune).toBe(true);
    expect(Number.isFinite(armor.duration)).toBe(true);
    expect(armor.duration).toBe(registry.skills.get('boss-heavy')!.castTime);
  });
});
