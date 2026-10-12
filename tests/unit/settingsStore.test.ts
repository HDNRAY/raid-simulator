import { describe, expect, it } from 'vitest';
import {
  SettingsStore,
  loadTouchButtons,
  parseBindings,
  parseTouchButtons,
  parseUiScale,
  serializeBindings,
  serializeTouchButtons,
  type StorageLike,
} from '../../src/app/settingsStore';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';
import { touchButtonIdsFromBindings } from '../../src/input/touchLayout';

const VALID = new Set(['attack', 'blast', 'focus', 'break', 'dodge', 'guard', 'flash', 'jie']);

/** 内存版存储（也用来断言"写了什么"）。 */
function memStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] ?? null) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('键位持久化：读的时候必须校验', () => {
  /**
   * ⚠️ `localStorage` 的内容是**未经验证的输入**：可能被手改、被旧版本
   * 写过、或被写到一半。所以每条都要能被安全丢弃，而不是信任它。
   */
  it('没有存过 → 用默认表', () => {
    expect(parseBindings(null, VALID)).toEqual(DEFAULT_BINDINGS);
    expect(parseBindings('', VALID)).toEqual(DEFAULT_BINDINGS);
  });

  it('坏 JSON / 非数组 → 回落默认（不抛）', () => {
    expect(parseBindings('{ not json', VALID)).toEqual(DEFAULT_BINDINGS);
    expect(parseBindings('42', VALID)).toEqual(DEFAULT_BINDINGS);
    expect(parseBindings('"x"', VALID)).toEqual(DEFAULT_BINDINGS);
  });

  it('保留有效的改动', () => {
    const raw = serializeBindings([{ key: 'z', skillId: 'attack' }]);
    const out = parseBindings(raw, VALID);
    expect(out.find((b) => b.skillId === 'attack')?.key).toBe('z');
    /**
     * ⚠️ 存储里没提到的技能**保留默认键位**（不是消失）。
     *
     * ⚠️ 2026-10-12：「避」的默认键从 `a` 挪到了 **`s`** ——
     * 两个角色拆分之后 `a` 给了「卸」（林晚风的按住防御），
     * 见 `DEFAULT_BINDINGS` 的说明。这里断言的是**默认表**，
     * 所以它跟着那张表走是对的。
     */
    expect(out.find((b) => b.skillId === 'dodge')?.key).toBe('s');
  });

  it('【关键】存储里提到但内容里已不存在的技能 → 丢弃该条', () => {
    const raw = JSON.stringify([{ skillId: 'deleted-skill', key: 'x' }]);
    const out = parseBindings(raw, VALID);
    expect(out.some((b) => b.skillId === 'deleted-skill')).toBe(false);
    expect(out).toHaveLength(DEFAULT_BINDINGS.length);
  });

  it('【关键】同一个键被两个技能占用 → 只保留先出现的', () => {
    /**
     * 键位表不允许冲突（一个键只能绑一个技能）。手改存储很容易造出这种
     * 数据，所以读取时必须挡住。
     */
    const raw = JSON.stringify([
      { skillId: 'attack', key: 'q' },
      { skillId: 'blast', key: 'q' },
    ]);
    const out = parseBindings(raw, VALID);
    expect(out.find((b) => b.skillId === 'attack')?.key).toBe('q');
    expect(out.find((b) => b.skillId === 'blast')?.key).toBe(DEFAULT_BINDINGS.find((d) => d.skillId === 'blast')?.key);
  });

  it('空键位不算冲突（多个技能可以都不绑定）', () => {
    const raw = JSON.stringify([
      { skillId: 'attack', key: '' },
      { skillId: 'blast', key: '' },
    ]);
    const out = parseBindings(raw, VALID);
    expect(out.find((b) => b.skillId === 'attack')?.key).toBe('');
    expect(out.find((b) => b.skillId === 'blast')?.key).toBe('');
  });

  it('字段类型不对的条目被跳过（不是整份丢弃）', () => {
    const raw = JSON.stringify([
      { skillId: 'attack', key: 123 },
      null,
      'nope',
      { skillId: 'guard' }, // 缺 key
      { skillId: 'blast', key: 'z' },
    ]);
    const out = parseBindings(raw, VALID);
    expect(out.find((b) => b.skillId === 'attack')?.key).toBe(DEFAULT_BINDINGS[0]?.key);
    expect(out.find((b) => b.skillId === 'blast')?.key).toBe('z');
  });

  it('【关键】输出顺序恒等于默认表顺序（触屏按钮顺序依赖它）', () => {
    /**
     * 触屏按钮顺序 = 这张表的顺序。若直接用存储里的顺序，"按钮顺序"会随
     * 存储内容漂移。
     */
    const reversed = JSON.stringify([...DEFAULT_BINDINGS].reverse());
    expect(parseBindings(reversed, VALID).map((b) => b.skillId)).toEqual(
      DEFAULT_BINDINGS.map((b) => b.skillId),
    );
  });
});

