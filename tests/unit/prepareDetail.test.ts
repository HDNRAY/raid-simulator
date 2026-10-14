import { describe, expect, it } from 'vitest';
import {
  detailModelOf,
  focusedTarget,
  type DetailContext,
  type DetailModel,
} from '../../src/ui/prepareDetail';
import { prepareDetailContext } from '../../src/app/prepareDetailContext';

/**
 * ==================================================================
 * 详情区：**内容按"当前选择框在哪"切换**（人物 / 炁机 / Boss）
 * ==================================================================
 *
 * 需求："右边或者左边 切出一部分区域，显示**当前选择框**（hover 或者
 * 键盘）所在的人物 or 炁机 or boss 的详情"。
 *
 * ⚠️ 这一份钉两件事，都是"截图看不出来"的：
 *   1. **谁驱动**：hover 优先、触屏没有 hover 时退化成键盘焦点
 *   2. **内容从哪来**：模型里的每一行必须是真的数据（没数据就不许编）
 */

/** 一个最小的上下文（字面量，不 import 任何内容表）。 */
const ctx: DetailContext = {
  playerById: (id) => (id === 'player' ? { id, nameKey: 'roster.linWanfeng.name' } : undefined),
  bossById: (id) => (id === 'meiichiro' ? { id, nameKey: 'boss.name' } : undefined),
  qijiById: (id) =>
    id === 'vitality'
      ? { id, nameKey: 'qiji.vitality.name', descKey: 'qiji.vitality.desc' }
      : id === 'jieShengJi'
        ? { id, nameKey: 'qiji.jieShengJi.name', descKey: 'qiji.jieShengJi.desc' }
        : undefined,
  playerHp: () => 150,
  bossHp: () => 420,
  playerSkills: () => [
    { kind: 'skill', nameKey: 'skill.attack.name', descKey: 'skill.attack.desc', descParams: { damage: 10 } },
  ],
  bossSkills: () => [
    { kind: 'skill', nameKey: 'boss.cleave.name', descKey: 'boss.cleave.desc', descParams: { cast: 1, damage: 20 } },
  ],
  /** ⚠️ 让这一组专测"招式"那一段：被动给空数组（被动那一段另有单测）。 */
  bossPassives: () => [],
  developing: (id) => id === 'daixuan',
  /** ⚠️ 只有两种取值：开着 / 没开（激活是开关，没有层数）。 */
  qijiOn: (id) => id === 'vitality',
};

describe('驱动源：hover 优先，其次键盘焦点', () => {
  it('只有键盘焦点时用它', () => {
    expect(focusedTarget({ kind: 'player', id: 'player' }, undefined)).toEqual({
      kind: 'player',
      id: 'player',
    });
  });

  it('【关键】hover 存在时**盖过**焦点（鼠标指着的是玩家此刻真在看的东西）', () => {
    expect(focusedTarget({ kind: 'player', id: 'player' }, { kind: 'boss', id: 'meiichiro' })).toEqual(
      { kind: 'boss', id: 'meiichiro' },
    );
  });

  it('【关键】没有 hover（触屏）时自动退化成焦点 —— 同一段代码服务两种输入', () => {
    /** 触屏永远不调 `hover()`，所以 `hover` 恒为 `undefined`。 */
    const cursor = { kind: 'qiji', id: 'vitality' } as const;
    expect(focusedTarget(cursor, undefined)).toEqual(cursor);
  });

  it('两边都没有 → undefined（渲染层据此画占位，而不是把面板藏起来）', () => {
    expect(focusedTarget(undefined, undefined)).toBeUndefined();
    expect(detailModelOf(undefined, ctx)).toBeUndefined();
  });
});

