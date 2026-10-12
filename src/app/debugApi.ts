/**
 * **调试入口的两块**（`window.__raidBattle.prepare` / `.settings`）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 它们的成员都是"转调界面自己的方法"，几十行样板；留在 `main.ts`
 * （已经很长的装配文件）里会把装配流水账冲淡。抽出来之后：
 *   - `main.ts` 只写一行 `...settingsDebugApi(settings)` / `...prepareDebugApi(prepare)`
 *   - 这两个入口的**存在理由**（为什么 headless 下必须读状态而不是看图）
 *     集中在一处，而不是散在装配代码中间
 *
 * ⚠️ 它们**不另写一套逻辑**：每个方法都直接转调界面自己的方法
 * （与键盘 / 点击同一条路径）。旁路会掩盖真 bug —— 例如"方向键只移动
 * 光标"这条需求，如果调试入口自己改状态，那验证的就是调试入口而不是界面。
 */

/**
 * ⚠️ tab 用 `SettingsTab` 而不是 `'general' | 'keys'` 字面量：面板现在有
 * **三个** tab（加了「触屏」），写死两个字面量会让调试入口打不开第三页
 * —— 而"验证脚本进不去"正是这次要修的那类问题。
 *
 * 类型从 `ui/settings/logic` 取（**类型**，编译期擦除，不构成运行期依赖）。
 */
import type { SettingsTab } from '../ui/settings/tabs';

/** 备战界面暴露给调试的最小面（`PrepareScreen` 满足它）。 */
export interface PrepareDebugTarget {
  current: {
    readonly playerId: string;
    readonly bossId: string;
    readonly focus: 'player' | 'boss' | 'start';
    readonly cursor: { readonly playerId: string; readonly bossId: string };
  };
  cycle(delta: number): void;
  moveFocus(delta: number, wrap?: boolean): void;
  confirm(): void;
  pick(kind: 'player' | 'boss', id: string): void;
  focusSlot(slot: 'player' | 'boss' | 'start'): void;
}

/**
 * 备战界面的调试入口。
 *
 * 需求（用户）："选中 和 目前光标 目前颜色是一样的" → 改完之后
 * "光标与选择可以分离"。**这条不能只靠截图验证**：画面上的区别是颜色，
 * 而"白框在哪张卡 / 金底在哪张卡"读取状态才是硬证据（截图只用来确认
 * "确实看得出区别"）。
 *
 * ⚠️ `state()` 返回**拷贝**：调用方（验证脚本）拿到的对象若与内部共享，
 * 它自己改一下就会把界面状态改坏 —— 调试入口不该有写穿的能力。
 */
export function prepareDebugApi(prepare: PrepareDebugTarget): {
  readonly prepare: {
    state(): PrepareDebugTarget['current'];
    cycle(delta: number): void;
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(): void;
    pick(kind: 'player' | 'boss', id: string): void;
    focusSlot(slot: 'player' | 'boss' | 'start'): void;
  };
} {
  const copy = (): PrepareDebugTarget['current'] => ({
    playerId: prepare.current.playerId,
    bossId: prepare.current.bossId,
    focus: prepare.current.focus,
    cursor: { ...prepare.current.cursor },
  });
  return {
    prepare: {
      /** 当前选择 + 光标（两者分离时能一眼看出差别）。 */
      state: copy,
      /** 同 ← →：**只移动光标**，不改选择。 */
      cycle: (delta) => prepare.cycle(delta),
      /** 同 ↑ ↓（`wrap` = Tab / Shift+Tab：可见地环绕）。 */
      moveFocus: (delta, wrap = false) => prepare.moveFocus(delta, wrap),
      /** 同 Enter：确定光标处那一项（光标在「开始战斗」上则开战）。 */
      confirm: () => prepare.confirm(),
      /** 同点击卡片：移光标 + 确定（一步到位）。 */
      pick: (kind, id) => prepare.pick(kind, id),
      /**
       * 只把**焦点**换到某个槽位（同 Tab 到达那里的状态）。
       *
       * 截图脚本用它一步摆出"光标在这一行、选择在另一行"，省掉
       * "按几次方向键"这种一改布局就失效的脆弱脚本。
       */
      focusSlot: (slot) => prepare.focusSlot(slot),
    },
  };
}

