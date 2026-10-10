/**
 * 渲染层的 view-model（架构规范 C3）。
 *
 * **渲染层不许 import core 内部**，只认这个文件定义的只读形状。
 * 好处：
 *   - 换渲染库（Three/Konva）时只改消费端
 *   - UI 组件可以在测试里用假数据驱动，不需要跑引擎
 *   - 将来引擎进 worker 时，这份形状直接就是 postMessage 的载荷
 *
 * 这个文件是**纯类型 + 纯函数**，零依赖（连 pixi 都不 import）。
 */

/* ------------------------------------------------------------------ *
 * 战斗快照（渲染需要的全部信息）
 * ------------------------------------------------------------------ */

export interface ResourceView {
  readonly current: number;
  readonly cap: number;
}

export interface BuffView {
  readonly id: string;
  readonly nameKey: string;
  readonly icon: string;
  readonly polarity: 'buff' | 'debuff' | 'neutral';
  /**
   * 色块图标用的颜色。
   *
   * 目前美术素材是**单色方块占位** —— 由内容里的 `color` 决定；
   * 没给则由 polarity 推导。接入正式图标后这一项会被贴图替换。
   */
  readonly color: number;
  /**
   * 极简标签的**语言 key**（最多 2 字）。
   *
   * 为什么不显示全名：buff 条是横排的，全名会把整条撑爆。
   * 完整说明留给悬停/详情面板（M7）。
   * 给 key 而不是文案 —— 渲染层不持有可显示文字（i18n 规范 I1）。
   */
  readonly shortLabelKey: string;
  readonly stacks: number;
  /** 剩余时间（ms）；永久为 Infinity */
  readonly remainingMs: number;
  readonly durationMs: number;
  /** 是否是"判定窗口"类 buff（无敌 / 减伤）—— UI 要用最醒目的方式显示 */
  readonly isDefensive: boolean;
}

import { IDLE_FEEDBACK, type FeedbackState } from './feedback';

export interface CombatantView {
  readonly id: string;
  readonly nameKey: string;
  readonly side: 'ally' | 'enemy';
  readonly alive: boolean;
  readonly hp: ResourceView;
  readonly energy: ResourceView;
  readonly douqi: ResourceView;
  readonly buffs: readonly BuffView[];
  /**
   * 这个角色**刚放了攻击招式**（用来切攻击帧）。
   *
   * 需求："人物攻击，无论是那个攻击（tags实现）都播放 攻击帧。"
   *
   * ⚠️ 判定依据是技能的 **`SkillTag`**（`melee` / `spell`），不是
   * 写死技能 id 列表 —— 那样加新攻击技能就会漏。
   */
  readonly attacking: boolean;
  /**
   * **本帧的受击反馈**（受击 / 眩晕 / 被击共用同一套通道）。
   *
   * ⚠️ 由 `viewAdapter` 从引擎事件算出并衰减 —— 渲染层**只读它**，
   * 不自己判断"发生了什么"。这样加一种状态只需要改适配器 + 一个纯函数。
   * 见 `render/feedback.ts` 的设计说明。
   */
  readonly feedback: FeedbackState;
  /** 正在读条：技能 id 与进度 0..1。没有则为 undefined */
  readonly cast?: {
    readonly skillId: string;
    readonly nameKey: string;
    /** 0..1 */
    readonly progress: number;
    readonly interruptible: boolean;
    /** 还要多久命中（ms）—— 预警文案用 */
    readonly remainingMs: number;
    /**
     * 招式的**玩法提示标签**（需求："boss 的招式的 tags 显示在它的读条中"）。
     *
     * 例：`interruptImmune`（霸体，打不断）、`highDamage`（高伤，
     * 闪避比防御更值）。文案在 i18n 里。
     */
    readonly hintTags?: readonly string[];
  };
}

/**
 * 资源 key。
 *
 * 与 core 的 `ResourceKey` 是同一组字面量。**故意在这里重复声明** ——
 * 渲染层不许 import core 内部（见本文件开头），所以类型也要自持。
 */
export type ResourceKeyName = 'hp' | 'energy' | 'douqi';

