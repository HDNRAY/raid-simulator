import { describe, expect, it } from 'vitest';

import type { EventDef } from '../../../src/core/events';
import type { QijiEntity, QijiUnlock } from '../../../src/core/types/qiji';
import { advanceRun, battleRecordOf, startRun } from '../../../src/core/run/lifecycle';
import {
  RUN_FORMAT_VERSION,
  parseRecordedRun,
  parseRunState,
  serializeRun,
} from '../../../src/core/run/record';
import { EMPTY_BATTLE_STATS } from '../../../src/core/run/stats';
import type { RunBattleRecord, RunRecord, RunState } from '../../../src/core/run/types';
import { MAX_RUN_POSITION } from '../../../src/core/run/types';
import { battleSeed, shuffle } from '../../../src/core/run/shuffle';

const PLAYER = 'player';
const JIE = 'jie';

function used(skillId: string, tick = 1): EventDef {
  return { kind: 'skillUsed', tick, sourceId: PLAYER, skillId };
}

function dmg(skillId: string, amount: number, tick = 1): EventDef {
  return {
    kind: 'damage',
    tick,
    sourceId: PLAYER,
    targetId: 'meiichiro',
    amount,
    crit: false,
    absorbed: 0,
    overkill: 0,
    skillId,
  };
}

function interrupted(skillId: string, tick = 1): EventDef {
  return {
    kind: 'interruptSuccess',
    tick,
    sourceId: PLAYER,
    targetId: 'meiichiro',
    skillId: 'boss-cleave',
    sourceSkillId: skillId,
  };
}

const BOSSES: readonly string[] = [
  'meiichiro',
  'lust',
  'envy',
  'gluttony',
  'wrath',
  'sloth',
  'greed',
];

function qiji(id: string, unlock: QijiUnlock): QijiEntity {
  return {
    id,
    kind: 'passive',
    nameKey: `qiji.${id}.name`,
    icon: 'char_break',
    category: 'offense',
    unlock,
    abilities: [],
  };
}

const ALWAYS: QijiUnlock = { kind: 'always', of: [] };

/** 一局打了几场、选了东西、带了标签的**非空**状态（空状态往返太容易过）。 */
function richState(): RunState {
  let run = startRun({
    runSeed: 20261012,
    playerId: 'player',
    order: shuffle(BOSSES, 20261012),
    label: '?runlen=3',
  });
  run = advanceRun(
    run,
    { outcome: 'victory', events: [used(JIE, 1), dmg(JIE, 12, 2), interrupted(JIE, 3)], flawless: false },
    [qiji('vitality', ALWAYS)],
  );
  run = { ...run, chosen: [{ qijiId: 'vitality', stacks: 2 }] };
  run = advanceRun(run, {
    outcome: 'defeat',
    events: [used(JIE, 4), interrupted(JIE, 5)],
    flawless: false,
  });
  return run;
}

/**
 * 造一条重放记录。
 *
 * ⚠️ `flawless` 后来加上的（`Q-e` 要它与 `battleStats.battles[].flawless`
 * 对账），所以这里显式写出来 —— "缺 = 不参与对账"那条兼容口子
 * 不该被测试默认用上（见 `RunBattleRecord.flawless` 的说明）。
 */
function battleRecord(
  state: RunState,
  position: number,
  outcome: 'victory' | 'defeat',
  flawless = false,
): RunBattleRecord {
  return {
    position,
    bossId: state.order[position - 1] ?? 'meiichiro',
    seed: battleSeed(state.runSeed, position),
    outcome,
    flawless,
  };
}

/** 从重放记录推出统计骨架（对账要求两者一致，测试里就这么造）。 */
function outcomesOf(
  records: readonly RunBattleRecord[],
): readonly { readonly won: boolean; readonly flawless: boolean }[] {
  return records.map((r) => ({ won: r.outcome === 'victory', flawless: r.flawless === true }));
}

