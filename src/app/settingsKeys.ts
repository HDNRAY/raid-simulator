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
  /**
   * 现在是否**允许**用 `↑` 把键盘焦点提到设置按钮。
   *
   * ==================================================================
   * 为什么需要这个开关（踩过的坑）
   * ==================================================================
   *
   * `↑` 原本是"战斗中把焦点提到设置按钮、再 Enter 打开"。但**备战界面
   * 也用 `↑↓` 换槽位**，于是同一次按键被两边处理：光标跳了一行，
   * 设置按钮同时被点亮。
   *
   * 后果不只是"按钮亮了"：焦点一旦落在按钮上（内部 `focused = true`），
   * 之后按 **Enter 会先开设置**而不是确定角色（见下面 `enter && focused`
   * 那条分支）—— 而玩家看到的只是"齿轮不知为何变黄了"。
   * 这正是需求里"设置按钮 有时也会被变黄"的由来之一。
   *
   * 所以把这个流程**限定在它本来服务的界面**：备战界面走 `Esc` / `,`
   * 打开设置（那两条不受影响），`↑` 留给光标。
   */
  acceptsKeyboardFocus(): boolean;
  /** 打开设置（`tab` 固定为按键页 —— 这是本作的默认入口）。 */
  openSettings(): void;
  /** 标记"正由设置处理这次按键"，输入层据此跳过。 */
  setHandling(value: boolean): void;
}

/** `wireSettingsKeys` 的返回值。 */
export interface SettingsKeyHandle {
  /** 卸载监听。 */
  readonly dispose: () => void;
  /**
   * 键盘焦点此刻是否在设置按钮上。
   *
   * ⚠️ **备战界面需要它**：`↑` 在这里被用来"把焦点提到设置按钮"，
   * 而备战界面也用 `↑↓` 换槽位 —— 两边都处理同一次按键，结果是
   * "光标跳了槽位，同时设置按钮亮了"。
   *
   * 优先级：**设置按钮聚焦时，备战不抢键**（否则按 Enter 想开设置，
   * 却把角色选定了）。这和 `settingsOpen()` 挡住备战是同一个道理。
   */
  readonly isButtonFocused: () => boolean;
}

/**
 * 装上设置的键盘监听。
 */
export function wireSettingsKeys(t: SettingsKeyTargets): SettingsKeyHandle {
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
    if (key === 'arrowup' && t.acceptsKeyboardFocus()) {
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
  return {
    dispose: () => window.removeEventListener('keydown', onKeyDown, true),
    isButtonFocused: () => focused,
  };
}
