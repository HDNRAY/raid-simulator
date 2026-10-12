/**
 * 设置页「按键」页每一行的数据。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这块逻辑本来在 `main.ts` 里内联着，而 `main.ts` 已经贴着 700 行上限
 * （AGENTS.md §3）。它同时牵涉四样东西 —— 键位表、内容注册表、
 * 视图快照、i18n —— 所以抽出来更清楚，也给 `main.ts` 腾了地方。
 *
 * ==================================================================
 * ⚠️ 代价与冷却**不在这里重算**
 * ==================================================================
 *
 * 它们直接复用**视图层已经算好的那套**（`snapshot.skills`，含「卸」的
 * 按住消耗换算）。在这里重算一遍的话，两处的文案迟早会不一致 ——
 * 这类"同一件事两个真相来源"的问题很难查。
 */

import type { BattleLoop } from './battleLoop';
import type { KeyBinding } from '../input/keyboard';
import type { KeyRow } from '../ui/settings/rows';
import type { ContentRegistry } from '../core/content/registry';
import { holdDrainPerSecond } from '../core/combat/holds';
import { LOGIC_TICKS_PER_SECOND } from '../core/loopConstants';
import { PLAYER_SKILL_IDS } from '../data/content';
import { hintKeysOf } from './skillHints';
import type { TranslateFn } from '../i18n/translator';
import { flattenCatalog } from '../i18n/translator';
import { zhCN } from '../i18n/locales/zh-CN';

/**
 * ==================================================================
 * ⚠️ **说明文案里的数值必须从数据推导**（根治"两份真相"）
 * ==================================================================
 *
 * 这一块解决的是一个**已经犯过**的错：`skill.dodge.desc` 里写着
 * "获得 0.5 秒完全无敌"，而 0.5 秒真正的家是 `DODGE_IFRAME.duration`。
 * 同一个数字有两份表达 ⇒ 改数值时**必然漏一处**（改「闪」0.1 → 0.2
 * 那次就差点漏掉文案）。
 *
 * 现在的分工：
 *   - **模板**住在 i18n（`获得 {seconds} 秒无敌，不花炁，但窗口极窄。`）
 *   - **数值**只有一个来源 —— 技能授予的那个 buff 的 `duration`，
 *     由下面 `buffGrantedSeconds()` 推导
 *   - **拼装**发生在 `SkillDetail.render`（把 `descParams` 交给 `t()`）
 *
 * ⚠️ 判据是**模板里有没有 `{seconds}`**，不是"技能有没有 buff"：
 * 只有真的要显示秒数的说明才传参。若不看模板，就会给那些**没有占位符**
 * 的说明也塞 `{seconds}` —— 虽然 `t()` 对多余参数是宽容的，但那是
 * "靠巧合正确"。
 */

/**
 * 全部 i18n key → 模板（启动时扁平化一次）。
 *
 * ⚠️ 用**基准语言**（`zh-CN`）来判"哪个说明模板要秒数"。语言包是数据，
 * 各语言模板里的占位符名由 i18n 规范约束为同一套，所以看基准语言即可；
 * 而且这样不依赖调用方传进来的 `translate` 是哪一份（测试会传假实现）。
 */
const TEMPLATES = flattenCatalog(zhCN);

/**
 * 模板里含某个占位符的全部 i18n key。
 *
 * ⚠️ **导出是为了能对它写测试**：下面那条"说明里的秒数必须来自数据"
 * 需要一份**权威清单**（"哪些说明模板引用了 `{seconds}`"）—— 让测试
 * 自己写死名单就会变成第三份真相，加了新说明也不会提醒任何人。
 */
export function messageKeysMatching(placeholder: string): readonly string[] {
  const needle = `{${placeholder}}`;
  return [...TEMPLATES.entries()]
    .filter(([, template]) => template.includes(needle))
    .map(([key]) => key)
    .sort();
}

/** 描述模板里出现的占位符名。 */
function placeholdersOf(template: string): readonly string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/**
 * 这个技能**授予自己**的 buff 的时长（秒）；没有就给 `undefined`。
 *
 * 只认 `target.mode === 'self'` 的 `grant`：给敌人挂的 debuff 时长
 * 与"我获得 X 秒……"不是同一句话（例如「轰」的易伤）。
 * 多个自我 grant 时取**第一个** —— 当前内容里每个技能最多一个，
 * 真出现两个时该由内容设计决定写哪一个，不该由这里默默挑一个。
 * 写成契约（返回 `undefined`）而不是猜，是为了让它**在测试里现形**。
 */