/** 一份完整的记录（状态 + 两场战斗，且**与 `battleStats.battles` 对得上**）。 */
function richRecord(): RunRecord {
  const state = richState();
  const battles = [battleRecord(state, 1, 'victory'), battleRecord(state, 2, 'defeat')];
  return {
    runFormatVersion: RUN_FORMAT_VERSION,
    state: { ...state, battleStats: { ...state.battleStats, battles: outcomesOf(battles) } },
    battles,
  };
}

describe('RunState —— 裸 JSON 往返（验收 3 的前半）', () => {
  it('JSON.parse(JSON.stringify(state)) 与原状态相等', () => {
    const state = richState();
    // 先证明这份状态**不是**平凡的（否则"往返相等"可能因为两边都空而成立）
    expect(state.battleStats.skillUses[JIE]).toBe(2);
    expect(state.battleStats.skillDamage[JIE]).toBe(12);
    expect(state.battleStats.skillInterrupts[JIE]).toBe(2);
    expect(state.battleStats.battles).toEqual([
      { won: true, flawless: false },
      { won: false, flawless: false },
    ]);
    expect(state.chosen).toEqual([{ qijiId: 'vitality', stacks: 2 }]);
    expect(state.status).toBe('defeat');
    expect(state.label).toBe('?runlen=3');

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('structuredClone 也相等（可结构化克隆，不只是能 JSON）', () => {
    const state = richState();
    expect(structuredClone(state)).toEqual(state);
  });

  it('开局状态（空统计 / 空数组 / 没有 label）也能往返', () => {
    const run = startRun({ runSeed: 1, playerId: 'player', order: [] });
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });

  it('通关状态（position = MAX + 1）也能往返', () => {
    let run = startRun({ runSeed: 3, playerId: 'player', order: shuffle(BOSSES, 3) });
    for (let i = 0; i < MAX_RUN_POSITION; i += 1) {
      run = advanceRun(run, { outcome: 'victory', events: [dmg(JIE, 1, i + 1)], flawless: false });
    }
    expect(run.status).toBe('victory');
    expect(run.position).toBe(MAX_RUN_POSITION + 1);
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });

  it('两份内容相同的状态序列化成**逐字节相同**的 JSON', () => {
    // 字段插入顺序也必须确定（同一个形状序列化两次），否则"哈希一局肉鸽"
    // 这条路（§7.3）会因为键的顺序而给出不同的哈希。
    const a = richState();
    const b = richState();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toEqual(b);
  });
});

describe('RunRecord —— 带校验的往返（验收 3 的后半）', () => {
  it('serializeRun → parseRecordedRun 得到深度相等的记录', () => {
    const record = richRecord();
    expect(parseRecordedRun(JSON.parse(serializeRun(record)))).toEqual(record);
  });

  it('serializeRun 输出的是合法 JSON 且没有换行（localStorage 友好）', () => {
    const text = serializeRun(richRecord());
    expect(text.includes('\n')).toBe(false);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('parseRunState 单独可用（只存状态、不存战斗记录时）', () => {
    const state = richState();
    expect(parseRunState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('label 缺失 → 补回 undefined（不是 ""）', () => {
    const state = startRun({ runSeed: 1, playerId: 'player', order: [] });
    const raw = JSON.parse(JSON.stringify(state));
    expect(parseRunState(raw)?.label).toBeUndefined();
    // 手写一个显式 null 也算"没有标签"，而不是"标签是 null"
    expect(parseRunState({ ...raw, label: null })?.label).toBeUndefined();
  });

  it('runSeed 被规范化成 uint32（负数存档不会让顺序变）', () => {
    // 用一份**非空 order** 的状态：空 order 是"顺序还没定"的边界，
    // 它的 position 约束（只能是 1）会与这里要测的 runSeed 混在一起。
    const raw = {
      ...JSON.parse(
        JSON.stringify(startRun({ runSeed: 4294967295, playerId: 'player', order: ['meiichiro'] })),
      ),
      runSeed: -1,
    };
    expect(parseRunState(raw)?.runSeed).toBe(4294967295);
  });
});

describe('parseRecordedRun —— 坏数据整条丢弃（§11 风险 #9）', () => {
  const good = richRecord();

  it('版本不匹配 → undefined（旧存档不该被新代码硬读）', () => {
    expect(parseRecordedRun({ ...good, runFormatVersion: 0 })).toBeUndefined();
    expect(parseRecordedRun({ ...good, runFormatVersion: RUN_FORMAT_VERSION + 1 })).toBeUndefined();
    expect(parseRecordedRun({ ...good, runFormatVersion: '1' })).toBeUndefined();
  });

  it('不是对象 / null / 数组 → undefined', () => {
    expect(parseRecordedRun(undefined)).toBeUndefined();
    expect(parseRecordedRun(null)).toBeUndefined();
    expect(parseRecordedRun('{}')).toBeUndefined();
    expect(parseRecordedRun(42)).toBeUndefined();
    // ⚠️ 数组也是 `typeof 'object'`：不显式判它就会被当成"一个字段全缺的对象"
    expect(parseRecordedRun([1, 2, 3])).toBeUndefined();
    expect(parseRecordedRun([])).toBeUndefined();
  });

  it('state 不是对象 / battles 不是数组 → undefined', () => {
    expect(parseRecordedRun({ ...good, state: 7 })).toBeUndefined();
    expect(parseRecordedRun({ ...good, battles: {} })).toBeUndefined();
    expect(parseRecordedRun({ ...good, battles: undefined })).toBeUndefined();
  });

  it('state 里缺字段 / 类型不对 → undefined', () => {
    const state = good.state;
    expect(parseRecordedRun({ ...good, state: { ...state, runSeed: '1' } })).toBeUndefined();
    expect(parseRecordedRun({ ...good, state: { ...state, playerId: '' } })).toBeUndefined();
    expect(parseRecordedRun({ ...good, state: { ...state, order: 'meiichiro' } })).toBeUndefined();
    expect(parseRecordedRun({ ...good, state: { ...state, position: 1.5 } })).toBeUndefined();
    expect(parseRecordedRun({ ...good, state: { ...state, status: 'won' } })).toBeUndefined();
    expect(parseRecordedRun({ ...good, state: { ...state, unlocked: [1, 2] } })).toBeUndefined();
    expect(parseRecordedRun({ ...good, state: { ...state, chosen: [{ qijiId: 'v', stacks: 0 }] } })).toBeUndefined();
    expect(parseRecordedRun({ ...good, state: { ...state, chosen: [{ stacks: 1 }] } })).toBeUndefined();
  });

  it('统计里的**值**不是有限数 → undefined（技能键是开放的，值不是）', () => {
    /**
     * ⚠️ 与第一版的"计数器"**刻意不同**：那时键是封闭的
     * （`RunCounter` 联合），所以"出现不认识的键"要整条丢弃；
     * 现在键是**技能 id**（开放集合，来自内容表，解析层不认识它），
     * 所以键不校验，但**值必须是有限数**。
     */
    const state = good.state;
    const withStats = (skillUses: unknown) => ({
      ...good,
      state: { ...state, battleStats: { ...state.battleStats, skillUses } },
    });
    expect(parseRecordedRun(withStats({ [JIE]: '3' }))).toBeUndefined();
    expect(parseRecordedRun(withStats({ [JIE]: Number.NaN }))).toBeUndefined();
    expect(parseRecordedRun(withStats({ [JIE]: null }))).toBeUndefined();
    // 没见过的技能 id 是**合法**的（内容表将来会加技能，解析层不该认识它）
    expect(parseRecordedRun(withStats({ 'some-new-skill': 2 }))).toBeDefined();
  });

  it('统计可以缺键 / 是空对象（"还没数到"是合法状态）', () => {
    const state = good.state;
    // ⚠️ 换成 `EMPTY_BATTLE_STATS` 之后 `battles` 也变空了，所以
    // 重放记录那边必须一起空 —— 否则触发的是**对账**失败（另一条校验），
    // 这条用例就测不到"空统计是合法的"了。
    const withEmpty = { ...good, state: { ...state, battleStats: EMPTY_BATTLE_STATS }, battles: [] };
    expect(parseRecordedRun(withEmpty)?.state.battleStats).toEqual(EMPTY_BATTLE_STATS);
    // 整个 `battleStats` 缺失 → 坏数据（它是必需的，不是可选）
    const { battleStats: _drop, ...withoutStats } = state;
    expect(parseRecordedRun({ ...good, state: withoutStats })).toBeUndefined();
  });

  it('统计缺字段 → undefined（不是默默补零）', () => {
    const state = good.state;
    const { skillDamage: _drop, ...withoutDamage } = state.battleStats;
    expect(
      parseRecordedRun({ ...good, state: { ...state, battleStats: withoutDamage } }),
    ).toBeUndefined();
  });

  it('⚠️ 逐场结果数组的每一项都要 `{won, flawless}` 两个布尔', () => {
    const state = good.state;
    // ⚠️ 对账会比对**长度**，所以改统计骨架时必须同步改重放记录那一边。
    // 这条用例只测"数组项的形状"，所以让它保持长度一致（都为空）。
    const withBattles = (battles: unknown) => ({
      ...good,
      state: { ...state, battleStats: { ...state.battleStats, battles } },
      battles: [],
    });
    expect(parseRecordedRun(withBattles([{ won: true, flawless: false }]))).toBeUndefined();
    expect(parseRecordedRun(withBattles([]))).toBeDefined();
    expect(parseRecordedRun(withBattles([{ won: true }]))).toBeUndefined();
    expect(parseRecordedRun(withBattles([{ won: 'yes', flawless: false }]))).toBeUndefined();
    expect(parseRecordedRun(withBattles('nope'))).toBeUndefined();
  });

  it('`ticks` 必须是**非负有限数**', () => {
    const state = good.state;
    const withTicks = (ticks: unknown) => ({
      ...good,
      state: { ...state, battleStats: { ...state.battleStats, ticks } },
    });
    expect(parseRecordedRun(withTicks(0))).toBeDefined();
    expect(parseRecordedRun(withTicks(1234))).toBeDefined();
    expect(parseRecordedRun(withTicks(-1))).toBeUndefined();
    expect(parseRecordedRun(withTicks(Number.NaN))).toBeUndefined();
    expect(parseRecordedRun(withTicks('100'))).toBeUndefined();
  });

  it('position 超出**这一局的长度** → undefined', () => {
    const state = good.state;
    expect(parseRecordedRun({ ...good, state: { ...state, position: 0 } })).toBeUndefined();
    expect(parseRecordedRun({ ...good, state: { ...state, position: -3 } })).toBeUndefined();
    // good.state 是满编（order 有 7 个），所以"第 9 场"不存在
    expect(
      parseRecordedRun({ ...good, state: { ...state, position: MAX_RUN_POSITION + 2 } }),
    ).toBeUndefined();
  });

  it('⚠️ 上限读的是**这一份数据自己的 order**，不是 MAX_RUN_POSITION', () => {
    // 开发期短局：order 只有 2 个，通关时 position = 3。
    // 若拿常量（8）当上限，这份**合法**的通关存档会被当成坏数据丢掉 ——
    // 症状是"短局通关后刷新页面，存档没了"。
    const shortOrder = ['meiichiro', 'lust'];
    const shortRecord = {
      ...good,
      state: {} as RunState, // 占位，下一行立刻换成真的
      battles: [] as RunBattleRecord[],
    };
    const shortBase: RunState = { ...good.state, order: shortOrder, position: 3, status: 'victory' };
    const shortBattles = [battleRecord(shortBase, 1, 'victory'), battleRecord(shortBase, 2, 'victory')];
    const shortState: RunState = {
      ...shortBase,
      // 短局打完了 2 场：统计骨架也必须是 2 条（对账要求）
      battleStats: { ...shortBase.battleStats, battles: outcomesOf(shortBattles) },
    };
    const parsed = parseRecordedRun({ ...shortRecord, state: shortState, battles: shortBattles });
    expect(parsed?.state.position).toBe(3);
    expect(parsed?.state.status).toBe('victory');
    // 同一个 position = 3 在满编的 order 下**不是**通关（那是"刚打完第 2 场"）
    expect(
      parseRecordedRun({ ...good, state: { ...good.state, position: 3, status: 'victory' } }),
    ).toBeUndefined();
  });

  it('status 与 position 必须自洽（victory 只能停在 **len + 1**）', () => {
    const state = good.state;
    // victory 但只打到第 3 场 —— 这是"通关了但只打到第 3 场"的坏数据
    expect(
      parseRecordedRun({ ...good, state: { ...state, status: 'victory', position: 3 } }),
    ).toBeUndefined();
    // active 却停在 len + 1（"下一场是第 8 场"，不存在）
    expect(
      parseRecordedRun({ ...good, state: { ...state, status: 'active', position: MAX_RUN_POSITION + 1 } }),
    ).toBeUndefined();
    // 合法的两种：defeat 停在 1..len；victory 停在 len + 1
    expect(
      parseRecordedRun({ ...good, state: { ...state, status: 'defeat', position: 2 } }),
    ).toBeDefined();
    expect(
      parseRecordedRun({ ...good, state: { ...state, status: 'victory', position: MAX_RUN_POSITION + 1 } }),
    ).toBeDefined();
  });

  it('order 为空（顺序还没定）时 position 只能是 1', () => {
    // 走 `parseRunState`（状态的入口）而不是 `parseRecordedRun`：
    // 空 order 下 `battles` 的一致性（`position > order.length`）会是
    // 另一个与本题无关的失败原因，混在一起就分不清是哪一条拒的。
    const empty = {
      ...good.state,
      order: [],
      position: 1,
      status: 'active' as const,
      battleStats: EMPTY_BATTLE_STATS,
    };
    expect(parseRunState(empty)?.position).toBe(1);
    expect(parseRunState({ ...empty, position: 2 })).toBeUndefined();
  });

  it('战斗记录里一项坏 → **整条** undefined（不是跳过那一项）', () => {
    // ⚠️ 对账要求"统计骨架的条数 = 重放记录的条数"，所以这些坏数据用例
    // 必须把两边同时写成"1 条"，否则它们会因为**对账**失败而通过 ——
    // 那样测的就不是"战斗记录项的形状"了。
    const oneBad = (record: unknown) => ({
      ...good,
      state: {
        ...good.state,
        battleStats: { ...good.state.battleStats, battles: [{ won: true, flawless: false }] },
      },
      battles: [record],
    });
    expect(parseRecordedRun(oneBad({ position: 0, bossId: 'x', seed: 1, outcome: 'victory' }))).toBeUndefined();
    expect(parseRecordedRun(oneBad({ position: 1, bossId: '', seed: 1, outcome: 'victory' }))).toBeUndefined();
    expect(parseRecordedRun(oneBad({ position: 1, bossId: 'x', seed: Number.NaN, outcome: 'victory' }))).toBeUndefined();
    expect(parseRecordedRun(oneBad({ position: 1, bossId: 'x', seed: 1, outcome: 'win' }))).toBeUndefined();
    expect(parseRecordedRun(oneBad(null))).toBeUndefined();
    // `flawless` 有值就必须是布尔
    expect(parseRecordedRun(oneBad({ position: 1, bossId: 'x', seed: 1, outcome: 'victory', flawless: 'yes' }))).toBeUndefined();
    // 好数据（含合法的 `flawless`）照常通过 —— 证明上面的失败不是"有 battles 就失败"
    expect(
      parseRecordedRun(oneBad({ position: 1, bossId: 'x', seed: 1, outcome: 'victory', flawless: false })),
    ).toBeDefined();
  });

  it('battles 为空数组是合法的（刚开局，一场没打）', () => {
    // ⚠️ 统计骨架也得是空的，否则失败原因会是**对账**而不是这条用例要测的
    const state = { ...good.state, battleStats: { ...good.state.battleStats, battles: [] } };
    expect(parseRecordedRun({ ...good, state, battles: [] })?.battles).toEqual([]);
  });

  it('解析出来的记录**能直接喂给 advanceRun**（证明校验后的形状真的可用）', () => {
    const record = richRecord();
    const parsed = parseRecordedRun(JSON.parse(serializeRun(record)));
    expect(parsed).toBeDefined();
    if (parsed === undefined) return;
    // 打完的那一局是 defeat，所以这里只能验证"读出来的东西是同一份状态"
    expect(parsed.state.status).toBe('defeat');
    // 一份**没打完**的记录能继续推进
    const active = startRun({ runSeed: 9, playerId: 'player', order: shuffle(BOSSES, 9) });
    const activeRecord: RunRecord = {
      runFormatVersion: RUN_FORMAT_VERSION,
      state: active,
      battles: [],
    };
    const roundTripped = parseRecordedRun(JSON.parse(serializeRun(activeRecord)));
    expect(roundTripped).toBeDefined();
    if (roundTripped === undefined) return;
    const next = advanceRun(roundTripped.state, {
      outcome: 'victory',
      events: [used(JIE, 1), dmg(JIE, 7, 2)],
      flawless: false,
    });
    expect(next.position).toBe(2);
    expect(next.battleStats.skillUses[JIE]).toBe(1);
    expect(next.battleStats.skillDamage[JIE]).toBe(7);
    expect(next.battleStats.battles).toEqual([{ won: true, flawless: false }]);
  });

  it('战斗记录里的 seed/position 由 battleRecordOf 记、能往返（不重新推导）', () => {
    const state = startRun({ runSeed: 31, playerId: 'player', order: shuffle(BOSSES, 31) });
    const record = battleRecordOf(state, battleSeed(state.runSeed, state.position), 'victory', false);
    const withSkeleton = {
      ...state,
      battleStats: { ...state.battleStats, battles: outcomesOf([record]) },
    };
    const roundTripped = parseRecordedRun({
      runFormatVersion: RUN_FORMAT_VERSION,
      state: withSkeleton,
      battles: [record],
    });
    expect(roundTripped?.battles[0]).toEqual(record);
    expect(roundTripped?.battles[0]?.seed).toBe(battleSeed(31, 1));
  });

  /* ---------------------------------------------------------------- *
   * `Q-e` 对账（统计骨架 ⇔ 重放记录）
   * ---------------------------------------------------------------- */

  it('⚠️ 统计骨架与重放记录**长度**不一致 → 整条 undefined（`Q-e`）', () => {
    // 这一条是 `Q-e` 的核心：两份描述同一件事的数据分叉时**必须报错**，
    // 否则表现是"结算屏说赢了 3 场、回放里只有 2 条"，且没人知道。
    const twoStats = {
      ...good.state,
      battleStats: {
        ...good.state.battleStats,
        battles: [
          { won: true, flawless: false },
          { won: true, flawless: false },
        ],
      },
    };
    // 记录只有 1 条，骨架有 2 条
    expect(parseRecordedRun({ ...good, state: twoStats, battles: [battleRecord(twoStats, 1, 'victory')] })).toBeUndefined();
    // 反过来：骨架 1 条、记录 2 条（`good` 的骨架是 2 条，这里换 1 条）
    const oneStat = {
      ...good.state,
      battleStats: { ...good.state.battleStats, battles: [{ won: true, flawless: false }] },
    };
    expect(
      parseRecordedRun({
        ...good,
        state: oneStat,
        battles: [battleRecord(oneStat, 1, 'victory'), battleRecord(oneStat, 2, 'victory')],
      }),
    ).toBeUndefined();
  });

  it('⚠️ 长度对但**胜负**不一致 → 整条 undefined（`Q-e`）', () => {
    const state = {
      ...good.state,
      battleStats: { ...good.state.battleStats, battles: [{ won: true, flawless: false }] },
    };
    // 骨架说赢了，记录说输了
    expect(
      parseRecordedRun({ ...good, state, battles: [battleRecord(state, 1, 'defeat')] }),
    ).toBeUndefined();
    // 一致 → 通过
    expect(
      parseRecordedRun({ ...good, state, battles: [battleRecord(state, 1, 'victory')] }),
    ).toBeDefined();
  });

  it('⚠️ 长度与胜负都对但**满血**不一致 → 整条 undefined（`Q-e` 顺手加的那条）', () => {
    const state = {
      ...good.state,
      battleStats: { ...good.state.battleStats, battles: [{ won: true, flawless: true }] },
    };
    expect(
      parseRecordedRun({ ...good, state, battles: [battleRecord(state, 1, 'victory', false)] }),
    ).toBeUndefined();
    expect(
      parseRecordedRun({ ...good, state, battles: [battleRecord(state, 1, 'victory', true)] }),
    ).toBeDefined();
    // ⚠️ 反方向也要查：骨架说"满血"、记录说"不是满血" → 同样不一致
    expect(
      parseRecordedRun({ ...good, state, battles: [battleRecord(state, 1, 'victory', false)] }),
    ).toBeUndefined();
  });

  it('⚠️ 记录**缺** `flawless` → 整条 undefined（`RUN_FORMAT_VERSION: 2` 起必填）', () => {
    /**
     * ⚠️ 这条用例**改过一次**，而且改的原因值得留着：
     *
     * 它原来叫"记录缺 `flawless` 时那半条对账不生效（兼容不含它的 v1 记录）"，
     * 断言的正是那个**口子**。后来判定：**没有任何 v1 记录存在**
     * （`RunRecord` 从来没被真正写出去过，存档是 P7），所以那个口子
     * 只换来"一条有洞的检查" —— 而**有洞的检查等于没有检查**。
     *
     * 现在 `flawless` 是**必填**：缺它整条丢弃。
     * ⚠️ 这次收严**同时**把 `RUN_FORMAT_VERSION` 从 1 改成了 2 ——
     * 加的字段改了**我们的记录格式**（+1），而引擎一个字没动
     * （`REPLAY_FORMAT_VERSION` 仍 2）。这就是"两个版本号判据不同"的
     * 一个实例，见 `record.ts` 的 `RUN_FORMAT_VERSION` 注释。
     */
    const state = {
      ...good.state,
      battleStats: { ...good.state.battleStats, battles: [{ won: true, flawless: true }] },
    };
    // 缺字段 → 整条丢弃（不再"跳过这半条对账"）
    expect(
      parseRecordedRun({
        ...good,
        state,
        battles: [{ position: 1, bossId: 'x', seed: 1, outcome: 'victory' }],
      }),
    ).toBeUndefined();
    // 值不是布尔 → 同样丢弃
    expect(
      parseRecordedRun({
        ...good,
        state,
        battles: [{ position: 1, bossId: 'x', seed: 1, outcome: 'victory', flawless: 'no' }],
      }),
    ).toBeUndefined();
    // 带上正确的 `flawless` → 通过（证明上面的失败是"缺字段"而不是别的原因）
    expect(
      parseRecordedRun({
        ...good,
        state,
        battles: [{ position: 1, bossId: 'x', seed: 1, outcome: 'victory', flawless: true }],
      }),
    ).toBeDefined();
  });

  it('⚠️ `RUN_FORMAT_VERSION` 现在是 2（记录格式加了必填字段），v1 记录被拒', () => {
    expect(RUN_FORMAT_VERSION).toBe(2);
    expect(parseRecordedRun({ ...good, runFormatVersion: 1 })).toBeUndefined();
    expect(parseRecordedRun({ ...good, runFormatVersion: RUN_FORMAT_VERSION })).toBeDefined();
  });
});
