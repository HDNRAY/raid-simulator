import { describe, expect, it } from 'vitest';
import { foldSummaryOf, type FoldEntry } from '../../src/ui/prepareFold';
import { createTranslator, type TranslateFn } from '../../src/i18n/translator';
import { BOSS_ROSTER } from '../../src/data/roster';

/**
 * ==================================================================
 * 收起的那一块（块头）说什么
 * ==================================================================
 *
 * 用户原话："同一时间只展开 3 个选择中的一个，其他的收起来，只展示当前
 * 选择" + "**收起来的那两块要显示'当前选了什么'**（人物：选中的名字+头像 ✓
 * 炁机：已激活哪几条 ✓ 对手：选中的 Boss 名 ✓）—— 否则玩家不知道收起来的
 * 那块是什么"。
 *
 * ⚠️ 这里钉的是那条**最容易被写错**的规则：块头显示的是**已确定的选择**
 * （`selection`），**不是光标**停的那一项。两者在桌面上常常重合，写错了
 * 只拍图是看不出来的（点一下再收起才会露馅）—— 所以它必须是能断言的
 * 纯逻辑。
 *
 * ⚠️ 2026-10-13：炁机那一条**不再写"×N"** —— 激活是开关，没有层数
 * （用户纠正，见 `ui/freeQiji.ts`）。列出的就是那几条**开着**的。
 */
const tr = createTranslator('zh-CN');

/**
 * `TranslateFn` 的适配器：`translator.t` 收的是 `MessageKey` 联合，而
 * 内容表给的 key 是 `string` —— 生产路径同一条适配在 `app/translate.ts`
 * （缺 key 回退到 key 本身）。测试里的**期望值一律用 `tr.t(...)` 拼**
 * （那个是**类型检查过 key 的**），所以源码里把 key 拼错会在断言里露出来。
 */
const t: TranslateFn = (key, params) => tr.t(key as Parameters<typeof tr.t>[0], params);

const players: readonly FoldEntry[] = [
  { id: 'player', nameKey: 'roster.linWanfeng.name' },
  { id: 'kaili', nameKey: 'roster.kaili.name' },
];
/** ⚠️ 名单里的真 id（`BOSS_ROSTER`）—— 名字 key 从那张表取，改名不破测试。 */
const bosses: readonly FoldEntry[] = [
  { id: BOSS_ROSTER[0]!.id, nameKey: BOSS_ROSTER[0]!.nameKey },
  { id: BOSS_ROSTER[1]!.id, nameKey: BOSS_ROSTER[1]!.nameKey },
];
const qiji: readonly FoldEntry[] = [
  { id: 'vitality', nameKey: 'qiji.vitality.name' },
  { id: 'breath', nameKey: 'qiji.breath.name' },
  { id: 'jieShengJi', nameKey: 'qiji.jieShengJi.name' },
];

const args = (over: Partial<Parameters<typeof foldSummaryOf>[0]> = {}) => ({
  kind: 'player' as const,
  selection: { playerId: 'kaili', bossId: bosses[1]!.id },
  players,
  bosses,
  qiji,
  on: () => false,
  translate: t,
  maxChars: 40,
  ...over,
});

describe('块头：收起的那一块显示"当前选了什么"', () => {
  it('人物：**选中的**名字 + 头像素材 id（不是光标）', () => {
    expect(foldSummaryOf(args({ kind: 'player' }))).toEqual({
      text: tr.t('roster.kaili.name'),
      portraitId: 'kaili',
    });
  });

  it('对手：选中的 Boss 名（没有头像素材 —— 那一格只有文字）', () => {
    expect(foldSummaryOf(args({ kind: 'boss' }))).toEqual({
      text: tr.t(bosses[1]!.nameKey as Parameters<typeof tr.t>[0]),
    });
  });

  it('炁机一条都没开 → "未激活任何炁机"（块头不能空着）', () => {
    expect(foldSummaryOf(args({ kind: 'qiji' }))).toEqual({
      text: tr.t('roster.ui.summary.qijiOff'),
    });
  });

  it('炁机：列出**已激活的那几条**（按内容表顺序），并写清条数', () => {
    const on = foldSummaryOf(
      args({ kind: 'qiji', on: (id) => id === 'vitality' || id === 'breath' }),
    );
    expect(on?.text).toBe(
      tr.t('roster.ui.summary.qijiOn', { n: 2 }) +
        tr.t('qiji.vitality.name') +
        '、' +
        tr.t('qiji.breath.name'),
    );
    /** ⚠️ 没有层数，所以**不可能**出现 `×N`（用户纠正过的那条机制）。 */
    expect(on?.text).not.toContain('×');
  });

  it('⚠️ 排不下时**收口**（补省略号，不折行 —— 折行会顶掉下面两块的高度）', () => {
    const on = foldSummaryOf(args({ kind: 'qiji', maxChars: 12, on: () => true }));
    expect(on?.text.endsWith('…')).toBe(true);
    expect(on?.text.length).toBeLessThanOrEqual(13);
  });

  it('选中的 id 不在名单里（陈旧存档）→ 退回第一条，而不是留空', () => {
    const out = foldSummaryOf(
      args({ kind: 'player', selection: { playerId: 'ghost', bossId: bosses[1]!.id } }),
    );
    expect(out).toEqual({ text: tr.t('roster.linWanfeng.name'), portraitId: 'player' });
  });

  it('那一块没有可选项 → undefined（调用方不该画出块头）', () => {
    expect(foldSummaryOf(args({ kind: 'qiji', qiji: [] }))).toBeUndefined();
    expect(foldSummaryOf(args({ kind: 'boss', bosses: [] }))).toBeUndefined();
  });
});
