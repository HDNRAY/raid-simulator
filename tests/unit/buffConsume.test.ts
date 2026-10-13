import { describe, expect, it } from 'vitest';
import {
  applyBuff,
  applyConsume,
  consumeFactsFor,
  expireBuffs,
  matchedConsumeTriggers,
  resetBuffInstanceCounter,
} from '../../src/core/buffs';
import { settleConsumableBuffs } from '../../src/core/combat/consumeHandler';
import { BattleEngine } from '../../src/core/combat/battleState';
import { toMutable } from '../../src/core/combat/battleStateTypes';
import { SUPPORTED_CONSUME_TRIGGERS } from '../../src/core/content/capabilityAudit';
import { makeGoldenEngineOptions } from '../golden/fixtures';
import { makeBuffDef, makeCombatant, makeSkillDef } from './helpers';
import type { BuffDef, Combatant, EventDef, SkillDef } from '../../src/core/types';
import type { CreateBattleOptions } from '../../src/core/combat/battleOptions';

/**
 * ==================================================================
 * **buff 消费机制**（`BuffDef.consume`）—— 引擎级，真引擎实测
 * ==================================================================
 *
 * 用户 2026-10-13 的原话：
 *
 * > buff 需要有各种 消费机制：永久存在 / 持续时间 / 被攻击消费 /
 * > 被闪避消费 / 被格挡消费 / 被受击消费
 *
 * 在这一版之前，"用掉就消耗"只能由**消耗方**在自己的命中里手写一条
 * `removeBuff`（契约式耦合：谁忘了写谁就静默失效）。本文件的第一组
 * （纯函数）与第二组（真引擎）钉的是**新机制本身**，而不是"每条技能都
 * 记得写"。
 *
 * 组织：
 *   ① 纯函数：`consumeFactsFor` 怎么读事件（四种判据的唯一定义处）
 *   ② 真引擎：四种消费各一条（正面），外加"不该消费"的反面
 *   ③ 叠层：独立叠层 / 刷新 / 永久 1 层 / 上限 n 层
 *   ④ 契约：对账表与实现一致、数据层不再有手写的 `removeBuff`
 */

/* ------------------------------------------------------------------ *
 * ① 纯函数：事件 → facts → 该消费谁
 * ------------------------------------------------------------------ */

function damageEvent(over: Partial<Extract<EventDef, { kind: 'damage' }>> = {}): EventDef {
  return {
    kind: 'damage',
    tick: 0,
    sourceId: 'attacker',
    targetId: 'victim',
    amount: 10,
    crit: false,
    absorbed: 0,
    thinned: 0,
    overkill: 0,
    skillId: 'a-skill',
    ...over,
  };
}

function avoidedEvent(viaBuffId?: string): EventDef {
  return {
    kind: 'avoided',
    tick: 0,
    sourceId: 'attacker',
    targetId: 'victim',
    skillId: 'a-skill',
    /**
     * ⚠️ `reason` **固定写 `'immune'`**：引擎对无敌与阈值整击作废**都发**
     * 这个值（`hitResolution` 对「卸」写的是 `avoidReason: 'invulnerable'`）。
     * 下面的断言因此证明了一件事：判据**不能**只看 `reason`。
     */
    reason: 'immune',
    ...(viaBuffId === undefined ? {} : { viaBuffId }),
  };
}

/** 受害者：身上挂着 `buffs`（消费判据要读它们的 flags）。 */
function victimWith(buffs: readonly BuffDef[]): Combatant {
  let c = { ...makeCombatant(), id: 'victim', side: 'enemy' as const };
  for (const def of buffs) c = { ...c, buffs: applyBuff(c, def, 'victim', 0).buffs };
  return c;
}

const INVULNERABLE = makeBuffDef({ id: 'iframe', flags: { invulnerable: true } });
const THRESHOLD = makeBuffDef({ id: 'guard', flags: { damageThreshold: 15 } });

