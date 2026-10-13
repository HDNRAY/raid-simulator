/**
 * **选炁机屏的纯逻辑**：候选列表 → 光标 / 命中区 / 确认。
 *
 * 设计稿：`docs/specs/2026-10-12-roguelike.md` §3.3（`QijiSelect`）与 §5.3
 * （"每场战斗后选 1 个生效"）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把"现在能选什么"（`core/run/unlock.ts` 的 `Candidate[]`）翻译成
 * **可画的一张列表**：每张卡的位置、光标在哪、点了哪一张要选谁。
 * 一行都不碰 Pixi / DOM —— 所以能在 node 里单测。
 *
 * ==================================================================
 * ⚠️ 与选角色屏**刻意不复用** `prepareLogic`
 * ==================================================================
 *
 * 选角色屏（`characterSelectLogic.ts`）走的是"把备战模型的人物槽位传进来"
 * 那条路 —— 因为它的交互真的与备战同构（一行卡片 + 光标 ≠ 选择）。
 *
 * 本屏不同构，差别不在长相而在**语义**：
 *
 *   - 选角色屏**一行**、选择是"确定了谁"（与光标分离）
 *   - 本屏可能有**两行**，而"选择"没有延迟 —— 按 Enter / 点卡片**当场生效**
 *     并离开这一屏（§5.3："选了不能换"）。所以这里**没有** selection，
 *     只有 cursor。
 *
 * 硬把"没有 selection"塞进 `PrepareSelection` 会造出一个永远为空的选择字段
 * —— 而那个字段下一个人会以为有含义。
 *
 * ==================================================================
 * ⚠️ 卡片显示"进度"，但**不显示"还差几次"**
 * ==================================================================
 *
 * 一条炁机的解锁条件可能是嵌套的（`all` / `any` / `not`）。`unlockProgress`
 * 给的 `current` / `required` 在组合条件下数的是**叶子条件个数**
 * （见 `core/run/unlock.ts` 的说明），直接读成"还差 2 次"是错的。
 *
 * 本屏只画**两种**状态：
 *   - 已解锁（候选里出现 = 已解锁，这是 `nextCandidates` 的过滤结果）
 *   - 未解锁（**不出现在候选里** —— 所以屏幕上没有它）
 *
 * 于是"进度"这件事在本屏**没有落点**：候选就是已解锁的全部。
 * ⚠️ 想显示"截 2/3"的那种灰卡（"还差一次"）需要另一份数据
 * （把池子里**没解锁**的也画出来），那是以后的事 —— 这里不假装有。
 */

/** 本屏要画的最小炁机形状（结构性类型：只有 id 与两个文案 key）。 */
export interface QijiView {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey?: string;
  /** 图标名（`render/icons.ts` 的 `IconName`）。 */
  readonly icon: string;
  /**
   * 一局内最多叠几层（`data/qiji.ts` 的 `maxStacks`，缺省 1）。
   *
   * 用途：卡片右下角画"还能选几次"（`remaining` 来自候选），
   * 以及"已叠满"的灰卡判定。
   */
  readonly maxStacks?: number;
}

/** 一个候选：要画的炁机 + 还能选几次。 */
export interface QijiCandidate {
  readonly qiji: QijiView;
  /** 还能选几次（`maxStacks - 已选层数`）。恒 `>= 1`（`nextCandidates` 保证）。 */
  readonly remaining: number;
}

/**
 * `app/phaseFlow.ts` 交给渲染层的**那个形状**的别名。
 *
 * ⚠️ 它在这里（而不是 app 层）定义：它是"选炁机屏的画面需要什么"这件事的
 * 类型，而那个知识的家是本模块（同一条纪律：接口形状由**消费者**声明，
 * 见 `core/types/ids.ts` 的 `LocaleKey`）。app 层只是把它拼出来。
 */
export type QijiCandidateView = QijiCandidate;

/* ================================================================== *
 * 1. 布局与命中区
 * ================================================================== */

export interface QijiLayout {
  /** 卡片顶边（第一行）。 */
  readonly rowTop: number;
  readonly cardW: number;
  readonly cardH: number;
  readonly gap: number;
  /** 一行的最大宽度（画布 960，两侧留白）。 */
  readonly maxRowW: number;
  /** 标题的 y。 */
  readonly titleY: number;
  /** 提示行的 y。 */
  readonly hintY: number;
}

