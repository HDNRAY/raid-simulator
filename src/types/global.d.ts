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
