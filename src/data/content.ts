/**
 * MVP 内容：**玩家两套技能（按角色装配）+ Boss**。
 *
 * ==================================================================
 * 玩家技能：2026-10-12 起按**角色**分开
 * ==================================================================
 *
 * 原先这里是"一套通用玩家技能"（六招人人都一样）。现在拆成两套 ——
 * 定稿与理由见 `docs/specs/2026-10-12-player-kits.md`：
 *
 * | 角色 | 文件 | 技能 |
 * |---|---|---|
 * | **林晚风**（`player`） | `kits/linwanfeng.ts` | 斩 / 劈 / 凝 / 格 / 避 |
 * | **凯丽**（`kaili`） | `kits/kaili.ts` | 拳 / 轰 / 凝 / 截 / 闪 |
 *
 * 本文件**不再是玩家技能的家**：它只做三件事 ——
 *   1. 汇总两个 kit（`PLAYER_SKILLS` = 并集）与各 Boss 的技能（`ALL_SKILLS`）
 *   2. 定义"哪些 id 是玩家的"（`PLAYER_SKILL_IDS`，见那里的说明）
 *   3. 保存**全默认/兜底**的资源上限（`HP_MAX` 等）
 *
 * ⚠️ 战斗里装哪一套**不在这里决定**：那是 `data/units.ts` 的
 * `skillsForPlayer(id)`（装配）与 `app/battleSetup.ts`（把它交给引擎）。
 * 本文件是"内容全集"，不是"这一局带什么"。
 *
 * ==================================================================
 * 数值刻度（重要）
 * ==================================================================
 *
 * 逻辑数值用**小整数**：生命上限 100、伤害 10 级别。
 * 但内部实现按 **10 倍刻度**存储（HP 1000、10 伤害存成 100）。
 *
 * 为什么要这个转换：整数化是硬约束（架构规范 §12），
 * 而"每 0.1 秒恢复 1 点缠"在 0.1 秒粒度上要除以 6 个物理 tick ——
 * 直接用 1 点会导致每 tick 0.167 点，被整数化吃掉。
 * 乘 10 之后每 tick 稳定得到整数，且**玩家看到的数字仍然是 100/10 这种小整数**。
 *
 * 换算规则：一切对外数值 × `DISPLAY_SCALE`。
 *
 * 资源模型：
 *   炁（`energy`）—— 每 0.1 秒自动恢复 1 点（= 每秒 10 点）
 *   缠（`douqi`） —— **按伤害换算**：造成 1 点伤害得 1 点，受到 1 点也得 1 点
 *
 * 时间刻度：10 个逻辑步 = 1 秒（0.1 秒/步）；读条时间用毫秒声明。
 */

import type { BuffDef, SkillDef } from '../core/types';
import { LUST_BUFFS, LUST_SKILLS } from './lustBoss';
import { JEALOUSY_BUFFS, JEALOUSY_SKILLS } from './jealousyBoss';
import { COMBO_WINDOW, STRIKE } from './kits/combo';
/**
 * ⚠️ 蓄势（「避实击虚」的 buff）来自它**自己的文件** —— 它是
 * `kits/linwanfeng` / `kits/combo` / `data/qiji` 三方共用的叶子，
 * 放哪一边都会造出方向不对的 import（推导在 `kits/dodgeCharge.ts` 的文件头）。
 */