/**
 * ⚠️ **卡片宽度是"说明文字装得下"算出来的，不是审美挑的**。
 *
 * 实测（2026-10-13 第一次截图）：176 宽时"炁回复速度 +10/秒（基础 10/秒）。
 * 可叠 2 层。"整句溢出到**邻卡上** —— Pixi 不自动折行，而内容层已经用
 * `\n` 手工断行（见 `zh-CN.ts` 的 `qiji.*.desc`），所以卡片至少要装下
 * 最长的那一行（约 20 个 11px 的汉字 ≈ 220px）。
 *
 * `252 - 2×12(内边距) = 228` ⇒ 一行最多约 20 字，够用。
 */
export const QIJI_SELECT_LAYOUT: QijiLayout = {
  rowTop: 150,
  cardW: 252,
  cardH: 172,
  gap: 20,
  maxRowW: 900,
  titleY: 62,
  hintY: 470,
};

/**
 * 把候选切成若干行。**策略：尽量少行、每行尽量满。**
 *
 * 为什么不是"固定每行 N 个"：候选数量随解锁进度变（2 → 5 → …），固定 N 会让
 * "5 个候选"排成 2+3 两行而"4 个"排成一行 —— 同样的卡片数换来不同的形状，
 * 而玩家看到的是"怎么突然换行了"。
 *
 * 判据：能塞进一行的最大张数 `perRow = floor((maxRowW + gap) / (cardW + gap))`，
 * 超过就平分两行（`ceil(n/2)`），再超过就平分三行……直到装得下。
 *
 * ⚠️ 返回的是**候选的下标分组**（不是卡片对象）：画的时候要按下标反查命中区，
 * 分组里存对象会让"第几张"与"哪一个"有两条对应关系。
 */
export function qijiRows(
  count: number,
  L: QijiLayout = QIJI_SELECT_LAYOUT,
): readonly (readonly number[])[] {
  if (count <= 0) return [];
  const perRow = Math.max(1, Math.floor((L.maxRowW + L.gap) / (L.cardW + L.gap)));
  let rows = Math.ceil(count / perRow);
  /**
   * ⚠️ 平分而不是"除最后一行外都塞满"：`perRow` 是**上限**，
   * 而每行均分让两行长度最多差 1（视觉上更稳）。例如 6 个候选、
   * `perRow = 4`：`ceil(6/4) = 2` 行 → 每行 3 个（而不是 4 + 2）。
   */
  const per = Math.ceil(count / rows);
  rows = Math.ceil(count / per);
  const out: number[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const from = r * per;
    const row: number[] = [];
    for (let i = from; i < Math.min(from + per, count); i += 1) row.push(i);
    out.push(row);
  }
  return out;
}

