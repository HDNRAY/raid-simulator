/**
 * **备战屏详情区的数据装配**：把内容表 / 单位表接到 `ui/prepareDetail` 上。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是 `ui/prepareDetail.ts`（纯模型）与 `data/` + `app/keyRows`（真实
 * 内容）之间的**一层翻译**：那边只声明"我需要这些取值函数"，这里把每个
 * 取值函数接到某个具体的表上。
 *
 * ⚠️ 为什么要有这一层（而不是让 `ui/prepareDetail.ts` 自己 import）：
 * 那个文件要能在 node 里用几个字面量测（与 `prepareLogic` /
 * `prepareRender` 同一条纪律）。**接口形状由消费者声明，实现方满足它**。
 *
 * ==================================================================
 * ⚠️ Boss 的详情今天能取到什么（不许编内容）
 * ==================================================================
 *
 * 全部来自**已有数据**，一处都没有新写：
 *
 * | 显示 | 来源 |
 * |---|---|
 * | 名字 | `data/roster.BOSS_ROSTER[].nameKey` |
 * | 生命上限 | `bossHpFor(id)` —— **那个 Boss 自己的定义**（`data/bossDefs.ts`） |
 * | 招式列表 | `data/units.behaviorsFor(id)` 的行为数组里出现的 `skillId` |
 * | 招式名 | `SkillDef.nameKey` |
 * | 招式说明 | `SkillDef.descKey` + `app/descParams.descParamsOf()` |
 *
 * ⚠️ **没有的东西**：Boss 的"称号 / 简介"在仓库里**不存在** ——
 * `RosterEntry` 的形状被单测钉死为 `{ id, nameKey }` 两个键
 * （`tests/unit/prepareLogic.test.ts` 有一条断言），所以这里**不假装有**
 * 一段简介可显示。
 *
 * ⚠️ **开发中的 Boss 不列招式**：`behaviorsFor` 对它们返回的是
 * **傲慢的行为表**（`data/units.ts` 的兜底）—— 照实列会显示成
 * "嫉妒也会碾压"，那是**假信息**。所以这里对 `developing` 的 Boss 直接
 * 返回空数组。判据在 `ui/prepareDetail.ts` 里也会再挡一层（两边都不越界）。
 */

import { ALL_SKILLS } from '../data/content';
import { bossDefById } from '../data/bossDefs';
import { BOSS_ROSTER, PLAYER_ROSTER, findEntry, isDeveloping } from '../data/roster';
import { bossHpFor } from '../data/bossDefs';
import { playerHpFor, playerSkillsFor } from '../data/units';
import { qijiById } from '../data/qiji';
import { descParamsOf } from './descParams';
import { descTemplateOf } from './keyRows';
import type { DetailContext, DetailQiji, DetailSkillRow, DetailUnit } from '../ui/prepareDetail';
import type { QijiEntity } from '../core/types/qiji';
import type { SkillDef } from '../core/types';

/** 一个技能 → 详情区要的那一行（名字 + 说明 + 模板参数）。 */
function skillRow(skill: SkillDef, /** 那个技能**属于谁**的血上限（`{percent}` 的分母）。 */ maxHp: number): DetailSkillRow {
  const descKey = skill.descKey;
  const template = descKey === undefined ? undefined : descTemplateOf(descKey);
  /**
   * ⚠️ 参数**必须**按模板推导（`descParamsOf`）：Boss 的说明里有
   * `{cast}` / `{damage}` / `{cooldown}`，漏了就会把占位符原样显示。
   *
   * ⚠️ 取不到参数时给**空对象**（而不是省略字段）：省略会让 `translate`
   * 走"不带参数"的那条快路，占位符照样原样出现 —— 两种坏结果一样，
   * 但空对象让"这一行总是有参数"这个类型前提成立。
   *
   * ⚠️ `maxHp` 传**这个 Boss 自己的**上限：`{percent}` 只在**回血类**技能上出现
   * （傲慢的「回补」），而那个比例的分母就是 Boss 的血上限
   * （`descParamsOf` 的文档写了这条）。玩家技能里没有 `{percent}`，
   * 所以这个值对它们无副作用。
   */
  const params =
    /**
     * ⚠️ `descParamsOf` 只收主动技能（前摇 / 冷却 / 命中段是它取数的来源）——
     * 所以这里按 `kind` 收窄。被动技能仍然给出名字与说明，只是没有数值参数
     * （它的效果写在 `abilities` 里，没有"前摇 / 伤害"可推）。
     */
    template === undefined || skill.kind !== 'activeSkill'
      ? {}
      : (descParamsOf(skill, template, maxHp) ?? {});
  return {
    kind: 'skill',
    /**
     * ⚠️ `SkillDef.nameKey` 的类型是 `LocaleKey` = `string`，所以这里给不出
     * 更强的保证；`?? skill.id` 只是"内容漏了 key 时别显示 undefined"的
     * 兜底（内容校验器管这件事，本文件不该假装管得了它）。
     */
    nameKey: skill.nameKey ?? skill.id,
    ...(descKey === undefined ? {} : { descKey }),
    descParams: params,
  };
}

/** 按 id 找一个技能定义（`ALL_SKILLS` 是**唯一**的技能全集）。 */
function skillById(id: string): SkillDef | undefined {
  return ALL_SKILLS.find((s) => s.id === id);
}

