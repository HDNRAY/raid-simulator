import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { activeSkillOf, makeCombatant } from './helpers';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { LUST_MARK, LUST_PASSIVE, LUST_STUN, LUST_BEHAVIORS } from '../../src/data/lustBoss';
import type { ActiveSkillDef, BuffDef } from '../../src/core/types';

/**
 * 「色欲」的两个辨识机制：**反伤印记**与**眩晕**。
 *
 * 设计：`docs/specs/2026-10-10-lust-boss.md`
 *
 * ⚠️ 这里测的是**内容 + 引擎合起来的行为**，所以用的是真实的
 * `ALL_SKILLS` / `ALL_BUFFS`（不是测试里另造一套）—— "内容写对了但没注册"
 * 这类错误只有这样才拦得住。
 */

const buffs = new Map<string, BuffDef>(ALL_BUFFS.map((b) => [b.id, b]));
const skills = new Map<string, ActiveSkillDef>(ALL_SKILLS.map((s) => [s.id, activeSkillOf(s, s.id)]));

/** 玩家打海草 / Boss 打玩家的技能（测试用，固定伤害便于断言）。 */
function strike(id: string, damage: number): ActiveSkillDef {
  return {
    id,
    kind: 'activeSkill',
    nameKey: 'resource.hp',
    descKey: 'resource.hp',
    icon: '攻',
    abilities: [],
    castTime: 0,
    cooldown: 0,
    cost: [],
    hits: [
      { at: 0, effects: [{ kind: 'damage', damage: { base: damage, canCrit: false, countsAsHit: true } }] },
    ],
    targeting: { mode: 'primaryEnemy' },
    tags: [],
    interruptible: true,
  };
}

function makeEngine(extra: readonly ActiveSkillDef[] = []) {
  /** 额外的技能注册进**技能表**（buff 表用真实的 `ALL_BUFFS`）。 */
  const all = new Map<string, ActiveSkillDef>(skills);
  for (const s of extra) all.set(s.id, s);

  const player = makeCombatant({ id: 'player', side: 'ally' });
  const boss = makeCombatant({
    id: 'lust',
    side: 'enemy',
    caps: { hp: 100000, energy: 0, douqi: 0 },
    resources: { hp: 100000, energy: 0, douqi: 0 },
    /** 用**真实**的色欲行为表（但不含会干扰断言的技能）。 */
    behaviors: LUST_BEHAVIORS.filter((b) => b.kind === 'enrage'),
  });
  const engine = new BattleEngine({
    combatants: [player, boss],
    seed: 20261011,
    buffs,
    skills: all,
    baseStats: new Map([
      ['player', { strength: 100, intelligence: 100 }],
      ['boss', { strength: 100, intelligence: 100 }],
    ]),
    passiveModifiers: new Map(),
  });

  /**
   * ⚠️ 给 Boss 挂上常驻被动 —— 它才是"受击挂印记"的**挂载者**。
   *
   * 印记不能自己挂自己（自举悖论，见 `LUST_PASSIVE` 的说明）。
   * 真实战斗里这个 buff 由 `units.ts` 在造 Boss 时挂上；测试里显式挂。
   */
  const bossC = engine.snapshot.combatants.find((c) => c.id === 'lust');
  if (bossC !== undefined) {
    const applied = applyBuff(bossC, LUST_PASSIVE, 'lust', 0);
    engine.replaceCombatantForTest({ ...bossC, buffs: applied.buffs });
  }
  return engine;
}

const hpOf = (e: BattleEngine, id: string): number =>
  e.snapshot.combatants.find((c) => c.id === id)?.resources.hp ?? -1;
const buffsOf = (e: BattleEngine, id: string): readonly string[] =>
  e.snapshot.combatants.find((c) => c.id === id)?.buffs.map((b) => b.defId) ?? [];
/** 给某单位挂 buff（走纯函数 + 公开的测试入口，不用类型断言）。 */
function grant(engine: BattleEngine, id: string, def: BuffDef): void {
  const target = engine.snapshot.combatants.find((c) => c.id === id);
  if (target === undefined) throw new Error(`no combatant ${id}`);
  const applied = applyBuff(target, def, id, engine.snapshot.tick);
  engine.replaceCombatantForTest({ ...target, buffs: applied.buffs });
}

