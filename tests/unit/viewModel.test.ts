import { describe, expect, it } from 'vitest';
import { translator } from '../../src/i18n/translator';
import { ALL_SKILLS } from '../../src/data/content';
import { FONT, LAYOUT } from '../../src/ui/layout';
import {
  formatClock,
  isTightWindow,
  ratioOf,
  telegraphHint,
  type BuffView,
} from '../../src/render/viewModel';

/**
 * 渲染层的**格式化与规则**是纯函数，在 node 环境测 ——
 * 不需要 pixi、不需要 DOM。这是把 UI 拆成"数据规则 + 绘制"的收益。
 */

/**
 * **读整个渲染层**。
 *
 * 超长文件拆分后，实现会在 `render/` 内部搬家（`BattleScene.ts` →
 * `skillBar.ts` / `parts/playerActor.ts` / …）。断言的是"这段逻辑
 * 存在/不存在"，不是"它在哪个文件里"，所以整层扫描才不会因为
 * 一次纯搬运而假失败。
 *
 * ⚠️ 副作用：这些断言变弱了（不再限定单一文件）。但它们的原意
 * 本来就是防"顺手加回来"，整层扫描足够，而且更耐用。
 */
const readRenderLayer = async (): Promise<string> => {
  const { readdirSync, readFileSync: rf } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const rootDir = dirname(fileURLToPath(new URL('../../src/render/', import.meta.url)));
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts')) out.push(rf(full, 'utf8'));
    }
  };
  walk(rootDir);
  return out.join('\n');
};

describe('ratioOf', () => {
  it('正常比例', () => {
    expect(ratioOf({ current: 50, cap: 100 })).toBe(0.5);
    expect(ratioOf({ current: 0, cap: 100 })).toBe(0);
    expect(ratioOf({ current: 100, cap: 100 })).toBe(1);
  });

  it('超过上限被钳到 1，负数钳到 0', () => {
    expect(ratioOf({ current: 150, cap: 100 })).toBe(1);
    expect(ratioOf({ current: -10, cap: 100 })).toBe(0);
  });

  it('cap 为 0 或 NaN 时返回 0（不产生 NaN 宽度）', () => {
    expect(ratioOf({ current: 10, cap: 0 })).toBe(0);
    expect(ratioOf({ current: 10, cap: Number.NaN })).toBe(0);
    expect(ratioOf({ current: Number.NaN, cap: 100 })).toBe(0);
  });
});

describe('formatClock', () => {
  it('M:SS 格式', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(1000)).toBe('0:01');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(180_000)).toBe('3:00');
  });

  it('向上取整（剩 0.1 秒也显示 1 秒，不会提前显示 0）', () => {
    expect(formatClock(100)).toBe('0:01');
    expect(formatClock(1801_000)).toBe('30:01');
  });

  it('负数与 Infinity 安全', () => {
    expect(formatClock(-500)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('--:--');
  });
});

describe('telegraphHint —— 预警必须告诉玩家该做什么', () => {
  /**
   * 预警条右侧的提示**只剩剩余秒数**。
   *
   * 需求：不要"闪避或格挡"字样。这两种应对永远适用，写出来是噪声；
   * 玩家真正要读的是"还有多久命中"。所以这里不再断言任何文案 key。
   */
  it('给出剩余秒数（保留 1 位）', () => {
    const hint = telegraphHint({
      skillId: 'corruption',
      nameKey: 'boss.cleave.name',
      progress: 0.5,
      interruptible: true,
      remainingMs: 1500,
    });
    expect(hint?.seconds).toBe('1.5');
    expect(Object.keys(hint ?? {})).toEqual(['seconds']);
  });

  it('没有读条时返回 undefined', () => {
    expect(telegraphHint(undefined)).toBeUndefined();
  });

  it('【关键】只有数字，没有任何可显示文案 —— 渲染层不持有文字（i18n 规范 I1）', () => {
    const hint = telegraphHint({
      skillId: 'x',
      nameKey: 'boss.x.name',
      progress: 0,
      interruptible: true,
      remainingMs: 1000,
    });
    // 去掉"闪避或格挡"之后，提示里只剩一个数字串
    expect(hint?.seconds).toMatch(/^[\d.]+$/);
    expect(JSON.stringify(hint)).not.toMatch(/[\u4e00-\u9fff]/);
  });
});