import { DODGE_CHARGE } from './kits/dodgeCharge';
import {
  FLASH_IFRAME,
  KAILI_SKILLS,
  SUNDER_DEBUFF,
} from './kits/kaili';
import {
  DODGE_IFRAME,
  GUARD_THRESHOLD_BUFF,
  LIN_WANFENG_SKILLS,
} from './kits/linwanfeng';
import { PENDING_SKILLS } from './kits/reserved';
import { FOCUS_BUFF } from './kits/shared';
export {
  /**
   * **待接线**的那个（「破」，黛玄的）—— 它为什么还在内容里、为什么
   * **不在** `PLAYER_SKILLS` 里，见 `kits/reserved.ts` 的文件头。
   * 一句话：定义保留（用户说黛玄会用它），但今天没有角色带它。
   */
  BREAK,
  PENDING_SKILLS,
} from './kits/reserved';
export {
  /**
   * 共用件（两个角色都有）—— 从 `kits/shared.ts` 转发，
   * 让只关心"某个技能/ buff 的定义"的调用方不必知道它在哪个 kit 里。
   */
  FOCUS,
  FOCUS_BUFF,
} from './kits/shared';
export {
  /** 林晚风 */
  ATTACK,
  DODGE,
  DODGE_IFRAME,
  GUARD,
  GUARD_THRESHOLD_BUFF,
  PI,
} from './kits/linwanfeng';
export {
  /** 凯丽 */
  BLAST,
  FLASH,
  FLASH_IFRAME,
  PUNCH,
  SUNDER_DEBUFF,
} from './kits/kaili';
export {
  /**
   * 派生系：`COMBO_WINDOW` 与 `STRIKE` 目前**没有产出者**（P3 由炁机接回），
   * 见 `kits/combo.ts` 的文件头。`JIE` 归凯丽。
   */
  COMBO_WINDOW,
  JIE,
  STRIKE,
} from './kits/combo';
export {
  /**
   * 「避实击虚」的蓄势（下一次攻击伤害翻倍、用掉就消耗）。
   *
   * ⚠️ 它**只**由那条炁机的 `skillTweak.onUse`（`grant`）授予 ——
   * 基础技能表里没有任何东西挂它，但每个攻击技能都会**尝试消耗**它
   * （`removeBuff`，见 `kits/dodgeCharge.ts` 的文件头）。
   */
  DODGE_CHARGE,
} from './kits/dodgeCharge';

export { C, S } from './scale';
import { BOSS_ENRAGE, BOSS_TELEGRAPH, KNOCKDOWN } from './bossShared';
/**
 * ⚠️ 只 import **本文件自己要用**的两个汇总（`ALL_SKILLS` / `ALL_BUFFS`）；
 * 逐个技能的转发走下面的 `export { ... } from`。
 *
 * 两件事分开写是因为 `import { X }` + `export { X } from` 会让 `X`
 * 变成"import 了但没用到"（`export ... from` 是从源模块重新导出，
 * 不经过本地绑定），`noUnusedLocals` 会报错。
 */
import { PRIDE_BUFFS, PRIDE_SKILLS } from './bossPride';

/**
 * Boss 的内容从各自的内容文件**转发**，外部 import 路径不变。
 *
 * ⚠️ 分工（与 `bossSkills.ts` 时代不同）：
 *   `bossShared.ts` 两个 Boss 共用的三样（前摇标记 / 狂暴 / 倒地）
 *   `bossPride.ts`  「傲慢」的技能 + buff + 轮转
 *   `lustBoss.ts`   「色欲」的技能 + buff + 轮转
 *
 * 旧的 `BOSS_CLEAVE` / `BOSS_SWEEP` / `BOSS_EMPOWER` / `BOSS_ARMOR` /
 * `BOSS_ARMOR_SKILL` 已随「霸体合并」删除（设计 §6.3）—— 它们不是因为
 * 改名而消失，而是**技能本身没了**：霸体现在是「碾压」自带的属性，
 * 「蓄能」整个删掉（占出招格却不打人）。
 */
export {
  KNOCKDOWN,
  BOSS_ENRAGE,
  BOSS_TELEGRAPH,
} from './bossShared';
export {
  BOSS_HEAVY,
  BOSS_HEAVY_ARMOR,
  BOSS_MEND,
  BOSS_REBUKE,
  BOSS_SCORN,
  PRIDE_BUFFS,
  PRIDE_SKILLS,
} from './bossPride';
export {
  JEALOUSY_BUFFS,
  JEALOUSY_FLAME,
  JEALOUSY_MARK,
  JEALOUSY_REAP,
  JEALOUSY_REND,
  JEALOUSY_SKILLS,
  JEALOUSY_SNATCH,
} from './jealousyBoss';

/** 生命上限（展示值）。 */
export const HP_MAX = 100;
/** 缠上限（展示值）。 */
export const ENERGY_MAX = 100;
/** 炁上限（展示值）。 */
export const DOUQI_MAX = 100;


