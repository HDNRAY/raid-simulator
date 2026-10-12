/**
 * 设置页「按键」列表**只列玩家技能**。
 *
 * ==================================================================
 * 这个测试防的是什么（真实踩过的坑）
 * ==================================================================
 *
 * 玩家反馈："按键设置里出现了 boss 的技能"。
 *
 * 根因：过滤条件是 `!sk.id.startsWith('boss-')` —— 靠 **id 前缀**猜归属。
 * 而「色欲」的技能 id 是 `lust-hum` / `lust-entangle` / `lust-charm`，
 * **不以 `boss-` 开头**，于是全部漏过，Boss 的招被列进了玩家的按键设置。
 *
 * ⚠️ 同一个前缀约定还被 `derivedSlots.ts`（派生槽）和
 * `viewModel.test.ts`（读条时长护栏）依赖，它们**同时**对色欲失效。
 * 后者的后果更隐蔽：色欲的招**从来没被那条护栏检查过**。
 *
 * 所以判据换成结构性的 `PLAYER_SKILL_IDS`。这个文件把那条坑钉住 ——
 * 这类 bug 不会自己暴露，只会静默多出几行 UI。
 */
import { describe, expect, it } from 'vitest';
import { ALL_BUFFS, ALL_SKILLS, PENDING_SKILLS, PLAYER_SKILL_IDS, PLAYER_SKILLS } from '../../src/data/content';
import { LUST_SKILLS } from '../../src/data/lustBoss';
import { PRIDE_SKILLS } from '../../src/data/bossPride';
import { buildKeyRows, isBindablePlayerSkill } from '../../src/app/keyRows';
import { createRegistry } from '../../src/core/content/registry';
import { translator } from '../../src/i18n/translator';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';
import { GUARD_HOLD_DRAIN_PER_SECOND } from '../../src/data/balance';

describe('按键设置只列玩家技能', () => {
  it('两个 Boss 的技能都不该可绑键', () => {
    const bosses = [
      ...LUST_SKILLS.map((s) => ({ who: '色欲', skill: s })),
      ...PRIDE_SKILLS.map((s) => ({ who: '傲慢', skill: s })),
    ];

    const leaked = bosses
      .filter(({ skill }) => isBindablePlayerSkill(skill))
      .map(({ who, skill }) => `${who}/${skill.id}`);

    expect(leaked).toEqual([]);
  });

  /**
   * ⚠️ 这条是**故意**断言"色欲的 id 不以 `boss-` 开头"的。
   *
   * 它记录的是**当初为什么前缀判据不够用**。如果有一天有人把色欲的 id
   * 改成了 `boss-*`，这条会失败 —— 那正是提醒他"前缀约定本来就不该用"
   * 的时机，而不是让这个坑悄悄消失、下次换个 Boss 再踩一遍。
   */
  it('回归：色欲的 id 不以 boss- 开头 —— 所以按前缀过滤必然漏掉它们', () => {
    expect(LUST_SKILLS.length).toBeGreaterThan(0);
    expect(LUST_SKILLS.every((s) => !s.id.startsWith('boss-'))).toBe(true);
  });

  it('派生技（带 requires）不列 —— 它靠派生出现，不由玩家直接按', () => {
    const derived = PLAYER_SKILLS.filter((s) => (s.requires?.length ?? 0) > 0);
    expect(derived.length).toBeGreaterThan(0);

    for (const skill of derived) {
      expect(isBindablePlayerSkill(skill), `${skill.id} 是派生技，不该可绑`).toBe(false);
    }
  });

  it('玩家技能里没有 requires 的那些都可绑', () => {
    const plain = PLAYER_SKILLS.filter((s) => (s.requires?.length ?? 0) === 0);
    expect(plain.length).toBeGreaterThan(0);

    for (const skill of plain) {
      expect(isBindablePlayerSkill(skill), `${skill.id} 应该可绑`).toBe(true);
    }
  });

  it('空 id 不列', () => {
    expect(isBindablePlayerSkill({ id: '' })).toBe(false);
  });

  /**
   * 判据的**完备性**：`ALL_SKILLS` 里"不在 `PLAYER_SKILL_IDS` 里"的那些，
   * 必须**正好**是两个 Boss 的技能 + **待接线技能**（「破」），不多不少。
   *
   * 多出来 → 有技能漏登记（会被误当成玩家技能列出来）；
   * 少 → 玩家技能被误判成 Boss 技能，从设置里消失。
   *
   * ⚠️ 2026-10-12：`!PLAYER_SKILL_IDS` 不再等于"Boss 技能"了 —— 拆角色
   * 之后多出第三个桶（`PENDING_SKILLS`：「破」，黛玄的、还没接线）。
   * 所以期望值显式列出它，而不是把它当成"多出来的那个"忽略掉。
   */
  it('ALL_SKILLS 减去玩家技能 = 两个 Boss 的技能 + 待接线技能', () => {
    const nonPlayer = ALL_SKILLS.filter((s) => !PLAYER_SKILL_IDS.has(s.id)).map((s) => s.id);
    const expected = [
      ...LUST_SKILLS,
      ...PRIDE_SKILLS,
      ...PENDING_SKILLS.map((p) => p.skill),
    ].map((s) => s.id);

    expect([...nonPlayer].sort()).toEqual([...expected].sort());
  });

  /**
   * **每个可绑技能都必须在 `DEFAULT_BINDINGS` 里有一席之地。**
   *
   * ==================================================================
   * 这个断言防的是什么（真实踩过的坑：「截」绑不上键）
   * ==================================================================
   *
   * 设置页的行来自**技能注册表**（`isBindablePlayerSkill`），而改键写的是
   * **绑定表**（`DEFAULT_BINDINGS`）。这是两个数据源 —— 注册表里有「截」，
   * 所以它在设置页显示得出来；绑定表里没有，于是 `applyRebind` 的 `map`
   * 永远匹配不到它，**绑定静默丢失**（界面看起来一切正常）。
   *
   * 玩家当时的原话："「截」 好像绑不上按键，闪似乎可以。"
   * —— 「闪」在表里，所以能绑;「截」不在,所以绑不上。
   *
   * ⚠️ 这是**两份真相**造成的 bug，所以修法不能只是"把「截」加进表里"：
   * 那样下一个新技能会再踩一次。这条断言让两张表**没法再分叉**。
   * （另一道防线在 `applyRebind`：表里没有就追加，不假设调用方给全了。）
   */
  it('每个可绑技能都在 DEFAULT_BINDINGS 里 —— 否则改键会静默失效', () => {
    const inTable = new Set(DEFAULT_BINDINGS.map((b) => b.skillId));
    const missing = PLAYER_SKILLS.filter(isBindablePlayerSkill)
      .map((s) => s.id)
      .filter((id) => !inTable.has(id));

    expect(missing, `这些技能能出现在设置页、却绑不上键：${missing.join(', ')}`).toEqual([]);
  });
});

