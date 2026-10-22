/**
 * **炁机说明里的数值 = 从定义里读出来的**（2026-10-22，用户："炁机的数字是写死的
 * 还是读的代码？**应该读代码**"）。
 *
 * 这里断言的是**机制**（"模板里的每个占位符都能从定义取到值" + "改定义 ⇒ 说明跟着变"），
 * **不是字面值** ⇒ 调平衡时不会红 ✓；只有"说明与定义脱钩"才会红 ✓
 * （AGENTS §4b 的左右列判据）。
 */
import { describe, expect, it } from 'vitest';
import { qijiDescParamsOf } from '../../src/app/qijiDescParams';
import { descTextOf } from '../../src/ui/descText';
import { ALL_QIJI } from '../../src/data/qiji';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import type { QijiEntity } from '../../src/core/types/qiji';

/**
 * 取某条炁机的说明模板（`qiji.<id>.desc`）。
 *
 * ⚠️ 用**类型守卫**而不是 `as unknown as`（AGENTS §1 禁止那个逃生舱，
 * `lintRules` 会扫描 tests/）：
 */
const templateOf = (qiji: QijiEntity): string => {
  const key = String(qiji.descKey).split('.')[1] ?? '';
  const group: unknown = (zhCN as { qiji?: unknown }).qiji;
  if (group === null || typeof group !== 'object') return '';
  const entry: unknown = (group as Record<string, unknown>)[key];
  if (entry === null || typeof entry !== 'object') return '';
  const desc: unknown = (entry as { desc?: unknown }).desc;
  return typeof desc === 'string' ? desc : '';
};

/** 用参数把模板填起来（与渲染层 `t(key, params)` 同一语义：缺参就留着占位符）。 */
const render = (template: string, params: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => params[key] ?? whole);

const byId = (id: string): QijiEntity => {
  const found = ALL_QIJI.find((q) => q.id === id);
  if (found === undefined) throw new Error(`炁机不存在：${id}`);
  return found;
};

describe('炁机说明的数值来自定义', () => {
  it('**每一条**炁机的每个占位符都能从定义里取到值（不是 undefined）', () => {
    const missing: string[] = [];
    for (const qiji of ALL_QIJI) {
      const params = qijiDescParamsOf(qiji);
      for (const match of templateOf(qiji).matchAll(/\{(\w+)\}/g)) {
        const key = match[1] ?? '';
        if (params[key] === undefined) missing.push(`${qiji.id}:{${key}}`);
      }
    }
    /** 缺参 ⇒ 界面上会直接显示 `{amount}` 这种东西（静默坏）✗ */
    expect(missing).toEqual([]);
  });

  it('凝神斩意：{damage} == 触发器 deal 里的伤害', () => {
    const qiji = byId('ningShenZhanYi');
    const then = qiji.passiveBuffs?.[0]?.triggers?.[0]?.then?.[0];
    const base = then?.kind === 'deal'
      ? then.hit.effects.find((e) => e.kind === 'damage')?.damage?.base
      : undefined;
    expect(qijiDescParamsOf(qiji).damage).toBe(String(base));
    expect(render(templateOf(qiji), qijiDescParamsOf(qiji))).toContain(String(base));
  });

  it('聚气凝神 / 炁能回收：{delta} == |costDeltas.delta|', () => {
    for (const id of ['ningShenJuQi', 'qiNengHuiShou']) {
      const qiji = byId(id);
      const delta = qiji.skillTweak?.costDeltas?.[0]?.delta ?? Number.NaN;
      expect(qijiDescParamsOf(qiji).delta).toBe(String(Math.abs(delta)));
      expect(render(templateOf(qiji), qijiDescParamsOf(qiji))).toContain(String(Math.abs(delta)));
    }
  });

  it('⚡ 变异：把「聚气凝神」的代价减量改掉，说明**跟着变**（机制真的接通了）', () => {
    const original = byId('ningShenJuQi');
    const delta = original.skillTweak?.costDeltas?.[0]?.delta;
    if (delta === undefined) throw new Error('聚气凝神没有 costDeltas');
    /** 造一份"改过数值"的定义（只动那一个数）——不写回内容池 */
    const tweak = original.skillTweak;
    if (tweak === undefined) throw new Error('聚气凝神没有 skillTweak');
    const mutated: QijiEntity = {
      ...original,
      skillTweak: { ...tweak, costDeltas: [{ resource: 'douqi', delta: delta - 7 }] },
    };
    const before = render(templateOf(original), qijiDescParamsOf(original));
    const after = render(templateOf(mutated), qijiDescParamsOf(mutated));
    expect(before).toContain(String(Math.abs(delta)));
    expect(after).toContain(String(Math.abs(delta - 7)));
    expect(after).not.toBe(before);
  });
});

describe('渲染兜底：界面上绝不出现 `{…}`（2026-10-22 用户实测："我看到了 {amount}"）', () => {
  it('每条炁机的说明用 `descTextOf` 渲染后都不含花括号', () => {
    for (const qiji of ALL_QIJI) {
      const template = templateOf(qiji);
      if (template === '') continue;
      const params = qijiDescParamsOf(qiji);
      /** 与渲染层同一个函数（`ui/descText.descTextOf` 的语义：少参就抹掉占位符）。 */
      const rendered = descTextOf(
        (key, p) => {
          const withParams = template.replace(/\{(\w+)\}/g, (whole, k: string) => String(p?.[k] ?? whole));
          return key === '' ? withParams : withParams;
        },
        '',
        params,
      );
      expect(rendered).not.toContain('{');
      expect(rendered).not.toContain('}');
    }
  });

  it('缺参数时整段降级 / 抹掉，不会把 `{x}` 画到界面上', () => {
    /** 假的 `t`：把 `{x}` 按参数替换（与真实翻译层同一语义；缺参就留着）。 */
    const translate = (key: string, p?: Readonly<Record<string, string | number>>): string =>
      key.replace(/\{(\w+)\}/g, (whole, k: string) => String(p?.[k] ?? whole));
    expect(descTextOf(translate, '造成{damage}点伤害', {})).toBe('造成点伤害');
    expect(descTextOf(translate, '{amount}', {})).toBe('');
    expect(descTextOf(translate, '生命上限增加{amount}。', { amount: '30' })).toBe(
      '生命上限增加30。',
    );
  });
});
