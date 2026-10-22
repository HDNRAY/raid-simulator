import { describe, expect, it } from 'vitest';

import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import { applyBuff } from '../../src/core/buffs';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { LAZY_BEHAVIORS, LAZY_BLUNT, LAZY_IDLE, LAZY_IDLE_PASSIVE, LAZY_IDLE_SKILL, LAZY_LOW_HP_RAGE, LAZY_LOW_HP_RAGE_SKILL, LAZY_PRESSURE, LAZY_RECENT_HIT, LAZY_SLEEP, LAZY_SLEEP_SKILL } from '../../src/data/lazyBoss';
import type { BuffDef, Combatant, SkillDef, StatKey } from '../../src/core/types';
import { logicMs } from '../../src/core/loopConstants';
import { makeCombatant, makeSkillDef } from './helpers';
import { descParamsOf } from '../../src/app/descParams';
import { descTemplateOf } from '../../src/app/keyRows';

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
  /**
   * Boss 的**基础属性**（缺省空）。
   *
   * ⚠️ 只有需要观察"乘算修正"的用例才传它 —— 例如「怠惰」的每层 ×2 需要一个
   * **非 0 的基数**才看得出来（`0 × 2^9 = 0`）。真实战斗里那个基数由
   * 「怠惰」被动技能的 `modifier` 提供（`LAZY_IDLE_SKILL`）。
   */
  readonly bossBase?: Partial<Record<StatKey, number>>;
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
      ['boss', args.bossBase ?? {}],
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
  /**
   * ⚠️ **不再挂"基础回血"那条 buff** —— 它已经被并进「怠惰」（用户：
   * "基础回血不是单独的被动，就是怠惰本身"）：基础那 1 点现在写在
   * `LAZY_IDLE_SKILL.abilities` 的 `modifier` 里，由开战装配接进
   * `passiveModifiers`（不是 buff）。
   *
   * ⚠️ 所以这些单测**测的是层数那条路**（buff 层数 → `2^层数`）；
   * "基础 1 点/秒"由 `bossFights` 的整场测试与 `§10.5` 的装配覆盖。
   */
  const HOST = [LAZY_IDLE_PASSIVE];

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

  it('🎯 挨一次打 → **回到 1 层**（用户："挨打回到1层"，不是清零）', () => {
    const e = engineWith({ boss: withBuff({}, HOST), skills: [hitSkill(5)] });
    /** 先让它涨到 3 层。 */
    for (let i = 0; i < 9 * 60 + 10; i += 1) e.tick([]);
    expect(idleStacks(e), '先涨起来').toBeGreaterThanOrEqual(3);

    e.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: e.snapshot.tick }], 'player');
    e.drainEvents();

    /**
     * ⚠️ 语义是"**回到 1 层**"（用户 2026-10-14 定），所以是 `removeBuff`
     * **之后再 grant 一层** —— 判据因此是 1，不是 0。
     */
    expect(idleStacks(e), '挨打之后回到 1 层').toBe(1);
  });

  it('回到 1 层之后**重新开始涨**（不是从此不涨了）', () => {
    const e = engineWith({ boss: withBuff({}, HOST), skills: [hitSkill(5)] });
    for (let i = 0; i < 4 * 60; i += 1) e.tick([]);
    e.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: e.snapshot.tick }], 'player');
    e.drainEvents();
    expect(idleStacks(e), '回到 1 层').toBe(1);

    for (let i = 0; i < 3 * 60 + 5; i += 1) e.tick([]);
    expect(idleStacks(e), '不挨打就继续涨').toBe(2);
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
    const e = engineWith({
      boss: withBuff({}, [LAZY_IDLE_PASSIVE]),
      /** ⚠️ 基数 1 = 真实战斗里「怠惰」被动技能给的那条 `modifier`（+1/秒）。 */
      bossBase: { hpRegen: 1 },
    });
    for (let i = 0; i < LAZY_IDLE.maxStacks * 3 * 60; i += 1) e.tick([]);
    expect(idleStacks(e), '层数封顶').toBe(LAZY_IDLE.maxStacks);

    /**
     * ⚠️ 现在那条 buff 是 **`op: 'mult'`（每层 ×2）** ⇒ 期望值不是"加法"而是
     * **指数**：`hpRegen = 基础 1 × 2^层数`（用户："2^层数"）。
     * 判据仍然**从内容取**（那条修正的声明值），不写死数字。
     */
    const perStackMult = (LAZY_IDLE.modifiers ?? [])
      .filter((m) => m.stat === 'hpRegen' && m.op === 'mult')
      .reduce((acc, m) => acc * (typeof m.value === 'number' ? m.value : 1), 1);
    expect(perStackMult, '内容里应当声明了每层 ×2').toBeGreaterThan(1);
    /**
     * ⚠️ **判据用比值**：基础那 1 点由「怠惰」**被动技能的 `modifier`** 提供
     * （`LAZY_IDLE_SKILL`），而本夹具只挂 buff、不走开战装配 ⇒ 这里的
     * `hpRegen` 只有"层数那条 buff"的贡献。所以验的是**每层各乘一次**：
     * 满层 / 单层 = `mult^(满层−1)`。
     */
    expect(e.statsOf('boss').hpRegen, '基数 1 × 每层各乘一次').toBeCloseTo(
      perStackMult ** LAZY_IDLE.maxStacks,
      6,
    );
  });

});