/** 技能格的资源代价（左下方显示）。 */
export interface SlotCost {
  readonly resource: ResourceKeyName;
  readonly value: number;
  /**
   * 数值后缀（如 `/s`）。
   *
   * 按住技（「防」）的代价是**每秒**扣的，所以写 `2/s` 而不是 `2` ——
   * 后者会被读成"一共 2 点"（需求："防 代价应该显示 2/s"）。
   * 后缀本身是**渲染层加的字面量**，不走 i18n：`/s` 是通用符号，
   * 任何语言下都一样。
   */
  readonly suffix?: string;
}

export interface SkillSlotView {
  readonly index: number;
  /** 物理按键（如 '1' / 'q'） */
  readonly key: string;
  readonly skillId: string;
  readonly nameKey: string;
  readonly icon: string;
  readonly usable: boolean;
  /** 冷却剩余比例 0..1（0 = 已好） */
  readonly cooldownRatio: number;
  /** 冷却剩余秒数（展示用）—— **实时**剩余，显示在格子正中 */
  readonly cooldownSec: number;
  /**
   * 技能的**固有冷却**秒数（满冷却时长），显示在左下角。
   *
   * ⚠️ 与 `cooldownSec` 是两回事（需求专门澄清过）：
   *   - `cooldownSec` = **实时**还剩多久 → 格子**正中**
   *   - `skillCdSec`  = 这个技能**本来**的冷却多久 → 格子**左下**
   * 0 表示没有冷却（不显示）。
   */
  readonly skillCdSec: number;
  /** 是否是派生技且当前窗口已开 */
  readonly comboReady: boolean;
  /**
   * 这个槽位是**派生技**，且它是从哪个技能派生来的。
   *
   * 需求："键盘派生技能显示在**原技能的上方**" —— 渲染层靠它把派生技
   * 画在源技能旁边（键盘：角标；触屏：原按钮上的环）。
   *
   * ⚠️ 源是**动态的**（"后派生的顶掉先派生的"），所以它来自 buff 的
   * flags 而不是技能的静态定义。
   */
  readonly derivedFrom?: string;
  /**
   * 资源代价（用于在技能格右上角显示）。
   *
   * 需求："右上显示资源代价，炁 / 缠 / 甚至血，用相应的颜色代表那种资源"。
   *
   * ⚠️ 这里给的是**资源 key + 数值**，不是文案 —— 渲染层按 key 取颜色、
   * 自己格式化成数字（i18n 规范 I1：渲染层不持有可显示文字）。
   * 「防」是按住技，它的代价是 `holdDrain`（每逻辑步扣多少），
   * 所以也走同一个字段。
   */
  readonly cost?: SlotCost;
  /** 不可用的原因（**本地化 key**，不是文案） */
  readonly blockedKey?: string;
}

export interface FloatingTextView {
  readonly id: number;
  readonly text: string;
  readonly color: number;
  readonly x: number;
  readonly y: number;
  /** 0..1，1 = 刚出现 */
  readonly life: number;
}

/** 战斗结算信息（战斗结束后才有）。 */
export interface ResultView {
  readonly victory: boolean;
  /** 结果主文案的本地化 key */
  readonly titleKey: string;
  /** 副文案（说明为什么赢/输）的本地化 key */
  readonly reasonKey: string;
  /**
   * 副文案的**插值参数**。
   *
   * 需求："wonByKill 里的名字，应该用参数···"
   *
   * 胜因文案里要出现 **Boss 的名字**。名字写死在文案里会漂移 ——
   * 实测 `wonByKill` 写的是"伪名一郎"，而 Boss 的实际名字是
   * "伪·明显一郎"（`boss.name`），两个都对不上。
   *
   * ⚠️ 这里给的是**另一个 i18n key**（`boss.name`），不是译好的文字：
   * 渲染层不持有可显示文案（i18n 规范 I1），由渲染层自己再翻一次。
   */
  readonly reasonParams?: Readonly<Record<string, string | number>>;
  /** 用时（秒，1 位小数） */
  readonly seconds: string;
  readonly remainingHp: number;
  readonly remainingHpCap: number;
  readonly totalDamage: number;
  readonly dps: number;
}