/**
 * ==================================================================
 * 触屏按钮集合：**第三个存储键**，与键位表互不派生
 * ==================================================================
 *
 * 需求（用户 2026-10-12）："触屏和键盘**当然是 2 套**，连 localStorage
 * 都是分 2 个 key 存的，只是**可选技能是一样的**。"
 *
 * ⚠️ 与 `parseBindings` 同一条纪律：`localStorage` 的内容是**未经验证的
 * 输入**，坏数据要能被丢掉而不是信任它。
 */
describe('触屏按钮集合：读的时候必须校验', () => {
  const POOL = new Set(['attack', 'blast', 'focus', 'break', 'dodge', 'guard', 'flash']);

  it('【关键】没存过 → `undefined`（= 该迁移），不是空集合', () => {
    /**
     * ⚠️ `undefined` 与 `[]` 是**两件事**，这条与下面那条一起钉住：
     * 合并它们会让"玩家主动取下了全部按钮"被迁移悄悄加回来。
     */
    expect(parseTouchButtons(null, POOL)).toBeUndefined();
    expect(parseTouchButtons('', POOL)).toBeUndefined();
  });

  it('【关键】存了空数组 → `[]`（玩家明确取下了全部按钮）', () => {
    expect(parseTouchButtons('[]', POOL)).toEqual([]);
  });

  it('坏 JSON / 非数组 → `undefined`（当作没存过，交给迁移兜底）', () => {
    expect(parseTouchButtons('{ not json', POOL)).toBeUndefined();
    expect(parseTouchButtons('42', POOL)).toBeUndefined();
    expect(parseTouchButtons('"x"', POOL)).toBeUndefined();
    expect(parseTouchButtons('{"a":1}', POOL)).toBeUndefined();
  });

  it('正常存档原样读回，**顺序保留**（顺序即双弧槽位）', () => {
    const raw = serializeTouchButtons(['guard', 'attack', 'blast']);
    expect(parseTouchButtons(raw, POOL)).toEqual(['guard', 'attack', 'blast']);
  });

  it('【关键】单条坏数据逐条丢弃 —— 但**位置留空**（不是前移）', () => {
    /**
     * ⚠️ 这一版的核心：`下标 = 键位号`，所以一条坏数据只能让**那个键位空着**。
     *
     * 旧实现是 `continue`（丢掉、后面的整体前移）—— 那在"数组 = 一份清单"
     * 时没问题，但换成槽位之后，前移会让玩家摆好的**每个键位都错一格**，
     * 而界面上看起来只是"少了一个按钮"（很难查）。
     */
    const raw = JSON.stringify([
      'attack',
      42,
      null,
      '',
      { skillId: 'blast' },
      'guard',
    ]);
    expect(parseTouchButtons(raw, POOL)).toEqual(['attack', '', '', '', '', 'guard']);
  });

  it('【关键】不在**技能池**里的 id 丢弃（那个键位留空）—— "可选技能是同一个池"', () => {
    const raw = JSON.stringify(['attack', 'boss-lust-hum', 'deleted-skill', 'guard']);
    expect(parseTouchButtons(raw, POOL)).toEqual(['attack', '', '', 'guard']);
  });

  it('重复 id 只保留先出现的（后者那个键位留空，前面那个不动）', () => {
    const raw = JSON.stringify(['attack', 'guard', 'attack']);
    /** 末尾那个空槽会被裁掉（末尾空槽不存），所以只剩两个。 */
    expect(parseTouchButtons(raw, POOL)).toEqual(['attack', 'guard']);
  });

  it('空洞（空串）是**合法内容**：它表示"这个键位空着"', () => {
    const raw = JSON.stringify(['attack', '', 'guard']);
    expect(parseTouchButtons(raw, POOL)).toEqual(['attack', '', 'guard']);
  });

  it('serialize → parse 往返不变', () => {
    const ids = ['attack', 'flash'];
    expect(parseTouchButtons(serializeTouchButtons(ids), POOL)).toEqual(ids);
  });
});