/* ================================================================== *
 * Boss 技能
 * ================================================================== *
 *
 * 设计约束（来自需求）：**Boss 的所有招式都默认可以被打断 / 闪避 / 卸力**。
 * 所以每个招式都是 `interruptible: true`，且伤害都走正常判定路径。
 */

/* ================================================================== *
 * 导出
 * ================================================================== */

/**
 * **玩家技能的全集** = 两个角色技能表的并集（+ 派生技「击」）。
 *
 * ==================================================================
 * ⚠️ 它是"内容全集"，不是"这一局带什么"
 * ==================================================================
 *
 * 两个消费者都是**全局**的，这正是它该是并集的原因：
 *   1. 内容注册表（`app/deps.ts`）—— 引擎按 id 解析技能定义，
 *      两个角色的定义都必须注册得到，否则换角色会"技能不存在"
 *   2. 设置页的按键列表（`app/keyRows.ts`）—— 那张表是**整场游戏**的
 *      可绑技能集合，不是"当前角色"的
 *
 * 而**战斗里装哪 5 个**由 `data/units.ts` 的 `skillsForPlayer(id)` 决定
 * （按备战界面选中的角色）。两者不是一回事，不要合并 ——
 * 合并会让"凯丽选不了别的角色的键"变成一个内容层的错误。
 *
 * ⚠️ 反过来也成立：这里**别**去 filter 当前角色。本模块是数据，
 * 不知道"当前局面"（那是 app 层的事，见架构规范 C1）。
 */
export const PLAYER_SKILLS: readonly SkillDef[] = [
  ...LIN_WANFENG_SKILLS,
  ...dedupeSkills(KAILI_SKILLS),
  /**
   * ⚠️ 「击」在这里（技能全集），但**不在任何角色的技能表里** ——
   * 它是派生技，靠 `combo-window` 出现。放在合集里是为了让
   * `registry.skill('strike')` 能解析到它（引擎与 UI 都按 id 查定义）。
   *
   * ⚠️ 它今天**没有产出者**（P3 由炁机接回），见 `kits/combo.ts` 的文件头。
   */
  STRIKE,
];

/**
 * 去掉**已经被前一个 kit 收进去**的技能（按 id 判）。
 *
 * ==================================================================
 * 为什么必须去重（这不是洁癖，是硬要求）
 * ==================================================================
 *
 * 「凝」(`focus`) 是**两个角色共用**的技能（同一个定义对象，见
 * `kits/shared.ts`），所以两个 kit 的技能表里都有它。而 `ALL_SKILLS`
 * 会把它送进内容校验器 —— 校验器的 `DUP_ID` 会直接让**启动失败**
 * （`invalid content: duplicate skill id "focus"`）。
 *
 * 三种做法里只有一种对：
 *   - 让两个 kit 各持一份「凝」→ 两个同 id 的 SkillDef，校验器照样报，
 *     而且它们会开始漂（改一个忘一个）
 *   - 在这里按 id 去重 → **共用的事实被显式写出来**，只有一处
 *   - 把「凝」从某一个 kit 里拿掉 → 那个角色的技能表就不是 5 个了
 *
 * ⚠️ 判据是 **id**（不是对象身份）：将来如果有两个 kit 各自定义了
 * 同 id 但内容不同的技能，这里也会挡住 —— 那正是该被发现的情况。
 */
function dedupeSkills(skills: readonly SkillDef[]): readonly SkillDef[] {
  const seen = new Set(LIN_WANFENG_SKILLS.map((s) => s.id));
  return skills.filter((s) => !seen.has(s.id));
}

