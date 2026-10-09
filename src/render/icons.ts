/**
 * SVG 图标。
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
 *   3. **SVG**（当前）：矢量、有标准工具链、美术可以直接给文件。
 *      代价是需要异步解码（见下）。
 *
 * ==================================================================
 * 用法
 * ==================================================================
 *
 * ```ts
 * const icon = new Icon({ pixi, name: 'gear', size: 16, color: 0xb0b0be });
 * icon.root.x = 100;
 * container.addChild(icon.root);
 * ```
 *
 * 图标**异步就绪**：创建时 `root` 里没有图形，解码完成后自动挂上。
 * 所以不要读 `root.width` 来定位 —— 用 `size`。
 *
 * ==================================================================
 * 颜色是构建时注入的，不是运行时染色
 * ==================================================================
 *
 * `buildSvg` 把 `{{color}}` 替换成具体色值。为什么不在运行时染色：
 *
 *   - `stroke="currentColor"` 在纹理上下文里**没有意义**（没有 CSS
 *     继承链），图标会变成透明。
 *   - Pixi 的 `ColorMatrixFilter` 染色是**乘法**：只能压暗、不能提亮，
 *     想从白色染成金色做不到。
 *
 * 所以按颜色生成纹理，缓存也按颜色分键。
 */

import { Texture } from 'pixi.js';
import type { Container, Sprite } from 'pixi.js';
import type { PixiCtor } from '../ui/primitives';

/* ------------------------------------------------------------------ *
 * 图标源码
 * ------------------------------------------------------------------ */

/**
 * 图标路径表。
 *
 * 统一 `viewBox="0 0 24 24"`（Material / Lucide 那套惯例），
 * 于是所有图标坐标系一致，`size` 只需一个数字。
 * 线宽统一 2 —— 在 16–24px 下是清晰与轻盈的平衡点。
 */
const ICONS = {
  /**
   * 齿轮（设置）。
   *
   * **闭合的齿形轮廓**，不是"圆 + 辐条"。
   *
   * 踩过的坑：第一版画成 `<circle>` 加 8 条径向线段，渲染出来
   * 像太阳/雪花而不是齿轮 —— 因为辐条在视觉上属于"内部结构"，
   * 而齿轮的特征是**外缘的齿**。所以这里用一条连续路径，
   * 每个齿由"外弧 → 径向内收 → 内弧 → 外扩"构成。
   *
   * 路径是**算出来再粘进来的**（脚本生成，参数：8 齿、
   * 外半径 9.6、内半径 7.1、齿占 55% 角宽）。外半径取 9.6 而不是
   * 10 是为了给 2px 描边留余量，否则描边会超出 24×24 的 viewBox 被切。
   */
  gear: `<path d="M9.94 2.62A9.6 9.6 0 0 1 14.06 2.62L13.52 5.06A7.1 7.1 0 0 1 15.83 6.02L17.18 3.91A9.6 9.6 0 0 1 20.09 6.82L17.98 8.17A7.1 7.1 0 0 1 18.94 10.48L21.38 9.94A9.6 9.6 0 0 1 21.38 14.06L18.94 13.52A7.1 7.1 0 0 1 17.98 15.83L20.09 17.18A9.6 9.6 0 0 1 17.18 20.09L15.83 17.98A7.1 7.1 0 0 1 13.52 18.94L14.06 21.38A9.6 9.6 0 0 1 9.94 21.38L10.48 18.94A7.1 7.1 0 0 1 8.17 17.98L6.82 20.09A9.6 9.6 0 0 1 3.91 17.18L6.02 15.83A7.1 7.1 0 0 1 5.06 13.52L2.62 14.06A9.6 9.6 0 0 1 2.62 9.94L5.06 10.48A7.1 7.1 0 0 1 6.02 8.17L3.91 6.82A9.6 9.6 0 0 1 6.82 3.91L8.17 6.02A7.1 7.1 0 0 1 10.48 5.06Z"/>
<circle cx="12" cy="12" r="3.2"/>`,

  /** 关闭（×）。 */
  close: `<path d="M6 6l12 12M18 6L6 18" fill="none"/>`,

  /** 暂停：两条实心竖线（细线描边在小尺寸下容易糊）。 */
  pause: `<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="{{color}}"/>
<rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="{{color}}"/>`,

  /** 继续（播放三角，实心）。 */
  play: `<path d="M8 5.4v13.2L19 12z" fill="{{color}}"/>`,

  /** 重开（环形箭头）。 */
  restart: `<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/>
<path d="M20.5 3.5V9h-5.5"/>`,

  /** 提示（感叹号圆圈）。 */
  info: `<circle cx="12" cy="12" r="9"/>
<path d="M12 8h.01M11 12h1v5h1"/>`,
} as const;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[];

