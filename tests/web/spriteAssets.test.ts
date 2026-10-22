import { describe, expect, it } from 'vitest';
import { assetUrl } from '../../src/render/assetUrl';
import { backdropBossIds, bossBackdropUrl } from '../../src/render/bossBackdrops';
import { SPRITES, animUrls, frameUrl, spriteFor } from '../../src/render/spriteAssets';
import { BOSS_ROSTER, PLAYER_ROSTER, isDeveloping } from '../../src/data/roster';

/**
 * **素材表（`spriteAssets.ts`）的自证**。
 *
 * ==================================================================
 * ⚠️⚠️ 这一组**不读磁盘上的素材**（用户 2026-10-13 拍板）——
 * 它只验 URL 的**形状**。⚠️ 2026-10-14 起运行时会读的素材被拷进了
 * `public/game-art/`（**跟踪**，见那里的 README），但这一组的判据不变：
 * 仍然只验形状，不去"判断素材"。
 * ==================================================================
 *
 * 原先这里有一组"素材表 ↔ 权威清单（`public/fd2/rgba/manifest.json`）"
 * 的逐项核对（帧数 + 每帧 delay + 每张路径）。它读的是**磁盘上的素材**，
 * 而 `public/fd2/`（54MB 第三方素材，汉堂 1995，见
 * `THIRD-PARTY-NOTICES.md`）是 **gitignore** 的、**不随仓库分发** ——
 * 于是：
 *
 *   1. **本地有 ≠ 仓库有。** CI 是**全新检出**，那里没有这个文件。
 *   2. 更根本的：**"素材里到底有几帧、从哪来"不是这个仓库该保证的事。**
 *      用户原话："**他不应该读 没进的**，**他甚至都不应该做这个判断**
 *      —— **不需要判断 那个头像是否来自哪里**"（原话针对头像，
 *      判据是同一套）。
 *
 * ⚠️ 中途一度用 `try/catch + describe.skipIf(素材不在)` 兜着（本地跑、
 * CI 跳过）。那是"**承认它该读、只是这次读不到**"—— 用户明确否掉了
 * 这个前提。所以那份核对**整体删除**，**不是**改成跳过。
 *
 * 这里留下的全部是**仓库内部能自证**的东西：出战名单 ↔ 素材表 ↔
 * 背景表（都是仓库里的常量），以及**算出来的帧 URL 的形状**（常量契约）。
 *
 * ⚠️ 代价（有意接受、记在这里）：写死的帧数/权重**不再与素材自动对账**
 * （这笔账也记在 `src/render/spriteAssets.ts` 文件头）。理由是另一条路
 * 更糟：单测依赖 gitignored 素材 → 要么 **CI 必红**（模块顶层读就抛）、
 * 要么**整组静默跳过**（"没测"伪装成"测了"）。
 */

/** 把 `assetUrl()` 拼出来的 base 前缀去掉，与"相对 `public/`"的路径比。 */
function stripBase(url: string): string {
  return url.replace(assetUrl(''), '');
}

describe('帧 URL 的形状（仓库内自证，不读素材）', () => {
  it('⚠️ 路径相对 `public/`（开头是 `game-art/`，没有二次前缀）', () => {
    for (const sprite of SPRITES) {
      for (const url of animUrls(sprite).idle) {
        expect(stripBase(url).startsWith('game-art/frames/')).toBe(true);
        expect(stripBase(url)).not.toContain('game-art/game-art');
      }
    }
  });

  it('【关键】所有帧 URL 都带 base 前缀（线上部署在 /raid/ 子路径下）', () => {
    const prefix = assetUrl('');
    for (const sprite of SPRITES) {
      const urls = [...animUrls(sprite).idle, ...animUrls(sprite).attack];
      for (const url of urls) expect(url.startsWith(prefix)).toBe(true);
    }
    expect(frameUrl('boss-pride', 'idle', 0).startsWith(prefix)).toBe(true);
  });

  it('两位帧号补零（f00 / f11），不是 f0 / f1', () => {
    const url = stripBase(frameUrl('player-kaili', 'attack', 11));
    expect(url.endsWith('/f11.png')).toBe(true);
  });
});

