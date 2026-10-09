import { describe, expect, it } from 'vitest';
import {
  REPLAY_FORMAT_VERSION,
  RunRecorder,
  replayRun,
  type EngineOptions,
  type RecordedRun,
} from '../../src/core/run';
import type { StatKey, StatModifier } from '../../src/core/types';
import {
  FIXED_SEED,
  GOLDEN_OUTCOME,
  OUTPUT_PRIORITY,
  PLAYER_CAPS,
  makeGoldenEngineOptions,
  planPriority,
} from './fixtures';

/**
 * 黄金重放（架构规范 §7.5）。
 *
 * ------------------------------------------------------------------
 * 这组测试在防什么
 * ------------------------------------------------------------------
 *
 * 数值平衡一直在调。"这次改动有没有意外改变战斗结果"这个问题
 * 如果只能靠打开浏览器打一场来回答，就永远问得不够勤 ——
 * 而**静默的行为变化正是最难发现的 bug**。
 *
 * 这里把"一整场战斗"压缩成一个可提交的常量：
 * 固定的种子 + 固定的玩家策略 → 固定的胜负与状态轨迹。
 * 任何让它变化的东西（改数值、改门禁顺序、改 AI 优先级、改 tick 语义）
 * 都会在这里留下痕迹。
 */

/** 一局标准黄金战斗。 */
function runGolden(seed?: number) {
  return runWith(makeGoldenEngineOptions(seed));
}

