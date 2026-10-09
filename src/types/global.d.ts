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
      probe(): {
        tick: number;
        status: string;
        phase: number;
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
