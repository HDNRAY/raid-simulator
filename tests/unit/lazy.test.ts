import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import {
  LAZY_BASE_REGEN,
  LAZY_IDLE,
  LAZY_IDLE_PASSIVE,
  LAZY_SLEEP,
  LAZY_SLEEP_PASSIVE,
} from '../../src/data/lazyBoss';
import type { BuffDef, Combatant, SkillDef, StatKey } from '../../src/core/types';
import { logicMs } from '../../src/core/loopConstants';
import { makeCombatant, makeSkillDef } from './helpers';

/**
 * **「懒惰」的机制** + 这一轮新加的 `Ability: 'removeBuff'`。
 *
 * 三件事各自都有一条"错了会静默"的理由：
 *
 *   1. **挨打清零**（`removeBuff`）：它依赖**新加的那条能力**。写在
 *      `then` 里而执行器不认它时，**不报错、也不清零** —— 于是"回血
 *      一直涨"，而画面上只是"它回得有点快"。
 *   2. **3 秒一层**：间隔由触发器的 `cooldownMs` 管。写错成 `logicMs(3)`
 *      会变成"每 0.3 秒一层"（0.1 秒刻度），20 秒叠满。
 *   3. **基础那 1 点/秒与层数无关**：它与「怠惰」是两个 buff。
 *      合成一个的话"0 层"会变成**完全不回血**。
 *
 * ⚠️ 数值（层数上限 9、每层 +1）一律**从内容里取**，不在这里钉死。
 */

const i18nKeys = new Set([
  ...ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])]),
  ...ALL_BUFFS.map((b) => b.nameKey),
]);

function engineWith(args: {
  readonly boss: Partial<Combatant>;
  readonly skills?: readonly SkillDef[];
}): BattleEngine {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS, ...(args.skills ?? [])], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  return new BattleEngine({
    combatants: [
      makeCombatant({
        id: 'player',
        side: 'ally',
        caps: { hp: 1000, energy: 0, douqi: 0 },
        resources: { hp: 1000, energy: 0, douqi: 0 },
      }),
      makeCombatant({ id: 'boss', side: 'enemy', ...args.boss }),
    ],
    seed: 4321,
    bossId: 'boss',
    timeLimitMs: 600_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', {}],
      ['boss', {}],
    ]),
    passiveModifiers: new Map(),
  });
}

function withBuff(partial: Partial<Combatant>, defs: readonly BuffDef[]): Partial<Combatant> {
  const bare = makeCombatant({ id: 'boss', side: 'enemy', ...partial });
  const buffs = defs.reduce(
    (c, def) => ({ ...c, buffs: applyBuff(c, def, c.id, 0).buffs }),
    bare,
  ).buffs;
  return { ...partial, buffs };
}

const bossOf = (e: BattleEngine): Combatant | undefined =>
  e.snapshot.combatants.find((c) => c.id === 'boss');

const idleStacks = (e: BattleEngine): number =>
  bossOf(e)?.buffs
    .filter((b) => b.defId === LAZY_IDLE.id)
    .reduce((sum, b) => sum + b.stacks, 0) ?? 0;

/** 一条"打一下"的招（玩家用）。 */
function hitSkill(damage: number): SkillDef {
  return makeSkillDef({
    id: 'test-hit',
    nameKey: 'skill.attack.name',
    castTime: 0,
    hits: [
      { at: 0, effects: [{ kind: 'damage', damage: { base: damage, canCrit: false, countsAsHit: true } }] },
    ],
  });
}

/* ================================================================== *
 * 1. 「怠惰」：不挨打就涨、挨打清零
 * ================================================================== */