/**
 * 一个 Boss **实际会放的招式**（按行为数组里出现的顺序，去重）。
 *
 * ⚠️ 为什么从 `behaviorsFor` 取而不是"所有 Boss 技能"：`BOSS_SKILL_IDS`
 * 是**两个 Boss 的并集** —— 直接列出来，傲慢的详情里会出现色欲的
 * 「魅惑」。行为数组才是"这个 Boss 会放哪几招"的真相。
 *
 * ⚠️ 只认 `rotation` / `weightedRotation` 两种行为（`opener` 里的技能
 * 也在轮转里，所以不会漏）。没有轮转的 Boss（今天不存在）就返回空。
 *
 * ⚠️ 末尾再按 `BOSS_SKILL_IDS` 过滤一次：行为表里若写了**别的角色**的
 * 技能（内容错误），详情区不该把它当成 Boss 的招式显示出来。
 */
function bossSkillIds(id: string): readonly string[] {
  /**
   * ⚠️ **2026-10-14 改**：从"**从行为数组里推**"改成"**直接用
   * `BossDef.skills`**"。
   *
   * ==================================================================
   * 为什么改（这条改动的起因是一个**真的漏**）
   * ==================================================================
   *
   * 旧实现只读 `rotation` / `weightedRotation` 的步骤 —— 于是**凡是不在
   * 轮转里的招式，详情面板上就根本不会列出来**，而玩家会以为"它只有这几招"。
   * 实测漏掉的是「嫉妒」的「**妒火**」：它由 `{ kind: 'onCooldown' }`
   * 驱动（"冷却一好就放"），从来不在 `rotation` 的步骤里 ✗
   *
   * 这种漏**不会让任何东西报错** —— 只有人去看面板才发现。
   * 现在有 `test/unit/bossDetailCoverage.test.ts` 钉住"一条都不能漏"。
   *
   * ⚠️ 顺序用 `BossDef.skills` 的**声明顺序**（内容作者排的，比"行为出现顺序"
   * 稳定：轮转里同一招可能出现多次、也可能换个顺序）。
   * ⚠️ 不再需要 `BOSS_SKILL_IDS` / `PENDING_SKILLS` 那层过滤：这两个东西
   * 都是为了"从并集里挑出这个 Boss 的"而存在的，而 `BossDef.skills`
   * **本来就是每个 Boss 自己那一份**。
   */
  return bossDefById(id).skills.map((skill) => skill.id);
}

function playerUnit(id: string): DetailUnit | undefined {
  const entry = findEntry(PLAYER_ROSTER, id);
  return entry === undefined ? undefined : { id: entry.id, nameKey: entry.nameKey };
}

function bossUnit(id: string): DetailUnit | undefined {
  const entry = findEntry(BOSS_ROSTER, id);
  return entry === undefined ? undefined : { id: entry.id, nameKey: entry.nameKey };
}

function qijiShape(id: string): DetailQiji | undefined {
  const qiji: QijiEntity | undefined = qijiById(id);
  if (qiji === undefined) return undefined;
  return {
    id: qiji.id,
    /** ⚠️ 与 `skillRow` 同一条兜底：`LocaleKey` 就是 `string`，内容漏了 key 时别显示 `undefined`。 */
    nameKey: qiji.nameKey ?? qiji.id,
    ...(qiji.descKey === undefined ? {} : { descKey: qiji.descKey }),
  };
}

/**
 * 造这一屏详情区的取值上下文。
 *
 * @param free 取"某条炁机此刻开着没有"。
 *   ⚠️ 状态**必须**从这里现取（不在这里读一次存起来）：它是可变状态，
 *   而详情区每帧都要重画。
 */
export function prepareDetailContext(free: {
  readonly on: (id: string) => boolean;
}): DetailContext {
  return {
    playerById: playerUnit,
    bossById: bossUnit,
    qijiById: qijiShape,
    playerHp: playerHpFor,
    bossHp: bossHpFor,
    playerSkills: (id) => playerSkillsFor(id).map((s) => skillRow(s, playerHpFor(id))),
    /**
     * ⚠️ **开发中的 Boss 返回空数组**（见文件头）：`behaviorsFor` 对它们
     * 返回的是傲慢的表，照实列就是假信息。
     */
    bossSkills: (id) =>
      isDeveloping(id)
        ? []
        : bossSkillIds(id).flatMap((sid) => {
            const skill = skillById(sid);
            return skill === undefined ? [] : [skillRow(skill, bossHpFor(id))];
          }),
    /**
     * **常驻被动**：直接取 `BossDef.passives` —— 那是"引擎真的会挂"的那份
     * 清单（理由见 `DetailContext.bossPassives`）。
     *
     * ⚠️ 开发中的 Boss 仍然返回空（与 `bossSkills` 同一条判据）：它们的
     * `passives` 是空数组，所以这里不需要再判一次 `isDeveloping`。
     */
    bossPassives: (id) =>
      /**
       * ⚠️ **2026-10-14 修**：这里原先手写一行 `{ nameKey, descParams: {} }`，
       * 注释还写着"`BuffDef` 没有 `descKey`（只有 `nameKey`），被动那几行的
       * 说明暂时留空" —— **那句话已经过时了**：
       *
       *   - `BossDef.passives` 现在是 **`PassiveSkillDef[]`**（2026-10-14 的
       *     判别联合重构），而 `PassiveSkillDef` **有 `descKey`**
       *   - 五条被动的文案（印记 / 弱点 / 饕餮 / 怠惰 / 怒火）**都在 i18n 里**
       *
       * 所以玩家看到的"被动**没有任何说明**"（用户报的）纯粹是**没去取**。
       * ⇒ 直接复用 `skillRow()`：它对被动技能本来就有一条正确的分支
       * （`kind !== 'activeSkill'` ⇒ 参数取空对象，但**名字与说明照给**）。
       */
      bossDefById(id).passives.map((passive) => skillRow(passive, bossHpFor(id))),
    developing: isDeveloping,
    qijiOn: (id) => free.on(id),
  };
}
