import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { makeBoss, makePlayer } from '../../src/data/units';
import { ALL_QIJI } from '../../src/data/qiji';
import type { Combatant, StatKey } from '../../src/core/types';
import type { EventDef } from '../../src/core/events';
import { interruptCasts } from '../../src/core/combat/interrupt';

/**
 * **派生技的两条炁机**（2026-10-22）—— 真引擎实测，只测**接线与效果**。
 *
 * 用户原话：
 * > 冲现在用一次按钮就消失了对不对，加一个炁机 使用5次冲解锁，**冲按2次才消失**
 * > 击 的炁机改成 **击 可以打断**，也是 **5次击解锁**
 *
 * 数据形状（名字 / 解锁条件 / 池子计数）在 `qiji.test.ts`；这里钉的是：
 *   1. 「冲」窗口**按层数**走：1 层用一次、2 层用两次、第三次不可用
 *   2. 「冲波再起」的触发器**真的把窗口挂成 2 层**
 *   3. 「一击破势」让「击」**真的打断** Boss 的读条（`interruptSuccess`）
 */

const BY_ID = new Map(ALL_QIJI.map((q) => [q.id, q]));

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

function qiji(id: string): (typeof ALL_QIJI)[number] {
  const def = BY_ID.get(id);
  if (def === undefined) throw new Error(`没有这条炁机：${id}`);
  return def;
}

const WINDOW_ID = 'daixuan-chong-window';

/** 造一局：玩家（可选：预挂 buff）+ 一个**不动手**的 Boss。 */
function battle(args: {
  readonly player: Combatant;
  readonly bossBehaviors?: boolean;
}): BattleEngine {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const boss0 = makeBoss('wrath');
  const boss: Combatant =
    args.bossBehaviors === true
      ? boss0
      : { ...boss0, behaviors: [] };
  const engine = new BattleEngine({
    combatants: [args.player, boss],
    seed: 20261022,
    bossId: 'wrath',
    timeLimitMs: 600_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', {}],
      ['wrath', {}],
    ]),
    passiveModifiers: new Map(),
  });
  engine.drainEvents();
  return engine;
}

/** 玩家身上那个窗口 buff 的**层数**（没有则 0）。 */
function windowStacks(engine: BattleEngine): number {
  const ally = engine.snapshot.combatants.find((c) => c.side === 'ally');
  return ally?.buffs.find((b) => b.defId === WINDOW_ID)?.stacks ?? 0;
}

/** 用一次「冲」，返回这一下有没有真的用出来（`skillUsed`）。 */
function useChong(engine: BattleEngine): boolean {
  engine.tick([{ type: 'useSkill', skillId: 'chong', atTick: engine.snapshot.tick }], 'player');
  const events: readonly EventDef[] = engine.drainEvents();
  return events.some((e) => e.kind === 'skillUsed' && e.skillId === 'chong');
}

/** 给玩家预挂 N 层「冲」的窗口（模拟"开窗"那一步）。 */
function playerWithWindow(stacks: number): Combatant {
  const base = makePlayer('daixuan');
  const window = ALL_BUFFS.find((b) => b.id === WINDOW_ID);
  if (window === undefined) throw new Error('没有冲的窗口 buff');
  let combatant: Combatant = { ...base, resources: { ...base.resources, energy: 100 } };
  for (let i = 0; i < stacks; i += 1) {
    combatant = { ...combatant, buffs: applyBuff(combatant, window, 'player', 0).buffs };
  }
  return combatant;
}

describe('「冲」的窗口按层数消耗', () => {
  it('1 层：用一次就用完，第二次不可用', () => {
    const engine = battle({ player: playerWithWindow(1) });
    expect(windowStacks(engine)).toBe(1);
    expect(useChong(engine)).toBe(true);
    expect(windowStacks(engine)).toBe(0);
    expect(useChong(engine)).toBe(false);
  });

  it('2 层：连用两次，第三次不可用', () => {
    const engine = battle({ player: playerWithWindow(2) });
    expect(windowStacks(engine)).toBe(2);
    expect(useChong(engine)).toBe(true);
    expect(windowStacks(engine)).toBe(1);
    expect(useChong(engine)).toBe(true);
    expect(windowStacks(engine)).toBe(0);
    expect(useChong(engine)).toBe(false);
  });

  it('窗口夹在 2 层（`maxStacks`）：给 3 次也只有 2 层', () => {
    const engine = battle({ player: playerWithWindow(3) });
    expect(windowStacks(engine)).toBe(2);
  });
});

describe('「冲波再起」：开窗时挂 2 层', () => {
  it('触发器（按住弹的节奏）把窗口从 0 直接挂到 2 层', () => {
    const def = qiji('chongBoZaiQi');
    const passive = def.passiveBuffs?.[0];
    expect(passive?.triggers?.length).toBe(1);

    const base = makePlayer('daixuan');
    const rhythm = ALL_BUFFS.find((b) => b.id === 'daixuan-tan-rhythm');
    if (rhythm === undefined) throw new Error('没有弹的节奏 buff');
    /** 玩家带着这条炁机的被动 + 「弹」的节奏 ⇒ 触发器有条件成立。 */
    let combatant: Combatant = base;
    for (const buff of [passive!, rhythm]) {
      combatant = { ...combatant, buffs: applyBuff(combatant, buff, 'player', 0).buffs };
    }

    const engine = battle({ player: combatant });
    /** 触发器是 `onTick`：推进几 tick 让它跑一次。 */
    for (let i = 0; i < 20; i += 1) {
      engine.tick([]);
      engine.drainEvents();
    }
    expect(windowStacks(engine)).toBe(2);
  });
});

