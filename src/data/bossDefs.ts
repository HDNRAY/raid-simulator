/**
 * **Boss 的定义表** —— 每个 Boss 的"一套东西"在哪。
 *
 * ==================================================================
 * 为什么要有这一层（2026-10-14）
 * ==================================================================
 *
 * 在此之前，Boss 的各个部件**散在四个地方**：
 *
 * | 部件 | 原先住在 |
 * |---|---|
 * | 血量上限 | `data/entities/bossHp.ts` 的**一个全局常量**（`BOSS_HP_DISPLAY`） |
 * | 技能 / buff / 行为 | 各自的 `data/bossPride.ts` / `data/lustBoss.ts` / … |
 * | 名字 | `data/roster.ts` |
 *
 * 而**血量那张是错位的形状**：7 个 Boss 共用同一个上限 ⇒ 「懒惰」要的
 * "高血量"**没有地方写**（那就是缺口 W6）。所以改成"每个 Boss 一个定义"：
 * `hp` / `nameKey` / `skills` / `buffs` / `behaviors` 全部落在
 * 它自己的文件里（`data/prideBoss.ts` / `data/lustBoss.ts` / …）。
 *
 * ⚠️ **这一层不是"路由表"**：它不重新声明任何数据，只把每个 Boss
 * 文件里已经导出的那几个数组**聚在一个查得到的名字下**。判据是
 * AGENTS.md §2 的"重复：同一件事有第二份表达 → 删第二份"：
 *   - 若哪天有人在这里**抄**一份技能列表，那才是重复
 *   - 这里只允许出现 `import { X_SKILLS } from './x'` 这种转发
 *
 * ⚠️ **未实现的 Boss 不在表里**（`gluttony` / `wrath` / `sloth` / `greed`）：
 * 它们还没有定义，`bossDefOf` 返回 `undefined`，调用方回落到
 * "借傲慢的轮转"那条占位路（见 `data/units.ts` 的 `behaviorsFor`）。
 */

import type { Behavior, BuffDef, LocaleKey, PassiveSkillDef, SkillDef } from '../core/types';
import { PRIDE_BOSS } from './prideBoss';
import { LUST_BOSS } from './lustBoss';
import { JEALOUSY_BOSS } from './jealousyBoss';
import { GREED_BOSS } from './greedBoss';
import { LAZY_BOSS } from './lazyBoss';
import { GLUTTONY_BOSS } from './gluttonyBoss';

/**
 * 一个 Boss 的**全部内容**。
 *
 * ⚠️ `hp` 的单位是**展示刻度**（`DISPLAY_SCALE = 1`，所以与内部值相同）；
 * 它进 `Combatant.caps.hp`，也就是引擎夹血用的那个值
 * （`changeResource` 读 `caps`）—— **不是** `maxHp` 属性的基底
 * （那条路见 W6 的说明）。
 */
