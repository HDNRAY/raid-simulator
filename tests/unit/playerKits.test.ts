import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/combat/battleState';
import { createRegistry } from '../../src/core/content/registry';
import {
  ALL_BUFFS,
  ALL_SKILLS,
  GUARD,
  GUARD_THRESHOLD_BUFF,
  PENDING_SKILLS,
  PLAYER_KITS,
  PLAYER_SKILL_IDS,
  PLAYER_SKILLS,
  playerSkillIdsFor,
  skillsForPlayer,
  STRIKE,
} from '../../src/data/content';
import { GUARD_HOLD_DRAIN_PER_SECOND, GUARD_THRESHOLD } from '../../src/data/balance';
import { LOGIC_TICKS_PER_SECOND } from '../../src/core/loopConstants';
import { KAILI_HP } from '../../src/data/kits/kaili';
import { LIN_WANFENG_HP } from '../../src/data/kits/linwanfeng';
import { PLAYER_ROSTER, isDeveloping } from '../../src/data/roster';
import { makePlayer, playerHpFor } from '../../src/data/units';
import type { BuffDef, SkillDef, StatKey } from '../../src/core/types';
import { makeBuffDef, makeCombatant, makeSkillDef } from './helpers';

/**
 * **两套角色技能**（`docs/specs/2026-10-12-player-kits.md`）的回归保护。
 *
 * 这个文件钉三件事，每一件都对应一个"不写下来就会静默走样"的点：
 *
 *   1. **两套技能表的构成** —— 谁带哪 5 个、谁不带哪些。
 *      它防的是"顺手把某个技能删掉/加回来"（比如把「避」给凯丽、
 *      或者因为「击」用不出来就把它删了）。
 *   2. **「卸」的阈值规则** —— `≤N` 整击作废（连效果）、`>N` 平减 N、
 *      多段各减一次。这是本次唯一的新机制。
 *   3. **「击」暂时没有产出者**（P3 由炁机接回）—— 它是**预期**状态，
 *      免得下一个人把它当 bug"修好"或删掉。
 *
 * ⚠️ 数值**不写死**在断言里：阈值取 `GUARD_THRESHOLD`、血量取 kit 里的
 * 常量 —— 用户明确说过阈值会调（15 → 10）。写死会让"调参"变成
 * "改测试"，而改测试的人会顺手把规则也改掉。
 */

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

const i18nKeys = new Set(
  ALL_SKILLS.flatMap((s) => [s.nameKey, ...(s.descKey === undefined ? [] : [s.descKey])])
    .concat(ALL_BUFFS.map((b) => b.nameKey)),
);

function engineWith(extraSkills: readonly SkillDef[] = [], playerBuffs: readonly BuffDef[] = []) {
  const registry = createRegistry(
    { entities: [], skills: [...ALL_SKILLS, ...extraSkills], buffs: [...ALL_BUFFS] },
    { localeKeys: i18nKeys },
  );
  const attacker = makeCombatant({
    id: 'boss',
    side: 'enemy',
    caps: { hp: 10_000, energy: 120, douqi: 100 },
    resources: { hp: 10_000, energy: 120, douqi: 0 },
  });
  const player = makeCombatant({
    caps: { hp: 10_000, energy: 120, douqi: 100 },
    resources: { hp: 10_000, energy: 120, douqi: 0 },
    buffs: playerBuffs.map((def) => ({
      instanceId: `inst-${def.id}`,
      defId: def.id,
      def,
      stacks: 1,
      appliedAtTick: 0,
      expiresAtTick: Number.POSITIVE_INFINITY,
      sourceId: 'player',
      triggerCooldowns: {},
      triggerCounts: {},
    })),
  });
  const engine = new BattleEngine({
    combatants: [player, attacker],
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
  });
  /**
   * ⚠️ 攻击者是 **Boss 那一侧**（`side: 'enemy'`）。用
   * `defaultActorIdOf` 拿到的是"我方第一个" —— 那会让玩家自己打自己
   * （表现是"伤害永远是 0"，因为玩家在打自己前已被 gate 拒掉）。
   */
  return { engine, attackerId: 'boss' };
}

