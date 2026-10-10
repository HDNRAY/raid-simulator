/**
 * **设置界面的键盘接线**（`Esc` / `,` / `↑` / `Enter`）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 它自成一体的一个小状态机（`settingsFocused` + "弹窗打开时独占键盘"），
 * 与战斗、备战都没有交集。抽出来之后 `main.ts` 的装配只剩"接线一行"，
 * 而这段的按键规则能在一处看全。
 *
 * ==================================================================
 * ⚠️ 必须用**捕获阶段**
 * ==================================================================
 *
 * 输入层也监听 `keydown`。若用冒泡阶段，按 `,` 会先被当成技能放出去、
 * 方向键会被战斗吃掉 —— 所以这里注册时传 `true`（捕获），保证设置优先。
 *
 * ⚠️ 弹窗打开时它**独占键盘**：`handlingKeyDown` 标记让输入层知道"这次
 * 按键是给弹窗的"，否则改键那一次按键会同时被两边处理（技能真的放出去）。
 */

/** 接线需要的依赖。 */
export interface SettingsKeyTargets {
  readonly settings: { handleKey(key: string): boolean };
  readonly settingsButton: {
    setFocused(focused: boolean): void;
  };
  settingsOpen(): boolean;
  /** 打开设置（`tab` 固定为按键页 —— 这是本作的默认入口）。 */
  openSettings(): void;
  /** 标记"正由设置处理这次按键"，输入层据此跳过。 */
  setHandling(value: boolean): void;
}

/**
 * 装上设置的键盘监听。
 *
 * @returns 卸载函数。
 */
export function wireSettingsKeys(t: SettingsKeyTargets): () => void {
  /**
   * 键盘焦点是否在设置按钮上（`↑` 提上去、`↓` 退下来、`Enter` 打开）。
   * 它是这个模块**唯一**的持久状态。
   */
  let focused = false;

  const setFocused = (value: boolean): void => {
    focused = value;
    t.settingsButton.setFocused(value);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();

    /** 弹窗打开：整块交给它，并标记"这次按键归设置"。 */
    if (t.settingsOpen()) {
      t.setHandling(true);
      try {
        // 捕获模式下输入层会独占键盘（见 `InputSource.capture`），
        // 所以这里只需要把按键交给弹窗
        if (t.settings.handleKey(key)) event.preventDefault();
      } finally {
        t.setHandling(false);
      }
      return;
    }

    /** 战斗中：`↑` 把焦点提到设置按钮，再 Enter 打开。 */
    if (key === 'arrowup') {
      setFocused(true);
      event.preventDefault();
      return;
    }
    /**
     * **Esc 直接打开设置**（需求）。
     *
     * 顺带暂停 —— `openSettings` 里会 `setPaused(true)`。
     * 旧行为是"Esc 切换暂停"，但那让玩家要先暂停、再按 `,` 才能进设置，
     * 多一次操作；而且常见游戏习惯就是 Esc 进设置。
     */
    if (key === 'escape') {
      t.openSettings();
      event.preventDefault();
      return;
    }
    if (key === 'arrowdown') {
      if (focused) {
        setFocused(false);
        event.preventDefault();
      }
      return;
    }
    if (key === 'enter' && focused) {
      setFocused(false);
      t.openSettings();
      event.preventDefault();
      return;
    }
    /**
     * `,` 单键直达。
     *
     * 用 `event.code` 而不是 `event.key` 判断 —— `,` 在中文输入法下可能
     * 给出全角字符，而物理键位是稳定的。
     */
    if (event.code === 'Comma') {
      t.openSettings();
      event.preventDefault();
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
