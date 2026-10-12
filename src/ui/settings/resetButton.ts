/**
 * **「恢复默认」到底恢复什么** —— 一个纯函数，判据只有"是不是触屏"。
 *
 * ==================================================================
 * 用户 2026-10-12 定案
 * ==================================================================
 *
 * 原话："**恢复默认和触屏默认 同一时间显示一个按钮就可以了，
 * 根据当前是否是触屏**。"
 *
 * 所以底部**只有一个**按钮：
 *
 *   | 设备 | 按钮文案（i18n key） | 恢复的内容            |
 *   |---|---|---|
 *   | 非触屏 | `settings.keysReset`  | 键盘键位（`onResetKeys`）|
 *   | 触屏   | `settings.touchReset` | 触屏键位（`onResetTouchButtons`）|
 *
 * ⚠️ **能力探测不看 UA**（AGENTS.md §3b）：`touch` 来自
 * `render/platform.detectBrowserPlatform()`（`matchMedia('(pointer: coarse)')`
 * + `(hover: none)`），由 `app/settingsSetup` 透传进来 —— 这里**不**自己
 * 再探测一次（那就是第二份判据）。
 *
 * ⚠️ 两个功能**都还在**，只是不再同时出现两个按钮。所以 i18n 里
 * `keysReset` 与 `touchReset` **两条 key 都留着**，由渲染层按设备选一条
 * —— 一个按钮不该有两套文案同时出现在同一个位置。
 *
 * ==================================================================
 * ⚠️ 触屏笔记本只剩触屏恢复（已知后果，用户接受）
 * ==================================================================
 *
 * 触屏笔记本两种输入都有，而 `platform.touch` 对它是 **true** —— 于是
 * 这个按钮恢复的是**触屏键位**，键盘键位在那种设备上恢复不了
 * （除非改 `localStorage` 或换个非触屏设备）。
 *
 * 这是按用户那条要求**直接推出来**的（"根据当前是否是触屏"），不是实现
 * 走偏；`touchCapsSource` 里两个能力值当前也确实是反相关的
 * （见 `render/platform.detectPlatform`）。真要给这类设备留出口，加一个
 * "恢复全部"或让按钮长按切目标即可 —— 但那是新需求，不要顺手加。
 */

/** 「恢复默认」的目标。 */
export type ResetTarget =
  /** 恢复**键盘**键位（非触屏设备）。 */
  | 'keys'
  /** 恢复**触屏**键位（触屏设备）。 */
  | 'touch';

/**
 * 当前设备下，那个唯一的「恢复默认」按钮该恢复什么。
 *
 * @param touch 是不是触屏设备（`render/platform.PlatformCaps.touch`）
 */
export function resetTargetFor(touch: boolean): ResetTarget {
  return touch ? 'touch' : 'keys';
}

/** 目标对应的 i18n key（渲染层拼按钮文案用 —— 文案本身仍在语言包里）。 */
export function resetLabelKey(target: ResetTarget): 'settings.keysReset' | 'settings.touchReset' {
  return target === 'touch' ? 'settings.touchReset' : 'settings.keysReset';
}

/**
 * 目标对应的**通知文案** key（"已恢复默认键位" / "已恢复默认触屏键位"）。
 *
 * ⚠️ 与按钮文案分开：那是按钮上的字，这是操作完之后的反馈 —— 两者可以
 * 不同（也确实不同），合成一条会在界面上说出奇怪的话。
 */
export function resetDoneKey(target: ResetTarget): 'settings.keysResetDone' | 'settings.touchResetDone' {
  return target === 'touch' ? 'settings.touchResetDone' : 'settings.keysResetDone';
}
