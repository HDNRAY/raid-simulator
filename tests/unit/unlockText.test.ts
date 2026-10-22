import { describe, expect, it } from 'vitest';

import { ALL_QIJI } from '../../src/data/qiji';
import { ALL_SKILLS } from '../../src/data/content';
import { unlockTextOf } from '../../src/app/unlockText';
import { zhCN } from '../../src/i18n/locales/zh-CN';

/**
 * **解锁条件的人话**（2026-10-20）。
 *
 * 用户："要显示 炁机解锁条件哈…，解锁条件 现在没有描述 就都加上"
 *
 * 这里钉两件事：
 *   1. **10 条真实炁机都能翻译出非空的话**（不漏一条）
 *   2. 文案**从结构推导**：数值 / 技能名 / 作用域都来自数据（改数据文案跟着变）
 *
 * ⚠️ 用一个**真的**语言包（`zhCN`），但不校验具体措辞（那是文案的事）——
 * 只校验"该出现的东西出现了"。
 */

/** 最小翻译器：按 `a.b.c` 走 zh-CN，`{x}` 用参数替换。 */
function makeTranslate(): (key: string, params?: Readonly<Record<string, string | number>>) => string {
  return (key, params) => {
    let node: unknown = zhCN;
    for (const part of key.split('.')) {
      if (node === null || typeof node !== 'object') return key;
      node = (node as Record<string, unknown>)[part];
    }
    if (typeof node !== 'string') return key;
    return params === undefined
      ? node
      : node.replace(/\{(\w+)\}/g, (_all, name: string) => String(params[name] ?? `{${name}}`));
  };
}

const translate = makeTranslate();
const skillName = (id: string): string =>
  translate(ALL_SKILLS.find((skill) => skill.id === id)?.nameKey ?? `skill.${id}.name`);
/** 资源名（与 `screenSetup` 注入的同一个 key 形状：`resource.<key>`）。 */
const resourceName = (resource: string): string => {
  const table = (zhCN as { resource?: Record<string, string> }).resource ?? {};
  return table[resource] ?? resource;
};
const deps = { translate, skillName, resourceName };

describe('解锁条件的文案（从结构推导）', () => {
  it('**池子里每一条**都有非空的解锁说明', () => {
    /** ⚠️ 不钉条数（内容会长）：只要求"一条不漏地翻得出来"。 */
    expect(ALL_QIJI.length).toBeGreaterThanOrEqual(10);
    for (const qiji of ALL_QIJI) {
      const text = unlockTextOf(qiji.unlock, deps);
      expect(text.length, qiji.id).toBeGreaterThan(0);
      /** 没有漏替换的占位符。 */
      expect(text, qiji.id).not.toMatch(/\{\w+\}/);
    }
  });

  it('`always` ⇒ 「开局即可选」', () => {
    expect(unlockTextOf({ kind: 'always', of: [] }, deps)).toBe('开局即可选');
  });

  it('⚠️ 空 `all` 也按「开局即可选」（它的语义就是真）', () => {
    expect(unlockTextOf({ kind: 'all', of: [] }, deps)).toBe('开局即可选');
  });

  it('数值与技能名**从数据来**（把 3 改成 3 —— 那条炁机写的就是 3）', () => {
    const jie = ALL_QIJI.find((qiji) => qiji.unlock.kind === 'statAtLeast');
    expect(jie).toBeDefined();
    const unlock = jie?.unlock;
    if (unlock?.kind !== 'statAtLeast') return;
    const text = unlockTextOf(unlock, deps);
    expect(text).toContain(String(unlock.value));
    /** ⚠️ 2026-10-22：文案从「本局」改成「局内」（用户口径）。 */
    expect(text).toContain('局内');
    /** ⚠️ 只有技能级维度才有 `skillId`（`dodges` / `battlesWon` 那些没有）。 */
    if ('skillId' in unlock.stat) {
      expect(text).toContain(skillName(unlock.stat.skillId));
    }
  });

  it('组合条件：`all` / `any` / `not` 都能翻译（递归）', () => {
    const leaf = { kind: 'statAtLeast', stat: { s: 'dodges', scope: 'run' }, value: 2 } as const;
    expect(unlockTextOf({ kind: 'all', of: [leaf, leaf] }, deps)).toContain('同时满足');
    expect(unlockTextOf({ kind: 'any', of: [leaf, leaf] }, deps)).toContain('任意一条');
    expect(unlockTextOf({ kind: 'not', of: leaf }, deps)).toContain('不满足');
  });
});