describe('「一击破势」：「击」命中打断读条', () => {
  /** 「击」要 combo 窗口才可用 —— 预挂一层（与「后发先至」开窗同一条）。 */
  function playerWithStrikeKit(withQiji: boolean): Combatant {
    const base = makePlayer('linwanfeng');
    const combo = ALL_BUFFS.find((b) => b.id === 'combo-window');
    if (combo === undefined) throw new Error('没有 combo 窗口 buff');
    const passive = qiji('yiJiPoShi').passiveBuffs?.[0];
    if (passive === undefined) throw new Error('「一击破势」没有被动 buff');
    let combatant: Combatant = { ...base, resources: { ...base.resources, douqi: 100 } };
    const buffs = withQiji ? [combo, passive] : [combo];
    for (const buff of buffs) {
      combatant = { ...combatant, buffs: applyBuff(combatant, buff, 'player', 0).buffs };
    }
    return combatant;
  }

  /**
   * 让 Boss 进入读条，返回它正在读的那一招。
   *
   * ⚠️ **直接给它下指令**（`engine.tick([...], 'wrath')`），不靠 AI 的轮转时机 ——
   * 第一版等 AI 自己出手，400 tick 里它一招都没起（轮转有间隔、还有前置 buff），
   * 于是断言"Boss 应该在读条"先红了 ✗。测的是"击能不能打断"，不是"AI 何时出手"。
   */
  function startBossCast(engine: BattleEngine): string | undefined {
    engine.tick([{ type: 'useSkill', skillId: 'wrath-smash', atTick: engine.snapshot.tick }], 'wrath');
    engine.drainEvents();
    const boss = engine.snapshot.combatants.find((c) => c.side === 'enemy');
    return boss?.casts[0]?.skillId;
  }

  /** 用一次「击」，把接下来几十 tick 的事件都收回来（命中可能在后续 tick 结算）。 */
  function useStrike(engine: BattleEngine): readonly EventDef[] {
    engine.tick([{ type: 'useSkill', skillId: 'strike', atTick: engine.snapshot.tick }], 'player');
    const events: EventDef[] = [...engine.drainEvents()];
    for (let i = 0; i < 40; i += 1) {
      engine.tick([]);
      events.push(...engine.drainEvents());
    }
    return events;
  }

  it('带炁机：击命中 ⇒ 打断成功', () => {
    const engine = battle({ player: playerWithStrikeKit(true), bossBehaviors: true });
    const cast = startBossCast(engine);
    expect(cast, 'Boss 应该在读条').toBeDefined();

    const events = useStrike(engine);
    expect(events.some((e) => e.kind === 'damage'), '「击」应该打中').toBe(true);
    expect(events.some((e) => e.kind === 'interruptSuccess')).toBe(true);
    const boss = engine.snapshot.combatants.find((c) => c.side === 'enemy');
    expect(boss?.casts).toHaveLength(0);
  });

  /**
   * ⚠️ **霸体读条不该被「击」打断**（用户 2026-10-22："击的打断为什么要能
   * 打断霸体？？？"）—— `force: true` 已经去掉，所以这条是**反向**守卫：
   * 「击」只买得到"打断普通读条"这一档，破霸体是「破」的特权。
   */
  /**
   * ⚠️ **霸体挡得住「击」**（用户 2026-10-22："击的打断为什么要能打断霸体？？？"）。
   *
   * 直接测 `interruptCasts` 这条**唯一实现**：目标身上有 `interruptImmune`
   * （霸体）时，打断**一定失败** —— 与 `force` 无关（引擎刻意不看它，见
   * `core/combat/interrupt.ts` 的注释）。所以「一击破势」买到的只是
   * "打断普通读条"这一档。
   */
  it('霸体目标：interruptCasts 一定失败', () => {
    const armor = ALL_BUFFS.find((b) => b.id === 'boss-heavy-armor');
    if (armor === undefined) throw new Error('没有霸体 buff');
    const boss = makePlayer('linwanfeng');
    const armored = { ...boss, buffs: applyBuff(boss, armor, boss.id, 0).buffs };
    /** 给它一条读条，好让"打断"有对象（否则测不出是不是被霸体挡住的）。 */
    const casting = {
      ...armored,
      casts: [
        {
          skillId: 'wrath-smash',
          startedAtTick: 0,
          castTimeMs: 800,
          resolvedHits: 0,
          interruptible: true,
        },
      ],
    };
    const events: EventDef[] = [];
    const hit = interruptCasts({
      tick: 1,
      target: casting,
      actorId: 'player',
      skillId: 'strike',
      force: true,
      replace: () => {},
      push: (e) => events.push(e),
    });
    expect(hit, '霸体时打断必须失败（连 force 也不行）').toBe(false);
    expect(events.some((e) => e.kind === 'interruptImmune')).toBe(true);
  });

  it('不带炁机：击命中不会打断（对照）', () => {
    const engine = battle({ player: playerWithStrikeKit(false), bossBehaviors: true });
    const cast = startBossCast(engine);
    expect(cast, 'Boss 应该在读条').toBeDefined();

    const events = useStrike(engine);
    expect(events.some((e) => e.kind === 'damage'), '「击」应该打中').toBe(true);
    expect(events.some((e) => e.kind === 'interruptSuccess')).toBe(false);
  });
});
