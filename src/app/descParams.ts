/**
 * **说明文案里的数值参数** —— 从内容定义推导，一处实现。
 *
 * ==================================================================
 * 它解决的是"同一个数字有两份表达"
 * ==================================================================
 *
 * 已经犯过两次：
 *
 *   1. `skill.dodge.desc` 把秒数写死（当时是"0.5 秒"），而它真正的家是
 *      `DODGE_IFRAME.duration` —— 改「闪」0.1 → 0.2 那次差点漏掉文案
 *   2. `boss.*.desc` / `lust.*.desc` 写着前摇 / 伤害 / 冷却 / 眩晕时长，
 *      那些数各自住在 `SkillDef` 里（`castTime` / `hits[].effects[].damage.base`
 *      / `cooldown` / `LUST_STUN.duration`）—— 内容一改文案就漂
 *
 * 修法**不是**"每个说明写一个推导函数"，而是**一张参数表**：
 *
 *   i18n 模板里写占位符（`{seconds}` / `{damage}` / `{cast}` / …）
 *   → `descParamsOf()` 按模板里**真实出现**的占位符去 `SkillDef` 取值
 *   → 渲染时 `t(descKey, params)`
 *
 * 于是"要显示什么"由**模板**说，"这个数是多少"由**内容**说，中间没有
 * 第三处手抄。
 *
 * ==================================================================
 * ⚠️ 判据：这个数能不能回到内容定义？
 * ==================================================================
 *
 * | 数 | 处理 |
 * |---|---|
 * | 前摇 / 伤害 / 冷却 / 眩晕时长 / 增伤% / 回血量 | **推导**（能回到 `SkillDef`）|
 * | "但窗口极窄"（手感）· "(漢堂國際 1995)"（出处）· 键名 | **留**（回不去）|
 *
 * 判据与文案分界见 `AGENTS.md` §2 与 `src/i18n/locales/zh-CN.ts` 各条注释。
 */

import type { ActiveSkillDef, BuffDef, SkillDef } from '../core/types';
import { displaySeconds } from './displayTime';

/**
 * 模板里出现的占位符名。
 *
 * ⚠️ 导出是为了**对账**：`tests/unit/keyRows.test.ts` 用它断言
 * "模板写了 `{seconds}` 就一定要有对应的参数"—— 名单从模板反查，
 * 不在测试里写死（写死的话，新加一条说明不会提醒任何人）。
 */
export function placeholdersOf(template: string): readonly string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/**
 * 推导说明文案需要的参数；模板里用不上的键**不出现**。
 *
 * ⚠️ 只给模板里真的有的占位符传参（与上一轮 `keyRows` 里那条判据同源）：
 * 不看模板就会给每条说明都塞一把用不上的参数 —— 那是"靠巧合正确"，
 * 而且会让"模板改了、参数没跟上"这类错**不再现形**。
 *
 * @param maxHp 这个技能所属单位的上限（回血类 `{percent}` 要用）。
 *   给不了就退化成只回**绝对值**（`{amount}`），`{percent}` 不出现 ——
 *   宁可让测试抓到"模板要 `{percent}` 而参数里没有"，也不要猜一个 420。
 */
export function descParamsOf(
  /** ⚠️ 只有主动技能有前摇 / 冷却 / 命中段 —— 说明文案的数值全从它们来。 */
  skill: ActiveSkillDef,
  template: string,
  maxHp?: number,
): Readonly<Record<string, number>> | undefined {
  const wanted = new Set(placeholdersOf(template));
  if (wanted.size === 0) return undefined;

  const params: Record<string, number> = {};

  if (wanted.has('cast')) params.cast = displaySeconds(skill.castTime);
  if (wanted.has('cooldown')) params.cooldown = displaySeconds(skill.cooldown);

  const buffSeconds = selfGrantedDurationSeconds(skill);
  if (wanted.has('seconds') && buffSeconds !== undefined) params.seconds = buffSeconds;

  const damage = firstDamageOf(skill);
  if (wanted.has('damage') && damage !== undefined) params.damage = damage;

  const stun = stunSecondsOf(skill);
  if (wanted.has('stun') && stun !== undefined) params.stun = stun;

  const heal = selfHealOf(skill);
  if (heal !== undefined) {
    if (wanted.has('amount')) params.amount = heal;
    if (wanted.has('percent') && maxHp !== undefined && maxHp > 0) {
      params.percent = Math.round((heal / maxHp) * 100);
    }
  }

  /** 增伤百分比（`modifiers[].op === 'addPercent'` 的 `value`）。 */
  const percent = selfPercentOf(skill);
  if (wanted.has('percent') && percent !== undefined) params.percent = percent;

  return Object.keys(params).length === 0 ? undefined : params;
}

