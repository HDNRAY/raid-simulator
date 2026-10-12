/**
 * 设置面板给**调试探针**看的那几样只读东西（`app/debugApi` 读它们）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 在加了"按操作方式分两块"之后到了 **728 行**
 * （AGENTS.md §3 的上限 700）。按 §3 的顺序**不许压注释**：这一撮是
 * "验证脚本能读到什么"，与"面板怎么收输入 / 焦点在谁身上"没有交集 ——
 * 整块搬出来，注释一起搬。
 *
 * ==================================================================
 * ⚠️ 它们存在的理由（评论与 `settingsTrace` 一样，是**内容**不是填充物）
 * ==================================================================
 *
 *   - `trace`：**"按键没生效"这类问题只能靠事件序列定位** —— 排查"一次
 *     `Enter` 同时进入改键并完成绑定"就是靠它（日志一眼看出 `startCapture`
 *     之后紧跟 `finishCapture(enter)`）。截图和单元测试都看不到这一层。
 *   - `detailScroll`：**"滚了没有"看不出来** —— 滚动前后各拍一张图只能证明
 *     "内容位置不同"，证明不了"是谁动的、还能不能继续滚"。
 *   - `cellCenter` / `slotCenter`：验证脚本要**注入真实点击**，而坐标必须与
 *     渲染/命中**同一份几何**（各算一份就会出现"脚本点的位置界面不认"）。
 *
 * ⚠️ 纯数据 + 取值函数（不碰 Pixi），所以这一段是"面板的一小块知识"，
 * 而不是"面板的一部分"。
 */

import { keyCellRect, keyGridMetrics } from './logic';
import { pickerCellRect, pickerMetrics } from './touchPickerLayout';

/** 详情区的滚动状态（见 `SkillDetail.scrollState`）。 */
export interface DetailScrollState {
  readonly offset: number;
  readonly total: number;
  readonly rows: number;
  readonly lines: readonly number[];
}

export interface SettingsProbes {
  /** 按键轨迹（环形缓冲，最多 40 行）。 */
  readonly trace: string[];
  pushTrace(line: string): void;
  detailScroll(): DetailScrollState;
  cellCenter(index: number): { readonly x: number; readonly y: number };
  slotCenter(index: number): { readonly x: number; readonly y: number } | undefined;
  /** **触屏技能面**第 `index` 格（窗口内下标）的圆心 —— 触屏那套自己的面。 */
  pickerCellCenter(index: number): { readonly x: number; readonly y: number } | undefined;
}

export interface SettingsProbesDeps {
  /** 当前是否显示键名 —— 它决定网格度量，探针必须**同一份**。 */
  readonly showKeyHints: () => boolean;
  readonly detailScroll: () => DetailScrollState;
  readonly slotCenter: (index: number) => { readonly x: number; readonly y: number } | undefined;
  /** 技能池大小（技能面的几何按它算几行 —— 与渲染同一份）。 */
  readonly rowCount: () => number;
}

/** 轨迹环形缓冲的容量（面板原先就写 40）。 */
const TRACE_CAPACITY = 40;

export function makeSettingsProbes(d: SettingsProbesDeps): SettingsProbes {
  const trace: string[] = [];
  return {
    trace,
    pushTrace(line) {
      trace.push(line);
      if (trace.length > TRACE_CAPACITY) trace.shift();
    },
    detailScroll: () => d.detailScroll(),
    /**
     * 第 `index` 个技能格的圆心（逻辑坐标）—— 验证脚本注入真实点击用。
     *
     * ⚠️ 走的是**渲染/命中同一份度量**（`keyGridMetrics(showKeyHints)`），
     * 不是另算一份。见 `debugApi.SettingsDebugTarget.cellCenter` 的说明。
     */
    cellCenter(index) {
      const rect = keyCellRect(index, keyGridMetrics(d.showKeyHints()));
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    },
    /** 第 `index` 个**键位**的圆心（键位预览自己的几何，越界返回 `undefined`）。 */
    slotCenter: (index) => d.slotCenter(index),
    /**
     * **触屏技能面**第 `index` 格（**窗口内**下标）的圆心。
     *
     * ⚠️ 与键盘格阵（`cellCenter`）是**两个面**：触屏那套自己的技能面
     * （`TouchSkillPicker` + `touchPickerLayout`）。脚本要注入真实点击，
     * 所以它和绘制必须是同一份几何。
     */
    pickerCellCenter(index) {
      const count = d.rowCount();
      if (index < 0 || index >= count) return undefined;
      const rect = pickerCellRect(index, pickerMetrics(count));
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    },
  };
}
