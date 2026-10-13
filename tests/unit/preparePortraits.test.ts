import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PORTRAITS, PORTRAIT_PIXELS, portraitFor, portraitUrl } from '../../src/render/portraitAssets';
import { PLAYER_ROSTER } from '../../src/data/roster';
import { SPRITES } from '../../src/render/spriteAssets';

/**
 * ==================================================================
 * 对话头像的**配对**（用户点名："索尔 凯丽 索菲亚 3 个"）
 * ==================================================================
 *
 * 用户原话："去 fd 资源里，找到 **索尔 凯丽 索菲亚** 3 个人的**说话的头像**
 * 放在我们 3 个角色名字的右边"。
 *
 * ⚠️ 这一份**对着素材清单核**（`public/fd2/INDEX.html` 的「对话头像」表）：
 *   1. 每个编号对应的 `alt` 必须**等于**我在注释里写的那个名字
 *      （否则"凭什么说 DATO_000 是索爾"就没有证据）
 *   2. PNG 必须真的存在、真的是 80×80（否则运行时加载失败**不报错**，
 *      只是卡片上少一颗头像 —— 最难发现的那种）
 *   3. 配对必须与战斗立绘（`spriteAssets`）**指向同一个人**：
 *      否则会出现"战斗里是凯丽、卡片上是索菲亚"
 *
 * ⚠️ 素材方的名字（那三个汉字）写**在测试里**（渲染层不许硬编码中文
 * 文案 —— eslint `raid/i18n/no-hardcoded-cjk`）。测试不是渲染层，
 * 而那三个名字正是"配对可复核"的凭据。
 */

const INDEX_HTML = readFileSync(new URL('../../public/fd2/INDEX.html', import.meta.url), 'utf8');

/** 素材清单里，"对话头像"那一节每个编号的 `alt`（= 素材方的角色名）。 */
function indexPortraitAlt(number: string): string | undefined {
  const re = new RegExp(`portraits/DATO_${number}_m0\\.png"[^>]*alt="([^"]+)"`);
  return re.exec(INDEX_HTML)?.[1];
}

describe('配对：编号 ↔ 素材方的名字（对着 INDEX.html 核）', () => {
  it('玩家名单里的三个人**都有**对话头像（一个都不能少）', () => {
    for (const entry of PLAYER_ROSTER) {
      expect(portraitFor(entry.id), `${entry.id} 没有配头像`).toBeDefined();
    }
  });

  it('【关键】每个编号在素材清单里真的是那个人', () => {
    /**
     * ⚠️ 这三对是**需求点名**的：索爾 → 林晚风、凱麗 → 凯丽、
     * 索菲亞 → 黛玄。依据（性别 / 定位 / 同名）写在
     * `src/render/portraitAssets.ts` 的文件头。
     */
    expect(indexPortraitAlt('000')).toBe('索爾');
    expect(indexPortraitAlt('012')).toBe('凱麗');
    expect(indexPortraitAlt('011')).toBe('索菲亞');
    expect(portraitFor('player')?.number).toBe('000');
    expect(portraitFor('kaili')?.number).toBe('012');
    expect(portraitFor('daixuan')?.number).toBe('011');
  });

  it('【关键】与战斗立绘指向**同一个人**（否则战斗里是凯丽、卡片上是索菲亚）', () => {
    /**
     * `spriteAssets` 的 slot 名里带着素材方的名字（`player-linwanfeng`
     * 就是索爾那一套），而这里是对话头像的编号 —— 两者必须一一对上。
     */
    const slotOf = (id: string): string | undefined => SPRITES.find((s) => s.id === id)?.slot;
    expect(slotOf('player')).toBe('player-linwanfeng');
    expect(slotOf('kaili')).toBe('player-kaili');
    expect(slotOf('daixuan')).toBe('player-daixuan');
    /** 三套 slot 互不相同（配对不是"复制一份"）。 */
    const slots = PLAYER_ROSTER.map((e) => slotOf(e.id));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('没有炁机 / Boss 的头像（需求只给了 3 个角色）', () => {
    expect(portraitFor('meiichiro')).toBeUndefined();
    expect(portraitFor('vitality')).toBeUndefined();
    expect(PORTRAITS).toHaveLength(3);
  });
});

describe('素材文件：真的存在、真的是 80×80', () => {
  it('素材常量与 PNG 文件头一致（`PORTRAIT_PIXELS` 不许猜）', () => {
    for (const asset of PORTRAITS) {
      const path = new URL(`../../public/fd2/portraits/DATO_${asset.number}_m0.png`, import.meta.url);
      const buf = readFileSync(path);
      /** PNG 的 IHDR：宽 / 高各 4 字节（大端），跟在 8 字节签名 + 4 类型 + 4 长度之后。 */
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width, `${asset.number} 宽`).toBe(PORTRAIT_PIXELS);
      expect(height, `${asset.number} 高`).toBe(PORTRAIT_PIXELS);
    }
  });

  it('URL 指向 `public/fd2/portraits/`（拼错就是"头像永远不出现"）', () => {
    const url = portraitUrl(PORTRAITS[0]!);
    expect(url).toContain('fd2/portraits/DATO_000_m0.png');
  });
});
