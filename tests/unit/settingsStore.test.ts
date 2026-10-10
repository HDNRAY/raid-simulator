import { describe, expect, it } from 'vitest';
import {
  SettingsStore,
  parseBindings,
  parseUiScale,
  serializeBindings,
  type StorageLike,
} from '../../src/app/settingsStore';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';

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
    /** ⚠️ 存储里没提到的技能**保留默认键位**（不是消失） */
    expect(out.find((b) => b.skillId === 'dodge')?.key).toBe('a');
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