export interface BossDef {
  readonly id: string;
  /** 血量上限（展示刻度）。 */
  readonly hp: number;
  /**
   * **开局血量**（缺省 = 满血）。
   *
   * ⚠️ 存在的理由只有一个：「懒惰」要求"上限 500、但**开局只有 250**"
   * —— 也就是它**一上来就是半血**（那正好喂饱它自己的"按损失血量加成"
   * 那一条）。别拿它当"随机起始血量"用：它是**内容声明的一个数**，
   * 不是运行期掷出来的。
   */
  readonly startHp?: number;
  readonly nameKey: LocaleKey;
  readonly skills: readonly SkillDef[];
  /**
   * **整场都在的常驻被动**（开战前就挂在它身上）。
   *
   * ==================================================================
   * ⚠️ 这个字段的来历：一个**真的 bug**（2026-10-14 发现并修掉）
   * ==================================================================
   *
   * 在此之前，被动只写在 `buffs` 里 —— 而 `buffs` 是"**这个 Boss 的技能
   * 会用到的全部 buff**"（含前摇标记、一次性标记），引擎**从不去挂它们**。
   * 于是：
   *
   *   - `innateBuffsFor` 只对**色欲**一个人特判挂了 `LUST_PASSIVE`
   *   - **其余五个 Boss 的被动全部是死的** ✗
   *
   * 实测症状（当时）：一整场跟「懒惰」打完，玩家**从没被睡到过**
   * （`被睡 tick 数 = 0`）—— 它的核心机制整个没跑。
   *
   * ⚠️ 为什么单测没抓住：那些 Boss 的单测都是**手工挂 buff** 再验行为
   * （`withBuff({}, [LAZY_IDLE_PASSIVE])`），于是"到底有没有人挂它"
   * 从来不在判据里。与「暴食的血盾」那一次是同一个形状
   * （`tests/unit/bossFights.test.ts` 的文件头记着）。
   *
   * ⇒ 现在：**被动有它自己的字段**，"整场都在"这件事不再靠猜
   * （判据是"它有没有被技能授予"，猜不得）。
   */
  readonly passives: readonly PassiveSkillDef[];
  /**
   * 这个 Boss **自己**的 buff。
   *
   * ⚠️ **不含**共享的三样（前摇标记 / 狂暴 / 倒地）—— 那三样由
   * `bossShared.BOSS_SHARED_BUFFS` 注册一次；若这里再带一份，内容校验器
   * 会报 `DUP_ID`（它们是完全相同的对象，**不是**"两个不同的 buff"）。
   */
  readonly buffs: readonly BuffDef[];
  readonly behaviors: readonly Behavior[];
}

/** 有自己定义的 Boss。**开发中的不在里面**（见文件头）。 */
export const BOSS_DEFS: readonly BossDef[] = [
  PRIDE_BOSS,
  LUST_BOSS,
  JEALOUSY_BOSS,
  GREED_BOSS,
  LAZY_BOSS,
  GLUTTONY_BOSS,
];

const BY_ID = new Map(BOSS_DEFS.map((b) => [b.id, b]));

/** 某个 Boss 的定义；没有（= 还没做）返回 `undefined`。 */
export function bossDefOf(id: string): BossDef | undefined {
  return BY_ID.get(id);
}

/** 同上，但**找不到就抛**（用于"这个 id 一定存在"的路径，例如 `makeBoss`）。 */
export function bossDefById(id: string): BossDef {
  const def = BY_ID.get(id);
  if (def === undefined) throw new Error(`unknown boss id: ${id}`);
  return def;
}

/**
 * 某个 Boss 的血量上限。
 *
 * ⚠️ 没有定义时**回落到傲慢的值**：那是"开发中的 Boss 借傲慢的轮转"
 * 那条占位路的同一个口径 —— 它们**进不了正常战斗**（备战界面灰掉），
 * 所以这个回落只防"从存档 / 调试路径摸进来"时崩掉，不是设计值。
 */
export function bossHpFor(id: string): number {
  return BY_ID.get(id)?.hp ?? PRIDE_BOSS.hp;
}

/**
 * 某个 Boss 的**开局血量**（缺省 = 它的上限）。
 *
 * ⚠️ 没有定义时按**上限**算（开发中的 Boss 借傲慢那条占位路）。
 */
export function bossStartHpFor(id: string): number {
  const def = BY_ID.get(id);
  if (def === undefined) return PRIDE_BOSS.hp;
  return def.startHp ?? def.hp;
}

/** 需要落进内容注册表的全部 Boss 技能 / buff（三个 Boss 的合集）。 */
export const BOSS_SKILLS: readonly SkillDef[] = BOSS_DEFS.flatMap((b) => [...b.skills]);

/**
 * ⚠️ **只收 `buffs`**：`passives` 是**被动技能**（`PassiveSkillDef`），
 * 它们**不进 buff 表** —— 它们**授予**的那些 buff 各自写在 `buffs` 里
 * （`grant` 的 `buff` 引用和 `buffs` 里那份是同一个对象）。
 */
export const BOSS_BUFFS: readonly BuffDef[] = BOSS_DEFS.flatMap((b) => [...b.buffs]);
