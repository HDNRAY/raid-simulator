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
import {
  ALL_BUFFS,
  ALL_SKILLS,
  ATTACK,
  DODGE,
  FOCUS,
  FOCUS_BUFF,
  JIE,
  PENDING_SKILLS,
  PLAYER_SKILL_IDS,
  PLAYER_SKILLS,
} from '../../src/data/content';
import type { ActiveSkillDef } from '../../src/core/types';
import { LUST_SKILLS } from '../../src/data/lustBoss';
import { PRIDE_SKILLS } from '../../src/data/bossPride';
import { JEALOUSY_SKILLS } from '../../src/data/jealousyBoss';
import { GREED_SKILLS } from '../../src/data/greedBoss';
import { LAZY_SKILLS } from '../../src/data/lazyBoss';
import { GLUTTONY_SKILLS } from '../../src/data/gluttonyBoss';
import { WRATH_SKILLS } from '../../src/data/wrathBoss';
import { buildKeyRows, isBindablePlayerSkill, messageKeysMatching } from '../../src/app/keyRows';
import { createRegistry } from '../../src/core/content/registry';
import { translator } from '../../src/i18n/translator';
import { DEFAULT_BINDINGS } from '../../src/input/keyboard';
import { GUARD_HOLD_DRAIN_PER_SECOND } from '../../src/data/balance';
import { FLASH, FLASH_IFRAME } from '../../src/data/kits/kaili';
import { DODGE_IFRAME } from '../../src/data/kits/linwanfeng';
import { displaySeconds } from '../../src/app/displayTime';
import { activeSkillOf } from './helpers';

/**
 * ==================================================================
 * ⚠️ 期望值一律**从内容表推**，不抄"当时那句文案 / 那个数"
 * ==================================================================
 *
 * 用户 2026-10-13 定的判据（见 `AGENTS.md` §4）：
 *
 *   - 某个技能 / 效果的**具体数值**会经常调，由**黄金基线**覆盖 ——
 *     UT 里写死它只会变成"每次调平衡都要改测试"
 *   - UT 要证的是**连线**：设置页那一行确实从技能表读，而不是代码里
 *     第二个来源
 *
 * 所以下面这些断言都形如 `toContain(String(<内容里的值>))`：**换个数
 * 照样绿**；而"行没有跟随内容"（写死了 / 读错了字段）会红。
 */

/** 技能第一条代价的**显示值**（独立读 `SkillDef`，不经过行构造）。 */
function costValueOf(skill: ActiveSkillDef): number {
  const cost = skill.cost[0];
  if (cost === undefined || typeof cost.value !== 'number') {
    throw new Error(`${skill.id} 没有可显示的静态代价`);
  }
  return cost.value;
}

/** 「凝」buff 的增伤百分比（从 `FOCUS_BUFF` 的 `addPercent` 修正推）。 */
function focusPercentOf(): number {
  const modifier = (FOCUS_BUFF.modifiers ?? []).find(
    (m) => m.stat === 'damageBoost' && m.op === 'addPercent',
  );
  if (modifier === undefined || typeof modifier.value !== 'number') {
    throw new Error('FOCUS_BUFF 没有 damageBoost 的 addPercent 修正');
  }
  return modifier.value;
}

