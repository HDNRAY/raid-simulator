/**
 * 全局扩展。
 *
 * 刻意把调试探针声明成 `| undefined`，强制调用方判空 ——
 * 生产构建里这段可能不存在。
 */
declare global {
  interface Window {
    /** 战斗探针：验证"战斗真的在推进" */
    __raidBattle?: {
      /**
       * 直接注入一个动作（调试用）。
       *
       * 存在的理由：headless 环境下 rAF 会被降频，所以"按键 → 等技能进冷却"
       * 这条路在自动验证里不可靠。这个入口让验证脚本能精确地把游戏推到
       * 某个状态（例如"某个技能正在冷却"）再截图。
       */
      act(skillId: string, actorId?: string): void;
      /**
       * 当前键位表（顶层探针）。
       *
       * 端到端脚本用它来"按某个技能"，而不是把键位写死在脚本里。
       */
      bindings(): readonly { readonly key: string; readonly skillId: string }[];
      /** 设定 UI 缩放（端到端脚本用） */
      setUiScale(value: number): void;
      /**
       * 重开一局（端到端脚本用）。
       *
       * ⚠️ 触屏 e2e 必须验证"重开之后触屏仍然生效"——那正是
       * "重开后触屏永久失效"那个 bug 的形态。没有这个入口，脚本只能
       * 等玩家被打死（~11 秒）才能触发重开。
       */
      restart(): void;
      /**
       * 触屏按钮的圆心（端到端脚本用；按 `skillId` 反查）。
       *
       * ⚠️ 让脚本问页面要几何，而不是复制一份 —— 否则布局一调，
       * 触屏测试就会静默失效。
       */
      touchButtonCenter(skillId: string): { readonly x: number; readonly y: number } | null;
      /** Pixi 根容器（调试用：读取渲染层实际写入的文本） */
      stage: unknown;
      /** 设置界面（调试用：headless 下模拟点击不可靠） */
      settings: {
        open(tab?: 'general' | 'keys'): void;
        close(): void;
        /** 用逻辑坐标点一下（验证命中测试与布局一致） */
        openIn(px: number, py: number): void;
        isOpen(): boolean;
        capturing(): string | undefined;
        focus(): { readonly zone: string; readonly index?: number };
        trace(): readonly string[];
        /**
         * 打开/关掉**齿轮按钮**的键盘焦点并立刻重绘（截图用）。
         *
         * 存在的理由：按钮由主循环逐帧重绘，而 headless 下这局战斗
         * 3.5 秒就结束，之后没有帧 —— 聚焦后的外观拍不到。
         */
        setButtonFocused(focused: boolean): void;
        /** 齿轮按钮此刻是否持有键盘焦点。 */
        buttonFocused(): boolean;
      };
      probe(): {
        tick: number;
        status: string;
        playerHp: number;
        playerHpCap: number;
        playerDouqi: number;
        playerCooldowns: Record<string, number>;
        playerCasts: number;
        bossHp: number;
        bossHpCap: number;
        bossCasts: number;
        skillCount: number;
        floatingCount: number;
        frameCount: number;
        errors: string[];
      };
      /**
       * 备战界面（调试用）。
       *
       * ⚠️ 它存在的理由是"光标 ≠ 选择"这条需求**不能只靠截图验证**：
       * 画面上的区别是颜色，而"白框在哪张卡 / 金底在哪张卡"是渲染出来的 ——
       * 读取状态才是硬证据（截图只用来确认"确实看得分出来"）。
       *
       * 方法走的是界面自己的路径（同键盘 / 同点击），不是另写一套旁路。
       */
      prepare: {
        /** 当前状态（选择 + 光标）。 */
        state(): {
          readonly playerId: string;
          readonly bossId: string;
          readonly focus: 'player' | 'boss' | 'start';
          readonly cursor: { readonly playerId: string; readonly bossId: string };
        };
        /** 同 ← →：**只移动光标**，不改选择。 */
        cycle(delta: number): void;
        /** 同 ↑ ↓ / Tab：换槽位（`wrap` 为真时环绕）。 */
        moveFocus(delta: number, wrap?: boolean): void;
        /** 同 Enter：确定光标处那一项；光标在「开始战斗」上则开战。 */
        confirm(): void;
        /** 同点击卡片：移光标 + 确定（一步到位）。 */
        pick(kind: 'player' | 'boss', id: string): void;
        /** 直接把焦点放到某个槽位（截图用，省掉"按几次方向键"）。 */
        focusSlot(slot: 'player' | 'boss' | 'start'): void;
      };
      /**
       * **首页**（默认入口；调试用）。
       *
       * 与 `prepare` 同源：headless 下模拟点击不可靠，截图脚本需要把界面
       * 推到某个状态再拍；每个方法都转调界面自己的方法，不是旁路。
       */
      home: {
        /** 光标停在第几个入口（0 = 肉鸽模式，1 = 自由模式）。 */
        state(): { readonly cursor: number };
        /** 同 ↑ ↓ / Tab：移动光标（`wrap` 为真时环绕）。 */
        moveFocus(delta: number, wrap?: boolean): void;
        /** 同 Enter：进入光标处的模式（**会真的切界面**）。 */
        confirm(): void;
      };
      /**
       * **选角色屏**（肉鸽模式的第一屏；调试用）。
       *
       * ⚠️ `state()` 的形状与 `prepare` 相同（共用同一套光标模型）；
       * `bossId` 恒为空串 —— 这一屏没有对手槽位。
       */
      characterSelect: {
        state(): {
          readonly playerId: string;
          readonly bossId: string;
          readonly focus: 'player' | 'boss' | 'start';
          readonly cursor: { readonly playerId: string; readonly bossId: string };
        };
        /** 同 ← → / Tab：**只移动光标**，不改已确定的角色。 */
        cycle(delta: number): void;
        /** 同 Enter：确定光标处的角色；能开始就开始一局（**会真的进战斗**）。 */
        confirm(): void;
        /** 同点击卡片：移光标 + 确定 + 开始（一步到位）。 */
        pick(id: string): void;
      };
      /**
       * **返回箭头**（自由模式 / 选角色屏左上角；调试用）。
       *
       * 需求："肯定要加返回啊"，且**触屏必须有对等入口**
       * （AGENTS.md §3b：`Esc` 只有键盘按得出）。
       *
       * 验证"点得通"必须**真的点**：注入一个真实 `PointerEvent` 到
       * canvas 上，坐标由 `center()` 给（页面自己的几何，不是脚本抄一份）。
       */
      back: {
        /** 此刻是否可见（= 当前相位允许返回）。 */
        visible(): boolean;
        /** 可点区域（含角落的 `Esc` 提示）。 */
        bounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
        /** 箭头中心的逻辑坐标 —— 注入点击时用它，别手写数字。 */
        center(): { readonly x: number; readonly y: number };
      };
    };
    /** 渲染侧探针：报告实际写到 Pixi 上的位置 */
    __raidProbe?(): {
      boxX: number;
      currX: number;
      prevX: number;
      snapX: number;
      simX: number;
      tick: number;
      snapshotTick: number;
    };
    __raidDebug?:
      | {
          probe(): {
            tick: number;
            steps: number;
            alpha: number;
            droppedMs: number;
            usingWorker: boolean;
            lastError: string | null;
            snapshotTick: number;
            demoX: number;
          };
        }
      | undefined;
  }
}

export {};

/**
 * Vite 的 `?raw` 后缀：把文件内容作为字符串导入。
 *
 * ⚠️ 运行时仍会做一次归一（见 `icons.ts` 的 `sourceOf`）——
 * 不同 Vite 版本对 `?raw` 的导出形态不一致（`string` 或
 * `{ default: string }`），所以类型声明只做到"可能是二者之一"，
 * 由代码里的类型守卫收窄，而不是用 `as` 断言（AGENTS.md §1）。
 */
declare module '*.svg?raw' {
  const content: string | { readonly default: string };
  export default content;
}
