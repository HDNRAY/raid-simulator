import { describe, expect, it } from 'vitest';
import { normalizeKey, reservedKeyLabel } from '../../src/input/keyboard';
import { KEY_EDIT_KEYS } from '../../src/ui/settings/keyNames';

/**
 * ==================================================================
 * 键名口径：**只用 `event.key`**，不用 `keyCode`、也不用 `code`
 * ==================================================================
 *
 * 用户 2026-10-12 定的（原话）："**用 key 不是 keycode 也不是 code**"。
 *
 *   - `keyCode` 是废弃的数字码
 *   - `code` 是**物理位置**（`KeyQ` / `Digit1`）—— 非 QWERTY 布局上会把
 *     "玩家按的字符"与"绑定的字符"错开
 *   - `key` 才是**语义键名**
 *
 * ⚠️ 这两条都是**回归测试**：旧实现用 `event.code.startsWith('Digit')`
 * 折数字键，用 `charAt(0).toUpperCase()` 拼 `Escape`。
 */
describe('键名归一化：只认 `event.key`', () => {
  it('语义键名原样小写（`Escape` / `ArrowUp` / `F1`）', () => {
    expect(normalizeKey({ key: 'Escape' })).toBe('escape');
    expect(normalizeKey({ key: 'ArrowUp' })).toBe('arrowup');
    expect(normalizeKey({ key: 'Enter' })).toBe('enter');
    expect(normalizeKey({ key: 'F1' })).toBe('f1');
  });

  it('字母大小写归一（`Q` 与 `q` 是同一个键）', () => {
    expect(normalizeKey({ key: 'Q' })).toBe('q');
    expect(normalizeKey({ key: 'q' })).toBe('q');
  });

  it('【关键】Shift+数字折回数字键（不靠 `event.code`）', () => {
    /**
     * 旧实现：`event.code.startsWith('Digit')` → `code.slice(5)`。
     * 现在只有 `key`：`Shift+1` 给的是 `'!'`，靠 `SHIFTED_TO_BASE` 折回。
     */
    expect(normalizeKey({ key: '!', shiftKey: true })).toBe('1');
    expect(normalizeKey({ key: '@', shiftKey: true })).toBe('2');
    expect(normalizeKey({ key: '1', shiftKey: false })).toBe('1');
    /** 折回之后**不再**加 `shift` 前缀 —— 同一个动作只该有一个键名。 */
    expect(normalizeKey({ key: '!', shiftKey: true })).not.toContain('shift');
  });

  it('【关键】归一化**完全不看** `code`（传了也不影响结果）', () => {
    /**
     * 这条是"用 key 不用 code"的**硬判据**：喂一个与 `key` 矛盾的 `code`
     * （模拟非 QWERTY 布局上"物理位置 ≠ 字符"），结果必须只跟 `key` 走。
     *
     * ⚠️ `normalizeKey` 的参数类型里已经没有 `code` 了 —— 所以这里用
     * **有名字的解构**把"多出来的那份数据"显式丢掉，而不是绕过类型检查：
     * 结构类型允许传多余属性，函数拿不到它。
     */
    const fromEventLike = (e: { readonly key: string; readonly code: string }): string =>
      normalizeKey({ key: e.key });
    // Dvorak 上按 Q 位置出的是 `'`；玩家绑的是 `'`，不是 `q`
    expect(fromEventLike({ key: "'", code: 'KeyQ' })).toBe("'");
    expect(fromEventLike({ key: 'q', code: 'KeyX' })).toBe('q');
  });

  it('修饰键进前缀（ctrl / meta / alt）', () => {
    expect(normalizeKey({ key: 'q', ctrlKey: true })).toBe('ctrl+q');
    expect(normalizeKey({ key: 'q', metaKey: true })).toBe('meta+q');
    expect(normalizeKey({ key: 'q', altKey: true })).toBe('alt+q');
    expect(normalizeKey({ key: 'q', shiftKey: true })).toBe('shift+q');
  });
});

describe('键名显示：一处映射，`escape` → `Esc`', () => {
  it('`escape` 显示成 **`Esc`**（不是 `Escape`）', () => {
    expect(reservedKeyLabel('escape')).toBe('Esc');
  });

  it('⚠️ 返回按钮用的显示名与设置页那份**同源**（不许自己拼）', () => {
    /**
     * `ScreenChrome` 的 `ESC_SHORTCUT` 取的就是 `KEY_EDIT_KEYS.cancel.label`；
     * 这里钉住它与 `reservedKeyLabel('escape')` 一致 —— 两者若漂开，
     * 返回按钮与设置页的 `Esc` 又会变成两个写法（用户报过的那个 bug）。
     */
    expect(KEY_EDIT_KEYS.cancel.label).toBe(reservedKeyLabel(KEY_EDIT_KEYS.cancel.key));
  });

  it('其它保留键的可读名字不变', () => {
    expect(reservedKeyLabel('tab')).toBe('Tab');
    expect(reservedKeyLabel('enter')).toBe('Enter');
    expect(reservedKeyLabel('f1')).toBe('F1–F12');
  });
});
