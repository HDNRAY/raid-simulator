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
  DODGE_SKILL_ID,
  FIXED_SEED,
  GOLDEN_OUTCOME,
  GUARD_SKILL_ID,
  OUTPUT_PRIORITY,
  PLAYER_CAPS,
  makeGoldenEngineOptions,
  planPriority,
} from './fixtures';
import { LIN_WANFENG_HP, LIN_WANFENG_SKILLS } from '../../src/data/kits/linwanfeng';

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
  recorder.runUntilEnd(planPriority(OUTPUT_PRIORITY, { dodgeSkillId: DODGE_SKILL_ID }), 60 * 200);
  return recorder.outcome();
}

function recordGolden(seed?: number): RecordedRun {
  const recorder = new RunRecorder(makeGoldenEngineOptions(seed));
  recorder.runUntilEnd(planPriority(OUTPUT_PRIORITY, { dodgeSkillId: DODGE_SKILL_ID }), 60 * 200);
  return recorder.toRecordedRun();
}

/**
 * ==================================================================
 * ⚠️ 夹具建模的是**林晚风**（这是本次重标定的全部理由）
 * ==================================================================
 *
 * 上一版的黄金夹具用「破」打断 Boss，而「破」是黛玄的、**没有任何角色带**
 * —— 于是重放测的是一个游戏里不可能发生的场景。这一组断言把"夹具用的
 * 技能属于林晚风"钉成机器可检查的事实，否则下次换人又会静默漂回去。
 */
