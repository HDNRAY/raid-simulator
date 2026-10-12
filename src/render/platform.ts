/**
 * 平台能力探测。
 *
 * ==================================================================
 * 为什么需要它
 * ==================================================================
 *
 * 移动端与桌面的 UI **共用同一套 canvas 绘制**（这是用户定案的
 * "同一套 canvas UI，触屏只是再加一层虚拟按键"）。但有些东西
 * **只对其中一边有意义**：
 *
 *   - 键盘快捷键提示（`攻 Q` / `设置 F1` / `恢复默认 (R)`）
 *     触屏上没有任何键可按，显示出来纯属噪音 —— 需求明确要求
 *     "移动端就不用显示快捷键信息了"。
 *   - 战斗结算的"按 Enter 再来一次" → 触屏要变成"点击屏幕再来一次"。
 *   - 触屏按钮层本身（M8-5）。
 *
 * 与其让每个渲染部件各自去问浏览器，不如**只在这里问一次**，
 * 然后当作一个普通参数往下传（`FrameContext` / 组件 options）。
 *
 * ==================================================================
 * ⚠️ 探测**能力**，不探测 User-Agent
 * ==================================================================
 *
 * 用 `matchMedia('(pointer: coarse)')` 判断"主输入设备是不是手指"。
 *
 * 不解析 UA 的理由：
 *   - UA 字符串是**可以伪造且经常变化**的，靠它判断迟早出错
 *   - 更重要：**触屏笔记本**这类混合设备的 UA 与普通笔记本一样，
 *     但它**确实有一块手指能点的屏**。UA 判断会漏掉它，
 *     能力判断不会。
 *
 * 混合设备（触屏 + 鼠标）下 `touch` 为真：两种输入源**都保留**
 * （键鼠照常可用），只是不显示快捷键提示 —— 提示是"给不看屏幕
 * 找键的人"用的，手指用户不需要。
 *
 * ==================================================================
 * ⚠️ 纯函数 + 注入，便于测试
 * ==================================================================
 *
 * `detectPlatform` 收一个最小的查询接口而不是直接摸 `window`，
 * 所以单测可以喂任意组合，不需要真的有一个触屏设备。
 */

/** 探测所需的浏览器查询能力（注入，便于测试）。 */
export interface PlatformProbe {
  /** 媒体查询是否命中。 */
  readonly matches: (query: string) => boolean;
  /** 是否支持 Pointer Events（触屏输入层的前提）。 */
  readonly hasPointerEvents: boolean;
}

export interface PlatformCaps {
  /**
   * 主输入设备是"手指"（粗指针）。
   *
   * 语义是"**可能要显示触屏按钮**"，不是"只能触摸" ——
   * 混合设备下它也为真，而鼠标键盘仍然可用。
   */
  readonly touch: boolean;
  /**
   * 是否显示键盘快捷键提示。
   *
   * 需求："移动端就不用显示快捷键信息了，无论是技能按钮还是
   * 其他的功能按钮，包括 'enter' 再来一次也改成点击屏幕再来一次之类的。"
   */
  readonly showKeyHints: boolean;
}

/**
 * 从探测结果推导能力。
 *
 * ⚠️ `showKeyHints` 与 `touch` **当前是反相关的**，但刻意分成两个
 * 字段：将来如果要做"触屏上也显示键位（给接键盘的平板用户）"
 * 这类开关，改的是一个字段而不是散落各处的 `if (touch)`。
 */
export function detectPlatform(probe: PlatformProbe): PlatformCaps {
  const coarse = probe.matches('(pointer: coarse)');
  /**
   * `hover: none` 作为补充信号：粗指针 + 不能悬停 = 典型的手指设备。
   * 有些平板的 `pointer: coarse` 不命中（接了触控板），但
   * `hover: none` 会命中。
   *
   * 两者取**或**：宁可多认成触屏（只是不显示键名提示，代价很小），
   * 也不要漏掉真正的触屏用户（他们要按不到按钮）。
   */
  const noHover = probe.matches('(hover: none)');
  const touch = (coarse || noHover) && probe.hasPointerEvents;
  return { touch, showKeyHints: !touch };
}

/** 浏览器实现（生产路径）。 */
export function browserPlatformProbe(): PlatformProbe {
  return {
    matches: (query) => {
      // SSR / 老浏览器没有 matchMedia：当作"不是触屏"（保守）
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
      }
      return window.matchMedia(query).matches;
    },
    hasPointerEvents: typeof window !== 'undefined' && 'PointerEvent' in window,
  };
}

/** 生产入口：直接探测当前浏览器。 */
export function detectBrowserPlatform(): PlatformCaps {
  return detectPlatform(browserPlatformProbe());
}
