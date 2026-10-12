/**
 * 键盘输入 → Action（M3）。
 *
 * 这是**唯一**的玩家输入入口。所有按键都被翻译成 `Action`，
 * 于是：
 *   - 引擎收到的输入与 Boss AI 产出的是同一种东西
 *   - 录制 `Action[]` 就等于录下了整场战斗，可逐帧重放
 *
 * ------------------------------------------------------------------
 * 关键设计：按住连发
 * ------------------------------------------------------------------
 *
 * MMO 手感标配：按住技能键，GCD 一好就自动续。
 * 实现要点：
 *   - `keydown` 且 `event.repeat === false` 时才入队一次 Action
 *   - 同时记录"这个键现在是按下状态"
 *   - 引擎侧若发现该键仍被按住且技能可用，会再次入队
 *     （避免键盘重复事件把队列刷爆）
 *
 * ------------------------------------------------------------------
 * 全键盘，且不依赖鼠标
 * ------------------------------------------------------------------
 *
 * 没有 WASD（本作没有位移），主键区全部留给技能。
 * 必须拦掉浏览器默认行为：Tab（焦点）、空格（滚动）、F1-F12。
 */

import type { Action } from '../core/types';

/** 一个槽位的键位绑定。 */
export interface KeyBinding {
  /** 归一化后的键名（小写）。例如 '1' / 'q' / 'shift+1' */
  readonly key: string;
  readonly skillId: string;
}

/**
 * 默认键位：**Q W E R / A S D F 手位区**。
 *
 * 本作没有位移，所以左手最自然的这块键区整体留给技能。
 *
 *   上排  Q W E R
 *   下排  A S D F
 *
 *   Q = 斩（林晚风的普攻，最常用的按在最短的食指/无名指位上）
 *   W = 轰（凯丽的重击）
 *   E = 凝（两个角色共用）
 *   R = 截（凯丽的打断，放最外侧 —— 应急键要和输出键隔开）
 *   A = 闪（凯丽的无敌）
 *   S = 避（林晚风的无敌）
 *   D = 拳（凯丽的普攻）
 *   F = 劈（林晚风的重击）
 *   G = 格（林晚风的按住防御）
 *
 * ==================================================================
 * ⚠️ 2026-10-12：这张表是**整场游戏**的，不是"某个角色的"
 * ==================================================================
 *
 * 两个角色的技能不一样（林晚风有「斩」「劈」「格」「避」，凯丽有
 * 「拳」「轰」「截」「闪」，两人共用「凝」），但它们争的是同一块手位区。
 * 所以这张表列的是**可绑技能的全集**（每个技能一条），而
 * "这个角色这一局按得出来哪些"由装配时**过滤**决定：
 *   - 战斗的槽位与触屏按钮：`app/battleSetup.ts` 的 `bindingsForPlayer`
 *     （再往下，触屏层还会按**引擎的技能集**过滤一次）
 *   - 按键设置页：列全集（它是"整场游戏可绑哪些"，不随角色变）
 *
 * ⚠️ **每个技能都有自己的键，一个键只出现一次**（不是"两个人抢同一个键"）：
 *   - 有键的技能才上技能栏（`slotsFromBindings` 过滤空键），所以
 *     "每人 5 个按钮"要求这 9 条里**属于那个角色的 5 条都有键**
 *   - 若两个技能写同一个键，并集推导出的默认技能栏会出现两格同键
 *     （渲染层按 key 找源槽位，两格会叠在一起）
 *
 * ⚠️ **不做成"每个角色一张表"**：
 *   1. 玩家的改键是**一份**（`settingsStore`）。按角色分表会让
 *      "切换角色 → 键位悄悄变了"，而玩家以为自己改的是全局的
 *   2. 触屏按钮由这张表机械派生（AGENTS.md §3b）。两张表会造出
 *      "两套触屏配置"，那正是 §3b 明确禁止的
 *
 * ⚠️ 代价：**并集里同时有「轰」和「劈」（重击）、「闪」和「避」（无敌）**
 * —— 设置页会同时列出它们（那是全集，不是当前角色）。这是刻意的：
 * 玩家改的是一份键位表，而他会在两个角色之间来回切。
 */
