import { describe, expect, it } from 'vitest';
import {
  REPLAY_FORMAT_VERSION,
  RunRecorder,
  replayRun,
  type EngineOptions,
  type RecordedRun,
} from '../../src/core/run';
import { ENTROPY_CLOCK } from '../../src/data/entities/entropyClock';
import type { StatKey, StatModifier } from '../../src/core/types';
import {
  FIXED_SEED,
  GOLDEN_OUTCOME,
  OUTPUT_PRIORITY,
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
      phase: outcome.phase,
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

  it('玩家完全不闪避会显著多挨伤害 —— 输入也是保护范围的一部分', () => {
    const base = runGolden();
    // 同一个引擎、同一颗种子、同一套输出循环，只把"会躲"换成"不躲"。
    // 指标用**剩余血量**而不是用时：闪避不影响 DPS，只影响承受的伤害。
    const noDodge = runWithPriority(OUTPUT_PRIORITY, {});
    expect(noDodge.combatants['player']!.hp).toBeLessThan(base.combatants['player']!.hp);
    // 而且差距要够大，否则说明闪避其实没什么用（判定层或时机有问题）
    const saved = base.combatants['player']!.hp - noDodge.combatants['player']!.hp;
    expect(saved).toBeGreaterThan(3_000);
  });

  it('精力回复砍半会改变"能躲几次"，但不会改击杀用时（这是个有价值的负面结论）', () => {
    // 这条断言记录了当前平衡的一个性质：击杀用时由输出循环决定，
    // 防御资源不参与 DPS。写下来是为了让"以后它变了"能被注意到。
    const base = runGolden();
    const starved = runWith(withPlayerStats(makeGoldenEngineOptions(), { energyRegen: 11 }));
    expect(starved.ticks).toBe(base.ticks);
  });

  it('Boss 行为数组改变会改变结果 —— AI 也在保护范围内', () => {
    const base = runGolden();
    const passive = makeGoldenEngineOptions();
    const silentBoss = runWith({
      ...passive,
      combatants: [passive.combatants[0]!, { ...passive.combatants[1]!, behaviors: [] }],
    });
    // Boss 不还手 → 玩家一点伤害都不会挨
    expect(silentBoss.combatants['player']!.hp).toBe(12_000);
    expect(base.combatants['player']!.hp).toBeLessThan(12_000);
  });

  it('去掉斗炁爆发会明显变慢 —— 终结技确实是主要伤害来源', () => {
    const base = runGolden();
    const noFinisher = runWithPriority(['rend', 'heavyStrike', 'riposte', 'strike']);
    expect(noFinisher.ticks).toBeGreaterThan(base.ticks);
  });
});

describe('熵之钟这件装备真的参与了战斗', () => {
  it('带装备与不带装备的结果不同', () => {
    const withClock = runGolden();
    const without = runWith({ ...makeGoldenEngineOptions(), passiveModifiers: new Map() });
    expect(without.ticks).not.toBe(withClock.ticks);
  });

  it('装备的四个能力在内容里齐全（modifier ×2 / derived / trigger）', () => {
    expect(ENTROPY_CLOCK.abilities.map((a) => a.kind)).toEqual([
      'modifier',
      'modifier',
      'derived',
      'trigger',
    ]);
  });
});

describe('暴击判定（这是熵之钟触发效果的前提）', () => {
  it('一场战斗会消耗随机数 —— 说明暴击判定真的在执行', () => {
    const outcome = runGolden();
    expect(outcome.finalRngSeed).not.toBe(FIXED_SEED);
  });

  it('暴击率设为 0 时随机数不被消耗 —— 消耗只由内容决定', () => {
    const noCrit = runWith(withPlayerStats(makeGoldenEngineOptions(), { critChance: 0 }));
    expect(noCrit.finalRngSeed).toBe(FIXED_SEED);
  });

  it('暴击率越高，击杀越快', () => {
    const base = runGolden();
    const alwaysCrit = runWith(withPlayerStats(makeGoldenEngineOptions(), { critChance: 1 }));
    expect(alwaysCrit.ticks).toBeLessThan(base.ticks);
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