describe('触屏按钮集合：老存档迁移一次（用户要求）', () => {
  const POOL = new Set(['attack', 'blast', 'focus', 'break', 'dodge', 'guard', 'flash']);
  /**
   * 容量。⚠️ 这里**故意用一个大的值**（= 池子的大小）：这一组测的是
   * "迁移 / 不再回读派生"的判定，截断本身由 `settingsSlotBind.test.ts`
   * 专门钉（拿真实的 `TOUCH_BUTTON_CAPACITY` = 7）。
   */
  const CAP = POOL.size;
  /** 老存档的迁移来源 = "绑了键的那些技能"（旧的派生结果）。 */
  const legacy = touchButtonIdsFromBindings([
    { key: 'q', skillId: 'attack' },
    { key: 'a', skillId: 'dodge' },
    { key: '', skillId: 'flash' },
    { key: 's', skillId: 'guard' },
  ]);

  it('【关键】没存过 → 用旧派生结果初始化（老玩家的按钮不会突然消失）', () => {
    const out = loadTouchButtons(null, POOL, legacy, CAP);
    expect(out.migrated).toBe(true);
    expect(out.skillIds).toEqual(['attack', 'dodge', 'guard']);
  });

  it('【关键】存过之后**不再回读**派生 —— 哪怕存的是空集合', () => {
    /**
     * 这条是"迁移只做一次"的判定：存档存在（含 `[]`）时，迁移来源必须
     * **完全不起作用**。否则"玩家取下了全部按钮"下次加载就被加回来了。
     */
    const out = loadTouchButtons('[]', POOL, legacy, CAP);
    expect(out.migrated).toBe(false);
    expect(out.skillIds).toEqual([]);

    const saved = loadTouchButtons(serializeTouchButtons(['flash']), POOL, legacy, CAP);
    expect(saved.migrated).toBe(false);
    expect(saved.skillIds).toEqual(['flash']);
  });

  it('迁移结果也要按池子过滤（老的绑定表可能含池外/失效 id）', () => {
    const out = loadTouchButtons(null, POOL, ['attack', 'boss-lust-hum', 'ghost'], CAP);
    expect(out.skillIds).toEqual(['attack']);
  });

  it('坏存档（读不出来）也走迁移 —— 比清空玩家的按钮温和', () => {
    const out = loadTouchButtons('{ 半截', POOL, legacy, CAP);
    expect(out.migrated).toBe(true);
    expect(out.skillIds).toEqual(['attack', 'dodge', 'guard']);
  });
});

describe('触屏按钮集合：存取器（第三个 key）', () => {
  it('与键位表是**两个 key**，互不覆盖', () => {
    const st = memStorage();
    const store = new SettingsStore(st, 'keyboard');
    store.saveBindings([{ key: 'z', skillId: 'attack' }]);
    store.saveTouchButtons(['attack', 'guard']);

    expect(st.data['raid.bindings.keyboard.v1']).toContain('"z"');
    expect(st.data['raid.touchButtons.v1']).toBe('["attack","guard"]');
    /** 触屏按钮**不按设备分份**：换一种形态读到的还是同一份。 */
    expect(new SettingsStore(st, 'touch').touchButtonsRaw).toBe('["attack","guard"]');
  });

  it('存储不可用 / setItem 抛时不炸', () => {
    expect(new SettingsStore(undefined, 'touch').touchButtonsRaw).toBeNull();
    expect(() => new SettingsStore(undefined, 'touch').saveTouchButtons(['a'])).not.toThrow();
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(() => new SettingsStore(throwing, 'touch').saveTouchButtons(['a'])).not.toThrow();
  });
});

