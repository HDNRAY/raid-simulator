/**
 * 按键页的**一行技能**（面板与它的子组件之间的数据形状）。
 *
 * 抽出来的原因：`KeyGrid` / `SkillDetail` 都要它，而它们不该反过来
 * 依赖 `SettingsPanel.ts`（那会形成组件与父组件的环）。
 */

export interface KeyRow {
  /** 技能 id */
  readonly skillId: string;
  /** 技能名的 i18n key（图标就是那个字） */
  readonly nameKey: string;
  /** 当前绑定（归一化键名） */
  readonly key: string;
  /**
   * 玩法提示标签（需求："玩家技能的 tags 显示在设置里"）。
   *
   * 给的是**标签 id**，文案在 i18n 里（渲染层不持有可显示文字）。
   */
  readonly hintTags?: readonly string[];
  /**
   * **机械 tag**（`SkillTag`）里"玩家看得懂"的那几个，如 `dodge`。
   *
   * ⚠️ 与 `hintTags` 分开（后者是玩法提示，如「打断」）：
   * `dodge` 对玩法有直接影响 —— 倒地时只有带它的技能能按 ——
   * 所以它也该在设置里露出来。见 `app/keyRows.ts` 的白名单。
   */
  readonly mechanicTags?: readonly string[];
  /** 技能说明的 i18n key（详情区用） */
  readonly descKey?: string;
  /**
   * **说明模板里的数值参数**（如 `{seconds}`）。
   *
   * ⚠️ 为什么要有它：说明里出现过**写死的数值** —— `skill.dodge.desc`
   * 原文把秒数写死（当时是"获得 0.5 秒完全无敌"，现在「避」是 0.4 秒），
   * 而那个秒数的家是 `DODGE_IFRAME.duration`。
   * 同一个数字两份表达 ⇒ 改一处必漏另一处（改「闪」0.1 → 0.2 那次
   * 就差点漏掉文案）。
   *
   * 现在说明只留模板，数值由 `app/keyRows.ts` 从技能的 buff `duration`
   * **推导**后经这里传下去 —— 与 `costText` / `cdText` / `castText`
   * 同一条纪律（**渲染层不持有可显示数值**）。
   *
   * ⚠️ 这是**数值参数**，不违反"键名不进 i18n"（AGENTS.md §3b）——
   * 那条管的是"括号里的按键名"，不是模板参数。
   */
  readonly descParams?: Readonly<Record<string, string | number>>;
  /** 代价文案（已格式化，如 `10 炁` / `2 炁/秒`）；没有代价则为空 */
  readonly costText?: string;
  /** 固有冷却文案（如 `冷却 10 秒`）；没有冷却则为空 */
  readonly cdText?: string;
  /**
   * **施放**文案（如 `瞬发` / `0.5 秒` / `持续按住`）。
   *
   * ⚠️ 从技能的 `castTime` / `holdDrain` **结构化推导**，而不是写在描述里
   * —— 需求："资源消耗如果单独会说，比如30炁，描述里就不要加了，包括瞬发
   * 与否，这些应该是结构化的显示"。写在描述里会漂移（改了 `castTime`
   * 忘改文案），而这里永远跟着数据。
   */
  readonly castText?: string;
}

