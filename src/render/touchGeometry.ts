/**
 * 触屏按钮的**双弧几何（唯一真相）**。
 *
 * ==================================================================
 * 为什么单独一个文件（从 `touchButtonLayer.ts` 拆出来）
 * ==================================================================
 *
 * 这份几何现在有**两个画它的人**：
 *   1. `TouchButtonLayer`（战斗里的双弧按钮）
 *   2. 设置页右下角的**模拟键位预览**（`ui/settings/TouchSlotPreview.ts`）
 *
 * 如果预览自己再摆一套坐标，两者迟早会漂 —— 那正是本仓库反复踩的
 * "两份真相"（预览看着在左、实际在右，而截图上看不出）。所以几何下沉
 * 到这里，两边都只**消费**它。
 *
 * ⚠️ 它**不 import pixi**：设置页的预览只要几何，不要渲染层。
 * 抽出来之后 `ui/settings/` 依赖的是"算出来的数字"，不是 Pixi 对象。
 *
 * ==================================================================
 * 为什么是双弧（不是 4×2 格子）
 * ==================================================================
 *
 * 用户定案："移动端的技能按钮，应该是圆形，而且应该不是 4*2，
 * 参考其他同类游戏，是类似扇形排列的。"
 *
 * 理由是手的运动方式：拇指绕**拇指根**划弧，弧上的点**等距可达**；
 * 格子里的四个角要伸直手指去够。
 *
 * ==================================================================
 * ⚠️ 几何是算出来的，不是猜的
 * ==================================================================
 *
 * **单弧放不下**：半径 r 的弧上，相邻按钮需要弦长 ≥ `D+gap`，
 * 所以角间隔 = `2·asin((D+gap)/2r)`。实测 r=130 时角间隔约 32°，
 * 可用弧段（约 110°）只放得下 3–4 个。
 *
 * 当前几何（**穷举搜索**后的可行解，`D=72, gap=10`）：
 *
 *   圆心 `(950, 535)` —— **游戏区域的右下角**
 *   内弧 r=150，80° → 15°，**3 个**
 *   外弧 r=235，80° → 10°，**4 个**
 *
 * 已验证：4 / 5 / 6 / 7 个都不重叠（7 个时最小间距 84 > 82）、
 * 不越界、不压左列与 Boss 区。
 *
 * ==================================================================
 * ⚠️ 圆心为什么是 (950,535) 而不是正角落 (960,540)
 * ==================================================================
 *
 * 需求："应该以游戏区域右下角为圆心"。
 *
 * 但圆心**正好**在 `(960,540)` 时，可用角度区只有约 70° ——
 * 因为按钮自身有半径：角度接近 `0°` 会从**右边**出去，接近 `90°`
 * 会从**下边**出去。实测（D=72）：
 *
 *   任意半径的单弧最多放 **3–4 个**，**7 个放不下**（穷举 0 组可行）
 *
 * 把圆心往里挪 10px（`(950,535)`，视觉上仍然是右下角）之后，
 * 可用角度区变宽，同一套约束下有 **24 组可行解**。
 *
 * ⚠️ 另一个约束是**两弧必须在径向上分开 ≥ D+gap**：它们的角度带
 * 若重叠，半径差小于 82px 就会让相邻两弧的按钮撞上（实测 85px
 * 半径差时只有 45px 间距）。
 *
 * ⚠️ 每个弧**按自己的容量均分**角度（而不是按实际数量）——
 * 否则"只放 2 个"时会把它们铺满整条弧，两弧在视觉上交错。
 * 这也让"槽位 i 的位置"**与放了几个强无关**：槽位是固定的格子，
 * 玩家在设置页把技能放进哪个槽位，战斗里就出现在哪个位置。
 *
 * ⚠️ **容量上限是 7**（3+4）。第 8 个开始放不下 —— 要么缩小按钮
 * （64px 能到 5+4），要么改角度范围。真的加技能到 8 个时，
 * `touchButtonCenter()` 返回 `undefined`，调用方**跳过**而不是画一个
 * 重叠的按钮。设置页的预览只画这 7 个槽位（见 `TOUCH_BUTTON_CAPACITY`）。
 * 这个上限在 `docs/plans/2026-10-10-m8-mobile.md` §9.1 里记着。
 */

/** 按钮直径。72px ≈ 44px 可点下限的 1.6 倍，拇指按得准。 */
export const TOUCH_BUTTON_DIAMETER = 72;
/** 相邻按钮的最小间隔。 */
export const TOUCH_BUTTON_GAP = 10;

/** 双弧的圆心 —— 拇指根的大致位置（右下角偏内）。 */
export const TOUCH_ARC_CENTER = { x: 950, y: 535 } as const;

