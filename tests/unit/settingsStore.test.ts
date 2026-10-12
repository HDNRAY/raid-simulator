import { describe, expect, it } from 'vitest';
import {
  SettingsStore,
  loadTouchButtons,
  migrateLegacySettings,
  parseBindings,
  parseTouchButtons,
  parseUiScale,
  savedPlayerId,
  serializeBindings,
  serializeTouchButtons,
  type StorageLike,
} from '../../src/app/settingsStore';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';
import { touchButtonIdsFromBindings } from '../../src/input/touchLayout';

const VALID = new Set(['attack', 'blast', 'focus', 'break', 'dodge', 'guard', 'flash', 'jie']);

/**
 * 测试用的两个**真实**角色 id（`data/roster` 里的那两个）。
 *
 * ⚠️ 用真 id 而不是 `'a' / 'b'`：键名里带的就是它，而"key 长什么样"
 * 正是这一轮要钉住的东西（`raid.bindings.keyboard.player.v1`）。
 */
const PLAYER = 'player';
const OTHER = 'kaili';

/** 内存版存储（也用来断言"写了什么"）。 */
function memStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] ?? null) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    /**
     * ⚠️ 迁移要**消费**老 key（迁移只做一次）。有这个就用它；没有的话
     * 本模块退化成写空串 —— 那条路也有一条专门的测试（见文件末尾）。
     */
    removeItem: (k) => {
      delete data[k];
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
    const store = new SettingsStore(st, 'keyboard', PLAYER);
    store.saveBindings([{ key: 'z', skillId: 'attack' }]);
    store.saveTouchButtons(['attack', 'guard']);

    expect(st.data['raid.bindings.keyboard.player.v1']).toContain('"z"');
    expect(st.data['raid.touchButtons.player.v1']).toBe('["attack","guard"]');
    /** 触屏按钮**不按设备分份**：换一种形态读到的还是同一份。 */
    expect(new SettingsStore(st, 'touch', PLAYER).touchButtonsRaw).toBe('["attack","guard"]');
  });

  it('存储不可用 / setItem 抛时不炸', () => {
    expect(new SettingsStore(undefined, 'touch', PLAYER).touchButtonsRaw).toBeNull();
    expect(() => new SettingsStore(undefined, 'touch', PLAYER).saveTouchButtons(['a'])).not.toThrow();
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(() => new SettingsStore(throwing, 'touch', PLAYER).saveTouchButtons(['a'])).not.toThrow();
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
    const kb = new SettingsStore(st, 'keyboard', PLAYER);
    const touch = new SettingsStore(st, 'touch', PLAYER);
    kb.saveBindings(bindings('z', 'attack'));
    touch.saveBindings(bindings('x', 'attack'));

    expect(kb.bindings).toContain('"z"');
    expect(touch.bindings).toContain('"x"');
    // 两份是不同的键
    expect(st.data['raid.bindings.keyboard.player.v1']).not.toBe(st.data['raid.bindings.touch.player.v1']);
  });

  it('读写走各自的键', () => {
    const st = memStorage({ 'raid.bindings.touch.player.v1': serializeBindings(bindings('t', 'guard')) });
    expect(new SettingsStore(st, 'touch', PLAYER).bindings).toContain('"t"');
    /** ⚠️ 触屏那份不该影响键盘那份 */
    expect(new SettingsStore(st, 'keyboard', PLAYER).bindings).toBeNull();
  });

  it('存储不可用（隐私模式）时不炸', () => {
    const store = new SettingsStore(undefined, 'keyboard', PLAYER);
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
    const store = new SettingsStore(throwing, 'touch', PLAYER);
    expect(() => store.saveBindings(bindings('q', 'attack'))).not.toThrow();
    expect(() => store.saveUiScale(1.2)).not.toThrow();
  });
});

describe('出战选择（备战界面记下、进战斗时读）', () => {
  it('存了能读回来', () => {
    const st = memStorage();
    const store = new SettingsStore(st, 'keyboard', PLAYER);
    store.savePick('player', 'meiichiro');
    expect(store.playerIdRaw).toBe('player');
    expect(store.bossIdRaw).toBe('meiichiro');
  });

  it('没存过 → null', () => {
    const store = new SettingsStore(memStorage(), 'touch', PLAYER);
    expect(store.playerIdRaw).toBeNull();
    expect(store.bossIdRaw).toBeNull();
  });

  it('【关键】选择**不分设备**（两种形态共用一份）', () => {
    /**
     * 与键位不同：键位分两份是为了"同机测两套配置"，而"上次选了谁"
     * 与设备无关 —— 分成两份只会让触屏每次都要重选。
     */
    const st = memStorage();
    new SettingsStore(st, 'keyboard', PLAYER).savePick('player', 'meiichiro');
    expect(new SettingsStore(st, 'touch', PLAYER).playerIdRaw).toBe('player');
  });

  it('存储不可用时不炸', () => {
    const store = new SettingsStore(undefined, 'keyboard', PLAYER);
    expect(() => store.savePick('player', 'meiichiro')).not.toThrow();
    expect(store.playerIdRaw).toBeNull();
  });
});