describe('① `consumeFactsFor`：四种判据（唯一一处解读）', () => {
  it('造成伤害 → 攻方 `attacked`、守方 `damaged`（同一个事件的两面）', () => {
    const events = [damageEvent()];
    /** 攻方（事件里的 `sourceId`）：它"打出去了"；没挨打。 */
    const attacker = { ...makeCombatant(), id: 'attacker' };
    expect(consumeFactsFor(attacker, events, 0)).toEqual({
      attacked: true,
      damaged: false,
      dodged: false,
      blocked: false,
    });
    /** 守方（事件里的 `targetId`）：它"挨到了"，但**不算打人**。 */
    expect(consumeFactsFor(victimWith([]), events, 0)).toEqual({
      attacked: false,
      damaged: true,
      dodged: false,
      blocked: false,
    });
  });

  it('⚠️ 被闪掉的那一击（挡它的是 `invulnerable` 的 buff）→ 只有 `dodged`', () => {
    const facts = consumeFactsFor(victimWith([INVULNERABLE]), [avoidedEvent(INVULNERABLE.id)], 0);
    expect(facts).toEqual({ attacked: false, damaged: false, dodged: true, blocked: false });
  });

  it('⚠️ 被阈值挡下的那一击（挡它的是 `damageThreshold`）→ 只有 `blocked`', () => {
    /**
     * ⚠️ 这一条的 `reason` 与上面那条**完全一样**（都是 `'immune'`）——
     * 区分靠的是 `viaBuffId` 指向的那个 buff 的 flags。
     */
    const facts = consumeFactsFor(victimWith([THRESHOLD]), [avoidedEvent(THRESHOLD.id)], 0);
    expect(facts).toEqual({ attacked: false, damaged: false, dodged: false, blocked: true });
  });

  it('⚠️ 反面：`viaBuffId` 缺失 / 指向不存在的 buff → 两条都不算（不猜成闪避）', () => {
    const events = [avoidedEvent(), avoidedEvent('没这个 buff')];
    const facts = consumeFactsFor(victimWith([INVULNERABLE]), events, 0);
    expect(facts).toEqual({ attacked: false, damaged: false, dodged: false, blocked: false });
  });

  it('⚠️ 别的 tick 的事件不算（事件数组跨 tick 累积）', () => {
    const events = [damageEvent({ tick: 5 })];
    expect(consumeFactsFor(victimWith([]), events, 6)).toEqual({
      attacked: false,
      damaged: false,
      dodged: false,
      blocked: false,
    });
  });

  it('⚠️ `amount: 0` 的伤害事件不算"打出去了"', () => {
    expect(consumeFactsFor(victimWith([]), [damageEvent({ amount: 0 })], 0).attacked).toBe(false);
  });

  it('⚠️ 触发器产出的反伤（`skillId: ""`）不算"你攻击了一次"，但算受击', () => {
    const reflect = [damageEvent({ skillId: '' })];
    expect(consumeFactsFor(victimWith([]), reflect, 0).attacked).toBe(false);
    expect(consumeFactsFor(victimWith([]), reflect, 0).damaged).toBe(true);
  });

  it('`matchedConsumeTriggers` 只返回真的发生了的那几条，且按内容顺序', () => {
    const def = makeBuffDef({ id: 'x', consume: { on: ['onDamaged', 'onAttack', 'onDodge'] } });
    const matched = matchedConsumeTriggers(def, {
      attacked: true,
      damaged: true,
      dodged: false,
      blocked: false,
    });
    expect(matched).toEqual(['onDamaged', 'onAttack']);
    /** 没写 `consume` 的 buff 一条都不匹配（默认生命周期不受战斗事件影响）。 */
    expect(
      matchedConsumeTriggers(makeBuffDef({ id: 'y' }), {
        attacked: true,
        damaged: true,
        dodged: true,
        blocked: true,
      }),
    ).toEqual([]);
  });
});

