import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { comboWindowsFor, type ComboWindowSpec } from '../../src/core/combat/comboWindow';
import { applyBuff } from '../../src/core/buffs';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { GUARD_THRESHOLD } from '../../src/data/balance';
import { COMBO_WINDOW } from '../../src/data/kits/combo';
import { GUARD_THRESHOLD_BUFF } from '../../src/data/kits/linwanfeng';
import { FLASH_IFRAME } from '../../src/data/kits/kaili';
import type { BuffDef, Combatant, EventDef, SkillDef, StatKey } from '../../src/core/types';
import { makeCombatant, makeSkillDef } from './helpers';

/**
 * **派生窗口的产出者**（P3）：`core/combat/comboWindow.ts` 的判定 +
 * `comboWindowHandler.ts` 的引擎接线。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §5.2（炁机接回派生）。
 *
 * ==================================================================
 * 这一份测试守的是两件**会静默坏掉**的事
 * ==================================================================
 *
 *   1. **"成功"的定义**：截=打断成功 / 卸=挡下整击 / 闪=无敌吃掉一击。
 *      写错一条，那个炁机就永远解锁不了 —— 而界面上只是"一直不出现"。
 *   2. **没有炁机时必须是空操作**：`comboWindows` 不传时一条事件都不产生。
 *      这条是硬验收（单场 / 自由模式 / 黄金重放逐位不变）。
 */

const i18nKeys = new Set(
  ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])])
    .concat(ALL_BUFFS.map((b) => b.nameKey))
    .concat([COMBO_WINDOW.nameKey]),
);

/** 一条 spec（默认「截」那条：只认打断）。 */
function spec(overrides: Partial<ComboWindowSpec> = {}): ComboWindowSpec {
  return { buffId: 'combo-window', sourceSkillId: 'jie', ...overrides };
}