/**
 * ==================================================================
 * ① 键位按**角色**分存（用户 2026-10-12："不同的人按键设置应该是分开的"）
 * ==================================================================
 *
 * 三份键**都**按角色分（用户说的是"按键设置"，而触屏那套也是按键设置）：
 *
 *   `raid.bindings.keyboard.<playerId>.v1`
 *   `raid.bindings.touch.<playerId>.v1`
 *   `raid.touchButtons.<playerId>.v1`
 */
describe('键位按角色分存', () => {
  const bindings = (key: string, skillId: string) => [{ key, skillId }];

  it('【关键】存储形状：key 名里带角色 id', () => {
    const st = memStorage();
    const store = new SettingsStore(st, 'keyboard', PLAYER);
    store.saveBindings(bindings('z', 'attack'));
    store.saveTouchButtons(['attack', 'guard']);
    expect(st.data['raid.bindings.keyboard.player.v1']).toContain('"z"');
    expect(st.data['raid.touchButtons.player.v1']).toBe('["attack","guard"]');
  });

  it('【关键】两个角色互不覆盖 —— 给一个人改键，另一个人还是默认', () => {
    /**
     * 这就是用户要的语义（实测那条路也走了一遍）：
     * 给林晚风改一个键 → 切到凯丽 → 她是**默认**的 → 切回去改动还在。
     */
    const st = memStorage();
    const lin = new SettingsStore(st, 'keyboard', PLAYER);
    lin.saveBindings(bindings('z', 'attack'));

    const kai = new SettingsStore(st, 'keyboard', OTHER);
    /** 凯丽没有存档 → 调用方拿到 `null` → 走 `DEFAULT_BINDINGS`。 */
    expect(kai.bindings).toBeNull();
    kai.saveBindings(bindings('x', 'attack'));

    expect(lin.bindings).toContain('"z"');
    expect(kai.bindings).toContain('"x"');
  });

  it('触屏键位槽位**也按角色分**', () => {
    const st = memStorage();
    new SettingsStore(st, 'touch', PLAYER).saveTouchButtons(['attack', 'guard']);
    const kai = new SettingsStore(st, 'touch', OTHER);
    expect(kai.touchButtonsRaw).toBeNull();
    kai.saveTouchButtons(['flash']);
    /** 林晚风那份没被凯丽动过。 */
    expect(new SettingsStore(st, 'touch', PLAYER).touchButtonsRaw).toBe('["attack","guard"]');
    expect(kai.touchButtonsRaw).toBe('["flash"]');
  });

  it('`setPlayer` 换的是**以后**读写的那一份（运行期坐标）', () => {
    const st = memStorage();
    const store = new SettingsStore(st, 'keyboard', PLAYER);
    store.saveBindings(bindings('z', 'attack'));
    store.setPlayer(OTHER);
    expect(store.playerId).toBe(OTHER);
    expect(store.bindings).toBeNull();
    /** 切回去还是原来那份 —— 换坐标没有丢掉任何东西。 */
    store.setPlayer(PLAYER);
    expect(store.bindings).toContain('"z"');
  });
});

/**
 * ==================================================================
 * ① 老存档（不按角色分的那一份）**迁移一次**
 * ==================================================================
 *
 * 规则：老的那一份属于**启动时选中的那个角色**，其余角色拿默认值。
 * 所以老 key 必须被**消费**掉 —— 留着的话第二个角色也会读到它，
 * 表现成"凯丽的键位怎么跟我给林晚风改的一样"。
 */
