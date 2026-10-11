/**
 * `assetUrl()` 的行为护栏。
 *
 * 它防的是**一个只在线上才暴露的 404**：线上部署在 `/raid/` 子路径
 * （`vite.config.ts` 的 `base`），而硬编码 `/placeholder/...` 会解析到
 * 域名根。本地 dev 的 base 恰好是 `/`，所以这个 bug 在开发时看不见。
 *
 * ⚠️ `BASE_URL` 是**构建期常量**，测试里改不动它。所以这里的断言都写成
 * "对任意 base 值都成立"的性质，而不是硬编码 `/raid/` —— 否则这个测试
 * 会在换部署路径时变成假的。
 */
import { describe, expect, it } from 'vitest';
import { assetUrl } from '../../src/render/assetUrl';

describe('assetUrl', () => {
  it('把路径拼在当前部署 base 之下', () => {
    const url = assetUrl('placeholder/player.png');

    expect(url.startsWith(import.meta.env.BASE_URL)).toBe(true);
    expect(url.endsWith('placeholder/player.png')).toBe(true);
  });

  it('前导斜杠不会拼出双斜杠', () => {
    // `//host/path` 会被浏览器当成**协议相对 URL**，那是完全另一回事
    expect(assetUrl('/placeholder/player.png')).not.toContain('//');
  });

  it('Vite 保证 BASE_URL 以斜杠结尾 —— 直接拼接不会丢掉分隔符', () => {
    expect(import.meta.env.BASE_URL.endsWith('/')).toBe(true);
  });

  it('多个前导斜杠也会被吃掉', () => {
    expect(assetUrl('///placeholder/player.png')).not.toContain('//');
  });
});
