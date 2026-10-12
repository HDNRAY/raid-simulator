import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { douqiFromDamage } from '../../src/core/combat/holds';
import { DOUQI_PER_DAMAGE, DOUQI_PER_INTERNAL_DAMAGE } from '../../src/data/balance';
import { makeGoldenEngineOptions } from '../golden/fixtures';

/**
 * "伤害 → 缠"的**系数 / 取整 / 谁能拿到**。
 *
 * ==================================================================
 * 一、系数减半（2026-10-12）
 * ==================================================================
 *
 * 用户原话："**造成伤害 攒的缠 改成一半**" —— 系数 **1 → 0.5**。
 * 规则是**对称**的：`core/combat/hitResolution.ts` 对**造成伤害的人**与
 * **受到伤害的人**各发一份，两侧共用这一个系数。
 *
 * ==================================================================
 * 二、取整必须是显式的 floor（"同类精度陷阱"）
 * ==================================================================
 *
 * 0.5 系数会产生 `.5`，而缠是整数资源。如果沿用原来的 `Math.round`：
 *
 *   `Math.round(1 × 0.5) = 1` —— **1 点伤害给满 1 缠**，小伤害凭空翻倍。
 *
 * 这和「卸」那次 `Math.round` 把 `0.3` 吃成 0 是同一类"静默舍入改数值"。
 * 现在的口径是**向下取整**（`holds.ts` 的 `douqiFromDamage`），
 * 本文件把它连同"45 → 22"这种边界一起钉死。
 *
 * ==================================================================
 * 三、⚠️ 用缠的技能不给**施放者**回缠（规则 C，2026-10-12）
 * ==================================================================
 *
 * 用户原话："但是 劈 现在产生的缠 太多了···" → 选 (C)。
 *
 * 问题：回缠按**伤害**算 ⇒ 伤害越高退得越多。代价 50 缠的「劈」（45 伤）
 * 打出后会退回 `45 × 0.5 = 22` —— **退回自己 44% 的代价**，用缠的大招
 * 一直在**自我返还**。调数值治不了本（以后出更强的招会反复出现）。
 *
 * 规则：**技能的代价里含 `douqi` → 施放者这一击不回缠**。
 *   - ⚠️ **只管施放者**；**挨打方照旧回缠**（"挨打攒缠"是另一件事）。
 *   - ⚠️ 判据是"**代价含 douqi**"，不是"技能贵"、不是技能名。
 *
 * 从 `tests/golden/encounter.test.ts` 的"炁按伤害换算"旁边独立出来：
 * 那边测的是"接线了没有"（> 0），这里测的是**换算与归属规则本身**。
 */

/** 标准夹具，但清空 Boss 行为 —— 只测换算，不希望 Boss 的伤害混进来。 */
function quietOptions(): ReturnType<typeof makeGoldenEngineOptions> {
  const options = makeGoldenEngineOptions();
  return {
    ...options,
    combatants: [options.combatants[0]!, { ...options.combatants[1]!, behaviors: [] }],
  };
}

/**
 * 玩家用 `startDouqi` 点缠起手施放 `skillId`，返回**这一击**：
 * 点数变化（含付代价与回缠）与打到 Boss 的伤害。
 *
 * Boss 已被清空行为，所以玩家的缠只会因"付代价 + 回缠"变化。
 */
function castByPlayer(
  skillId: string,
  startDouqi: number,
): { readonly douqiDelta: number; readonly damageToBoss: number } {
  const options = quietOptions();
  const playable = options.combatants[0]!;
  const engine = new BattleEngine({
    ...options,
    combatants: [
      { ...playable, resources: { ...playable.resources, douqi: startDouqi } },
      options.combatants[1]!,
    ],
  });
  const before = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.douqi;

  let damageToBoss = 0;
  const collect = (): void => {
    for (const event of engine.drainEvents()) {
      if (event.kind === 'damage' && event.targetId === 'meiichiro') damageToBoss += event.amount;
    }
  };

  engine.tick([{ type: 'useSkill', skillId, atTick: 0 }]);
  collect();
  for (let i = 0; i < 200; i += 1) {
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    if (player.casts.length === 0) break;
    engine.tick();
    collect();
  }

  const after = engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.douqi;
  return { douqiDelta: after - before, damageToBoss };
}

