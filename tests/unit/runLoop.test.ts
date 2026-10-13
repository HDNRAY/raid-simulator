import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import {
  ALL_BUFFS,
  ALL_SKILLS,
  BOSS_SKILL_IDS,
  DERIVED_SKILL_IDS,
  skillsForPlayer,
} from '../../src/data/content';
import { makeBoss, makePlayer } from '../../src/data/units';
import { buildPlayerKit, type PlayerKit } from '../../src/data/kit';
import { ALL_QIJI } from '../../src/data/qiji';
import { battleSeed } from '../../src/core/run/index';
import { createRunSession } from '../../src/app/runSession';
import { FIXED_SEED, OUTPUT_PRIORITY, DODGE_SKILL_ID, makeGoldenEngineOptions, planPriority } from '../golden/fixtures';
import type { Action, StatKey } from '../../src/core/types';
import type { EventDef } from '../../src/core/events';
import type { CreateBattleOptions } from '../../src/core/combat/battleOptions';
import type { QijiEntity } from '../../src/core/types/qiji';

/**
 * **一局肉鸽跑完一圈**（P2 的 `?runlen=N` + P3 的炁机选择）—— 应用层接线。
 *
 * ==================================================================
 * 这一份测什么（以及它替代了哪种"跑一遍看看"）
 * ==================================================================
 *
 * 它把 `app/runSession.ts` 的**真实**推进逻辑，配上**真实**的
 * `BattleEngine`（`core/` 零依赖，所以能在 Node 里跑整场战斗 —— 这是本仓库
 * 对"逻辑用单测"那条规则的落点），跑完 2 场：
 *
 * ```
 * 起局 → 第 1 场（真打）→ advance → selectQiji → 选「加血上限」
 *      → 第 2 场（带上 +30 血上限，真打）→ advance → runOver
 * ```
 *
 * 三条断言各自对应一个**验收项**：
 *   1. **去向序列**：`selectQiji → battle → runOver`（= 相位序列的来源）
 *   2. **炁机生效**：第 2 场玩家的 `caps.hp` 真的 +30
 *   3. **逐场结果**：`battleStats.battles` 是 `[{won:true},{won:true}]`
 *
 * ⚠️ 浏览器那边（`?runlen=2`）验的是**同一件事的界面部分**（截图 +
 * `__raidBattle.run.phases()`）；这里验的是**逻辑**，两者互补而不是重复。
 */

/** 打完一场：返回输赢 / 满血 / 全部事件。 */
function playBattle(
  options: CreateBattleOptions,
  maxTicks = 60 * 250,
): { readonly outcome: 'victory' | 'defeat'; readonly events: readonly EventDef[]; readonly flawless: boolean; readonly playerHp: number; readonly playerHpCap: number } {
  const engine = new BattleEngine(options);
  const events: EventDef[] = [];
  const plan = planPriority(OUTPUT_PRIORITY, { dodgeSkillId: DODGE_SKILL_ID });
  for (let i = 0; i < maxTicks; i += 1) {
    const state = engine.snapshot;
    if (state.status !== 'running') break;
    engine.tick(plan(state.tick, state) as readonly Action[]);
    events.push(...engine.drainEvents());
  }
  const state = engine.snapshot;
  const outcome = state.status === 'victory' ? 'victory' : 'defeat';
  const ally = state.combatants.find((c) => c.side === 'ally');
  const flawless = outcome === 'victory' && ally !== undefined && ally.resources.hp >= ally.caps.hp;
  return {
    outcome,
    events,
    flawless,
    playerHp: ally?.resources.hp ?? -1,
    playerHpCap: ally?.caps.hp ?? -1,
  };
}

/**
 * 造**第 2 场**的引擎参数（与 `app/battleSetup.ts` 同一条装配路）。
 *
 * ⚠️ 不复用 `makeGoldenEngineOptions`：那一份把对手 / 注册表 / 修正全部写死
 * 成"第 1 场"的样子，用它测不出"炁机带到了下一场"。
 */