/** 首页暴露给调试的最小面（`HomeScreen` 满足它）。 */
export interface HomeDebugTarget {
  readonly current: { readonly cursor: number };
  moveFocus(delta: number, wrap?: boolean): void;
  confirm(): void;
}

/**
 * 首页的调试入口。
 *
 * 与 `prepareDebugApi` 同源的两条理由：
 *   1. headless 下模拟点击不可靠（rAF 被降频、CSS 缩放 → 逻辑坐标依赖
 *      真实布局），截图脚本需要"把界面推到某个状态再拍"
 *   2. 每个方法都**转调界面自己的方法**（同键盘 / 同点击），不另写一套 ——
 *      旁路会掩盖真 bug（验证的会是调试入口而不是界面）
 *
 * ⚠️ `state()` 返回**拷贝**：调试入口不该有写穿界面的能力。
 */
export function homeDebugApi(home: HomeDebugTarget): {
  readonly home: {
    state(): { readonly cursor: number };
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(): void;
  };
} {
  return {
    home: {
      /** 光标停在第几个入口（0 = 肉鸽模式，1 = 自由模式）。 */
      state: () => ({ cursor: home.current.cursor }),
      /** 同 ↑ ↓（`wrap` = Tab / Shift+Tab）。 */
      moveFocus: (delta, wrap = false) => home.moveFocus(delta, wrap),
      /** 同 Enter：进入光标处的模式（会真的切界面）。 */
      confirm: () => home.confirm(),
    },
  };
}

/** 选角色屏暴露给调试的最小面（`CharacterSelectScreen` 满足它）。 */
export interface CharacterSelectDebugTarget {
  readonly current: PrepareDebugTarget['current'];
  cycle(delta: number): void;
  confirm(): void;
  pick(id: string): void;
}

/**
 * 选角色屏的调试入口。
 *
 * ⚠️ `state()` 的形状与备战界面**同一个**（`PrepareDebugTarget['current']`）：
 * 两个界面用的是同一套光标模型，调试脚本因此可以复用同一段读状态的代码。
 * 选角色屏的 `bossId` 恒为空串（没有对手槽位，见 `characterSelectLogic`）。
 */
export function characterSelectDebugApi(select: CharacterSelectDebugTarget): {
  readonly characterSelect: {
    state(): PrepareDebugTarget['current'];
    cycle(delta: number): void;
    confirm(): void;
    pick(id: string): void;
  };
} {
  const copy = (): PrepareDebugTarget['current'] => ({
    playerId: select.current.playerId,
    bossId: select.current.bossId,
    focus: select.current.focus,
    cursor: { ...select.current.cursor },
  });
  return {
    characterSelect: {
      /** 当前已确定的角色 + 光标（两者分离时能一眼看出差别）。 */
      state: copy,
      /** 同 ← →：**只移动光标**，不改已确定的角色。 */
      cycle: (delta) => select.cycle(delta),
      /** 同 Enter：确定光标处的角色；能开始就开始一局（会真的进战斗）。 */
      confirm: () => select.confirm(),
      /** 同点击卡片：移光标 + 确定 + 开始（一步到位）。 */
      pick: (id) => select.pick(id),
    },
  };
}

/** 设置面板暴露给调试的最小面（`SettingsPanel` 满足它）。 */
export interface SettingsDebugTarget {
  readonly capturingSkillId: string | undefined;
  readonly focusState: { readonly zone: string; readonly index?: number };
  readonly settingsTrace: readonly string[];
  hitTest(px: number, py: number): boolean;
  /**
   * 第 `index` 个**技能格**的圆心（逻辑坐标）—— 验证脚本注入真实点击用。
   *
   * ⚠️ 脚本**不许自己复制一份 `keyCellRect`**：布局一调，脚本会静默失效
   * （"点空了"看起来和"功能坏了"一模一样）。与 `touchButtonCenter`
   * 同一个理由。
   */
  cellCenter(index: number): { readonly x: number; readonly y: number };
  /**
   * 右下角第 `index` 个**键位**的圆心（逻辑坐标，`undefined` = 越界）。
   *
   * ⚠️ 同上：它来自预览自己的几何（也就是 `touchGeometry` 的双弧等比变换），
   * 脚本复制一份必然与实际漂开。
   */
  slotCenter(index: number): { readonly x: number; readonly y: number } | undefined;
}

