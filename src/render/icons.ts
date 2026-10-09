/**
 * SVG 图标 —— 图标本体是 **`src/render/icons/*.svg` 独立文件**。
 *
 * ==================================================================
 * 为什么图标用 SVG
 * ==================================================================
 *
 * 这个决定换过三次，每次都因为上一种做法有具体缺陷：
 *
 *   1. **字符**（用「设」当设置图标）：字必须显式 `set()`，我漏过一次，
 *      按钮渲染成空方块，看起来像"图标没加载"；抽象字也不如
 *      图形一眼认得出。
 *   2. **命令式绘制**（用 `Graphics.arc/lineTo` 拼齿轮）：不依赖字体，
 *      但**造型能力很差** —— 8 个齿是一堆 `cos/sin` 拼出来的，
 *      改形状就要重算，美术也没法参与。
 *   3. **SVG**：矢量、有标准工具链。
 *
 * ==================================================================
 * 为什么从"内联字符串"改成"独立 .svg 文件"
 * ==================================================================
 *
 * 需求："svg 目前是写在代码里的，pixi 支持单独的 svg 文件吗，
 * 如果支持，改为用单独的 svg 文件。"
 *
 * Pixi v8 **支持**（实测：`Assets.load('x.svg')` 返回 24×24 纹理，
 * 走浏览器的 SVG 解码器）。收益是**美术能直接参与**：
 *
 *   - 编辑图标不再需要改 TypeScript（原来是代码里的模板字符串）
 *   - 设计工具（Figma / Illustrator）可以直接导出 `.svg` 覆盖进来
 *   - 代码里不再有长路径数据，`icons.ts` 只剩加载逻辑
 *
 * ==================================================================
 * 颜色：**源文件是白色，运行时用 `Sprite.tint` 染色**
 * ==================================================================
 *
 * 这是跟着"独立文件"一起做的简化。
 *
 * 旧做法是"把颜色注入 SVG 字符串再光栅化"（`{{color}}` 替换），
 * 于是**每种颜色都要重新解码一张纹理**，缓存键也得带上颜色。
 *
 * 新做法：文件里所有描边/填充都是 `#ffffff`，颜色在运行时用
 * `sprite.tint` 乘上去。白色 × N = N，所以能染出任意颜色（包括提亮）。
 *
 * 好处：
 *   - **每种图标只解码一次**，与用多少种颜色无关
 *   - 换色（悬停、禁用态）只是改 `tint`，**不触发任何异步操作**
 *
 * 代价：源文件里不能有"内置颜色"（比如"这个图标某部分是红的"）。
 * 真需要多色图标时再单独处理 —— 目前 6 个图标都是单色的。
 *
 * ⚠️ 不要用 `stroke="currentColor"`：纹理上下文里没有 CSS 继承链，
 * 图标会变成透明。
 */

import { Assets, Sprite } from 'pixi.js';
import * as closeSvg from './icons/close.svg?raw';
import * as gearSvg from './icons/gear.svg?raw';
import * as infoSvg from './icons/info.svg?raw';
import * as pauseSvg from './icons/pause.svg?raw';
import * as playSvg from './icons/play.svg?raw';
import * as restartSvg from './icons/restart.svg?raw';
import type { Container, Texture } from 'pixi.js';
import type { PixiCtor } from '../ui/primitives';

/* ------------------------------------------------------------------ *
 * 图标源
 * ------------------------------------------------------------------ */

/**
 * 图标源表：名字 → 该 `.svg` 文件的**原始文本**。
 *
 * Vite 的 `?raw` 后缀在**构建时**把文件内容变成字符串内联进来 ——
 * 注意这与"运行时 fetch 文件"不同：
 *
 *   - 图标是**首屏就要显示**的东西，多一次网络往返就会闪一下空白
 *   - `?raw` 让"文件仍是独立可编辑的源"，同时"构建后零请求"
 *
 * `?raw` 的默认导出类型在有些版本里是 `{ default: string }`、有些是
 * `string`，所以这里做一次**运行时归一**（见 `sourceOf`），而不是猜类型。
 */
const SOURCES: Readonly<Record<string, unknown>> = {
  gear: gearSvg,
  close: closeSvg,
  pause: pauseSvg,
  play: playSvg,
  restart: restartSvg,
  info: infoSvg,
};

/**
 * 取出 `?raw` 导入的实际字符串。
 *
 * 兼容两种导出形态（`string` 或 `{ default: string }`）。
 * 用类型守卫而不是 `as` 断言 —— 见 `AGENTS.md` §1。
 */
function sourceOf(module: unknown): string | undefined {
  if (typeof module === 'string') return module;
  if (typeof module === 'object' && module !== null && 'default' in module) {
    const def: unknown = module.default;
    if (typeof def === 'string') return def;
  }
  return undefined;
}

/** 图标名。 */
export type IconName = keyof typeof SOURCES;

export const ICON_NAMES = Object.keys(SOURCES) as readonly IconName[];

/* ------------------------------------------------------------------ *
 * 纹理缓存
 * ------------------------------------------------------------------ */

/**
 * 解码器：把一段 SVG 文本变成纹理。
 *
 * 为什么需要注入：**Pixi v8 里 `Texture.from(svg)` 拿不到图形** ——
 * 它返回 1×1 的 EMPTY 纹理并警告"不在 Assets 缓存里"。SVG 必须先由
 * Pixi 的资源系统光栅化，而那是异步的。
 *
 * 生产代码注入基于 `Assets` 的实现（见 `main.ts`）；测试注入假的，
 * 于是这条路径在 node 里也能跑。
 */
