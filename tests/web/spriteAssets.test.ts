import { describe, expect, it } from 'vitest';
import manifest from '../../public/fd2/rgba/manifest.json';
import { assetUrl } from '../../src/render/assetUrl';
import { backdropBossIds, bossBackdropUrl } from '../../src/render/bossBackdrops';
import { SPRITES, animUrls, frameUrl, spriteFor } from '../../src/render/spriteAssets';
import { BOSS_ROSTER, PLAYER_ROSTER, isDeveloping } from '../../src/data/roster';

/**
 * **素材表 ↔ 权威清单（`manifest.json`）的核对**。
 *
 * 需求："`public/fd2/rgba/manifest.json` ← 先读它，它是权威清单"。
 *
 * 为什么要有这一组测试：表现层的帧数/权重**写死在代码里**（不是启动时
 * fetch，理由见 `spriteAssets.ts` 的文件头）。写死就有"与素材脱节"的风险，
 * 而脱节的表现是**静默的**：多出来的帧文件没人用（无所谓），少算的帧
 * 永远播不到（"人物动作少一截"）。所以由测试来对账。
 */

/** manifest 里的一段动画（`{ frames, delays }`）。 */
interface ManifestAnim {
  readonly frames: readonly string[];
  readonly delays: readonly number[];
}

/**
 * 把 JSON 当**未经验证的数据**收窄成已知形状。
 *
 * ⚠️ 这不是绕过类型检查：它把"这里确实是一份外部数据"写在了名字上
 * （AGENTS.md §1 允许"有名字的解析器"）。
 */
function asManifest(value: unknown): Record<string, { idle: ManifestAnim; attack: ManifestAnim }> {
  const out: Record<string, { idle: ManifestAnim; attack: ManifestAnim }> = {};
  const anim = (raw: unknown): ManifestAnim => {
    if (typeof raw !== 'object' || raw === null) return { frames: [], delays: [] };
    const frames = (raw as { frames?: unknown }).frames;
    const delays = (raw as { delays?: unknown }).delays;
    return {
      frames: Array.isArray(frames) ? frames.filter((x): x is string => typeof x === 'string') : [],
      delays: Array.isArray(delays) ? delays.filter((x): x is number => typeof x === 'number') : [],
    };
  };
  if (typeof value !== 'object' || value === null) return out;
  for (const [slot, raw] of Object.entries(value)) {
    const node = raw as { idle?: unknown; attack?: unknown };
    out[slot] = { idle: anim(node.idle), attack: anim(node.attack) };
  }
  return out;
}

const MANIFEST = asManifest(manifest);

/** 把 `assetUrl()` 拼出来的 base 前缀去掉，与 manifest 的相对路径比。 */
function stripBase(url: string): string {
  return url.replace(assetUrl(''), '');
}

describe('素材表与 manifest.json 一致', () => {
  it('manifest 读到了 10 个 slot（素材备好了）', () => {
    expect(Object.keys(MANIFEST)).toHaveLength(10);
  });

  it('⚠️ 每个 slot 的帧数、每帧权重都与 manifest 逐项相等', () => {
    for (const sprite of SPRITES) {
      const slot = MANIFEST[sprite.slot];
      expect(slot, `manifest 里没有 slot ${sprite.slot}`).toBeDefined();
      expect(sprite.idle, `${sprite.slot} 的 idle 权重`).toEqual(slot?.idle.delays);
      expect(sprite.attack, `${sprite.slot} 的 attack 权重`).toEqual(slot?.attack.delays);
    }
  });

  it('⚠️ 生成的帧 URL 与 manifest 里的路径逐张相等', () => {
    /**
     * 这是"帧数"之外的第二道对账：编号规则（`f00` 两位补零）与目录结构。
     * 素材换成 `f1.png` 或 `frame-000.png` 时，权重断言仍然通过，
     * 只有这条会红。
     */
    for (const sprite of SPRITES) {
      const slot = MANIFEST[sprite.slot];
      if (slot === undefined) continue;
      expect(animUrls(sprite).idle.map(stripBase)).toEqual([...slot.idle.frames]);
      expect(animUrls(sprite).attack.map(stripBase)).toEqual([...slot.attack.frames]);
    }
  });

  it('⚠️ 路径与 manifest 一样**相对 `public/`**（开头是 fd2/，没有二次前缀）', () => {
    for (const sprite of SPRITES) {
      for (const url of animUrls(sprite).idle) {
        expect(stripBase(url).startsWith('fd2/rgba/')).toBe(true);
        expect(stripBase(url)).not.toContain('fd2/fd2');
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

  it('背景路径也带 base 前缀、且指向 fd2/images 下的文件', () => {
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
    expect(url === undefined ? '' : stripBase(url)).toBe('fd2/images/BG_BG_024.png');
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

  it('本轮新增的 5 个 Boss + 2 个人物都在名单里（灰掉 + 标开发中）', () => {
    for (const id of ['kaili', 'daixuan', 'envy', 'gluttony', 'wrath', 'sloth', 'greed']) {
      expect(isDeveloping(id), `${id} 应当是开发中`).toBe(true);
    }
  });

  it('已完成的两个 Boss 不在名单里（需求：替换掉程序化绘制，可以打）', () => {
    expect(isDeveloping('meiichiro')).toBe(false);
    expect(isDeveloping('lust')).toBe(false);
  });
});
