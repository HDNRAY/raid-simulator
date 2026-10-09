import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ICON_NAMES,
  buildSvg,
  clearIconCache,
  iconTexture,
  setIconDecoder,
  svgDataUri,
} from '../../src/render/icons';

/**
 * SVG 图标系统。
 *
 * 这里测的是**可断言的结构属性**，因为踩过的两个坑恰好都是结构问题：
 *
 *   1. `fill` 与 `stroke` 同时设成同色 → 闭合的轮廓图标被填成实心块
 *      （齿轮渲染成圆饼）。
 *   2. `Texture.from(svgDataUri)` 在 Pixi v8 里拿不到图形 → 返回 1×1 的
 *      EMPTY 纹理。这条只能靠"解码器是否被真正调用"来守。
 *
 * 都不需要真实渲染就能验。
 */

describe('图标源码结构', () => {
  it('每个图标都是合法的 SVG 片段', () => {
    for (const name of ICON_NAMES) {
      const svg = buildSvg(name, 0xffffff);
      expect(svg.startsWith('<svg '), name).toBe(true);
      expect(svg.endsWith('</svg>'), name).toBe(true);
      expect(svg).toContain('viewBox="0 0 24 24"');
    }
  });

  it('【关键】默认 fill="none" —— 否则轮廓图标会被填成实心块', () => {
    /**
     * 根因记录：早期写成 `fill="${hex}" stroke="${hex}"`，本意是
     * "让实心图形也能拿到颜色"，结果齿轮这种闭合路径全被填满，
     * 渲染出来是一个圆饼而不是齿轮轮廓。
     */
    for (const name of ICON_NAMES) {
      const svg = buildSvg(name, 0xffffff);
      // 全局属性里必须是 none
      expect(svg).toMatch(/<svg[^>]*fill="none"/);
      // 且不允许出现"全局 fill 被设成颜色"
      const svgTag = svg.slice(0, svg.indexOf('>'));
      expect(svgTag).not.toMatch(/fill="#/);
    }
  });

  it('需要实心的图标显式声明 fill —— 模板占位符必须被替换掉', () => {
    for (const name of ICON_NAMES) {
      const svg = buildSvg(name, 0x123456);
      // 占位符不能留在产物里
      expect(svg, name).not.toContain('{{color}}');
    }
    // 暂停 / 播放确实是实心的
    expect(buildSvg('pause', 0xffffff)).toContain('fill="#ffffff"');
    expect(buildSvg('play', 0xffffff)).toContain('fill="#ffffff"');
  });

  it('颜色被注入到 stroke，且格式是 6 位十六进制', () => {
    const svg = buildSvg('gear', 0x00ff00);
    expect(svg).toContain('stroke="#00ff00"');
    // 补零：0x0000ff 不能变成 "#ff"
    expect(buildSvg('gear', 0x0000ff)).toContain('stroke="#0000ff"');
  });

  it('图标名表与实现同步（不漏、不多）', () => {
    expect(ICON_NAMES).toContain('gear');
    expect(ICON_NAMES).toContain('close');
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(5);
  });
});

describe('data URI 编码', () => {
  it('转义会被 URL 解析破坏的字符', () => {
    const uri = svgDataUri('<svg a="b"/>');
    // `<` `>` `"` 必须被转义，否则某些浏览器会截断 URI
    expect(uri).not.toContain('<');
    expect(uri).not.toContain('>');
    expect(uri).not.toContain('"');
    // `#`（颜色）也必须转义，否则会被当成 fragment 分隔符
    expect(svgDataUri(buildSvg('gear', 0xffffff))).not.toContain('#');
  });

  it('换行被压平（避免 URI 里出现裸换行）', () => {
    expect(svgDataUri('a\nb')).not.toContain('\n');
  });

  it('前缀正确，能被当作图片地址使用', () => {
    expect(svgDataUri('x')).toMatch(/^data:image\/svg\+xml,/);
  });
});

describe('纹理缓存', () => {
  beforeEach(() => {
    clearIconCache();
    setIconDecoder(undefined as never);
  });

  it('没有注册解码器时返回 undefined，而不是抛错', async () => {
    // 图标是装饰：缺解码器不该让界面起不来
    await expect(iconTexture('gear', 0xffffff)).resolves.toBeUndefined();
  });

  it('同一个图标同一颜色只解码一次', async () => {
    const decode = vi.fn(async () => ({ id: 'fake-texture' }) as never);
    setIconDecoder(decode);

    const a = await iconTexture('gear', 0xffffff);
    const b = await iconTexture('gear', 0xffffff);
    expect(a).toBe(b);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('【关键】不同颜色是不同纹理 —— 颜色是注入进 SVG 的，不能共用缓存', async () => {
    const decode = vi.fn(async (uri: string) => ({ uri }) as never);
    setIconDecoder(decode);

    await iconTexture('gear', 0xffffff);
    await iconTexture('gear', 0x00ff00);
    expect(decode).toHaveBeenCalledTimes(2);
    // 两次解码拿到的 SVG 颜色必须不同
    const uris = decode.mock.calls.map((c) => c[0]);
    expect(uris[0]).not.toBe(uris[1]);
  });

  it('并发请求同一个图标只解码一次（不会因为 await 之间而重复）', async () => {
    const decode = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { id: 'x' } as never;
    });
    setIconDecoder(decode);

    await Promise.all([iconTexture('gear', 0xffffff), iconTexture('gear', 0xffffff)]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('解码失败时返回 undefined（一次坏图标不会拖垮界面）', async () => {
    setIconDecoder(async () => {
      throw new Error('decode failed');
    });
    await expect(iconTexture('gear', 0xffffff)).resolves.toBeUndefined();
  });

  it('失败不会被缓存 —— 下次还会重试', async () => {
    let calls = 0;
    setIconDecoder(async () => {
      calls += 1;
      throw new Error('nope');
    });
    await iconTexture('gear', 0xffffff);
    await iconTexture('gear', 0xffffff);
    expect(calls).toBe(2);
  });
});
