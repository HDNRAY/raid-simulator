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
 *
 * ⚠️ **id 是稳定的存档键**，不要为了迁就素材目录改名
 * （`'player'` 这个 id 还写在 `core/run.ts` 的默认 `actorId` 与
 * `viewAdapter` 的判定里）。素材怎么配在 `render/spriteAssets.ts`。
 */
export const PLAYER_ROSTER: readonly RosterEntry[] = [
  { id: 'player', nameKey: 'roster.linWanfeng.name' },
  { id: 'kaili', nameKey: 'roster.kaili.name' },
  { id: 'daixuan', nameKey: 'roster.daixuan.name' },
];

/**
 * 可选 Boss。
 *
 * 顺序 = 备战界面里卡片的顺序。⚠️ 新加的 5 个在本轮**只有资源与展示**
 * （见 `DEVELOPING`）：具体玩法机制不在本次范围。
 */
export const BOSS_ROSTER: readonly RosterEntry[] = [
  /** Boss 名沿用已有的 `boss.name`（显示值已是"傲慢"），不另起一个 key。 */
  { id: 'meiichiro', nameKey: 'boss.name' },
  { id: 'lust', nameKey: 'lust.name' },
  { id: 'envy', nameKey: 'envy.name' },
  { id: 'gluttony', nameKey: 'gluttony.name' },
  { id: 'wrath', nameKey: 'wrath.name' },
  { id: 'sloth', nameKey: 'sloth.name' },
  { id: 'greed', nameKey: 'greed.name' },
];

/**
 * **开发中**的出战单位（备战界面里灰掉、标"开发中"、不能开战）。
 *
 * ==================================================================
 * 为什么是**独立的一张表**，不是 `RosterEntry` 上的字段
 * ==================================================================
 *
 * 1. **它是状态，不是身份**。素材、名字、血量上限是条目的一部分；
 *    "做完了没有"会变 —— 做完一个就把它从这里删掉，条目本身不用动。
 * 2. `tests/unit/prepareLogic.test.ts` 明确要求条目形状就是
 *    `{ id, nameKey }` 两个键（需求纠正过：不要顺手给角色编称号/简介）。
 *    加字段会让那条断言失败 —— 而那条断言是**对的**。
 *
 * ⚠️ 做完一个 Boss 时，**同时**要把它从这两处去掉：本表 + 它的
 * 行为表（`data/units.ts` 的 `behaviorsFor` 目前给它们的是占位轮转）。
 *
 * ==================================================================
 * 2026-10-12：**凯丽移出这张表**（她有技能了）
 * ==================================================================
 *
 * 她原来在这里（"没有 per-character 技能，选她也只是换了个名字"）。
 * 现在她有自己的 5 招（拳 / 轰 / 凝 / 截 / 闪）与 120 血上限，
 * 所以从这张表删掉 —— 备战界面据此判定"能不能开战"。
 *
 * ⚠️ **只剩黛玄**：她的技能（弹 / 波 / 破 / 盾 / 愈）都还没做，
 * 而且「盾」需要一个引擎还没有的机制（消费式护盾）。所以留着。
 */
const DEVELOPING: ReadonlySet<string> = new Set([
  /**
   * ⚠️ **2026-10-22 起是空的** —— 黛玄做完了（弹 / 波 / 破 / 盾 / 愈）。
   * 这个集合保留着：它是"谁还没做完"的**唯一**判据（备战界面据此灰掉 +
   * 禁止开战），以后加第四个角色时往这里放一行即可。
   */
]);

/** 这个出战单位是不是还在开发中（备战界面据此灰掉 + 禁止开战）。 */
export function isDeveloping(id: string): boolean {
  return DEVELOPING.has(id);
}

/**
 * **能真正打的 Boss** = `BOSS_ROSTER` 里不在 `DEVELOPING` 的那些。
 *
 * ==================================================================
 * 一局肉鸽为什么需要它（设计稿 §2.3）
 * ==================================================================
 *
 * 一局肉鸽的**场数** = `BOSS_POOL.length`（不是写死的 7）。开发期只有 2 个
 * Boss 能打，所以一局就 2 场 —— 而**强度档仍按 7 档表取子集**
 * （`core/run/types.ts` 的 `tierForPosition`：`ceil(k * 7 / len)`），
 * 这样"第一个位置最软、最后一个位置最难"永远成立，补完 Boss 之后
 * 曲线表一个字都不用改。
 *
 * ⚠️ **派生**而不是另抄一份名单：判据只有 `DEVELOPING` 一处，
 * 做完一个 Boss 只需把它从那张表里删掉，这里自动跟着变
 * （两句名单会漂，而漂了之后"第 3 场打一个没做完的 Boss"不会报错）。
 *
 * ⚠️ **未实现的 Boss 共用傲慢的行为表**（`data/units.ts`）——
 * 对玩家来说"第 2 场是嫉妒"和"换了个名字的傲慢"没有区别，
 * 那会让"随机顺序"看起来像 bug。所以池子只放做完的。
 *
 * ⚠️ 声明位置**必须在 `DEVELOPING` 之后**：它在模块求值期就调用
 * `isDeveloping`，而 `const` 的暂时性死区会让"提前声明"直接抛错 ——
 * 函数声明会提升，但它读的那个 `Set` 不会。
 */
export const BOSS_POOL: readonly RosterEntry[] = BOSS_ROSTER.filter(
  (entry) => !isDeveloping(entry.id),
);

/** 默认选中的（也是目前唯一开发完成的）。 */
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
 *
 * ⚠️ **开发中的单位也是"可选"的**：它要在备战界面里被选中、被看到灰掉
 * （需求："备战界面里列出来但灰掉"）。能不能**开战**由 `isDeveloping`
 * 在开始那一刻判，不在这里判 —— 否则玩家永远看不到它灰着的样子，
 * 只会觉得"这个角色不存在"。
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
