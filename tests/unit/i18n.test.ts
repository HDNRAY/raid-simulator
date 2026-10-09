import { describe, expect, it } from 'vitest';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { createTranslator, flattenCatalog } from '../../src/i18n/translator';
import { idToSubject, type MessageKey } from '../../src/i18n/types';

/**
 * i18n 基础设施的验收测试（i18n 规范 §9 的 I18N-T1..T5）。
 *
 * 这一层的价值全在"编译期 + 构建期把错误挡住"，所以测试重点是：
 * 类型推导是否正确、缺 key / 缺参 / 重复 key 是否**报错**而不是静默降级。
 *
 * 关于注入假 catalog：真实语言包目前没有占位符文案，而占位符替换
 * 是热路径上唯一有分支的逻辑，必须真的测到。所以 createTranslator
 * 支持 `catalog` 覆盖（该选项只为测试存在，生产路径用 CATALOGS[locale]）。
 */

const t = createTranslator('zh-CN');

/** 用假 catalog 构造翻译器：类型上仍是 Catalog，运行时是测试内容。 */
function withCatalog(entries: Record<string, string>) {
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    const parts = key.split('.');
    let node = nested;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i] as string;
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = value;
  }
  return createTranslator('zh-CN', { catalog: nested as unknown as typeof zhCN });
}

describe('I18N-T1 / T3：扁平化', () => {
  it('扁平化后每条 key 都能取到且非空', () => {
    const flat = flattenCatalog(zhCN);
    expect(flat.size).toBeGreaterThan(50);
    for (const [key, value] of flat) {
      expect(key).not.toBe('');
      expect(value.length).toBeGreaterThan(0);
      expect(typeof value).toBe('string');
    }
  });

  it('key 是点分路径形式，中间层不会成为叶子', () => {
    const flat = flattenCatalog(zhCN);
    expect(flat.has('resource.hp')).toBe(true);
    expect(flat.has('stat.strength')).toBe(true);
    expect(flat.has('resource')).toBe(false);
    expect(flat.has('stat')).toBe(false);
  });

  it('【T3】重复 key 会抛错（而不是静默覆盖）', () => {
    const colliding = { a: { b: 'x' }, 'a.b': 'y' } as unknown as typeof zhCN;
    expect(() => flattenCatalog(colliding)).toThrow(/duplicate i18n key: a\.b/);
  });

  it('空字符串值会抛错', () => {
    const empty = { a: '' } as unknown as typeof zhCN;
    expect(() => flattenCatalog(empty)).toThrow(/empty i18n value: a/);
  });

  it('非字符串叶子会抛错', () => {
    const bad = { a: 1 } as unknown as typeof zhCN;
    expect(() => flattenCatalog(bad)).toThrow(/must be a string or object/);
  });
});

describe('I18N-T4：模板与占位符', () => {
  it('无占位符的 key 原样返回', () => {
    /**
     * 断言"返回的是语言包里的那个值"，而**不是**某一个具体文案。
     * 早期这里写死了 '生命'，于是改个显示名（生命 → 血）就会假失败 ——
     * 而译文本身并不是这条测试要验证的东西（它验证的是"无占位符时原样返回"）。
     */
    expect(t.t('resource.hp')).toBe(zhCN.resource.hp);
    // 同上：引用语言包而不是写死文案（`reject.gcd` 已随 GCD 一起删除）
    expect(t.t('reject.casting')).toBe(zhCN.reject.casting);
  });

  it('字符串参数被替换', () => {
    const tr = withCatalog({ greeting: '你好 {name}', plain: '无参' });
    expect(tr.t('greeting' as MessageKey, { name: '张语寒' })).toBe('你好 张语寒');
  });

  it('数字参数按当前语言格式化（不是裸 toString）', () => {
    const tr = withCatalog({ msg: '造成 {amount} 点伤害' });
    // 中文 locale 下 12345 → 12,345
    expect(tr.t('msg' as MessageKey, { amount: 12345 })).toBe('造成 12,345 点伤害');
  });

  it('不传 params 时返回原始模板（占位符保留，由调用方负责）', () => {
    const tr = withCatalog({ msg: '共 {count} 个' });
    expect(tr.t('msg' as MessageKey)).toBe('共 {count} 个');
  });

  it('缺失参数会抛错，不静默留下 {placeholder}', () => {
    const tr = withCatalog({ msg: '共 {count} 个' });
    // 传了 params 但少了 key 里的占位符 → 必须抛错，否则玩家会看到 {count}
    expect(() => tr.t('msg' as MessageKey, { other: 1 })).toThrow(
      /missing i18n param "count"/,
    );
    expect(() => tr.t('msg' as MessageKey, {})).toThrow(/missing i18n param "count"/);
  });

  it('同一 key 多次调用命中缓存且结果一致', () => {
    const tr = withCatalog({ msg: '{a}-{b}' });
    const first = tr.t('msg' as MessageKey, { a: 'x', b: 'y' });
    const second = tr.t('msg' as MessageKey, { a: 'p', b: 'q' });
    expect(first).toBe('x-y');
    expect(second).toBe('p-q');
  });

  it('缺少 key 会抛错（理论上被类型挡住，运行时要兜住）', () => {
    expect(() => t.t('resource.nope' as MessageKey)).toThrow(/missing i18n key: resource\.nope/);
  });
});