function battleOptionsWithKit(
  playerId: string,
  bossId: string,
  kit: PlayerKit,
  seed: number,
): CreateBattleOptions {
  const skills = [
    ...skillsForPlayer(playerId),
    ...ALL_SKILLS.filter((s) => DERIVED_SKILL_IDS.has(s.id)),
    ...ALL_SKILLS.filter((s) => BOSS_SKILL_IDS.has(s.id)),
  ];
  const registry = createRegistry({ entities: [], skills, buffs: [...ALL_BUFFS] });
  return {
    combatants: [makePlayer(playerId, { kit }), makeBoss(bossId)],
    seed,
    bossId,
    timeLimitMs: 180_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([[playerId, kit.base], [bossId, {}]]),
    passiveModifiers: new Map<string, readonly never[]>([[playerId, kit.modifiers as readonly never[]]]),
    comboWindows: kit.comboWindows,
  };
}

/**
 * 会话里已经生效的炁机**定义**（`phaseFlow.activeQiji` 的同一段逻辑）。
 *
 * ⚠️ `RunState.chosen` 的元素只有一个 `qijiId`（2026-10-13 起没有 `stacks`
 * —— 肉鸽"一局只能选一次、不叠加"），所以这里给的是定义数组；
 * 喂给 `buildPlayerKit` 时由调用方补上恒为 1 的 `stacks`。
 */
function activeQiji(session: ReturnType<typeof createRunSession>): readonly QijiEntity[] {
  const state = session.state();
  if (state === undefined) return [];
  return state.chosen.flatMap((choice) => {
    const def = ALL_QIJI.find((q) => q.id === choice.qijiId);
    return def === undefined ? [] : [def];
  });
}

/** 这一局此刻的玩家装配（`phaseFlow.playerKit` 的同一段逻辑）。 */
function kitOf(session: ReturnType<typeof createRunSession>, playerId = 'player'): PlayerKit {
  return buildPlayerKit(
    playerId,
    activeQiji(session).map((def) => ({ def, stacks: 1 })),
  );
}

