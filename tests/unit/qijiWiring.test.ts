import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { buildPlayerKit, type PlayerKit } from '../../src/data/kit';
import { applySkillTweaks } from '../../src/data/skillTweak';
import { applyBuff } from '../../src/core/buffs';
import { COMBO_WINDOW } from '../../src/data/kits/combo';
import { ALL_QIJI } from '../../src/data/qiji';
import { DODGE_CHARGE } from '../../src/data/kits/dodgeCharge';
import { LIN_WANFENG_SKILLS } from '../../src/data/kits/linwanfeng';
import { STRIKE } from '../../src/data/kits/combo';
import { FOCUS_BUFF } from '../../src/data/kits/shared';
import { createRunSession } from '../../src/app/runSession';
import { makeGoldenEngineOptions } from '../golden/fixtures';
import type { Action, SkillDef } from '../../src/core/types';
import type { EventDef } from '../../src/core/events';
import type { CreateBattleOptions } from '../../src/core/combat/battleOptions';

/**
 * ==================================================================
 * 三条「改技能本身」的炁机 —— **真引擎 + 真 `advanceRun` 的实测**
 * ==================================================================
 *
 * 用户 2026-10-13 点名（③），其中第一条的效果**当天改过一次**：
 *   - 「避」用 3 次 → ~~避用出后回 20 缠~~ → **挂一层蓄势：
 *     下一次攻击伤害翻倍，用掉就消耗**（现在的口径）
 *   - 「凝」用 3 次 → **两条一起**解锁（缠消耗 −20 / 增伤变成 100%）
 *
 * 这一份**只测接线与效果**（数据形状在 `tests/unit/qiji.test.ts`）：
 *
 *   1. 解锁：**2 次不出现 / 3 次出现**（正反两面），两条「凝」**一起**出现
 *   2. 效果：拿真 `BattleEngine` 打 —— 避之后**下一次攻击的伤害数字翻倍**、
 *      打完那一层就没了（第二刀回到基础值）；凝只扣 20、凝的增伤是
 *      **100**（不是 160）
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

  /**
   * ⚠️ 上面两条喂的是**手工事件**。"解锁"这条链的真问题在
   * "**引擎真的会发 `skillUsed('dodge')` 吗**"——所以这一条从**真引擎**打，
   * 把它吐出来的事件流原样交给真 `advanceRun`（`runLoop.test.ts` 的写法）。
   */
  it('⚠️ 真引擎打一场：按 2 次 → 不出现；按 3 次 → **出现**（事件流不是造的）', () => {
    const two = dodgeBattleEvents(2);
    const three = dodgeBattleEvents(3);
    /** 先证明"引擎真的发了那么多次"（否则下面的断言可能是空转）。 */
    expect(countSkillUsed(two, 'dodge')).toBe(2);
    expect(countSkillUsed(three, 'dodge')).toBe(3);

    const early = session();
    early.begin('player', 11);
    early.advance('victory', two, true);
    expect(early.candidates().map((c) => c.qiji.id)).not.toContain('biShiJiXu');

    const s = session();
    s.begin('player', 11);
    s.advance('victory', three, true);
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
  function chosen(ids: readonly string[]): readonly (typeof ALL_QIJI)[number][] {
    return ids.flatMap((id) => {
      const def = BY_ID.get(id);
      return def === undefined ? [] : [def];
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

/**
 * 真引擎打一场（Boss 不动手），**恰好按 `dodge` `n` 次**，返回这一场的事件流。
 *
 * ⚠️ 两次之间隔 **70 tick**：「避」有 1 秒冷却（60 tick），隔得太近会被门禁
 * 拒掉 —— 那时数出来的 `skillUsed` 会少于 `n`，所以调用方会先断言条数。
 */
function dodgeBattleEvents(n: number): readonly EventDef[] {
  const engine = new BattleEngine(quietOptions());
  const events: EventDef[] = [];
  const EVERY = 70;
  for (let i = 0; i < 700; i += 1) {
    const actions: readonly Action[] =
      i % EVERY === 0 && i / EVERY < n ? [{ type: 'useSkill', skillId: 'dodge', atTick: i }] : [];
    engine.tick(actions);
    events.push(...engine.drainEvents());
  }
  return events;
}

/** 事件流里某个技能被用了多少次（`core/run/stats.ts` 的同一个判据）。 */
function countSkillUsed(events: readonly EventDef[], skillId: string): number {
  return events.filter((event) => event.kind === 'skillUsed' && event.skillId === skillId).length;
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

const KIT_DODGE = buildPlayerKit('player', [BY_ID.get('biShiJiXu')!]);
const KIT_FOCUS_COST = buildPlayerKit('player', [BY_ID.get('ningShenJuQi')!]);
const KIT_FOCUS_BOOST = buildPlayerKit('player', [BY_ID.get('ningShenRuDao')!]);
/** 两条「凝」一起选 —— 用户说它们**互不冲突**。 */
const KIT_BOTH = buildPlayerKit('player', [
  BY_ID.get('ningShenJuQi')!,
  BY_ID.get('ningShenRuDao')!,
]);

/* ------------------------------------------------------------------ *
 * 「避实击虚」：避 → 蓄势 → 下一次攻击翻倍 → 用掉就没了
 * ------------------------------------------------------------------ */

/**
 * 造一份"玩家满资源、Boss 不动手"的真引擎（判断伤害数字用）。
 *
 * ⚠️ Boss 的行为表被清空（`quietOptions`），所以**伤害数字只取决于玩家
 * 这一下**：没有 Boss 的减伤 / 反伤 / 阶段切换来搅局。
 */
function quietEngineWith(kit: PlayerKit): BattleEngine {
  const base = quietOptions();
  const playable = base.combatants[0]!;
  return new BattleEngine(
    optionsWithKit(
      {
        ...base,
        combatants: [
          {
            ...playable,
            /** 炁 100（斩 15 × n 够用）/ 缠 100（劈 50 够用）。 */
            resources: { ...playable.resources, energy: 100, douqi: 100 },
          },
          base.combatants[1]!,
        ],
      },
      kit,
    ),
  );
}

/** 玩家身上蓄势的层数（没有 = 0）。 */
function chargeStacks(engine: BattleEngine): number {
  const ally = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
  return ally.buffs.find((b) => b.defId === DODGE_CHARGE.id)?.stacks ?? 0;
}

/** 玩家用出 `skillId`（读条走完）→ **Boss 这一下实际掉的血**。 */
function hitDamage(engine: BattleEngine, skillId: string): number {
  const boss = (): number =>
    engine.snapshot.combatants.find((c) => c.side === 'enemy')!.resources.hp;
  const before = boss();
  engine.tick([{ type: 'useSkill', skillId, atTick: 0 }]);
  /**
   * ⚠️ 要跑够**最长的那条读条**才会结算到命中：斩 500ms（30 tick）、
   * 劈 1200ms（72 tick）—— 120 帧有余量。瞬发技能（避）第一帧就结算完。
   */
  for (let i = 0; i < 120; i += 1) engine.tick([]);
  engine.drainEvents();
  return before - boss();
}

describe('「避实击虚」：避 → 蓄势 → **下一次攻击伤害翻倍**（真引擎）', () => {
  it('⚠️ 不选它：用「避」不挂蓄势，斩是**基础 10**（默认路径不变）', () => {
    const bare = quietEngineWith(buildPlayerKit('player', []));
    expect(hitDamage(bare, 'dodge')).toBe(0);
    expect(chargeStacks(bare)).toBe(0);
    expect(hitDamage(bare, 'attack')).toBe(10);
  });

  it('选了它：用「避」→ 蓄势挂上（`damageBoost` = 100）', () => {
    const engine = quietEngineWith(KIT_DODGE);
    hitDamage(engine, 'dodge');
    expect(chargeStacks(engine)).toBe(1);
    expect(engine.statsOf('player').damageBoost).toBe(100);
  });

  it('⚠️ **伤害数字翻倍**：斩 10 → **20**（只差"先避一下"）', () => {
    /**
     * 这是用户要的前后对比：同一个技能、同一条引擎路径、同一个 Boss，
     * 唯一的差别是身上有没有那一层蓄势。
     */
    const withCharge = quietEngineWith(KIT_DODGE);
    hitDamage(withCharge, 'dodge');
    const boosted = hitDamage(withCharge, 'attack');

    const withoutCharge = quietEngineWith(KIT_DODGE);
    const plain = hitDamage(withoutCharge, 'attack');

    expect(plain).toBe(10);
    expect(boosted).toBe(20);
    expect(boosted).toBe(plain * 2);
  });

  it('⚠️ **用掉就消耗**：第一刀 20，第二刀回到 **10**（蓄势没了）', () => {
    const engine = quietEngineWith(KIT_DODGE);
    hitDamage(engine, 'dodge');
    expect(chargeStacks(engine)).toBe(1);

    expect(hitDamage(engine, 'attack')).toBe(20);
    expect(chargeStacks(engine)).toBe(0);

    expect(hitDamage(engine, 'attack')).toBe(10);
    expect(hitDamage(engine, 'attack')).toBe(10);
  });

  it('⚠️ 重击同样吃到翻倍：劈 45 → **90**（不是只有普攻）', () => {
    const engine = quietEngineWith(KIT_DODGE);
    hitDamage(engine, 'dodge');
    expect(hitDamage(engine, 'pi')).toBe(90);
    expect(chargeStacks(engine)).toBe(0);

    const plain = quietEngineWith(KIT_DODGE);
    expect(hitDamage(plain, 'pi')).toBe(45);
  });

  it('⚠️ **没打出去就不会消失**（时长无限：唯一的终止条件是攻击）', () => {
    /**
     * 用户的口径里**没有时间维度** —— 所以"闪完站着不动"不该让它悄悄
     * 过期。这条同时钉住 `duration: POSITIVE_INFINITY` 这个选择。
     */
    const engine = quietEngineWith(KIT_DODGE);
    hitDamage(engine, 'dodge');
    for (let i = 0; i < 600; i += 1) engine.tick([]);
    expect(chargeStacks(engine)).toBe(1);
  });

  it('⚠️ 「避」是**代价只有炁**的技能：这条炁机仍然不改它的代价', () => {
    /**
     * 旧效果（回缠）曾经拿这条当"读法的证据"。现在效果换了，**读法变了
     * 但事实没变** —— 留着它，免得有人以为那条炁机现在改代价。
     */
    const dodge = makeGoldenEngineOptions().skills.get('dodge') as SkillDef;
    expect(dodge.cost.map((c) => c.resource)).toEqual(['energy']);
    expect(KIT_DODGE.skillTweaks[0]?.costDeltas).toBeUndefined();
  });
});

describe('⚠️ 蓄势的**消费契约**：已迁移到引擎级的 `consume`（不再手写 `removeBuff`）', () => {
  /**
   * ==================================================================
   * 这条测试在防什么（以及它**从哪一条改过来**）
   * ==================================================================
   *
   * 旧版（2026-10-13 之前）的机制是**契约式耦合**：每个会造成伤害的技能
   * 都要在自己的 `hits[].effects` 里手写一条
   * `{ kind: 'removeBuff', target: { mode: 'self' }, buffId: DODGE_CHARGE.id }`。
   * 于是那条测试要**从技能表推导**"每一条带 damage 的技能都写了它" ——
   * 漏写一条就是静默失效（下一击还能再翻倍），而且只在"选了这条炁机"时
   * 才发生。
   *
   * 现在真相只有一处：`DODGE_CHARGE.consume.on = ['onAttack']`，由引擎在
   * 每 tick 的消费结算里跑（`core/buffs/consume.ts`）。所以这一组改成
   * 断言**机制本身**与"手写那条已经删干净"：
   *
   *   ① 声明在 buff 上（且只有 `onAttack` 一条 —— 别顺手多写）
   *   ② 数据层**一处 `removeBuff` 都没有**（"别造第二份真相"）
   *   ③ 真引擎实测「斩」20 / 「劈」90 且用掉就没（迁移后行为不变）——
   *      从**技能表推导**，新增攻击技能**自动**被覆盖（它天然会消费）
   */
  const usableByLin = [...LIN_WANFENG_SKILLS, STRIKE];
  const damaging = usableByLin.filter((skill) =>
    skill.hits.some((hit) => hit.effects.some((e) => e.kind === 'damage')),
  );

  it('① 蓄势声明了 `consume.on = [onAttack]`，且**只有**这一条', () => {
    expect(DODGE_CHARGE.consume?.on).toEqual(['onAttack']);
    /** 不写 `stacks`：整条消失（用户要的是"下一次攻击翻倍"）。 */
    expect(DODGE_CHARGE.consume?.stacks).toBeUndefined();
  });

  it('② 数据层没有任何手写的 `removeBuff`（假的第二份真相已删干净）', () => {
    for (const skill of usableByLin) {
      const removes = skill.hits
        .flatMap((hit) => hit.effects)
        .filter((e) => e.kind === 'removeBuff');
      expect(removes, `${skill.id} 还留着 removeBuff`).toEqual([]);
    }
  });

  it('③ 能造成伤害的技能恰好是这三条（否则下面的推导会空转）', () => {
    expect(damaging.map((s) => s.id).sort()).toEqual(['attack', 'pi', 'strike']);
  });

  it('⚠️ 每一条攻击技能都**真的**消耗蓄势（真引擎，从技能表推导）', () => {
    /**
     * ⚠️ 判据不能只读静态内容（"buff 声明了 onAttack"）—— 那样测的是
     * 声明，不是行为。所以这里对**每一条**会造成伤害的技能各打一轮：
     * 挂上蓄势 → 用它打一刀 → 层数必须归零。
     *
     * "它会造成伤害"这个前提由上一组（伤害事件）实测：
     * `hitDamage` 返回的值必须 > 0，否则这一轮要么打空、要么这条技能
     * 根本不该在这个集合里 —— 两种情况都该红。
     */
    for (const skill of damaging) {
      /** 「击」是派生技（`requires` 窗口），它的那条在下面单独测。 */
      if (skill.id === STRIKE.id) continue;
      const engine = quietEngineWith(KIT_DODGE);
      hitDamage(engine, 'dodge');
      expect(chargeStacks(engine), `${skill.id} 起点没有蓄势`).toBe(1);

      const dealt = hitDamage(engine, skill.id);
      expect(dealt, `${skill.id} 没有造成伤害（这一轮测不出消耗）`).toBeGreaterThan(0);
      expect(chargeStacks(engine), `${skill.id} 打完之后蓄势还在`).toBe(0);
    }
  });

  it('⚠️ 派生技「击」同样走**引擎机制**：一次攻击把窗口与蓄势一起消费掉', () => {
    /**
     * ⚠️ 这条测的是"**同一个引擎机制**（`onAttack`）能同时服务两个 buff"：
     * `STRIKE` 的 `requires` 认 `combo-window`（派生开关），而它同时也是
     * 一次攻击 —— 所以一次「击」命中应该把**窗口**和**蓄势**都消费掉。
     *
     * 为什么手工挂窗口：这里要验的是**消费**，不是"窗口怎么开"
     * （开窗那条链由 `settleComboWindows` 自己的测试覆盖）。而真去打
     * Boss 来开窗会把 Boss 的血打下去，与"闸门取反"的测试目的混在一起。
     */
    const options = quietOptions();
    const player = options.combatants[0]!;
    /** 先挂蓄势（KIT_DODGE 那条炁机给的），再挂派生窗口。 */
    const charged = applyBuff({ ...player, buffs: [] }, DODGE_CHARGE, player.id, 0).buffs;
    const withWindow = applyBuff(
      { ...player, buffs: charged },
      COMBO_WINDOW,
      player.id,
      0,
    ).buffs;

    const engine = new BattleEngine(
      optionsWithKit(
        {
          ...options,
          combatants: [
            { ...player, buffs: withWindow },
            options.combatants[1]!,
          ],
        },
        KIT_DODGE,
      ),
    );

    const allyBuffs = (): readonly string[] =>
      engine.snapshot.combatants.find((c) => c.side === 'ally')!.buffs.map((b) => b.defId);
    expect(allyBuffs()).toContain('combo-window');
    expect(chargeStacks(engine)).toBe(1);

    const dealt = hitDamage(engine, STRIKE.id);
    /** 先证明这一击真的打出去了、而且**吃到了翻倍**（5 → 10）。 */
    expect(dealt).toBe(10);
    /** 两个 buff 各自按**自己的** `consume` 声明消失（同一个 `onAttack`）。 */
    expect(chargeStacks(engine)).toBe(0);
    expect(allyBuffs()).not.toContain('combo-window');
  });

  it('⚠️ 反面：没打出去（没有任何攻击）就不会消耗 —— 时长无限', () => {
    const engine = quietEngineWith(KIT_DODGE);
    hitDamage(engine, 'dodge');
    for (let i = 0; i < 600; i += 1) engine.tick([]);
    expect(chargeStacks(engine)).toBe(1);
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
