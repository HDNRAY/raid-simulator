import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimClient, type WorkerLike } from '../../src/app/simClient';
import { DT } from '../../src/core/loopConstants';
import type { FromWorker, ToWorker } from '../../src/core/workerProtocol';

/** 假 worker：记录收到的消息，并把 FromWorker 回投给注册的监听器。 */
class FakeWorker implements WorkerLike {
  readonly sent: ToWorker[] = [];
  private listener: ((event: { data: FromWorker }) => void) | undefined;
  terminated = false;

  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }

  addEventListener(
    _type: 'message',
    listener: (event: { data: FromWorker }) => void,
  ): void {
    this.listener = listener;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** 测试用：模拟 worker 往回发消息 */
  emit(message: FromWorker): void {
    this.listener?.({ data: message });
  }

  sentOfKind<K extends ToWorker['kind']>(kind: K): Array<Extract<ToWorker, { kind: K }>> {
    return this.sent.filter((m): m is Extract<ToWorker, { kind: K }> => m.kind === kind);
  }
}

describe('SimClient（注入假 worker）', () => {
  let worker: FakeWorker;
  let client: SimClient;

  beforeEach(() => {
    worker = new FakeWorker();
    client = new SimClient({ createWorker: () => worker });
  });

  it('start 发出 start 消息并带上 seed 与真实时间', () => {
    client.start(12345, 1000);
    expect(worker.sentOfKind('start')).toEqual([{ kind: 'start', seed: 12345, realNow: 1000 }]);
    expect(client.isRunning).toBe(true);
    expect(client.usingWorker).toBe(true);
  });

  it('未 start 时 frame 不发消息', () => {
    client.frame(0);
    expect(worker.sent).toHaveLength(0);
  });

  it('frame 转发为 frame 消息', () => {
    client.start(1, 0);
    worker.sent.length = 0;
    client.frame(DT);
    client.frame(2 * DT);
    expect(worker.sentOfKind('frame')).toEqual([
      { kind: 'frame', realNow: DT },
      { kind: 'frame', realNow: 2 * DT },
    ]);
  });

  it('收到 frame 消息后更新 view', () => {
    client.start(1, 0);
    worker.emit({
      kind: 'frame',
      stats: { tick: 60, time: 1000, steps: 1, alpha: 0.5, droppedMs: 0 },
      snapshot: { tick: 60, time: 1000, rngSeed: 7, demoX: 123 },
      events: [{ kind: 'tick', tick: 60 }],
    });
    expect(client.view.snapshot?.demoX).toBe(123);
    expect(client.view.stats?.tick).toBe(60);
    expect(client.view.events).toEqual([{ kind: 'tick', tick: 60 }]);
  });

  it('事件累积，clearEvents 后清空（避免数组无限增长）', () => {
    client.start(1, 0);
    worker.emit({ kind: 'frame', stats: statsOf(1), events: [{ kind: 'tick', tick: 1 }] });
    worker.emit({ kind: 'frame', stats: statsOf(2), events: [{ kind: 'tick', tick: 2 }] });
    expect(client.view.events).toHaveLength(2);
    client.clearEvents();
    expect(client.view.events).toHaveLength(0);
  });

  it('没有 snapshot 的 frame 不会清掉上一次的快照', () => {
    client.start(1, 0);
    const snap = { tick: 0, time: 0, rngSeed: 1, demoX: 60 };
    worker.emit({ kind: 'frame', stats: statsOf(0), snapshot: snap });
    worker.emit({ kind: 'frame', stats: statsOf(1) });
    expect(client.view.snapshot).toEqual(snap);
  });

  it('snapshot 消息直接替换快照', () => {
    client.start(1, 0);
    const snap = { tick: 5, time: 83, rngSeed: 2, demoX: 70 };
    worker.emit({ kind: 'snapshot', snapshot: snap });
    expect(client.view.snapshot).toEqual(snap);
  });

  it('error 消息交给 onError，不静默吞掉', () => {
    const onError = vi.fn();
    const c = new SimClient({ createWorker: () => worker, onError });
    c.start(1, 0);
    worker.emit({ kind: 'error', message: 'boom' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(c.lastError?.message).toBe('boom');
  });

  it('没有 onError 时错误仍记录在 lastError（不写 console）', () => {
    const c = new SimClient({ createWorker: () => worker });
    c.start(1, 0);
    worker.emit({ kind: 'error', message: 'quiet failure' });
    expect(c.lastError?.message).toBe('quiet failure');
  });

  it('dispatch 忽略空数组，非空则转发', () => {
    client.start(1, 0);
    worker.sent.length = 0;
    client.dispatch([]);
    expect(worker.sent).toHaveLength(0);
    client.dispatch([{ type: 'useSkill', skillId: 'slash', at: DT }]);
    expect(worker.sentOfKind('actions')).toHaveLength(1);
  });

  it('stop 终止 worker 并停止转发', () => {
    client.start(1, 0);
    client.stop();
    expect(worker.terminated).toBe(true);
    expect(client.isRunning).toBe(false);
    worker.sent.length = 0;
    client.frame(DT);
    expect(worker.sent).toHaveLength(0);
  });

  it('worker 构造抛错时退回主线程会话，而不是崩掉', () => {
    const c = new SimClient({
      createWorker: () => {
        throw new Error('Worker not available');
      },
    });
    expect(() => c.start(42, 0)).not.toThrow();
    expect(c.isRunning).toBe(true);
    expect(c.usingWorker).toBe(false);
    expect(c.lastError?.message).toBe('Worker not available');
  });

  it('disableWorker 时退回主线程会话并能推进', () => {
    const c = new SimClient({ disableWorker: true });
    c.start(42, 0);
    expect(c.usingWorker).toBe(false);
    c.frame(DT);
    expect(c.view.snapshot?.tick).toBe(1);
    expect(c.view.stats?.steps).toBe(1);
  });

  it('退回主线程会话时 stop 后不再推进', () => {
    const c = new SimClient({ disableWorker: true });
    c.start(42, 0);
    c.stop();
    expect(c.view.snapshot?.tick).toBe(0);
  });
});

function statsOf(tick: number) {
  return { tick, time: tick * DT, steps: 1, alpha: 0, droppedMs: 0 };
}
