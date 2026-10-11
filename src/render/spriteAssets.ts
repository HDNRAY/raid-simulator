/**
 * **FD2 像素素材表**：谁用哪套帧、每帧多久、渲染放多大。
 *
 * ==================================================================
 * 这个文件回答三个问题，一个不多
 * ==================================================================
 *
 *   1. 出战单位的 id → 素材 slot（`public/fd2/rgba/<slot>/`）
 *   2. 每个 slot 两段动画的**每帧权重**（`manifest.json` 的 `delays`）
 *   3. 画面里放多大（`size`，逐个体）
 *
 * 表现层的其余部分在 `actors/ActorSprite.ts`（加载 / 切帧 / 淡出），
 * 帧选择规则在 `spriteAnim.ts`（读条进度 → 帧号）。**这里只有数据**。
 *
 * ==================================================================
 * ⚠️ 权重为什么写死在代码里，而不是启动时 fetch manifest.json
 * ==================================================================
 *
 * `public/fd2/rgba/manifest.json` 是**权威清单**，但它是运行期资源：
 * fetch 它意味着"素材表要等一个网络往返才可用"，而**加载失败时帧数会
 * 变成 0** —— 表现成"人物只剩第一帧"（不报错、只是不动）。
 *
 * 所以这里写死，再用 `tests/web/spriteAssets.test.ts` 里的断言**读
 * `manifest.json` 逐项核对**（帧数 + 每帧 delay + 每张路径）：对不上就
 * 测试红，玩家看不到。这与仓库里"素材清单走测试而不是走运行期"一致。
 *
 * ⚠️ 路径是**算出来的**（`slot + anim + 两位帧号`），不是逐条抄的：
 * 逐条抄 200 张路径只会让这个文件变成一堵墙，而"算得对不对"由上面那条
 * 测试逐张比对 manifest 来保证。拼路径时**只调一次 `assetUrl()`** ——
 * manifest 里的路径本来就相对 `public/`（开头就是 `fd2/`），
 * 不要自己再加一层前缀。
 *
 * ==================================================================
 * ⚠️ 尺寸：素材是按 320×180 时代的分辨率出的
 * ==================================================================
 *
 * `size` 是**画布上的缩放**，参照物是战斗场景的逻辑坐标（960×540）
 * 与旧的程序化形象：
 *   - 玩家旧形象高约 84–118 → 新素材缩到 **≈140**
 *   - Boss 旧形象高约 137（192 × 0.72）→ 新素材缩到 **≈140**
 *
 * 玩家素材窄（66–103 宽），所以放大后**横向仍离 Boss 很远**：
 * `x = 300` 处最宽 124，Boss 在 `x = 630` 处最宽 181 —— 中间还空着
 * 一大段给飘字（这也正是"中间留空"的构图要求）。
 */

import { assetUrl } from './assetUrl';
import type { FrameWeights } from './spriteAnim';

/** 一个 slot 的静态描述。 */
export interface CharacterSprite {
  /**
   * 出战单位的 id（`data/roster.ts` 里的 `RosterEntry.id`）。
   *
   * ⚠️ 不用素材 slot 名当 id：id 会进存档（`settingsStore`）与战斗日志，
   * 改素材名不该让玩家的存档失效。
   */
  readonly id: string;
  /**
   * 素材 slot —— 相对 `public/fd2/rgba/` 的目录名。
   *
   * ⚠️ 必须**逐字**等于 `manifest.json` 的顶层键，否则帧 URL 全 404，
   * 而表现是"人物不出现"（回退图形顶上）—— 本地 dev 一样看不出来
   * 是路径错还是素材缺。测试里那条 manifest 核对就是防这个。
   */
  readonly slot: string;
  /** 渲染缩放（1 = 素材原始像素 1:1）。 */
  readonly size: number;
  /** idle 每帧权重（`manifest.json` 的 `delays`，循环播放）。 */
  readonly idle: FrameWeights;
  /**
   * attack 每帧权重（**铺满整个读条** —— 见 `spriteAnim.ts` 的核心规则）。
   *
   * ⚠️ `manifest.json` 里部分 Boss 还有 `ult` 槽（大招）。本轮**不用**：
   * 需求只要求 idle 与 attack，而"哪个技能该播 ult"是内容决定的事，
   * 现在没有任何技能声明过它。
   */
  readonly attack: FrameWeights;
}

/**
 * 玩家 / Boss 的素材表。
 *
 * 顺序 = 备战界面里卡片的顺序（见 `data/roster.ts` 的 `BOSS_ROSTER`）。
 */