/* ------------------------------------------------------------------ *
 * 从 `SkillDef` 取数
 *
 * ⚠️ **毫秒 → 秒一律走 `displaySeconds()`**（`app/displayTime.ts`）——
 * 设置页的结构化「冷却 / 施放」用的是同一个函数。两处各写一遍换算，
 * 就会出现"说明里是 0.6、结构化行里是 1"这种自相矛盾。
 * ------------------------------------------------------------------ */

/**
 * 这个技能**授予自己**的 buff 的时长（秒）；没有就给 `undefined`。
 *
 * ⚠️ 只认 `target.mode === 'self'`：给敌人挂的 debuff 时长与
 * "我获得 X 秒……"不是同一句话（例如「轰」的易伤）。
 */
function selfGrantedDurationSeconds(skill: SkillDef): number | undefined {
  for (const buff of selfGrantedBuffs(skill)) {
    if (!Number.isFinite(buff.duration)) continue;
    return displaySeconds(buff.duration);
  }
  return undefined;
}

/**
 * 这个技能的伤害数字。
 *
 * ⚠️ 取**第一个** `damage` 效果：当前内容里每个技能最多一段伤害
 * （多段的话该写哪一段由内容设计决定，不该由这里默默挑一个）。写成
 * 契约（`undefined`）而不是猜，是为了让它**在测试里现形**。
 */
function firstDamageOf(skill: ActiveSkillDef): number | undefined {
  for (const hit of skill.hits) {
    for (const effect of hit.effects) {
      const base = effect.damage?.base;
      if (effect.kind === 'damage' && typeof base === 'number' && Number.isFinite(base)) {
        return base;
      }
    }
  }
  return undefined;
}

/**
 * **让目标动不了**的时长（秒）—— "眩晕 N 秒" / "倒地 N 秒"那个数。
 *
 * ==================================================================
 * 为什么认两种形态，而不是只看 `kind: 'stun'`
 * ==================================================================
 *
 * 内容里有两条路把目标锁住，而玩家读到的都是"这段时间我动不了"：
 *
 *   `kind: 'stun'` + `LUST_STUN`（`flags.actionLock`） → 「魅惑」眩晕 3 秒
 *   `kind: 'grantBuff'` + `KNOCKDOWN`（`flags.restrictToTags`）→ 「碾压」倒地 2 秒
 *
 * ⚠️ 两者的**机制不同**（`actionLock` 是"完全不能动"，`restrictToTags`
 * 是"只能按白名单里的技能"），而且内容文件里专门解释过这一点 ——
 * 但**文案里那句话是同一句**："你在这 N 秒里按不了想按的东西"。
 * 所以判据是"挂的 buff 带**任何一种行动限制**"，不是"buff 叫什么名字"。
 *
 * 反过来，**不带限制的 buff 不算**（例如「碾压」的霸体是挂在 Boss 自己
 * 身上的，与"你动不了多久"无关）。
 */
function stunSecondsOf(skill: ActiveSkillDef): number | undefined {
  for (const hit of skill.hits) {
    for (const effect of hit.effects) {
      if (effect.kind !== 'stun' && effect.kind !== 'grantBuff') continue;
      const buff = effect.buff;
      if (buff === undefined) continue;
      const locks = buff.flags?.actionLock === true || (buff.flags?.restrictToTags?.length ?? 0) > 0;
      if (!locks) continue;
      if (!Number.isFinite(buff.duration)) continue;
      return displaySeconds(buff.duration);
    }
  }
  return undefined;
}

/** 给自己回血的绝对值（`resource: hp` 且 `delta > 0`）；没有就给 `undefined`。 */
function selfHealOf(skill: SkillDef): number | undefined {
  for (const ability of skill.abilities) {
    if (ability.kind !== 'resource') continue;
    if (ability.target.mode !== 'self') continue;
    if (String(ability.resource) !== 'hp') continue;
    if (typeof ability.delta !== 'number' || !Number.isFinite(ability.delta)) continue;
    if (ability.delta <= 0) continue;
    return ability.delta;
  }
  return undefined;
}

/**
 * 自己身上 `addPercent` 修正的数值（「凝」的增伤 20）。
 *
 * ⚠️ 找的是**技能授予自己的 buff 上的修正**，不是技能自己的字段 ——
 * 20 的家是 `FOCUS_BUFF.modifiers[0].value`。
 */
function selfPercentOf(skill: SkillDef): number | undefined {
  for (const buff of selfGrantedBuffs(skill)) {
    for (const modifier of buff.modifiers ?? []) {
      if (modifier.op !== 'addPercent') continue;
      if (typeof modifier.value !== 'number' || !Number.isFinite(modifier.value)) continue;
      return modifier.value;
    }
  }
  return undefined;
}

/** 技能授予**自己**的 buff 定义（`grant` + `target.mode === 'self'`）。 */
function selfGrantedBuffs(skill: SkillDef): readonly BuffDef[] {
  const out: BuffDef[] = [];
  for (const ability of skill.abilities) {
    if (ability.kind !== 'grant') continue;
    if (ability.target.mode !== 'self') continue;
    out.push(ability.buff);
  }
  return out;
}
