import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { buildPlayerKit, type PlayerKit } from '../../src/data/kit';
import { applySkillTweaks } from '../../src/data/skillTweak';
import { ALL_QIJI } from '../../src/data/qiji';
import { FOCUS_BUFF } from '../../src/data/kits/shared';
import { createRunSession } from '../../src/app/runSession';
import { makeGoldenEngineOptions } from '../golden/fixtures';import type { SkillDef } from '../../src/core/types';
import type { EventDef } from '../../src/core/events';
import type { CreateBattleOptions } from '../../src/core/combat/battleOptions';

/**
 * ==================================================================
 * 三条「改技能本身」的炁机 —— **真引擎 + 真 `advanceRun` 的实测**
 * ==================================================================
 *
 * 用户 2026-10-13 点名（③）：
 *   - 「避」用 3 次 → **避用出后回 20 缠**
 *   - 「凝」用 3 次 → **两条一起**解锁（缠消耗 −20 / 增伤变成 100%）
 *
 * 这一份**只测接线与效果**（数据形状在 `tests/unit/qiji.test.ts`）：
 *
 *   1. 解锁：**2 次不出现 / 3 次出现**（正反两面），两条「凝」**一起**出现
 *   2. 效果：拿真 `BattleEngine` 打 —— 避之后缠 +20、凝只扣 20、
 *      凝的增伤是 **100**（不是 160）
 *   3. 范围：本局累计（不跨局），而且**不污染下一次**（同一个注册表
 *      再开一局时技能定义还是 40）
 *
 * ⚠️ 装配路复刻 `app/battleSetup.ts`：`buildPlayerKit` → `applySkillTweaks`
 * → `CreateBattleOptions`。测试里手写一份是**有意的**（那份 app 代码碰
 * Pixi / 时钟，`core/` 的单测跑不了它），而"两条路一致"由
 * `tests/unit/kit.test.ts` 与这里的等价断言共同保证。
 */

/** 全部炁机按 id 索引（`ALL_QIJI` 的顺序就是候选顺序）。 */
const BY_ID = new Map(ALL_QIJI.map((q) => [q.id, q]));

describe('① 解锁：2 次不出现 / 3 次出现（真 `advanceRun`）', () => {
  const session = (): ReturnType<typeof createRunSession> =>
    createRunSession({ bossPool: ['meiichiro', 'lust'], qijiPool: ALL_QIJI, runLength: 2 });

  /** 造 `n` 条"某人用了某技能"的事件（`skillUsed` 是引擎真发的那个事件）。 */
  function used(skillId: string, n: number, tick = 1): readonly EventDef[] {
    return Array.from({ length: n }, (_, i) => ({
      kind: 'skillUsed' as const,
      tick: tick + i,
      sourceId: 'player',
      skillId,
    }));
  }

  it('⚠️「避」用了 2 次 → 三条新炁机**都不**出现（反面验收）', () => {
    const s = session();
    s.begin('player', 11);
    s.advance('victory', used('dodge', 2), true);
    const ids = s.candidates().map((c) => c.qiji.id);
    expect(ids).not.toContain('biShiJiXu');
    expect(ids).not.toContain('ningShenJuQi');
    expect(ids).not.toContain('ningShenRuDao');
  });

  it('「避」用了 3 次 → **这一场结束就**出现「避实击虚」', () => {
    const s = session();
    s.begin('player', 11);
    s.advance('victory', used('dodge', 3), true);
    expect(s.candidates().map((c) => c.qiji.id)).toContain('biShiJiXu');
  });

  it('⚠️「凝」用了 2 次 → 不出现；3 次 → **两条一起**出现（不是二选一）', () => {
    const early = session();
    early.begin('player', 11);
    early.advance('victory', used('focus', 2), true);
    expect(early.candidates().map((c) => c.qiji.id)).not.toContain('ningShenJuQi');

    const s = session();
    s.begin('player', 11);
    s.advance('victory', used('focus', 3), true);
    const ids = s.candidates().map((c) => c.qiji.id);
    expect(ids).toContain('ningShenJuQi');
    expect(ids).toContain('ningShenRuDao');
  });

  it('⚠️ 累计是**本局**的：第 1 场 2 次 + 第 2 场 1 次 → 第 2 场解锁', () => {
    const s = session();
    s.begin('player', 11);
    s.advance('victory', used('focus', 2), true);
    expect(s.state()?.unlocked).not.toContain('ningShenJuQi');
    s.advance('victory', used('focus', 1, 100), true);
    expect(s.state()?.unlocked).toContain('ningShenJuQi');
    expect(s.state()?.unlocked).toContain('ningShenRuDao');
  });

  it('⚠️ **不跨局**：`continueRun` 之后统计归零（不是成就系统）', () => {
    const s = session();
    s.begin('player', 11);
    s.advance('victory', used('focus', 3), true);
    expect(s.state()?.unlocked).toContain('ningShenJuQi');
    s.continueRun();
    s.begin('player', 12);
    expect(s.state()?.battleStats.skillUses).toEqual({});
    expect(s.candidates().map((c) => c.qiji.id)).not.toContain('ningShenJuQi');
  });

  /** 由 id 展开成 `buildPlayerKit` 要的那份（与 `runLoop.test.ts` 同一段）。 */
  function chosen(ids: readonly string[]): readonly { def: (typeof ALL_QIJI)[number]; stacks: number }[] {
    return ids.flatMap((id) => {
      const def = BY_ID.get(id);
      return def === undefined ? [] : [{ def, stacks: 1 }];
    });
  }

  it('选了「避实击虚」→ kit 里带出那一条 `skillTweak`（不是空的）', () => {
    const kit = buildPlayerKit('player', chosen(['biShiJiXu']));
    expect(kit.skillTweaks).toHaveLength(1);
    expect(kit.skillTweaks[0]?.skillId).toBe('dodge');
  });
});