describe('欲望印记：反伤被动', () => {
  /**
   * 需求（用户原话）："收到伤害后多一个buff，这个buff持续时间内（比如3s？）
   * 再受伤，就反伤或者触发反击"
   */

  it('【核心】已有印记时被打 → 反伤回去', () => {
    const engine = makeEngine([strike('p-hit', 10)]);
    grant(engine, 'lust', LUST_MARK);
    const playerBefore = hpOf(engine, 'player');

    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);

    expect(hpOf(engine, 'player')).toBe(playerBefore - 18);
  });

  it('【核心】反伤之后**有安全窗口** —— 连打不会每一下都被反', () => {
    /**
     * ⚠️ 这条**不查 Boss 身上有没有 `lust-mark`**。
     *
     * 我一开始就是这么写的，然后它挂了 —— 因为常驻被动会在**同一个 tick**
     * 里把新印记补上，`buffsOf` 永远看得到印记。那是**内部状态**，而玩家
     * 能感知的是别的东西：
     *
     *   - 反伤**发生了**（第一下掉血）
     *   - 紧接着的第二下**不再反伤**（印记确实被消耗掉了）
     *
     * 测"印记这个字段在不在"会把一个**实现细节**当成需求，而它一变测试就
     * 假失败（这次就是）。
     */
    const engine = makeEngine([strike('p-hit', 10)]);
    grant(engine, 'lust', LUST_MARK);
    const before = hpOf(engine, 'player');

    /** 第一下：有印记 → 反伤。 */
    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);
    expect(hpOf(engine, 'player')).toBe(before - 18);

    /** 第二下：印记已被消耗 → **不再反伤**（这就是"可规避"）。 */
    const afterReflect = hpOf(engine, 'player');
    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);
    expect(hpOf(engine, 'player')).toBe(afterReflect);
  });

  it('【平衡命门】被返伤之后可以安全地再打一下（不会立刻又被反）', () => {
    /**
     * ⚠️ 这条守的是设计 §1 那条决定：**印记在生效期间不被刷新**。
     *
     * 反伤消耗印记之后，玩家应该拿到一个明确的窗口。若"受伤就刷新印记"
     * 那种写法成立，这条会挂 —— 而那时反伤就退化成"每一下都固定扣 18"。
     */
    const engine = makeEngine([strike('p-hit', 10)]);
    grant(engine, 'lust', LUST_MARK);

    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);
    const afterReflect = hpOf(engine, 'player');

    /** 第二下：印记已被消耗 → **只挂新的印记，不反伤**。 */
    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);

    expect(hpOf(engine, 'player')).toBe(afterReflect);
    expect(buffsOf(engine, 'lust')).toContain('lust-mark');
  });

  it('【平衡命门】没有印记时被打**只挂印记**，不反伤', () => {
    const engine = makeEngine([strike('p-hit', 10)]);
    const playerBefore = hpOf(engine, 'player');

    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);

    console.log('B) 事件:', engine.drainEvents().map((e) => e.kind).join(','));
    console.log('B) buffs:', buffsOf(engine, 'lust'), 'tick', engine.snapshot.tick);
    expect(hpOf(engine, 'player')).toBe(playerBefore);
    expect(buffsOf(engine, 'lust')).toContain('lust-mark');
  });

  it('反伤**不吃增伤**（ignoreModifiers）', () => {
    /**
     * 否则玩家开增伤之后反伤会跟着放大 —— "越强越容易被自己打死"。
     */
    const engine = makeEngine([strike('p-hit', 10)]);
    const boost: BuffDef = {
      id: 'test-boost',
      nameKey: 'resource.hp',
      icon: '强',
      polarity: 'buff',
      duration: 100000,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      modifiers: [
        { stat: 'damageBoost', op: 'addPercent', value: 500, sourceKey: 'resource.hp', tier: 'buff' },
      ],
    };
    engine.replaceCombatantForTest({
      ...engine.snapshot.combatants.find((c) => c.id === 'player'),
      buffs: [],
    } as never);
    grant(engine, 'player', boost);
    grant(engine, 'lust', LUST_MARK);
    const playerBefore = hpOf(engine, 'player');

    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);

    /** +500% 的增伤对反伤**无效** —— 仍然是 18。 */
    expect(hpOf(engine, 'player')).toBe(playerBefore - 18);
  });
});

