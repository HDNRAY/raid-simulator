import { describe, expect, it } from 'vitest';
import type { ActiveSkillDef } from '../../src/core/types';
import { translator } from '../../src/i18n/translator';
import { ALL_SKILLS, PLAYER_SKILL_IDS } from '../../src/data/content';
import { FONT, LAYOUT } from '../../src/ui/layout';
import {
  formatCountdown,
  isTightWindow,
  ratioOf,
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

describe('formatCountdown —— 倒计时的显示规则（一处）', () => {
  /**
   * 用户报的 bug（原话）："闪 和 避 的buff，现在显示的1s？"
   *
   * 根因是 `Math.ceil(ms / 1000)`（整秒进位）：0.2 秒与 0.5 秒都变成 `1`，
   * 既分不出「闪」和「避」，也看不出窗口在缩短。
   *
   * 这里卡的是**规则本身**的三条判据（见 `formatCountdown` 顶部）：
   *   1. 0.2 与 0.5 能区分
   *   2. 窗口缩短看得出来
   *   3. 长 buff（30 秒）不变成 `30.0 → 29.9 → 29.8` 那种噪声
   */
  it('【核心】「闪」0.2 秒与「避」0.5 秒**显示不同**', () => {
    expect(formatCountdown(200)).toBe('0.2');
    expect(formatCountdown(500)).toBe('0.5');
  });

  it('【核心】窗口缩短看得见（0.5 → 0.4 → 0.3 → 0.2 → 0.1）', () => {
    expect([500, 400, 300, 200, 100].map(formatCountdown)).toEqual([
      '0.5',
      '0.4',
      '0.3',
      '0.2',
      '0.1',
    ]);
  });

  it('【核心】长 buff 用整秒，不是 `30.0`、也不会 `29.9 → 29.8` 地抖', () => {
    expect(formatCountdown(30_000)).toBe('30');
    expect(formatCountdown(29_900)).toBe('30');
    expect(formatCountdown(29_000)).toBe('29');
    expect(formatCountdown(28_900)).toBe('29');
    /** 同一秒之内只变一次，不是每 0.1 秒变一次。 */
    const oneSecond = [30_000, 29_900, 29_800, 29_100].map(formatCountdown);
    expect(new Set(oneSecond).size).toBe(1);
  });

  it('边界：0 / 0.1 / 0.9 / 1 / 9.9 / 10 / 30', () => {
    expect(formatCountdown(0)).toBe('0');
    expect(formatCountdown(1)).toBe('0.1');
    expect(formatCountdown(900)).toBe('0.9');
    expect(formatCountdown(1000)).toBe('1');
    expect(formatCountdown(9900)).toBe('9.9');
    expect(formatCountdown(10_000)).toBe('10');
    expect(formatCountdown(30_000)).toBe('30');
  });

  it('向上取整：窗口还活着就**不显示 0**（`0.2` 秒的最后一刻仍是 `0.1`）', () => {
    expect(formatCountdown(100)).toBe('0.1');
    expect(formatCountdown(1)).toBe('0.1');
    /** 与 `hudUtils.formatClockSafe` 同一个口径：剩 0.1 秒也显示 1 秒，不提前显示 0。 */
    expect(formatCountdown(0)).toBe('0');
  });

  /**
   * ⚠️ 需求（原话的由来）：预警条右边**只显示剩余秒数**，不要"闪避或卸力"
   * 那种文案 —— 那条文案是纯噪声，而且渲染层不许持有可显示文字（i18n I1）。
   *
   * 这条断言原先挂在 `viewModel.telegraphHint`（一个只包了本函数的壳，生产里
   * 没人调用，2026-10-13 随死代码删掉）。需求是活的，所以留在实现这里。
   */
  it('输出只有数字，没有任何可显示文案（i18n 规范 I1）', () => {
    expect(formatCountdown(1500)).toMatch(/^[\d.]+$/);
    expect(formatCountdown(1500)).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('尾零不显示（与 `displaySeconds` 同一条口径）', () => {
    expect(formatCountdown(1000)).toBe('1');
    expect(formatCountdown(2000)).toBe('2');
    expect(formatCountdown(2000)).not.toBe('2.0');
    expect(formatCountdown(30_000)).not.toBe('30.0');
  });

  it('9.9 秒与 10 秒之间**不出现 `10.0`**（阈值在折好的 0.1 秒刻度上判）', () => {
    expect(formatCountdown(9950)).toBe('10');
    expect(formatCountdown(9999)).toBe('10');
    expect(formatCountdown(9900)).toBe('9.9');
  });

  it('永久 buff / 脏数据安全（`Infinity` / `NaN` / 负数 → 空串或 0）', () => {
    expect(formatCountdown(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatCountdown(Number.NaN)).toBe('');
    expect(formatCountdown(-500)).toBe('0');
  });

  it('不出浮点尾数（整数 ÷ 10 的最短表示是一位小数）', () => {
    for (const ms of [200, 300, 700, 1100, 1900, 5400, 9900]) {
      expect(formatCountdown(ms).length, `${ms}`).toBeLessThanOrEqual(3);
      expect(formatCountdown(ms), `${ms}`).not.toMatch(/0{4,}|9{4,}/);
    }
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
     * 玩家技能（「斩」「轰」）的 `at` 是 0 —— 它们的命中在**读条结束时**
     * 结算，而不是按 `at` 计时。所以不能用同一套规则去卡它们
     * （第一版我就那么写了，结果把「斩」也报成违规）。
     * ⚠️ 判据是 `!PLAYER_SKILL_IDS.has(id)`，**不是 id 前缀**。
     * 原来写的是 `startsWith('boss-')`，于是「色欲」的 `lust-*` 技能
     * **从来没被这条护栏检查过** —— 一个静默的覆盖漏洞
     * （和"Boss 技能漏进按键设置"是同一个根因）。
     */
    const bossSkills = ALL_SKILLS.filter(
      (s): s is ActiveSkillDef =>
        s.kind === 'activeSkill' && !PLAYER_SKILL_IDS.has(s.id) && s.castTime > 0,
    );
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
    /**
     * 冷却遮罩那次 fill 必须是白色。
     *
     * ⚠️ 现在是 `roundRect`（不再是 `rect`）：技能格有了底色之后，
     * 遮罩要跟底色**同一个圆角** —— 否则白色的矮条会从格子底部的
     * 圆角处探出去（半径 3px，放大到 200% 时是 6px，看得出来）。
     * 断言的东西没变：**白色 + 半透明**。
     */
    const m = /SLOT_COOLDOWN_BAR_H \* view\.cooldownRatio\)\);\s*\n\s*g\.roundRect\([^)]*\)\.fill\(\{ color: (0x[0-9a-f]+), alpha: ([\d.]+) \}\)/.exec(src);
    expect(m, '未找到冷却遮罩的 fill 调用').not.toBeNull();
    expect(m![1]).toBe('0xffffff');
    // 半透明：既压住技能字，又不糊成死白
    const alpha = Number(m![2]);
    expect(alpha).toBeGreaterThan(0.3);
    expect(alpha).toBeLessThan(1);
  });

  /**
   * 技能格底色（`PALETTE.slot`）的四条**设计约束**。
   *
   * 需求（用户原话）："键盘的时候技能按钮还是加一个背景色，要不然
   * **资源不够用不了的技能看着太不清楚了**。"
   *
   * 为什么用断言锁住颜色而不是只靠截图：截图能证明"这一版好看"，
   * 证明不了"下一版还成立"。而这几条一旦被改坏，画面**仍然能看** ——
   * 只是"买不起"不再是最不显眼的那一档（那正是这次要修的问题）。
   */
  it('【关键】四档底色：同色系、买不起最暗、字在最暗那档仍可辨', async () => {
    const { PALETTE } = await import('../../src/render/theme');
    /** WCAG 相对亮度（sRGB → 线性）。 */
    const lum = (c: number): number => {
      const channel = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel((c >> 16) & 0xff)
        + 0.7152 * channel((c >> 8) & 0xff)
        + 0.0722 * channel(c & 0xff)
      );
    };
    const contrast = (a: number, b: number): number => {
      const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
      return (hi + 0.05) / (lo + 0.05);
    };

    // 1. 亮度**单调**：可用 > 条件型不可用 > 买不起。
    //    "买不起"必须是整条技能栏里最暗的一档 —— 这是"一眼可辨"的来源。
    expect(lum(PALETTE.slot.ready)).toBeGreaterThan(lum(PALETTE.slot.waiting));
    expect(lum(PALETTE.slot.waiting)).toBeGreaterThan(lum(PALETTE.slot.blocked));

    // 2. **同色系**（冷石板蓝）：三档的蓝通道都高于红通道。
    //    红/绿的点色（"红绿灯"）过不了这一条 —— 而本作的纯红/纯绿
    //    已经分别属于"物理预警"与"炁"，不能再用一次。
    for (const c of [PALETTE.slot.ready, PALETTE.slot.waiting, PALETTE.slot.blocked]) {
      expect((c & 0xff) > ((c >> 16) & 0xff), `0x${c.toString(16)} 不是冷色调`).toBe(true);
    }

    // 3. 技能字压在**最暗**那档上仍读得出（≥ 3:1，大字号可读的门槛）：
    //    "买不起"时玩家还是得认出这是哪个技能。
    expect(contrast(PALETTE.slot.blockedGlyph, PALETTE.slot.blocked)).toBeGreaterThan(3);

    // 4. 「买不起」的代价数字**不再是亮的资源色** —— 否则那一格上
    //    "底色说断电、金色 50 说没问题"，同一个状态两套打架的表达。
    expect(lum(PALETTE.slot.blockedCost)).toBeLessThan(lum(PALETTE.energy.base));
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
  /**
   * ⚠️ 语义变过一次：`hintTags` 里装的**不再是 `HintTag` 值，而是完整
   * 的 i18n key**。
   *
   * 原因：控制类提示（「倒地」「眩晕」）取的是**那个 debuff 自己的
   * `nameKey`**，而那不是 `HintTag` union 里的值（见 `app/skillHints.ts`）。
   * 所以视图层不再拼 `settings.hintTags.${tag}` 前缀，而是把 key 直接交给
   * 翻译层。
   */
  it('读条视图带 hintTags，且里面是**完整 i18n key**', async () => {
    /** ① 渲染层确实在读这个字段（读条上要画）。 */
    const render = await readRenderLayer();
    expect(render).toMatch(/cast\.hintTags/);

    /** ② 生产者是 `viewAdapter` —— 静态部分走 `hintKeysOf`（手写 ∪ 推导）。 */
    const { readFileSync } = await import('node:fs');
    const adapter = readFileSync(new URL('../../src/app/viewAdapter.ts', import.meta.url), 'utf8');
    expect(adapter).toMatch(/hintKeysOf\(skill\)/);
    /**
     * ⚠️ 反向：不该再有"拼 `settings.hintTags.` 前缀"那种写法 ——
     * 推导出来的控制类提示是**别处的 key**（debuff 自己的 `nameKey`），
     * 拼前缀会把 `lust.stun.name` 拼成 `settings.hintTags.lust.stun.name`。
     */
    expect(adapter).not.toMatch(/settings\.hintTags\.\$\{tag\}/);
  });

  it('【关键】「霸体」是**状态**，不只是技能静态属性', async () => {
    /**
     * Boss 开了霸体之后，读条上必须显示"打不断" —— 否则玩家会白按「破」。
     * 而霸体是运行时 buff（`interruptImmune`），不是技能自带的标签，
     * 所以视图层要把两者**合并**。
     */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/app/viewAdapter.ts', import.meta.url), 'utf8');
    /**
     * ⚠️ 加的是**完整 key**（`hintTags` 现在装 i18n key，见上一条用例）。
     */
    expect(src).toMatch(
      /if \(armored\) castTags\.add\('settings\.hintTags\.interruptImmune'\)/,
    );
  });

  /**
   * ⚠️ 这条要**跟着 `HintTag` 一起长**：漏一个的后果是读条上显示
   * 英文标识符（或空白），而玩家看着读条做生死判断。
   *
   * `knockdown`（倒地）是需求后加的 —— 玩家原话："傲慢现在哪个招式会
   * 导致倒地，请加 tag，玩家看不到"。
   */
  it('每个标签都有中文文案', () => {
    for (const tag of ['interruptImmune', 'highDamage', 'interrupt']) {
      expect(translator.t(`settings.hintTags.${tag}` as never)).not.toBe('');
    }
  });
});

describe('闪避位移（与防御区分）', () => {
  it('闪避横移、然后复位；峰值是一个三角波', async () => {
    const src = await readRenderLayer();
    /**
     * 需求："闪避的画面效果改成横移，然后复位，和防御区分开来"。
     * 用三角波（0 → 峰值 → 0）而不是缓动状态机：无敌窗口本身就是
     * 这条动画的时间轴，跟着它走不会出现"动画还在播但无敌已结束"。
     *
     * ⚠️ 方向（左 / 右）由 `DODGE_PEAK_X` 的**符号**决定，不在这条断言里 ——
     * 见下面那条读 `actorLayout` 的用例。站位互换过，所以方向反转了。
     */
    expect(src).toMatch(/base = DODGE_PEAK_X \* \(1 - Math\.abs\(progress \* 2 - 1\)\)/);
    /**
     * ⚠️ 位移还要**叠加受击反冲** —— 这是"四通道"设计的一部分：
     * 闪避位移与受击反冲可以同时发生，所以相加而不是二选一。
     *
     * ⚠️ 号是 `+`：玩家现在在**右边**，受击是向右退（背离左边的 Boss）。
     * 站位互换前这里是 `-`。断言跟着改，但"必须有闪避位移"这条没放松。
     */
    expect(src).toMatch(/this\.playerRoot\.x = Math\.round\(base \+ fb\.recoilX\)/);
    // 没有闪避时 base 保持 0（否则会停在偏移位置）
    expect(src).toMatch(/let base = 0;/);
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

  /**
   * ⚠️ 这条读的是 `actorLayout.ts`，**不是**渲染层 ——
   * `DODGE_PEAK_X` 已经搬到那里（与 `ACTOR_POS` 放在一起，因为
   * "左移之后离对面还有多少余量"的推算要同时读这两者）。
   */
  it('位移峰值是 52，且**向左**（站位互换后方向反转）', async () => {
    /** 与 `readRenderLayer` 同一风格：**动态 import**，不新增顶层依赖。 */
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const file = fileURLToPath(new URL('../../src/render/actorLayout.ts', import.meta.url));
    const src = readFileSync(file, 'utf8');
    /**
     * 幅度是需求定的（26 的翻倍）；**符号跟着站位走** ——
     * 玩家在右、Boss 在左，所以"躲开"是向左（负）。
     */
    expect(src).toMatch(/const DODGE_PEAK_X = -52;/);
  });
});
