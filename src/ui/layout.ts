/**
 * 布局表（架构规范 §6.2）。
 *
 * 固定布局用**数据**描述，不散落在各组件里 —— 改布局 = 改这张表。
 *
 * 所有坐标都是 960×540 逻辑像素。关键元素距边界不少于 24 逻辑像素
 * （超宽屏 letterbox 时的安全区，§10.5）。
 */

export const LOGICAL = { width: 960, height: 540 } as const;

/** 安全区：关键元素不得更靠边。 */
export const SAFE_MARGIN = 24;

export const LAYOUT = {
  /** Boss 名 + 阶段 + 战斗计时 */
  bossFrame: { x: 24, y: 14, w: 912, h: 46 },
  /** Boss 施法条 = 预警条。整条屏宽，因为它是"要躲"的唯一信息源 */
  castBar: { x: 24, y: 66, w: 912, h: 40 },

  /** 玩家资源面板 */
  playerFrame: { x: 24, y: 118, w: 336, h: 104 },

  /** Buff 图标条（从右往左排） */
  buffStrip: { x: 936, y: 118, h: 64, w: 56, gap: 6, max: 10 },

  /**
   * 技能栏（底部居中）。
   *
   * `count` 是**最大值**：实际渲染几个由槽位表决定，
   * 否则会出现"右边几个空槽"（踩过）。
   */
  skillBar: { slotW: 68, slotH: 68, gap: 8, maxCount: 10, y: 462 },

  /** 战斗计时（右上角，与 Boss 面板同一行） */
  timer: { x: 936, y: 22, w: 96, h: 30 },

  /** 飘字区域（画面中央偏上） */
  combatText: { x: 480, y: 250 },

  /** 状态提示（"闪避"/"免疫"这类） */
  statusFlash: { x: 480, y: 320 },
} as const;

/**
 * 计算技能栏某个槽位的坐标。
 *
 * @param index 槽位下标
 * @param total 本次实际要渲染的槽位总数（决定整条栏的居中位置）
 */
export function skillSlotRect(
  index: number,
  total: number,
): { x: number; y: number; w: number; h: number } {
  const { slotW, slotH, gap, y } = LAYOUT.skillBar;
  const count = Math.max(1, Math.min(total, LAYOUT.skillBar.maxCount));
  const totalW = count * slotW + (count - 1) * gap;
  const startX = Math.round((LOGICAL.width - totalW) / 2);
  return { x: startX + index * (slotW + gap), y, w: slotW, h: slotH };
}

/** 计算 buff 条第 index 个图标的坐标（从右往左）。 */
export function buffIconRect(index: number): { x: number; y: number; w: number; h: number } {
  const { x, y, w, h, gap } = LAYOUT.buffStrip;
  return { x: x - w - index * (w + gap), y, w, h };
}
