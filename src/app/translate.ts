/**
 * **统一的翻译入口**（缺 key 时回退到 key 本身，而不是抛错）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 它原先定义在 `main.ts` 的**末尾**。那是刻意的：`function` 声明会提升，
 * 所以 `SettingsPanel` / `TouchControls` / `BattleLoop` 的构造里都能直接
 * 引用它，而实际调用发生在第一次取词时。
 *
 * ⚠️ 提到模块顶层后**语义一字未变**（模块级函数在装配开始前就已初始化），
 * 但它成了三处装配（battle / settings / touch）共享的东西 —— 正是
 * AGENTS.md §3 里"拆 util"那一类。
 *
 * ⚠️ **必须是这个函数本身，不能套一层 `(key) => translateSafe(key)`** ——
 * 那样会把第二个参数 `params` 吃掉。来龙去脉见下面文件级说明与
 * `battleSetup.ts` 里 `translate: translateSafe` 处的注释。
 */

import { translator } from '../i18n/translator';

/**
 * 统一的翻译入口（缺 key 时回退到 key 本身，而不是抛错）。
 *
 * ⚠️ 签名收得比 `translator.t` 松（`key: string`），所以**不能**直接当
 * `TranslateFn` 传出去 —— 调用方各自按需收窄（见 `settingsSetup` 里
 * `buildSettingsOptions` 的 `TranslateFn` 与 `BattleScene` 构造处的
 * 那个内联箭头）。
 */
export function translateSafe(
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  try {
    return translator.t(
      key as Parameters<typeof translator.t>[0],
      params as Parameters<typeof translator.t>[1],
    );
  } catch {
    return key;
  }
}