describe('comboWindowsFor：纯判定（事件 → 该开哪些窗口）', () => {
  it('没有产出者 → 恒空（默认路径的空操作）', () => {
    const events: readonly EventDef[] = [
      { kind: 'interruptSuccess', tick: 1, sourceId: 'player', targetId: 'boss', skillId: 'x', sourceSkillId: 'jie' },
    ];
    expect(comboWindowsFor(events, [])).toEqual([]);
  });

  it('打断成功且 `sourceSkillId` 对得上 → 开窗口', () => {
    const opened = comboWindowsFor(
      [
        {
          kind: 'interruptSuccess',
          tick: 1,
          sourceId: 'player',
          targetId: 'boss',
          skillId: 'boss-cleave',
          sourceSkillId: 'jie',
        },
      ],
      [spec()],
    );
    expect(opened).toEqual(['combo-window']);
  });

  it('⚠️ 用**别的招式**打断 → 不开（③ 的意义：`sourceSkillId` 能把截和破分开）', () => {
    const opened = comboWindowsFor(
      [
        {
          kind: 'interruptSuccess',
          tick: 1,
          sourceId: 'player',
          targetId: 'boss',
          skillId: 'boss-cleave',
          sourceSkillId: 'break',
        },
      ],
      [spec()],
    );
    expect(opened).toEqual([]);
  });

  it('没有 `sourceSkillId` 的打断（触发器产的）→ 不开', () => {
    const opened = comboWindowsFor(
      [{ kind: 'interruptSuccess', tick: 1, sourceId: 'player', targetId: 'boss', skillId: 'x' }],
      [spec()],
    );
    expect(opened).toEqual([]);
  });

  it('第二条通道：`viaBuffId` 对得上 → 开（「卸」/「闪」走它）', () => {
    const opened = comboWindowsFor(
      [{ kind: 'avoided', tick: 1, sourceId: 'boss', targetId: 'player', skillId: 'x', reason: 'immune', viaBuffId: 'guard' }],
      [spec({ sourceSkillId: 'guard', viaBuffId: 'guard' })],
    );
    expect(opened).toEqual(['combo-window']);
  });

  it('⚠️ 第二条通道**只认指定的那个 buff** —— 「避」不该给「闪派生击」开窗', () => {
    /**
     * 这是 `viaBuffId` 存在的**全部理由**：「闪」与「避」共用
     * `flags.invulnerable`，只看 flag 分不出来（而它们属于不同角色）。
     */
    const opened = comboWindowsFor(
      [{ kind: 'avoided', tick: 1, sourceId: 'boss', targetId: 'player', skillId: 'x', reason: 'immune', viaBuffId: 'dodge-iframe' }],
      [spec({ sourceSkillId: 'flash', viaBuffId: 'flash-iframe' })],
    );
    expect(opened).toEqual([]);
  });

  it('⚠️ 没写 `viaBuffId` 的 spec **不认** `avoided`（「截」不该因为挨打而开窗）', () => {
    const opened = comboWindowsFor(
      [{ kind: 'avoided', tick: 1, sourceId: 'boss', targetId: 'player', skillId: 'x', reason: 'immune', viaBuffId: 'guard' }],
      [spec()],
    );
    expect(opened).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 「卸」的第二半：只减伤（`>N` 的平减）也算
   * ---------------------------------------------------------------- */

  /** 一条 `damage` 事件（`thinned` = 被阈值磨掉的量，见 `computeDamage`）。 */
  function damageEvent(overrides: Partial<Extract<EventDef, { kind: 'damage' }>> = {}): EventDef {
    return {
      kind: 'damage',
      tick: 1,
      sourceId: 'boss',
      targetId: 'player',
      amount: 30,
      crit: false,
      absorbed: 0,
      thinned: 0,
      overkill: 0,
      skillId: 'boss-cleave',
      ...overrides,
    };
  }

  it('⚠️ 用户放宽的那条：**只减伤**（`thinned > 0`）也算「卸」吸收到了 → 开窗', () => {
    const opened = comboWindowsFor(
      [damageEvent({ amount: 15, thinned: 15, viaBuffId: 'guard' })],
      [spec({ sourceSkillId: 'guard', viaBuffId: 'guard' })],
    );
    expect(opened).toEqual(['combo-window']);
  });

  it('⚠️ 普通挨打（`thinned` 为 0 / 没有 `viaBuffId`）→ **不开**（"没按卸不算"）', () => {
    expect(
      comboWindowsFor([damageEvent({ amount: 30 })], [
        spec({ sourceSkillId: 'guard', viaBuffId: 'guard' }),
      ]),
    ).toEqual([]);
  });

  it('⚠️ `thinned > 0` 但**不是**那个 buff 磨的 → 不开（"是谁吸收的"必须对得上）', () => {
    const opened = comboWindowsFor(
      [damageEvent({ amount: 15, thinned: 15, viaBuffId: 'boss-plating' })],
      [spec({ sourceSkillId: 'guard', viaBuffId: 'guard' })],
    );
    expect(opened).toEqual([]);
  });

  it('⚠️ 只有 `thinned > 0`、**没有** `viaBuffId` → 不开（量对不上人，不能猜）', () => {
    expect(
      comboWindowsFor([damageEvent({ amount: 15, thinned: 15 })], [
        spec({ sourceSkillId: 'guard', viaBuffId: 'guard' }),
      ]),
    ).toEqual([]);
  });

  it('`thinned` 为 0 却带着 `viaBuffId` → **不开**（`> 0` 是判据的一半）', () => {
    const opened = comboWindowsFor(
      [damageEvent({ amount: 30, thinned: 0, viaBuffId: 'guard' })],
      [spec({ sourceSkillId: 'guard', viaBuffId: 'guard' })],
    );
    expect(opened).toEqual([]);
  });

  it('⚠️ 「截」那条 spec（没写 `viaBuffId`）不认 `damage`（挨打不该给截开窗）', () => {
    const opened = comboWindowsFor(
      [damageEvent({ amount: 15, thinned: 15, viaBuffId: 'guard' })],
      [spec()],
    );
    expect(opened).toEqual([]);
  });

  it('⚠️ 「闪」吸收的那一击不该给「卸」开窗（两套 flags 别混）', () => {
    /** 「闪」= 无敌 → 只会发 `avoided`（`thinned` 恒 0）。 */
    const opened = comboWindowsFor(
      [
        { kind: 'avoided', tick: 1, sourceId: 'boss', targetId: 'player', skillId: 'x', reason: 'immune', viaBuffId: 'flash-iframe' },
        damageEvent({ amount: 0, thinned: 0 }),
      ],
      [spec({ sourceSkillId: 'guard', viaBuffId: 'guard' })],
    );
    expect(opened).toEqual([]);
  });

  it('同一 tick 打断两个读条 → 窗口只开一次（按 buffId 去重）', () => {
    const opened = comboWindowsFor(
      [
        { kind: 'interruptSuccess', tick: 1, sourceId: 'player', targetId: 'boss', skillId: 'a', sourceSkillId: 'jie' },
        { kind: 'interruptSuccess', tick: 1, sourceId: 'player', targetId: 'boss', skillId: 'b', sourceSkillId: 'jie' },
      ],
      [spec()],
    );
    expect(opened).toEqual(['combo-window']);
  });

  it('多个产出者：各自独立判定', () => {
    const opened = comboWindowsFor(
      [
        { kind: 'interruptSuccess', tick: 1, sourceId: 'player', targetId: 'boss', skillId: 'a', sourceSkillId: 'jie' },
        { kind: 'avoided', tick: 1, sourceId: 'boss', targetId: 'player', skillId: 'b', reason: 'immune', viaBuffId: 'flash-iframe' },
      ],
      [spec(), spec({ sourceSkillId: 'flash', viaBuffId: 'flash-iframe' })],
    );
    /** 两个 spec 的 `buffId` 相同 → 去重之后只有一个。 */
    expect(opened).toEqual(['combo-window']);
  });
});

/* ------------------------------------------------------------------ *
 * 引擎接线：真的打断一次，窗口真的开出来
 * ------------------------------------------------------------------ */

/** 造一局：玩家（有炁）+ 一个正在读条的 Boss。 */
function engineWith(comboWindows?: readonly ComboWindowSpec[]): {
  readonly engine: BattleEngine;
} {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const player = makeCombatant({
    id: 'player',
    side: 'ally',
    caps: { hp: 10_000, energy: 999, douqi: 100 },
    resources: { hp: 10_000, energy: 999, douqi: 0 },
  });
  /**
   * ⚠️ Boss **一开始就在读条**（`casts` 里塞一条）：这样第 1 tick 的
   * 「截」就能打断它，不必等 AI 出招 —— 测试要的是判定，不是轮转。
   */
  const boss: Combatant = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 10_000, energy: 120, douqi: 100 },
    resources: { hp: 10_000, energy: 120, douqi: 0 },
    casts: [
      { skillId: 'boss-pride-scorn', startedAtTick: 0, castTimeMs: 10_000, resolvedHits: 0, interruptible: true },
    ],
    behaviors: [],
  });
  const engine = new BattleEngine({
    combatants: [player, boss],
    seed: 12345,
    bossId: 'boss',
    timeLimitMs: 60_000,
    buffs: registry.buffs,
    skills: registry.skills,
    baseStats: new Map<string, Partial<Record<StatKey, number>>>([
      ['player', {}],
      ['boss', {}],
    ]),
    passiveModifiers: new Map(),
    ...(comboWindows === undefined ? {} : { comboWindows }),
  });
  return { engine };
}