describe('伤害 → 缠：系数与取整', () => {
  it('系数 = **0.5**（原先 1 的一半）', () => {
    expect(DOUQI_PER_DAMAGE).toBe(0.5);
    /** 引擎按**内部刻度**乘，当前 `DISPLAY_SCALE = 1` 所以两者相等。 */
    expect(DOUQI_PER_INTERNAL_DAMAGE).toBe(DOUQI_PER_DAMAGE);
  });

  it('⚠️ 取整 = **向下取整** floor（不是 `Math.round`）', () => {
    expect(douqiFromDamage(45)).toBe(22); // 22.5 → 22（Math.round 会给 23）
    expect(douqiFromDamage(10)).toBe(5);
    expect(douqiFromDamage(2)).toBe(1);
    expect(douqiFromDamage(1)).toBe(0); // Math.round(0.5) 会给 1（小伤害凭空翻倍）
    expect(douqiFromDamage(0)).toBe(0);
  });

  it('引擎实测：「斩」（10 伤）命中一次 → 出手方正好 +5 缠', () => {
    const engine = new BattleEngine(quietOptions());
    expect(engine.snapshot.combatants.find((c) => c.side === 'ally')!.resources.douqi).toBe(0);

    let dealt = 0;
    engine.tick([{ type: 'useSkill', skillId: 'attack', atTick: 0 }]);
    engine.drainEvents();
    for (let i = 0; i < 120; i += 1) {
      const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
      if (player.casts.length === 0) break;
      engine.tick();
      for (const event of engine.drainEvents()) {
        if (event.kind === 'damage' && event.targetId === 'meiichiro') dealt += event.amount;
      }
    }

    expect(dealt, '「斩」打出的伤害').toBe(10);
    const after = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    expect(after.resources.douqi).toBe(douqiFromDamage(dealt));
    expect(after.resources.douqi).toBe(5);
  });
});

describe('规则 (C)：用缠的技能不给**施放者**回缠', () => {
  it('「劈」「轰」「凝」不回缠（代价含 50 缠）', () => {
    const cases = [
      { skillId: 'pi', label: '劈', damage: 45 },
      { skillId: 'blast', label: '轰', damage: 30 },
      { skillId: 'focus', label: '凝', damage: 0 },
    ] as const;

    for (const c of cases) {
      const r = castByPlayer(c.skillId, 100);
      expect(r.damageToBoss, `「${c.label}」打出的伤害`).toBe(c.damage);
      /**
       * 只扣了代价 50，**一点都没退回**。
       * 改这条规则之前，「劈」是 `-50 + 22 = -28`（退回 44% 的代价）。
       */
      expect(r.douqiDelta, `「${c.label}」不该给施放者回缠`).toBe(-50);
    }
  });

  it('「斩」「拳」照旧回缠（代价只有炁）', () => {
    /** 「斩」10 伤 → floor(10 × 0.5) = 5。 */
    expect(castByPlayer('attack', 0)).toEqual({ douqiDelta: 5, damageToBoss: 10 });
    /** 「拳」6 伤 → floor(6 × 0.5) = 3。 */
    expect(castByPlayer('punch', 0)).toEqual({ douqiDelta: 3, damageToBoss: 6 });
  });

  it('挨打方照旧回缠 —— 用缠的 Boss 招打玩家，玩家仍回缠（施放者不回）', () => {
    const options = makeGoldenEngineOptions();
    const boss = options.combatants[1]!;
    const engine = new BattleEngine({
      ...options,
      combatants: [
        options.combatants[0]!,
        {
          ...boss,
          caps: { ...boss.caps, douqi: 1000 },
          resources: { ...boss.resources, douqi: 1000 },
          /**
           * ⚠️ 让 Boss 用**林晚风的「劈」**（代价 50 缠 / 45 伤）打玩家：
           * 施放者（Boss）付了缠，挨打方（玩家）没付。
           */
          behaviors: [{ kind: 'rotation', steps: [{ skillId: 'pi', gapMs: 500 }] }],
        },
      ],
    });

    let paidCasts = 0;
    let playerHit = false;
    for (let t = 0; t < 60 * 15 && !playerHit; t += 1) {
      engine.tick();
      for (const event of engine.drainEvents()) {
        if (event.kind === 'castStarted' && event.skillId === 'pi') paidCasts += 1;
        if (event.kind === 'damage' && event.targetId === 'player') playerHit = true;
      }
    }

    expect(playerHit, 'Boss 必须真的打中过玩家').toBe(true);
    expect(paidCasts, 'Boss 至少付过一次代价').toBeGreaterThan(0);
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally')!;
    const bossAfter = engine.snapshot.combatants.find((c) => c.side === 'enemy')!;
    /** 挨打方（玩家）照旧按伤害回缠：45 伤 → **22**。 */
    expect(player.resources.douqi, '挨打方照旧回缠').toBe(douqiFromDamage(45));
    /** 施放者（Boss）付了 `50 × 次数`，**一次都没退回来**。 */
    expect(bossAfter.resources.douqi, '施放者付了缠且不回缠').toBe(1000 - 50 * paidCasts);
  });
});
