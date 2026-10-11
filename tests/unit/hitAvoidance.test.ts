/**
 * **被闪掉的命中不改变挨打者。**
 *
 * ==================================================================
 * 这个文件防的是什么（玩家反馈："我闪躲了还是倒地了"）
 * ==================================================================
 *
 * 傲慢的「碾压」把**伤害**与**倒地**放在**同一个 hit** 里，设计原话是
 * "闪掉了就不会倒地"（`bossPride.ts` 里那条注释）。但免疫判定原先只在
 * `damage` 分支里发生（`computeDamage` 返回 `avoided`），而 `grantBuff`
 * 走 `default` 分支、**无条件执行** —— 于是那条设计意图从来没被引擎
 * 实现过。
 *
 * ⚠️ 它当时能"看起来对"，是因为 `damage` 恰好排在 `grantBuff` **前面**。
 * 顺序一换、或者某个 hit 只有 buff 没有伤害，同一个 bug 会以另一种
 * 面貌出现。所以判据必须是"**整次命中判定一次**"，与效果顺序无关。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这段用例原先是塞进 `battle.test.ts` 的，那个文件因此到 710 行、超过
 * `AGENTS.md` §3 的上限。按那里的规则（**不许靠删/压注释解决，要拆
 * util 或横向切割**）把它切出来 —— 而且"命中免疫与附加效果的交互"
 * 本来就是一个独立话题，与 `battle.test.ts` 的其它用例没有交集。
 */
import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import type { BuffDef, SkillDef } from '../../src/core/types';
import { makeBuffDef, makeCombatant, makeSkillDef } from './helpers';

/** 「倒地」：只放行带 `dodge` tag 的技能（与真实内容同形）。 */
const KNOCKDOWN: BuffDef = makeBuffDef({
  id: 'knockdown',
  nameKey: 'debuff.knockdown.name',
  polarity: 'debuff',
  duration: 120,
  flags: { restrictToTags: ['dodge'] },
});

/** 「闪避无敌」：`flags.invulnerable` —— 判定层就是看这个。 */
const IFRAME: BuffDef = makeBuffDef({
  id: 'iframe',
  duration: 300,
  stacking: { mode: 'refresh' },
  flags: { invulnerable: true },
});

/** 让施法者**自己**挂一个 buff（模拟"Boss 给自己挂前摇标记"）。 */
const SELF_MARK: BuffDef = makeBuffDef({ id: 'self-mark', duration: 600 });

/**
 * 「横扫」：**伤害与倒地放在同一个 hit** —— 与傲慢的「碾压」同形。
 *
 * 抽成工厂而不是共享一个常量：每局引擎都要拿到**独立对象**
 * （`BattleEngine` 会持有它们，跨用例共享可变定义是自找的麻烦）。
 */
const mkSweep = (): SkillDef =>
  makeSkillDef({
    id: 'sweep',
    castTime: 0,
    tags: ['spell'],
    hits: [
      {
        at: 0,
        effects: [
          { kind: 'damage', damage: { base: 1, canCrit: false, countsAsHit: true } },
          { kind: 'grantBuff', buff: KNOCKDOWN },
        ],
      },
    ],
  });

/**
 * 「自挂标记」：**只**作用于施法者自己。
 *
 * 被闪掉时它**必须照旧生效** —— 否则这条修复就从"不误伤挨打者"
 * 变成了"把施法者自己的东西也吞掉"，那是另一种 bug。
 */
const mkSelfMark = (): SkillDef =>
  makeSkillDef({
    id: 'self-mark-skill',
    castTime: 0,
    tags: ['spell'],
    hits: [
      {
        at: 0,
        effects: [{ kind: 'grantBuff', target: { mode: 'self' }, buff: SELF_MARK }],
      },
    ],
  });

/** 闪避：瞬发、给自己挂无敌。 */
const mkDodge = (): SkillDef =>
  makeSkillDef({
    id: 'dodge',
    castTime: 0,
    tags: ['defensive', 'dodge'],
    abilities: [{ kind: 'grant', target: { mode: 'self' }, buff: IFRAME }],
  });

