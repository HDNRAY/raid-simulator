/**
 * 模拟 worker 的入口。
 *
 * 引擎跑在 worker 里（architecture 规范 §2.2），主线程只做渲染。
 * 这顺便逼着我们保持"状态必须可结构化克隆"的纪律（C5）——
 * 一旦有人在 BattleState 里塞了类实例或函数，这里立刻报错。
 *
 * M0 阶段这里跑的是一个**演示用模拟**（水平往复的色块），
 * 用来验证：时钟、消息协议、快照/事件节流、以及主线程插值。
 * M1 起 `DemoSim` 会被真正的 core/ 战斗模拟替换，协议不变。
 */

import { DT } from './loopConstants';
import { createRng, nextRandom, type RngState } from './rng';
import { SimClock } from './simClock';
import {
  SNAPSHOT_INTERVAL_TICKS,
  type FromWorker,
  type SimEvent,
  type SimSnapshot,
  type ToWorker,
  type WorkerStats,
} from './workerProtocol';

/** 演示用的往复运动范围（逻辑像素） */
const DEMO_MIN_X = 60;
const DEMO_MAX_X = 900;
const DEMO_SPEED_PX_PER_MS = 0.28;

/**
 * M0 的占位模拟。
 *
 * 刻意保持极小，但结构上已经是 M1 战斗模拟的样子：
 *   1. 状态是一个 plain object（可结构化克隆、可哈希）
 *   2. 随机数状态在状态里（C2）
 *   3. tick(state, actions) 是纯推进
 */
export class DemoSim {
  private tick = 0;
  private rng: RngState;
  private x = DEMO_MIN_X;
  private direction: 1 | -1 = 1;
  /** 累计被丢弃的真实时间，用于调试面板 */
  droppedMs = 0;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  /** 推进一个固定步长。actions 目前未使用，M1 起会在这里应用。 */
  step(): void {
    // 用 RNG 做一点点速度抖动，证明随机源是确定性的
    const jitter = nextRandom(this.rng);
    this.rng = jitter.state;
    const speed = DEMO_SPEED_PX_PER_MS * (0.85 + 0.3 * jitter.value);

    this.x += speed * DT * this.direction;

    if (this.x >= DEMO_MAX_X) {
      this.x = DEMO_MAX_X;
      this.direction = -1;
    } else if (this.x <= DEMO_MIN_X) {
      this.x = DEMO_MIN_X;
      this.direction = 1;
    }

    this.tick += 1;
  }

  snapshot(): SimSnapshot {
    return {
      tick: this.tick,
      time: this.tick * DT,
      rngSeed: this.rng.seed,
      demoX: this.x,
    };
  }
}

/**
 * 会话：把时钟、模拟、消息节流绑在一起。
 *
 * 单独成类（而不是写在 onmessage 里）是为了让它可以被直接单测 ——
 * worker 的全局环境在测试里不好搭，但会话对象是纯的。
 */
export interface SimSessionOptions {
  /**
   * 是否每帧都带全量快照。
   *
   * - worker 路径：false（默认）。跨线程 postMessage 有结构化克隆成本，
   *   按 SNAPSHOT_INTERVAL_TICKS 节流 + 用事件补差。
   * - 主线程退回路径：true。没有序列化成本，而渲染需要逐帧的最新状态
   *   —— 否则退回路径要等 1 秒才更新一次画面。
   */
  readonly snapshotEveryFrame?: boolean;
}

export class SimSession {
  private readonly sim: DemoSim;
  private readonly clock = new SimClock();
  private readonly snapshotEveryFrame: boolean;
  private stopped = false;

  constructor(seed: number, options: SimSessionOptions = {}) {
    this.sim = new DemoSim(seed);
    this.snapshotEveryFrame = options.snapshotEveryFrame ?? false;
  }

  /** 处理一帧请求，返回要发回主线程的消息。 */
  frame(realNow: number): FromWorker {
    if (this.stopped) {
      return { kind: 'frame', stats: this.makeStats(this.sim.snapshot(), 0, 0) };
    }

    const advance = this.clock.advance(realNow);
    for (let i = 0; i < advance.steps; i += 1) {
      this.sim.step();
    }
    this.sim.droppedMs += advance.droppedMs;

    // 每帧只取一次快照：stats 与节流判断都基于同一份值，
    // 否则 tick 可能在两次取值之间变化，导致节流时机错位。
    const snapshot = this.sim.snapshot();
    const stats = this.makeStats(snapshot, advance.steps, advance.alpha);

    const events: SimEvent[] =
      advance.steps > 0 ? [{ kind: 'tick', tick: snapshot.tick }] : [];

    // 节流：worker 路径每 SNAPSHOT_INTERVAL_TICKS 才带一次全量快照；
    // 主线程退回路径每帧都带（没有序列化成本，且渲染需要最新状态）。
    const shouldSnapshot =
      this.snapshotEveryFrame || snapshot.tick % SNAPSHOT_INTERVAL_TICKS === 0;

    return {
      kind: 'frame',
      stats,
      ...(shouldSnapshot ? { snapshot } : {}),
      ...(events.length > 0 ? { events } : {}),
    };
  }

  requestSnapshot(): FromWorker {
    return { kind: 'snapshot', snapshot: this.sim.snapshot() };
  }

  stop(): void {
    this.stopped = true;
  }

  private makeStats(snapshot: SimSnapshot, steps: number, alpha: number): WorkerStats {
    return {
      tick: snapshot.tick,
      time: snapshot.time,
      steps,
      alpha,
      droppedMs: this.sim.droppedMs,
    };
  }
}

/* ------------------------------------------------------------------ *
 * worker 接线
 * ------------------------------------------------------------------ */

/**
 * worker 全局作用域的最小类型。
 *
 * 刻意不引 `lib.webworker`：那会和 DOM lib 冲突，而且只有在真正跑在 worker 里
 * 时才需要。这里用一个窄接口描述我们实际用到的能力。
 */
interface WorkerScope {
  postMessage(message: FromWorker): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: ToWorker }) => void,
  ): void;
}

function isWorkerScope(scope: unknown): scope is WorkerScope {
  return (
    typeof scope === 'object' &&
    scope !== null &&
    typeof (scope as WorkerScope).postMessage === 'function' &&
    typeof (scope as WorkerScope).addEventListener === 'function'
  );
}

/** 入口。只有在真的作为 worker 启动时才会接线。 */
export function attachWorker(scope: unknown): void {
  if (!isWorkerScope(scope)) return;

  let session: SimSession | undefined;

  scope.addEventListener('message', (event) => {
    const msg = event.data;
    try {
      switch (msg.kind) {
        case 'start': {
          session = new SimSession(msg.seed);
          scope.postMessage(session.requestSnapshot());
          break;
        }
        case 'frame': {
          if (!session) return;
          scope.postMessage(session.frame(msg.realNow));
          break;
        }
        case 'requestSnapshot': {
          if (!session) return;
          scope.postMessage(session.requestSnapshot());
          break;
        }
        case 'stop': {
          session?.stop();
          session = undefined;
          break;
        }
        case 'actions': {
          // M0 的演示模拟不消费 Action；M1 起在这里入队
          break;
        }
      }
    } catch (error) {
      const err = error as Error;
      scope.postMessage({ kind: 'error', message: err.message, stack: err.stack });
    }
  });
}

// 作为 worker 入口被加载时自动接线（普通 import 时这段是空操作）
attachWorker(globalThis);
