/**
 * **每个 Boss 一张战斗背景**。
 *
 * ==================================================================
 * 为什么是"一张表"而不是 if/else
 * ==================================================================
 *
 * 加 Boss 是**常规操作**（本次就一次加了 5 个）。如果配对关系散在
 * `if (bossId === ...)` 里，加 Boss 的人要同时改三处（roster、素材表、
 * 背景判断），漏一处的表现是"某个 Boss 用别的 Boss 的背景"——
 * 不崩、不报错，只是看着不对，很难被发现。
 *
 * 收成一张表之后，**加 Boss = 加一行**（"路径 → 谁用"），
 * 而"每个 Boss 都配到了"由 `tests/web/spriteAssets.test.ts` 盯着。
 *
 * ==================================================================
 * ⚠️ 素材是 320×100 的**背景层**，而画布是 960×540
 * ==================================================================
 *
 * `public/fd2/images/BG_BG_<NNN>.png` 是原作的**背景层**（320×100），
 * 不是整屏图。放大到 960×540 只能**非等比拉伸**（横向 ×3、纵向 ×5.4）。
 * 这是有意接受的观感代价：改成等比 ×3 会在上下各留 120px 黑边，
 * 那更难看。拉伸由 `parts/backdrop.ts` 执行（设 `Sprite.width/height`），
 * 这里只给路径。
 */

import { assetUrl } from './assetUrl';

/**
 * Boss id → **相对 `public/` 的背景路径**（一行一个 Boss）。
 *
 * 配对由玩家批准："傲慢 024 / 色欲 018 / 嫉妒 035 / 暴食 014 /
 * 暴怒 048 / 懒惰 047 / 贪婪 010" —— **不要**按文件名顺序自行调整。
 *
 * ⚠️ **傲慢从 `031`（火焰地板）改成了 `024`（石造废墟）**：
 * 火焰地板与「火魔神」精灵**同色系**，精灵糊在背景里（暗化降到 0.18
 * 之后尤其明显）。当时想过"靠加深暗化压住"，但那是拿可读性换对比度 ——
 * **换背景**才是对的解。火焰那几张留给暴怒（暗色斗篷，压在火上反而清楚）。
 *
 * ⚠️ 用 `Map` 而不是对象字面量：取 `BOSS_BG[bossId]` 时，`'constructor'`
 * 这种**原型上的键**会返回一个函数而不是 `undefined`，于是会拼出一个
 * 不存在的 URL（不崩、只是 404）。`Map` 没有这个问题。
 */
const BOSS_BG = new Map<string, string>([
  ['meiichiro', 'fd2/images/BG_BG_024.png'],
  ['lust', 'fd2/images/BG_BG_018.png'],
  ['envy', 'fd2/images/BG_BG_035.png'],
  ['gluttony', 'fd2/images/BG_BG_014.png'],
  ['wrath', 'fd2/images/BG_BG_048.png'],
  ['sloth', 'fd2/images/BG_BG_047.png'],
  ['greed', 'fd2/images/BG_BG_010.png'],
]);

/**
 * 某个 Boss 的战斗背景 URL。
 *
 * @returns 该 Boss 的背景；**不认识的 id 返回 `undefined`** ——
 *   调用方（`parts/backdrop.ts`）据此回退到程序化绘制的夜空。
 *   ⚠️ 不回退到"随便挑一张"：那会让"新增 Boss 忘了配背景"看起来像是
 *   美术风格变了，而不是配置漏了。
 */
export function bossBackdropUrl(bossId: string): string | undefined {
  const path = BOSS_BG.get(bossId);
  /**
   * ⚠️ 必须走 `assetUrl()`：线上部署在 `/raid/` 子路径下，
   * 硬编码 `/fd2/...` 会解析到域名根而 404（本地 dev 是 `/`，看不出来）。
   */
  return path === undefined ? undefined : assetUrl(path);
}

/** 已配好背景的 Boss id（测试与调试用）。 */
export function backdropBossIds(): readonly string[] {
  return [...BOSS_BG.keys()];
}