describe('「怠惰」：每 3 秒没挨打 +1 层，**挨一次打清零**（新能力 `removeBuff`）', () => {
  const HOST = [LAZY_IDLE_PASSIVE, LAZY_BASE_REGEN];

  it('不挨打就一层层涨；**每层之间约 3 秒**', () => {
    /**
     * ⚠️ 实测过的事实（写在这里，免得下一个人重算）：
     *   - **第一个 tick 就 +1 层**（触发器第一次没有历史 CD）—— 这是既有
     *     语义（"挂上就生效"），不是 bug
     *   - 之后**每 180 个 tick（3 秒）** +1 层（由 `cooldownMs: logicMs(30)` 给）
     *   - 到 `maxStacks` 封顶
     */
    const e = engineWith({ boss: withBuff({}, HOST) });

    e.tick([]);
    expect(idleStacks(e), '第一次立刻 +1（没有历史 CD）').toBe(1);

    for (let i = 0; i < 3 * 60 - 2; i += 1) e.tick([]);
    expect(idleStacks(e), '还没到 3 秒').toBe(1);

    for (let i = 0; i < 3; i += 1) e.tick([]);
    expect(idleStacks(e), '刚过 3 秒 → 第 2 层').toBe(2);
  });

  it('🎯 挨一次打 → **层数清零**（这条钉住新加的 `removeBuff` 能力）', () => {
    const e = engineWith({ boss: withBuff({}, HOST), skills: [hitSkill(5)] });
    /** 先让它涨到 3 层。 */
    for (let i = 0; i < 9 * 60 + 10; i += 1) e.tick([]);
    expect(idleStacks(e), '先涨起来').toBeGreaterThanOrEqual(3);

    e.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: e.snapshot.tick }], 'player');
    e.drainEvents();

    expect(idleStacks(e), '挨打之后应该一层不剩').toBe(0);
  });

  it('清零之后**重新开始涨**（不是从此不涨了）', () => {
    const e = engineWith({ boss: withBuff({}, HOST), skills: [hitSkill(5)] });
    for (let i = 0; i < 4 * 60; i += 1) e.tick([]);
    e.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: e.snapshot.tick }], 'player');
    e.drainEvents();
    expect(idleStacks(e)).toBe(0);

    for (let i = 0; i < 3 * 60 + 5; i += 1) e.tick([]);
    expect(idleStacks(e)).toBe(1);
  });

  it(`层数**封顶**（内容声明的 ${LAZY_IDLE.maxStacks} 层）`, () => {
    const e = engineWith({ boss: withBuff({}, HOST) });
    /** 跑足够久让它超过上限。 */
    for (let i = 0; i < (LAZY_IDLE.maxStacks + 3) * 3 * 60; i += 1) e.tick([]);
    expect(idleStacks(e)).toBe(LAZY_IDLE.maxStacks);
  });

  it('⚠️ **「怠惰」的修正是按层展开的**（9 层 = 9 份 +1，不是只算一份）', () => {
    /**
     * ⚠️ 这条以前是**已知缺口**："`BuffDef.modifiers` 不按层展开，所以 9 层
     * 只贡献 +1" —— 2026-10-14 补上了按层展开（`core/combat/stats.ts`），
     * 所以断言现在收紧成**真实行为**。
     *
     * ⚠️ 判据从**内容**取（`LAZY_IDLE.modifiers` 的声明值 × 层数），
     * 不写死数字 —— 数值调了这条照样绿，机制坏了才红。
     */
    const e = engineWith({ boss: withBuff({}, [LAZY_IDLE_PASSIVE, LAZY_BASE_REGEN]) });
    for (let i = 0; i < LAZY_IDLE.maxStacks * 3 * 60; i += 1) e.tick([]);
    expect(idleStacks(e), '层数封顶').toBe(LAZY_IDLE.maxStacks);

    const perStack = (LAZY_IDLE.modifiers ?? [])
      .filter((m) => m.stat === 'hpRegen')
      .reduce((sum, m) => sum + (typeof m.value === 'number' ? m.value : 0), 0);
    const base = (LAZY_BASE_REGEN.modifiers ?? [])
      .filter((m) => m.stat === 'hpRegen')
      .reduce((sum, m) => sum + (typeof m.value === 'number' ? m.value : 0), 0);
    expect(perStack, '内容里应当声明了每层 +1 回血').toBeGreaterThan(0);
    expect(e.statsOf('boss').hpRegen, '基础 + 每层各一份').toBeCloseTo(
      base + perStack * LAZY_IDLE.maxStacks,
      6,
    );
  });

});

/* ================================================================== *
 * 2. 基础回血：与层数无关的那 1 点/秒
 * ================================================================== */