describe('引擎接线：打断成功 → 窗口真的开出来（「击」可用）', () => {
  it('传了 `comboWindows`：用「截」打断 → 玩家身上出现 `combo-window`', () => {
    const { engine } = engineWith([spec()]);
    engine.tick([{ type: 'useSkill', skillId: 'jie', atTick: 0 }], 'player');
    const events = engine.drainEvents();
    expect(events.some((e) => e.kind === 'interruptSuccess')).toBe(true);
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally');
    expect(player?.buffs.some((b) => b.defId === 'combo-window')).toBe(true);
  });

  it('窗口开着时「击」**能放**（门禁通过，不再以 `condition` 拒掉）', () => {
    const { engine } = engineWith([spec()]);
    engine.tick([{ type: 'useSkill', skillId: 'jie', atTick: 0 }], 'player');
    engine.drainEvents();
    const tick = engine.snapshot.tick;
    engine.tick([{ type: 'useSkill', skillId: 'strike', atTick: tick }], 'player');
    const events = engine.drainEvents();
    const rejected = events.find((e) => e.kind === 'skillRejected');
    expect(rejected).toBeUndefined();
    expect(events.some((e) => e.kind === 'skillUsed' && e.skillId === 'strike')).toBe(true);
  });

  it('⚠️ **不传** `comboWindows`：同样的操作**不会**开窗口（默认路径的空操作）', () => {
    const { engine } = engineWith();
    engine.tick([{ type: 'useSkill', skillId: 'jie', atTick: 0 }], 'player');
    engine.drainEvents();
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally');
    expect(player?.buffs.some((b) => b.defId === 'combo-window')).toBe(false);
  });

  it('⚠️ 不传 `comboWindows` 时一条 `buffApplied(combo-window)` 事件都不产生', () => {
    const { engine } = engineWith();
    engine.tick([{ type: 'useSkill', skillId: 'jie', atTick: 0 }], 'player');
    const events = engine.drainEvents();
    expect(
      events.some((e) => e.kind === 'buffApplied' && e.buffId === 'combo-window'),
    ).toBe(false);
  });

  it('打断**失败**（Boss 没在读条）→ 不开窗', () => {
    const { engine } = engineWith([spec()]);
    /** 先让 Boss 的读条结束 / 清掉：直接替换成一个没有 casts 的 Boss。 */
    const boss = engine.snapshot.combatants.find((c) => c.side === 'enemy');
    if (boss !== undefined) engine.replaceCombatantForTest({ ...boss, casts: [] });
    engine.tick([{ type: 'useSkill', skillId: 'jie', atTick: 0 }], 'player');
    engine.drainEvents();
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally');
    expect(player?.buffs.some((b) => b.defId === 'combo-window')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 引擎接线②：「卸」吸收了伤害 → 窗口真的开出来
 * ------------------------------------------------------------------ */

/**
 * ==================================================================
 * 「卸」的成功定义（**2026-10-13 放宽**）
 * ==================================================================
 *
 * 用户原话："**卸不需要完全卸掉，吸收了一部分也能派生「击」**"。
 *
 * ```
 *   伤害 ≤ GUARD_THRESHOLD（15）  → 完全卸掉（avoided）        → 开窗
 *   伤害 >  GUARD_THRESHOLD      → 只减伤（damage.thinned>0） → **也开窗**（新）
 *   没按卸（没有 guard buff）     → 一点都没吸收              → 不开
 * ```
 *
 * ⚠️ 这一组**必须走真引擎**（不是 `comboWindowsFor` 的手工事件）：
 * "只减伤"那一半的依据是 `damage.thinned` 与 `damage.viaBuffId`，
 * 而那两个字段是 `resolveHit` 在真结算里补的 —— 手工造事件会把这个
 * 恰恰最该验的接线（`withAbsorbedByBuffId`）跳过去。
 *
 * ⚠️ 阈值取 `GUARD_THRESHOLD`（不是字面的 15）：用户说过会调参
 * （"太强就改成 10"），写死会让调参变成改测试。
 */
describe('引擎接线：「卸」吸收了伤害 → 窗口开出来（完全卸掉 / 只减伤都算）', () => {
  const GUARD_SPEC: ComboWindowSpec = {
    buffId: COMBO_WINDOW.id,
    sourceSkillId: 'guard',
    viaBuffId: 'guard',
  };

  /** 一条只会"打一下"的 Boss 技能（伤害可调，与 `playerKits` 同形）。 */
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

  /**
   * 打一下并返回**这一 tick 的事件**与玩家的 buff。
   *
   * ⚠️ `playerBuffs` 用 `applyBuff` 挂（不是手写实例字面量）：实例的形状
   * （`def` / `expiresAtTick` / `instanceId`）只该由那个函数决定。
   */
  function guardHit(
    damage: number,
    playerBuffs: readonly BuffDef[],
    comboWindows: readonly ComboWindowSpec[] = [GUARD_SPEC],
  ): { readonly events: readonly EventDef[]; readonly player: Combatant | undefined } {
    const registry = createRegistry(
      { entities: [], skills: [...ALL_SKILLS, hitSkill(damage)], buffs: [...ALL_BUFFS] },
      { localeKeys: i18nKeys },
    );
    const bare = makeCombatant({
      id: 'player',
      side: 'ally',
      caps: { hp: 10_000, energy: 120, douqi: 100 },
      resources: { hp: 10_000, energy: 120, douqi: 0 },
    });
    const player = playerBuffs.reduce(
      (c, def) => ({ ...c, buffs: applyBuff(c, def, c.id, 0).buffs }),
      bare,
    );
    const boss = makeCombatant({
      id: 'boss',
      side: 'enemy',
      caps: { hp: 10_000, energy: 120, douqi: 100 },
      resources: { hp: 10_000, energy: 120, douqi: 0 },
    });
    const engine = new BattleEngine({
      combatants: [player, boss],
      seed: 12345,
      bossId: 'boss',
      timeLimitMs: 60_000,
      buffs: registry.buffs,
      skills: registry.skills,
      baseStats: new Map<string, Partial<Record<StatKey, number>>>([
        ['player', {}],
        ['boss', {}],
      ]),
      passiveModifiers: new Map(),
      comboWindows,
    });
    engine.tick([{ type: 'useSkill', skillId: 'test-hit', atTick: 0 }], 'boss');
    const events = engine.drainEvents();
    return { events, player: engine.snapshot.combatants.find((c) => c.id === 'player') };
  }

  it('伤害 = 阈值 → **完全卸掉**（`avoided`）→ 开窗（旧行为不变）', () => {
    const { events, player } = guardHit(GUARD_THRESHOLD, [GUARD_THRESHOLD_BUFF]);
    const avoided = events.find((e) => e.kind === 'avoided');
    expect(avoided?.kind === 'avoided' ? avoided.viaBuffId : undefined).toBe('guard');
    expect(player?.buffs.some((b) => b.defId === COMBO_WINDOW.id)).toBe(true);
  });

  it('⚠️【新】伤害 = 阈值 + 1 → **只减伤**（`damage.thinned > 0`）→ **也开窗**', () => {
    const { events, player } = guardHit(GUARD_THRESHOLD + 1, [GUARD_THRESHOLD_BUFF]);
    const damage = events.find((e) => e.kind === 'damage');
    expect(damage?.kind === 'damage' ? damage.thinned : undefined).toBe(GUARD_THRESHOLD);
    expect(damage?.kind === 'damage' ? damage.viaBuffId : undefined).toBe('guard');
    expect(
      player?.buffs.some((b) => b.defId === COMBO_WINDOW.id),
      '只减伤也该开窗（用户 2026-10-13 放宽的那条）',
    ).toBe(true);
  });

  it('伤害远高于阈值 → 也只减 N，仍然开窗', () => {
    const { events, player } = guardHit(GUARD_THRESHOLD + 20, [GUARD_THRESHOLD_BUFF]);
    const damage = events.find((e) => e.kind === 'damage');
    expect(damage?.kind === 'damage' ? damage.thinned : undefined).toBe(GUARD_THRESHOLD);
    expect(player?.buffs.some((b) => b.defId === COMBO_WINDOW.id)).toBe(true);
  });

  it('⚠️ 没按卸 → 一点都没吸收 → **不开窗**（反面验收）', () => {
    const { events, player } = guardHit(GUARD_THRESHOLD + 20, []);
    const damage = events.find((e) => e.kind === 'damage');
    expect(damage?.kind === 'damage' ? damage.thinned : undefined).toBe(0);
    expect(damage?.kind === 'damage' ? damage.viaBuffId : undefined).toBeUndefined();
    expect(player?.buffs.some((b) => b.defId === COMBO_WINDOW.id)).toBe(false);
  });

  it('⚠️ 阈值恰好没被触发（`thinned = 0`）→ 不开窗', () => {
    /** 没有 guard buff 时阈值是 0 → 没有平减，`thinned` 恒 0（上面已验）。 */
    const { player } = guardHit(GUARD_THRESHOLD, []);
    expect(player?.buffs.some((b) => b.defId === COMBO_WINDOW.id)).toBe(false);
  });

  it('⚠️「闪」的无敌吃掉一击**不该**给「卸」开窗（两套 flags 别混）', () => {
    const { events, player } = guardHit(GUARD_THRESHOLD + 20, [FLASH_IFRAME]);
    const avoided = events.find((e) => e.kind === 'avoided');
    expect(avoided?.kind === 'avoided' ? avoided.viaBuffId : undefined).toBe('flash-iframe');
    expect(
      player?.buffs.some((b) => b.defId === COMBO_WINDOW.id),
      '「闪」吸收的那一击只该给「闪 派生 击」开窗',
    ).toBe(false);
  });

  it('⚠️「闪」的 spec 同样只认自己那一半（反向：卸挡住不给闪开窗）', () => {
    const flashSpec: ComboWindowSpec = {
      buffId: COMBO_WINDOW.id,
      sourceSkillId: 'flash',
      viaBuffId: 'flash-iframe',
    };
    const { player } = guardHit(GUARD_THRESHOLD + 20, [GUARD_THRESHOLD_BUFF], [flashSpec]);
    expect(player?.buffs.some((b) => b.defId === COMBO_WINDOW.id)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * buff 定义本身
 * ------------------------------------------------------------------ */

describe('窗口 buff 的形状（`comboWindowFor`）', () => {
  it('基础定义是 `combo-window`：0.8 秒、刷新式、只 1 层', () => {
    expect(COMBO_WINDOW.id).toBe('combo-window');
    expect(COMBO_WINDOW.duration).toBe(800);
    expect(COMBO_WINDOW.maxStacks).toBe(1);
    expect(COMBO_WINDOW.stacking.mode).toBe('refresh');
  });

  it('⚠️ `flags.comboWindow` **刻意不填**（没有消费者 = 死值，别加）', () => {
    /**
     * `BuffFlags.comboWindow`（"列表里的技能才被激活"）在引擎里**没有**
     * 消费者：真正的门禁是 `SkillDef.requires` 里的 `hasBuff`
     * （见下面那条断言），而 UI 靠 `comboWindowSource` 定位。
     *
     * 所以按"死值先删"（AGENTS.md §2）它**不该**被填进内容 ——
     * 写了它不会生效，只会让下一个人以为"窗口激活哪个技能写在这儿"。
     */
    expect(COMBO_WINDOW.flags?.comboWindow).toBeUndefined();
    expect(COMBO_WINDOW.flags?.comboWindowSource).toBeDefined();
  });

  it('「击」的门禁认的就是这个 buff（`requires: hasBuff combo-window`）', () => {
    const strike = ALL_SKILLS.find((s) => s.id === 'strike');
    expect(strike?.requires).toEqual([{ kind: 'hasBuff', who: 'self', buffId: 'combo-window' }]);
  });

  it('它是合法 buff（内容校验器认它）', () => {
    const asBuff: BuffDef = COMBO_WINDOW;
    expect(asBuff.polarity).toBe('buff');
  });
});
