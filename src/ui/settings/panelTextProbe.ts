/**
 * **面板里的文字**：给调试探针读的一份只读投影。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一轮要验的是"**设置面板的字到底变大了没有**"，而这件事有两层：
 *
 *   1. **几何**：面板用的系数是多少（`settingsScale.currentSettingsMetrics().k`）
 *   2. **实际落下去的字号**：Pixi 的 `Text.style.fontSize` 到底是多少
 *
 * ⚠️ **第 2 层不能靠"读源码里那个数"**：字号是各部件在构造 / `relayout()`
 * 时写进 `Label` 的（`scaledFont(...)`），源码里那一行证明不了"这一帧真的
 * 是那个值"。而截图也证明不了 —— 截图上"看起来大了"与"数字对不对"是两件事
 * （本仓库的截图纪律：只拍图、不做断言，所以数字必须由探针给）。
 *
 * 所以这里**遍历 `SettingsPanel.root` 的容器树**，把每个可见 `Text` 的
 * 字号 / 世界坐标 / 前 24 个字读出来。它是纯数据投影（不碰 Pixi 的渲染），
 * 与 `panelProbes` 同一个位置。
 *
 * ⚠️ **只读**：不改任何东西，也不缓存 —— 调用方（`app/debugApi`）每次现取。
 */

/** 一个可见 `Text` 的读数。 */
export interface PanelTextMetric {
  /** 文本（**截到 24 个字**：探针是给人看的，不是全文导出）。 */
  readonly text: string;
  /** 实际字号（`Text.style.fontSize`）。 */
  readonly fontSize: number;
  /** 世界坐标（画布逻辑坐标，已含 Pixi 的层级变换）。 */
  readonly x: number;
  readonly y: number;
}

/**
 * 遍历时认得出的两种节点（结构类型守卫 —— 不 import Pixi 的运行时）。
 *
 * ⚠️ **必须先判容器、再判文字**：本仓库的 `Label` 是个**包装类**，它自己
 * 有一个 `text`（字符串）字段，而真正的 Pixi `Text` 在 `label.root`。
 * 如果先按"有 text 就当文字"来判，会命中 `Label` 包装对象 —— 它没有
 * `style`，于是字号读成 `-1`（实测就是这个形状："探针说 -1"看起来像
 * "字号没设"，排查方向直接跑偏）。
 */
interface NodeLike {
  readonly children?: readonly unknown[] | undefined;
}

/** 真正的 Pixi `Text`：有 `style`（`Label` 包装对象没有）。 */
interface TextLike extends NodeLike {
  readonly text: string;
  readonly style: { readonly fontSize: number };
  readonly worldTransform?: { readonly tx?: unknown; readonly ty?: unknown } | undefined;
  readonly worldVisible?: unknown;
}

/**
 * 容器树 → 可见文字的一份投影。
 *
 * ⚠️ 用**结构类型守卫**（`asTextLike`）而不是 `as any`：AGENTS.md §1 禁止
 * 那两个断言，而这里本来就该显式回答"这个节点到底有没有 text/style"。
 * 认不出来就当没有（容器本身没有 `text`）。
 */
export function collectPanelText(root: unknown): PanelTextMetric[] {
  const out: PanelTextMetric[] = [];
  walk(root, out, 0);
  return out;
}

/**
 * 认一个节点是不是**真正的 Pixi `Text`**（认不出返回 `undefined`）。
 *
 * 判据是 **`style`**（`Text` 独有），不是 `text` —— 见 `NodeLike` 的说明。
 */
function asTextLike(node: unknown): TextLike | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  /**
   * ⚠️ 判据是 **`style` 且 `style.fontSize` 是数字** —— **不能**用
   * `'children' in node` 排容器：Pixi v8 的 `Text` **也有** `children`
   * （它内部有文本节点），实测那样写会把整块面板的文字全过滤掉。
   */
  if (!('style' in node)) return undefined;
  const candidate = node as TextLike;
  /** ⚠️ 这里就是那道类型守卫：`text` 必须是**非空字符串**才算文字对象。 */
  if (typeof candidate.text !== 'string' || candidate.text.length === 0) return undefined;
  if (candidate.style === null || typeof candidate.style !== 'object') return undefined;
  if (typeof candidate.style.fontSize !== 'number') return undefined;
  return candidate;
}

function walk(node: unknown, out: PanelTextMetric[], depth: number): void {
  /** ⚠️ 深度兜底：坏数据（环）不该把探针挂死。 */
  if (depth > 12) return;
  const text = asTextLike(node);
  if (text !== undefined) {
    /**
     * ⚠️ `worldVisible` 而不是 `visible`：父容器藏了（切页 / 另一种操作
     * 方式）时子节点的 `visible` 仍然是 `true` —— 只看自己会报到"看不见的
     * 字"，而那正是这一轮最容易误判的地方。
     */
    if (text.worldVisible === false) return;
    const size = text.style.fontSize;
    const tx = text.worldTransform?.tx;
    const ty = text.worldTransform?.ty;
    out.push({
      text: text.text.slice(0, 24),
      fontSize: size,
      x: typeof tx === 'number' ? Math.round(tx) : -1,
      y: typeof ty === 'number' ? Math.round(ty) : -1,
    });
    return;
  }
  const children = (node as NodeLike).children;
  if (children === undefined) return;
  for (const child of children) walk(child, out, depth + 1);
}
