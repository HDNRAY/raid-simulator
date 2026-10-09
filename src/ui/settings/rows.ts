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
  /** 技能说明的 i18n key（详情区用） */
  readonly descKey?: string;
  /** 代价文案（已格式化，如 `10 炁` / `2 炁/秒`）；没有代价则为空 */
  readonly costText?: string;
  /** 固有冷却文案（如 `5 秒`）；没有冷却则为空 */
  readonly cdText?: string;
}

