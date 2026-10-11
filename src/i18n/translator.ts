/**
 * 运行时翻译器。
 *
 * 设计要点（i18n 规范 §4）：
 *   - 启动时把嵌套语言包**扁平化**成 `Record<string, string>`，一次开销
 *   - `t()` 是最热路径（每帧可能调用几十次），所以：
 *       · 不带参数的 key 直接返回字符串，零分配
 *       · 带参数的模板**按 key 缓存**解析结果
 *   - 数字/百分比/时长走 `Intl`，不用 `toFixed` 手写 ——
 *     不同语言的小数点、千分位、百分比格式不同
 *   - **不做运行时 key 校验**（生产环境零成本）；校验在构建期完成
 *     （内容校验器 + MessageKey 类型）
 */

import { zhCN } from './locales/zh-CN';
import type { Catalog, MessageKey } from './types';

/** 支持的语言。当前只有中文，但结构上已就绪。 */
/**
 * **取词函数的统一形状** —— 所有组件、所有注入点都用它。
 *
 * ==================================================================
 * 为什么必须是一个具名类型，而不是各处写 `(key: string) => string`
 * ==================================================================
 *
 * 踩过的坑（用户报告）：设置页里**技能的代价与冷却全没了**，
 * 修好取数之后界面上显示的却是 **`{value} {resource}` / `{seconds}`
 * 这些占位符本身**。
 *
 * 根因有两层，而第二层才是真正难查的：
 *
 *   1. `main.ts` 里写成 `(key) => translator.t(key)` —— 手工丢了 `params`
 *   2. **`SettingsPanelOptions.translate` 的类型是 `(key: string) => string`**
 *      —— 于是"丢参数"不是失误，而是**类型系统认可的写法**。
 *      TypeScript 允许"参数更少的函数"赋值给"参数更多的类型"
 *      （这是刻意的、为了 `Array.map(parseInt)` 那类场景），
 *      所以这个 bug **一路静默到界面上**，编译、单测、eslint 全绿。
 *
 * 收窄成"只有一个参数"就不再是安全网，而是**帮凶**。所以：
 * 形状只在这里定义一次，各处引用它。以后再有人写出只收 `key` 的实现，
 * 编译器会当场拦下 —— 因为**显式的 `params` 参数不能不处理**。
 */
export type TranslateFn = (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string;

export type LocaleId = 'zh-CN';

export const DEFAULT_LOCALE: LocaleId = 'zh-CN';

const CATALOGS: Record<LocaleId, Catalog> = {
  'zh-CN': zhCN,
};

/**
 * 扁平化：`{ stat: { strength: '力量' } }` → `{ 'stat.strength': '力量' }`。
 *
 * 检测重复 key —— `{ a: { b: 'x' }, 'a.b': 'y' }` 这种结构会静默覆盖，
 * 属于内容错误，必须报错（I18N-T3）。
 */
export function flattenCatalog(catalog: Catalog): Map<string, string> {
  const out = new Map<string, string>();

  const walk = (node: unknown, prefix: string): void => {
    if (typeof node === 'string') {
      if (out.has(prefix)) {
        // 开发者错误：用英文（I1）
        throw new Error(`duplicate i18n key: ${prefix}`);
      }
      if (node.length === 0) {
        throw new Error(`empty i18n value: ${prefix}`);
      }
      out.set(prefix, node);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        walk(value, prefix === '' ? key : `${prefix}.${key}`);
      }
      return;
    }
    throw new Error(`i18n value at "${prefix}" must be a string or object`);
  };

  walk(catalog, '');
  return out;
}

/** `{name}` 形式的占位符。 */
const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** 参数值。数字会被格式化前先由调用方决定，这里只做字符串替换。 */
export type MessageParams = Record<string, string | number>;

/** Intl 相关的可注入钩子。仅测试需要替换。 */
export interface TranslatorIntl {
  readonly number: Intl.NumberFormat;
  readonly percent: (digits: number) => Intl.NumberFormat;
  readonly plural: Intl.PluralRules;
}

export interface TranslatorOptions {
  /**
   * 覆盖语言包。**只为测试存在** —— 生产路径必须用 `CATALOGS[locale]`，
   * 否则类型推导（MessageKey）与实际内容可能脱节。
   */
  readonly catalog?: Catalog;
  readonly intl?: TranslatorIntl;
}

