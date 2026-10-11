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
 * 它们直接复用**视图层已经算好的那套**（`snapshot.skills`，含「防」的
 * 按住消耗换算）。在这里重算一遍的话，两处的文案迟早会不一致 ——
 * 这类"同一件事两个真相来源"的问题很难查。
 */

import type { BattleLoop } from './battleLoop';
import type { KeyBinding } from '../input/keyboard';
import type { KeyRow } from '../ui/settings/rows';
import type { ContentRegistry } from '../core/content/registry';
import { PLAYER_SKILL_IDS } from '../data/content';

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

export interface BuildKeyRowsOptions {
  readonly bindings: readonly KeyBinding[];
  readonly registry: ContentRegistry;
  /** 取当前快照里的技能格（代价 / 冷却的**唯一来源**）。 */
  readonly snapshotOf: () => BattleLoop['snapshot'];
  readonly translate: (
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ) => string;
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
    const costText =
      slot?.cost === undefined
        ? ''
        : translate(
            slot.cost.suffix === undefined
              ? 'settings.detailCost'
              : 'settings.detailCostPerSecond',
            {
              value: Math.round(slot.cost.value),
              resource: translate(`resource.${slot.cost.resource}`),
            },
          );
    const cdText =
      slot === undefined || slot.skillCdSec <= 0
        ? ''
        : translate('settings.detailCd', { seconds: Math.round(slot.skillCdSec) });
    /**
     * **施放方式**从数据推导（需求："包括瞬发与否，这些应该是结构化的显示"）。
     *
     * ⚠️ 优先级：`holdDrain` > `castTime`。按住型技能（「防」）的 `castTime`
     * 是 0，但它显然不是"瞬发" —— 只看 `castTime` 会把它显示错。
     */
    const castText =
      skill.holdDrain !== undefined
        ? translate('settings.detailHold')
        : skill.castTime <= 0
          ? translate('settings.detailInstant')
          : translate('settings.detailCast', { seconds: skill.castTime / 1000 });
    const hintTags = skill.hintTags;
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
    return {
      skillId: b.skillId,
      nameKey: skill.nameKey,
      key: b.key,
      ...(skill.descKey === undefined ? {} : { descKey: skill.descKey }),
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