/** 一个只会"打一下"的 Boss 技能（伤害可调）。 */
function strikeSkill(damage: number, extras: SkillDef['hits'][number]['effects'] = []): SkillDef {
  return makeSkillDef({
    id: 'test-hit',
    nameKey: 'skill.attack.name',
    hits: [
      {
        at: 0,
        effects: [
          { kind: 'damage', damage: { base: damage, canCrit: false, countsAsHit: true } },
          ...extras,
        ],
      },
    ],
  });
}

/**
 * 让 Boss 打玩家一下，返回玩家实际掉的血与这次命中产生的事件。
 *
 * ⚠️ 走的是**真正的引擎路径**（`applyActions` → `advanceCasts` → `hit`），
 * 不是直接调 `computeDamage`：这条规则的关键在于"整次命中一个判据"
 * 与"效果跟着一起免"，那些只在 `resolveHit` 里成立。
 */
function bossHits(
  playerBuffs: readonly BuffDef[],
  damage: number,
  extras?: SkillDef['hits'][number]['effects'],
) {
  const skill = strikeSkill(damage, extras);
  const { engine, attackerId } = engineWith([skill], playerBuffs);
  engine.applyActions([{ type: 'useSkill', skillId: 'test-hit', atTick: 0 }], attackerId);
  for (let i = 0; i < 8; i += 1) engine.tick();
  const player = engine.snapshot.combatants.find((c) => c.side === 'ally');
  const events = engine.drainEvents();
  const damageEvent = events.find((e) => e.kind === 'damage');
  const dealt = 10_000 - (player?.resources.hp ?? 10_000);
  return { dealt, events, damageEvent, player, engine };
}

/** 眩晕用的 buff（`stun` 效果要求给一个带 `actionLock` 的 def）。 */
const STUN_BUFF = makeBuffDef({
  id: 'test-stun',
  nameKey: 'skill.attack.name',
  duration: 1000,
  flags: { actionLock: true },
});

/* ------------------------------------------------------------------ *
 * 1. 两套技能表的构成
 * ------------------------------------------------------------------ */