/**
 * ==================================================================
 * 行的**内容**：代价 / 冷却 / 施放方式必须真的被填上
 * ==================================================================
 *
 * ⚠️ 这组用例补的是一个**真实发生过的回归**。
 *
 * 需求（用户原话）："所有技能的消耗，在这里没了……之前是又有描述，
 * 又有结构化信息，我需要把结构化信息加回来。"
 *
 * 根因：代价与冷却**只**从运行时快照取（`slot.cost` / `slot.skillCdSec`）。
 * 战斗里没问题，但**备战界面还没有战斗** —— `snapshotOf()` 返回
 * `EMPTY_SNAPSHOT`，于是两项都是空字符串。而设置齿轮**现在在备战界面
 * 上也有**，所以"打开设置看技能消耗"最常见的入口正好是没有快照的那个 ✗
 *
 * ⚠️ 这个 bug 之前溜过去的原因很直接：**本文件从来没构造过行**，
 * 只测了过滤函数。所以下面这些用例的价值不在"断言什么"，
 * 而在"**终于有一个地方会去构造行并检查它的内容**"。
 */
describe('行的内容：没有战斗快照时也要有结构化信息', () => {
  /** 备战界面的状况：`snapshotOf()` 拿不到任何技能格。 */
  function rowsWithoutSnapshot() {
    return buildKeyRows({
      bindings: DEFAULT_BINDINGS,
      registry: createRegistry({ entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] }),
      snapshotOf: () => ({ skills: [] }) as never,
      /** 用**真实的** `translator`，否则测不到"文案有没有被插值"。 */
      translate: (key: string, params?: Readonly<Record<string, string | number>>) =>
        translator.t(key as never, params as never),
      playerSkillIds: PLAYER_SKILL_IDS,
    } as never);
  }

  it('每个**有代价**的技能都要显示代价（备战界面没有快照）', () => {
    const rows = rowsWithoutSnapshot();
    const withCost = rows.filter((r) => r.costText !== undefined);
    /** 至少得有几个 —— 否则这条断言空转、永远绿。 */
    expect(withCost.length).toBeGreaterThanOrEqual(5);

    const dodging = rows.find((r) => r.skillId === 'dodge');
    expect(dodging?.costText, '「避」的代价必须显示').toBe('15 炁');
    const slashing = rows.find((r) => r.skillId === 'attack');
    expect(slashing?.costText, '「斩」的代价必须显示').toBe('15 炁');
  });

  it('按住技的代价来自 `holdDrain`（它的 `cost` 是空的）', () => {
    const rows = rowsWithoutSnapshot();
    const guard = rows.find((r) => r.skillId === 'guard');
    /**
     * ⚠️ 「卸」（原「防」）的 `cost: []` 是空的，代价在 `holdDrain` 里。
     * 只读 `cost` 会让它显示"没有代价"。
     *
     * ⚠️ 2026-10-12：2 → 3 →（第五次修订）**15 炁/秒**。它是「卸」的代价，
     * 而且**必须高于回炁速度 10 炁/秒** —— 否则按住免费还在回炁
     * （3 的净收支是 **+7**，方向是反的）；当前净 **−5 炁/秒**。
     * 口径与调参方向见 `docs/specs/2026-10-12-player-kits.md` §3.5。
     *
     * ⚠️ 断言用**杠杆常量**而不是字面量 15：显示必须由那个常量推导。
     * 这里曾经把 `perLogicTick`（每逻辑步）当成每秒直接显示，于是
     * 显示 3 炁/秒而引擎实际扣 30 炁/秒（见 `data/balance.ts` 的说明）。
     */
    expect(guard?.costText, '「卸」必须显示 15 炁/秒').toBe(
      `${GUARD_HOLD_DRAIN_PER_SECOND} 炁/秒`,
    );
  });

  /**
   * ================================================================
   * ⚠️ 「破」：待接线 → **不在设置页**（AGENTS.md §2 的"保留 + 标注"）
   * ================================================================
   *
   * 它**曾经**在设置页里（`DEFAULT_BINDINGS` 有一条 `{key:'', skillId:'break'}`：
   * 默认不绑键、但列得出来、绑得上）。那正是"一个没有角色的技能也能绑键"
   * 的来源 —— 引擎按 id 解析得了它，于是那个绑定看起来是有效的。
   *
   * 现在的机制（`data/kits/reserved.ts`）：定义还在 `ALL_SKILLS` 里
   * （`registry` 能解析），但它**不在** `PLAYER_SKILLS` —— 而设置页的行
   * 来自 `PLAYER_SKILL_IDS`，所以它是**结构性**消失的，不是特判。
   */
  it('⚠️ 「破」不在行里 —— 它是黛玄的待接线技能，不可绑', () => {
    const rows = rowsWithoutSnapshot();
    expect(rows.some((r) => r.skillId === 'break'), '「破」不该出现在设置页').toBe(false);
    /** 但它**还在定义里**（注册表能解析）—— 删除会丢设计，见 reserved.ts。 */
    expect(ALL_SKILLS.some((s) => s.id === 'break')).toBe(true);
    expect(isBindablePlayerSkill(ALL_SKILLS.find((s) => s.id === 'break')!)).toBe(false);
    /** 也不在默认键位表里 —— 否则 `bindingsForPlayer` 之外还会漏出它。 */
    expect(DEFAULT_BINDINGS.some((b) => b.skillId === 'break')).toBe(false);
  });

  it('有冷却的技能要显示冷却', () => {
    const rows = rowsWithoutSnapshot();
    /**
     * ⚠️ 这里原来断言的是「破」（`冷却 5 秒`）—— 它现在**不是玩家技能**，
     * 所以不在设置页的行里（见文件末尾那组「破」的回归）。换成凯丽的
     * 「截」（真的属于一个角色、而且真的可绑）。
     */
    const jie = rows.find((r) => r.skillId === 'jie');
    expect(jie?.cdText).toBe('冷却 10 秒');
  });

  it('⚠️ 文案里的占位符必须被插值，不能把 `{seconds}` 原样显示出来', () => {
    const rows = rowsWithoutSnapshot();
    for (const r of rows) {
      const all = [r.costText, r.cdText, r.castText].filter((x) => x !== undefined).join(' ');
      expect(all, `${r.skillId} 的文案里有未替换的占位符：${all}`).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});
