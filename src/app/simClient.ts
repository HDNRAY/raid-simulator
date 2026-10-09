/**
 * 主线程侧的模拟客户端。
 *
 * 职责（architecture 规范 §2.2）：
 *   - 起一个 worker（或在不支持 worker 的目标上退回主线程会话）
 *   - 每帧请求推进
 *   - 把快照与事件交给渲染层
 *
 * 数据流永远是 sim -> snapshot -> renderer。渲染层不许反向调用 sim，
 * 也不许持有 sim 的对象引用。
 */

import { SimSession } from '../core/worker';
import type {
  Action,
  FromWorker,
  RenderState,
  SimEvent,
  SimSnapshot,
  ToWorker,
  WorkerStats,
} from '../core/workerProtocol';

/** worker 的最小接口，便于测试时注入假实现。 */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  addEventListener(type: 'message', listener: (event: { data: FromWorker }) => void): void;
  terminate(): void;
}

/** 当前可见的世界状态：最近一次快照 + 之后累积的事件。 */
export interface SimView {
  /** 权威状态（每 60 tick 一次） */
  readonly snapshot: SimSnapshot | undefined;
  /** 逐 tick 的渲染载荷（用于连续插值，见 RenderState 的说明） */
  readonly render: RenderState | undefined;
  readonly stats: WorkerStats | undefined;
  /** 自上次快照以来收到的事件（渲染层消费后由 clearEvents 清空） */
  readonly events: readonly SimEvent[];
  /** 累计丢弃的真实时间，调试面板用 */
  readonly droppedMs: number;
}

export interface SimClientOptions {
  /** 工厂：返回 worker。测试里注入假实现；不传则用真实 worker。 */
  readonly createWorker?: () => WorkerLike;
  /** 不支持 worker 时的退回实现（小游戏目标）。默认也退回主线程会话。 */
  readonly disableWorker?: boolean;
  readonly onError?: (error: Error) => void;
}

export class SimClient {
  private worker: WorkerLike | undefined;
  /** 退回主线程时使用的会话 */
  private fallback: SimSession | undefined;

  private snapshot: SimSnapshot | undefined;
  private renderState: RenderState | undefined;
  private stats: WorkerStats | undefined;
  private events: SimEvent[] = [];
  private droppedMs = 0;
  private running = false;
  private lastErrorValue: Error | undefined;
  private readonly options: SimClientOptions;

  constructor(options: SimClientOptions = {}) {
    this.options = options;
  }

  get view(): SimView {
    return {
      snapshot: this.snapshot,
      render: this.renderState,
      stats: this.stats,
      events: this.events,
      droppedMs: this.droppedMs,
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * 最近一次错误。
   *
   * 刻意**不**在库里 console.error：日志方式与目标平台有关（小游戏平台、
   * 原生壳可能没有 console），而且会污染测试输出。调用方按需读取，
   * 或用 onError 回调接管。
   */
  get lastError(): Error | undefined {
    return this.lastErrorValue;
  }

  /**
   * 起一场模拟。
   *
   * worker 起不来（环境不支持 / 构造失败）时**自动退回主线程会话**，
   * 而不是让整个游戏崩掉。这是为"以后移植到小游戏平台"留的路。
   */
  start(seed: number, realNow: number): void {
    this.running = true;
    this.events = [];
    this.droppedMs = 0;

    const worker = this.tryCreateWorker();
    if (worker) {
      this.attach(worker);
      this.worker = worker;
      this.send({ kind: 'start', seed, realNow });
      return;
    }

    // 主线程路径每帧都带快照：没有跨线程序列化成本，且渲染需要最新状态
    this.fallback = new SimSession(seed, { snapshotEveryFrame: true });
    this.handleMessage(this.fallback.frame(realNow));
  }

  /** 每帧调用。主线程的真实时间由调用方传入。 */
  frame(realNow: number): void {
    if (!this.running) return;

    if (this.worker) {
      this.send({ kind: 'frame', realNow });
      return;
    }

    if (this.fallback) {
      this.handleMessage(this.fallback.frame(realNow));
    }
  }

  /** 注入操作。 */
  dispatch(actions: readonly Action[]): void {
    if (actions.length === 0) return;
    this.send({ kind: 'actions', actions });
  }

  /** 请求一次全量快照（暂停恢复、调试用）。 */
  requestSnapshot(): void {
    this.send({ kind: 'requestSnapshot' });
  }

  /** 渲染层消费完事件后调用，避免数组无限增长。 */
  clearEvents(): void {
    this.events = [];
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.worker) {
      this.send({ kind: 'stop' });
      this.worker.terminate();
      this.worker = undefined;
    }
    this.fallback?.stop();
    this.fallback = undefined;
  }

  /** 正在用 worker 还是退回主线程（调试面板会显示这个）。 */
  get usingWorker(): boolean {
    return this.worker !== undefined;
  }

  private send(message: ToWorker): void {
    if (this.worker) {
      this.worker.postMessage(message);
      return;
    }
    // 退回主线程时，start/frame 已经在别处直接处理，其余消息无需转发
  }

  private tryCreateWorker(): WorkerLike | undefined {
    if (this.options.disableWorker) return undefined;
    if (this.options.createWorker) {
      try {
        return this.options.createWorker();
      } catch (error) {
        this.reportError(error);
        return undefined;
      }
    }
    // 没有注入工厂时，只有在浏览器且 Worker 可用时才真起 worker
    if (typeof Worker === 'undefined') return undefined;
    try {
      // Vite 的 worker 导入语法；在测试环境不会走到这里
      const worker = new Worker(new URL('../core/worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.addEventListener('error', (event: ErrorEvent) => {
        this.reportError(new Error(event.message));
      });
      return {
        postMessage: (m) => worker.postMessage(m),
        /**
         * 事件监听转发。
         *
         * `WorkerLike` 的回调签名是 `(event: { data: FromWorker }) => void`
         * （为了测试时能注入假 worker），而真实 `Worker` 抛的是完整
         * `MessageEvent` —— 类型对不上。
         *
         * **不用 `as` 强转**（项目规范禁止），而是**写一个适配器**：
         * 它显式声明自己收 `MessageEvent`，再把 `message.data` 转交出去。
         * 这样"两边的事件形状不同"这件事就写在代码里了，
         * 而不是被一个 cast 掩盖掉。
         */
        addEventListener: (type, listener) =>
          worker.addEventListener(type, (message: MessageEvent<FromWorker>) => {
            listener({ data: message.data });
            return undefined;
          }),
        terminate: () => worker.terminate(),
      };
    } catch (error) {
      this.reportError(error);
      return undefined;
    }
  }

  /**
   * 挂上消息监听。
   *
   * 注意：注入的 worker 与真实 Worker 都要走这里 ——
   * 只在真实 Worker 分支里挂监听是曾经的 bug（假 worker 的消息会静默丢失）。
   */
  private attach(worker: WorkerLike): void {
    worker.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });
  }

  private handleMessage(message: FromWorker): void {
    switch (message.kind) {
      case 'frame': {
        this.stats = message.stats;
        this.droppedMs = message.stats.droppedMs;
        if (message.render) this.renderState = message.render;
        if (message.snapshot) this.snapshot = message.snapshot;
        if (message.events) this.events.push(...message.events);
        break;
      }
      case 'snapshot': {
        this.snapshot = message.snapshot;
        break;
      }
      case 'error': {
        this.reportError(new Error(message.message));
        break;
      }
    }
  }

  private reportError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.lastErrorValue = err;
    this.options.onError?.(err);
  }
}