export interface BattleSnapshotView {
  readonly tick: number;
  readonly status: 'idle' | 'running' | 'victory' | 'defeat';
  /** 战斗剩余时间（ms）；无限制为 undefined */
  readonly remainingMs?: number;
  /** 是否已狂暴 */
  readonly enraged: boolean;
  readonly player: CombatantView;
  readonly boss: CombatantView;
  readonly skills: readonly SkillSlotView[];
  /** 飘字（由事件累积而成，渲染层负责淡出） */
  readonly floatingText: readonly FloatingTextView[];
  /** 一行状态提示（**本地化 key**，如"闪避"/"被打断"） */
  readonly statusLine?: string;
  /** 状态提示的副标题（技能名 —— 说明"是哪个技能不能用"） */
  readonly statusDetail?: string;
  /** Boss 正在前摇 —— 驱动全屏预警表现 */
  readonly telegraphing: boolean;
  /** Boss 处于霸体：人物加彩色描边，读条背景偏青。 */
  readonly armored: boolean;
  /** 玩家受击闪白强度 0..1 */
  readonly playerFlash: number;
  readonly bossFlash: number;
  /** 战斗结束后的结算信息 */
  readonly result?: ResultView;
}

/* ------------------------------------------------------------------ *
 * 渲染侧动作（UI → 引擎）
 * ------------------------------------------------------------------ */

export type RenderAction =
  | { readonly type: 'skill'; readonly skillId: string }
  | { readonly type: 'restart' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' };

/** 空快照，用于首帧之前。 */
export const EMPTY_COMBATANT: CombatantView = {
  attacking: false,
  feedback: IDLE_FEEDBACK,
  id: '',
  nameKey: 'hud.level',
  side: 'ally',
  alive: true,
  hp: { current: 0, cap: 1 },
  energy: { current: 0, cap: 1 },
  douqi: { current: 0, cap: 1 },
  buffs: [],
};

export const EMPTY_SNAPSHOT: BattleSnapshotView = {
  tick: 0,
  status: 'idle',
  enraged: false,
  player: EMPTY_COMBATANT,
  boss: { ...EMPTY_COMBATANT, side: 'enemy' },
  skills: [],
  floatingText: [],
  telegraphing: false,
  armored: false,
  playerFlash: 0,
  bossFlash: 0,
};

/* ------------------------------------------------------------------ *
 * 纯函数：格式化与配色规则（可测，不依赖 pixi）
 * ------------------------------------------------------------------ */

/** 资源比例，NaN 安全。 */
export function ratioOf(resource: ResourceView): number {
  if (!Number.isFinite(resource.cap) || resource.cap <= 0) return 0;
  const r = resource.current / resource.cap;
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
}

/** 剩余时间显示：`M:SS`。 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 预警提示：告诉玩家**该做什么**，而不只是"Boss 在读条"。
 *
 * 这是从截图里总结出来的：预警条右边直接写"闪避或格挡"，
 * 比只画一根进度条有用得多。
 *
 * 返回的是**本地化 key + 参数**，不是拼好的文案 ——
 * 渲染层不持有任何可显示文字（i18n 规范 I1）。
 */
export interface TelegraphHint {
  /** 剩余的读条时间，秒（保留 1 位） */
  readonly seconds: string;
}

/**
 * 预警条右侧只显示**剩余秒数**。
 *
 * 需求：不要"闪避或格挡"字样。这两种应对永远都适用，写出来是
 * 纯噪声；玩家真正需要读的是"还有多久命中"。
 * 霸体状态改由**秒数颜色**表达（青绿 = 可打断 / 青蓝 = 霸体）。
 */
export function telegraphHint(cast: CombatantView['cast']): TelegraphHint | undefined {
  if (!cast) return undefined;
  return { seconds: (cast.remainingMs / 1000).toFixed(1) };
}

/** 判定窗口的剩余时间是否短到需要高亮（< 0.2s 时闪红）。 */
export function isTightWindow(buff: BuffView): boolean {
  return buff.isDefensive && buff.remainingMs < 200;
}