/* ------------------------------------------------------------------ *
 * ② 效果：真引擎实测（复刻 `app/battleSetup.ts` 的装配路）
 * ------------------------------------------------------------------ */

/** 把 kit 的 `skillTweak` 应用到这个角色的技能 / buff 表上（同 app 那条路）。 */
function optionsWithKit(base: CreateBattleOptions, kit: PlayerKit): CreateBattleOptions {
  const tweaked = applySkillTweaks({ skills: base.skills, buffs: base.buffs }, kit.skillTweaks);
  return { ...base, skills: tweaked.skills, buffs: tweaked.buffs };
}

/** 一份标准夹具（Boss 不动手，隔离出"玩家这一下做了什么"）。 */
function quietOptions(): CreateBattleOptions {
  const options = makeGoldenEngineOptions();
  return {
    ...options,
    combatants: [options.combatants[0]!, { ...options.combatants[1]!, behaviors: [] }],
  };
}

/** 玩家开局缠 = `startDouqi`，用出 `skillId` 后读**这一下**的缠变化。 */
function castDouqiDelta(
  kit: PlayerKit,
  skillId: string,
  startDouqi: number,
): { readonly delta: number; readonly boost: number } {
  const base = quietOptions();
  const playable = base.combatants[0]!;
  const engine = new BattleEngine(
    optionsWithKit(
      {
        ...base,
        combatants: [
          { ...playable, resources: { ...playable.resources, douqi: startDouqi } },
          base.combatants[1]!,
        ],
      },
      kit,
    ),
  );
  const before = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.douqi;

  engine.tick([{ type: 'useSkill', skillId, atTick: 0 }]);
  engine.drainEvents();

  const ally = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
  return {
    delta: ally.resources.douqi - before,
    boost: engine.statsOf('player').damageBoost,
  };
}

const KIT_DODGE = buildPlayerKit('player', [{ def: BY_ID.get('biShiJiXu')!, stacks: 1 }]);
const KIT_FOCUS_COST = buildPlayerKit('player', [{ def: BY_ID.get('ningShenJuQi')!, stacks: 1 }]);
const KIT_FOCUS_BOOST = buildPlayerKit('player', [{ def: BY_ID.get('ningShenRuDao')!, stacks: 1 }]);
/** 两条「凝」一起选 —— 用户说它们**互不冲突**。 */
const KIT_BOTH = buildPlayerKit('player', [
  { def: BY_ID.get('ningShenJuQi')!, stacks: 1 },
  { def: BY_ID.get('ningShenRuDao')!, stacks: 1 },
]);

describe('「避实击虚」：用出避之后**回 20 缠**（真引擎）', () => {
  it('⚠️ 不选它时用「避」不回缠（默认路径不变）', () => {
    expect(castDouqiDelta(buildPlayerKit('player', []), 'dodge', 0).delta).toBe(0);
  });

  it('选了它：用「避」→ 缠 **+20**（代价照付，炁另算）', () => {
    expect(castDouqiDelta(KIT_DODGE, 'dodge', 0).delta).toBe(20);
  });

  it('⚠️ 它是**回复**不是"减耗"：「避」没花过缠，所以不可能从代价里减出来', () => {
    /**
     * 这一条把"读法"钉成机器可检查的事实：引擎里「避」的代价只有炁
     * （`DODGE.cost` 查得到），所以 +20 只能是 `resource` 回缠那条路。
     */
    const dodge = makeGoldenEngineOptions().skills.get('dodge') as SkillDef;
    expect(dodge.cost.map((c) => c.resource)).toEqual(['energy']);
    expect(KIT_DODGE.skillTweaks[0]?.costDeltas).toBeUndefined();
  });

  it('⚠️ 回缠**受上限钳制**（缠满了就不会溢出 —— 与引擎其它回资源同一条规则）', () => {
    /**
     * 上限从 `Combatant.caps.douqi` 来（夹具里是 `PLAYER_CAPS.douqi`）。
     * "回 20" 超出上限的部分被钳掉是**正确**行为（否则缠会越过上限，
     * 而界面 / 规则都按"最多 100"写）。
     */
    const cap = makeGoldenEngineOptions().combatants[0]!.caps.douqi;
    expect(castDouqiDelta(KIT_DODGE, 'dodge', cap).delta).toBe(0);
    expect(castDouqiDelta(KIT_DODGE, 'dodge', cap - 5).delta).toBe(5);
  });
});