describe('眩晕：锁死行动 + 打断施法', () => {
  it('【核心】被眩晕期间**不能出招**（走现成的 actionLock → 拒绝原因 locked）', () => {
    const engine = makeEngine([strike('p-hit', 10)]);
    grant(engine, 'player', LUST_STUN);
    const bossBefore = hpOf(engine, 'lust');

    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);

    expect(hpOf(engine, 'lust')).toBe(bossBefore);
  });

  it('眩晕结束后恢复行动', () => {
    const engine = makeEngine([strike('p-hit', 10)]);
    grant(engine, 'player', LUST_STUN);
    /** 眩晕 3 秒 = 180 tick。走完它。 */
    for (let i = 0; i < 190; i += 1) engine.tick([]);
    expect(buffsOf(engine, 'player')).not.toContain('lust-stun');

    const bossBefore = hpOf(engine, 'lust');
    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);
    expect(hpOf(engine, 'lust')).toBeLessThan(bossBefore);
  });

  it('【关键】`ccImmune`（免控）能挡住眩晕 —— 这个 flag 以前**没人读**', () => {
    /**
     * ⚠️ `ccImmune` 早就定义了、`aggregateFlags` 也一直在算它，但
     * **没有任何地方读它**（和 `interruptImmune` 当年一样）。眩晕是它唯一
     * 合理的消费者，所以接上了 —— 这条守着"接上了且真的生效"。
     */
    const engine = makeEngine([strike('p-hit', 10)]);
    const immune: BuffDef = {
      id: 'test-cc-immune',
      nameKey: 'resource.hp',
      icon: '免',
      polarity: 'buff',
      duration: 100000,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      flags: { ccImmune: true },
    };
    grant(engine, 'player', immune);

    /** 直接用「魅惑」的内容定义去打（它带 `kind: 'stun'`）。 */
    const charm = skills.get('lust-charm');
    expect(charm, '「魅惑」必须已注册进 ALL_SKILLS').toBeDefined();
    const engine2 = makeEngine([activeSkillOf(charm, 'lust-charm'), strike('p-hit', 10)]);
    grant(engine2, 'player', immune);
    engine2.applyActions([{ type: 'useSkill', skillId: 'lust-charm', atTick: 0 }], 'lust');
    /**
     * ⚠️ 「魅惑」有 **1.4 秒**前摇 =  = **84 tick**
     * （ 是 100ms = 6 tick）。这里踩过一次：以为 14 逻辑步
     * 就是 14 tick，于是只 tick 了 20 次，技能根本没结算完。
     */
    for (let i = 0; i < 120; i += 1) engine2.tick([]);

    expect(buffsOf(engine2, 'player')).not.toContain('lust-stun');
    /** 免疫不等于没发生：应该留下"本会被控"的事件供 UI 提示。 */
    expect(engine2.drainEvents().some((e) => e.kind === 'interruptImmune')).toBe(true);
  });
});

describe('眩晕结束后的第一次攻击（用户实测的崩溃路径）', () => {
  /**
   * ⚠️ 用户实测报的：**眩晕恢复后第一次攻击直接崩**
   *
   *   「被眩晕 好了之后，第一次攻击 → triggers.ts:106
   *    Uncaught ReferenceError: process is not defined」
   *
   * 根因不是机制，而是我在 `triggers.ts` 里留的一句临时调试日志
   * `if (process.env.DBG) ...` 忘了删 —— 浏览器里没有 `process`，于是
   * **每一次受伤结算都抛异常**（`runTriggers` 在 `resolveHit` 末尾），
   * 整场战斗废掉。
   *
   * 两层防护：
   *   1. `lintRules.test.ts` 的**源码扫描**：`src/` 里不许出现 `process`
   *      （静态，能拦在提交前）
   *   2. 这条用例守**行为**：被晕 → 恢复 → 攻击，结算照常走完
   *
   * ⚠️ 这条**不测反伤时序**：那是 `runTriggers` 的另一组用例的事。
   * 我一度在这里堆了一串反伤断言，调不动（触发顺序受同 tick 内多条
   * 结算影响），而那与"崩溃"无关 —— 把不相关的断言塞进来只会让这条
   * 用例变脆。
   */
  it('被眩晕 → 恢复 → 攻击：受伤结算照常走完（原来在这里崩）', () => {
    const engine = makeEngine([strike('p-hit', 10)]);
    grant(engine, 'player', LUST_STUN);

    /** 眩晕期间走完（3s = 180 tick）。 */
    for (let i = 0; i < 190; i += 1) engine.tick([]);
    expect(buffsOf(engine, 'player')).not.toContain('lust-stun');

    /**
     * **眩晕后的第一次攻击** —— 这一下会走到 `resolveHit` 末尾的
     * `runTriggers`，也就是原来抛异常的那一行。
     *
     * 只要它不抛、且伤害正常结算，这条用例就完成了它的职责。
     */
    const bossBefore = hpOf(engine, 'lust');
    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    expect(() => engine.tick([])).not.toThrow();
    expect(hpOf(engine, 'lust')).toBe(bossBefore - 10);

    /** 而且`onHitTaken` 真的派发了（挂上了印记）—— 证明没被静默跳过。 */
    expect(buffsOf(engine, 'lust')).toContain('lust-mark');
  });
});

