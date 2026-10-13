/**
 * **相位（`Phase`）的路由决策** —— 纯函数，可在 node 里测。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一轮加了两件**由相位决定**的事：
 *
 *   1. **返回**（`Esc` / 点左上角的箭头）= 回首页，只在
 *      **自由模式 / 选角色屏** 成立
 *   2. **`F1` 打开设置**（原先是 `Esc` / `,`）—— 而 `Esc` 腾出来做返回
 *
 * 它们都是"**这个相位下，某个键/某个控件意味着什么**"的问题。写进
 * `settingsKeys.ts` 或 `game.ts` 都行，但那样一来：
 *
 *   - 返回键的可用相位、返回目标的相位、返回按钮的可见相位会散在三个文件里，
 *     而它们**必须是同一张表**（"按钮看得见、按 Esc 却没反应"正是漂移的样子）
 *   - 这张表**没法单测**（那两个模块都要 DOM / Pixi）
 *
 * ⚠️ 与 `flow.ts` 的分工：那边是**状态**（`GameState` / `applyPhase` 的
 * 显隐落实点），这里是**判定**（哪个键、哪个控件、路由到哪）。函数都是纯的，
 * 不认识 Pixi 也不认识 DOM。
 *
 * ==================================================================
 * 为什么 `Phase` 搬到这里、再由 `flow.ts` 转发
 * ==================================================================
 *
 * 判定的入参就是 `Phase`，而 `flow.ts` 的 `GameState` 已经很大。定义留一处
 * （这里），`flow.ts` 用 `export type { Phase }` 转发 —— 于是
 * `import type { Phase } from './flow'` 这种既有写法**照旧可用**，
 * 不会因为这次搬家改动一片文件的 import。
 */

/**
 * 当前阶段（**界面路由**）。
 *
 * ==================================================================
 * 用户 2026-10-12 定的流程（设计稿 §3.1 的旧状态机已作废）
 * ==================================================================
 *
 * ```
 * 首页（新，默认入口）
 *   ├─ 「肉鸽模式」 → 选角色屏（新）→ 一局肉鸽
 *   │     └─ 每场打完 → 选炁机（P3）→ 下一场 … → 一局结束（P3）
 *   └─ 「自由模式」 → 现在的备战界面（标题改成「自由模式」）
 *        └─ Esc / 点左上角返回 → 回首页
 * ```
 *
 * ⚠️ **首页是安全的默认入口**（它只是路由，不通向半成品）；
 * 而"选角色屏直接当正门"**不安全** —— 肉鸽那条路还不完整
 * （强度曲线是 P4/P5、7 个 Boss 只有 2 个能打）。
 * ⚠️ 这句话是**判断**不是细节，设计稿 §3.1 里也重复了一遍。
 *
 * ⚠️ **不要新增 `'result'`**：结算面板本来就画在 `BattleScene` 里
 * （设计稿 §3.2 专门写了这条）。把它提升成独立 phase 会让"战斗场景的
 * 显隐"多一个状态，而"两个界面同时可见"是这个仓库踩过的坑。
 *
 * ⚠️ 加值必须**同时**改这些 `phase` 的消费者（设计稿 §3.2 那张表）：
 *   `game.ts`（显隐的唯一写入点 `applyPhase` / 触屏 `isBattleActive` /
 *   指针路由的 `phase` / 设置焦点）、`loopWiring.ts`（每帧分发 + 键盘分发）、
 *   `canvasInput.ts`（指针路由）、`debugApiSetup.ts`（补一次界面摆位）。
 */
export type Phase =
  | 'home'
  | 'characterSelect'
  | 'prepare'
  | 'battle'
  /**
   * **选炁机**（P3；每场战斗打完之后选 1 个生效）。
   *
   * ⚠️ 它**只在第一场打完之后**才会出现（用户 2026-10-13 的规则第 3 条）：
   * 开局那一条路（`startRoguelikeRun`）直接进战斗，不经过这里。
   */
  | 'qijiSelect'
  /** **一局肉鸽结束**（通关 / 失败）的摘要屏（P3）。 */
  | 'runOver';

/**
 * ⚠️ **类型**导入（编译期擦除，不构成循环依赖）：`ui/settings/tabs.ts`
 * 是"哪几页可见"的真相，这里只借它的 `SettingsOrigin` 命名。
 */
import type { SettingsOrigin } from '../ui/settings/tabs';

/**
 * **返回能去哪**。
 *
 * ⚠️ 单独给出这个类型是为了让"返回目标"是"整屏界面"那几个相位的**真子集**：
 * `switchTo` 只接受可以整屏切换的相位，而 `Phase` 还包含 `battle` ——
 * 返回 `Phase` 的话调用方要么断言、要么再判一次（两份判据）。
 *
 * ⚠️ P3 起了**第二个**目标（`'characterSelect'`）：选炁机屏与"一局结束"
 * 屏都回**选角色**，而不是首页 —— 因为"这一局还没完"（选炁机）与
 * "这一局刚完，要不要再来"（结束屏）都该回到"开一局"的起点。
 * 首页是"我不想玩了"的意思，那是 `Esc` 在自由模式 / 选角色屏上的语义。
 */
