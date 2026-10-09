import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ICON_NAMES, clearIconCache, iconTexture, setIconDecoder } from '../../src/render/icons';

/**
 * SVG 图标系统。
 *
 * 图标本体是 `src/render/icons/*.svg` **独立文件**（经 Vite 的 `?raw`
 * 在构建时内联成字符串）。颜色是运行时的 `Sprite.tint`，源文件统一白色。
 *
 * 这里测的是**可断言的结构属性**，因为踩过的坑恰好都是结构问题：
 *
 *   1. 根元素 `fill` 与 `stroke` 同时设成具体色 → 闭合的轮廓图标
 *      被填成实心块（齿轮渲染成一个圆饼）。
 *   2. `Texture.from(svg)` 在 Pixi v8 里拿不到图形 → 返回 1×1 的
 *      EMPTY 纹理。这条只能靠"解码器是否被真正调用"来守。
 *   3. 源文件里若残留 `{{color}}` 占位符（旧做法的遗留），
 *      浏览器会把它当成非法颜色 → 整个图标变透明。
 *
 * 都不需要真实渲染就能验。
 */

describe('图标源文件结构', () => {
  it('每个图标都是完整的 SVG（含 viewBox 0 0 24 24）', async () => {
    const { readFileSync } = await import('node:fs');
    for (const name of ICON_NAMES) {
      const svg = readFileSync(new URL(`../../src/render/icons/${name}.svg`, import.meta.url), 'utf8');
      expect(svg, name).toMatch(/<svg[\s\S]*<\/svg>/);
      expect(svg, name).toContain('viewBox="0 0 24 24"');
      // 坐标系一致才能只用一个 size 数字缩放
    }
  });

  it('【关键】根元素 fill="none" —— 否则轮廓图标会被填成实心块', async () => {
    /**
     * 根因记录：早期写成 `fill="#fff" stroke="#fff"`，本意是
     * "让实心图形也能拿到颜色"，结果齿轮这种闭合路径全被填满，
     * 渲染出来是一个圆饼而不是齿轮轮廓。
     *
     * 独立文件之后这条更容易被破坏（美术导出时经常带 fill），
     * 所以专门守住。
     */
    const { readFileSync } = await import('node:fs');
    for (const name of ICON_NAMES) {
      const svg = readFileSync(new URL(`../../src/render/icons/${name}.svg`, import.meta.url), 'utf8');
      expect(svg, `${name} 的根元素应该是 fill="none"`).toMatch(/<svg[^>]*fill="none"/);
    }
  });

  it('源文件是**白色**的 —— 颜色由运行时 tint 决定', async () => {
    const { readFileSync } = await import('node:fs');
    for (const name of ICON_NAMES) {
      const svg = readFileSync(new URL(`../../src/render/icons/${name}.svg`, import.meta.url), 'utf8');
      // 不允许出现非白色的具体色值（十六进制或 rgb()）
      const colors = [...svg.matchAll(/(?:stroke|fill)="([^"]+)"/g)]
        .map((m) => m[1]!)
        .filter((c) => c !== 'none');
      for (const c of colors) {
        expect(c, `${name} 里有非白色：${c}`).toBe('#ffffff');
      }
    }
  });

  it('没有残留 {{color}} 占位符（旧做法的遗留）', async () => {
    const { readFileSync } = await import('node:fs');
    for (const name of ICON_NAMES) {
      const svg = readFileSync(new URL(`../../src/render/icons/${name}.svg`, import.meta.url), 'utf8');
      expect(svg, name).not.toContain('{{');
    }
  });

  it('实心图标（暂停 / 播放）显式声明 fill 且不用描边', async () => {
    const { readFileSync } = await import('node:fs');
    for (const name of ['pause', 'play'] as const) {
      const svg = readFileSync(new URL(`../../src/render/icons/${name}.svg`, import.meta.url), 'utf8');
      expect(svg, name).toContain('fill="#ffffff"');
    }
  });
});

describe('图标纹理缓存', () => {
  beforeEach(() => {
    clearIconCache();
    setIconDecoder(undefined);
  });

  it('没有解码器时返回 undefined，而不是抛错', async () => {
    // 图标是**装饰**：少一个图标不该让整个界面起不来
    await expect(iconTexture('gear')).resolves.toBeUndefined();
  });

  it('解码器会收到 SVG 文本（而不是什么空串）', async () => {
    const seen: string[] = [];
    setIconDecoder((svg) => {
      seen.push(svg);
      return Promise.resolve({} as never);
    });
    await iconTexture('gear');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('<svg');
    expect(seen[0]).toContain('viewBox="0 0 24 24"');
  });

  it('【关键】缓存键**不含颜色** —— 每种图标只解码一次', async () => {
    /**
     * 这是"独立文件 + 运行时 tint"相对旧实现（把颜色注入 SVG 再光栅化）
     * 的主要收益：**用多少种颜色都不增加解码次数**。
     *
     * 旧实现里缓存键是 `名字@颜色`，所以 hover 换色会再解码一张纹理。
     */
    const decode = vi.fn(() => Promise.resolve({} as never));
    setIconDecoder(decode);
    await iconTexture('gear');
    await iconTexture('gear');
    await iconTexture('gear');
    expect(decode).toHaveBeenCalledTimes(1);

    // 换个图标才需要再解码
    await iconTexture('close');
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('并发请求同一个图标只解码一次', async () => {
    const decode = vi.fn(
      () => new Promise<never>((resolve) => setTimeout(() => resolve({} as never), 5)),
    );
    setIconDecoder(decode);
    await Promise.all([iconTexture('info'), iconTexture('info'), iconTexture('info')]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('解码失败返回 undefined 且不污染缓存（下次会重试）', async () => {
    const bad = vi.fn(() => Promise.reject(new Error('boom')));
    setIconDecoder(bad);
    await expect(iconTexture('play')).resolves.toBeUndefined();
    expect(bad).toHaveBeenCalledTimes(1);

    const good = vi.fn(() => Promise.resolve({} as never));
    setIconDecoder(good);
    await expect(iconTexture('play')).resolves.toBeDefined();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('图标名列表与文件一一对应（防止加了文件忘了登记）', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = new URL('../../src/render/icons/', import.meta.url);
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.slice(0, -4))
      .sort();
    expect([...ICON_NAMES].sort()).toEqual(onDisk);
  });
});
