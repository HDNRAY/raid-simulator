import { describe, expect, it } from 'vitest';

import { prepareDetailContext } from '../../src/app/prepareDetailContext';
import { BOSS_DEFS } from '../../src/data/bossDefs';

/**
 * **自由模式的 Boss 详情必须能看到它的"所有能力"。**
 *
 * ==================================================================
 * 这条测试要抓的是什么（用户 2026-10-14 要求）
 * ==================================================================
 *
 * > 还做一个测试，确保自由模式 boss详情里可以看到所有的能力
 *
 * 详情面板那两节的数据是这样来的（`app/prepareDetailContext.ts`）：
 *
 * | 那一节 | 来源 |
 * |---|---|
 * | 「招式」 | 从 **行为数组（轮转）** 里推（`bossSkillIds`）|
 * | 「被动」 | `BossDef.passives` |
 *
 * ⚠️ **"从轮转里推"有一个静默的漏**：一个 Boss 的招式只要**不在 `rotation`
 * 的步骤里**（例如"半血才用一次的「回补」"、"开场用一次的 `opener`"），
 * 面板上就**根本不会列出来** —— 而玩家会以为"它只有这几招"。
 * 这种漏不会让任何东西报错，只有人去看面板才会发现。
 *
 * ⇒ 所以判据是：**`BossDef.skills` 里的每一条都要在面板上看得见**，
 * 而且被动那一节要覆盖 `BossDef.passives` 的每一条。
 */

/** 面板那一屏的取值上下文（只用到 boss 那两节，`qijiOn` 给个恒假的）。 */
const ctx = prepareDetailContext({ on: () => false });

describe('自由模式：Boss 详情能看到**全部**能力', () => {
  for (const def of BOSS_DEFS) {
    describe(`${def.id}`, () => {
      it('「招式」那一节覆盖 `BossDef.skills` 的每一条', () => {
        const shown = new Set(ctx.bossSkills(def.id).map((row) => row.nameKey));
        const missing = def.skills
          .filter((skill) => !shown.has(skill.nameKey))
          .map((skill) => skill.id);
        expect(missing, `这些招式在详情面板上看不到：${missing.join(', ')}`).toEqual([]);
      });

      it('「被动」那一节覆盖 `BossDef.passives` 的每一条', () => {
        const shown = new Set(ctx.bossPassives(def.id).map((row) => row.nameKey));
        const missing = def.passives
          .filter((passive) => !shown.has(passive.nameKey))
          .map((passive) => passive.id);
        expect(missing, `这些被动在详情面板上看不到：${missing.join(', ')}`).toEqual([]);
      });

      it('⚠️ 每一行都带着**可解析的 i18n key**（漏了 key 面板上会显示路径本身）', () => {
        const rows = [...ctx.bossSkills(def.id), ...ctx.bossPassives(def.id)];
        expect(rows.length, `${def.id} 在面板上一行都没有`).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.nameKey, `${def.id} 有一行的 nameKey 是空的`).toBeTruthy();
          /** key 必写成 `域.名字.字段`（内容里的命名纪律），不是给人看的字面值。 */
          expect(row.nameKey, `${def.id} 的 ${row.nameKey} 不像一个 i18n key`).toMatch(
            /^[a-z][A-Za-z0-9]*\.[A-Za-z0-9.]+$/,
          );
        }
      });
    });
  }
});