function mkEngine(): BattleEngine {
  const skills = [mkDodge(), mkSweep(), mkSelfMark()];
  return new BattleEngine({
    seed: 1,
    bossId: 'boss',
    combatants: [
      makeCombatant({ id: 'player', side: 'ally' }),
      makeCombatant({ id: 'boss', side: 'enemy' }),
    ],
    skills: new Map(skills.map((s) => [s.id, s])),
    buffs: new Map([
      [KNOCKDOWN.id, KNOCKDOWN],
      [IFRAME.id, IFRAME],
      [SELF_MARK.id, SELF_MARK],
    ]),
    baseStats: new Map(),
    passiveModifiers: new Map(),
  });
}

const playerOf = (e: BattleEngine) => e.snapshot.combatants.find((c) => c.id === 'player')!;
const bossOf = (e: BattleEngine) => e.snapshot.combatants.find((c) => c.id === 'boss')!;

/** 先闪，再让 Boss 打同一招。返回闪避后的状态与两次事件。 */
function dodgeThenSweep(): {
  readonly before: ReturnType<typeof playerOf>;
  readonly after: ReturnType<typeof playerOf>;
  readonly boss: ReturnType<typeof bossOf>;
  readonly events: ReturnType<BattleEngine['drainEvents']>;
} {
  const e = mkEngine();
  e.tick([{ type: 'useSkill', skillId: 'dodge', atTick: 0 }]);
  e.drainEvents();
  const before = playerOf(e);
  e.tick([{ type: 'useSkill', skillId: 'sweep', atTick: 1 }], 'boss');
  const events = e.drainEvents();
  return { before, after: playerOf(e), boss: bossOf(e), events };
}

describe('被闪掉的命中不改变挨打者', () => {
  /**
   * ⚠️ 这条**必须存在**：只断言"闪了没中"的话，一个"什么都不做"的
   * 引擎也能通过 —— 那种测试是假的。
   */
  it('对照组：不闪的时候，这一招真的会掉血 + 倒地', () => {
    const e = mkEngine();
    e.tick([{ type: 'useSkill', skillId: 'sweep', atTick: 0 }], 'boss');
    const evs = e.drainEvents();
    const player = playerOf(e);

    expect(player.resources.hp).toBeLessThan(player.caps.hp);
    expect(evs.some((ev) => ev.kind === 'buffApplied' && ev.buffId === 'knockdown')).toBe(true);
    expect(player.buffs.some((b) => b.defId === 'knockdown')).toBe(true);
  });

  it('【回归】闪掉了：既不掉血、也不倒地', () => {
    const { before, after, events } = dodgeThenSweep();

    expect(after.resources.hp, '闪掉了不该掉血').toBe(before.resources.hp);
    expect(
      events.some((ev) => ev.kind === 'buffApplied' && ev.buffId === 'knockdown'),
      '闪掉了不该触发倒地事件',
    ).toBe(false);
    expect(after.buffs.some((b) => b.defId === 'knockdown'), '闪掉了不该挂上倒地').toBe(false);
  });

  /**
   * ⚠️ 反向保护：修复不能矫枉过正。
   *
   * `target: { mode: 'self' }` 的效果作用于**施法者**，与"挨打者有没有
   * 被闪掉"无关 —— 他确实放了这一招。Boss 给自己挂前摇标记就走这条路，
   * 吞掉它会让读条/霸体一类的东西凭空消失。
   */
  it('施法者给自己挂的 buff，被闪掉时**照常生效**', () => {
    const e = mkEngine();
    e.tick([{ type: 'useSkill', skillId: 'dodge', atTick: 0 }]);
    e.drainEvents();
    expect(playerOf(e).buffs.some((b) => b.defId === 'iframe')).toBe(true);

    e.tick([{ type: 'useSkill', skillId: 'self-mark-skill', atTick: 1 }], 'boss');
    e.drainEvents();
    expect(
      bossOf(e).buffs.some((b) => b.defId === 'self-mark'),
      '施法者自己的 buff 不该被"挨打者闪掉了"连坐',
    ).toBe(true);
  });
});
