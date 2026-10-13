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
 * ⚠️ 判据（本文件钉的）：
 *   1. 读回来必须**过一遍当前池子** —— 存档里的 id 可能来自旧版本
 *      （这一周池子就从 5 条变 8 条、有两条改了 id），而 `buildPlayerKit`
 *      找不到的 id 会**静默丢掉**（玩家的某一条强化凭空消失，且不报错）。
 *   2. ⚠️ **老存档（`id → 层数`）要能读回来**：用户纠正过"炁机的激活没有
 *      层"，新格式是 id 数组；老格式里 `值 > 0` 一律**算开着**，并且
 *      `migrated = true` 让调用方写回新形状（一次性迁移）。
 */

const KNOWN = ['vitality', 'breath'];

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
  it('新格式（id 数组）原样读出来', () => {
    expect(parseFreeQiji('["vitality","breath"]', KNOWN)).toEqual({
      ids: ['breath', 'vitality'],
      migrated: false,
    });
  });

  it('【关键】老格式（`id → 层数`）里 **值 > 0 算开着**，并标记要迁移', () => {
    expect(parseFreeQiji('{"vitality":2,"breath":1}', KNOWN)).toEqual({
      ids: ['breath', 'vitality'],
      migrated: true,
    });
    /** ⚠️ 层数是几**无所谓** —— 3 层与 1 层都只算"开着一条"。 */
    expect(parseFreeQiji('{"vitality":3}', KNOWN).ids).toEqual(['vitality']);
  });

  it('【关键】不认识的 id 被丢掉（内容改名 / 删除之后的陈旧存档）', () => {
    expect(parseFreeQiji('{"ghost":3,"vitality":1}', KNOWN).ids).toEqual(['vitality']);
    expect(parseFreeQiji('["ghost","vitality"]', KNOWN).ids).toEqual(['vitality']);
  });

  it('坏数据**逐条**丢弃（一条坏值不影响同一次读取里的其它条）', () => {
    expect(parseFreeQiji('["vitality",7,null,"breath"]', KNOWN).ids).toEqual(['breath', 'vitality']);
    expect(parseFreeQiji('{"vitality":0,"breath":1}', KNOWN).ids).toEqual(['breath']);
    expect(parseFreeQiji('{"vitality":-1,"breath":1}', KNOWN).ids).toEqual(['breath']);
    expect(parseFreeQiji('{"vitality":null,"breath":1}', KNOWN).ids).toEqual(['breath']);
    expect(parseFreeQiji('{"vitality":"2","breath":1}', KNOWN).ids).toEqual(['breath']);
  });

  it('去重（同一条重复出现只算一次）', () => {
    expect(parseFreeQiji('["vitality","vitality"]', KNOWN).ids).toEqual(['vitality']);
    expect(parseFreeQiji('{"vitality":1}', KNOWN).ids).toEqual(['vitality']);
  });

  it('坏 JSON / 标量 / 空串 / null → 空集合（首次进入游戏）', () => {
    expect(parseFreeQiji('{oops', KNOWN)).toEqual({ ids: [], migrated: false });
    expect(parseFreeQiji('"x"', KNOWN)).toEqual({ ids: [], migrated: false });
    expect(parseFreeQiji('42', KNOWN)).toEqual({ ids: [], migrated: false });
    expect(parseFreeQiji(null, KNOWN)).toEqual({ ids: [], migrated: false });
    expect(parseFreeQiji('', KNOWN)).toEqual({ ids: [], migrated: false });
  });
});

describe('序列化：去重 + 排序的 id 数组', () => {
  it('排序让同一份配置永远给同一个字符串', () => {
    expect(serializeFreeQiji(['vitality', 'breath'])).toBe('["breath","vitality"]');
    expect(serializeFreeQiji(['breath', 'vitality'])).toBe(serializeFreeQiji(['vitality', 'breath']));
  });

  it('去重 + 丢掉空串', () => {
    expect(serializeFreeQiji(['vitality', 'vitality', ''])).toBe('["vitality"]');
  });

  it('空集合 → `[]`', () => {
    expect(serializeFreeQiji([])).toBe('[]');
  });
});

describe('读 / 写打通（含迁移与存储不可用）', () => {
  it('写进去再读出来是同一份（新格式，不标迁移）', () => {
    const storage = memStorage();
    saveFreeQiji(storage, ['vitality', 'breath']);
    expect(storage.data[KEY_FREE_QIJI]).toBe('["breath","vitality"]');
    expect(loadFreeQiji(storage, KNOWN)).toEqual({
      ids: ['breath', 'vitality'],
      migrated: false,
    });
  });

  it('【关键】老存档 `{vitality:2, breath:1}` 加载后 → 两个都**算开着**，且标了迁移', () => {
    const storage = memStorage({ [KEY_FREE_QIJI]: '{"vitality":2,"breath":1}' });
    expect(loadFreeQiji(storage, KNOWN)).toEqual({
      ids: ['breath', 'vitality'],
      migrated: true,
    });
  });

  it('没有存储（隐私模式）不炸：读回空集合、写是空操作', () => {
    expect(loadFreeQiji(undefined, KNOWN)).toEqual({ ids: [], migrated: false });
    expect(() => saveFreeQiji(undefined, ['vitality'])).not.toThrow();
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
    expect(loadFreeQiji(throwing, KNOWN)).toEqual({ ids: [], migrated: false });
    expect(() => saveFreeQiji(throwing, ['vitality'])).not.toThrow();
  });

  it('⚠️ 存档 key 只有一处（`raid.freeQiji.v1`），而且**不**与肉鸽的 `chosen` 共用', () => {
    expect(KEY_FREE_QIJI).toBe('raid.freeQiji.v1');
  });
});
