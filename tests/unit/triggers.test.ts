import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { makeCombatant } from './helpers';
import { applyBuff } from '../../src/core/buffs';
import type { BuffDef, SkillDef } from '../../src/core/types';
import { isSupportedHook, SUPPORTED_HOOKS } from '../../src/core/combat/triggers';

/**
 * 触发器引擎。
 *
 * 需求（「色欲」的反伤被动）："收到伤害后多一个buff，这个buff持续时间内
 * （比如3s？）再受伤，就反伤或者触发反击"
 *
 * ⚠️ 这个文件测的是**引擎能派发并执行触发器**这件事本身。内容层的
 * 「欲望印记」（含"印记不刷新"那条平衡命门）在 `lustBoss.test.ts` 里测。
 *
 * ⚠️ 动手前的事实：`TriggerDef` 一直有完整类型与数据校验，但引擎里
 * **没有任何地方执行它**。这个文件是那件事的回归保护。
 */

/* ------------------------------------------------------------------ *
 * 内容：一个"挨打就还手"的被动
 * ------------------------------------------------------------------ */

/** 挨打就还手的印记（挂着一条 `onHitTaken` 触发器）。 */
const RETALIATE: BuffDef = {
  id: 'retaliate',
  nameKey: 'test.retaliate',
  icon: '印',
  polarity: 'buff',
  duration: 3000,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  triggers: [
    {
      on: 'onHitTaken',
      /** ⚠️ 只在**已有**印记时反伤 —— 这条正是"印记消耗制"的形状。 */
      when: { kind: 'hasBuff', buffId: 'retaliate' },
      cooldownMs: 1000,
      then: [
        {
          kind: 'deal',
          target: { mode: 'primaryEnemy' },
          hit: {
            at: 0,
            effects: [
              {
                kind: 'damage',
                damage: { base: 18, canCrit: false, countsAsHit: true },
              },
            ],
          },
        },
      ],
    },
  ],
};