function buffGrantedSeconds(skill: {
  readonly abilities: readonly {
    readonly kind: string;
    readonly target?: { readonly mode: string };
    readonly buff?: { readonly duration: number };
  }[];
}): number | undefined {
  for (const ability of skill.abilities) {
    if (ability.kind !== 'grant') continue;
    if (ability.target?.mode !== 'self') continue;
    const ms = ability.buff?.duration;
    if (ms === undefined || !Number.isFinite(ms)) continue;
    return secondsFromMs(ms);
  }
  return undefined;
}

/** 逻辑步口径的换算：毫秒 → 秒。 */
function secondsFromMs(ms: number): number {
  /**
   * 先归到**逻辑步**（本作的逻辑最小单位，0.1 秒）再折成秒，而不是
   * 直接 `ms / 1000` —— 那样浮点会给出 `0.19999999999999998`
   * （`logicMs(2)` 的毫秒数除 1000），而文案要的正是玩家看到的
   * **0.2**。四舍五入到逻辑步也顺带保证"显示的秒数 = 内容的逻辑步数"。
   */
  const steps = Math.round((ms / 1000) * LOGIC_TICKS_PER_SECOND);
  return steps / LOGIC_TICKS_PER_SECOND;
}

/**
 * 这个技能该不该出现在设置页的按键列表里。
 *
 * ==================================================================
 * ⚠️ 为什么用 `PLAYER_SKILL_IDS` 而不是判 id 前缀
 * ==================================================================
 *
 * 原先的条件是 `!sk.id.startsWith('boss-')` —— 靠**命名约定**判断归属。
 * 「色欲」的技能 id 是 `lust-hum` / `lust-entangle` / `lust-charm`，
 * **不以 `boss-` 开头**，于是全部漏过，**Boss 的技能出现在按键设置里**。
 *
 * 而 `ALL_SKILLS` 本身是 `PLAYER_SKILLS` + 各 Boss 技能表拼出来的，
 * 所以"在不在 `PLAYER_SKILL_IDS` 里"是**结构性**判据：新加 Boss 自动生效，
 * 不依赖任何人记得维护前缀。
 *
 * 抽成导出的纯函数是为了**能直接对它写回归测试** ——
 * 这类"漏掉一个 Boss 前缀"的 bug 不会自己暴露，只会静默多出几行 UI。
 */
export function isBindablePlayerSkill(skill: {
  readonly id: string;
  readonly requires?: readonly unknown[];
}): boolean {
  if (skill.id === '') return false;
  if (!PLAYER_SKILL_IDS.has(skill.id)) return false;
  /**
   * 排除派生技（带 `requires` 的，如「击」）：它靠派生出现，
   * **不由玩家直接按**，列出来只会让人困惑。
   */
  return (skill.requires?.length ?? 0) === 0;
}

/**
 * **可选技能池** —— 设置界面能列出来的那些技能 id。
 *
 * ==================================================================
 * 为什么抽出来（用户 2026-10-12）
 * ==================================================================
 *
 * 用户原话："触屏和键盘当然是 2 套……只是**可选技能是一样的**。"
 *
 * 这句话要落到**两个消费者**上：
 *   1. 「按键」页列出的技能（`buildKeyRows`，键盘那套）
 *   2. 触屏按钮集合的**校验池**（`app/deps.ts` 加载存档时用它丢坏数据）
 *
 * 两边各写一遍过滤，迟早会漂成"设置页列得出来、但存档一读就被丢掉"
 * 或者反过来 —— 那正是这类 bug 最难查的形态。所以池子只有这一份。
 */
export function bindableSkillIdsOf(registry: ContentRegistry): ReadonlySet<string> {
  return new Set(
    [...registry.skills.values()].filter(isBindablePlayerSkill).map((s) => s.id),
  );
}

export interface BuildKeyRowsOptions {
  readonly bindings: readonly KeyBinding[];
  readonly registry: ContentRegistry;
  /** 取当前快照里的技能格（代价 / 冷却的**唯一来源**）。 */
  readonly snapshotOf: () => BattleLoop['snapshot'];
  readonly translate: TranslateFn;
}

/**
 * 构造设置页的行数据。
 *
 * ⚠️ `bindings` 通过 `options` 传**引用**而不是提前取一份：
 * 改键会替换那个数组，取一份就会显示过期的键。
 */
