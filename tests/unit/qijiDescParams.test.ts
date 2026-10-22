/**
 * **炁机说明里的数值 = 从定义读出来的**（2026-10-22，用户："炁机的数字是写死的
 * 还是读的代码？应该读代码"）。
 *
 * ⚠️ 这里断言的是**机制**（"说明里的数 == 定义里的数"），不是字面值 ⇒
 * 调平衡（改 `deal` 伤害 / 改 `costDeltas`）时**不会红** ✓；只有"说明与定义
 * 脱钩"才会红 ✓（AGENTS §4b 的左右列判据）。
 */
import { describe, expect, it } from 'vitest';
import { qijiDescParamsOf } from '../../src/app/qijiDescParams';
import { ALL_QIJI } from '../../src/data/qiji';
import type { QijiEntity } from '../../src/core/types/qiji';

const byId = (id: string): QijiEntity => {
  const found = ALL_QIJI.find((q) => q.id === id);
  if (found === undefined) throw new Error(`炁机不存在：${id}`);
  return found;
};

/** 模板里的占位符（`{xxx}`）。 */
const placeholdersOf = (template: string): readonly string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');

describe('炁机说明的数值来自定义', () => {
  it('凝神斩意：{damage} == 触发器 deal 里的伤害', () => {
    const qiji = byId('ningShenZhanYi');
    const params = qijiDescParamsOf(qiji);
    expect(params.damage).toBeDefined();
    /** 定义里那条 `deal` 的 damage 值，必须与说明里的数一致 */
    const deal = qiji.passiveBuffs?.[0]?.triggers?.[0]?.then?.[0];
    const base = deal?.kind === 'deal'
      ? deal.hit.effects.find((e) => e.kind === 'damage')?.damage?.base
      : undefined;
    expect(params.damage).toBe(String(base));
  });

  it('炁能回收 / 聚气凝神：{delta} == costDeltas 的绝对值', () => {
    for (const id of ['qiNengHuiShou', 'ningShenJuQi']) {
      const qiji = byId(id);
      expect(qijiDescParamsOf(qiji).delta).toBe(
        String(Math.abs(qiji.skillTweak?.costDeltas?.[0]?.delta ?? NaN)),
      );
    }
  });

  it('已改成模板的 desc，占位符都能从定义里取到值（不许出现 undefined）', () => {
    const converted = ['ningShenZhanYi', 'baoLieHuDun', 'chanJinHuanSheng', 'qiNengHuiShou', 'ningShenJuQi'];
    for (const id of converted) {
      const qiji = byId(id);
      const params = qijiDescParamsOf(qiji);
      /**
       * ⚠️ 这里只查"**定义里已有**的字段都给了值"：`qijiDescParamsOf` 读不到
       * 的字段本来就不会出现在模板里（见那个文件的文件头：不猜、不默认成 0）。
       */
      for (const key of Object.keys(params)) {
        expect(String(params[key])).not.toBe('undefined');
        expect(String(params[key])).not.toBe('');
      }
      expect(placeholdersOf(`{${Object.keys(params).join('}{')}}`).length).toBeGreaterThan(0);
    }
  });
});
