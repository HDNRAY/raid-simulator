import { SimClient } from './app/simClient';
import { LOGICAL_H, LOGICAL_W, type ScalingMode } from './render/scaling';
import { observeStage, type StageSize } from './render/sizes';
import { DebugPanel } from './ui/debug/DebugPanel';
import './styles.css';

/**
 * M0 启动入口。
 *
 * 这一版把数据流跑通了：worker（或主线程退回）推进模拟 ->
 * 快照 -> 渲染层插值绘制。屏幕上那块色块**由 tick 驱动**，
 * 不是由 requestAnimationFrame 直接驱动 —— 这是 §2.3 那条约定的可见证据。
 *
 * 渲染内容仍是 M0 的占位（往复色块 + 调试面板）；
 * M5 起换成真正的战斗场景与 HUD。
 */

/** 暂定默认值；M5 的设置界面会做成可持久化选项。 */
const SCALING_MODE: ScalingMode = 'fit';

/** 演示色块的尺寸与纵向位置（逻辑像素）。 */
const BOX_W = 120;
const BOX_H = 80;
const BOX_Y = 200;

async function bootstrap(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('缺少 #stage 容器');

  // 动态 import：Pixi 只在真正需要时加载，失败时错误更清楚
  const { Application, Container, Graphics, Text } = await import('pixi.js');

  const app = new Application();
  await app.init({
    width: LOGICAL_W,
    height: LOGICAL_H,
    resolution: 1,
    // 不让 Pixi 按 devicePixelRatio 改 canvas 内部尺寸 —— 缩放一律交给 CSS
    autoDensity: false,
    antialias: false,
    roundPixels: true,
    background: 0x0a0a0f,
    // 刻意不设 resizeTo：那会让 Pixi 自己改内部尺寸
  });
  stage.appendChild(app.canvas);

  // ---- 演示图形 ----
  const world = new Container();
  app.stage.addChild(world);

  const board = new Graphics()
    .rect(40, BOX_Y + BOX_H + 20, LOGICAL_W - 80, 2)
    .fill(0x1e141c);
  world.addChild(board);

  const box = new Container();
  const boxBody = new Graphics()
    .rect(0, 0, BOX_W, BOX_H)
    .fill(0xd23a34)
    .rect(0, 0, BOX_W, 4)
    .fill(0xf0605a);
  const boxLabel = new Text({
    text: 'tick-driven',
    style: { fontFamily: 'monospace', fontSize: 16, fill: 0xf0f0f6 },
  });
  boxLabel.x = 10;
  boxLabel.y = BOX_H - 24;
  box.addChild(boxBody, boxLabel);
  box.y = BOX_Y;
  world.addChild(box);

  const debug = new DebugPanel();
  app.stage.addChild(debug.root);

  // ---- 模拟接线 ----
  const sim = new SimClient();

  // observeStage 返回的是取消订阅函数；尺寸通过回调拿到
  let stageSize: StageSize = { width: 0, height: 0, scale: 1, padX: 0, padY: 0 };
  const disposeStageObserver = observeStage(stage, app.canvas, SCALING_MODE, (size) => {
    stageSize = size;
  });
  sim.start(Date.now() >>> 0, performance.now());

  /** 上一份快照的 x，用于插值。 */
  let prevX = 0;
  let currX = 0;

  app.ticker.add(() => {
    const realNow = performance.now();
    sim.frame(realNow);

    const { snapshot, stats } = sim.view;
    if (snapshot) {
      // 快照更新了才推进插值端点：worker 节流发送时不能每帧都把 curr 当成 prev
      if (snapshot.demoX !== currX) {
        prevX = currX;
        currX = snapshot.demoX;
      }
    }

    const alpha = stats?.alpha ?? 0;
    const interpX = prevX + (currX - prevX) * alpha;
    box.x = Math.round(interpX);

    debug.update({
      tick: stats?.tick ?? 0,
      steps: stats?.steps ?? 0,
      alpha,
      droppedMs: stats?.droppedMs ?? 0,
      fps: app.ticker.FPS,
      scale: stageSize.scale,
      usingWorker: sim.usingWorker,
      snapshotTick: snapshot?.tick ?? -1,
    });

    sim.clearEvents();
  });

  stage.classList.add('ready');

  /**
   * 把只读状态挂到 window，供端到端验证读取。
   *
   * 这是 M0 阶段的可观测性手段：静态截图看不出"在动"，
   * 需要能查询 tick 是否真的在推进。M5 起会被真正的调试面板与
   * 录制回放取代。
   */
  window.__raidDebug = {
    probe: () => {
      const { snapshot, stats } = sim.view;
      return {
        tick: stats?.tick ?? 0,
        steps: stats?.steps ?? 0,
        alpha: stats?.alpha ?? 0,
        droppedMs: stats?.droppedMs ?? 0,
        usingWorker: sim.usingWorker,
        lastError: sim.lastError?.message ?? null,
        snapshotTick: snapshot?.tick ?? -1,
        demoX: snapshot?.demoX ?? -1,
      };
    },
  };

  // 页面卸载时断开监听，避免开发期 HMR 反复挂载造成叠加的 observer
  window.addEventListener('pagehide', () => {
    disposeStageObserver();
    sim.stop();
  });
}

void bootstrap();