export const DEFAULT_BINDINGS: readonly KeyBinding[] = [
  { key: 'q', skillId: 'attack' },
  /** W = 凯丽的重击。 */
  { key: 'w', skillId: 'blast' },
  { key: 'e', skillId: 'focus' },
  /** R = 凯丽的打断。 */
  { key: 'r', skillId: 'jie' },
  /** A = 凯丽的无敌。 */
  { key: 'a', skillId: 'flash' },
  /** S = 林晚风的无敌。 */
  { key: 's', skillId: 'dodge' },
  /** D = 凯丽的普攻。 */
  { key: 'd', skillId: 'punch' },
  /** F = 林晚风的重击。 */
  { key: 'f', skillId: 'pi' },
  /** G = 林晚风的按住防御。 */
  { key: 'g', skillId: 'guard' },
  /**
   * 「破」：黛玄的基础打断（她还没做）。
   *
   * ⚠️ 它在表里但**默认不绑键**：表是"可绑技能的全集"（设置页读它，
   * 所以它会显示、可以被绑），而战斗画面读 `slotsFromBindings()`，
   * 空键会被过滤掉 —— 所以它默认不上场。
   *
   * ⚠️ 这一段曾经记着一个真实的坑：「截」漏在这张表外面 → 设置页
   * 显示得出来、却**绑不上**（`applyRebind` 的 `map` 匹配不到它，
   * 绑定静默丢失）。两条防线现在都在：`applyRebind` 会追加新技能，
   * 而 `tests/unit/keyRows.test.ts` 有断言强制"每个可绑技能都在这张表里"。
   * ⚠️ **「闪」没有「轰」的待遇**：它是凯丽倒地时**唯一的出路**
   * （`restrictToTags: ['dodge']`），所以它更像是"必须按得到"的那一个 ——
   * 但它在她的技能表里、在设置里可绑，`bindingsForPlayer` 也不会把它
   * 滤掉（过滤的是"她**没有**的技能"，不是"没绑键的技能"）。
   */
  { key: '', skillId: 'break' },
];

/** 需要拦掉默认行为的键（浏览器会用它们做别的）。 */
const PREVENT_DEFAULT = new Set(['tab', ' ', 'f1', 'f2', 'f3', 'f4', 'f5']);

/**
 * **不允许绑定到技能上的键**。
 *
 * ------------------------------------------------------------------
 * 为什么要有一份显式的名单
 * ------------------------------------------------------------------
 *
 * 玩家在设置里按下什么键都能绑，但有些键**绑了会出事**：
 *
 *   - `escape`  **返回**（自由模式 / 选角色屏 → 首页）；设置弹窗打开时
 *               它关闭弹窗。绑成技能后按 Esc 会同时做两件事。
 *   - `tab`     浏览器用来切换焦点。虽然我们 `preventDefault` 掉了，
 *               但把 Tab 绑成技能会让"用键盘走遍界面"这件事变得别扭 ——
 *               而"几乎全键盘可操作"是本项目的硬需求。
 *   - `enter`   确认 / 重开一局。
 *   - `f1`–`f12` 浏览器保留（F1 帮助、F5 刷新、F11 全屏、F12 开发者工具）。
 *     我们只能拦下 F1–F5，F11/F12 根本拦不住 —— 所以整排都不许绑。
 *   - 单独的修饰键（`shift` / `control` / `alt` / `meta`）：
 *     它们应该作为**组合键的前缀**（`shift+1`），单独绑没有意义，
 *     而且会让组合键的判定变得含糊。
 *
 * 名单做成函数导出而不是只写死在捕获流程里 —— 这样**界面能提前提示**
 * 哪些键不能用，而不是等玩家按了才拒绝。
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'escape',
  'tab',
  'enter',
  'shift',
  'control',
  'alt',
  'meta',
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

/** 这个键是否被系统保留（不能绑技能）。 */
export function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

/**
 * 保留键的**可读名字**（提示文案里用）。
 *
 * 返回的是 i18n key 而不是中文：这一层不该出现文案。
 */
export function reservedKeyLabel(key: string): string {
  if (/^f\d+$/.test(key)) return 'F1–F12';
  switch (key) {
    case 'escape':
      return 'Esc';
    case 'tab':
      return 'Tab';
    case 'enter':
      return 'Enter';
    case 'shift':
    case 'control':
    case 'alt':
    case 'meta':
      return key;
    default:
      return key;
  }
}

/**
 * 把 `KeyboardEvent` 归一成一个键名。
 *
 * 归一化的必要性：`event.key` 的大小写随 Shift 变化
 * （按 Shift+1 得到 '!'），直接拿它查表会漏。
 * 所以用 `event.code` 推导出**物理键**，再单独带上修饰键前缀。
 */
export function normalizeKey(event: {
  readonly key: string;
  readonly code?: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  /** Mac 的 Command。需求要求 ctrl/command 都支持。 */
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}): string {
  let base = event.key.toLowerCase();

  // 数字键：Shift+1 会给出 '!'，用 code 还原成 '1'
  if (event.code?.startsWith('Digit')) base = event.code.slice(5);
  else if (event.code?.startsWith('Key')) base = event.code.slice(3).toLowerCase();
  else if (event.code?.startsWith('Numpad')) base = `num${event.code.slice(6)}`;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  /**
   * ⚠️ `metaKey` = Mac 的 **Command**。
   *
   * 需求："快捷键是 ctrl/command + 原技能快捷键" —— 所以两个都要认。
   * 原先没有这一行，于是 Mac 上按 Cmd 会被当成"没按修饰键"，
   * `Cmd+Q` 与 `Q` 归一化成同一个 key，派生技永远触发不了。
   */
  if (event.metaKey) parts.push('meta');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey && !/^[0-9]$/.test(base)) parts.push('shift');
  parts.push(base);
  return parts.join('+');
}