export interface Translator {
  readonly locale: LocaleId;
  /**
   * 按 key 取文案。缺失参数会抛错，不静默留下 `{placeholder}`。
   *
   * 参数类型是 `MessageKey`，所以拼错 key 在编译期就被拒。
   * 内部实现收 `string`，因为测试需要一个更宽的入口。
   */
  t(key: MessageKey, params?: MessageParams): string;
  /** `1234` → `1,234` */
  number(value: number): string;
  /** `0.204` → `20.4%`；`signed` 为真时带正负号 */
  percent(value: number, options?: { digits?: number; signed?: boolean }): string;
  /** `12500` → `12.5s` */
  duration(ms: number): string;
  /** 按语言规则选择单复数形式 */
  plural(forms: { one: MessageKey; other: MessageKey }, count: number): string;
  /** 该语言有多少条 key（测试与调试用） */
  readonly size: number;
}

/**
 * 创建翻译器。
 *
 * 模板解析结果按 "key + 占位符集合" 缓存：同一个 key 的占位符集合固定，
 * 所以缓存命中率是 100%（除了首次）。
 */
export function createTranslator(
  locale: LocaleId = DEFAULT_LOCALE,
  options: TranslatorOptions = {},
): Translator {
  const catalog = options.catalog ?? CATALOGS[locale];
  const flat = flattenCatalog(catalog);

  /** key → 模板片段数组（奇数下标是占位符名） */
  const templateCache = new Map<string, string[]>();

  const intlNumber = options.intl?.number ?? new Intl.NumberFormat(locale);
  const intlPercentCache = new Map<number, Intl.NumberFormat>();
  const percentFormatter = (digits: number): Intl.NumberFormat => {
    if (options.intl) return options.intl.percent(digits);
    let f = intlPercentCache.get(digits);
    if (!f) {
      f = new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      intlPercentCache.set(digits, f);
    }
    return f;
  };
  const pluralRules = options.intl?.plural ?? new Intl.PluralRules(locale);

  const t = (key: string, params?: MessageParams): string => {
    const template = flat.get(key);
    if (template === undefined) {
      // 开发者错误：用英文。生产环境理论上不可达（key 是编译期类型）。
      throw new Error(`missing i18n key: ${key} (locale ${locale})`);
    }

    if (!params) return template;

    // 无占位符的模板直接返回，避免正则开销（热路径）
    if (!template.includes('{')) return template;

    let parts = templateCache.get(key);
    if (!parts) {
      parts = template.split(PLACEHOLDER_RE);
      templateCache.set(key, parts);
    }

    let result = '';
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] ?? '';
      if (i % 2 === 0) {
        result += part;
        continue;
      }
      const value = params[part];
      if (value === undefined) {
        // 不静默留下 {placeholder} —— 那会让玩家看到原始模板
        throw new Error(`missing i18n param "${part}" for key ${key}`);
      }
      result += typeof value === 'number' ? intlNumber.format(value) : value;
    }
    return result;
  };

  return {
    locale,
    t,
    size: flat.size,

    number(value: number): string {
      return intlNumber.format(value);
    },

    percent(value: number, options = {}): string {
      const { digits = 1, signed = false } = options;
      const formatted = percentFormatter(digits).format(value);
      return signed && value > 0 ? `+${formatted}` : formatted;
    },

    duration(ms: number): string {
      // 规则：保留一位小数直到 60 秒（玩家关心"还剩 12.5 秒"），
      // 超过 1 分钟改用 m/s，且秒数补零对齐。
      const seconds = ms / 1000;
      if (seconds < 60) return `${seconds.toFixed(1)}s`;
      const minutes = Math.floor(seconds / 60);
      const rest = Math.floor(seconds % 60);
      return `${minutes}m${rest.toString().padStart(2, '0')}s`;
    },

    plural(forms, count): string {
      const category = pluralRules.select(count);
      const key = category === 'one' ? forms.one : forms.other;
      return t(key, { count });
    },
  };
}

/** 默认翻译器（中文）。UI 层直接用它，除非以后有语言切换。 */
export const translator = createTranslator();