export const SPRITES: readonly CharacterSprite[] = [
  /**
   * 玩家 / 林晚风（索爾）。原图 103×117。
   *
   * ⚠️ **id 仍是 `'player'`**（不是 `'player-linwanfeng'`）：这个 id 已经
   * 写在存档与若干默认值里（`core/run.ts` 的 `actorId = 'player'`、
   * `viewAdapter` 的 `targetId !== 'player'`），改名是**破坏性**的，
   * 而换形象不需要动 id。
   */
  {
    id: 'player',
    slot: 'player-linwanfeng',
    size: 1.6,
    idle: [2, 2, 2, 2],
    attack: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  /** 凯丽（凱麗）。原图 66×122 —— 窄高型。 */
  {
    id: 'kaili',
    slot: 'player-kaili',
    size: 1.55,
    idle: [2, 2, 2, 2],
    attack: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  /** 黛玄（索菲亞）。原图 66×138 —— 三个玩家里最高的。 */
  {
    id: 'daixuan',
    slot: 'player-daixuan',
    size: 1.35,
    idle: [2, 2, 2, 2],
    attack: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  /**
   * 傲慢（火魔神）。原图 143×153。
   *
   * 它的三把刀读条 1000 / 1500 / 2000ms —— 16 帧塞进不同的读条时长，
   * 于是**慢刀动画播得慢**（见 `spriteAnim.ts` 的旁证）。
   */
  {
    id: 'meiichiro',
    slot: 'boss-pride',
    size: 1.25,
    idle: [2, 2, 2, 2],
    attack: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  /** 色欲（水魔神）。原图 201×139 —— 最宽的一张，所以缩放最小。 */
  {
    id: 'lust',
    slot: 'boss-lust',
    size: 1.2,
    idle: [2, 2, 2, 2],
    attack: [2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 2],
  },
  /** 嫉妒（風魔神）。原图 135×150。第 5 帧 delay=6（原版的"停一拍"）。 */
  {
    id: 'envy',
    slot: 'boss-envy',
    size: 1.25,
    idle: [2, 2, 2, 2],
    attack: [2, 2, 2, 2, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  /**
   * 暴食（地魔神）。原图 154×148。
   *
   * ⚠️ **idle 只有 1 帧**（`[2]`）—— 原版就没做它的待机动画，站着时
   * 看起来静止，**这是素材本身的限制，照实处理、不伪造**
   *（`frameAtProgress` 对单帧直接返回 0）。
   * 它攻击帧最后一帧 delay=8（其余 2），按权重缩放后仍然停得最久 —— 打击感。
   */
  {
    id: 'gluttony',
    slot: 'boss-gluttony',
    size: 1.25,
    idle: [2],
    attack: [2, 2, 2, 4, 2, 8],
  },
  /** 暴怒（空魔神）。原图 188×162 —— 最高的一张。 */
  {
    id: 'wrath',
    slot: 'boss-wrath',
    size: 1.15,
    idle: [2, 2, 2, 2],
    attack: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  /** 懒惰（机甲隊長）。原图 106×149。**idle 只有 1 帧**（同暴食）。 */
  {
    id: 'sloth',
    slot: 'boss-sloth',
    size: 1.25,
    idle: [2],
    attack: [2, 2, 2, 2, 8, 2, 2, 2, 2, 4],
  },
  /** 贪婪（盜賊頭目）。原图 123×110 —— 最矮的一张。 */
  {
    id: 'greed',
    slot: 'boss-greed',
    size: 1.45,
    idle: [2, 2, 2, 2],
    attack: [2, 2, 2, 2, 2, 2, 2, 2],
  },
];

/** 素材根目录（相对 `public/`）。 */
export const FD2_RGBA_DIR = 'fd2/rgba';

/** 按单位 id 取素材；没有则 `undefined`（调用方回退到程序化绘制）。 */
export function spriteFor(id: string): CharacterSprite | undefined {
  return SPRITES.find((s) => s.id === id);
}

/**
 * 某一帧的 URL。
 *
 * ⚠️ **必须走 `assetUrl()`**：线上部署在 `/raid/` 子路径下，硬编码
 * `/fd2/...` 会解析到域名根而 404 —— 而**本地 dev 的 base 是 `/`，
 * 恰好是对的，所以本地看不出来**（见 `render/assetUrl.ts` 的说明）。
 *
 * @param slot 素材 slot（`CharacterSprite.slot`）
 * @param anim `'idle'` 或 `'attack'`
 * @param index 帧序号（0 起，补零成 `f00` / `f11` 两位 —— 与 manifest 一致）
 */
export function frameUrl(slot: string, anim: 'idle' | 'attack', index: number): string {
  const n = String(index).padStart(2, '0');
  return assetUrl(`${FD2_RGBA_DIR}/${slot}/${anim}/f${n}.png`);
}

/**
 * 一个 slot 的**整段**帧 URL。
 *
 * 一次性把两段都算出来（而不是每帧现拼）：加载时算一次，
 * 之后切帧就只是"挑数组里第 i 个"。
 */
export function animUrls(sprite: CharacterSprite): {
  readonly idle: readonly string[];
  readonly attack: readonly string[];
} {
  const range = (weights: FrameWeights, anim: 'idle' | 'attack'): readonly string[] =>
    Array.from({ length: weights.length }, (_, i) => frameUrl(sprite.slot, anim, i));
  return { idle: range(sprite.idle, 'idle'), attack: range(sprite.attack, 'attack') };
}