describe('两套角色技能：按角色装配（定稿见 docs/specs/2026-10-12-player-kits.md）', () => {
  it('两个角色的 id 都在 roster 里，而且都不是"开发中"', () => {
    for (const id of ['player', 'kaili']) {
      expect(PLAYER_ROSTER.some((e) => e.id === id), `${id} 应当在 PLAYER_ROSTER 里`).toBe(true);
      expect(isDeveloping(id), `${id} 已经做完，不该在 DEVELOPMENT 名单里`).toBe(false);
    }
  });

  it('每人 5 招，且组成与定稿逐字一致', () => {
    expect(skillsForPlayer('player').map((s) => s.id)).toEqual([
      'attack',
      'pi',
      'focus',
      'guard',
      'dodge',
    ]);
    expect(skillsForPlayer('kaili').map((s) => s.id)).toEqual([
      'punch',
      'blast',
      'focus',
      'jie',
      'flash',
    ]);
  });

  it('⚠️ 林晚风没有「截」「闪」；凯丽没有「避」「防/格」', () => {
    const lin = playerSkillIdsFor('player');
    const kai = playerSkillIdsFor('kaili');
    for (const id of ['jie', 'flash', 'punch', 'blast']) {
      expect(lin.has(id), `林晚风不该带 ${id}`).toBe(false);
    }
    for (const id of ['dodge', 'guard', 'pi', 'attack']) {
      expect(kai.has(id), `凯丽不该带 ${id}`).toBe(false);
    }
    /** 「凝」是**共用**的（同一定义对象，见 `kits/shared.ts`）。 */
    expect(lin.has('focus') && kai.has('focus')).toBe(true);
  });

  it('「斩」与「拳」同耗炁、读条与伤害按定稿分叉', () => {
    const attack = skillsForPlayer('player').find((s) => s.id === 'attack');
    const punch = skillsForPlayer('kaili').find((s) => s.id === 'punch');
    expect(attack?.cost[0]?.value).toBe(punch?.cost[0]?.value);
    expect(punch?.castTime).toBeLessThan(attack?.castTime ?? 0);
  });

  it('「拳」不消耗炁以外的资源（它是快节奏的填充，不是缠的出口）', () => {
    const punch = skillsForPlayer('kaili').find((s) => s.id === 'punch');
    expect(punch?.cost.map((c) => c.resource)).toEqual(['energy']);
  });

  it('没有「卸」以外的技能带 `damageThreshold`（阈值是本作唯一一处平减）', () => {
    for (const buff of ALL_BUFFS) {
      if (buff.id === 'guard') continue;
      expect(buff.flags?.damageThreshold, `${buff.id} 不该有阈值抵消`).toBeUndefined();
    }
    expect(GUARD_THRESHOLD_BUFF.flags?.damageThreshold).toBe(GUARD_THRESHOLD);
    /**
     * ⚠️ 按住代价的**每秒**杠杆（2 → 3 → **15 炁/秒**，第五次修订）在
     * `data/balance.ts`；内容这里存的是**每逻辑步**的 `1.5`。
     * 断言写成"由杠杆推导"而不是硬编码 `1.5` —— 改杠杆时这条跟着变，
     * 而不是留下两个各写各的数字（那正是这次 10 倍偏差的成因）。
     */
    expect(GUARD.holdDrain?.perLogicTick).toBe(
      GUARD_HOLD_DRAIN_PER_SECOND / LOGIC_TICKS_PER_SECOND,
    );
  });

  it('`GUARD_THRESHOLD` 是具名常量（内容里不散落魔法数）', () => {
    /** 它来自 `data/balance.ts`，所以改阈值只需改一处。 */
    expect(typeof GUARD_THRESHOLD).toBe('number');
    expect(GUARD_THRESHOLD).toBeGreaterThan(0);
    /** ⚠️ 用户的调参口径写在文档里：太强就改成 10。这里只钉"它是一个常量"。 */
    expect(GUARD_THRESHOLD_BUFF.flags?.damageThreshold).toBe(GUARD_THRESHOLD);
  });
});

/* ------------------------------------------------------------------ *
 * 2. 「卸」的阈值规则
 * ------------------------------------------------------------------ */