describe('① `applyConsume`：整条消费 / 扣层 / `independent` 扣一个实例', () => {
  it('默认（不写 `stacks`）：整条消失', () => {
    const def = makeBuffDef({ id: 'a', consume: { on: ['onAttack'] } });
    const c: Combatant = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), def, 'player', 0).buffs };
    const out = applyConsume(c, new Map([[def.id, def]]), {
      attacked: true,
      damaged: false,
      dodged: false,
      blocked: false,
    });
    expect(out.buffs).toHaveLength(0);
    expect(out.expired.map((b) => b.defId)).toEqual(['a']);
  });

  it('`stacks: 1`：只掉一层，还有层就不发 expired', () => {
    const def = makeBuffDef({ id: 'shield', stacking: { mode: 'stack', max: 3 }, consume: { on: ['onDamaged'], stacks: 1 } });
    let c: Combatant = makeCombatant();
    for (let i = 0; i < 3; i += 1) c = { ...c, buffs: applyBuff(c, def, 'player', i).buffs };
    const out = applyConsume(c, new Map([[def.id, def]]), {
      attacked: false,
      damaged: true,
      dodged: false,
      blocked: false,
    });
    expect(out.expired).toHaveLength(0);
    expect(out.stackChanged.map((b) => b.stacks)).toEqual([2]);
  });

  it('⚠️ 同一 tick 只消费一次（多段命中不叠加消耗）', () => {
    const def = makeBuffDef({ id: 'a', consume: { on: ['onDamaged'] } });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), def, 'player', 0).buffs };
    /** 事件里有两段伤害 —— 仍然只消费一次。 */
    const twoHits = [damageEvent(), damageEvent({ tick: 0 })];
    const facts = consumeFactsFor(victimWith([]), twoHits, 0);
    expect(applyConsume(c, new Map([[def.id, def]]), facts).expired).toHaveLength(1);
  });

  it('`independent` + `stacks: 1`：消费**最早过期**的那个实例', () => {
    /** ⚠️ 必须写 `stacks: 1`：不写 = 整条消失（同 defId 的**全部**实例）。
     *  "一次掉一层"在 `independent` 下就是"移除一个实例"。 */
    const def = makeBuffDef({
      id: 'poison',
      stacking: { mode: 'independent', max: 3 },
      duration: 5000,
      consume: { on: ['onDamaged'], stacks: 1 },
    });
    const c0 = makeCombatant();
    const first = applyBuff(c0, def, 'player', 0);
    const withTwo = { ...c0, buffs: applyBuff({ ...c0, buffs: first.buffs }, def, 'player', 30).buffs };
    expect(withTwo.buffs).toHaveLength(2);

    const out = applyConsume(withTwo, new Map([[def.id, def]]), {
      attacked: false,
      damaged: true,
      dodged: false,
      blocked: false,
    });
    expect(out.buffs).toHaveLength(1);
    expect(out.expired).toHaveLength(1);
    /** 留下的是**后施加**的那份（先过期的那份被消费掉了）。 */
    expect(out.buffs[0]?.appliedAtTick).toBe(30);
  });
});