/** 一张卡的可点矩形（逻辑坐标）。 */
export interface QijiHitArea {
  /** 候选下标（= `QijiCandidate[]` 的下标）。 */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 每个候选的命中区（顺序 = 行的顺序、每行从左到右 = 候选下标顺序）。
 *
 * ⚠️ 几何是**算出来的**（`rows` 给分组、这里给坐标），不许手调数字：
 * "5 张卡时第 3 张在哪儿"这种问题只有一条公式能回答（`ui/prepareLogic.ts`
 * 的 `prepareHitAreas` 记着同一个坑）。
 */
export function qijiHitAreas(
  candidates: readonly QijiCandidate[],
  L: QijiLayout = QIJI_SELECT_LAYOUT,
): readonly QijiHitArea[] {
  const rows = qijiRows(candidates.length, L);
  const step = L.cardW + L.gap;
  return rows.flatMap((row, r) => {
    const rowW = row.length * L.cardW + (row.length - 1) * L.gap;
    const left = (960 - rowW) / 2;
    const y = L.rowTop + r * (L.cardH + L.gap);
    return row.map((index, i) => ({
      index,
      x: left + i * step,
      y,
      w: L.cardW,
      h: L.cardH,
    }));
  });
}

/** 某个点落在哪张卡上（`undefined` = 没点中）。 */
export function qijiAtPoint(
  candidates: readonly QijiCandidate[],
  px: number,
  py: number,
  L: QijiLayout = QIJI_SELECT_LAYOUT,
): QijiCandidate | undefined {
  for (const area of qijiHitAreas(candidates, L)) {
    if (px < area.x || px > area.x + area.w) continue;
    if (py < area.y || py > area.y + area.h) continue;
    return candidates[area.index];
  }
  return undefined;
}

/* ================================================================== *
 * 2. 光标
 * ================================================================== */

/**
 * ← → ↑ ↓ / Tab 移动光标。**两端停住**（不环绕）—— 与选角色屏同一条：
 * 环绕只留给 `Tab`（`wrap: true` 时）。
 *
 * 二维列表里的"左右"是**在行内**移动、"上下"是**换行且尽量对齐列**。
 * 张数少的时候（一行）两者都退化成"左右移动"。
 */
export function moveQijiCursor(
  candidates: readonly QijiCandidate[],
  cursor: number,
  delta: number,
  axis: 'x' | 'y' = 'x',
  wrap = false,
  L: QijiLayout = QIJI_SELECT_LAYOUT,
): number {
  const count = candidates.length;
  if (count === 0) return 0;
  const current = clampIndex(cursor, count);
  const rows = qijiRows(count, L);

  if (axis === 'x') {
    /** 一行内移动：找到当前在哪个分组的第几个。 */
    const row = rows.find((r) => r.includes(current)) ?? [];
    const at = row.indexOf(current);
    const next = at + delta;
    const size = row.length;
    if (wrap) return row[(next + size) % size] ?? current;
    const clamped = Math.min(Math.max(next, 0), size - 1);
    return row[clamped] ?? current;
  }

  /**
   * 上下：直接对**候选序列**加 `±perRow`（而不是"在行之间找最近的横坐标"）。
   * 分组是"均分"的，所以同一个列索引在各行里语义一致 —— 而用横坐标找最近
   * 会在"两行张数不同"时把光标吸到旁边一列，玩家看到的是"上下键乱跳"。
   */
  const per = rows[0]?.length ?? count;
  const next = current + delta * per;
  if (next < 0 || next >= count) {
    if (!wrap) return current;
    return ((next % count) + count) % count;
  }
  return next;
}

/** 把光标夹进 `0..count-1`（`count = 0` 时为 0）。 */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

/** 光标此刻停在哪一张卡（渲染层用它画光标环）。 */
export function qijiCursorTarget(
  candidates: readonly QijiCandidate[],
  cursor: number,
): QijiCandidate | undefined {
  if (candidates.length === 0) return undefined;
  return candidates[clampIndex(cursor, candidates.length)];
}

/** 这一屏现在能不能确认（没有候选时"确认"什么都不做）。 */
export function canConfirm(candidates: readonly QijiCandidate[]): boolean {
  return candidates.length > 0;
}

/**
 * Enter 的语义：**选光标处那一个**。
 *
 * @returns 要选的炁机 id；`undefined` = 没有可确认的
 */
export function confirmQiji(
  candidates: readonly QijiCandidate[],
  cursor: number,
): string | undefined {
  const target = qijiCursorTarget(candidates, cursor);
  return target?.qiji.id;
}

/**
 * 点卡片的语义：**移光标 + 确认**（一步到位）。
 *
 * ⚠️ 与备战界面 / 选角色屏同一条规则（`prepareLogic` 文件头那段）：
 * 触屏点一下就该生效，不该"先选中、再点确定" —— 触屏上没有第二个动作。
 *
 * @returns 要选的炁机 id；`undefined` = 没点中卡片
 */
export function pickQiji(
  candidates: readonly QijiCandidate[],
  px: number,
  py: number,
  L: QijiLayout = QIJI_SELECT_LAYOUT,
): { readonly cursor: number; readonly qijiId: string } | undefined {
  const target = qijiAtPoint(candidates, px, py, L);
  if (target === undefined) return undefined;
  const cursor = candidates.findIndex((c) => c.qiji.id === target.qiji.id);
  if (cursor < 0) return undefined;
  return { cursor, qijiId: target.qiji.id };
}