describe('按键设置只列玩家技能', () => {
  it('七个 Boss 的技能都不该可绑键', () => {
    const bosses = [
      ...LUST_SKILLS.map((s) => ({ who: '色欲', skill: s })),
      ...PRIDE_SKILLS.map((s) => ({ who: '傲慢', skill: s })),
      ...JEALOUSY_SKILLS.map((s) => ({ who: '嫉妒', skill: s })),
      ...GREED_SKILLS.map((s) => ({ who: '贪婪', skill: s })),
      ...LAZY_SKILLS.map((s) => ({ who: '懒惰', skill: s })),
      ...GLUTTONY_SKILLS.map((s) => ({ who: '暴食', skill: s })),
      ...WRATH_SKILLS.map((s) => ({ who: '暴怒', skill: s })),
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
  it('ALL_SKILLS 减去玩家技能 = 七个 Boss 的技能 + 待接线技能', () => {
    const nonPlayer = ALL_SKILLS.filter((s) => !PLAYER_SKILL_IDS.has(s.id)).map((s) => s.id);
    const expected = [
      ...LUST_SKILLS,
      ...PRIDE_SKILLS,
      ...JEALOUSY_SKILLS,
      ...GREED_SKILLS,
      ...LAZY_SKILLS,
      ...GLUTTONY_SKILLS,
      ...WRATH_SKILLS,
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

    /**
     * ⚠️ 期望值是**从技能表的 `cost` 推**的，不是抄那句"15 炁" ——
     * 代价数字会经常调（由黄金覆盖），而"设置页那一行有没有跟随
     * 技能表"才是这里要证的连线。
     */
    const dodging = rows.find((r) => r.skillId === 'dodge');
    expect(dodging?.costText, '「避」的代价必须显示').toContain(String(costValueOf(DODGE)));
    const slashing = rows.find((r) => r.skillId === 'attack');
    expect(slashing?.costText, '「斩」的代价必须显示').toContain(String(costValueOf(ATTACK)));
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
     * ⚠️ 断言用**杠杆常量**而不是字面量：显示必须由那个常量推导。
     * 这里曾经把 `perLogicTick`（每逻辑步）当成每秒直接显示，于是
     * 显示 3 炁/秒而引擎实际扣 30 炁/秒（见 `data/balance.ts` 的说明）。
     * 期望值从常量取（不写死那个数），所以数值调整不会红。
     */
    expect(guard?.costText, '「卸」的代价必须由杠杆常量推出来').toContain(
      String(GUARD_HOLD_DRAIN_PER_SECOND),
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
    expect(isBindablePlayerSkill(activeSkillOf(ALL_SKILLS.find((s) => s.id === 'break'), 'break'))).toBe(false);
    /** 也不在默认键位表里 —— 否则 `bindingsForPlayer` 之外还会漏出它。 */
    expect(DEFAULT_BINDINGS.some((b) => b.skillId === 'break')).toBe(false);
  });

  it('有冷却的技能要显示冷却', () => {
    const rows = rowsWithoutSnapshot();
    /**
     * ⚠️ 这里原来断言的是「破」（`冷却 5 秒`）—— 它现在**不是玩家技能**，
     * 所以不在设置页的行里（见文件末尾那组「破」的回归）。换成凯丽的
     * 「截」（真的属于一个角色、而且真的可绑）。
     *
     * ⚠️ 期望值从 `JIE.cooldown` 推（不写死"10 秒"）：冷却会调，而这里
     * 要证的是"行读的是技能表那个字段"。
     */
    const jie = rows.find((r) => r.skillId === 'jie');
    expect(jie?.cdText, '冷却必须从技能表的 `cooldown` 推').toContain(
      String(displaySeconds(JIE.cooldown)),
    );
  });

  /**
   * ================================================================
   * ⚠️ 冷却**不能进位**：「闪」的 0.6 秒曾经显示成 1 秒
   * ================================================================
   *
   * 真实 bug（用户报告）：`FLASH.cooldown = logicMs(6)` = 600ms = 0.6 秒，
   * 而这一行原先写的是 `Math.round(skill.cooldown / 1000)` = **1** ——
   * 比内容定义多了 67%。
   *
   * 修法收在 `app/displayTime.ts` 的 `displaySeconds()`（一处实现），
   * 本条是那个函数的**端到端回归**：行里的秒数必须等于 `displaySeconds`
   * 从内容算出来的值，而不是整秒四舍五入的错值。
   */
  it('⚠️ 「闪」的冷却显示的是 `displaySeconds(cooldown)`，不是进位后的整秒', () => {
    const row = rowsWithoutSnapshot().find((r) => r.skillId === 'flash');
    /** 内容里的时长（不写死 0.6 —— 它由黄金覆盖）。 */
    const shown = String(displaySeconds(FLASH.cooldown));
    /** 曾经那个错法（`Math.round(ms / 1000)`）会显示出来的整秒值。 */
    const rounded = String(Math.round(FLASH.cooldown / 1000));
    expect(row?.cdText, '必须显示 `displaySeconds` 算出来的秒数').toContain(shown);
    expect(row?.cdText, `不能被进位成 "${rounded} 秒"`).not.toContain(`${rounded} 秒`);
  });

  /**
   * ⚠️ 2026-10-13：「凝」重标定之后，**设置页那一行必须自动跟着变**。
   *
   * 这一条走的就是 `SkillDetail` 实际读的两个来源：
   *   - 代价 → `keyRows` 从 `FOCUS.cost[0].value` 推 → `costText`
   *   - 说明 → `descKey` + `descParams`（`{percent}` / `{seconds}` 由
   *     `app/descParams.ts` 从 `FOCUS_BUFF` 推）
   *
   * 所以它证明的是"改内容定义一处、界面那一行自己变" —— 而不是
   * "有人把那些数又抄了一遍"。⚠️ 期望值全部从内容推：**再调一次数值
   * 也不会红**（数值本身由黄金覆盖）。
   */
  it('⚠️ 「凝」那一行：代价 / 增伤% / 秒数都从内容定义推', () => {
    const row = rowsWithoutSnapshot().find((r) => r.skillId === 'focus');
    expect(row, '设置页要有「凝」这一行').toBeDefined();
    expect(row?.costText, '代价从 `FOCUS.cost` 推').toContain(String(costValueOf(FOCUS)));
    expect(row?.descParams?.percent, '增伤% 从 `FOCUS_BUFF.modifiers` 推').toBe(
      focusPercentOf(),
    );
    expect(row?.descParams?.seconds, '秒数从 `FOCUS_BUFF.duration` 推').toBe(
      displaySeconds(FOCUS_BUFF.duration),
    );
    /** 渲染出来就是用户看到的那句 —— 两个值必须来自内容，而不是抄进文案。 */
    const rendered = translator.t(row?.descKey as never, row?.descParams as never);
    expect(rendered, '说明里的增伤% 要来自 `FOCUS_BUFF`').toContain(
      String(focusPercentOf()),
    );
    expect(rendered, '说明里的秒数要来自 `FOCUS_BUFF.duration`').toContain(
      String(displaySeconds(FOCUS_BUFF.duration)),
    );
  });

  it('⚠️ 文案里的占位符必须被插值，不能把 `{seconds}` 原样显示出来', () => {
    const rows = rowsWithoutSnapshot();
    for (const r of rows) {
      const all = [r.costText, r.cdText, r.castText].filter((x) => x !== undefined).join(' ');
      expect(all, `${r.skillId} 的文案里有未替换的占位符：${all}`).not.toMatch(/\{[a-zA-Z]+\}/);
      /**
       * ⚠️ **说明里的占位符也要一起查**（2026-10-12 补）。
       *
       * 说明与结构化行用的**不是同一条**取词路径（前者走
       * `descKey` + `descParams`，由 `SkillDetail.render` 拼），所以只查
       * 上面三样会漏掉"说明里还剩 `{seconds}`"这种情况 —— 那正是把
       * 数值从文案里搬走时最容易犯的错。
       */
      if (r.descKey === undefined) continue;
      const desc = translator.t(r.descKey as never, r.descParams as never);
      expect(desc, `${r.skillId} 的说明里有未替换的占位符：${desc}`).not.toMatch(
        /\{[a-zA-Z]+\}/,
      );
    }
  });
});

/**
 * ==================================================================
 * ⚠️ 说明里的秒数**必须来自数据**（根治"两份真相"）
 * ==================================================================
 *
 * 真实踩过的坑：`skill.dodge.desc` 原文把秒数写死（当时是"获得 0.5 秒完全
 * 无敌"）—— 而那个秒数的家是 `DODGE_IFRAME.duration`。同一个数字两份表达，于是
 * "把「闪」从 0.1 改成 0.2"那次**只改得动一处**，文案会静默留在旧值。
 *
 * 现在文案只留模板 `{seconds}`，数值由 `app/keyRows.ts` 从技能授予的
 * buff 的 `duration` 推导。下面把那条链**从两端钉住**：
 *
 *   1. 有没有一份**能显示秒数的说明**忘了带参数（→ 渲染出 `{seconds}`）
 *   2. 参数是不是**真的等于**那个 buff 的时长（→ 抄错一个数也拦得住）
 *
 * ⚠️ 名单从 `messageKeysMatching('seconds')` **反查**，不在测试里写死：
 * 写死名单的话，下次有人加一条 `获得 {seconds} 秒……` 的说明时，
 * 这条测试**不会**跟着长，秒数又会静默漂掉。
 */
describe('说明里的秒数 = buff 的真实时长（不再写死）', () => {
  /**
   * 备战界面的状况：`snapshotOf()` 拿不到任何技能格。
   *
   * ⚠️ 与上面那组各自的 `rowsWithoutSnapshot()` 是同一个形状 ——
   * 这里不合并是因为两组的"用真实 translator"理由不同（那组测代价/冷却，
   * 这组测说明的秒数），而合并会让任何一边改口径时误伤另一边。
   */
  function rows() {
    return buildKeyRows({
      bindings: DEFAULT_BINDINGS,
      registry: createRegistry({ entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] }),
      snapshotOf: () => ({ skills: [] }) as never,
      translate: (key: string, params?: Readonly<Record<string, string | number>>) =>
        translator.t(key as never, params as never),
      playerSkillIds: PLAYER_SKILL_IDS,
    } as never);
  }

  /** 从技能表里按 id 找技能（`ALL_SKILLS` 是玩家 + Boss 的全集）。 */
  function skillOf(id: string) {
    const skill = ALL_SKILLS.find((s) => s.id === id);
    expect(skill, `技能表里没有 ${id}`).toBeDefined();
    return skill;
  }

  /**
   * 毫秒时长 → 说明里那个秒数。
   *
   * ⚠️ 走**产品代码那一个函数**（`app/displayTime.ts` 的 `displaySeconds`），
   * 不在这里抄一份换算 —— 抄一份的话，"0.6 被进位成 1"这类错会同时出现在
   * 实现和测试里，两边一起错就没人发现（本轮那个 bug 正是这个形状：
   * 实现与测试都以为 `Math.round` 是对的）。
   */
  const secondsNumber = displaySeconds;

  it('模板清单里提到的技能，行数据都要带上 `descParams`', () => {
    const all = rows();
    const keysNeedingSeconds = messageKeysMatching('seconds');
    /** ⚠️ 空清单 = 这条测试空转、永远绿 —— 至少「闪」「避」两条要在。 */
    expect(keysNeedingSeconds.length).toBeGreaterThanOrEqual(2);

    const missing = keysNeedingSeconds.filter((key) => {
      const row = all.find((r) => r.descKey === key);
      /** 引用了 `{seconds}` 的 key 若不属于任何**可绑技能**，这条不管它。 */
      if (row === undefined) return false;
      return row.descParams?.seconds === undefined;
    });
    expect(
      missing,
      `这些说明模板写了 {seconds}，但行数据没带时长（界面会显示 {seconds} 本身）：${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('「闪」的说明里的秒数来自 `FLASH_IFRAME.duration`', () => {
    const flash = skillOf('flash');
    const row = rows().find((r) => r.skillId === 'flash');
    expect(row, '「闪」必须出现在设置页的行里').toBeDefined();
    expect(
      row?.descParams?.seconds,
      '「闪」说明里的秒数必须等于 FLASH_IFRAME.duration',
    ).toBe(secondsNumber(FLASH_IFRAME.duration));

    /** ⚠️ 只钉"说明里出现内容那个时长"，不钉它的具体取值（黄金覆盖取值）。 */
    const rendered = translator.t(flash!.descKey as never, row?.descParams as never);
    expect(rendered, '说明里的秒数要来自内容').toContain(
      String(secondsNumber(FLASH_IFRAME.duration)),
    );
  });

  it('「避」的说明里的秒数同样来自 `DODGE_IFRAME.duration`', () => {
    const row = rows().find((r) => r.skillId === 'dodge');
    expect(row?.descParams?.seconds, '「避」说明里的秒数来自内容').toBe(
      secondsNumber(DODGE_IFRAME.duration),
    );
  });
});