interface ArcSpec {
  readonly radius: number;
  /** 起始角（度）。0° = 正右，逆时针为正。 */
  readonly fromDeg: number;
  readonly toDeg: number;
  readonly capacity: number;
}

/**
 * 内弧先排（离拇指近），排满再上外弧。
 *
 * ⚠️ 顺序不能反：玩家最先看到的按钮应该在最舒服的位置。
 */
const ARCS: readonly ArcSpec[] = [
  { radius: 150, fromDeg: 80, toDeg: 15, capacity: 3 },
  { radius: 235, fromDeg: 80, toDeg: 10, capacity: 4 },
];

/** 双弧的总容量（= 槽位个数）。 */
export const TOUCH_BUTTON_CAPACITY = ARCS.reduce((n, a) => n + a.capacity, 0);

/**
 * 第 `index` 个槽位的圆心位置。
 *
 * 返回 `undefined` 表示**超出容量**（调用方应跳过，而不是画重叠）。
 */
export function touchButtonCenter(index: number): { x: number; y: number } | undefined {
  let remaining = index;
  for (const arc of ARCS) {
    if (remaining < arc.capacity) {
      const span = arc.fromDeg - arc.toDeg;
      /**
       * 单个按钮时放在**弧中**（而不是起始角）—— 否则它会贴在弧的
       * 一端，看起来像布局坏了。
       */
      const t = arc.capacity === 1 ? 0.5 : remaining / (arc.capacity - 1);
      const deg = arc.fromDeg - span * t;
      const rad = (deg * Math.PI) / 180;
      return {
        x: TOUCH_ARC_CENTER.x - arc.radius * Math.cos(rad),
        y: TOUCH_ARC_CENTER.y - arc.radius * Math.sin(rad),
      };
    }
    remaining -= arc.capacity;
  }
  return undefined;
}

/**
 * 角标环的**圆心偏移**（相对按钮圆心）与半径系数。
 *
 * ⚠️ 导出是因为**命中测试要用同一组数字** —— 画在这里、点在别处
 * 就会出现"看着能点、点不中"。
 */
export const BADGE_OFFSET_RATIO = 0.6;
/**
 * 环的半径系数。
 *
 * ⚠️ 与偏移一起决定"环在按钮内还是压在边上"。原先偏移 0.72 时，
 * 环心到按钮圆心 `0.72·√2·r ≈ 1.02r` —— **刚好在按钮外**，于是
 * 环大部分露在按钮外面，点它还会先命中按钮边缘。实测发现后
 * 收到 0.6（`0.6·√2 ≈ 0.85r`，落在按钮内，视觉上像"贴一个角标"）。
 *
 * ⚠️ 需求："现在触屏的派生 好像有点小" —— 0.42 → **0.55**
 * （直径 30px → 40px）。
 *
 * 依据是**命中区**而不是好看：命中半径 = `BADGE_RADIUS_RATIO × r × 1.4`，
 * 于是直径从 **42px → 55px**，越过触屏可点下限（44px）。
 * 0.42 时是 42px —— **差 2px 不达标**。
 *
 * 环**本来就该露出按钮**（它是"贴右上角的角标"，压在边缘才读得出是角标）。
 * 真正的约束是**环心必须在按钮圆内**（`0.6·√2·r ≈ 0.85r < r`），
 * 否则点它会先命中按钮边缘；这条有 `tests/unit/touchInput.test.ts` 钉着。
 */
export const BADGE_RADIUS_RATIO = 0.55;

/** 某个按钮角标环的圆心（给命中测试用）。 */
export function badgeCenter(button: { x: number; y: number }): { x: number; y: number } {
  const r = TOUCH_BUTTON_DIAMETER / 2;
  const d = Math.round(r * BADGE_OFFSET_RATIO);
  return { x: button.x + d, y: button.y - d };
}

/** 一个轴对齐的矩形（`cx` / `cy` 是它的中心）。 */
export interface LayoutBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
}

/**
 * **整组双弧按钮**（含按钮半径）的外接矩形。
 *
 * 设置页的预览要把它按比例装进一个区域 —— 比例只能从这份外接矩形
 * 算出来（`scale = min(区域宽/宽, 区域高/高)`），**不许手写缩放系数**：
 * 手写的那一天，半径一调预览就与实际不一致，而截图上看不出来。
 *
 * @param pad 每边留出的余量，默认 = 按钮半径（把按钮本体也算进去）
 */
export function touchLayoutBounds(pad: number = TOUCH_BUTTON_DIAMETER / 2): LayoutBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < TOUCH_BUTTON_CAPACITY; i += 1) {
    const c = touchButtonCenter(i);
    if (c === undefined) continue;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  const x = minX - pad;
  const y = minY - pad;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}