describe('基础回血：**永远** 1 点/秒（与「怠惰」层数无关）', () => {
  it('没有任何「怠惰」层数时，静置 1 秒也回 1 点', () => {
    /**
     * ⚠️ `hpRegen` 的口径是**每秒**，引擎按逻辑步（每 6 tick）结算 ——
     * 而"每秒 1 点"落到每步是 **0.1**，走 `regenDebt` 的**小数额度**
     * 攒够 1 个整点才真回 1 点。所以第 **55** 个 tick 才会看到 +1。
     * 这条钉住"那 0.1 没被丢掉"。
     */
    const e = engineWith({
      boss: withBuff(
        { caps: { hp: 100, energy: 0, douqi: 0 }, resources: { hp: 50, energy: 0, douqi: 0 } },
        [LAZY_BASE_REGEN],
      ),
    });
    expect(idleStacks(e)).toBe(0);
    expect(e.statsOf('boss').hpRegen).toBe(1);

    for (let i = 0; i < 55; i += 1) e.tick([]);
    expect(bossOf(e)?.resources.hp, '10 个逻辑步 = 1 秒 = 1 点').toBe(51);
  });
});

/* ================================================================== *
 * 3. 睡眠：锁死 + 它不攻击
 * ================================================================== */

describe('「睡眠」：玩家锁死，且**它也不攻击**', () => {
  it('睡眠是 `actionLock`（玩家不能行动）', () => {
    expect(LAZY_SLEEP.flags?.actionLock).toBe(true);
    expect(LAZY_SLEEP.duration, '10 秒 = logicMs(100)').toBe(logicMs(100));
  });

  it('「睡眠」由被动按 12 秒的节拍挂上，而**不是**轮转里的一招', () => {
    /**
     * ⚠️ 它必须是"突然睡着"而不是"看到它读条"：
     * 所以它是 `onTick` 触发器（`LAZY_SLEEP_PASSIVE`），而玩家挂到的
     * debuff 是 `LAZY_SLEEP`。两者**不是同一个 buff**。
     */
    const triggers = LAZY_SLEEP_PASSIVE.triggers ?? [];
    expect(triggers.map((t) => t.on)).toEqual(['onTick']);
    expect(triggers[0]?.cooldownMs, '12 秒 > 睡眠的 10 秒（醒了才会再睡）').toBe(logicMs(120));
  });

  it('玩家睡着的那些 tick 里，Boss 一次都没出手', () => {
    const e = engineWith({
      boss: withBuff(
        {
          caps: { hp: 500, energy: 0, douqi: 0 },
          resources: { hp: 250, energy: 0, douqi: 0 },
          behaviors: [
            {
              kind: 'rotation',
              steps: [
                { skillId: 'lazy-pressure', when: { kind: 'notHasBuff', who: 'target', buffId: LAZY_SLEEP.id } },
                { skillId: 'lazy-blunt', when: { kind: 'notHasBuff', who: 'target', buffId: LAZY_SLEEP.id } },
              ],
            },
          ],
        },
        [LAZY_SLEEP_PASSIVE, LAZY_BASE_REGEN],
      ),
    });

    /** 跑 12 秒：必然经过"挂上睡眠 → 睡 10 秒"这一段。 */
    let sleptTicks = 0;
    let bossActedWhileAsleep = 0;
    for (let i = 0; i < 12 * 60; i += 1) {
      const sleepingBefore = bossOf(e) === undefined ? false : playerSleeping(e);
      e.tick([]);
      if (sleepingBefore) {
        sleptTicks += 1;
        const events = e.drainEvents();
        if (events.some((ev) => ev.kind === 'castStarted' && ev.sourceId === 'boss')) {
          bossActedWhileAsleep += 1;
        }
      } else {
        e.drainEvents();
      }
    }

    expect(sleptTicks, '这一轮里它应该睡过一段').toBeGreaterThan(0);
    expect(bossActedWhileAsleep, '睡眠期间它不该出手').toBe(0);
  });
});

/** 玩家身上有没有「睡眠」（判据只看 id）。 */
function playerSleeping(e: BattleEngine): boolean {
  return (
    e.snapshot.combatants
      .find((c) => c.id === 'player')
      ?.buffs.some((b) => b.defId === LAZY_SLEEP.id) ?? false
  );
}