export type BackTarget = 'home' | 'characterSelect';

/**
 * 键位表里 `Esc` 的键名（`normalizeKey` 归一化之后的形状）。
 *
 * ⚠️ 它是**键位**，不是文案：写在渲染层/输入层，**不进 i18n**
 * （AGENTS.md §3b）。
 */
export const ESCAPE_KEY = 'escape';

/**
 * 返回按钮（左上角那个箭头）在哪些相位可见。
 *
 * | 相位 | 返回按钮 | 为什么 |
 * |---|---|---|
 * | `home` | ✗ | 首页就是返回的目标，再画一个就自指了 |
 * | `characterSelect` | ✅ | 回首页 |
 * | `prepare` | ✅ | 回首页 |
 * | `qijiSelect` | ✅ | 回**选角色**（放弃这一局；见 `BackTarget` 的说明） |
 * | `runOver` | ✅ | 回**选角色**（"再来一局"的起点，与 Enter 同一个目标） |
 * | `battle` | ✗ | 战斗中没有"返回"——见 `phaseFromEscape` 的说明 |
 */
export function backVisibleIn(phase: Phase): boolean {
  return (
    phase === 'characterSelect' ||
    phase === 'prepare' ||
    phase === 'qijiSelect' ||
    phase === 'runOver'
  );
}

/**
 * ⚠️ **战斗里按 `Esc` 什么都不做**（用户的判断，这里记下来）。
 *
 * 原因是"战斗中的 `Esc` 传统上是**暂停 / 菜单**"—— 而本作**没有菜单**
 * （`Esc` 曾经短暂地兼过"打开设置"，那正是这次要改掉的东西）。
 * 既然没有菜单，`Esc` 在战斗中就没有语义，于是**不做任何事**：
 *
 *   - 不返回首页：中途放弃一局、连确认都没有，是比"没反应"更坏的行为
 *   - 不打开设置：那是 `F1` 的事（见 `settingsKeys.ts`）
 *
 * 于是返回目标由相位决定，而"没有目标"就是"什么都不做"：
 *
 * | 相位 | `Esc` |
 * |---|---|
 * | `home` | 无目标（首页就是目标本身） |
 * | `characterSelect` | → `'home'` |
 * | `prepare` | → `'home'` |
 * | `qijiSelect` | → `'characterSelect'`（这一局还没完，但可以放弃重开） |
 * | `runOver` | → `'characterSelect'` |
 * | `battle` | 无目标 |
 *
 * ⚠️ 返回是**又一次相位转移**，调用方必须走 `game.ts` 的 `switchTo` /
 * `applyPhase`（显隐的唯一写入点）—— **不要**在这里或别处手写 `setVisible`。
 *
 * ⚠️ 选炁机屏的返回**不等价于"跳过选择"**：它把这一局丢掉（回选角色）。
 * 之所以不做"跳过"（保留这一局、不选炁机直接打下一场），是因为那会让
 * "选 1 个生效"这条节拍有一个静默的旁路，而玩家点返回时的心理预期是
 * "离开"。**不选也行**的做法是提供一条明确的"跳过"按钮 —— 那是以后的事。
 *
 * @returns 该去的相位；`undefined` = 这次 `Esc` 不该有反应
 */
export function phaseFromEscape(phase: Phase): BackTarget | undefined {
  if (phase === 'characterSelect' || phase === 'prepare') return 'home';
  if (phase === 'qijiSelect' || phase === 'runOver') return 'characterSelect';
  return undefined;
}

/**
 * **某个界面控件该不该显示** —— `applyPhase` 只用这张表。
 *
 * 加一个界面控件（例如以后的"图鉴"）时，只需要在这里加一个函数并在
 * `game.ts` 的 `applyPhase` 里多一行，而不是在每条转移路径上各补一次。
 *
 * ⚠️ 它与 `backVisibleIn` **必须同源**：`backVisibleIn` 是"返回在这里
 * 成不成立"，也就是"箭头该不该出现"。两处各写一遍 `phase === 'characterSelect'
 * || phase === 'prepare'` 就是两份会漂的真相 —— 而漂移的样子正是
 * "看得见、点不动"。
 */
export const CONTROL_VISIBILITY = {
  /** 左上角的返回按钮。 */
  back: backVisibleIn,
} as const;

/**
 * **整屏界面的键** —— stage 上"一屏一棵"的那几棵不透明满屏子树。
 *
 * ⚠️ 它与 `Phase` **是两个类型**（虽然现在值恰好一一对应）：`phase` 是
 * "现在在哪一屏"，而"哪一屏由哪个相位点亮"是下面那张表**写出来的**事实。
 * 拆开之后，"两个相位共用一屏"这种设计是**表里多写一行**，而不是一个
 * 必须先改类型才能表达的东西。
 */
export type ScreenKey =
  | 'home'
  | 'characterSelect'
  | 'prepare'
  | 'battle'
  | 'qijiSelect'
  | 'runOver';