/* ================================================================== *
 * 2b. 「怠惰」的**两半**：基础那 1 点 + 层数那条buff
 * ================================================================== */

describe('「怠惰」的结构：基础回血**就是怠惰本身**', () => {
  it('🎯 「基础 1 点/秒」在**被动技能的 `modifier`** 里，不是第二个被动', () => {
    /**
     * 用户："**基础回血不是单独的被动，就是怠惰本身**"。
     *
     * ⚠️ 而且它**不能**写进那条 buff 的 `modifiers`：那个会**按层展开**，
     * 结果会是 `1 × 层数` 而不是那条 `mult` 给的 `2^层数`。
     */
    const mods = LAZY_IDLE_SKILL.abilities.filter((a) => a.kind === 'modifier');
    expect(mods.length, '「怠惰」应当带一条属性修正').toBe(1);
    const grants = LAZY_IDLE_SKILL.abilities.filter((a) => a.kind === 'grant');
    expect(grants.length, '「怠惰」还应当授予层数那条 buff').toBe(1);
  });

  it('🎯 「3 秒不挨打才涨」靠一条 3 秒的「刚挨打」标记判（不是靠时长）', () => {
    const tick = (LAZY_IDLE_PASSIVE.triggers ?? []).find((t) => t.on === 'onTick');
    expect(tick, '要有一条 onTick').toBeDefined();
    expect(tick?.cooldownMs, 'CD 就是那个"3 秒"').toBe(logicMs(30));
    expect(tick?.when).toEqual({
      kind: 'notHasBuff',
      who: 'self',
      buffId: LAZY_RECENT_HIT.id,
    });
    expect(LAZY_RECENT_HIT.duration, '标记活 3 秒').toBe(logicMs(30));
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

  it('🎯 「睡眠」是**轮转里的一条技能**（用户："睡眠技"）—— 不是被动挂的', () => {
    /**
     * ⚠️ 这条**纠正过我自己的实现**：第一版把睡眠做成了"一条被动每 12 秒
     * 挂个 debuff"，而用户说的是"**睡眠技**" —— 技能才有前摇（看得见）、
     * 才进轮转、才谈得上"可不可以打断"。
     */
    expect(LAZY_SLEEP_SKILL.kind).toBe('activeSkill');
    expect(LAZY_SLEEP_SKILL.castTime, '有前摇（不是瞬发）').toBeGreaterThan(0);
    expect(
      LAZY_SLEEP_SKILL.cooldown,
      '12 秒 > 睡眠的 10 秒（醒了才会再睡一次）',
    ).toBeGreaterThan(LAZY_SLEEP.duration);

    /** 它真的在轮转里（判据从内容取，不写死招式名）。 */
    const inRotation = LAZY_BEHAVIORS.some(
      (b) => b.kind === 'rotation' && b.steps.some((step) => step.skillId === LAZY_SLEEP_SKILL.id),
    );
    expect(inRotation, '「睡眠」必须在轮转里').toBe(true);

    /** ⚠️ 而且那一招**不造成伤害**（它只负责把人睡过去）。 */
    const damages = LAZY_SLEEP_SKILL.hits.flatMap((h) => h.effects).filter((e) => e.kind === 'damage');
    expect(damages, '「睡眠」不该有伤害效果').toEqual([]);
  });

  it('玩家睡着的那些 tick 里，Boss 一次都没出手', () => {
    const e = engineWith({
      /**
       * ⚠️ **用真的行为表**：睡眠现在由「睡眠」那条**技能**产生
       * （以前挂在被动上），所以这里不能再手写一份轮转 —— 直接跑它的
       * `LAZY_BEHAVIORS`，让"睡着"真的发生。
       */
      boss: withBuff(
        {
          caps: { hp: 500, energy: 0, douqi: 0 },
          resources: { hp: 250, energy: 0, douqi: 0 },
          behaviors: LAZY_BEHAVIORS,
        },
        [LAZY_IDLE_PASSIVE],
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

/* ================================================================== *
 * 4. 两招都按**已损失的血量百分比**加成（2026-10-14 用户改的口径）
 * ================================================================== */

describe('「残血增伤」是**一条被动**（不是塞在技能里的第二段伤害）', () => {
  const damageSpecs = (skill: { readonly hits: readonly { readonly effects: readonly unknown[] }[] }) =>
    skill.hits
      .flatMap((h) => h.effects)
      .filter(
        (e): e is { readonly kind: 'damage'; readonly damage: { readonly base: unknown } } =>
          typeof e === 'object' && e !== null && (e as { kind?: string }).kind === 'damage',
      );

  it('🎯 两招各自**只有一段**伤害，而且 base 是**数字**', () => {
    /**
     * ⚠️ 2026-10-14 改：加成**不再**塞在技能里（那会让面板上看不见它、
     * 而且一次攻击算两段命中）。现在只留一段伤害。
     *
     * ⚠️ base 必须是**数字**：`descParams.firstDamageOf` 只认数字，
     * 写成表达式会把详情里的 `{damage}` 变成**原样占位符**（静默坏）。
     */
    for (const skill of [LAZY_BLUNT, LAZY_PRESSURE]) {
      const specs = damageSpecs(skill);
      expect(specs.length, `${skill.id} 只该有一段伤害`).toBe(1);
      expect(typeof specs[0]?.damage.base, `${skill.id} 的 base 必须是数字`).toBe('number');
    }
  });

  it('🎯 加成住在**被动**里：增伤是一个读"已损失血量"的表达式', () => {
    /**
     * 用户 2026-10-14："伤害受 已损失血量加成 这个 **能改成单独被动吗**"
     * ⇒ 判据是**机制**（谁提供加成），不是数值：
     *   - 有一条被动技能，它授予那条隐藏 buff
     *   - 那条 buff 的 `damageBoost` 修正值是 **Expr**（不是数字）
     */
    const grants = LAZY_LOW_HP_RAGE_SKILL.abilities.filter((a) => a.kind === 'grant');
    expect(grants.length, '「残血增伤」应当是一条 grant 被动').toBe(1);
    expect(
      LAZY_LOW_HP_RAGE_SKILL.abilities.some(
        (a) => a.kind === 'grant' && a.buff === LAZY_LOW_HP_RAGE,
      ),
      '它授予的必须是那条动态增伤 buff',
    ).toBe(true);
    /** ⚠️ 2026-10-22：`damageMultBoost` 删了 ⇒ 看 `damageBoost` 那条修正的值。 */
    const boost = LAZY_LOW_HP_RAGE.modifiers?.find((m) => m.stat === 'damageBoost');
    expect(typeof boost?.value, '增伤必须是表达式').toBe('object');
  });

  it('⚠️ **端到端**：它剩一半血 ⇒ 打出来的伤害是满血时的 **1.5 倍**', () => {
    /**
     * 这条才是"引擎那条路真的通了"的证明（`core/combat/dynamicBoost.ts`）。
     * 判据写成**比值**：1.5 是用户给的口径（"少了 50% 血 伤害加成就是 50%"）。
     */
    /**
     * ⚠️ 用本文件自己的夹具 `engineWith`（它直接返回 `BattleEngine`）——
     * 玩家的血从快照里读，不要另开一套读数口径。
     */
    const playerHp = (e: ReturnType<typeof engineWith>): number =>
      e.snapshot.combatants.find((c) => c.id === 'player')?.resources.hp ?? 0;
    const damageAt = (hpRatio: number): number => {
      const e = engineWith({
        boss: withBuff(
          {
            caps: { hp: 900, energy: 0, douqi: 0 },
            resources: { hp: Math.max(1, Math.round(900 * hpRatio)), energy: 0, douqi: 0 },
          },
          [LAZY_LOW_HP_RAGE],
        ),
      });
      const before = playerHp(e);
      e.tick([{ type: 'useSkill', skillId: 'lazy-blunt', atTick: e.snapshot.tick }], 'boss');
      /**
       * 跑满前摇：钝击 1.0 秒，而 `tick()` 是 **60Hz 物理刻度**
       * （逻辑步每 6 tick 一次）⇒ 需要 60+ 帧（给足余量取 70）。
       */
      for (let i = 0; i < 70; i += 1) e.tick([]);
      e.drainEvents();
      return before - playerHp(e);
    };
    const full = damageAt(1);
    const half = damageAt(0.5);
    expect(full, '满血时应当有伤害').toBeGreaterThan(0);
    expect(half / full, '少一半血 ⇒ 伤害 ×1.5').toBeCloseTo(1.5, 1);
  });

  it('⚠️ 详情里的 `{damage}` **仍然取得到**（第一段是数字的直接后果）', () => {
    for (const skill of [LAZY_BLUNT, LAZY_PRESSURE]) {
      const template = descTemplateOf(skill.descKey ?? '');
      expect(template, `${skill.id} 没有文案模板`).toBeTruthy();
      const params = descParamsOf(skill, template ?? '', 500);
      expect(params?.damage, `${skill.id} 的 {damage} 取不到了`).toEqual(expect.any(Number));
    }
  });
});