describe('夹具建模的是林晚风：技能与血量都来自她的 kit', () => {
  it('参考策略用到的技能恰好是她的 5 招', () => {
    /** 优先级（凝/劈/斩）+ 两个防御技（避/格）。 */
    const planIds = [...OUTPUT_PRIORITY, DODGE_SKILL_ID, GUARD_SKILL_ID].sort();
    expect(planIds).toEqual(LIN_WANFENG_SKILLS.map((s) => s.id).sort());
  });

  it('她没有打断技 —— 所以参考策略里也没有打断', () => {
    const lin = new Set(LIN_WANFENG_SKILLS.map((s) => s.id));
    /** 「截」是凯丽的、「破」是黛玄的 —— 两个都不该出现在这一场里。 */
    expect(lin.has('jie')).toBe(false);
    expect(lin.has('break')).toBe(false);
  });

  it('夹具玩家的血上限就是她的 150（不是全局兜底的 100）', () => {
    expect(PLAYER_CAPS.hp).toBe(LIN_WANFENG_HP);
    expect(makeGoldenEngineOptions().combatants[0]!.resources.hp).toBe(LIN_WANFENG_HP);
  });
});

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
    /**
     * 1 → 2：新增 AI 随机流（`aiRngSeed`）+ 加权随机轮转。
     * 见 `src/core/run.ts` 的版本说明。
     */
    expect(REPLAY_FORMAT_VERSION).toBe(2);
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
    expect(runGolden(7).combatants['meiichiro']?.hp).toBe(
      runGolden(7).combatants['meiichiro']?.hp,
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
     * ⚠️ **2026-10-12 晚（缠系数减半后）方向翻转了**：现在"不防"是**输**，
     * 而且规则 C（用缠不回缠）之后**输得更快**。
     *
     *   | 配置 | 结果 |
     *   |---|---|
     *   | 会防（黄金夹具） | **4136** tick / 胜 / 剩 **125 血** |
     *   | 完全不防 | **883** tick / **败**（血 0） |
     *
     * 演进：缠还是 1 时"不防 **824** tick / 剩 10 血"（贴着血皮**赢**）
     * → 缠减半后 **1153** tick / 败 → 规则 C 后 **883** tick / 败。
     * 纯进攻正是最依赖「劈」回缠的那条路：不防御 + 自己付的缠还被规则 C
     * 挡住返还 ⇒ 输出更慢、更早被打死。**"不防御 = 打不过"现在是硬结论。**
     *
     * 下面的断言仍然成立（战败比胜利"更早结束"），但它现在测的语义比
     * "更快"重得多。写清楚是为了让下一个人知道这条对齐的是哪个平衡状态。
     */
    expect(noDodge.ticks).not.toBe(withDodge.ticks);
    expect(noDodge.ticks).toBeLessThan(withDodge.ticks);
  });

  it('⚠️ 炁回复速度**会**改变击杀用时（P3 接线之后，这条结论反过来了）', () => {
    /**
     * ================================================================
     * ⚠️【作废 · 2026-10-13】"炁回复不影响击杀用时" —— 整段保留
     * ================================================================
     *
     * **旧断言（现在这句话是错的，留着是为了记住它当时为什么是对的）：**
     *
     * > 缠回复砍半会改变"能躲几次"，但**不会**改击杀用时
     * > （这是个有价值的负面结论）
     * >
     * > `const starved = runWith(withPlayerStats(opts, { energyRegen: 11 }))`
     * > `expect(starved.ticks).toBe(base.ticks)`   // 4136 === 4136
     *
     * **当时为什么成立**：不是因为"平衡里炁不影响 DPS"，而是因为
     * **`energyRegen` 根本没有消费者** —— `core/combat/index.ts` 的
     * `regenerate()` 只回固定的 `ENERGY_PER_LOGIC_TICK`（10 炁/秒），
     * 那个属性**算出来没人读**。也就是说这条断言当时**保护的正是那个
     * 死属性**（一个"看起来会生效、实际什么也不做"的属性，正是
     * AGENTS.md §2 说的最坏一类）。
     *
     * **实测为什么不再成立**：P3 给肉鸽的兜底炁机「炁回复速度」接线
     * （`regenerate` 里每逻辑步多加 `floor(energyRegen / 10)`），于是
     * 这个对照组真的回得更快（`floor(11/10) = 1` ⇒ **20 炁/秒**）⇒
     * 玩家能多打几次「斩」⇒ 用时明显变短：**4136 → 2010** tick。
     *
     * ⚠️ **这不是"平衡被动了"**：默认路径（没有任何东西设 `energyRegen`
     * 时，它 = 0 ⇒ 加 0）**逐位不变** —— `GOLDEN_OUTCOME` 仍是
     * 4136 / 125 血 / 炁 5 / 缠 33，本文件那条黄金断言照旧通过。
     *
     * ⚠️ 而且"回炁快 ⇒ DPS 上升"是**设计上必须成立**的：炁同时是
     * **攻击资源**（「斩」15 炁、「劈」也耗炁）与**防御资源**（「卸」按住
     * 15 炁/秒、「避」15 炁）—— 如果炁回复不影响输出，用户点名的那个
     * 炁机就是个假选项。
     *
     * `energyRegen: 11` 而不是 10：故意取一个"每步 1.1 ⇒ 向下取整 1"
     * 的值，顺带钉住"取整方向是 floor"（见 `regenerate` 的口径说明）。
     */
    const base = runGolden();
    const boosted = runWith(withPlayerStats(makeGoldenEngineOptions(), { energyRegen: 11 }));
    expect(boosted.ticks).toBeLessThan(base.ticks);
    expect(boosted.status).toBe('victory');
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
    /**
     * 而正常一场里，**会防的玩家剩 125 血**（上限 150）。
     *
     * ⚠️ 2026-10-12 换夹具后重新实测（140 → 缠减半后 **125**）。
     * 旧记录（"剩 60 血 / 约六成"、更早的"只剩三成血"）是**别的夹具**的
     * 数字，刻意留在这里当"改了多少"的对照。会玩的玩家大招用「避」、
     * 小招用「卸」；缠减半（+ 规则 C）把这一场从 24 秒拉到 **69** 秒，
     * 于是多挨了一些。险的是**完全不会防御**的那条路径
     * （现在是**输**，而且规则 C 后输得更快，见上一条）。
     */
    expect(base.status).toBe('victory');
    expect(base.combatants['player']!.hp).toBeLessThan(PLAYER_CAPS.hp);
  });

  it('只按「斩」不放「劈」（缠的唯一出口）会打得更慢', () => {
    const auto = runGolden();
    const attackOnly = runWithPriority(['attack']);
    /**
     * ⚠️ 2026-10-12 实测：主策略 **4136** tick；只按斩（仍在闪避）
     * **6188** tick。少了「劈」的 45 伤，输出只剩 10 伤的「斩」，
     * 于是慢得多 —— 缠的出口确实值得留。
     *
     * ⚠️ 规则 C 对这条**是空操作**：只按斩 = 代价只有炁 = 照旧回缠，
     * 所以 6188 在规则 C 前后不变（这是"规则 C 只砍用缠的技能"的旁证）。
     *
     * ⚠️ 若**完全不闪**、只按斩，那是**输**的 —— 那条由
     * `encounter.test.ts` 的"不防御就是输"守。
     */
    expect(attackOnly.ticks).toBeGreaterThan(auto.ticks);
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
    rec.runUntilEnd(
      planPriority(OUTPUT_PRIORITY, {
        dodgeSkillId: DODGE_SKILL_ID,
        /**
         * ⚠️ `dodgeAboveDamage: 0` = "一律用避、从不格"。
         * 默认策略会用「卸」抵消小招（那也会挨 5 点），而这条测试要测的
         * 是**「避」本身能完全免伤** —— 别让「卸」的减伤把它盖住。
         */
        dodgeAboveDamage: 0,
      }),
      60 * 250,
    );
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
    rec.runUntilEnd(planPriority(OUTPUT_PRIORITY, { dodgeSkillId: DODGE_SKILL_ID }), 60 * 250);
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