describe('UI 缩放持久化', () => {
  it('正常值读回', () => {
    expect(parseUiScale('1.5', 0.5, 2)).toBe(1.5);
  });

  it('【关键】越界 / 非数字 / 空 → 返回 undefined（调用方保留当前值）', () => {
    expect(parseUiScale(null, 0.5, 2)).toBeUndefined();
    expect(parseUiScale('', 0.5, 2)).toBeUndefined();
    expect(parseUiScale('abc', 0.5, 2)).toBeUndefined();
    expect(parseUiScale('99', 0.5, 2)).toBeUndefined();
    expect(parseUiScale('0.1', 0.5, 2)).toBeUndefined();
  });
});

describe('两套存储按设备分开（需求："分2个key"）', () => {
  const bindings = (key: string, skillId: string) => [{ key, skillId }];

  it('【关键】键盘与触屏**互不覆盖**', () => {
    /**
     * 需求："分2个key哈 方便我用电脑测试" —— 同一台机器上要能同时验证
     * 两套配置，调触屏不能把键盘那份冲掉。
     */
    const st = memStorage();
    const kb = new SettingsStore(st, 'keyboard');
    const touch = new SettingsStore(st, 'touch');
    kb.saveBindings(bindings('z', 'attack'));
    touch.saveBindings(bindings('x', 'attack'));

    expect(kb.bindings).toContain('"z"');
    expect(touch.bindings).toContain('"x"');
    // 两份是不同的键
    expect(st.data['raid.bindings.keyboard.v1']).not.toBe(st.data['raid.bindings.touch.v1']);
  });

  it('读写走各自的键', () => {
    const st = memStorage({ 'raid.bindings.touch.v1': serializeBindings(bindings('t', 'guard')) });
    expect(new SettingsStore(st, 'touch').bindings).toContain('"t"');
    /** ⚠️ 触屏那份不该影响键盘那份 */
    expect(new SettingsStore(st, 'keyboard').bindings).toBeNull();
  });

  it('存储不可用（隐私模式）时不炸', () => {
    const store = new SettingsStore(undefined, 'keyboard');
    expect(store.bindings).toBeNull();
    expect(() => store.saveBindings(bindings('q', 'attack'))).not.toThrow();
    expect(store.uiScaleRaw).toBeNull();
  });

  it('setItem 抛异常（配额满）时不炸', () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const store = new SettingsStore(throwing, 'touch');
    expect(() => store.saveBindings(bindings('q', 'attack'))).not.toThrow();
    expect(() => store.saveUiScale(1.2)).not.toThrow();
  });
});

describe('出战选择（备战界面记下、进战斗时读）', () => {
  it('存了能读回来', () => {
    const st = memStorage();
    const store = new SettingsStore(st, 'keyboard');
    store.savePick('player', 'meiichiro');
    expect(store.playerIdRaw).toBe('player');
    expect(store.bossIdRaw).toBe('meiichiro');
  });

  it('没存过 → null', () => {
    const store = new SettingsStore(memStorage(), 'touch');
    expect(store.playerIdRaw).toBeNull();
    expect(store.bossIdRaw).toBeNull();
  });

  it('【关键】选择**不分设备**（两种形态共用一份）', () => {
    /**
     * 与键位不同：键位分两份是为了"同机测两套配置"，而"上次选了谁"
     * 与设备无关 —— 分成两份只会让触屏每次都要重选。
     */
    const st = memStorage();
    new SettingsStore(st, 'keyboard').savePick('player', 'meiichiro');
    expect(new SettingsStore(st, 'touch').playerIdRaw).toBe('player');
  });

  it('存储不可用时不炸', () => {
    const store = new SettingsStore(undefined, 'keyboard');
    expect(() => store.savePick('player', 'meiichiro')).not.toThrow();
    expect(store.playerIdRaw).toBeNull();
  });
});