export type IconDecoder = (svg: string) => Promise<Texture>;

let decoder: IconDecoder | undefined;

/** 注册解码器（进程启动时调用一次）。 */
export function setIconDecoder(fn: IconDecoder | undefined): void {
  decoder = fn;
}

/**
 * 已解码纹理，键为**图标名**。
 *
 * ⚠️ 键里**没有颜色** —— 这是与旧实现最大的区别。颜色现在是运行时的
 * `Sprite.tint`，共用同一张纹理。所以"用多少种颜色"不再影响解码次数。
 */
const textureCache = new Map<IconName, Texture>();

/** 正在解码的请求（并发请求同一个图标时只解码一次）。 */
const inFlight = new Map<IconName, Promise<Texture | undefined>>();

/**
 * 取（必要时解码）图标纹理。
 *
 * 解码失败返回 `undefined` 而不是抛错 —— 图标是**装饰**，
 * 少一个图标不该让整个界面起不来。
 */
export function iconTexture(name: IconName): Promise<Texture | undefined> {
  const cached = textureCache.get(name);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(name);
  if (pending) return pending;

  const svg = sourceOf(SOURCES[name]);
  if (!decoder || svg === undefined) return Promise.resolve(undefined);

  const task = decoder(svg)
    .then((texture) => {
      textureCache.set(name, texture);
      return texture;
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight.delete(name);
    });

  inFlight.set(name, task);
  return task;
}

/** 清空缓存（测试用；也用于将来切换皮肤时释放旧纹理）。 */
export function clearIconCache(): void {
  textureCache.clear();
  inFlight.clear();
}

/* ------------------------------------------------------------------ *
 * Icon 组件
 * ------------------------------------------------------------------ */

export interface IconOptions {
  readonly pixi: PixiCtor;
  readonly name: IconName;
  /** 显示边长（逻辑像素）。图标是正方形，所以只有一个数字。 */
  readonly size: number;
  readonly color: number;
}

/**
 * 一个图标。
 *
 * ⚠️ **异步就绪**：创建时 `root` 里有一个空 Sprite（不可见），
 * 纹理解码完成后自动换上并显示。这是 SVG 的固有代价 ——
 * 浏览器要先解析并光栅化它。
 *
 * 所以：
 *   - 定位请用构造时给的 `size`，不要读 `root.width`
 *     （解码完成前它是 0）
 *   - 不要假设"构造完就能截图看到图标"；等一帧
 */
export class Icon {
  readonly root: Container;
  private readonly sprite: Sprite;
  private disposed = false;
  private currentName: IconName;
  private currentColor: number;

  constructor(private readonly options: IconOptions) {
    const { pixi, name, size, color } = options;
    this.currentName = name;
    this.currentColor = color;
    this.root = new pixi.Container();
    this.sprite = new pixi.Sprite();
    this.sprite.width = size;
    this.sprite.height = size;
    // 颜色 = 白色纹理 × tint，所以这里一开始就设好
    this.sprite.tint = color;
    // 纹理到位前保持不可见，避免闪一个空白方块
    this.sprite.visible = false;
    this.root.addChild(this.sprite);

    void this.apply(name);
  }

  private async apply(name: IconName): Promise<void> {
    const texture = await iconTexture(name);
    if (this.disposed || !texture) return;
    this.sprite.texture = texture;
    this.sprite.width = this.options.size;
    this.sprite.height = this.options.size;
    this.sprite.visible = true;
  }

  /**
   * 换成另一个图标。
   *
   * 典型用途：暂停按钮在"暂停 / 继续"之间换图形。
   * 换图标时**保持外部设定的位置**（只改纹理与尺寸）。
   */
  setIcon(name: IconName): void {
    this.currentName = name;
    this.sprite.visible = false;
    void this.apply(name);
  }

  /**
   * 换颜色。
   *
   * ⚠️ 与旧实现相比这里**不再有异步**：颜色是 `Sprite.tint`，
   * 纹理是白色共用的一张。所以悬停/选中换色是**同步生效**的，
   * 不会出现"变亮晚了一帧"。
   */
  setColor(color: number): void {
    if (color === this.currentColor) return;
    this.currentColor = color;
    this.sprite.tint = color;
  }

  /** 当前图标名（调试与测试用）。 */
  get iconName(): IconName {
    return this.currentName;
  }

  /** 当前颜色（调试与测试用）。 */
  get color(): number {
    return this.currentColor;
  }

  /** 纹理是否已经就绪（测试与调试用）。 */
  get ready(): boolean {
    return this.sprite.visible;
  }

  dispose(): void {
    this.disposed = true;
    this.root.destroy({ children: true });
  }
}

/**
 * 生产环境的解码器：用 Pixi 的 `Assets` 光栅化 SVG。
 *
 * 单独导出，让 `main.ts` 只写一行 `setIconDecoder(createAssetsDecoder())`，
 * 不必知道 data URI 的处理细节。
 */
export function createAssetsDecoder(): IconDecoder {
  return (svg: string): Promise<Texture> => {
    // data URI 只转义会破坏 URL 结构的字符，其余保持原样（便于调试）
    const uri = `data:image/svg+xml,${svg
      .replaceAll('%', '%25')
      .replaceAll('#', '%23')
      .replaceAll('<', '%3C')
      .replaceAll('>', '%3E')
      .replaceAll('"', '%22')
      .replaceAll('\n', ' ')}`;
    return Assets.load(uri);
  };
}