/** 设置**按钮**暴露给调试的最小面（`SettingsButton` 满足它）。 */
export interface SettingsButtonDebugTarget {
  setFocused(focused: boolean): void;
  /** 键盘焦点是否在齿轮上（`↑` 那条路的状态）。 */
  isFocused: boolean;
  update(): void;
}

/**
 * 设置界面的调试入口。
 *
 * 存在的理由（原先写在 `main.ts` 里，随代码一起搬过来）：
 * headless 环境下模拟鼠标点击不可靠（rAF 会被降频，而且 CSS 缩放 →
 * 逻辑坐标的换算依赖真实布局），这个入口让验证脚本能直接把界面推到
 * 某个状态再截图。
 *
 * ⚠️ 两个参数都是**取值函数**而不是对象：设置面板与它的开关在
 * `main.ts` 里构造得比 `window.__raidBattle` 更晚（那里是装配顺序：
 * 面板要用到触屏层的能力值）。直接传引用会撞 TDZ；传取值函数则
 * "用的时候才去拿"，与 `restart` / `touchButtonCenter` 那几条
 * 延后转调是同一个处理方式。
 */
export function settingsDebugApi(
  getSettings: () => SettingsDebugTarget,
  getToggle: () => {
    readonly open: (tab: SettingsTab) => void;
    readonly close: () => void;
    readonly isOpen: () => boolean;
  },
  getButton: () => SettingsButtonDebugTarget,
): {
  readonly settings: {
    open(tab?: SettingsTab): void;
    close(): void;
    openIn(px: number, py: number): void;
    isOpen(): boolean;
    capturing(): string | undefined;
    focus(): { readonly zone: string; readonly index?: number };
    /** 第 `index` 个技能格的圆心（验证脚本注入真实点击用）。 */
    cellCenter(index: number): { readonly x: number; readonly y: number };
    /** 右下角第 `index` 个键位的圆心（越界为 `null`）。 */
    slotCenter(index: number): { readonly x: number; readonly y: number } | null;
    trace(): readonly string[];
    /**
     * 把**齿轮按钮**的键盘焦点打开/关掉，并立刻重绘一次。
     *
     * 为什么需要：`↑`（或 `,` 悬停）是被逐帧循环重绘的，而 headless 下
     * 这局战斗 3.5 秒就结束了 —— 之后没有帧，任何"聚焦后的外观"都拍不到。
     * 这个入口让验证脚本能把按钮推到聚焦态并**在同一个 tick 里**画出来。
     *
     * ⚠️ 它改的就是按钮自己的状态（同 `↑` 那条路），不是另画一个样子。
     */
    setButtonFocused(focused: boolean): void;
    /** 齿轮按钮此刻是否持有键盘焦点。 */
    buttonFocused(): boolean;
  };
} {
  return {
    settings: {
      open: (tab = 'keys') => getToggle().open(tab),
      close: () => getToggle().close(),
      openIn: (px, py) => getSettings().hitTest(px, py),
      isOpen: () => getToggle().isOpen(),
      /** 正在等待按键改键的技能 id（没有则为 null）。 */
      capturing: () => getSettings().capturingSkillId,
      /** 当前键盘焦点（调试用）。 */
      focus: () => ({ ...getSettings().focusState }),
      /** 第 `index` 个技能格的圆心（真实点击的注入坐标）。 */
      cellCenter: (index) => ({ ...getSettings().cellCenter(index) }),
      /** 第 `index` 个键位的圆心（没有则 null）。 */
      slotCenter: (index) => getSettings().slotCenter(index) ?? null,
      trace: () => [...getSettings().settingsTrace],
      setButtonFocused: (focused) => {
        const button = getButton();
        button.setFocused(focused);
        /** 立即重绘（正常路径由主循环每帧调，headless 下可能没有下一帧）。 */
        button.update();
      },
      buttonFocused: () => getButton().isFocused,
    },
  };
}
