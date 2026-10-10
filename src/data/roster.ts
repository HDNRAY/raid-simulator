/**
 * **可选的出战名单**：人物与 Boss。
 *
 * ==================================================================
 * 为什么单独一个文件（而不是把名字写进 `main.ts`）
 * ==================================================================
 *
 * 需求："下一步 先做一个 备战界面，选人物 和 选boss，然后点开始才开始，
 * 目前只有这个boss，和目前这个人物，这个人物目前就叫 林晚风。"
 *
 * 备战界面要列出"有哪些人物 / 哪些 Boss 可选"，那是**内容**，不是装配。
 * 放在这里之后，加第二个人物只需要在本文件加一条 + 补 i18n，不动 UI。
 *
 * ==================================================================
 * ⚠️ 这里只放**元数据**，不放构造函数
 * ==================================================================
 *
 * 出战单位的 `Combatant` 由 `main.ts` 的工厂造（那里已有词表：血量上限、
 * 基础属性、Boss 行为数组）。如果把这些也搬进来，本文件就要反向引用
 * `data/content` / `core/ai`，而 `main` 又要引用它 —— 多出一条容易成环的
 * 依赖。**现在的边界是单向的**：`main` 读 roster，roster 不读任何人。
 */

/**
 * 一个人物 / Boss 的展示信息。
 *
 * ⚠️ **只有 id 与显示名**。称号、简介之类是**内容**，要由内容作者决定；
 * 做界面时顺手编一个（我犯过）会让仓库里多出没人要的设定。
 */
export interface RosterEntry {
  /** 战斗单位的 id（同时也是 `bossId`／存档里的标识）。 */
  readonly id: string;
  /** 显示名的 i18n key。 */
  readonly nameKey: string;
}

/**
 * 可选人物。
 *
 * 需求："这个人物目前就叫 林晚风"。
 * ⚠️ 显示名不再用 `hud.you`（"你"）—— 那是"当前操作者"的意思，
 * 而备战界面要的是**角色名**。`hud.you` 仍用在战斗内的第一人称提示里。
 */
export const PLAYER_ROSTER: readonly RosterEntry[] = [
  { id: 'player', nameKey: 'roster.linWanfeng.name' },
];

/** 可选 Boss。需求："目前只有这个boss"。 */
export const BOSS_ROSTER: readonly RosterEntry[] = [
  /** Boss 名沿用已有的 `boss.name`（"伪名一郎"），不另起一个 key。 */
  { id: 'meiichiro', nameKey: 'boss.name' },
  { id: 'lust', nameKey: 'lust.name' },
];

/** 默认选中的（也是目前唯一的）。 */
export const DEFAULT_PLAYER_ID = 'player';
export const DEFAULT_BOSS_ID = 'meiichiro';

/** 按 id 取条目；不存在则 `undefined`（调用方回落到默认）。 */
export function findEntry(
  roster: readonly RosterEntry[],
  id: string,
): RosterEntry | undefined {
  return roster.find((e) => e.id === id);
}

/**
 * 校验一个存下来的 id 是否**仍然可选**，否则回落默认。
 *
 * ⚠️ 存储里的 id 可能来自旧版本（人物被删、改名）—— 直接信它会让备战
 * 界面"选中一个不存在的人"，进而起战斗时拿到空配置。
 */
export function resolvePlayerId(raw: string | null | undefined): string {
  return raw !== null && raw !== undefined && findEntry(PLAYER_ROSTER, raw) !== undefined
    ? raw
    : DEFAULT_PLAYER_ID;
}

/** 同上，Boss 版。 */
export function resolveBossId(raw: string | null | undefined): string {
  return raw !== null && raw !== undefined && findEntry(BOSS_ROSTER, raw) !== undefined
    ? raw
    : DEFAULT_BOSS_ID;
}
