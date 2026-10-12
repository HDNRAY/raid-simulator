import { describe, expect, it } from 'vitest';

import type { QijiEntity, QijiUnlock } from '../../../src/core/types/qiji';
import { advanceRun, battleRecordOf, startRun } from '../../../src/core/run/lifecycle';
import {
  RUN_FORMAT_VERSION,
  parseRecordedRun,
  parseRunState,
  serializeRun,
} from '../../../src/core/run/record';
import type { RunRecord, RunState } from '../../../src/core/run/types';
import { MAX_RUN_POSITION } from '../../../src/core/run/types';
import { battleSeed, shuffle } from '../../../src/core/run/shuffle';

/**
 * 一局肉鸽记录的序列化与校验（P0 验收第三条：**`RunState` 能 JSON 往返**）。
 *
 * ==================================================================
 * ⚠️ "JSON 往返"要往返的是**两份**，别只测一份
 * ==================================================================
 *
 *   1. `RunState` **裸的**往返：`JSON.parse(JSON.stringify(s))` 与 `s` 相等
 *      —— 这条证明"状态里没有不可序列化的东西"（无 `Map` / 无类实例 /
 *      无循环引用），也就是 §7.3 的可哈希保证。
 *   2. `RunRecord` **带校验的**往返：`serializeRun` → `parseRecordedRun`
 *      —— 这条证明"存档能被读回来**且仍然可信**"（§11 风险 #9 的
 *      "未验证输入"那条路）。
 *
 * 只写第 1 条会漏掉整条校验路径；只写第 2 条则"解析器把坏数据修好了"
 * 也能过 —— 所以两条都要有，且**坏数据的用例**必须真能失败。
 */

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
  run = advanceRun(run, { outcome: 'victory', counters: { jieInterrupts: 2, dodges: 1 } }, [
    qiji('vitality', ALWAYS),
  ]);
  run = { ...run, chosen: [{ qijiId: 'vitality', stacks: 2 }] };
  run = advanceRun(run, { outcome: 'defeat', counters: { jieInterrupts: 1 } });
  return run;
}

/** 一份完整的记录（状态 + 两场战斗）。 */
function richRecord(): RunRecord {
  const state = richState();
  return {
    runFormatVersion: RUN_FORMAT_VERSION,
    state,
    battles: [
      { position: 1, bossId: state.order[0] ?? 'meiichiro', seed: battleSeed(state.runSeed, 1), outcome: 'victory' },
      { position: 2, bossId: state.order[1] ?? 'lust', seed: battleSeed(state.runSeed, 2), outcome: 'defeat' },
    ],
  };
}

