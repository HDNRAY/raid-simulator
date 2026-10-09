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
      /** 注入一个技能动作（调试用，让验证脚本能精确控制状态） */
      act(skillId: string, actorId?: string): void;
      /** Pixi 根容器（调试用：读取渲染层实际写入的文本） */
      stage: unknown;
      /** 设置界面（调试用：headless 下模拟点击不可靠） */
      settings: {
        open(tab?: 'general' | 'keys'): void;
        close(): void;
        /** 用逻辑坐标点一下（验证命中测试与布局一致） */
        openIn(px: number, py: number): void;
        isOpen(): boolean;
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