/**
 * **玩家技能 id 集合** —— "这个技能是不是玩家的"的**唯一真相**。
 *
 * ==================================================================
 * ⚠️ 为什么需要它（踩过的坑）
 * ==================================================================
 *
 * 判断"是不是 Boss 技能"曾经靠在 **id 前缀**上猜（`startsWith('boss-')`）。
 * 那在「色欲」加入后就静默失效了 —— 它的技能 id 是
 * `lust-hum` / `lust-entangle` / `lust-charm`，**全都不以 `boss-` 开头**，
 * 于是漏过检查。症状：**Boss 的技能出现在设置页的按键列表里**，
 * 玩家可以给 Boss 的招绑键。
 *
 * 同一个前缀约定还被另外两处依赖（`derivedSlots.ts` 的派生槽、
 * `viewModel.test.ts` 的读条时长护栏），它们**同时**对色欲失效。
 *
 * ⚠️ **所以不要再用 id 前缀判断技能归属。** 7 宗罪各有一套前缀，
 * 前缀约定每加一个 Boss 就要记得维护一次，而漏掉时**不会报错**。
 *
 * `ALL_SKILLS` 是由 `PLAYER_SKILLS` + `PENDING_SKILLS` + 各 Boss 的技能表
 * 拼出来的，所以"在不在这个集合里"是**结构性的** —— 新加 Boss 时自动生效，
 * 不需要任何人记得改哪里。
 *
 * ⚠️ 反过来说：**不在这个集合里 ≠ 是 Boss 技能**。今天还有第三个桶
 * （`PENDING_SKILLS`：「破」）。想"只要 Boss 技能"请用 `BOSS_SKILL_IDS`，
 * 不要用 `!PLAYER_SKILL_IDS`（那会把待接线技能一起算进去）。
 */
export const PLAYER_SKILL_IDS: ReadonlySet<string> = new Set(
  PLAYER_SKILLS.map((s) => s.id),
);

/**
 * **Boss 技能 id 集合** —— 与 `PLAYER_SKILL_IDS` 同一条理由（结构，不是前缀）。
 *
 * ==================================================================
 * 为什么要有它（`!PLAYER_SKILL_IDS` 不再等价于"Boss 技能"）
 * ==================================================================
 *
 * 在 `PENDING_SKILLS` 出现之前，"不是玩家技能"就等于"Boss 技能"，所以
 * `app/deps.ts` 的装配用 `!PLAYER_SKILL_IDS.has(s.id)` 取 Boss 招是**对的**。
 * 加入待接线的「破」之后那个反集就不再成立 —— 它会把「破」注册进
 * **每一局的引擎**（症状很轻：界面按不出来，但"引擎认识它"本身是
 * 一个不该存在的事实）。所以那一处改成读本集合。
 */
export const BOSS_SKILL_IDS: ReadonlySet<string> = new Set(
  [...PRIDE_SKILLS, ...LUST_SKILLS, ...JEALOUSY_SKILLS].map((s) => s.id),
);

/**
 * **派生技的 id 集合** —— 它们属于玩家技能全集，但**不属于任何角色的技能表**。
 *
 * ==================================================================
 * 为什么需要它（装配时要能把它和"角色技能"分开）
 * ==================================================================
 *
 * `app/deps.ts` 建"这一局引擎认识的技能表"时要拼三样：
 *   这个角色的技能 + **派生技** + Boss 技能
 *
 * 派生技是第三类：它在 `PLAYER_SKILL_IDS` 里（所以不是 Boss 技能，
 * 设置页/派生的判据都算它），但它不在 `PLAYER_KITS` 的任何一套里
 * （它不是"初始技能"，是打出来的）。没有这个集合的话，装配只能靠
 * `id === 'strike'` 这种字面量 —— 那正是本仓库反复踩过的"靠约定猜归属"。
 */
export const DERIVED_SKILL_IDS: ReadonlySet<string> = new Set(['strike']);

/**
 * 全部技能。
 *
 * ⚠️ **两个 Boss 的技能都在这里**，各自由自己的 `Behavior` 轮转决定实际
 * 放哪些（见 `LUST_BEHAVIORS` vs `PRIDE_BEHAVIORS`）。所以"注册"不等于
 * "会用"—— 这也是为什么加 Boss 只需要加它的轮转。
 *
 * ⚠️ **待接线技能（`PENDING_SKILLS`：「破」）也在这里** —— 定义必须留在
 * 注册表里（引擎按 id 解析），但它**不属于 `PLAYER_SKILLS`**，所以
 * 不进设置页、不可绑键、不属于任何角色。这条三分法见
 * `kits/reserved.ts` 的文件头。
 *
 * ⚠️ `ALL_SKILLS` 里混着 Boss 技能与待接线技能，所以想"只要玩家技能"时
 * 不要按 id 前缀过滤、也不要用反集，用 `PLAYER_SKILL_IDS` / `BOSS_SKILL_IDS`
 * （见那里的说明）。
 */
