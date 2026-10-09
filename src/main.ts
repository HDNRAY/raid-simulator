import './styles.css';
import { LOGICAL_H, LOGICAL_W, type ScalingMode } from './render/scaling';
import { observeStage } from './render/sizes';

/**
 * M0 的启动入口。
 *
 * 目前只做两件事，用来验证工程骨架：
 *   1. Pixi 初始化（定尺寸 canvas，内部恒为 960x540）
 *   2. 自适应缩放接线（CSS 缩放 + letterbox）
 *
 * 这里刻意**没有**游戏逻辑 —— core/ 的固定步长循环与 worker 桥接是 M0-5/M0-6，
 * 渲染内容（如那块验证用的色块）是 M0-7 调试面板的一部分。
 */

/** 暂定默认值；M5 的设置界面里会做成可持久化的选项。 */
const SCALING_MODE: ScalingMode = 'fit';

async function bootstrap(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('缺少 #stage 容器');

  // 动态 import：让 Pixi 只在真正需要时才加载，且失败时报错更清楚
  const { Application, Container, Graphics } = await import('pixi.js');

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

  // M0 的可见证据：一块按逻辑像素绘制的图形 + 文字，用来肉眼确认不糊
  const probe = new Container();
  const box = new Graphics()
    .rect(60, 60, 120, 80)
    .fill(0xd23a34)
    .rect(60, 60, 120, 4)
    .fill(0xf0605a);
  probe.addChild(box);
  app.stage.addChild(probe);

  // canvas 内部尺寸定好了，接线自适应缩放，然后再显示（避免首帧尺寸闪烁）
  observeStage(stage, app.canvas, SCALING_MODE);
  stage.classList.add('ready');
}

void bootstrap();
