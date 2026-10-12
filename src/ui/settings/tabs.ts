/**
 * 设置面板的 **tab 集合**（"哪几页能看到"的**唯一判据**）。
 *
 * ==================================================================
 * 为什么按"从哪打开的"分（2026-10-12 用户定案）
 * ==================================================================
 *
 * 用户原话："**首页点开的设置，可以不要 按键tab**。"
 *
 * 理由是**上下文**：首页那里没有战斗、没有技能栏，"给技能配键 /
 * 配触屏按钮"**没有对象** —— 列出来只会让人以为可以配。
 *
 * ⚠️ 而触屏键位是**集成在「按键」页**里的（用户同一轮的要求：
 * "刚说的触屏的按键设置方法，最好集成到 按键tab 里面"），所以
 * "首页没有「按键」页" ⇒ **首页就配不了触屏键位**。这条连带后果是
 * **有意的**（没有技能就没得配），但它是判断不是细节，所以在
 * `docs`／回报里都明确写出来。
 *
 * ==================================================================
 * 为什么单独一个文件、而且只有这一个函数
 * ==================================================================
 *
 * 这一轮之前"哪些 tab 可见"是**常量**（`SETTINGS_TABS`），于是它有
 * 5 个消费者各扫一遍那张表：命中测试、外框渲染、焦点移动、`Enter`
 * 激活、助记键。一旦它变成"按来源取值"，散着写就必然漂
 * （本仓库刚在 P2 收口过 `phase`、在复盘收口过输入归属）。
 *
 * 所以收成一个**纯函数** `visibleTabs(origin)`，谁要问"有哪些页"都
 * 来调它 —— 它不认识 Pixi、不认识 DOM，可以直接单测（见
 * `tests/unit/settingsTabs.test.ts`）。
 */

/** 设置面板的页。 */
export type SettingsTab = 'general' | 'keys';

/**
 * 打开设置的**来源**。
 *
 * ⚠️ 只有两个值，因为判据只有一条："此时有没有技能可以配"。
 * `home` = 首页（没有任何战斗上下文）→ 只剩「通用」页。
 */
export type SettingsOrigin =
  /** 首页（没有任何战斗上下文）。 */
  | 'home'
  /**
   * **选角色屏**（肉鸽模式的第一屏）。
   *
   * ⚠️ 用户 2026-10-12："肉鸽选人界面的设置也是没有按键的" —— 与首页同理：
   * 那一刻**还没决定用谁**，技能表也就还没定，所以没有可配的东西。
   * ⚠️ 它**不是** `home` 的别名：两个相位的语义不同（首页是"还没开局"，
   * 这里是"正在选人"），共用会让人以后想给其中一个加页时无从下手。
   */
  | 'characterSelect'
  /** 自由模式 / 战斗中（这时"这一局"已经定了）。 */
  | 'gameplay';

/**
 * 每一页的**展示顺序** —— tab 位置的唯一真相。
 *
 * ⚠️ 顺序**不许整理**：`index` 是助记键（`G` / `K`）与既有测试锚定的
 * （0 通用、1 按键），也会进 `focus`（`{zone:'tabs', index}`）。
 */
export const ALL_SETTINGS_TABS: readonly SettingsTab[] = ['general', 'keys'];

/**
 * 这个来源下**能看到**的页（顺序 = tab 从左到右）。
 *
 * 首页没有「按键」页：那里没有技能、没有技能栏，也就没有可配的东西。
 */
export function visibleTabs(origin: SettingsOrigin): readonly SettingsTab[] {
  /** ⚠️ **只有 gameplay 有「按键」页**（其余来源都没有技能可配）。 */
  return origin === 'gameplay' ? ['general', 'keys'] : ['general'];
}

/** 这个来源下这一页在不在。（`hitTest` / 助记键都要问它。） */
export function tabIsVisible(origin: SettingsOrigin, tab: SettingsTab): boolean {
  return visibleTabs(origin).includes(tab);
}

/**
 * 这个来源在**第 `index` 个位置**上是哪一页（越界返回 `undefined`）。
 *
 * ⚠️ 用它而不是 `ALL_SETTINGS_TABS[index]`：后者会把首页的
 * "第 0 个位置"读成「通用」、把越界的读成 undefined —— 而 tab 布局
 * 是按**可见集合**排的，用错表会让焦点与 `Enter` 作用在不同页上。
 */
export function tabAt(origin: SettingsOrigin, index: number): SettingsTab | undefined {
  return visibleTabs(origin)[index];
}

/**
 * 打开设置时该落在哪一页。
 *
 * @param requested 调用方想开的那一页（齿轮 / 调试入口都给 `'keys'`）
 *
 * 请求的页在这个来源下不可见时**退到第一页**，而不是停在一个画不出来
 * 的 tab 上 —— 否则 `F1` 在首页会打开一个"选中了按键页、内容却没了"
 * 的面板（截图上是空白，很难查）。
 */
export function preferredTab(origin: SettingsOrigin, requested: SettingsTab): SettingsTab {
  const tabs = visibleTabs(origin);
  return tabs.includes(requested) ? requested : (tabs[0] ?? 'general');
}