export interface InputSource {
  /** 本 tick 要交给引擎的动作 */
  drain(): readonly Action[];
  /** 该键当前是否被按住（引擎据此做"按住连发"） */
  isHeld(key: string): boolean;
  /** 该键绑定的技能 id */
  skillForKey(key: string): string | undefined;
  /** 当前的键位表（只读） */
  bindings(): readonly KeyBinding[];
  /**
   * 运行时替换键位表（按键设置用）。
   *
   * 会顺带清掉"按住中"的状态 —— 改键那一刻，旧键上的按住语义已经失效，
   * 不清掉会导致引擎继续按新键的代价扣资源。
   */
  setBindings(bindings: readonly KeyBinding[]): void;
  /**
   * 进入/退出**捕获模式**：捕获期间所有按键不产生 Action，
   * 而是交给 `onCapture` 回调。
   *
   * 按键设置必须这样独占输入，否则玩家按 `Esc` 想取消改键，
   * 结果技能真的放出去了。
   */
  capture(onCapture: ((key: string) => void) | undefined): void;
  /** 销毁监听 */
  dispose(): void;
}

export interface InputOptions {
  /** 键位表。默认 `DEFAULT_BINDINGS`。 */
  readonly bindings?: readonly KeyBinding[];
  /** 战斗内时间（tick）的读取方式 —— 由主循环注入，保证时间来源唯一。 */
  readonly currentTick: () => number;
  /** 暂停/恢复等界面动作 */
  readonly onUiKey?: (key: string) => void;
  /**
   * 判断某个技能是否是"按住型"（`holdDrain`）。
   *
   * 按住型技能用 `hold` 而不是 `useSkill` 入队，并且在松手时发
   * `releaseSkill` —— 引擎据此维护"按住"状态并每逻辑步扣资源。
   */
  readonly isHoldSkill?: (skillId: string) => boolean;
  /**
   * **派生技解析**：`Ctrl/Cmd + 原技能键` 时该放哪个技能。
   *
   * 需求："键盘派生技能显示在原技能的上方，快捷键是 ctrl/command +
   * 原技能快捷键。"
   *
   * 入参是**归一化后的 base 键**（不含修饰前缀），返回派生技 id；
   * 没有生效中的派生窗口时返回 `undefined` —— 那时按 `Ctrl+Q`
   * 就什么都不做（而不是误放「斩」）。
   *
   * ⚠️ 交给调用方注入而不是在输入层硬编码：输入层不该知道
   * "哪个 buff 派生了哪个技能"，那是内容/引擎的事。
   */
  readonly resolveDerived?: (baseKey: string) => string | undefined;
}

/**
 * 创建一个键盘输入源。
 *
 * 刻意**不在这里直接驱动引擎** —— 它只产 Action，
 * 由主循环在每 tick 把它 drain 给引擎。这样输入层可以脱离
 * DOM 进行测试（传入假的 keydown 事件对象即可）。
 */