describe('「卸」：阈值抵消（≤N 整击作废 / >N 平减 N）', () => {
  it('`伤害 ≤ N` → 完全抵消（0 伤害）', () => {
    const r = bossHits([GUARD_THRESHOLD_BUFF], GUARD_THRESHOLD - 1);
    expect(r.dealt).toBe(0);
    /**
     * ⚠️ 它走的是**无敌那条通路**（`avoided`，reason `immune`），
     * 不是"减到 0 的伤害" —— 差别在**效果会不会被免**（下一条）。
     */
    expect(r.events.some((e) => e.kind === 'avoided')).toBe(true);
  });

  it('`伤害 = N` → 也完全抵消（≤ 是闭区间）', () => {
    const r = bossHits([GUARD_THRESHOLD_BUFF], GUARD_THRESHOLD);
    expect(r.dealt).toBe(0);
    expect(r.events.some((e) => e.kind === 'avoided')).toBe(true);
  });

  it('`伤害 > N` → 伤害 − N（平减，不是比例）', () => {
    const damage = GUARD_THRESHOLD + 20;
    const r = bossHits([GUARD_THRESHOLD_BUFF], damage);
    expect(r.dealt).toBe(damage - GUARD_THRESHOLD);
    /** 平减的量记在事件的 `thinned` 上（与 `absorbed` 分开）。 */
    expect(r.damageEvent?.kind === 'damage' ? r.damageEvent.thinned : undefined).toBe(
      GUARD_THRESHOLD,
    );
  });

  /**
   * ⚠️ **实测**：`>N` 的平减**不发 `avoided`**（它是一条 `damage` 事件）。
   *
   * 这一条是"卸吸收了多少"能不能被观测到的**全部依据**：旧口径只看
   * `avoided`，于是"只减伤"在事件流里看起来与"什么都没发生"一样
   * （只有 `damage.thinned` 这一个量）。所以：
   *
   *   1. 断言它**真的没有** `avoided` —— 免得下一个人以为"改判据"是不必要的
   *   2. 断言它带着 `damage.viaBuffId = 'guard'`（本轮加的观测字段，
   *      见 `avoidedSource.withAbsorbedByBuffId`）—— 只靠 `thinned > 0`
   *      分不出"是谁磨的"
   */
  it('⚠️ `>N`（只减伤）**不发 `avoided`**，但 `damage` 事件带 `viaBuffId`（指向 guard）', () => {
    const r = bossHits([GUARD_THRESHOLD_BUFF], GUARD_THRESHOLD + 20);
    expect(r.events.some((e) => e.kind === 'avoided'), '平减不是整击作废').toBe(false);
    expect(r.damageEvent?.kind === 'damage' ? r.damageEvent.viaBuffId : undefined).toBe('guard');
  });

  it('⚠️ `≤N` 的整击作废带 `avoided.viaBuffId`（指向 guard，与上一半的出口不同）', () => {
    const r = bossHits([GUARD_THRESHOLD_BUFF], GUARD_THRESHOLD);
    const avoided = r.events.find((e) => e.kind === 'avoided');
    expect(avoided?.kind === 'avoided' ? avoided.viaBuffId : undefined).toBe('guard');
    /** 整击作废那一半**没有** `damage` 事件（`thinned` 无处可写）。 */
    expect(r.damageEvent).toBeUndefined();
  });

  it('⚠️ 没按卸（没有阈值 buff）→ 伤害照吃，且**不带** `viaBuffId`', () => {
    const r = bossHits([], GUARD_THRESHOLD + 20);
    expect(r.dealt).toBe(GUARD_THRESHOLD + 20);
    expect(r.damageEvent?.kind === 'damage' ? r.damageEvent.thinned : undefined).toBe(0);
    expect(r.damageEvent?.kind === 'damage' ? r.damageEvent.viaBuffId : undefined).toBeUndefined();
  });

  it('`≤N` 时**连效果一起免**（如眩晕）—— 这是"整击作废"的含义', () => {
    const r = bossHits([GUARD_THRESHOLD_BUFF], GUARD_THRESHOLD - 1, [
      { kind: 'stun', target: { mode: 'primaryEnemy' }, buff: STUN_BUFF },
    ]);
    expect(r.dealt).toBe(0);
    expect(r.player?.buffs.some((b) => b.defId === 'test-stun')).toBe(false);
  });

  it('`>N` 时**效果照吃**（同一次命中，眩晕会挂上）', () => {
    const r = bossHits([GUARD_THRESHOLD_BUFF], GUARD_THRESHOLD + 20, [
      { kind: 'stun', target: { mode: 'primaryEnemy' }, buff: STUN_BUFF },
    ]);
    expect(r.dealt).toBe(20);
    expect(r.player?.buffs.some((b) => b.defId === 'test-stun')).toBe(true);
  });

  it('多段攻击**每一段各减一次**（用户已确认的口径）', () => {
    const skill = makeSkillDef({
      id: 'test-multi',
      nameKey: 'skill.attack.name',
      hits: [
        {
          at: 0,
          effects: [{ kind: 'damage', damage: { base: 20, canCrit: false, countsAsHit: true } }],
        },
        {
          at: 100,
          effects: [{ kind: 'damage', damage: { base: 20, canCrit: false, countsAsHit: true } }],
        },
      ],
    });
    const { engine, attackerId } = engineWith([skill], [GUARD_THRESHOLD_BUFF]);
    engine.applyActions([{ type: 'useSkill', skillId: 'test-multi', atTick: 0 }], attackerId);
    for (let i = 0; i < 30; i += 1) engine.tick();
    const player = engine.snapshot.combatants.find((c) => c.side === 'ally');
    /** 两段各 `20 − N`：不是 `(20+20) − N`。 */
    expect(10_000 - (player?.resources.hp ?? 10_000)).toBe(2 * (20 - GUARD_THRESHOLD));
  });

  it('没有「卸」时这一击照常结算（阈值不是全局减速带）', () => {
    const r = bossHits([], 30);
    expect(r.dealt).toBe(30);
  });
});

