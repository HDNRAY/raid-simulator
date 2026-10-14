import { describe, expect, it } from 'vitest';

import { BOSS_ROSTER, PLAYER_ROSTER } from '../../src/data/roster';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { flattenCatalog } from '../../src/i18n/translator';

/**
 * **名单上的每个名字都得能解析**（2026-10-14 补）。
 *
 * ==================================================================
 * 为什么要有这一条（它抓的是一个真实出现过的 bug）
 * ==================================================================
 *
 * 自由模式界面上有**两个 Boss 直接显示成了 `envy.name` / `sloth.name`** ——
 * 因为语言包里那两行**丢了**，而 `roster.ts` 读的正是那两个 key。
 *
 * ⚠️ 丢的原因值得记下来：那两个 Boss 的**技能 id 前缀**与 **Boss id**
 * 不是一个词（`jealousy-*` vs `envy`、`lazy-*` vs `sloth`），所以语言包
 * 里本该有**两行**（一行给 roster、一行给内容）。原地那段注释甚至写着
 * "两行都在" —— **注释说在，数据里没了**，而且没有任何东西会红：
 * 缺 key 时渲染层只能把 key 原样画出来。
 *
 * ⚠️ 所以判据是"**名单 → key → 语言包**"这条链要通 —— 与"某个名字当时
 * 叫什么字面值"无关（那属于 AGENTS.md §4a 右列，不该钉）。
 */
const catalog = flattenCatalog(zhCN);
const has = (key: string): boolean => catalog.get(key) !== undefined;

describe('备战/自由模式的名单：nameKey 必须能解析', () => {
  it('每个 Boss 的 nameKey 都在语言包里', () => {
    const missing = BOSS_ROSTER.map((e) => e.nameKey).filter((key) => !has(key));
    expect(missing, `这些 key 解析不出来（界面上会原样显示 key 名）`).toEqual([]);
  });

  it('每个人物的 nameKey 都在语言包里', () => {
    const missing = PLAYER_ROSTER.map((e) => e.nameKey).filter((key) => !has(key));
    expect(missing).toEqual([]);
  });

  it('⚠️ id 与内容前缀不同的那两个 Boss：**两行都要在**', () => {
    /**
     * 这一条钉的是"为什么会有两条重复的名字"这件事本身：
     * `envy` / `jealousy` 与 `sloth` / `lazy` 各自都要有 `name`。
     * ⚠️ 不钉字面值（那会变成"改个译名就要改测试"）——
     * 只钉"两边都存在、而且指向同一个显示值"。
     */
    for (const [idKey, contentPrefix] of [
      ['envy', 'jealousy'],
      ['sloth', 'lazy'],
    ] as const) {
      const byId = catalog.get(`${idKey}.name`);
      const byContent = catalog.get(`${contentPrefix}.name`);
      expect(byId, `${idKey}.name 丢了（roster 读的是它）`).toBeDefined();
      expect(byContent, `${contentPrefix}.name 丢了（内容推导的是它）`).toBeDefined();
      /** ⚠️ 两个入口必须给**同一个**显示值（否则同一个 Boss 有两个名字）。 */
      expect(byId).toBe(byContent);
    }
  });
});