export function createKeyboardInput(
  target: { addEventListener: EventTarget['addEventListener']; removeEventListener: EventTarget['removeEventListener'] },
  options: InputOptions,
): InputSource {
  /** 键位表**可变** —— 按键设置会在运行时替换它。 */
  let keyToSkill = new Map<string, string>();
  let currentBindings: readonly KeyBinding[] = options.bindings ?? DEFAULT_BINDINGS;
  const applyBindings = (next: readonly KeyBinding[]): void => {
    currentBindings = next;
    keyToSkill = new Map(next.map((b) => [b.key, b.skillId]));
  };
  applyBindings(currentBindings);

  /** 捕获模式：非空时所有按键都交给它，不产生 Action */
  let captureHandler: ((key: string) => void) | undefined;

  const held = new Set<string>();
  /** 当前被按住的"按住型"技能：键 → 技能 id */
  const heldSkills = new Map<string, string>();
  const queue: Action[] = [];

  const onKeyDown = (rawEvent: Event): void => {
    const event = rawEvent as KeyboardEvent;
    const key = normalizeKey(event);

    if (PREVENT_DEFAULT.has(key)) event.preventDefault?.();

    /**
     * 捕获模式优先于一切：正在改键时，这个按键属于"设置界面"，
     * 不该被当成技能（否则按 Esc 取消会真的把技能放出去）。
     */
    if (captureHandler) {
      event.preventDefault?.();
      if (!event.repeat) captureHandler(key);
      return;
    }

    // 界面按键（暂停等）交给上层，不作为技能处理
    if (options.onUiKey && (key === 'escape' || key === 'enter')) {
      if (!event.repeat) options.onUiKey(key);
      return;
    }

    held.add(key);

    // `repeat` 为真说明是操作系统的连发 —— 忽略它，
    // 连发由引擎侧的"按住"逻辑处理（避免队列被刷爆）
    if (event.repeat) return;

    /**
     * `Ctrl/Cmd + base` → 派生技。
     *
     * ⚠️ **只认 ctrl / meta**，不认 shift/alt：需求写的是
     * "ctrl/command + 原技能快捷键"。而且这样 `Shift+Q` 这种
     * 玩家自定义绑定不会被误当成派生。
     */
    const baseKey = key.replace(/^(ctrl|meta|alt|shift)\+/g, '');
    const withModifier = key.includes('+');
    const derived =
      withModifier && (key.startsWith('ctrl+') || key.startsWith('meta+'))
        ? options.resolveDerived?.(baseKey)
        : undefined;

    const skillId = derived ?? keyToSkill.get(key);
    if (skillId) {
      const atTick = options.currentTick();
      if (options.isHoldSkill?.(skillId)) {
        // 按住型：进入按住状态（引擎每逻辑步扣资源，松手才结束）
        heldSkills.set(key, skillId);
        queue.push({ type: 'hold', skillId, atTick });
      } else {
        queue.push({ type: 'useSkill', skillId, atTick });
      }
    }
  };

  const onKeyUp = (rawEvent: Event): void => {
    const key = normalizeKey(rawEvent as KeyboardEvent);
    held.delete(key);
    queue.push({ type: 'releaseKey', key, atTick: options.currentTick() });

    // 松开按住型技能 → 明确结束它（否则 buff 会挂到 duration 到期）
    const heldSkill = heldSkills.get(key);
    if (heldSkill !== undefined) {
      heldSkills.delete(key);
      queue.push({ type: 'releaseSkill', skillId: heldSkill, atTick: options.currentTick() });
    }
  };

  const onBlur = (): void => {
    // 失焦时清空按住状态：否则切走再回来会误判"还在按住"，
    // 而"还在按住"意味着引擎会继续扣资源 —— 那会白扣玩家的缠。
    for (const [key, skillId] of heldSkills) {
      queue.push({ type: 'releaseSkill', skillId, atTick: options.currentTick() });
      heldSkills.delete(key);
    }
    held.clear();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    drain(): readonly Action[] {
      const out = [...queue];
      queue.length = 0;
      return out;
    },
    isHeld(key: string): boolean {
      return held.has(key);
    },
    skillForKey(key: string): string | undefined {
      return keyToSkill.get(key);
    },
    bindings(): readonly KeyBinding[] {
      return currentBindings;
    },
    setBindings(next: readonly KeyBinding[]): void {
      applyBindings(next);
      // 改键那一刻旧的"按住"语义已失效，必须清掉 ——
      // 否则引擎会继续按新键的代价扣资源
      for (const [key, skillId] of heldSkills) {
        queue.push({ type: 'releaseSkill', skillId, atTick: options.currentTick() });
        heldSkills.delete(key);
      }
      held.clear();
    },
    capture(onCapture: ((key: string) => void) | undefined): void {
      captureHandler = onCapture;
    },
    dispose(): void {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}

/**
 * 按住连发：对每个"仍被按住"的技能键，若其技能当前可用，则补一个 Action。
 *
 * 抽成纯函数是为了可测 —— 它不碰 DOM。
 */
export function repeatHeld(
  input: Pick<InputSource, 'isHeld' | 'skillForKey'>,
  bindings: readonly KeyBinding[],
  tick: number,
  isSkillUsable: (skillId: string) => boolean,
  isHoldSkill?: (skillId: string) => boolean,
): readonly Action[] {
  const out: Action[] = [];
  for (const binding of bindings) {
    if (!input.isHeld(binding.key)) continue;
    /**
     * **按住型技能不参与连发。**
     *
     * 它已经在按住状态里了（引擎每逻辑步扣资源维持效果）。
     * 如果这里也补 `useSkill`，会变成每 tick 重放一次技能 ——
     * 既白扣"施放代价"，又会把持续时间不断刷新。
     */
    if (isHoldSkill?.(binding.skillId)) continue;
    if (!isSkillUsable(binding.skillId)) continue;
    out.push({ type: 'useSkill', skillId: binding.skillId, atTick: tick });
  }
  return out;
}
