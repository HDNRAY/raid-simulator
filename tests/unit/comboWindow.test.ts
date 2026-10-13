import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { comboWindowsFor, type ComboWindowSpec } from '../../src/core/combat/comboWindow';
import { createRegistry } from '../../src/core/content/registry';
import { ALL_BUFFS, ALL_SKILLS } from '../../src/data/content';
import { COMBO_WINDOW } from '../../src/data/kits/combo';
import type { BuffDef, Combatant, EventDef, StatKey } from '../../src/core/types';
import { makeCombatant } from './helpers';

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