export const ALL_SKILLS: readonly SkillDef[] = [
  ...PLAYER_SKILLS,
  ...PENDING_SKILLS.map((p) => p.skill),
  ...PRIDE_SKILLS,
  ...LUST_SKILLS,
  ...JEALOUSY_SKILLS,
];

/** 玩家技能里"某个角色带哪一套"的**定义**（不含「击」那种派生技）。 */
export const PLAYER_KITS: Readonly<Record<string, readonly SkillDef[]>> = {
  /** ⚠️ key 是**历史遗留**的 `'player'`（roster 里的 id），不是角色名。 */
  player: [...LIN_WANFENG_SKILLS],
  kaili: [...KAILI_SKILLS],
};

/**
 * 某个角色战斗时装的技能（**装配用的唯一入口**）。
 *
 * ⚠️ 未知 id 返回**空数组**而不是抛错：本函数会被 app 层的"选中的角色"
 * 调到，而那个 id 可能来自旧存档（角色被删/改名）。抛错会让游戏直接崩，
 * 空数组则是"这个人没有技能" —— 由 `roster.resolvePlayerId` 负责把它
 * 落回默认角色（那是**它**的职责，不是本函数的）。
 */
export function skillsForPlayer(playerId: string): readonly SkillDef[] {
  return PLAYER_KITS[playerId] ?? [];
}

/**
 * 某个角色的**技能 id 集合** —— 装配时过滤键位表用。
 *
 * ⚠️ 与 `PLAYER_SKILL_IDS`（全局并集）是两件事：
 *   全局并集 → "设置页能绑哪些"
 *   本函数   → "这个角色这一局按得出来哪些"
 * 不区分的话，凯丽会带着一个她**没有**的「防」的槽位与触屏按钮。
 */
export function playerSkillIdsFor(playerId: string): ReadonlySet<string> {
  return new Set(skillsForPlayer(playerId).map((s) => s.id));
}

/**
 * 全部 buff。
 *
 * ⚠️ 玩家侧的 buff 来自两个 kit —— 这里逐个列出（而不是
 * `...LIN_WANFENG_BUFFS` 那种"每 kit 一个数组"）是因为它们本来就不多，
 * 而且**逐条列出时"这个 buff 注册了没有"是看得见的**。
 * 漏注册的后果是"引擎认识这个 buff，但校验器 / `registry.buffs` 看不到"。
 */
export const ALL_BUFFS: readonly BuffDef[] = [
  DODGE_IFRAME,
  FLASH_IFRAME,
  GUARD_THRESHOLD_BUFF,
  FOCUS_BUFF,
  SUNDER_DEBUFF,
  BOSS_TELEGRAPH,
  BOSS_ENRAGE,
  ...PRIDE_BUFFS,
  ...LUST_BUFFS,
  ...JEALOUSY_BUFFS,
  /**
   * 「倒地」（Boss 的「碾压」给玩家的）。
   *
   * ⚠️ 必须注册进 `ALL_BUFFS` —— 内容校验器与 `registry.buffs` 都读它，
   * 漏了会导致"引擎认识这个 buff，但 hittest/校验看不到"。
   *
   * ⚠️ 它**不在** `PRIDE_BUFFS` 里：两个 Boss 都会用到它（设计 §6.4 的
   * "共享"边界），所以它由 `bossShared.ts` 定义、在这里单独列出。
   */
  KNOCKDOWN,
  /**
   * 蓄势（「避实击虚」的 buff）。
   *
   * ⚠️ **必须注册**：攻击技能的 `hits[].effects` 里写了
   * `removeBuff: 'dodge-charge'`，而校验器对 hit 效果里的 buff 引用查表
   * （`MISSING_BUFF`，见 `core/content/validate.ts`）—— 漏注册 = **启动
   * 即失败**（这是好事：它比"引擎认识、校验器看不见"响亮）。
   */
  DODGE_CHARGE,
  /**
   * 派生窗口。
   *
   * ⚠️ **今天没有产出者**（「截」的那一条被用户要求删掉了，P3 由炁机接回）
   * —— 保留它的判据在 `kits/combo.ts` 的文件头与
   * `docs/specs/2026-10-12-player-kits.md`。
   */
  COMBO_WINDOW,
];
