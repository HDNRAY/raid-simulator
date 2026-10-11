/**
 * 把 `public/` 下的资源路径拼成**能在子路径部署下工作**的 URL。
 *
 * ==================================================================
 * 为什么需要这个函数
 * ==================================================================
 *
 * 线上部署在 `https://hdnray.github.io/raid/`（见 `vite.config.ts` 的
 * `base: '/raid/'`）。而 `public/` 下的文件是按 **base 前缀**提供的。
 *
 * 所以硬编码 `/placeholder/x.png` 会解析到**域名根**
 * （`https://hdnray.github.io/placeholder/x.png`）—— **线上必然 404**。
 *
 * ⚠️ 这个 bug **在本地开发时看不出来**：dev 下 `base` 是 `/`，
 * 根路径恰好就是对的。等发现时已经在线上挂了。
 *
 * `import.meta.env.BASE_URL` 在 dev 是 `/`、构建后是 `/raid/`，
 * 且 **Vite 保证它以 `/` 结尾**，所以直接拼接即可。
 *
 * ==================================================================
 * 用法
 * ==================================================================
 *
 * ```ts
 * import { assetUrl } from '../assetUrl';
 * const SPRITE_URL = assetUrl('placeholder/player.png');
 * ```
 *
 * 传参时**不要带前导斜杠**（带了也会被规范化掉，但别依赖这个）。
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base}${path.replace(/^\/+/, '')}`;
}