export function buildKeyRows(options: BuildKeyRowsOptions): readonly KeyRow[] {
  const { registry, translate } = options;
  /**
   * ================================================================
   * **列出全部玩家技能，不只是已绑定的那些**
   * ================================================================
   *
   * 需求（用户两次提出）："我还是没在按键设置里看到『截』"。
   *
   * ⚠️ 根因：这里原先只遍历 `bindings`（**绑定表**），而没绑键的技能
   * 根本不在里面 —— 于是「截」（需求："不绑"）**在设置页完全不存在**，
   * 玩家也就**没法给它绑键**。这是个死循环：要绑它才出现，但它不出现
   * 就没法绑。
   *
   * 现在遍历**技能全集**，没绑的排后面（已绑的在前，保持原有顺序）。
   */
  const boundOrder = new Map(options.bindings.map((b, i) => [b.skillId, i]));
  /**
   * ⚠️ 只列**玩家技能**：`registry.skills` 里也有 Boss 技能，那些不该让
   * 玩家绑键。判据见 `isBindablePlayerSkill` 的说明 ——
   * **不要退回按 id 前缀过滤**，那对「色欲」是失效的。
   */
  const all = [...registry.skills.values()].filter(isBindablePlayerSkill);
  const ordered = all
    .map((sk) => sk.id)
    .sort((a, b) => {
      const ai = boundOrder.get(a);
      const bi = boundOrder.get(b);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.localeCompare(b);
    });
  return ordered.map((skillId) => {
    const b = { skillId, key: options.bindings.find((x) => x.skillId === skillId)?.key ?? '' };
    const skill = registry.skill(b.skillId);
    const slot = options.snapshotOf().skills.find((x) => x.skillId === b.skillId);
    /**
     * ================================================================
     * ⚠️ 代价 / 冷却**必须先看快照，再看静态数据**
     * ================================================================
     *
     * 需求（用户报告）："所有技能的消耗，在这里没了……之前是又有描述，
     * 又有结构化信息，我需要把结构化信息加回来。"
     *
     * **根因**：这两项原先**只**从运行时快照取（`slot`）。战斗里没问题，
     * 但**备战界面还没有战斗** —— `snapshotOf()` 返回 `EMPTY_SNAPSHOT`，
     * 于是 `slot === undefined`，两项都变成空字符串。
     *
     * 而设置齿轮**现在在每一屏都有**（各屏自己的 `ScreenChrome`），
     * 所以"打开设置看技能消耗"最常见的入口正好是**没有快照**的那个 ✗
     *
     * ⚠️ 顺序不能反：**有战斗时以快照为准**。快照里的值可能被运行时
     * 改过（代价减免、冷却缩减、按住技的 `/秒` 后缀），
     * 静态数据只是"还没有战斗时的最佳近似"。
     */
    const staticCost = skill.cost[0];
    const costText =
      slot?.cost !== undefined
        ? translate(
            slot.cost.suffix === undefined
              ? 'settings.detailCost'
              : 'settings.detailCostPerSecond',
            {
              value: Math.round(slot.cost.value),
              resource: translate(`resource.${slot.cost.resource}`),
            },
          )
        : skill.holdDrain !== undefined
          ? /**
             * ⚠️ **按住技（「卸」）的代价不在 `cost` 里，而在 `holdDrain`** ——
             * 它的 `cost: []` 是空的，所以只读 `cost` 会让它显示"没有代价" ✗
             *
             * ⚠️ `holdDrain.perLogicTick` 是**每逻辑步**的代价，而设置页
             * 写的是"每秒多少"。换算走 `holdDrainPerSecond()` —— 与技能栏
             * 用的是**同一个函数**，所以两处不可能各写一个数。
             *
             * 这里曾经把 `perLogicTick` **直接当成每秒**插进文案：显示 "3 炁/秒"，
             * 而引擎实际按每步 3 点扣（= 30 炁/秒），10 倍偏差。
             * 见 `data/balance.ts` 的 `GUARD_HOLD_DRAIN_PER_SECOND`。
             */
            translate('settings.detailCostPerSecond', {
              value: holdDrainPerSecond(skill.holdDrain),
              resource: translate(`resource.${skill.holdDrain.resource}`),
            })
          : staticCost === undefined || typeof staticCost.value !== 'number'
          ? ''
          : translate('settings.detailCost', {
              value: Math.round(staticCost.value),
              resource: translate(`resource.${staticCost.resource}`),
            });
    const cdText =
      slot !== undefined
        ? slot.skillCdSec <= 0
          ? ''
          : translate('settings.detailCd', { seconds: Math.round(slot.skillCdSec) })
        : skill.cooldown <= 0
          ? ''
          : translate('settings.detailCd', { seconds: Math.round(skill.cooldown / 1000) });
    /**
     * **施放方式**从数据推导（需求："包括瞬发与否，这些应该是结构化的显示"）。
     *
     * ⚠️ 优先级：`holdDrain` > `castTime`。按住型技能（「卸」）的 `castTime`
     * 是 0，但它显然不是"瞬发" —— 只看 `castTime` 会把它显示错。
     */
    const castText =
      skill.holdDrain !== undefined
        ? translate('settings.detailHold')
        : skill.castTime <= 0
          ? translate('settings.detailInstant')
          : translate('settings.detailCast', { seconds: skill.castTime / 1000 });
    /**
     * ⚠️ 用 `hintKeysOf` 而不是直接读 `skill.hintTags`：控制类提示
     * （「倒地」「眩晕」）是**从效果推导**出来的，不在手写字段里。
     * 见 `app/skillHints.ts`。
     */
    const hintTags = hintKeysOf(skill);
    /**
     * **机械 tag（`SkillTag`）也要显示**。
     *
     * 需求（用户报告）："之前说 给 闪 和 避 加tag，我在设置里看不到啊"
     *
     * ⚠️ 与 `hintTags` 是两个字段（生命周期不同，见 `HintTag` 的说明）：
     *   `hintTags` = 玩法提示（"该怎么应对"，如「打断」）
     *   `tags`     = 机械分类。⚠️ 它的**唯一消费者**是
     *                `BuffFlags.restrictToTags`（倒地时的技能白名单）——
     *                注释里曾说"给触发器的 filter 用"，但那个 filter
     *                **至今没有消费者**，所以别据此以为它被广泛使用。
     * `dodge` 对玩家有意义（"倒地时只有它能按"），所以露出来。
     *
     * ⚠️ 目前只显示**玩家看得懂的那几个**（白名单），不是把 `tags`
     * 全画出来 —— `melee` / `spell` / `dot` 是给引擎看的，
     * 显示给玩家只会增加噪音。要开放更多时往 `VISIBLE_MECHANIC_TAGS`
     * 里加，并在 i18n 里补文案。
     */
    const mechanicTags = (skill.tags ?? []).filter((tag: string) =>
      VISIBLE_MECHANIC_TAGS.has(tag),
    );
    /**
     * **说明里的秒数**（见本文件顶部的"两份真相"说明）。
     *
     * 只在**模板真的要秒数**且**数据真给了时长**时才传 —— 缺任何一边
     * 就留 `undefined`，让 `SkillDetail` 走原来的"无参取词"。这样
     * "模板写了 `{seconds}` 但数据没有时长"不会在渲染时抛错，而是
     * 由 `tests/unit/keyRows.test.ts` 那条断言**在测试里**把它抓出来。
     */
    const descSeconds =
      skill.descKey === undefined ? undefined : buffGrantedSeconds(skill);
    const descTemplate =
      skill.descKey === undefined ? '' : (TEMPLATES.get(skill.descKey) ?? '');
    const descParams =
      descSeconds === undefined || !placeholdersOf(descTemplate).includes('seconds')
        ? undefined
        : { seconds: descSeconds };
    return {
      skillId: b.skillId,
      nameKey: skill.nameKey,
      key: b.key,
      ...(skill.descKey === undefined ? {} : { descKey: skill.descKey }),
      ...(descParams === undefined ? {} : { descParams }),
      ...(costText === '' ? {} : { costText }),
      ...(cdText === '' ? {} : { cdText }),
      ...(castText === '' ? {} : { castText }),
      ...(hintTags === undefined || hintTags.length === 0 ? {} : { hintTags }),
      ...(mechanicTags.length === 0 ? {} : { mechanicTags }),
    };
  });
}

/**
 * 玩家看得懂的机械 tag 白名单。
 *
 * `dodge` 是唯一一个"对玩法有直接影响、玩家需要知道"的 ——
 * 倒地时只有带它的技能能按。
 */
const VISIBLE_MECHANIC_TAGS: ReadonlySet<string> = new Set(['dodge']);
