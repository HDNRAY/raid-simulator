import { describe, expect, it } from 'vitest';
import { DT } from '../../src/core/loopConstants';
import { SimSession } from '../../src/core/worker';
import { SNAPSHOT_INTERVAL_TICKS, type FromWorker } from '../../src/core/workerProtocol';

/**
 * SimSession 是 worker 的纯核心，单独测它就能覆盖协议与节流逻辑，
 * 不需要搭 worker 全局环境。
 */

/** 把 N 帧的 frame() 结果收集起来（第一帧是校准帧）。 */
function runFrames(session: SimSession, frames: number): FromWorker[] {
  const out: FromWorker[] = [];
  for (let i = 0; i <= frames; i += 1) {
    out.push(session.frame(i * DT));
  }
  return out;
}

describe('SimSession', () => {
  it('第一帧是校准帧，不推进', () => {
    const session = new SimSession(1);
    const first = session.frame(0);
    expect(first.kind).toBe('frame');
    if (first.kind !== 'frame') return;
    expect(first.stats.steps).toBe(0);
    expect(first.stats.tick).toBe(0);
  });

  it('推进 60 帧得到 60 tick', () => {
    const session = new SimSession(1);
    const frames = runFrames(session, 60);
    const last = frames.at(-1);
    expect(last?.kind).toBe('frame');
    if (last?.kind !== 'frame') return;
    expect(last.stats.tick).toBe(60);
    expect(last.stats.time).toBeCloseTo(1000, 6);
  });

  it('同一 seed 的两次会话产生完全相同的快照序列（确定性）', () => {
    const a = runFrames(new SimSession(2026), 200);
    const b = runFrames(new SimSession(2026), 200);

    const snapshotsOf = (frames: FromWorker[]) =>
      frames
        .filter((f): f is Extract<FromWorker, { kind: 'frame' }> => f.kind === 'frame')
        .map((f) => f.snapshot?.demoX)
        .filter((v): v is number => v !== undefined);

    expect(snapshotsOf(a)).toEqual(snapshotsOf(b));
    expect(snapshotsOf(a).length).toBeGreaterThan(0);
  });

  it('不同 seed 产生不同轨迹', () => {
    const a = runFrames(new SimSession(1), 200);
    const b = runFrames(new SimSession(2), 200);
    const lastX = (frames: FromWorker[]) => {
      const withSnap = frames
        .filter((f): f is Extract<FromWorker, { kind: 'frame' }> => f.kind === 'frame')
        .map((f) => f.snapshot?.demoX)
        .filter((v): v is number => v !== undefined);
      return withSnap.at(-1);
    };
    expect(lastX(a)).not.toBe(lastX(b));
  });

  it('全量快照按 SNAPSHOT_INTERVAL_TICKS 节流', () => {
    const session = new SimSession(3);
    const frames = runFrames(session, SNAPSHOT_INTERVAL_TICKS);
    const withSnapshot = frames.filter(
      (f): f is Extract<FromWorker, { kind: 'frame' }> =>
        f.kind === 'frame' && f.snapshot !== undefined,
    );
    // 0 和 60 两个 tick 应各带一次快照
    expect(withSnapshot.map((f) => f.snapshot?.tick)).toEqual([0, 60]);
  });

  it('每个推进帧都带 tick 事件，非推进帧不带', () => {
    const session = new SimSession(4);
    const calibration = session.frame(0);
    if (calibration.kind !== 'frame') throw new Error('unexpected');
    expect(calibration.events).toBeUndefined();

    const stepped = session.frame(DT);
    if (stepped.kind !== 'frame') throw new Error('unexpected');
    expect(stepped.events).toEqual([{ kind: 'tick', tick: 1 }]);
  });

  it('快照可结构化克隆（C5 约束的可执行检查）', () => {
    const session = new SimSession(5);
    const frames = runFrames(session, SNAPSHOT_INTERVAL_TICKS);
    for (const f of frames) {
      if (f.kind === 'frame' && f.snapshot) {
        expect(() => structuredClone(f.snapshot)).not.toThrow();
      }
    }
  });

  it('requestSnapshot 立即返回当前状态，不推进', () => {
    const session = new SimSession(6);
    session.frame(0);
    // 逐帧推进 10 次（一次跳 10*DT 会触发 MAX_CATCHUP_MS 钳制，那是另一条路径）
    for (let i = 1; i <= 10; i += 1) session.frame(i * DT);
    const before = session.requestSnapshot();
    const after = session.requestSnapshot();
    expect(before).toEqual(after);
    if (before.kind !== 'snapshot' || after.kind !== 'snapshot') throw new Error('unexpected');
    expect(before.snapshot.tick).toBe(10);
  });

  it('stop 之后不再推进', () => {
    const session = new SimSession(7);
    session.frame(0);
    for (let i = 1; i <= 10; i += 1) session.frame(i * DT);
    const atStop = session.requestSnapshot();
    session.stop();
    session.frame(20 * DT);
    const afterStop = session.requestSnapshot();
    expect(afterStop).toEqual(atStop);
  });

  it('巨大 delta 被钳制，droppedMs 记录在快照统计里', () => {
    const session = new SimSession(8);
    session.frame(0);
    const r = session.frame(5000);
    if (r.kind !== 'frame') throw new Error('unexpected');
    expect(r.stats.steps).toBe(5);
    expect(r.stats.droppedMs).toBeGreaterThan(4000);
  });
});