/* ------------------------------------------------------------------ *
 * 3. 「击」：保留，但暂时没有产出者
 * ------------------------------------------------------------------ */

describe('「击」（派生技）：产出者是**炁机**（P3 已接回）', () => {
  it('「截」成功后**不再**开派生窗口 —— 用户要求把派生的那一段去掉', () => {
    const jie = ALL_SKILLS.find((s) => s.id === 'jie');
    const interrupt = jie?.hits[0]?.effects.find((e) => e.kind === 'interrupt');
    expect(interrupt).toBeDefined();
    const kinds = (interrupt?.onSuccess ?? []).map((e) => e.kind);
    /** 只剩退冷却那一条。 */
    expect(kinds).toEqual(['cooldown']);
    expect(kinds).not.toContain('grantBuff');
  });

  it('⚠️ **技能内容**里没有任何东西挂 `combo-window` —— 产出者改由**炁机**给（P3）', () => {
    /**
     * ================================================================
     * ⚠️【作废 · 2026-10-13】"全内容里没有任何东西会挂 combo-window"
     * ================================================================
     *
     * **旧断言的标题与理由（整段保留，它当时是对的）：**
     *
     * > ⚠️ 全内容里**没有任何**东西会挂 `combo-window`（这是预期）
     * >
     * > 钉住现状：如果有人在 P3 之前"顺手"接上了一个产出者（多半是为了
     * > 让「击」能用），黄金重放的参考策略会跟着变，而这条断言会先红。
     *
     * **当时为什么成立**：P0/P2 时**确实没有产出者** —— 用户 2026-10-12
     * 要求"把现在的截的派生去掉"，而「炁机」那条路（P3）还没做。所以
     * 「击」永远用不出来，而这条断言钉的是"**这个缺失是有意的**"。
     *
     * **实测为什么不再成立**：P3 把产出者接回了。但接的方式**故意不是**
     * "让「截」自己挂 buff" —— 用户 2026-10-13 的原话是
     * "**这个整体是一个炁机**"，所以产出者是**炁机**：
     *
     *   `data/qiji.ts` 的 `comboWindow`
     *     → `app/kit.ts` 的 `buildPlayerKit`
     *     → `CreateBattleOptions.comboWindows`
     *     → `core/combat/comboWindowHandler.ts`（tick 管线第 2b 步）
     *
     * **所以这条断言不是被删掉，而是换了个更强的说法**：它现在守的是
     * "**技能内容不许自己开窗口**"。一旦有人把 `grantBuff: COMBO_WINDOW`
     * 加回「截」的 `onSuccess`，窗口就变回"白送"（不选炁机也有），
     * 而肉鸽的整个取舍（"要用 3 次截去解锁它"）会**静默失效** ——
     * 这正是上面那条"截的 `onSuccess` 只有 `cooldown`"在钉的事。
     */
    for (const skill of ALL_SKILLS) {
      for (const hit of skill.hits) {
        for (const effect of hit.effects) {
          expect(
            effect.buff?.id,
            `${skill.id} 意外地挂了 combo-window`,
          ).not.toBe('combo-window');
          for (const nested of effect.onSuccess ?? []) {
            expect(nested.buff?.id).not.toBe('combo-window');
          }
        }
      }
      for (const ability of skill.abilities) {
        if (ability.kind === 'grant') {
          expect(ability.buff.id, `${skill.id} 意外地挂了 combo-window`).not.toBe('combo-window');
        }
      }
    }
  });

  it('⚠️ 没有炁机时「击」**用不出来** —— 门禁以 `condition` 拒掉（默认路径不变）', () => {
    const { engine } = engineWith();
    /** 玩家身上没有 `combo-window`（本夹具没传 `comboWindows`）。 */
    engine.applyActions([{ type: 'useSkill', skillId: 'strike', atTick: 0 }]);
    engine.tick();
    const events = engine.drainEvents();
    const rejected = events.find((e) => e.kind === 'skillRejected');
    expect(rejected?.kind === 'skillRejected' ? rejected.reason : undefined).toBe('condition');
  });

  it('「击」仍然在玩家技能**全集**里（引擎要能按 id 解析它）', () => {
    expect(PLAYER_SKILL_IDS.has(STRIKE.id)).toBe(true);
    expect(PLAYER_SKILLS.some((s) => s.id === STRIKE.id)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 3b. 「破」：黛玄的待接线技能（保留 + 标注，但不属于任何角色）
 * ------------------------------------------------------------------ */

/**
 * ⚠️ 这一节的**由来**：上一版把「破」留在 `PLAYER_SKILLS`（玩家技能全集）
 * 里，理由是"黄金重放的参考策略要用它"—— 结果是**黄金重放测了一个游戏里
 * 不可能发生的场景**（没有任何角色带「破」）。用户看到那个取舍后选了
 * "重标定一次"，于是「破」改成 `PENDING_SKILLS` 桶：
 * 定义保留、注册表认得、但**不属于任何角色、不可绑键、不进设置页**。
 *
 * 判据与三分法见 `data/kits/reserved.ts` 的文件头；
 * 规程写在 `docs/specs/2026-10-12-player-kits.md` §6。
 */
describe('「破」：黛玄的待接线技能（保留 + 标注，但不属于任何角色）', () => {
  const pending = PENDING_SKILLS.find((p) => p.skill.id === 'break');

  it('在 `PENDING_SKILLS` 里，且标注了归属与原因', () => {
    expect(pending).toBeDefined();
    expect(pending?.pendingFor).toBe('daixuan');
    expect(pending?.blockedBy).toBe('owner-not-implemented');
    /** 归属的角色是真实存在的，而且确实**还没做完**（`DEVELOPING`）。 */
    expect(PLAYER_ROSTER.some((e) => e.id === pending?.pendingFor)).toBe(true);
    expect(isDeveloping(pending?.pendingFor ?? '')).toBe(true);
  });

  it('不属于任何角色 —— 两个已完成角色的技能表里都没有它', () => {
    for (const id of ['player', 'kaili']) {
      expect(playerSkillIdsFor(id).has('break'), `${id} 不该带「破」`).toBe(false);
    }
    /** 也不在"某个角色带哪一套"的定义表里。 */
    for (const kit of Object.values(PLAYER_KITS)) {
      expect(kit.some((s) => s.id === 'break')).toBe(false);
    }
  });

  it('不在玩家技能**全集**里（设置页/可绑的判据就是它）', () => {
    expect(PLAYER_SKILL_IDS.has('break')).toBe(false);
    expect(PLAYER_SKILLS.some((s) => s.id === 'break')).toBe(false);
  });

  it('定义仍在注册表里 —— 引擎按 id 解析得到，接线时不用重建', () => {
    expect(ALL_SKILLS.some((s) => s.id === 'break')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 4. 每个角色的血上限（W6）
 * ------------------------------------------------------------------ */

describe('血上限按角色（W6）：150 / 120', () => {
  it('`makePlayer` 的上限与 kit 一致，而且初始血是满的', () => {
    const lin = makePlayer('player');
    expect(lin.caps.hp).toBe(LIN_WANFENG_HP);
    expect(lin.resources.hp).toBe(LIN_WANFENG_HP);

    const kai = makePlayer('kaili');
    expect(kai.caps.hp).toBe(KAILI_HP);
    expect(kai.resources.hp).toBe(KAILI_HP);

    /** 快就是容错低：凯丽比林晚风少一截血。 */
    expect(KAILI_HP).toBeLessThan(LIN_WANFENG_HP);
  });

  it('未登记的角色回落到默认上限（不崩、也不是 0 血）', () => {
    expect(playerHpFor('nobody')).toBeGreaterThan(0);
  });

  it('炁 / 缠上限与角色无关（本次只参数化了血）', () => {
    expect(makePlayer('player').caps.energy).toBe(makePlayer('kaili').caps.energy);
    expect(makePlayer('player').caps.douqi).toBe(makePlayer('kaili').caps.douqi);
  });
});