describe('老存档迁移：给当前角色一次，然后消费掉', () => {
  const bindings = (key: string, skillId: string) => [{ key, skillId }];
  /** 老形状：**一份**（键名里没有角色 id）。 */
  const LEGACY: Record<string, string> = {
    'raid.bindings.keyboard.v1': serializeBindings(bindings('z', 'attack')),
    'raid.bindings.touch.v1': serializeBindings(bindings('x', 'guard')),
    'raid.touchButtons.v1': serializeTouchButtons(['guard', 'flash']),
  };

  it('【关键】三种老 key 都迁给**启动时那个角色**', () => {
    const st = memStorage({ ...LEGACY });
    expect(migrateLegacySettings(st, PLAYER)).toBe(true);
    expect(st.data['raid.bindings.keyboard.player.v1']).toBe(LEGACY['raid.bindings.keyboard.v1']);
    expect(st.data['raid.bindings.touch.player.v1']).toBe(LEGACY['raid.bindings.touch.v1']);
    expect(st.data['raid.touchButtons.player.v1']).toBe(LEGACY['raid.touchButtons.v1']);
  });

  it('【关键】老 key 被消费 → **其余角色是默认值**（不是把老那份撒给所有人）', () => {
    const st = memStorage({ ...LEGACY });
    migrateLegacySettings(st, PLAYER);

    expect(st.data['raid.bindings.keyboard.v1']).toBeUndefined();
    expect(st.data['raid.bindings.touch.v1']).toBeUndefined();
    expect(st.data['raid.touchButtons.v1']).toBeUndefined();

    /** 凯丽：新 key 没有 → 默认值。 */
    expect(new SettingsStore(st, 'keyboard', OTHER).bindings).toBeNull();
    expect(new SettingsStore(st, 'touch', OTHER).touchButtonsRaw).toBeNull();

    /** 再迁一次是空操作（老 key 已经不在了）= "迁移只做一次"。 */
    expect(migrateLegacySettings(st, PLAYER)).toBe(false);
  });

  it('没有 `removeItem` 也能消费（退化成写空串，本模块同样认它）', () => {
    /**
     * ⚠️ `StorageLike.removeItem` 是**可选**的（测试里的假存储、某些受限
     * 环境未必有）。没有它时必须仍然**消费**：写 `''`（本模块一律把
     * 空串当"没有存档"）。否则"其余角色给默认值"这条会在这里破功。
     */
    const st = memStorage({ ...LEGACY });
    const noRemove: StorageLike = { getItem: st.getItem, setItem: st.setItem };
    expect(noRemove.removeItem).toBeUndefined();

    expect(migrateLegacySettings(noRemove, PLAYER)).toBe(true);
    expect(noRemove.getItem('raid.bindings.keyboard.v1')).toBe('');
    expect(new SettingsStore(noRemove, 'keyboard', OTHER).bindings).toBeNull();
    /** 凯丽第一次加载**不会**再迁一次（老 key 是 `''`，不是有值）。 */
    expect(migrateLegacySettings(noRemove, OTHER)).toBe(false);
  });

  it('没有老存档 → 什么都不做（新玩家照旧走默认值）', () => {
    const st = memStorage();
    expect(migrateLegacySettings(st, PLAYER)).toBe(false);
    expect(Object.keys(st.data)).toEqual([]);
  });

  it('新 key 已经有值 → **不覆盖**（迁移不该盖掉更新的东西），但老 key 照样消费', () => {
    const st = memStorage({
      'raid.bindings.keyboard.v1': serializeBindings(bindings('z', 'attack')),
      'raid.bindings.keyboard.player.v1': serializeBindings(bindings('n', 'attack')),
    });
    migrateLegacySettings(st, PLAYER);
    expect(st.data['raid.bindings.keyboard.player.v1']).toContain('"n"');
    expect(st.data['raid.bindings.keyboard.v1']).toBeUndefined();
  });

  it('坏数据照既有纪律处理：迁移只搬**原始字符串**，校验仍归解析器', () => {
    /**
     * ⚠️ 迁移**不做校验**（它不懂键位表）。坏 JSON 搬过去之后由
     * `parseBindings` 按纪律回落到默认 —— 这样"校验规则"永远只有一处。
     */
    const st = memStorage({ 'raid.bindings.keyboard.v1': '{ 半截' });
    migrateLegacySettings(st, PLAYER);
    const raw = st.data['raid.bindings.keyboard.player.v1'] ?? null;
    expect(raw).toBe('{ 半截');
    expect(parseBindings(raw, VALID)).toEqual(DEFAULT_BINDINGS);
  });

  it('存储不可用时不炸', () => {
    expect(migrateLegacySettings(undefined, PLAYER)).toBe(false);
  });

  it('`savedPlayerId` 读的是存档里那个人（键名只有一处）', () => {
    expect(savedPlayerId(memStorage({ 'raid.pick.player.v1': 'kaili' }))).toBe('kaili');
    expect(savedPlayerId(memStorage())).toBeNull();
    expect(savedPlayerId(undefined)).toBeNull();
  });
});