describe('`?runlen=2`：跑完一圈（逻辑层，真引擎）', () => {
  /**
   * ⚠️ **池子写成两个 `meiichiro`，是测试装置，不是设计**。
   *
   * 一局的场数被夹在 `1..池子长度`（`runSession.lengthOf`），所以"2 场的局"
   * 至少要两个 Boss。而**今天只有两个 Boss 能打**（傲慢 / 色欲），
   * 上面那套朴素策略打不过色欲 —— 于是要跑出"两场全胜"的完整一圈，
   * 只能让两个位置都是傲慢。真正的一局用 `BOSS_POOL`（见
   * `runSession.test.ts` 里那条断言），这里要测的是**流程与炁机装配**。
   */
  const POOL = ['meiichiro', 'meiichiro'] as const;

  it('2 场：第 1 场 → 选炁机 → 第 2 场 → 一局结束；逐场结果两胜', () => {
    const session = createRunSession({ bossPool: POOL, qijiPool: ALL_QIJI, runLength: 2 });
    const runSeed = 4242;
    session.begin('player', runSeed);
    expect(session.length()).toBe(2);
    expect(session.state()?.order).toHaveLength(2);

    /** ---------- 第 1 场：黄金夹具（林晚风 vs 傲慢）---------- */
    const b1 = playBattle(makeGoldenEngineOptions());
    expect(b1.outcome).toBe('victory');

    const step1 = session.advance(b1.outcome, b1.events, b1.flawless);
    /** **去向序列的第 1 步**：每场之后选一个炁机。 */
    expect(step1.kind).toBe('selectQiji');

    /**
     * 候选里有两条兜底；⚠️ **没有**「截炁·生击」—— 林晚风没有「截」
     * （「截」是凯丽的），所以那条炁机在她这一局里永远解锁不了。
     * 这同时是"**反面验收**"的逻辑版：没到条件的东西不出现。
     */
    const ids1 = session.candidates().map((c) => c.qiji.id);
    expect(ids1).toContain('vitality');
    expect(ids1).toContain('breath');
    expect(ids1).not.toContain('jieShengJi');
    expect(ids1).not.toContain('shanShengJi');

    /** ---------- 选「加血上限」---------- */
    expect(session.chooseQiji('vitality')).toBe(true);
    const kit = kitOf(session);
    expect(kit.caps.hp).toBe(150 + 30);

    /** ---------- 第 2 场：带上炁机 ---------- */
    const boss2 = session.bossId();
    expect(boss2).toBeDefined();
    const b2 = playBattle(
      battleOptionsWithKit('player', boss2 ?? 'meiichiro', kit, battleSeed(runSeed, 2)),
    );
    /** ⚠️ 这是"炁机真的带到下一场"的硬证据：开局血量上限 = 150 + 30。 */
    expect(b2.playerHpCap).toBe(180);
    expect(b2.outcome).toBe('victory');

    const step2 = session.advance(b2.outcome, b2.events, b2.flawless);
    /** **去向序列的第 2 步**：打满 2 场 ⇒ 一局结束。 */
    expect(step2.kind).toBe('runOver');

    const final = session.state();
    expect(final?.status).toBe('victory');
    /** 通关时 `position` 超出长度一位（`len + 1`），那是编码的一部分。 */
    expect(final?.position).toBe(3);
    expect(final?.battleStats.battles).toEqual([
      { won: true, flawless: b1.flawless },
      { won: true, flawless: b2.flawless },
    ]);
    expect(session.active).toBe(false);
  });

  it('⚠️ 真实池子（傲慢 / 色欲）：顺序确实洗出来了、第 2 场的装配照样带上炁机', () => {
    /**
     * 这一条用**真池子**，所以第 2 场可能是色欲（那套朴素策略打不过它）。
     * 于是这里**不**断言胜负，只断言两件真正要守的事：
     *   1. 顺序是洗牌的结果（长度 2、来自池子）
     *   2. 第 2 场的**装配**带上了刚选的炁机（换谁当对手都一样）
     */
    const session = createRunSession({
      bossPool: ['meiichiro', 'lust'],
      qijiPool: ALL_QIJI,
      runLength: 2,
    });
    session.begin('player', 4242);
    const order = session.state()?.order ?? [];
    expect(order).toEqual(['meiichiro', 'lust']);

    const b1 = playBattle(makeGoldenEngineOptions());
    expect(session.advance(b1.outcome, b1.events, b1.flawless).kind).toBe('selectQiji');
    session.chooseQiji('vitality');
    const kit = kitOf(session);

    const boss2 = session.bossId();
    expect(boss2).toBe('lust');
    const options = battleOptionsWithKit('player', 'lust', kit, battleSeed(4242, 2));
    const ally = options.combatants.find((c) => c.side === 'ally');
    /** 上限与开局血量都按 +30 来（炁机在新对手身上照样生效）。 */
    expect(ally?.caps.hp).toBe(180);
    expect(ally?.resources.hp).toBe(180);
  });

  it('⚠️ `runlen=1`：一场打完就结束（不出现选炁机屏）', () => {
    const session = createRunSession({ bossPool: ['meiichiro', 'lust'], qijiPool: ALL_QIJI, runLength: 1 });
    session.begin('player', 7);
    expect(session.length()).toBe(1);
    const b1 = playBattle(makeGoldenEngineOptions());
    expect(session.advance(b1.outcome, b1.events, b1.flawless).kind).toBe('runOver');
  });

  it('⚠️ 输了 → 一局结束、`position` 停在死的那一场（不做任何跨局保留）', () => {
    const session = createRunSession({ bossPool: ['meiichiro', 'lust'], qijiPool: ALL_QIJI, runLength: 2 });
    session.begin('player', 7);
    const step = session.advance('defeat', [], false);
    expect(step.kind).toBe('runOver');
    expect(session.state()?.status).toBe('defeat');
    expect(session.state()?.position).toBe(1);
    expect(session.state()?.chosen).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * ⚠️ 肉鸽的炁机语义：**一局只能选一次（不叠加）** + **选了不能取消**
 * ------------------------------------------------------------------ *
 *
 * 用户 2026-10-13 的两条原话（一起定死了肉鸽的语义）：
 *
 *   > **肉鸽也改成一局只能选一次（不叠加）**
 *   > **而且肉鸽里是不能把已经激活的再取消的**
 *
 * 下面四条是这块语义的**正反实测**，全部走**真引擎 + 真 `advanceRun`**
 * （与上面那条 `?runlen=2` 同一条路），而不是喂假统计：
 *
 *   1. 选过一条 → 它**不再出现在候选里**
 *   2. 反面：没选过的**仍在**候选里
 *   3. **不能取消**：提交一个大数字 999 也改不回去（同时把"再选一次"
 *      那条路钉死 —— 它返回 false，而不是悄悄回滚 / 叠层）
 *   4. **不叠加**：选过一次之后再打一场，效果**不翻倍**（给数字）
 * ------------------------------------------------------------------ */

describe('炁机：一局只能选一次（不叠加）· 选了不能取消（真引擎）', () => {
  /** 两场同一 Boss（一局的场数被夹在 `1..池子长度`；理由见上面那条 describe）。 */
  const TWO = ['meiichiro', 'meiichiro'] as const;

  /** 起一局、打完第 1 场（真引擎），返回会话与那一场的输入。 */
  function afterFirstBattle(): {
    readonly session: ReturnType<typeof createRunSession>;
    readonly b1: ReturnType<typeof playBattle>;
  } {
    const session = createRunSession({ bossPool: TWO, qijiPool: ALL_QIJI, runLength: 2 });
    session.begin('player', 4242);
    const b1 = playBattle(makeGoldenEngineOptions());
    expect(b1.outcome).toBe('victory');
    expect(session.advance(b1.outcome, b1.events, b1.flawless).kind).toBe('selectQiji');
    return { session, b1 };
  }

  it('⚠️ 选过的那条**不再出现在候选里**（同一屏 + 下一场都验）', () => {
    const { session, b1 } = afterFirstBattle();
    expect(session.candidates().map((c) => c.qiji.id)).toContain('vitality');

    expect(session.chooseQiji('vitality')).toBe(true);
    expect(session.candidates().map((c) => c.qiji.id)).not.toContain('vitality');

    /** 再打完第 2 场（真引擎）之后，它**仍然**不在候选里（永久事实）。 */
    const kit = kitOf(session);
    const boss2 = session.bossId() ?? 'meiichiro';
    const b2 = playBattle(battleOptionsWithKit('player', boss2, kit, battleSeed(4242, 2)));
    expect(session.advance(b2.outcome, b2.events, b2.flawless).kind).toBe('runOver');
    expect(session.candidates().map((c) => c.qiji.id)).not.toContain('vitality');
    expect(b1.outcome).toBe('victory');
  });

  it('⚠️ 反面：**没选过的**仍在候选里（滤的判据是"这个 id"）', () => {
    const { session } = afterFirstBattle();
    session.chooseQiji('vitality');
    const ids = session.candidates().map((c) => c.qiji.id);
    expect(ids).toContain('breath');
    expect(ids).not.toContain('vitality');
  });

  it('⚠️ **不能取消**：所有能想到的路都改不回去，`chosen` 只有一条', () => {
    /**
     * "能想到的路"逐条对应到代码：
     *
     *   - **再选一次**（键盘 Enter / 触屏点卡片最后都走这里）→ `false`
     *   - **反选 / 取消** → **没有这条路**：`runSession` 上没有
     *     `unchoose` / `remove` / `clearChoice` 之类的方法（类型上就不存在）
     *   - **`Esc` / 返回箭头** → 整个一局作废（回选角色），**不是**"取消选择"
     *   - **点别的候选** → 那是"选另一个"，`chosen` 只增不减
     */
    const { session } = afterFirstBattle();
    expect(session.chooseQiji('vitality')).toBe(true);

    expect(session.chooseQiji('vitality')).toBe(false); // 再选一次 = 取消不了
    expect(session.state()?.chosen).toEqual([{ qijiId: 'vitality' }]);

    expect(session.chooseQiji('breath')).toBe(true); // 选另一个不是"换掉"
    expect(session.state()?.chosen.map((c) => c.qijiId)).toEqual(['vitality', 'breath']);

    session.clear(); // 返回 / 放弃 = 整局丢掉，不是"把已经激活的取消"
    expect(session.state()).toBeUndefined();
  });

  it('⚠️ **不叠加**：选过一次「固本培元」之后再打一场，血上限**不翻倍**（给数字）', () => {
    const { session } = afterFirstBattle();
    expect(session.chooseQiji('vitality')).toBe(true);

    /**
     * ⚠️ `stacks` 是 `buildPlayerKit` 的入参形状、肉鸽这边**恒为 1**。
     * 这条断言把它钉在**数字**上：若哪天有人按"既然没层就叠满"改成 2，
     * 这里会变成 `+60`（210）而不是 `+30`（180）。
     */
    const modifiers = kitOf(session).modifiers;
    const fromVitality = modifiers.filter((m) => m.sourceKey === 'qiji.vitality');
    expect(fromVitality).toHaveLength(1);
    expect(fromVitality[0]?.value).toBe(30);
    expect(kitOf(session).caps.hp).toBe(150 + 30);

    /** 打完第 2 场（真引擎）之后，`chosen` 仍然只有一条 —— 没有"又叠一层"。 */
    const b2 = playBattle(
      battleOptionsWithKit('player', session.bossId() ?? 'meiichiro', kitOf(session), battleSeed(4242, 2)),
    );
    expect(session.advance(b2.outcome, b2.events, b2.flawless).kind).toBe('runOver');
    expect(session.state()?.chosen).toEqual([{ qijiId: 'vitality' }]);

    /** 再装配一次（= 下一场会用的那份）：`+30` **还是 +30**。 */
    const after = kitOf(session);
    expect(after.caps.hp).toBe(180);
    expect(after.modifiers.filter((m) => m.sourceKey === 'qiji.vitality')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 「炁回复速度」：真的改变了下一场的回炁
 * ------------------------------------------------------------------ */

describe('「炁脉·自生」：下一场的回炁真的变快', () => {
  /** 打固定 tick 数（不结束战斗），返回玩家在这段时间里攒下的炁。 */
  function energyGained(kit: PlayerKit, ticks: number): number {
    const options = battleOptionsWithKit('player', 'meiichiro', kit, FIXED_SEED);
    const engine = new BattleEngine(options);
    /**
     * ⚠️ **先把炁清空**：开局是满的（100/100），不清空就一直是 100，
     * 于是两种配置下"攒了多少"都是 0 —— 那会让这条测试永远"通过"
     * 而什么都没测到（本仓库把这种叫静默失效）。
     */
    const ally = engine.snapshot.combatants.find((c) => c.side === 'ally');
    if (ally !== undefined) {
      engine.replaceCombatantForTest({ ...ally, resources: { ...ally.resources, energy: 0 } });
    }
    for (let i = 0; i < ticks; i += 1) {
      engine.tick();
      engine.drainEvents();
    }
    return engine.snapshot.combatants.find((c) => c.side === 'ally')?.resources.energy ?? -1;
  }

  it('属性真的进了引擎（`statsOf` 读到 +10/秒）', () => {
    const kit = buildPlayerKit('player', [{ def: ALL_QIJI[1]!, stacks: 1 }]);
    const engine = new BattleEngine(battleOptionsWithKit('player', 'meiichiro', kit, FIXED_SEED));
    expect(engine.statsOf('player').energyRegen).toBe(10);
  });

  it('⚠️ 同样 30 个逻辑步，选了它**真的多回**（不是纸面属性）', () => {
    /**
     * 30 个逻辑步 = 300 tick。基础回 1/步（30 点）；选了它 ⇒ 2/步（60 点）。
     *
     * ⚠️ 用**差值**而不是绝对值：血量 / 炁的初值与其它来源都可能变，
     * 而这里要钉的是"炁机让它变快了"这一条因果。
     */
    const bare = buildPlayerKit('player', []);
    const boosted = buildPlayerKit('player', [{ def: ALL_QIJI[1]!, stacks: 1 }]);
    const baseGain = energyGained(bare, 300);
    const boostedGain = energyGained(boosted, 300);
    expect(baseGain).toBeGreaterThan(0);
    expect(boostedGain).toBeGreaterThan(baseGain);
  });

  it('⚠️ 不选它时 `energyRegen` 是 0（默认路径逐位不变）', () => {
    const kit = buildPlayerKit('player', []);
    const engine = new BattleEngine(battleOptionsWithKit('player', 'meiichiro', kit, FIXED_SEED));
    expect(engine.statsOf('player').energyRegen).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 三条「用了 3 次」的解锁（正反两面）
 * ------------------------------------------------------------------ */

describe('解锁判定接在**真实的推进**上（不是喂假统计）', () => {
  const session = (): ReturnType<typeof createRunSession> =>
    createRunSession({ bossPool: ['meiichiro', 'lust'], qijiPool: ALL_QIJI, runLength: 2 });

  /** 造 `n` 条"凯丽用了「截」"的事件（`skillUsed` 是引擎真发的那个事件）。 */
  function jieUsed(n: number, tick = 1): readonly EventDef[] {
    return Array.from({ length: n }, (_, i) => ({
      kind: 'skillUsed' as const,
      tick: tick + i,
      sourceId: 'kaili',
      skillId: 'jie',
    }));
  }

  it('⚠️ 用了 2 次 → 「截炁·生击」**不**出现（反面验收）', () => {
    const s = session();
    s.begin('kaili', 11);
    s.advance('victory', jieUsed(2), true);
    expect(s.candidates().map((c) => c.qiji.id)).not.toContain('jieShengJi');
  });

  it('用了 3 次 → **这一场结束就**出现（先累加、后判定）', () => {
    const s = session();
    s.begin('kaili', 11);
    s.advance('victory', jieUsed(3), true);
    expect(s.candidates().map((c) => c.qiji.id)).toContain('jieShengJi');
  });

  it('⚠️ 累计是**本局**的：第 1 场 2 次 + 第 2 场 1 次 → 第 2 场解锁', () => {
    const s = session();
    s.begin('kaili', 11);
    s.advance('victory', jieUsed(2), true);
    expect(s.state()?.unlocked).not.toContain('jieShengJi');
    s.advance('victory', jieUses1(), true);
    expect(s.state()?.unlocked).toContain('jieShengJi');

    function jieUses1(): readonly EventDef[] {
      return jieUsed(1, 100);
    }
  });

  it('⚠️ **不跨局**：`continueRun` 之后统计归零（不是成就系统）', () => {
    const s = session();
    s.begin('kaili', 11);
    s.advance('victory', jieUsed(3), true);
    expect(s.state()?.unlocked).toContain('jieShengJi');
    s.continueRun();
    expect(s.state()).toBeUndefined();
    s.begin('kaili', 12);
    expect(s.state()?.battleStats.skillUses).toEqual({});
    expect(s.candidates().map((c) => c.qiji.id)).not.toContain('jieShengJi');
  });
});