describe('内容按类切换，且只取真数据', () => {
  it('人物：名字 + 生命上限 + 头像 id + 技能', () => {
    const m = detailModelOf({ kind: 'player', id: 'player' }, ctx);
    expect(m?.kind).toBe('player');
    expect(m?.titleKey).toBe('roster.linWanfeng.name');
    /**
     * ⚠️ 顶部那一行**没有 `dim`**：它从"次要小字"升成"关键数值"（用户：
     * "血量要显眼"）—— 渲染层用亮色 + 加粗画它，见 `prepareDetailPanel`。
     */
    expect(m?.subtitle).toEqual({
      kind: 'text',
      key: 'roster.ui.detail.hpMax',
      params: { hp: 150 },
    });
    /** 头像只有人物 / Boss 会用到的那份配对 id。 */
    expect(m?.portraitId).toBe('player');
    expect(m?.rows.map((r) => r.kind)).toEqual(['skill']);
  });

  it('【关键】Boss 的详情是**真的招式**（名字 + 说明 + 模板参数）', () => {
    const m = detailModelOf({ kind: 'boss', id: 'meiichiro' }, ctx);
    expect(m?.kind).toBe('boss');
    expect(m?.titleKey).toBe('boss.name');
    /** 生命上限是**真的**（不是编的）。 */
    expect(m?.subtitle?.params).toEqual({ hp: 420 });
    /**
     * ⚠️ **2026-10-14：不再有分节标题行**（用户："不用分 招式和被动，
     * 直接写每个能力就好"）⇒ 第一行**直接就是**一条能力。
     */
    const skill = m?.rows[0];
    expect(skill?.kind).toBe('skill');
    if (skill?.kind === 'skill') {
      expect(skill.nameKey).toBe('boss.cleave.name');
      /** ⚠️ `descParams` 必须带上（漏了就会把 `{cast}` 原样显示）。 */
      expect(skill.descParams).toEqual({ cast: 1, damage: 20 });
    }
    /** ⚠️ Boss **没有**配对的对话头像（需求只给了 3 个角色）。 */
    expect(m?.portraitId).toBeUndefined();
  });

  it('⚠️ 招式与被动**合成一列**，而且被动**也有说明**（用户报"被动都没有说明"）', () => {
    /**
     * 两件事一起钉：
     *   1. **不再分节** ⇒ 模型里**没有** `roster.ui.detail.skills` /
     *      `.passives` 那种小节标题行
     *   2. 被动行**带 `descKey`** —— `BossDef.passives` 是 `PassiveSkillDef[]`，
     *      它**有** `descKey`（五条被动的文案都在 i18n 里）。原先
     *      `bossPassives` 手写成 `{ nameKey, descParams: {} }` 把它丢了
     */
    /**
     * ⚠️ 这条要用**真的** `DetailContext`（本文件顶部那个 `ctx` 是手搭的夹具，
     * 它的 `bossPassives` 恒返回 `[]`）—— 因为要验的正是"真数据里被动有没有
     * 说明"。
     */
    const real = prepareDetailContext({ on: () => false });
    const m = detailModelOf({ kind: 'boss', id: 'sloth' }, real);
    const rows = m?.rows ?? [];
    const textKeys = rows.filter((r) => r.kind === 'text').map((r) => r.key);
    expect(textKeys, '不该再有「招式 / 被动」小节标题').toEqual([]);

    const skills = real.bossSkills('sloth');
    const passives = real.bossPassives('sloth');
    expect(passives.length, '懒惰有一条被动（怠惰）').toBeGreaterThan(0);
    expect(rows.length, '招式 + 被动 = 一列').toBe(skills.length + passives.length);
    /** ⚠️ 每一条**被动**都要有说明（这就是用户报的那件事）。 */
    for (const passive of passives) {
      expect(passive.descKey, `被动 ${passive.nameKey} 缺 descKey`).toBeTruthy();
    }
  });

  it('炁机：开关态 + 说明（说明是内容里的 `descKey`）', () => {
    const m = detailModelOf({ kind: 'qiji', id: 'vitality' }, ctx);
    expect(m?.kind).toBe('qiji');
    expect(m?.titleKey).toBe('qiji.vitality.name');
    /**
     * ⚠️ 开关**挪到了顶部那一行**（`subtitle`）—— 三类顶栏结构一致，
     * 正文只剩"这一条炁机是干什么的"（说明那一行）。
     * ⚠️ 只有"已激活 / 未激活"两种：激活是开关，**没有层数**
     * （用户 2026-10-13 纠正，见 `ui/freeQiji.ts`）。
     */
    expect(m?.subtitle).toEqual({ kind: 'text', key: 'roster.ui.detail.qijiOn' });
    expect(m?.rows[0]?.kind).toBe('skill');
  });

  it('没开过的炁机在顶栏显示"未激活"', () => {
    const m = detailModelOf({ kind: 'qiji', id: 'jieShengJi' }, ctx);
    expect(m?.subtitle).toEqual({ kind: 'text', key: 'roster.ui.detail.qijiOff' });
    /** 正文只有说明那一行（开关态已经在顶栏了，不重复）。 */
    expect(m?.rows.map((r) => r.kind)).toEqual(['skill']);
  });

  it('不认识的 id → `undefined`（不编一份空详情）', () => {
    expect(detailModelOf({ kind: 'boss', id: 'ghost' }, ctx)).toBeUndefined();
    expect(detailModelOf({ kind: 'qiji', id: 'ghost' }, ctx)).toBeUndefined();
  });
});

describe('⚠️「开发中」的单位不列招式（宁可少显示，也不显示错的）', () => {
  /**
   * `data/units.behaviorsFor` 对没做完的 Boss 返回的是**傲慢的行为表**
   * （兜底）。照实列出来就是"嫉妒也会碾压"—— 那是假信息。
   */
  const developingCtx: DetailContext = {
    ...ctx,
    bossById: () => ({ id: 'envy', nameKey: 'envy.name' }),
    playerById: () => ({ id: 'daixuan', nameKey: 'roster.daixuan.name' }),
    bossSkills: () => [
      { kind: 'skill', nameKey: 'boss.cleave.name', descParams: {} },
    ],
    playerSkills: () => [{ kind: 'skill', nameKey: 'skill.attack.name', descParams: {} }],
  };

  it('开发中的 Boss 只显示状态行', () => {
    const m = detailModelOf({ kind: 'boss', id: 'envy' }, { ...developingCtx, developing: () => true });
    expect(m?.rows).toEqual([{ kind: 'text', key: 'roster.ui.developing', dim: true }]);
  });

  it('开发中的人物同理', () => {
    const m = detailModelOf({ kind: 'player', id: 'daixuan' }, { ...developingCtx, developing: () => true });
    expect(m?.rows).toEqual([{ kind: 'text', key: 'roster.ui.developing', dim: true }]);
  });

  it('做完的单位**照常列招式**（对照组：上面两条不是因为函数坏了）', () => {
    const m: DetailModel | undefined = detailModelOf(
      { kind: 'boss', id: 'envy' },
      { ...developingCtx, developing: () => false },
    );
    expect(m?.rows.some((r) => r.kind === 'skill')).toBe(true);
  });
});