describe('isTightWindow', () => {
  const buff = (over: Partial<BuffView>): BuffView => ({
    id: 'dodge-iframe',
    nameKey: 'hud.dodged',
    icon: 'i',
    polarity: 'buff',
    color: 0xff7a55,
    shortLabelKey: 'buffShort.dodgeIframe',
    stacks: 1,
    remainingMs: 300,
    durationMs: 300,
    isDefensive: true,
    ...over,
  });

  it('判定窗口且剩余时间很短 → 需要高亮', () => {
    expect(isTightWindow(buff({ remainingMs: 150 }))).toBe(true);
  });

  it('判定窗口但时间还长 → 不高亮', () => {
    expect(isTightWindow(buff({ remainingMs: 500 }))).toBe(false);
  });

  it('非判定类 buff 永远不高亮', () => {
    expect(isTightWindow(buff({ isDefensive: false, remainingMs: 50 }))).toBe(false);
  });
});


describe('本地化 key 契约（i18n 规范 I1）', () => {
  it('所有不可用原因的 key 都能在语言包中找到', () => {
    // 这些 key 由 viewAdapter 产出，必须真实存在于语言包
    const required = [
      'block.comboWindow',
      'block.cost',
      'block.cooldown',
      'block.casting',
      'hint.dodgeOrGuard',
      'hint.armored',
    ];
    for (const key of required) {
      expect(() => translator.t(key as never)).not.toThrow();
    }
  });
});

