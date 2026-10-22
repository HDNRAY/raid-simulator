/**
 * **解锁条件的人话**（2026-10-20，用户："要显示 炁机解锁条件哈…，解锁条件
 * 现在没有描述 就都加上"）。
 *
 * ==================================================================
 * 为什么不给每个炁机手写一句
 * ==================================================================
 *
 * 解锁条件是**结构数据**（`QijiUnlock`：`statAtLeast{stat, value}` /
 * `all` / `any` / `not`）—— 手写一句就是"同一件事的第二份表达"：
 * 条件一改（3 → 5 次、换技能），那句话就静默过期 ✗。
 *
 * 所以这里是**从结构推导文案**：递归翻译每一个条件，数值 / 技能名 /
 * 作用域全部取自数据本身。新增一条解锁条件**不用**加文案。
 *
 * ⚠️ 它住在 `app/` 而不是 `ui/`：要 import `core/` 的类型，而渲染层
 * 不许碰 core 内部模块（架构规范 C3）。界面只收**算好的字符串**
 * （`CodexEntry.unlockText`）。
 */

import type { QijiUnlock } from '../core/types/qiji';
import type { BattleStatQuery } from '../core/run/query';
import type { TranslateFn } from '../i18n/translator';

export interface UnlockTextDeps {
  readonly translate: TranslateFn;
  /** 技能 id → 显示名（`skill.<id>.name` 那些）。 */
  readonly skillName: (skillId: string) => string;
  /** 资源名（缠 / 炁 / 血）。 */
  readonly resourceName: (resource: string) => string;
}

/** 作用域：`run` = 整局，`battle` = 这一场。 */
function scopeText(scope: string, d: UnlockTextDeps): string {
  return d.translate(scope === 'battle' ? 'screen.codex.unlock.scopeBattle' : 'screen.codex.unlock.scopeRun');
}

/** 一条**统计查询**的话（"本局用「截」3 次"这种）。 */
function statText(stat: BattleStatQuery, value: number, d: UnlockTextDeps): string {
  const scope = scopeText(stat.scope, d);
  const params = { scope, value: String(value) };
  switch (stat.s) {
    case 'skillUses':
      return d.translate('screen.codex.unlock.skillUses', { ...params, skill: d.skillName(stat.skillId) });
    case 'skillDamage':
      return d.translate('screen.codex.unlock.skillDamage', { ...params, skill: d.skillName(stat.skillId) });
    case 'skillHits':
      return d.translate('screen.codex.unlock.skillHits', { ...params, skill: d.skillName(stat.skillId) });
    case 'skillInterrupts':
      return d.translate('screen.codex.unlock.skillInterrupts', {
        ...params,
        skill: d.skillName(stat.skillId),
      });
    case 'skillAvoids':
      return d.translate('screen.codex.unlock.skillAvoids', {
        ...params,
        skill: d.skillName(stat.skillId),
      });
    case 'resourceSpent':
      return d.translate('screen.codex.unlock.resourceSpent', {
        ...params,
        resource: d.resourceName(stat.resource),
      });
    case 'dodges':
      return d.translate('screen.codex.unlock.dodges', params);
    case 'battlesWon':
      return d.translate('screen.codex.unlock.battlesWon', params);
    case 'flawlessBattles':
      return d.translate('screen.codex.unlock.flawlessBattles', params);
  }
}

/**
 * 一条解锁条件的**人话**（递归）。
 *
 * ⚠️ 组合条件（`all` / `any`）用「、」连接子句；空 `all` 按"开局即可选"
 * 处理（那是"零子条件"的语义，见 `QijiUnlock` 的说明）。
 */
export function unlockTextOf(unlock: QijiUnlock, d: UnlockTextDeps): string {
  /**
   * ⚠️ **统一加「解锁条件：」前缀**（用户 2026-10-22："其他条件也加上
   * '解锁条件：'几个字"）—— 加在这一层而不是每个模板里：模板会越来越多，
   * 一个漏了前缀就会让那一行看起来不像条件 ✗。
   */
  /**
   * ⚠️ **前缀后面换行、不带冒号**（用户 2026-10-22："解锁条件 后面换一行
   * 不需要 冒号了"）⇒ 卡片上是两行：
   *
   * ```
   * 解锁条件
   * 局内用「斩」3 次
   * ```
   */
  return `${d.translate('screen.codex.unlock.prefix')}\n${unlockBodyOf(unlock, d)}`;
}

/** 一句条件（不含前缀）—— 组合条件递归时用它，避免前缀重复。 */
function unlockBodyOf(unlock: QijiUnlock, d: UnlockTextDeps): string {
  switch (unlock.kind) {
    case 'always':
      return d.translate('screen.codex.unlock.always');
    case 'statAtLeast':
      return statText(unlock.stat, unlock.value, d);
    case 'all': {
      const parts = unlock.of.map((child) => unlockBodyOf(child, d));
      /**
       * ⚠️ 空 `all` = **真**（没有任何一项被违反）—— 也就是"开局即可选"。
       * 不写这一支的话，界面会显示一句空的"同时满足："。
       */
      if (parts.length === 0) return d.translate('screen.codex.unlock.always');
      return d.translate('screen.codex.unlock.all', { parts: parts.join(d.translate('common.listSeparator')) });
    }
    case 'any':
      return d.translate('screen.codex.unlock.any', {
        parts: unlock.of.map((child) => unlockBodyOf(child, d)).join(d.translate('common.listSeparator')),
      });
    case 'not':
      return d.translate('screen.codex.unlock.not', { part: unlockBodyOf(unlock.of, d) });
  }
}
