/**
 * 文案类型推导。
 *
 * 从**基准语言**（zh-CN）推导出 key 的联合类型，于是
 * `t('stat.strenght')` 这种拼写错误在**编译期**就报错，
 * 而不是运行时显示 `stat.strenght` 给玩家看。
 *
 * 这是"i18n 强制"里唯一需要类型体操的地方，但收益很大：
 * 内容数据里的 `nameKey` / `descKey` / `sourceKey` 都是这个联合类型，
 * 所以写错一个字母就编译不过。
 */

import type { zhCN } from './locales/zh-CN';

/** 语言包对象（当前只有中文）。 */
export type Catalog = typeof zhCN;

/**
 * 把嵌套对象扁平化成点分路径的联合类型。
 *
 * 只对 `string` 叶子取值，所以像 `as const` 带来的 readonly 与字面量
 * 都不会干扰结果。
 */
type FlattenKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends object
      ? FlattenKeys<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

/** 所有合法的文案 key。拼错会在编译期被拒。 */
export type MessageKey = FlattenKeys<Catalog>;

/**
 * 文案 key 的命名空间（第一段）。
 *
 * 内容校验器用它来检查 "entity.entropyClock.* 存在但 id 不匹配" 这类问题
 * （i18n 规范 §6 的 KEY_ID_MISMATCH）。
 */
export type MessageDomain = MessageKey extends `${infer D}.${string}` ? D : never;

/**
 * 从内容 id 推导文案 key 的 subject 段。
 *
 * 规则（i18n 规范 §5）：`'entropy-clock'` → `'entropyClock'`。
 * 这是内容校验器能自动检查 key 与 id 对应的前提，
 * 所以实现在这里（类型层之外，运行时要能调用）。
 */
export function idToSubject(id: string): string {
  const parts = id.split(/[-_\s]+/).filter((part) => part.length > 0);
  return parts
    .map((part, index) => {
      // 首个词一律小写；后续词首字母大写。
      const lower = part.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}