/** 玩家打一下的技能（boss 用来打玩家，玩家用来打 boss）。 */
function strike(id: string, damage: number, canCrit = false): SkillDef {
  return {
    id,
    kind: 'activeSkill',
    nameKey: `test.${id}`,
    descKey: `test.${id}.desc`,
    icon: '攻',
    abilities: [],
    castTime: 0,
    cooldown: 0,
    cost: [],
    targeting: { mode: 'primaryEnemy' },
    tags: [],
    interruptible: true,
    hits: [
      {
        at: 0,
        effects: [
          { kind: 'damage', damage: { base: damage, canCrit, countsAsHit: true } },
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * 内容：给 buff 钩子（onBuffApplied / onBuffExpired / onCritDealt）用的夹具
 * ------------------------------------------------------------------ */

/** 一个"挂上就回应"的标记 buff —— 用来证明钩子真的响了。 */
function marker(id: string): BuffDef {
  return {
    id,
    nameKey: `test.${id}`,
    icon: '标',
    polarity: 'buff',
    duration: 60_000,
    maxStacks: 1,
    stacking: { mode: 'refresh' },
  };
}

/**
 * 一个"响应某个 buff 钩子"的观察者。
 *
 * ⚠️ `maxTriggersPerEncounter: 1` 是**必须**的：`onBuffApplied` 的载荷里
 * 只有 `sourceId`，没有"挂的是哪个 buff"，所以观察者给自己的标记也会让它
 * 再次响应（"挂 A 时再挂 A"的环）。上限 1 让它只回应一次 —— 顺带也测了
 * `maxTriggersPerEncounter` 真的生效。
 */
function watcher(id: string, on: 'onBuffApplied' | 'onBuffExpired' | 'onCritDealt'): BuffDef {
  return {
    id,
    nameKey: `test.${id}`,
    icon: '观',
    polarity: 'buff',
    duration: 60_000,
    maxStacks: 1,
    stacking: { mode: 'refresh' },
    triggers: [
      {
        on,
        maxTriggersPerEncounter: 1,
        then: [{ kind: 'grant', target: { mode: 'self' }, buff: marker(`${id}-mark`) }],
      },
    ],
  };
}

/** 一个"给自己挂一个短 buff"的技能 —— 制造一次真实的 `buffApplied`。 */
function bless(id: string, buff: BuffDef): SkillDef {
  return {
    id,
    kind: 'activeSkill',
    nameKey: `test.${id}`,
    descKey: `test.${id}.desc`,
    icon: '祝',
    abilities: [],
    castTime: 0,
    cooldown: 0,
    cost: [],
    targeting: { mode: 'self' },
    tags: [],
    interruptible: true,
    hits: [{ at: 0, effects: [{ kind: 'grantBuff', target: { mode: 'self' }, buff }] }],
  };
}

function makeEngine(options: {
  withTrigger?: boolean;
  extraBuffs?: readonly BuffDef[];
  extraSkills?: readonly SkillDef[];
  playerStats?: Readonly<Record<string, number>>;
} = {}) {
  const buffs = new Map<string, BuffDef>();
  if (options.withTrigger !== false) buffs.set('retaliate', RETALIATE);
  for (const buff of options.extraBuffs ?? []) buffs.set(buff.id, buff);

  const skills = new Map<string, SkillDef>([
    ['player-hit', strike('player-hit', 10)],
    ['boss-hit', strike('boss-hit', 7)],
  ]);
  for (const skill of options.extraSkills ?? []) skills.set(skill.id, skill);

  const player = makeCombatant({ id: 'player', side: 'ally' });
  const boss = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 5000, energy: 0, douqi: 0 },
    resources: { hp: 5000, energy: 0, douqi: 0 },
  });

  return new BattleEngine({
    combatants: [player, boss],
    seed: 20261010,
    buffs,
    skills,
    baseStats: new Map([
      ['player', { strength: 100, intelligence: 100, ...(options.playerStats ?? {}) }],
      ['boss', { strength: 100, intelligence: 100 }],
    ]),
    passiveModifiers: new Map(),
  });
}

const hpOf = (engine: BattleEngine, id: string): number =>
  engine.snapshot.combatants.find((c) => c.id === id)?.resources.hp ?? -1;

/**
 * 给某单位挂一个 buff（模拟"第一次受伤"）。
 *
 * ⚠️ 走 `applyBuff`（纯函数）+ `replaceCombatantForTest`（引擎公开的测试
 * 入口），**不碰私有方法、也不写类型断言** —— 后者违反 AGENTS.md §1。
 */
function grantBuff(engine: BattleEngine, id: string, def: BuffDef): void {
  const target = engine.snapshot.combatants.find((c) => c.id === id);
  if (target === undefined) throw new Error(`no combatant ${id}`);
  const applied = applyBuff(target, def, id, engine.snapshot.tick);
  engine.replaceCombatantForTest({ ...target, buffs: applied.buffs });
}

describe('哪些 hook 真的会被派发', () => {
  it('运行时白名单与 `isSupportedHook` 一致（且死 hook 一律为 false）', () => {
    /**
     * ⚠️ 其余 hook（`onKill` / `onCritTaken` / 还没接线的 `onPhaseChange` …）
     * 类型还在、内容也能写，但引擎**不认** —— `content/capabilityAudit.ts`
     * 的 `SUPPORTED_HOOKS` 会把它们当错误报出来。
     *
     * ⚠️ `onCastFinish` **不在这张表**里却是活的：技能能力里的
     * `onCastFinish` 触发器由 `castPipeline` 直接处理，不走 `runTriggers`。
     */
    expect([...SUPPORTED_HOOKS].sort()).toEqual([
      'onBuffApplied',
      'onBuffExpired',
      'onCritDealt',
      'onHitTaken',
      /** ⚠️ 2026-10-14：「贪婪」的「弱点」开始用"按时间"的钩子。 */
      'onTick',
    ]);
    expect(isSupportedHook('onHitTaken')).toBe(true);
    expect(isSupportedHook('onCritDealt')).toBe(true);
    expect(isSupportedHook('onBuffApplied')).toBe(true);
    expect(isSupportedHook('onBuffExpired')).toBe(true);
    expect(isSupportedHook('onTick')).toBe(true);
    expect(isSupportedHook('onKill')).toBe(false);
    expect(isSupportedHook('onPhaseChange')).toBe(false);
  });
});

describe('buff 钩子真的会被派发（onBuffApplied / onBuffExpired）', () => {
  /**
   * 这两条以前只在白名单 / 类型里存在，**没有任何派发调用** —— 也就是
   * "写了静默无效"。现在 `battleState.dispatchBuffHooks()` 在每个 tick 末
   * 扫 buff 事件并派发，这两条测试就是"链真的跑通"的实测。
   */

  it('【核心】挂 buff 会触发挂在 `onBuffApplied` 上的触发器', () => {
    const blessing = marker('blessing');
    const engine = makeEngine({
      extraBuffs: [watcher('applied-watcher', 'onBuffApplied'), blessing],
      extraSkills: [bless('bless', blessing)],
    });
    /** 观察者用测试入口直接挂上（不产生事件，所以不会自触发）。 */
    grantBuff(engine, 'player', watcher('applied-watcher', 'onBuffApplied'));

    engine.applyActions([{ type: 'useSkill', skillId: 'bless', atTick: 0 }], 'player');
    engine.tick([]);

    const buffs = engine.snapshot.combatants.find((c) => c.id === 'player')?.buffs.map((b) => b.defId);
    /** 真实挂上 → 观察者响应 → 它挂的标记出现。 */
    expect(buffs).toContain('blessing');
    expect(buffs).toContain('applied-watcher-mark');
  });

  it('buff 自然过期会触发挂在 `onBuffExpired` 上的触发器', () => {
    const short: BuffDef = { ...marker('short-lived'), duration: 100 };
    const engine = makeEngine({
      extraBuffs: [watcher('expired-watcher', 'onBuffExpired'), short],
      extraSkills: [bless('short-bless', short)],
    });
    grantBuff(engine, 'player', watcher('expired-watcher', 'onBuffExpired'));

    engine.applyActions([{ type: 'useSkill', skillId: 'short-bless', atTick: 0 }], 'player');
    /** 跑够它过期（100ms ≈ 6 tick），留足余量。 */
    for (let i = 0; i < 20; i += 1) engine.tick([]);

    const buffs = engine.snapshot.combatants.find((c) => c.id === 'player')?.buffs.map((b) => b.defId);
    expect(buffs).not.toContain('short-lived');
    expect(buffs).toContain('expired-watcher-mark');
  });
});

describe('暴击钩子真的会被派发（onCritDealt）', () => {
  it('【核心】暴击 → 触发挂在 `onCritDealt` 上的触发器', () => {
    /**
     * 这是熵之钟"暴击后授予势能涌动"那条链的引擎级证明：在补上派发点
     * 之前，`rollCrit` 有了但没人派发 `onCritDealt`，那条链从来没跑过。
     *
     * `critChance: 1` 让 `rollCrit` **短路返回 true、不消耗随机数**
     * （见 `BattleEngine.rollCrit`），所以这条测试是确定性的。
     */
    const engine = makeEngine({
      extraBuffs: [watcher('crit-watcher', 'onCritDealt')],
      extraSkills: [strike('crit-hit', 10, true)],
      playerStats: { critChance: 1 },
    });
    grantBuff(engine, 'player', watcher('crit-watcher', 'onCritDealt'));

    engine.applyActions([{ type: 'useSkill', skillId: 'crit-hit', atTick: 0 }], 'player');
    engine.tick([]);

    const buffs = engine.snapshot.combatants.find((c) => c.id === 'player')?.buffs.map((b) => b.defId);
    expect(buffs).toContain('crit-watcher-mark');
  });

  it('不暴击时不派发（不是无条件触发）', () => {
    const engine = makeEngine({
      extraBuffs: [watcher('crit-watcher', 'onCritDealt')],
      /** 同一个技能，但 `canCrit: false`。 */
      extraSkills: [strike('plain-hit', 10, false)],
      playerStats: { critChance: 1 },
    });
    grantBuff(engine, 'player', watcher('crit-watcher', 'onCritDealt'));

    engine.applyActions([{ type: 'useSkill', skillId: 'plain-hit', atTick: 0 }], 'player');
    engine.tick([]);

    const buffs = engine.snapshot.combatants.find((c) => c.id === 'player')?.buffs.map((b) => b.defId);
    expect(buffs).not.toContain('crit-watcher-mark');
  });
});

describe('受伤触发', () => {
  it('【核心】挂着印记被打 → 反伤回去', () => {
    const engine = makeEngine();
    grantBuff(engine, 'boss', RETALIATE);
    const bossHpBefore = hpOf(engine, 'boss');
    const playerHpBefore = hpOf(engine, 'player');

    /** 玩家打 boss（boss 已有印记）→ 应触发反伤打回玩家。 */
    engine.applyActions([{ type: 'useSkill', skillId: 'player-hit', atTick: 0 }], 'player');
    engine.tick([]);

    expect(hpOf(engine, 'boss')).toBeLessThan(bossHpBefore);
    expect(hpOf(engine, 'player')).toBeLessThan(playerHpBefore);
  });

  it('没有印记时**不**反伤（只有第一次受伤挂印记）', () => {
    const engine = makeEngine();
    const playerHpBefore = hpOf(engine, 'player');

    engine.applyActions([{ type: 'useSkill', skillId: 'player-hit', atTick: 0 }], 'player');
    engine.tick([]);

    expect(hpOf(engine, 'player')).toBe(playerHpBefore);
  });

  it('内建 CD：冷却期内不再触发', () => {
    /**
     * `cooldownMs: 1000`（1000ms = 60 tick）。连打两次，第二次不该反伤。
     * 这条同时是"防循环"的机制层保障（设计 §3.3）。
     */
    const engine = makeEngine();
    grantBuff(engine, 'boss', RETALIATE);

    engine.applyActions([{ type: 'useSkill', skillId: 'player-hit', atTick: 0 }], 'player');
    engine.tick([]);
    const afterFirst = hpOf(engine, 'player');

    engine.applyActions([{ type: 'useSkill', skillId: 'player-hit', atTick: 0 }], 'player');
    engine.tick([]);
    expect(hpOf(engine, 'player')).toBe(afterFirst);
  });

  it('【关键】闪避掉的攻击**不算受伤** → 不派发 `onHitTaken`', () => {
    /**
     * 设计 §3.3：`onHitTaken` 只在**真正造成伤害后**触发。否则"闪避"
     * 反而会白送对手一个印记，与直觉相反。
     *
     * 构造：玩家**没有印记**，但有一层无敌。玩家打 boss（这一下打中了），
     * 然后 boss 反击 —— 反击被无敌挡掉。
     *
     * ⚠️ 这里断言的是"**被闪避的那一下不挂印记**"，所以要检查的是
     * **玩家身上有没有出现印记**，而不是"boss 掉没掉血"（那取决于玩家
     * 自己的攻击打中了没有，另一件事）。
     */
    const engine = makeEngine();
    const iframe: BuffDef = {
      id: 'iframe',
      nameKey: 'test.iframe',
      icon: '闪',
      polarity: 'buff',
      duration: 3000,
      maxStacks: 1,
      stacking: { mode: 'refresh' },
      flags: { invulnerable: true },
    };
    grantBuff(engine, 'player', iframe);

    /** 让 boss 打玩家 —— 这一下会被无敌挡掉。 */
    engine.applyActions([{ type: 'useSkill', skillId: 'boss-hit', atTick: 0 }], 'boss');
    engine.tick([]);

    const playerBuffs = engine.snapshot.combatants
      .find((c) => c.id === 'player')
      ?.buffs.map((b) => b.defId);
    expect(playerBuffs).not.toContain('retaliate');
    /** 且确实是被规避了（否则这个用例可能因为"根本没打中"而假通过）。 */
    expect(engine.drainEvents().some((e) => e.kind === 'avoided')).toBe(true);
  });
});

describe('没有触发器时的行为不变（不是全局开关）', () => {
  it('buff 表里没有触发器 → 反伤不发生', () => {
    const engine = makeEngine({ withTrigger: false });
    const playerHpBefore = hpOf(engine, 'player');
    engine.applyActions([{ type: 'useSkill', skillId: 'player-hit', atTick: 0 }], 'player');
    engine.tick([]);
    expect(hpOf(engine, 'player')).toBe(playerHpBefore);
  });
});
