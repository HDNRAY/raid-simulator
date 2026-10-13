import { describe, expect, it } from 'vitest';
import {
  KEY_FREE_QIJI,
  loadFreeQiji,
  parseFreeQiji,
  saveFreeQiji,
  serializeFreeQiji,
} from '../../src/app/freeQijiStore';
import type { StorageLike } from '../../src/app/settingsStore';

/**
 * ==================================================================
 * 自由模式的炁机**存档**（localStorage）
 * ==================================================================
 *
 * ⚠️ 判据（本文件钉的）：读回来必须**过一遍当前池子与上限**。
 * 存档里的 id 可能来自旧版本（这一周池子就从 5 条变 8 条、有两条改了
 * id），而 `buildPlayerKit` 找不到的 id 会**静默丢掉** —— 玩家的某一条
 * 强化就这样凭空消失，且不报错。
 */

const KNOWN = ['vitality', 'breath'];
const capOf = (id: string): number => (id === 'vitality' ? 3 : id === 'breath' ? 2 : 1);

/** 内存里的假存储（与 `settingsStore` 的测试同一种做法）。 */
function memStorage(initial: Record<string, string> = {}): StorageLike & {
  readonly data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('解析：坏存档一律退化成"没开"，不抛', () => {
  it('好存档原样读出来', () => {
    expect(parseFreeQiji('{"vitality":2,"breath":1}', KNOWN, capOf)).toEqual({
      vitality: 2,
      breath: 1,
    });
  });

  it('【关键】不认识的 id 被丢掉（内容改名 / 删除之后的陈旧存档）', () => {
    expect(parseFreeQiji('{"ghost":3,"vitality":1}', KNOWN, capOf)).toEqual({ vitality: 1 });
  });

  it('【关键】超过当前上限的层数被**夹下来**（上限从 3 改成 1 之后）', () => {
    expect(parseFreeQiji('{"vitality":9}', KNOWN, capOf)).toEqual({ vitality: 3 });
  });

  it('坏 JSON / 非对象 / 非数字 / 非正数 一律丢掉', () => {
    expect(parseFreeQiji('{oops', KNOWN, capOf)).toEqual({});
    expect(parseFreeQiji('[]', KNOWN, capOf)).toEqual({});
    expect(parseFreeQiji('"x"', KNOWN, capOf)).toEqual({});
    expect(parseFreeQiji('{"vitality":"2"}', KNOWN, capOf)).toEqual({});
    expect(parseFreeQiji('{"vitality":-1}', KNOWN, capOf)).toEqual({});
    expect(parseFreeQiji('{"vitality":null}', KNOWN, capOf)).toEqual({});
    expect(parseFreeQiji('{"vitality":3.9}', KNOWN, capOf)).toEqual({ vitality: 3 });
  });

  it('空串 / null → 空表（首次进入游戏）', () => {
    expect(parseFreeQiji(null, KNOWN, capOf)).toEqual({});
    expect(parseFreeQiji('', KNOWN, capOf)).toEqual({});
  });
});

describe('序列化：键排序且不留 0 层', () => {
  it('只留正数层数', () => {
    expect(serializeFreeQiji({ vitality: 1, breath: 0 })).toBe('{"vitality":1}');
  });

  it('键**排序**（同一份配置永远给同一个字符串 —— 便于对账 / 快照）', () => {
    expect(serializeFreeQiji({ breath: 2, vitality: 1 })).toBe(serializeFreeQiji({ vitality: 1, breath: 2 }));
    expect(serializeFreeQiji({ breath: 2, vitality: 1 })).toBe('{"breath":2,"vitality":1}');
  });

  it('空表 → `{}`', () => {
    expect(serializeFreeQiji({})).toBe('{}');
  });
});

describe('读 / 写打通（含存储不可用与配额满）', () => {
  it('写进去再读出来是同一份', () => {
    const storage = memStorage();
    saveFreeQiji(storage, { vitality: 3, breath: 1 });
    expect(storage.data[KEY_FREE_QIJI]).toBe('{"breath":1,"vitality":3}');
    expect(loadFreeQiji(storage, KNOWN, capOf)).toEqual({ vitality: 3, breath: 1 });
  });

  it('没有存储（隐私模式）不炸：读回空表、写是空操作', () => {
    expect(loadFreeQiji(undefined, KNOWN, capOf)).toEqual({});
    expect(() => saveFreeQiji(undefined, { vitality: 1 })).not.toThrow();
  });

  it('`getItem` / `setItem` 抛（配额满 / 被禁用）不炸', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadFreeQiji(throwing, KNOWN, capOf)).toEqual({});
    expect(() => saveFreeQiji(throwing, { vitality: 1 })).not.toThrow();
  });

  it('⚠️ 存档 key 只有一处（`raid.freeQiji.v1`），而且**不**与肉鸽的 `chosen` 共用', () => {
    expect(KEY_FREE_QIJI).toBe('raid.freeQiji.v1');
  });
});