/** 默认线宽。 */
const STROKE_WIDTH = 2;

/* ------------------------------------------------------------------ *
 * SVG 组装
 * ------------------------------------------------------------------ */

/**
 * 把图标源码组装成完整的 SVG 字符串。
 *
 * 颜色注入到 `stroke`，并且**只有需要实心的图形才用 `fill`**
 * （见 `{{color}}` 替换）。
 *
 * ⚠️ 根因记录：早期这里同时写了 `fill="${hex}"` 和 `stroke="${hex}"`，
 * 本意是"让实心图形也能拿到颜色"，结果**闭合路径的轮廓图标全被填成
 * 实心块** —— 齿轮渲染出来是一个圆饼。所以默认必须是 `fill="none"`，
 * 由各个图标自己显式声明 `fill="{{color}}"`。
 */
export function buildSvg(name: IconName, color: number): string {
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"',
    ` stroke="${hex}" fill="none" stroke-width="${STROKE_WIDTH}"`,
    ' stroke-linecap="round" stroke-linejoin="round">',
    ICONS[name].replaceAll('{{color}}', hex),
    '</svg>',
  ].join('');
}

/**
 * SVG 字符串 → 可直接给 `Texture.from` 的 data URI。
 *
 * 只转义会破坏 URL 结构的字符，其余保持原样（调试时能直接看懂）。
 */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${svg
    .replaceAll('%', '%25')
    .replaceAll('#', '%23')
    .replaceAll('<', '%3C')
    .replaceAll('>', '%3E')
    .replaceAll('"', '%22')
    .replaceAll('\n', ' ')}`;
}

/* ------------------------------------------------------------------ *
 * 纹理缓存
 * ------------------------------------------------------------------ */

/**
 * 解码器：把一个 SVG 字符串变成纹理。
 *
 * 为什么需要注入这一段：**Pixi v8 里 `Texture.from(svgDataUri)`
 * 拿不到图形** —— 它返回 1×1 的 EMPTY 纹理，并警告"不在 Assets
 * 缓存里"。SVG 必须先由 Pixi 的资源系统光栅化，而那是异步的。
 *
 * 生产代码注入基于 `Assets` 的实现（见 `main.ts`），
 * 测试可以注入一个假的，于是这条路径在 node 里也能测。
 */
export type IconDecoder = (uri: string) => Promise<Texture>;

let decoder: IconDecoder | undefined;

/** 注册解码器（进程启动时调用一次）。 */
export function setIconDecoder(fn: IconDecoder): void {
  decoder = fn;
}

/**
 * 已解码纹理，键为 `名字@颜色`。
 *
 * 按颜色分键是必须的：颜色在构建时就注入进 SVG 了，
 * 不同颜色就是不同的纹理（`stroke="currentColor"` 在纹理上下文里
 * 没有意义，会变成透明）。以后加禁用态也不会互相串。
 */
const textureCache = new Map<string, Texture>();

/** 正在解码的请求（并发请求同一个图标时只解码一次）。 */
const inFlight = new Map<string, Promise<Texture | undefined>>();

/**
 * 取（必要时解码）图标纹理。
 *
 * 解码失败返回 `undefined` 而不是抛错 —— 图标是**装饰**，
 * 少一个图标不该让整个界面起不来。
 */
export function iconTexture(name: IconName, color: number): Promise<Texture | undefined> {
  const key = `${name}@${color.toString(16)}`;
  const cached = textureCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending) return pending;

  if (!decoder) return Promise.resolve(undefined);

  const task = decoder(svgDataUri(buildSvg(name, color)))
    .then((texture) => {
      textureCache.set(key, texture);
      return texture;
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, task);
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
 * 浏览器（或 Pixi 的资源系统）要先解析并光栅化它。
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

  constructor(private readonly options: IconOptions) {
    const { pixi, name, size } = options;
    this.currentName = name;
    this.root = new pixi.Container();
    this.sprite = new pixi.Sprite();
    this.sprite.width = size;
    this.sprite.height = size;
    // 纹理到位前保持不可见，避免闪一个空白方块
    this.sprite.visible = false;
    this.root.addChild(this.sprite);

    void this.apply(name);
  }

  private async apply(name: IconName): Promise<void> {
    const texture = await iconTexture(name, this.options.color);
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

  /** 当前图标名（调试与测试用）。 */
  get iconName(): IconName {
    return this.currentName;
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