describe('① `settleConsumableBuffs`（接线层）：没有消费类 buff 时是空操作', () => {
  it('无声明 → 不改状态、不发事件', () => {
    const plain = makeBuffDef({ id: 'plain' });
    const c = { ...makeCombatant(), buffs: applyBuff(makeCombatant(), plain, 'player', 0).buffs };
    const events: EventDef[] = [];
    const applied: Combatant[] = [];
    const consumed = settleConsumableBuffs({
      combatants: [toMutable(c)],
      tick: 0,
      events,
      buffs: new Map([[plain.id, plain]]),
      replaceCombatant: (u) => applied.push(u),
    });
    expect(consumed).toBe(0);
    expect(applied).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * ② 真引擎：四种消费 + 反面
 * ------------------------------------------------------------------ */

/** 敌方只出这一招：瞬发、**不打**（`hits: []`）。 */
const ENEMY_POKE: SkillDef = makeSkillDef({
  id: 'enemyPoke',
  nameKey: 'skill.attack.name',
  targeting: { mode: 'primaryEnemy' },
  hits: [{ at: 0, effects: [{ kind: 'damage', damage: { base: 30, canCrit: false, countsAsHit: true } }] }],
});

/** 玩家用这一招：瞬发、打敌人 10。 */
const PLAYER_POKE: SkillDef = makeSkillDef({
  id: 'playerPoke',
  nameKey: 'skill.attack.name',
  targeting: { mode: 'primaryEnemy' },
  hits: [{ at: 0, effects: [{ kind: 'damage', damage: { base: 10, canCrit: false, countsAsHit: true } }] }],
});

/**
 * 把一个或多个 buff 挂到玩家身上（直接改 options 的初始 combatant）。
 *
 * ⚠️ 多个 buff 必须**依次** `applyBuff`（每次都基于上一次的 buffs）——
 * 早先这版把每个 buff 都从"空 buffs"重新挂，于是第二个会**顶掉**第一个，
 * "闪避 buff 与格挡 buff 同时在场"那种反面测试因此测了个寂寞。
 */
function withPlayerBuff(
  buff: BuffDef | readonly BuffDef[],
  base: CreateBattleOptions = makeGoldenEngineOptions(),
): CreateBattleOptions {
  const player = base.combatants[0]!;
  const defs = Array.isArray(buff) ? buff : [buff];
  let buffs = player.buffs;
  for (const def of defs) buffs = applyBuff({ ...player, buffs }, def, player.id, 0).buffs;
  return {
    ...base,
    skills: new Map([...base.skills, [PLAYER_POKE.id, PLAYER_POKE], [ENEMY_POKE.id, ENEMY_POKE]]),
    buffs: new Map([...base.buffs, ...defs.map((def) => [def.id, def] as const)]),
    combatants: [
      { ...player, buffs },
      /** Boss 不动手：这一场的伤害只来自测试自己发的那一招。 */
      { ...base.combatants[1]!, behaviors: [] },
    ],
  };
}

function stacksOf(engine: BattleEngine, buffId: string): number {
  const ally = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
  return ally.buffs.filter((b) => b.defId === buffId).reduce((sum, b) => sum + b.stacks, 0);
}

/** 敌方对玩家打一下（`useSkill` 的 actorId = 敌方）。 */
function enemyAttacks(engine: BattleEngine, skillId = ENEMY_POKE.id): void {
  engine.tick([{ type: 'useSkill', skillId, atTick: 0 }], 'meiichiro');
  engine.tick([]);
  engine.drainEvents();
}

describe('② 真引擎：四种消费', () => {
  it('**被攻击消费**（`onAttack`）：我打出去一刀 → buff 消失', () => {
    const charge = makeBuffDef({ id: 'on-attack', consume: { on: ['onAttack'] } });
    const engine = new BattleEngine(withPlayerBuff(charge));
    expect(stacksOf(engine, charge.id)).toBe(1);

    /** 打空（Boss 不动手，这一刀确实造成了伤害）。 */
    engine.tick([{ type: 'useSkill', skillId: PLAYER_POKE.id, atTick: 0 }]);
    engine.tick([]);
    engine.drainEvents();
    expect(stacksOf(engine, charge.id)).toBe(0);
  });

  it('**被受击消费**（`onDamaged`）：我挨了一下 → buff 消失', () => {
    const ward = makeBuffDef({ id: 'on-damaged', consume: { on: ['onDamaged'] } });
    const engine = new BattleEngine(withPlayerBuff(ward));
    expect(stacksOf(engine, ward.id)).toBe(1);

    enemyAttacks(engine);
    expect(stacksOf(engine, ward.id)).toBe(0);
  });

  it('**被闪避消费**（`onDodge`）：我闪掉一击 → buff 消失（且我没掉血）', () => {
    const dodge = makeBuffDef({
      id: 'on-dodge',
      consume: { on: ['onDodge'] },
      flags: { invulnerable: true },
    });
    const engine = new BattleEngine(withPlayerBuff(dodge));
    const hpBefore = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.hp;

    enemyAttacks(engine);
    expect(stacksOf(engine, dodge.id)).toBe(0);
    /** 闪掉了 = 一点血都没掉（否则"闪避"这条测试没有意义）。 */
    expect(engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.hp).toBe(hpBefore);
  });

  it('**被格挡消费**（`onBlock`）：我挡下整击 → buff 消失', () => {
    const block = makeBuffDef({
      id: 'on-block',
      consume: { on: ['onBlock'] },
      /** 阈值 30 ≥ 敌方的 30 伤 ⇒ 整击作废（`≤N` 那一半）。 */
      flags: { damageThreshold: 30 },
    });
    const engine = new BattleEngine(withPlayerBuff(block));
    const hpBefore = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.hp;

    enemyAttacks(engine);
    expect(stacksOf(engine, block.id)).toBe(0);
    expect(engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.hp).toBe(hpBefore);
  });

  it('⚠️ 被闪避 ≠ 被格挡：闪掉的 buff 不会被 `onBlock` 消费，反之亦然', () => {
    /** 反面 1：挂了无敌（闪避），`onBlock` 的 buff 不该动。 */
    const dodgeBuff = makeBuffDef({ id: 'dodge-flag', flags: { invulnerable: true } });
    const blockOnly = makeBuffDef({ id: 'block-only', consume: { on: ['onBlock'] } });
    const a = new BattleEngine(withPlayerBuff(dodgeBuff, withPlayerBuff(blockOnly)));
    enemyAttacks(a);
    expect(stacksOf(a, blockOnly.id)).toBe(1);

    /** 反面 2：挂了阈值（格挡），`onDodge` 的 buff 不该动。 */
    const guardBuff = makeBuffDef({ id: 'guard-flag', flags: { damageThreshold: 30 } });
    const dodgeOnly = makeBuffDef({ id: 'dodge-only', consume: { on: ['onDodge'] } });
    const b = new BattleEngine(withPlayerBuff(guardBuff, withPlayerBuff(dodgeOnly)));
    enemyAttacks(b);
    expect(stacksOf(b, dodgeOnly.id)).toBe(1);
  });

  it('⚠️ 反面：**我攻击**不触发 `onDamaged`（"被受击"只认挨打）', () => {
    const ward = makeBuffDef({ id: 'on-damaged', consume: { on: ['onDamaged'] } });
    const engine = new BattleEngine(withPlayerBuff(ward));

    engine.tick([{ type: 'useSkill', skillId: PLAYER_POKE.id, atTick: 0 }]);
    engine.tick([]);
    engine.drainEvents();
    /** 这一刀打出去了（蓄势该被 onAttack 消耗），但"被受击"不该触发。 */
    expect(stacksOf(engine, ward.id)).toBe(1);
  });

  it('⚠️ 反面：**我挨打**不触发 `onAttack`（我只挨打，没打人）', () => {
    const fury = makeBuffDef({ id: 'on-attack', consume: { on: ['onAttack'] } });
    const engine = new BattleEngine(withPlayerBuff(fury));
    enemyAttacks(engine);
    expect(stacksOf(engine, fury.id)).toBe(1);
  });

  it('⚠️ 反面：被闪掉的那一击**不**触发 `onAttack`（没打中就不算打出去）', () => {
    const charge = makeBuffDef({ id: 'on-attack', consume: { on: ['onAttack'] } });
    const bossDodge = makeBuffDef({ id: 'boss-dodge', flags: { invulnerable: true } });
    const base = withPlayerBuff(charge);
    const boss = base.combatants[1]!;
    /** Boss 挂上无敌（"这一刀被闪掉了"）—— 用 `applyBuff` 造实例。 */
    const bossApplied = applyBuff({ ...boss, buffs: [] }, bossDodge, boss.id, 0);
    const engine = new BattleEngine({
      ...base,
      buffs: new Map([...base.buffs, [bossDodge.id, bossDodge]]),
      combatants: [base.combatants[0]!, { ...boss, buffs: bossApplied.buffs }],
    });

    engine.tick([{ type: 'useSkill', skillId: PLAYER_POKE.id, atTick: 0 }]);
    engine.tick([]);
    const events = engine.drainEvents();
    /** 先证明这一刀真的被闪了（否则下面的断言是空转）。 */
    expect(events.some((e) => e.kind === 'avoided' && e.targetId === 'meiichiro')).toBe(true);
    expect(stacksOf(engine, charge.id)).toBe(1);
  });

  it('⚠️ 反面：无敌在身、但**没挨打** → 不消费（"挡下一击"才是判据）', () => {
    const dodge = makeBuffDef({ id: 'on-dodge', consume: { on: ['onDodge'] }, flags: { invulnerable: true } });
    const engine = new BattleEngine(withPlayerBuff(dodge));
    /** 站着不动 60 tick（Boss 不动手）。 */
    for (let i = 0; i < 60; i += 1) engine.tick([]);
    engine.drainEvents();
    expect(stacksOf(engine, dodge.id)).toBe(1);
  });

  it('⚠️ 没有声明 `consume` 的 buff 在挨打 / 攻击后都还在（默认不受战斗事件影响）', () => {
    const plain = makeBuffDef({ id: 'plain', duration: Number.POSITIVE_INFINITY });
    const engine = new BattleEngine(withPlayerBuff(plain));
    enemyAttacks(engine);
    engine.tick([{ type: 'useSkill', skillId: PLAYER_POKE.id, atTick: 0 }]);
    engine.tick([]);
    engine.drainEvents();
    expect(stacksOf(engine, plain.id)).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * ③ 叠层：独立叠层 / 刷新 / 永久 1 层 / 上限 n 层
 * ------------------------------------------------------------------ */

/**
 * 用户单独列的四条叠层语义：
 *
 *   独立叠层  —— **每一层有自己的剩余时长**（见下面第一条的说明）
 *   刷新持续时间
 *   永久 1 层
 *   上限 n 层
 *
 * ⚠️ "独立叠层"在本引擎里就是 `stacking: { mode: 'independent' }`：
 * **每次施加是一个新实例**，每个实例有自己的 `expiresAtTick`。所以
 * "每层各自的剩余时间"不需要给 `BuffInstance` 加 `stackExpiries: number[]`
 * —— 那是把"N 个各自计时"硬塞进一个实例里，而引擎已经能表达 N 个实例
 * （`instanceId` 本来就是为此存在的，见 `types/buffs.ts` 的 `BuffInstance`）。
 *
 * 代价与取舍见 `tests/unit/buffConsume.test.ts` 的这一节说明与最终汇报。
 */
describe('③ 叠层：四种语义（真 `applyBuff` / 真引擎）', () => {
  it('**独立叠层**：同 defId 多实例，每份**自己的**剩余时长（先施加的先过期）', () => {
    resetBuffInstanceCounter();
    const def = makeBuffDef({ id: 'dot', stacking: { mode: 'independent', max: 5 }, duration: 1000 });
    const c0 = makeCombatant();
    const at0 = applyBuff(c0, def, 'player', 0);
    const at30 = applyBuff({ ...c0, buffs: at0.buffs }, def, 'player', 30);

    const instances = at30.buffs.filter((b) => b.defId === def.id);
    expect(instances).toHaveLength(2);
    /** ⚠️ 两份实例的过期时刻**不同** —— 这就是"每层独立计时"。 */
    expect(instances.map((b) => b.expiresAtTick).sort((a, b) => a - b)).toEqual([60, 90]);

    /** 第二份也跟着各自计时：到 tick 60 只掉第一份。 */
    const expireOne = instances.filter((b) => b.expiresAtTick <= 60);
    expect(expireOne).toHaveLength(1);
  });

  it('**上限 n 层**：`independent` 到上限后**替换最早的那个**（三个实例封顶）', () => {
    resetBuffInstanceCounter();
    const def = makeBuffDef({ id: 'dot', stacking: { mode: 'independent', max: 3 }, duration: 1000 });
    let c = makeCombatant();
    for (const tick of [0, 10, 20, 30]) {
      c = { ...c, buffs: applyBuff(c, def, 'player', tick).buffs };
    }
    const instances = c.buffs.filter((b) => b.defId === def.id);
    expect(instances).toHaveLength(3);
    /** 最早施加（tick 0）那份被顶掉，留下 10 / 20 / 30。 */
    expect(instances.map((b) => b.appliedAtTick).sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it('**上限 n 层**：`stack` 到上限不再加（层数封顶）', () => {
    const def = makeBuffDef({ id: 'a', stacking: { mode: 'stack', max: 3 } });
    let c = makeCombatant();
    for (let i = 0; i < 6; i += 1) c = { ...c, buffs: applyBuff(c, def, 'player', i).buffs };
    expect(c.buffs[0]?.stacks).toBe(3);
  });

  it('**刷新持续时间**：`refresh` 层数不变、到期时刻推后', () => {
    const def = makeBuffDef({ id: 'a', stacking: { mode: 'refresh' }, duration: 1000 });
    const c0 = makeCombatant();
    const first = applyBuff(c0, def, 'player', 0);
    const second = applyBuff({ ...c0, buffs: first.buffs }, def, 'player', 30);
    expect(second.stacks).toBe(1);
    expect(second.buffs[0]!.expiresAtTick).toBeGreaterThan(first.buffs[0]!.expiresAtTick);
  });

  it('**永久 1 层**：`duration: Infinity` + `maxStacks: 1` + 刷新（叠不上第 2 层，也不会过期）', () => {
    const forever = makeBuffDef({
      id: 'stance',
      duration: Number.POSITIVE_INFINITY,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
    });
    let c = makeCombatant();
    for (let i = 0; i < 5; i += 1) c = { ...c, buffs: applyBuff(c, forever, 'player', i * 100).buffs };
    expect(c.buffs).toHaveLength(1);
    expect(c.buffs[0]?.stacks).toBe(1);
    expect(c.buffs[0]?.expiresAtTick).toBe(Number.POSITIVE_INFINITY);
  });

  it('⚠️ 独立叠层的到期是**引擎真的会执行**的：`expireBuffs` 按每份自己的时刻删', () => {
    /**
     * ⚠️ 这条防的是"叠层只是数据形状、引擎不按它做"。真引擎每 tick 的
     * 第 3 步就是 `expireBuffs`（`encounterLifecycle.ts`），所以这里直接
     * 用引擎会用的那个纯函数 + `applyBuff` 造出的多实例：
     * 三份在 20 / 50 / 80 tick 到期，只有到点的那一份会被删掉。
     */
    resetBuffInstanceCounter();
    const dot = makeBuffDef({ id: 'dot', stacking: { mode: 'independent', max: 3 }, duration: 1200 });
    let c = makeCombatant();
    for (const at of [0, 30, 60]) c = { ...c, buffs: applyBuff(c, dot, 'player', at).buffs };

    /** 三份各自的到期时刻（tick）= 施加时刻 + 72（1200ms / (1000/60)）。 */
    expect(c.buffs.map((b) => b.expiresAtTick).sort((a, b) => a - b)).toEqual([72, 102, 132]);

    const at72 = expireBuffs(c.buffs, 72);
    expect(at72.buffs).toHaveLength(2);
    expect(at72.expired).toEqual(['dot']);
    /** 还没有到点的两份**不受影响**（不是"一起刷新/一起消失"）。 */
    const at80 = expireBuffs(at72.buffs, 80);
    expect(at80.buffs).toHaveLength(2);
    expect(at80.expired).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * ④ 契约：对账表与实现一致
 * ------------------------------------------------------------------ */

describe('④ 契约：`SUPPORTED_CONSUME_TRIGGERS` 与引擎实现必须一致', () => {
  it('四种触发逐条：对账表里的每一条引擎都真的会消费', () => {
    /**
     * ⚠️ 这条防的是"校验器说可以、引擎不照做"（最坏的漂移方向）。
     * 反面（引擎实现了但表里没有）会让内容被**误拦**，所以也一起查。
     */
    expect([...SUPPORTED_CONSUME_TRIGGERS].sort()).toEqual([
      'onAttack',
      'onBlock',
      'onDamaged',
      'onDodge',
    ]);

    const factsList = [
      { trigger: 'onAttack', facts: { attacked: true, damaged: false, dodged: false, blocked: false } },
      { trigger: 'onDamaged', facts: { attacked: false, damaged: true, dodged: false, blocked: false } },
      { trigger: 'onDodge', facts: { attacked: false, damaged: false, dodged: true, blocked: false } },
      { trigger: 'onBlock', facts: { attacked: false, damaged: false, dodged: false, blocked: true } },
    ] as const;

    for (const { trigger, facts } of factsList) {
      expect(SUPPORTED_CONSUME_TRIGGERS).toContain(trigger);
      const def: BuffDef = makeBuffDef({ id: `t-${trigger}`, consume: { on: [trigger] } });
      expect(matchedConsumeTriggers(def, facts), `${trigger} 没有被引擎消费`).toEqual([trigger]);
    }
  });

  it('⚠️ 实现侧的 `TRIGGER_SOURCES` 与对账表**逐字**对得上（源码扫描）', async () => {
    /**
     * 上面那条证不了"实现的表里有没有第五个名字" —— 多一个就会让
     * `SUPPORTED_CONSUME_TRIGGERS` 变成**子集**：校验器放行一条引擎不认的
     * 触发（或反过来误拦），正是 `capabilityAudit.ts` 反复强调的那种漂移。
     *
     * 所以这里读 `consume.ts` 的源码，把那张映射表的**键**抽出来对账 ——
     * 形状与 `tests/unit/run/engine.test.ts` 的"源码扫描断言"一致
     * （它也用 `readFileSync` 钉住"引擎只认哪几个 kind"）。
     */
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/buffs/consume.ts', 'utf8');
    const table = source.slice(source.indexOf('const TRIGGER_SOURCES'));
    const body = table.slice(0, table.indexOf('};'));
    const names = [...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
    expect(names).toEqual([...SUPPORTED_CONSUME_TRIGGERS].sort());
  });
});
