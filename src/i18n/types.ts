/**
 * 文案类型推导。
 *
 * 从**基准语言**（zh-CN）推导出 key 的联合类型，于是
 * `t('stat.strenght')` 这种拼写错误在**编译期**就报错，
 * 而不是运行时把 `stat.strenght` 显示给玩家。
 *
 * 分层说明（这一点被 lint 约束逼着想过一次）：
 *   - `core/types.ts` 自己定义 `LocaleKey = string`，因为它**持有** key
 *     但不需要知道 key 的具体集合（引擎不解析文案）。
 *   - 这里定义 `MessageKey` = 全部合法 key 的联合，
 *     并用下面的编译期断言证明它满足 `core` 的 `LocaleKey`。
 *   - 内容数据（`data/`）用 `MessageKey` 标注，于是写错 key 编译不过。
 *
 * 换句话说：**接口形状由消费者声明，实现方证明自己满足。**
 */

import type { LocaleKey } from '../core/types';
import type { zhCN } from './locales/zh-CN';

/** 语言包对象（当前只有中文）。 */
export type Catalog = typeof zhCN;

/**
 * 把嵌套对象扁平化成点分路径的联合类型。
 *
 * 只对 `string` 叶子取值，所以 `as const` 带来的 readonly
 * 与字面量类型都不会干扰结果。
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
 * 编译期断言：`MessageKey` 必须满足 `core` 对 key 的接口要求。
 *
 * 如果哪天 `core` 把 `LocaleKey` 收紧成别的形状（例如加品牌类型），
 * 这一行会编译失败 —— 而不是等到某处运行时才发现。
 *
 * 用 `never` 泛型约束而不是赋值语句，是为了让它**只存在于类型层**，
 * 不产生任何运行时开销与"未使用变量"的噪音。
 */
type AssertExtends<A extends B, B> = A;

/**
 * 导出（而不是留成未使用的私有别名）是为了让这个断言**真的被求值**：
 * tsc 的 `noUnusedLocals` 会报未使用的类型别名，而导出即视为使用。
 */
export type MessageKeySatisfiesCore = AssertExtends<MessageKey, LocaleKey>;

/**
 * 文案 key 的命名空间（第一段）。
 *
 * 内容校验器用它检查 "entity.entropyClock.* 存在但 id 不匹配"
 * 这类问题（i18n 规范 §6 的 KEY_ID_MISMATCH）。
 */
export type MessageDomain = MessageKey extends `${infer D}.${string}` ? D : never;

/**
 * 从内容 id 推导文案 key 的 subject 段。
 *
 * 规则（i18n 规范 §5）：`'entropy-clock'` → `'entropyClock'`。
 * 这是"内容校验器能自动检查 key 与 id 对应"的前提。
 */
export function idToSubject(id: string): string {
  const parts = id.split(/[-_\s]+/).filter((part) => part.length > 0);
  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}