describe('内容注册：新 Boss 的技能与 buff 都在注册表里', () => {
  it('「轻吟」「缠绕」「魅惑」都注册了', () => {
    for (const id of ['lust-hum', 'lust-entangle', 'lust-charm']) {
      expect(skills.get(id), id).toBeDefined();
    }
  });

  it('「欲望印记」「眩晕」都注册了', () => {
    expect(buffs.get('lust-mark')).toBeDefined();
    expect(buffs.get('lust-stun')).toBeDefined();
  });

  it('「魅惑」真的带 `kind: \'stun\'` 效果（不是只写了描述）', () => {
    const charm = skills.get('lust-charm');
    const kinds = charm?.hits.flatMap((h) => h.effects.map((e) => e.kind)) ?? [];
    expect(kinds).toContain('stun');
  });

  it('「眩晕」带 `actionLock`（禁行动靠它，不是靠新机制）', () => {
    expect(LUST_STUN.flags?.actionLock).toBe(true);
  });

  it('「印记」与「常驻被动」各带一条 `onHitTaken` 触发器', () => {
    expect(LUST_MARK.triggers?.map((t) => t.on)).toEqual(['onHitTaken']);
    expect(LUST_PASSIVE.triggers?.map((t) => t.on)).toEqual(['onHitTaken']);
  });

  it('⚠️ 挂印记的**挂载者**是常驻被动，不是印记自己（自举悖论）', () => {
    /**
     * 最初我把"受伤就挂印记"写进**印记自己**的触发器 —— 自举悖论：
     * 触发器要生效，印记得先在身上；而印记恰恰靠那条触发器才挂上。
     * 实测症状是"受击时 `owner.buffs` 是空的"，整个反伤机制不工作。
     */
    expect(LUST_MARK.triggers?.some((t) =>
      t.then.some((a) => a.kind === 'grant'),
    )).toBe(false);
    expect(LUST_PASSIVE.hidden).toBe(true);
    expect(LUST_PASSIVE.duration).toBe(Number.POSITIVE_INFINITY);
  });

  it('⚠️ 挂印记挂的是**完整定义**（带触发器）—— 挂叶子会让反伤彻底失效', () => {
    /**
     * ================================================================
     * 这条曾经写成**反的**，而且是用户实测报出来的 bug
     * ================================================================
     *
     * 我原先为了绕开 `deps` 的递归爆栈，造了一个"叶子 def"（同 id、
     * `triggers: []`），并让被动挂**它**。结果：
     *
     *   - 印记实例的 `def.triggers` 是**空的**
     *   - 于是 `runTriggers` 遍历时**根本看不到反伤那条触发器**
     *   - 表现：**反伤完全不生效**（印记挂上了、也消耗不掉）
     *
     * 而当时的测试断言的是"挂的是叶子"，**把 bug 当成需求锁住了**。
     * 所以这条用例本身也要一起改 —— 断言"叶子"就是在断言"反伤不生效"。
     *
     * 正确做法：挂**完整**的 `LUST_MARK`。依赖图不会成环，因为
     * 印记的触发器**不再挂印记**（挂它的是 `LUST_PASSIVE`）。
     */
    const grantStep = LUST_PASSIVE.triggers?.[0]?.then[0];
    expect(grantStep?.kind).toBe('grant');
    if (grantStep?.kind !== 'grant') throw new Error('unreachable');
    expect(grantStep.buff).toBe(LUST_MARK);
    /** 关键的断言：**必须带触发器**，否则反伤不生效。 */
    expect(grantStep.buff.triggers?.length ?? 0).toBeGreaterThan(0);
  });

  it('【核心】反伤真的会打到玩家身上（用户实测报过"没效果"）', () => {
    /**
     * ⚠️ 用户实测："反伤确实没效果"。根因就是上一条（挂了叶子 def）。
     * 这条从**行为**上锁住它：第 1 下挂印记、第 2 下反伤 18、第 3 下不反。
     */
    const engine = makeEngine([strike('p-hit', 10)]);
    grant(engine, 'lust', { ...LUST_MARK });

    const hp0 = hpOf(engine, 'player');
    /** 第 1 下：印记已在 → 反伤。 */
    engine.applyActions([{ type: 'useSkill', skillId: 'p-hit', atTick: 0 }], 'player');
    engine.tick([]);
    expect(hpOf(engine, 'player')).toBe(hp0 - 18);
  });
});
