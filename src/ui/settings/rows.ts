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