describe('「聚气凝神」：凝的缠消耗 **40 → 20**（真引擎）', () => {
  it('不选它：扣 **40**（这是 2026-10-13 重标定后的基础代价）', () => {
    expect(castDouqiDelta(buildPlayerKit('player', []), 'focus', 100).delta).toBe(-40);
  });

  it('选了它：只扣 **20**', () => {
    expect(castDouqiDelta(KIT_FOCUS_COST, 'focus', 100).delta).toBe(-20);
  });
});

describe('「凝神入道」：凝的增伤 **变成 100%**（覆盖，不是 +100%）', () => {
  it('不选它：基础增伤来自 `FOCUS_BUFF`（当前 60）', () => {
    const base = (FOCUS_BUFF.modifiers ?? []).find((m) => m.stat === 'damageBoost');
    expect(castDouqiDelta(buildPlayerKit('player', []), 'focus', 100).boost).toBe(base?.value);
  });

  it('⚠️ 选了它：**正好 100**（若写成 +100 会是 160）', () => {
    expect(castDouqiDelta(KIT_FOCUS_BOOST, 'focus', 100).boost).toBe(100);
  });

  it('⚠️ 两条「凝」一起选：消耗 20 **且** 增伤 100（互不冲突）', () => {
    const r = castDouqiDelta(KIT_BOTH, 'focus', 100);
    expect(r.delta).toBe(-20);
    expect(r.boost).toBe(100);
  });
});

/* ------------------------------------------------------------------ *
 * ③ 不污染下一次：技能定义是**副本**，注册表那一份不动
 * ------------------------------------------------------------------ */

describe('⚠️ `skillTweak` 作用在**副本**上（不污染注册表 / 下一局）', () => {
  it('应用之后，传进去的那张技能表一个字没变', () => {
    const base = makeGoldenEngineOptions();
    const focus = base.skills.get('focus');
    expect(costOf(focus)).toBe(40);

    const tweaked = applySkillTweaks({ skills: base.skills, buffs: base.buffs }, KIT_FOCUS_COST.skillTweaks);
    /** 新表里的那份改了… */
    expect(costOf(tweaked.skills.get('focus'))).toBe(20);
    /** …旧表（= 注册表）那份**没变**。 */
    expect(costOf(base.skills.get('focus'))).toBe(40);

    function costOf(skill: SkillDef | undefined): number | undefined {
      const cost = skill?.cost.find((c) => c.resource === 'douqi');
      return typeof cost?.value === 'number' ? cost.value : undefined;
    }
  });

  it('⚠️ 先选减耗炁机、再开一局不选它 → 又是 40（不跨局）', () => {
    expect(castDouqiDelta(KIT_FOCUS_COST, 'focus', 100).delta).toBe(-20);
    /** 第二局：空 kit（`continueRun` 之后 `chosen` 清空那条路）。 */
    expect(castDouqiDelta(buildPlayerKit('player', []), 'focus', 100).delta).toBe(-40);
  });

  it('空 `skillTweaks` 时两张表**引用不变**（黄金重放的路径）', () => {
    const base = makeGoldenEngineOptions();
    const same = applySkillTweaks({ skills: base.skills, buffs: base.buffs }, []);
    expect(same.skills).toBe(base.skills);
    expect(same.buffs).toBe(base.buffs);
  });
});

/* ------------------------------------------------------------------ *
 * ④ 写错了就抛错（拒绝静默无效）
 * ------------------------------------------------------------------ */

describe('⚠️ 表达不了的改动**抛错**，不静默', () => {
  const base = makeGoldenEngineOptions();
  const tables = { skills: base.skills, buffs: base.buffs };

  it('技能不在表里 → 抛错', () => {
    expect(() => applySkillTweaks(tables, [{ skillId: 'nonexistent' }])).toThrow(/skill not found/);
  });

  it('给「避」写"缠耗减免" → 抛错（它根本没有缠代价）', () => {
    expect(() =>
      applySkillTweaks(tables, [
        { skillId: 'dodge', costDeltas: [{ resource: 'douqi', delta: -20 }] },
      ]),
    ).toThrow(/has no douqi cost/);
  });

  it('覆盖一个 buff 没有的修正 → 抛错', () => {
    expect(() =>
      applySkillTweaks(tables, [
        {
          skillId: 'focus',
          buffOverrides: [{ buffId: 'focus', modifiers: [{ stat: 'maxHp', value: 1 }] }],
        },
      ]),
    ).toThrow(/has no maxHp modifier/);
  });

  it('同一个技能的同一项覆盖两次 → 抛错（"哪条生效"没有答案）', () => {
    expect(() =>
      applySkillTweaks(tables, [
        {
          skillId: 'focus',
          buffOverrides: [
            { buffId: 'focus', modifiers: [{ stat: 'damageBoost', value: 100 }] },
            { buffId: 'focus', modifiers: [{ stat: 'damageBoost', value: 200 }] },
          ],
        },
      ]),
    ).toThrow(/overrides damageBoost twice/);
  });
});
