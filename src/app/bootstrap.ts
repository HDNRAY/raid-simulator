/**
 * **Pixi 应用与画布的立起来**（主干第一步：`createStage()`）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这段是纯粹的"平台装配"：注册 SVG 解码器、`new Application()` + `init`、
 * 把 canvas 挂到 `#stage`。它与游戏逻辑、界面接线毫无关系，却占了
 * `main.ts` 开头近 30 行 —— 一个没读过仓库的人打开 `main.ts` 时，
 * 最不该先读的就是这些参数。
 *
 * ⚠️ **静态导入 pixi，不要写 `await import('pixi.js')`。**
 *
 * 这里原先是个动态导入，想"延迟加载引擎"。但它**完全无效** ——
 * `render/icons.ts`、`ui/CastBar.ts`、`render/parts/playerActor.ts` 都
 * **值导入**了 pixi（`Assets` / `Sprite` / `Text`），打包器必然把它放进
 * 主 chunk。构建时 Vite 直接警告 `INEFFECTIVE_DYNAMIC_IMPORT`。
 *
 * 所以它唯一的效果是：多一层 `await` + 让人误以为"pixi 是按需加载的"。
 * 真要拆分就得把所有渲染模块都改成动态导入，那是另一件事。
 */

import { Application } from 'pixi.js';
import { createAssetsDecoder, setIconDecoder } from '../render/icons';
import { LOGICAL_H, LOGICAL_W } from '../render/scaling';

/** 画布的底色（不在 i18n 管辖范围内：它不是可显示文案）。 */
const BACKGROUND = 0x0a0a0f;

/** `createStage()` 的产物。 */
export interface StageHandle {
  readonly app: Application;
  /** `#stage` 容器（canvas 的宿主）。 */
  readonly stage: HTMLElement;
}

/**
 * 立起 Pixi 应用并把 canvas 挂到 `#stage`。
 *
 * @throws 页面里缺 `#stage` 容器时（说明 `index.html` 被改坏了）。
 */
export async function createStage(): Promise<StageHandle> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('index.html is missing the #stage container');

  /** 注册 SVG 图标解码器（Pixi v8 里 `Texture.from(svg)` 拿不到图形）。 */
  setIconDecoder(createAssetsDecoder());

  const app = new Application();
  await app.init({
    width: LOGICAL_W,
    height: LOGICAL_H,
    resolution: 1,
    autoDensity: false,
    antialias: false,
    roundPixels: true,
    background: BACKGROUND,
  });
  stage.appendChild(app.canvas);

  return { app, stage };
}