/**
 * **哪个相位点亮哪一屏** —— 这是"谁该可见"的**唯一判据**。
 *
 * ==================================================================
 * 为什么它是一张表，而不是 `applyPhase` 里的四条 `phase === '…'`
 * ==================================================================
 *
 * 原先 `applyPhase` 里写的是：
 *
 * ```ts
 * state.home?.setVisible(phase === 'home');
 * state.select?.setVisible(phase === 'characterSelect');
 * state.prepare?.setVisible(phase === 'prepare');
 * d.scene.root.visible = phase === 'battle';
 * ```
 *
 * 它**只有一处写入点**（这点一直是对的），但"哪一屏对应哪个相位"这件事
 * 被摊成了四段各自的字面量。加一个相位时，编译器**不会**提醒任何一处
 * —— 表现是"切过去之后一屏都不显示"（黑屏），而不是编译错误。
 *
 * 收成 `Record<Phase, ScreenKey>` 之后：`Phase` 加一个值 → **编译期**
 * 立刻要求这里补一行。这是"判据只有一处"从纪律变成机器检查的那一步。
 *
 * ⚠️ **不导出这张表本身**：导出的判据只有 `screenVisibilityOf`
 * （一份**完整的**显隐向量）。表 + 一个"从表摊平"的函数都暴露出去，
 * 就又多了一条可能被绕过的路。
 *
 * ⚠️ **`applyPhase` 只许读 `screenVisibilityOf`**：任何地方再手写一句
 * `setVisible(phase === '…')` 就是把这张表拆成了两份真相 —— 而两份真相
 * 漂移的样子正是"两个界面同时可见"（本仓库踩过的那类）。
 */
const STAGE_SCREEN: Readonly<Record<Phase, ScreenKey>> = {
  home: 'home',
  characterSelect: 'characterSelect',
  prepare: 'prepare',
  battle: 'battle',
  qijiSelect: 'qijiSelect',
  runOver: 'runOver',
};

/**
 * 某个相位下**四个整屏界面各自的显隐**（`applyPhase` 把这份结果原样落实）。
 *
 * 之所以给的是"整份显隐"而不是"哪一屏在场"：`applyPhase` 需要**同时**
 * 说出"谁可见"与"谁不可见"（只写可见的那一个，其余就会停在上一屏的
 * 状态上 —— `setVisible(false)` 必须被显式执行）。于是"唯一判据"必须是
 * 一份**完整的**显隐向量。
 *
 * ⚠️ 不变量（`tests/unit/phaseVisibility.test.ts` 盯着它）：**每个相位
 * 恰好点亮一个界面**。两个同时为真 = 两个整屏界面重叠（本仓库的经典
 * bug 形状）；一个都不为真 = 黑屏。
 */
export function screenVisibilityOf(phase: Phase): Readonly<Record<ScreenKey, boolean>> {
  const onStage = STAGE_SCREEN[phase];
  return {
    home: onStage === 'home',
    characterSelect: onStage === 'characterSelect',
    prepare: onStage === 'prepare',
    battle: onStage === 'battle',
    qijiSelect: onStage === 'qijiSelect',
    runOver: onStage === 'runOver',
  };
}

/**
 * 设置面板是**从哪打开的** —— 决定它能显示哪几页。
 *
 * ==================================================================
 * 为什么这个判定住在 `phaseLogic.ts`
 * ==================================================================
 *
 * 它就是"**这个相位下，某个界面意味着什么**"那类问题，与
 * `backVisibleIn` / `phaseFromEscape` 同一张表（用户 2026-10-12：
 * "首页点开的设置，可以不要 按键tab"）。
 *
 * ⚠️ **只有首页**算"没有上下文"：首页没有战斗、没有技能栏，
 * 所以"给技能配键 / 配触屏键位"没有对象。选角色屏与自由模式都已经是
 * "这一局"的一部分（技能表就在那儿），所以它们照旧显示「按键」页。
 *
 * ⚠️ 判据落在这里而不是 `settingsToggle` / `game.ts`：那两个地方
 * 各自写一遍 `phase === 'home'` 就会漂，而漂的样子是"从首页打开的设置
 * 里出现了按键页"（截图上看不出对错）。
 *
 * `ui/settings/tabs.ts` 的 `visibleTabs(origin)` 才是"哪几页可见"的
 * 唯一真相；这里只负责 `Phase → SettingsOrigin` 这一步翻译。
 */
export function settingsOriginOf(phase: Phase): SettingsOrigin {
  if (phase === 'home') return 'home';
  /**
   * ⚠️ **选角色屏也没有「按键」页**（用户 2026-10-12："肉鸽选人界面的设置
   * 也是没有按键的"）—— 那一刻还没决定用谁，技能表还没定。
   *
   * ⚠️ P3 的 `qijiSelect` **不算这里**：它已经在肉鸽那一局里、角色已经定了，
   * 所以照旧显示「按键」页（走下面的 `'gameplay'`）。`runOver` 同理 ——
   * 它虽然"这一局结束了"，但玩家马上要回选角色，没有"当前角色"可变。
   */
  if (phase === 'characterSelect') return 'characterSelect';
  return 'gameplay';
}
