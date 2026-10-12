/**
 * **键名怎么显示** 与 **助记键反查**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `ui/settings/logic.ts` 顶到 700 行上限（AGENTS.md §3）。按那里的规则
 * ——**不许靠删/压注释解决，要拆 util 或横向切割**——所以把"键名"这一撮
 * 横向切出来：它们只依赖字符串与 `MNEMONIC_KEYS` 表，与焦点/命中/改键
 * 那几块没有交集。
 *
 * ⚠️ 这段里的注释是**内容**，不是填充物：它记录了"为什么键名不进 i18n"
 * 这类踩过的坑。抽取时**整段搬过来**，不要留摘要。
 */

import type { KeyAction } from './logic';

/** 空键位的表示（未绑定）。 */
export const EMPTY_KEY = '';

/* ------------------------------------------------------------------ *
 * 键名显示
 * ------------------------------------------------------------------ */

/**
 * 键名怎么显示。
 *
 * 单字符大写（`q` → `Q`，与技能栏上的提示一致）；
 * 组合键原样保留（`shift+1` 全大写会读成 `SHIFT+1`，太吵）。
 */
export function keyLabel(key: string, unboundText: string): string {
  if (key === EMPTY_KEY) return unboundText;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * 助记键表（需求给定的三个字母 + UI 缩放）。
 *
 * ⚠️ 类型从 `./logic` 取 —— 那只是**类型**（编译期擦除，不参与运行期
 * 初始化），所以不构成循环依赖。搬运行时值过来才会成环。
 */
export const MNEMONIC_KEYS: Readonly<Record<string, KeyAction>> = {
  g: { kind: 'mnemonic', target: 'tabGeneral' },
  k: { kind: 'mnemonic', target: 'tabKeys' },
  // 「触屏」页（`T` 取自"触屏/Touch"）—— 与 `K` 同一套直达语义
  t: { kind: 'mnemonic', target: 'tabTouch' },
  r: { kind: 'mnemonic', target: 'resetKeys' },
  // UI 缩放：需求要求它也能用键盘直达，而不只是 Tab 遍历
  s: { kind: 'mnemonic', target: 'slider' },
};

/**
 * 某个助记目标的**实际按键**（`tabGeneral` → `'G'`）。
 *
 * ⚠️ 从 `MNEMONIC_KEYS` **反查**，不要在文案或渲染处写死 ——
 * 助记键是运行期可变的，写死会让标签与实际能按的键不一致。
 * 需求："改快捷键 害得改 i18n吗？" —— 所以键名**不进 i18n**。
 */
export function mnemonicKeyOf(
  target: 'tabGeneral' | 'tabKeys' | 'tabTouch' | 'resetKeys' | 'slider',
): string | undefined {
  for (const [key, action] of Object.entries(MNEMONIC_KEYS)) {
    if (action.kind === 'mnemonic' && action.target === target) return key.toUpperCase();
  }
  return undefined;
}

/**
 * 「触屏」页上**放上 / 取下**一个按钮的动作键。
 *
 * ⚠️ 它是一张**键位表**（和 `MNEMONIC_KEYS` 同类），不是文案：
 * `settings.touchHint` 只写"点一下技能格放上 / 取下"这半句，键名由渲染层
 * 从这里**反查后拼**上去（AGENTS.md §3b："键位提示不能放进 i18n"）。
 * 改键时只动这里，不必碰语言包。
 *
 * `label` 与 `key` 分开：`' '` 的键名显然是"空格"，直接显示一个空格
 * 没人看得懂。
 *
 * ⚠️ 这两个键必须真的被 `resolveKeyAction` 当成 `activate`
 * （`logic.ts` 里 `enter` / `' '` 那条），否则提示在骗人 ——
 * 单测里有这条断言。
 */
export const TOUCH_TOGGLE_KEYS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'enter', label: 'Enter' },
  { key: ' ', label: 'Space' },
];

/** 动作键提示（`'Enter / Space'`）—— 由渲染层拼，不进 i18n。 */
export function touchToggleKeyHint(): string {
  return TOUCH_TOGGLE_KEYS.map((k) => k.label).join(' / ');
}