describe('数据一致性：命中时刻必须等于读条时长', () => {
  /**
   * Boss 招式的 `hits[].at` 表示"命中在读条的第几毫秒"。
   * 它必须**等于** `castTime`（读条走完才命中）。
   *
   * ⚠️ 这个坑我踩了三次：
   *   - `at` < `castTime` → 伤害在读条**结束前**就结算，
   *     表现为"读条条还在走、血已经掉了"
   *   - `at` > `castTime` → 读条条已经消失、伤害才掉
   *
   * 而且两次都是**改了 `castTime` 忘了同步 `at`**。
   * 它不会让任何功能测试失败（战斗照常进行），所以必须专门守住。
   */
  it('Boss 读条技能的 at 与 castTime 一致', () => {
    /**
     * ⚠️ 这条规则**只适用于 Boss 招式**。
     *
     * 玩家技能（「攻」「轰」）的 `at` 是 0 —— 它们的命中在**读条结束时**
     * 结算，而不是按 `at` 计时。所以不能用同一套规则去卡它们
     * （第一版我就那么写了，结果把「攻」也报成违规）。
     */
    const bossSkills = ALL_SKILLS.filter((s) => s.id.startsWith('boss-') && s.castTime > 0);
    expect(bossSkills.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const skill of bossSkills) {
      for (const hit of skill.hits) {
        if (hit.at !== skill.castTime) {
          offenders.push(`${skill.id}: at=${hit.at} castTime=${skill.castTime}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('读条组件（CastBar）：两处读条共用同一个实现', () => {
  /**
   * 需求："boss 读条依旧看不到上 border，玩家读条也有 bug，
   * 这 2 个你没有抽成组件？所有的进度条，都应该抽成同一个组件。"
   *
   * 抽组件的**直接收益**是：层叠顺序只定义一次。所以这里守住
   * 那个顺序 —— 它是"边框被填充盖住"这个 bug 的根因。
   *
   * 组件本身要构造 Pixi 对象（jsdom 里不好跑），所以这里用
   * 源码断言 + 行为断言组合：
   *   - 源码里 `addChild` 的参数顺序必须是 底 → 填充 → 描边 → 文字
   *   - LAYOUT 里两处读条的矩形不重叠，且都在画布内
   */
  it('【关键】层叠顺序是 底 → 填充 → 描边 → 文字', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/CastBar.ts', import.meta.url), 'utf8');
    const m = /this\.root\.addChild\(([^)]*)\)/.exec(src);
    expect(m).not.toBeNull();
    const order = m![1]!.split(',').map((x) => x.trim());
    expect(order).toEqual([
      'this.bg',
      'this.fillGfx',
      'this.border',
      'this.nameText',
      'this.tagText',
      'this.timeText',
    ]);
  });

  it('填充四周内缩 INSET，且描边路径落在半像素上', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/CastBar.ts', import.meta.url), 'utf8');
    /**
     * 这两条都是**像素级 bug 的根因**，实测出来的：
     *
     * 1. 填充内缩必须是 2 —— 1px 的描边以路径线为中心向两侧各铺 0.5px，
     *    填充从 +1 开始就会盖住它（"看不到上 border"）。
     * 2. 描边路径必须落在 `x+0.5 / y+0.5` —— 画在整数坐标上时
     *    1px 的线跨越两个半行像素，各混一次，上下两边被稀释到几乎看不见。
     */
    expect(src).toMatch(/const INSET = 2;/);
    expect(src).toMatch(/rect\(x \+ INSET, y \+ INSET, filled, innerH\)/);
    // 半像素偏移现在是共用常量（`HALF_PIXEL`），不再是字面量 0.5
    expect(src).toMatch(/roundRect\(x \+ HALF_PIXEL, y \+ HALF_PIXEL, w - 1, h - 1, RADIUS\)/);
  });

  it('两处读条都够高，且都不与所属面板重叠', () => {
    // Boss 预警条在顶部、独立
    expect(LAYOUT.castBar.h).toBeGreaterThanOrEqual(FONT.body + 8);
    // 玩家读条必须在玩家面板上方（面板后绘制会盖住它）
    expect(LAYOUT.playerCastBar.y + LAYOUT.playerCastBar.h).toBeLessThanOrEqual(LAYOUT.player.y);
  });
});

describe('技能格：冷却遮罩（白）与数字的层叠', () => {
  /**
   * 需求："按键的 cd，数字应该盖在按键 icon 上，背景是暗色，
   * cd 的半透明遮罩就应该用白色。"
   *
   * 这条来回改过很多次（弧形 → 红弧 → 黑色矮条 → 白色铺满），
   * 而且每一版都能"看起来差不多能用" —— 所以必须用断言锁住
   * 三件容易改坏的事。
   */
  const readSkillBar = readRenderLayer;

  it('遮罩是**白色**半透明，而不是黑色', async () => {
    const src = await readSkillBar();
    // 冷却遮罩那次 fill 必须是白色
    const m = /SLOT_COOLDOWN_BAR_H \* view\.cooldownRatio\)\);\s*\n\s*g\.rect\([^)]*\)\.fill\(\{ color: (0x[0-9a-f]+), alpha: ([\d.]+) \}\)/.exec(src);
    expect(m, '未找到冷却遮罩的 fill 调用').not.toBeNull();
    expect(m![1]).toBe('0xffffff');
    // 半透明：既压住技能字，又不糊成死白
    const alpha = Number(m![2]);
    expect(alpha).toBeGreaterThan(0.3);
    expect(alpha).toBeLessThan(1);
  });

  it('遮罩最大高度 = 整格（不是一条矮条）', () => {
    expect(LAYOUT.skillBar.cooldownBarHeight).toBe(LAYOUT.skillBar.slot);
  });

  it('【关键】数字在技能字**之后**绘制 —— 否则盖不住 icon', async () => {
    const src = await readSkillBar();
    // 技能格那一次 addChild 的参数里有 cd.root（其它 addChild 没有）
    const m = /this\.root\.addChild\((gfx,[^)]*cd\.root[^)]*)\)/.exec(src);
    expect(m, '未找到技能格的 addChild').not.toBeNull();
    const order = m![1]!.split(',').map((x) => x.trim());
    // 层叠：格子底 → 图标 → 按键 → 固有CD → 代价 → **实时CD（最上层）**
    expect(order).toEqual([
      'gfx',
      'glyph.root',
      'key.root',
      'skillCd.root',
      'cost.root',
      'cd.root',
    ]);
  });

  it('数字字号大于技能字 —— 冷却时它才是关键信息', () => {
    expect(FONT.big).toBeGreaterThan(FONT.body);
  });
});

describe('读条边框：恒色，不随进度变色', () => {
  /**
   * 曾经在进度过 70% 时把边框从危险红转成亮金（"快命中了"的压力感）。
   * 去掉了，因为：
   *   1. 信息重复 —— 剩余秒数已经直接写在条上
   *   2. 阈值语义不一致 —— 硬编码 70% 对 1.8 秒的重斩和 2.2 秒的横扫
   *      意味着不同的剩余时间（0.54s vs 0.66s），玩家学不会一个稳定规则
   *
   * 这条断言防止它被"顺手加回来"。
   */
  it('渲染层不再有按进度改边框色的逻辑', async () => {
    const src = await readRenderLayer();
    expect(src).not.toContain('setBorderColor');
    expect(src).not.toMatch(/progress\s*>\s*0\.7/);
  });

  it('组件也不暴露改边框色的入口', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ui/CastBar.ts', import.meta.url), 'utf8');
    // 只有构造时用 options.line；没有运行期改色方法
    expect(src).not.toContain('setBorderColor');
    expect(src).toMatch(/drawBorder\(this\.options\.line\)/);
  });
});

describe('Boss 读条上的招式提示标签', () => {
  /**
   * 需求："boss 的招式的 tags 显示在它的读条中，比如'霸体'技能，
   * 提示玩家无法被打断，'高伤'提示玩家闪避比防御更值得"
   */
  it('读条视图带 hintTags，且文案 key 走 settings.hintTags.*', async () => {
    const src = await readRenderLayer();
    expect(src).toMatch(/cast\.hintTags/);
    expect(src).toMatch(/settings\.hintTags\.\$\{tag\}/);
  });

  it('【关键】「霸体」是**状态**，不只是技能静态属性', async () => {
    /**
     * Boss 开了霸体之后，读条上必须显示"打不断" —— 否则玩家会白按「破」。
     * 而霸体是运行时 buff（`interruptImmune`），不是技能自带的标签，
     * 所以视图层要把两者**合并**。
     */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/app/viewAdapter.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(armored\) castTags\.add\('interruptImmune'\)/);
  });

  it('三个标签都有中文文案', () => {
    for (const tag of ['interruptImmune', 'highDamage', 'interrupt']) {
      expect(translator.t(`settings.hintTags.${tag}` as never)).not.toBe('');
    }
  });
});

describe('闪避位移（与防御区分）', () => {
  it('闪避往右位移、然后复位；峰值是一个三角波', async () => {
    const src = await readRenderLayer();
    /**
     * 需求："闪避的画面效果改成往右移动，然后复位，和防御区分开来"。
     * 用三角波（0 → 峰值 → 0）而不是缓动状态机：无敌窗口本身就是
     * 这条动画的时间轴，跟着它走不会出现"动画还在播但无敌已结束"。
     */
    expect(src).toMatch(/const wave = 1 - Math\.abs\(progress \* 2 - 1\)/);
    expect(src).toMatch(/this\.playerRoot\.x = Math\.round\(DODGE_PEAK_X \* wave\)/);
    // 没有闪避时必须复位（否则会停在偏移位置）
    expect(src).toMatch(/this\.playerRoot\.x = 0;/);
  });

  it('防御**不**位移 —— 两者要在余光里也能区分', async () => {
    const src = await readRenderLayer();
    // 位移只在 dodge 分支里发生（部件里 `buffs` 是它自己从 ctx 取出的局部量）
    expect(src).toMatch(/const dodge = buffs\.find\(/);
    expect(src).not.toMatch(/guarding[\s\S]{0,80}playerRoot\.x/);
  });

  it('闪避**不**变矮 —— 姿态下沉只给防御', async () => {
    /**
     * 需求："闪避的动画不要变矮了"。
     *
     * 原先闪避和防御共用 `pose = 0.85`，于是两者的区别只剩颜色。
     * 现在区分手段是：闪避 = 横向位移；防御 = 下沉 + 冷色。
     */
    const src = await readRenderLayer();
    expect(src).toMatch(/const pose = guarding \? 0\.85 : 1;/);
    expect(src).not.toMatch(/dodging \|\| guarding \? 0\.85/);
  });

  it('位移峰值是 52（26 的翻倍）', async () => {
    const src = await readRenderLayer();
    expect(src).toMatch(/const DODGE_PEAK_X = 52;/);
  });
});