describe('I18N-T5：数字格式化', () => {
  it('number 加千分位', () => {
    expect(t.number(1234)).toBe('1,234');
    expect(t.number(1234567)).toBe('1,234,567');
    expect(t.number(0)).toBe('0');
    expect(t.number(-1234)).toBe('-1,234');
  });

  it('percent 默认一位小数', () => {
    expect(t.percent(0.204)).toBe('20.4%');
    expect(t.percent(0.5)).toBe('50.0%');
    expect(t.percent(0)).toBe('0.0%');
  });

  it('percent 可指定小数位', () => {
    expect(t.percent(0.204, { digits: 0 })).toBe('20%');
    expect(t.percent(0.20456, { digits: 2 })).toBe('20.46%');
  });

  it('percent 可选正号（增伤显示用），0 不加号', () => {
    expect(t.percent(0.1, { signed: true })).toBe('+10.0%');
    expect(t.percent(-0.1, { signed: true })).toBe('-10.0%');
    expect(t.percent(0, { signed: true })).toBe('0.0%');
  });

  it('duration 保留一位小数直到 1 分钟，之后用 m/s', () => {
    expect(t.duration(300)).toBe('0.3s');
    expect(t.duration(12500)).toBe('12.5s');
    expect(t.duration(45000)).toBe('45.0s');
    expect(t.duration(59900)).toBe('59.9s');
    expect(t.duration(60000)).toBe('1m00s');
    expect(t.duration(125000)).toBe('2m05s');
    expect(t.duration(600000)).toBe('10m00s');
  });
});

describe('复数形式', () => {
  it('中文没有单复数区分，one 与 other 都返回同一形式', () => {
    expect(t.plural({ one: 'resource.hp', other: 'resource.hp' }, 1)).toBe(zhCN.resource.hp);
    expect(t.plural({ one: 'resource.hp', other: 'resource.hp' }, 5)).toBe(zhCN.resource.hp);
  });
});

describe('内容 id → 文案 subject 的映射（i18n 规范 §5）', () => {
  it('kebab-case 转 camelCase', () => {
    expect(idToSubject('entropy-clock')).toBe('entropyClock');
    expect(idToSubject('war-banner')).toBe('warBanner');
    expect(idToSubject('slash')).toBe('slash');
  });

  it('下划线与空格也归一化', () => {
    expect(idToSubject('entropy_clock')).toBe('entropyClock');
    expect(idToSubject('entropy clock')).toBe('entropyClock');
  });

  it('每个词都成为一段（a-b-c → aBC，不是 abc）', () => {
    expect(idToSubject('a-b-c')).toBe('aBC');
    expect(idToSubject('war-banner-of-doom')).toBe('warBannerOfDoom');
  });

  it('连续分隔符不会产生空段', () => {
    expect(idToSubject('a--b')).toBe('aB');
    expect(idToSubject('-a-')).toBe('a');
  });

  it('已是驼峰或全小写的 id 不被破坏', () => {
    expect(idToSubject('slash')).toBe('slash');
    expect(idToSubject('ARc')).toBe('arc');
  });
});

describe('类型推导与规模', () => {
  it('key 类型是点分字面量联合', () => {
    // 真正的保障在 tsc：把下面那行放开注释会编译失败
    const key: MessageKey = 'resource.hp';
    expect(t.t(key)).toBe(zhCN.resource.hp);
    // const bad: MessageKey = 'resource.hpX';
  });

  it('locale 与 key 数量可查询', () => {
    expect(t.locale).toBe('zh-CN');
    expect(t.size).toBe(flattenCatalog(zhCN).size);
  });
});