describe('RunState —— 裸 JSON 往返（验收 3 的前半）', () => {
  it('JSON.parse(JSON.stringify(state)) 与原状态相等', () => {
    const state = richState();
    // 先证明这份状态**不是**平凡的（否则"往返相等"可能因为两边都空而成立）
    expect(state.counters).toEqual({ jieInterrupts: 3, dodges: 1, battlesWon: 1 });
    expect(state.chosen).toEqual([{ qijiId: 'vitality', stacks: 2 }]);
    expect(state.status).toBe('defeat');
    expect(state.label).toBe('?runlen=3');

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('structuredClone 也相等（可结构化克隆，不只是能 JSON）', () => {
    const state = richState();
    expect(structuredClone(state)).toEqual(state);
  });

  it('开局状态（空 counters / 空数组 / 没有 label）也能往返', () => {
    const run = startRun({ runSeed: 1, playerId: 'player', order: [] });
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });

  it('通关状态（position = MAX + 1）也能往返', () => {
    let run = startRun({ runSeed: 3, playerId: 'player', order: shuffle(BOSSES, 3) });
    for (let i = 0; i < MAX_RUN_POSITION; i += 1) {
      run = advanceRun(run, { outcome: 'victory', counters: { dodges: 1 } });
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

  it('计数器里出现不认识的键 → undefined（不是静默丢掉那个键）', () => {
    // ⚠️ 与 `withCounters`（**忽略**未知键）**刻意不同**：
    // `withCounters` 的入参是引擎的终局快照（引擎加键是合法的演进），
    // 而这里的入参是**存档**（出现未知键说明它不是本版本写的）。
    // 静默丢掉会让"这一局数到的某样东西"凭空消失而没人知道。
    const state = good.state;
    expect(
      parseRecordedRun({ ...good, state: { ...state, counters: { typoCounter: 3 } } }),
    ).toBeUndefined();
    expect(
      parseRecordedRun({ ...good, state: { ...state, counters: { jieInterrupts: '3' } } }),
    ).toBeUndefined();
    expect(
      parseRecordedRun({ ...good, state: { ...state, counters: { jieInterrupts: Number.NaN } } }),
    ).toBeUndefined();
  });

  it('计数器可以缺键 / 是空对象（"还没数到"是合法状态）', () => {
    const state = good.state;
    expect(parseRecordedRun({ ...good, state: { ...state, counters: {} } })?.state.counters).toEqual({});
    const { counters: _drop, ...withoutCounters } = state;
    expect(parseRecordedRun({ ...good, state: withoutCounters })?.state.counters).toEqual({});
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
    const shortState = {
      ...good.state,
      order: shortOrder,
      position: 3,
      status: 'victory' as const,
    };
    const parsed = parseRecordedRun({ ...good, state: shortState, battles: [] });
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
    const empty = { ...good.state, order: [], position: 1, status: 'active' as const, counters: {} };
    expect(parseRunState(empty)?.position).toBe(1);
    expect(parseRunState({ ...empty, position: 2 })).toBeUndefined();
  });

  it('战斗记录里一项坏 → **整条** undefined（不是跳过那一项）', () => {
    expect(parseRecordedRun({ ...good, battles: [{ position: 0, bossId: 'x', seed: 1, outcome: 'victory' }] })).toBeUndefined();
    expect(parseRecordedRun({ ...good, battles: [{ position: 1, bossId: '', seed: 1, outcome: 'victory' }] })).toBeUndefined();
    expect(parseRecordedRun({ ...good, battles: [{ position: 1, bossId: 'x', seed: Number.NaN, outcome: 'victory' }] })).toBeUndefined();
    expect(parseRecordedRun({ ...good, battles: [{ position: 1, bossId: 'x', seed: 1, outcome: 'win' }] })).toBeUndefined();
    expect(parseRecordedRun({ ...good, battles: [{ position: 1, bossId: 'x', seed: 1, outcome: 'victory' }, null] })).toBeUndefined();
    // 好数据在最后一项也照常通过（证明上面的失败不是"battles 非空就失败"）
    expect(
      parseRecordedRun({
        ...good,
        battles: [{ position: 1, bossId: 'x', seed: 1, outcome: 'victory' }],
      }),
    ).toBeDefined();
  });

  it('battles 为空数组是合法的（刚开局，一场没打）', () => {
    expect(parseRecordedRun({ ...good, battles: [] })?.battles).toEqual([]);
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
    const next = advanceRun(roundTripped.state, { outcome: 'victory', counters: { dodges: 2 } });
    expect(next.position).toBe(2);
    expect(next.counters).toEqual({ dodges: 2, battlesWon: 1 });
  });

  it('战斗记录里的 seed/position 由 battleRecordOf 记、能往返（不重新推导）', () => {
    const state = startRun({ runSeed: 31, playerId: 'player', order: shuffle(BOSSES, 31) });
    const record = battleRecordOf(state, battleSeed(state.runSeed, state.position), 'victory');
    const roundTripped = parseRecordedRun({
      runFormatVersion: RUN_FORMAT_VERSION,
      state,
      battles: [record],
    });
    expect(roundTripped?.battles[0]).toEqual(record);
    expect(roundTripped?.battles[0]?.seed).toBe(battleSeed(31, 1));
  });
});