function runWith(options: EngineOptions) {
  const recorder = new RunRecorder(options);
  recorder.runUntilEnd(planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' }), 60 * 200);
  return recorder.outcome();
}

function recordGolden(seed?: number): RecordedRun {
  const recorder = new RunRecorder(makeGoldenEngineOptions(seed));
  recorder.runUntilEnd(planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' }), 60 * 200);
  return recorder.toRecordedRun();
}

describe('黄金重放：固定种子 + 固定策略 → 固定结果', () => {
  it('重放两次得到完全相同的结果（逐位确定）', () => {
    expect(runGolden()).toEqual(runGolden());
  });

  it('重放结果与黄金常量一致', () => {
    const outcome = runGolden();
    expect({
      status: outcome.status,
      endReason: outcome.endReason,
      ticks: outcome.ticks,
      finalRngSeed: outcome.finalRngSeed,
      combatants: outcome.combatants,
    }).toEqual(GOLDEN_OUTCOME);
  });

  it('记录下来的输入可以原样重放（录制 → 重放闭环）', () => {
    const recorded = recordGolden();
    const fromRecord = replayRun(recorded, () => makeGoldenEngineOptions());
    expect(fromRecord).toEqual(runGolden());
  });

  it('重放记录里的种子就是初始种子（不存终态）', () => {
    const recorded = recordGolden();
    expect(recorded.seed).toBe(20261009);
    expect(recorded.ticks).toBeGreaterThan(0);
  });

  it('重放格式版本固定（改确定性语义时必须显式改这个数字）', () => {
    expect(REPLAY_FORMAT_VERSION).toBe(1);
    expect(recordGolden().version).toBe(REPLAY_FORMAT_VERSION);
  });

  it('版本不匹配时抛出明确的开发者错误', () => {
    const bogus: RecordedRun = { version: 0, seed: 1, ticks: 1, input: {} };
    expect(() => replayRun(bogus, () => makeGoldenEngineOptions())).toThrow(
      /replay format version mismatch/,
    );
  });
});

describe('随机源只有种子', () => {
  it('不同种子得到不同的随机数终态', () => {
    expect(runGolden(1).finalRngSeed).not.toBe(runGolden(999).finalRngSeed);
  });

  it('相同种子的两场战斗，随机数终态一致', () => {
    expect(runGolden(7).finalRngSeed).toBe(runGolden(7).finalRngSeed);
  });

  it('概率判定（暴击）写进了状态，因此可复现', () => {
    expect(runGolden(7).combatants['verrot']?.hp).toBe(
      runGolden(7).combatants['verrot']?.hp,
    );
  });
});

describe('对内容改动的敏感度（回归保护）', () => {
  /**
   * 敏感性断言用**击杀用时**而不是"Boss 剩余血量"。
   *
   * 踩过的坑：早期版本断言的是剩余血量，而那个量会**饱和** ——
   * 玩家赢得越快，剩余血量越是恒定的 0；输得越快，越是恒定的满血。
   * 于是"改动有没有影响"根本测不出来（两个值都是 0）。
   * `ticks` 是连续的，任何影响都会体现在它上面。
   */
  it('玩家增伤 20% 会缩短击杀用时 —— 重放能检测数值改动', () => {
    const base = runGolden();
    const boosted = runWith(
      buffPlayer(makeGoldenEngineOptions(), {
        stat: 'damageBoost',
        op: 'addPercent',
        value: 20,
        sourceKey: 'stat.damageBoost',
        namespace: 'test-boost',
        tier: 'buff',
      }),
    );
    expect(boosted.ticks).toBeLessThan(base.ticks);
  });

  it('把"会闪"换成"不闪"会改变用时 —— 输入也是保护范围的一部分', () => {
    const withDodge = runGolden();
    const noDodge = runWithPriority(OUTPUT_PRIORITY, {});
    /**
     * 注意方向：当前平衡下**不闪反而更快赢**（用时更短）。
     *
     * 因为闪一次要 40 缠 = 4 次「攻」的代价，而 Boss 一次重击
     * 只造成 18 伤害 —— "用闪换输出"在数值上不划算。
     * 这是**内容数值**的结论，不是引擎 bug：引擎的闪避判定有独立测试
     * （能量充足时能做到零承伤）。
     *
     * 写下来是为了让"以后这个关系反过来了"能被注意到 ——
     * 那说明有人调过平衡，应该是有意为之。
     */
    expect(noDodge.ticks).not.toBe(withDodge.ticks);
    expect(noDodge.ticks).toBeLessThan(withDodge.ticks);
  });

  it('缠回复砍半会改变"能躲几次"，但不会改击杀用时（这是个有价值的负面结论）', () => {
    // 这条断言记录了当前平衡的一个性质：击杀用时由输出循环决定，
    // 防御资源不参与 DPS。写下来是为了让"以后它变了"能被注意到。
    const base = runGolden();
    const starved = runWith(withPlayerStats(makeGoldenEngineOptions(), { energyRegen: 11 }));
    expect(starved.ticks).toBe(base.ticks);
  });

  it('Boss 不还手时玩家必定获胜 —— AI 也在保护范围内', () => {
    const base = runGolden();
    const passive = makeGoldenEngineOptions();
    const silentBoss = runWith({
      ...passive,
      combatants: [passive.combatants[0]!, { ...passive.combatants[1]!, behaviors: [] }],
    });
    expect(silentBoss.status).toBe('victory');
    expect(silentBoss.combatants['player']!.hp).toBe(PLAYER_CAPS.hp);
    // 而正常一场是**险胜**：玩家只剩三成血
    expect(base.status).toBe('victory');
    expect(base.combatants['player']!.hp).toBeLessThan(PLAYER_CAPS.hp * 0.5);
  });

  it('只按「攻」不放「轰」会打得更慢 —— 炁爆发确实是主要伤害来源', () => {
    const auto = runGolden();
    const attackOnly = runWithPriority(['attack']);
    // 少了 60 伤害的轰，Boss 剩余血量应该更多（或者玩家更早死）
    expect(attackOnly.combatants['verrot']!.hp).toBeGreaterThanOrEqual(
      auto.combatants['verrot']!.hp,
    );
  });
});

describe('玩家防御技能的选择会改变结果', () => {
  it('完全不闪会改变结果 —— 输入也是保护范围的一部分', () => {
    const withDodge = runGolden();
    const noDodge = runWithPriority(OUTPUT_PRIORITY, {});
    expect(noDodge.ticks).not.toBe(withDodge.ticks);
  });

  it('能量充足时闪避能完全免伤 —— 机制本身是对的（限制是能量）', () => {
    const options = makeGoldenEngineOptions();
    const p0 = options.combatants[0]!;
    const rich = {
      ...p0,
      caps: { ...p0.caps, energy: 100_000 },
      resources: { ...p0.resources, energy: 100_000 },
    };
    const rec = new RunRecorder({ ...options, combatants: [rich, options.combatants[1]!] });
    rec.runUntilEnd(planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' }), 60 * 250);
    const o = rec.outcome();
    expect(o.status).toBe('victory');
    // 一次伤害都没挨到
    expect(o.combatants['player']!.hp).toBe(PLAYER_CAPS.hp);
  });
});

describe('随机源：新内容不含暴击，所以不消耗随机数', () => {
  /**
   * 这是个**有价值的负面结论**，值得写下来。
   *
   * 当前的 6 个招式都写了 `canCrit: false`，所以战斗里没有任何概率判定 ——
   * 随机数一次都不被消耗，`finalRngSeed` 等于初始种子。
   *
   * 引擎的暴击机制本身是好的（有独立测试覆盖），只是内容还没用它。
   * 这条断言让"以后加了暴击"能被立刻发现 —— 那时它会失败，
   * 提醒我们更新黄金常量。
   */
  it('当前内容不消耗随机数', () => {
    const outcome = runGolden();
    expect(outcome.finalRngSeed).toBe(FIXED_SEED);
  });

  it('给一个可暴击的技能就会消耗随机数（机制是好的）', () => {
    const options = makeGoldenEngineOptions();
    const skills = new Map(options.skills);
    const attack = skills.get('attack');
    if (!attack) throw new Error('missing attack skill');
    skills.set('attack', {
      ...attack,
      hits: attack.hits.map((h) => ({
        ...h,
        effects: h.effects.map((e) =>
          e.damage ? { ...e, damage: { ...e.damage, canCrit: true } } : e,
        ),
      })),
    });
    const rec = new RunRecorder(withPlayerStats({ ...options, skills }, { critChance: 0.5 }));
    rec.runUntilEnd(planPriority(OUTPUT_PRIORITY, { dodgeSkillId: 'dodge' }), 60 * 250);
    expect(rec.outcome().finalRngSeed).not.toBe(FIXED_SEED);
  });
});

/* ------------------------------------------------------------------ *
 * 助手
 * ------------------------------------------------------------------ */

function runWithPriority(
  priority: readonly string[],
  dodge: { readonly dodgeSkillId?: string } = { dodgeSkillId: 'dodge' },
) {
  const recorder = new RunRecorder(makeGoldenEngineOptions());
  recorder.runUntilEnd(planPriority(priority, dodge), 60 * 200);
  return recorder.outcome();
}

/** 给玩家追加一条被动修正。 */
function buffPlayer(options: EngineOptions, modifier: StatModifier): EngineOptions {
  const passive = new Map(options.passiveModifiers);
  passive.set('player', [...(passive.get('player') ?? []), modifier]);
  return { ...options, passiveModifiers: passive };
}

/** 覆盖玩家的若干属性。 */
function withPlayerStats(
  options: EngineOptions,
  patch: Partial<Record<StatKey, number>>,
): EngineOptions {
  const baseStats = new Map(options.baseStats);
  baseStats.set('player', { ...(baseStats.get('player') ?? {}), ...patch });
  return { ...options, baseStats };
}
