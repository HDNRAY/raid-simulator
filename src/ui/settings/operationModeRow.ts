/**
 * 「通用」页那个**操作方式**选择器（键盘 / 触屏）的纯逻辑 —— 顺序与文案。
 *
 * ==================================================================
 * 这是唯一 flag 的**用户入口**
 * ==================================================================
 *
 * 用户 2026-10-12 定案："**不用自动判断，由入口显式传**"，并且接受
 * "真手机第一次进来默认是键盘界面，要用户自己切"。
 *
 * 所以这个选择器不是"顺手加的开关"，而是 `OperationMode` 的**唯一**
 * 人工写入点（另一处是 `?touch=1/0` 的强制覆盖）：
 *
 *   ```
 *   ?touch=1 / ?touch=0    覆盖（截图验证 / 用户自救）
 *   「通用」页这个选择器    ← 写进存档，刷新后还记得
 *   默认                    keyboard
 *   ```
 *
 * ⚠️ 顺序（`keyboard` 在前）**只有这一处**：命中测试（`logic.operationModeRect`
 * 的下标）与绘制（`ModeSwitch`）都从 `OPERATION_MODE_ORDER` 取 ——
 * 各写一遍三元表达式就是"点左边的按钮、亮右边那个"这类错位。
 *
 * ⚠️ 文案 key 在这里映射（渲染层不硬编码可显示文字 —— i18n 规范 I1）。
 */

import type { OperationMode } from '../../render/platform';

/**
 * 选择器里从左到右的顺序。
 *
 * ⚠️ 第一位是**默认值**（`resolveOperationMode` 的兜底），顺序即"默认在
 * 左边"—— 用户切错方向时最省事的那一侧。
 */
export const OPERATION_MODE_ORDER: readonly OperationMode[] = ['keyboard', 'touch'];

/** 第 `index` 个位置上是哪种方式（越界给 `undefined` —— 不猜）。 */
export function operationModeAt(index: number): OperationMode | undefined {
  return OPERATION_MODE_ORDER[index];
}

/** 这种方式在按钮上的文案 key。 */
export function operationModeLabelKey(
  mode: OperationMode,
): 'settings.modeKeyboard' | 'settings.modeTouch' {
  return mode === 'keyboard' ? 'settings.modeKeyboard' : 'settings.modeTouch';
}

/** 这种方式在存档里的值（与 `OperationMode` 字面量一致 —— 存的就是它）。 */
export function operationModeStorageValue(mode: OperationMode): string {
  return mode;
}