describe('每个出战单位都配到了素材与背景', () => {
  it('players 全部有素材', () => {
    for (const entry of PLAYER_ROSTER) {
      expect(spriteFor(entry.id), `玩家 ${entry.id} 没有素材`).toBeDefined();
    }
  });

  it('bosses 全部有素材', () => {
    for (const entry of BOSS_ROSTER) {
      expect(spriteFor(entry.id), `Boss ${entry.id} 没有素材`).toBeDefined();
    }
  });

  it('⚠️ bosses 全部有**战斗背景**（需求：每个 Boss 一个背景）', () => {
    for (const entry of BOSS_ROSTER) {
      expect(bossBackdropUrl(entry.id), `Boss ${entry.id} 没有背景`).toBeDefined();
    }
  });

  it('背景表里没有多余 / 拼错的 id（否则说明有人改错了 key）', () => {
    const rosterIds = new Set(BOSS_ROSTER.map((e) => e.id));
    for (const id of backdropBossIds()) {
      expect(rosterIds.has(id), `背景表里的 ${id} 不在 BOSS_ROSTER 里`).toBe(true);
    }
  });

  it('背景路径也带 base 前缀、且指向 `game-art/backdrops` 下的文件', () => {
    const url = bossBackdropUrl('meiichiro');
    expect(url).toBeDefined();
    expect(url?.startsWith(assetUrl(''))).toBe(true);
    /**
     * ⚠️ 这里**故意写死具体编号**：配对是玩家逐张批准的，写死才能挡住
     * "顺手换了一张"这种悄悄改动。
     *
     * 傲慢原本是 `031`（火焰地板），后改成 `024`（石造废墟）——
     * 原因是**火魔神精灵与火焰地板同色系，糊在背景里**。所以改动时
     * 这行会失败，提醒改的人"你动了玩家批准过的配对"。这是有意的。
     */
    expect(url === undefined ? '' : stripBase(url)).toBe('game-art/backdrops/BG_BG_024.png');
  });

  it('不认识的 Boss id 返回 undefined（回退程序化夜空，不瞎挑一张）', () => {
    expect(bossBackdropUrl('nobody')).toBeUndefined();
    /**
     * ⚠️ `'constructor'` 这种**原型上的键**不能命中：用对象字面量存表时
     * `BOSS_BG['constructor']` 会返回一个函数，于是拼出一个不存在的 URL
     * （不崩、只是 404）。表用 `Map` 就是为了这个。
     */
    expect(bossBackdropUrl('constructor')).toBeUndefined();
  });
});

describe('开发中名单与现实一致', () => {
  it('至少各有一个**可以打**的人物与 Boss（默认选择必须可用）', () => {
    expect(PLAYER_ROSTER.some((e) => !isDeveloping(e.id))).toBe(true);
    expect(BOSS_ROSTER.some((e) => !isDeveloping(e.id))).toBe(true);
  });

  it('还没做完的单位**一个都没有了**（黛玄 2026-10-22 出师）', () => {
    /**
     * ⚠️ 2026-10-12：**凯丽从这里删掉了** —— 她有了自己的 5 招
     * （拳 / 轰 / 凝 / 截 / 闪）与 120 血上限，可以开战
     * （见 `data/roster.ts` 的 `DEVELOPING`）。
     *
     * ⚠️ 2026-10-14：**嫉妒也删掉了** —— 它有四招（剜 / 殁 / 夺息 / 妒火）
     * 与自己的行为表，可以进肉鸽的 Boss 池（同上）。
     *
     * ⚠️ 同一天：**贪婪也删掉了** —— 敛财（9 层）+「弱点」被动 + 两招伤害。
     * ⚠️ 同一天：**懒惰也删掉了** —— 睡眠 +「怠惰」回血 + 两招伤害。
     */
    /**
     * ⚠️ 2026-10-22：**黛玄出师**（弹/波/破/盾/愈 + 血量 100）⇒ `DEVELOPING`
     * 清空 ⇒ 这个循环**没有元素**了。断言反过来说："名单里没人还灰着"。
     */
    expect(isDeveloping('kaili'), '凯丽已经做完了，不该还标开发中').toBe(false);
    expect(isDeveloping('daixuan'), '黛玄 2026-10-22 出师了，不该还标开发中').toBe(false);
  });

  it('已完成的**七个** Boss 都不在名单里（需求：替换掉程序化绘制，可以打）', () => {
    expect(isDeveloping('meiichiro')).toBe(false);
    expect(isDeveloping('lust')).toBe(false);
    expect(isDeveloping('envy')).toBe(false);
    expect(isDeveloping('greed')).toBe(false);
    expect(isDeveloping('sloth')).toBe(false);
    expect(isDeveloping('gluttony')).toBe(false);
    expect(isDeveloping('wrath')).toBe(false);
  });
});
