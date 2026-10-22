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
  /**
   * ⚠️ **`T`（触屏页）已删**（用户 2026-10-12："首页点开的设置，可以不要
   * 按键tab …… 刚说的触屏的按键设置方法，最好集成到 按键tab 里面"）。
   * 触屏键位现在是「按键」页右下角的一块，方向键按下就到（`focus.slots`），
   * 不再需要一个只切 tab 的助记键。
   */
  r: { kind: 'mnemonic', target: 'resetKeys' },
  // UI 缩放：需求要求它也能用键盘直达，而不只是 Tab 遍历
  s: { kind: 'mnemonic', target: 'slider' },
  /**
   * **`M` = 回主菜单**（2026-10-22，用户："回主菜单需要一个快捷键"）。
   * 与其它助记键同一条：键位表是唯一真相，按钮上的 `(M)` 是反查出来的。
   */
  m: { kind: 'mnemonic', target: 'exitToHome' },
};

/**
 * 某个助记目标的**实际按键**（`tabGeneral` → `'G'`）。
 *
 * ⚠️ 从 `MNEMONIC_KEYS` **反查**，不要在文案或渲染处写死 ——
 * 助记键是运行期可变的，写死会让标签与实际能按的键不一致。
 * 需求："改快捷键 害得改 i18n吗？" —— 所以键名**不进 i18n**。
 */
export function mnemonicKeyOf(
  target: 'tabGeneral' | 'tabKeys' | 'resetKeys' | 'slider' | 'exitToHome',
): string | undefined {
  for (const [key, action] of Object.entries(MNEMONIC_KEYS)) {
    if (action.kind === 'mnemonic' && action.target === target) return key.toUpperCase();
  }
  return undefined;
}

/**
 * **触屏键位（右下角模拟键位）用到的键**。
 *
 * ⚠️ 它是一张**键位表**（和 `MNEMONIC_KEYS` 同类），不是文案：
 * `settings.slotHint` 只写"点键位 → 点技能 = 绑定"这半句，键名由渲染层
 * 从这里**反查后拼**上去（AGENTS.md §3b："键位提示不能放进 i18n"）。
 * 改键时只动这里，不必碰语言包；触屏设备上这段提示整个不拼。
 *
 * `label` 与 `key` 分开：方向键要写成 `←→↑↓`（写 `arrowleft` 没人看得懂），
 * 而 `key` 必须是真的能被 `resolveKeyAction` 处理的键名 ——
 * `tests/unit/settingsTouch.test.ts` 里有这条断言，否则提示在骗人。
 */
export const SLOT_NAV_KEYS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'arrowleft', label: '←→↑↓' },
  { key: 'enter', label: 'Enter' },
];

/** 动作键提示（`'←→↑↓ / Enter'`）—— 由渲染层拼，不进 i18n。 */
export function slotNavKeyHint(): string {
  return SLOT_NAV_KEYS.map((k) => k.label).join(' / ');
}

/**
 * 「按键」页**第二行提示**用到的那套键（改键 / 退出捕获）。
 *
 * ⚠️ 与 `SLOT_NAV_KEYS` 分开两张表，因为语义不同：
 *   - `SLOT_NAV_KEYS` 是**触屏键位**那两步交互用的（选择 / 绑定）
 *   - 这一张是**键盘改键**用的（选技能 / 进改键 / 退出）
 * 用户明确要求两者都可能被看到（"不能删，宁可弹窗更大"），所以它们各自
 * 有一行 —— 合成一张表就没法分别拼两句提示了。
 *
 * ⚠️ 同样是**键位表**，不是文案：改键时只动这里，语言包不用碰
 * （AGENTS.md §3b）。`key` 必须是真的能被 `resolveKeyAction` 处理的键名
 * —— `tests/unit/settingsTouch.test.ts` 有这条断言。
 */
export const KEY_EDIT_KEYS = {
  /** 在技能格之间走（`resolveKeyAction` 的 `move`）。 */
  move: { key: 'arrowup', label: '←→↑↓' },
  /** 进改键（`resolveKeyAction` 的 `activate`）。 */
  edit: { key: 'enter', label: 'Enter' },
  /** 退出捕获（`resolveKeyAction` 的 `cancelCapture`）。 */
  cancel: { key: 'escape', label: 'Esc' },
} as const;

/**
 * **第二行提示**的完整键名串：`'←→↑↓ / Enter / Esc'`。
 *
 * ⚠️ 顺序 = `move → edit → cancel`，与玩家实际的按键顺序一致
 * （先选、再改、不行就退）。
 */
export function keyEditKeyHint(): string {
  return [KEY_EDIT_KEYS.move.label, KEY_EDIT_KEYS.edit.label, KEY_EDIT_KEYS.cancel.label].join(' / ');
}

/**
 * 第二行提示的**完整句子**：标签（i18n） + 键名（本表）。
 *
 * ⚠️ 拼在一起的规则**只有这一处**：面板与截图脚本问的都是这个函数。
 * 原先那句 `keysHint`（"方向键选择，Enter 改键，Esc 返回"）整句写在 i18n
 * 里、**含 `Enter` / `Esc`** —— 改键就得改语言包，用户否掉过
 * （"改快捷键 害得改 i18n 吗？"）。
 *
 * ⚠️ `label` 由调用方从 i18n 取（渲染层不许硬编码可显示文案，规范 I1）。
 * 触屏不调它（那时不显示这一行）。
 */
export function keyEditHint(label: string): string {
  return `${label} ${keyEditKeyHint()}`;
}
