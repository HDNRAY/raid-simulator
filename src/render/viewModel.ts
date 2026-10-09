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
  readonly stacks: number;
  /** 剩余时间（ms）；永久为 Infinity */
  readonly remainingMs: number;
  readonly durationMs: number;
  /** 是否是"判定窗口"类 buff（无敌 / 减伤）—— UI 要用最醒目的方式显示 */
  readonly isDefensive: boolean;
}

export interface CombatantView {
  readonly id: string;
  readonly nameKey: string;
  readonly side: 'ally' | 'enemy';
  readonly alive: boolean;
  readonly hp: ResourceView;
  readonly energy: ResourceView;
  readonly douqi: ResourceView;
  readonly buffs: readonly BuffView[];
  /** 正在读条：技能 id 与进度 0..1。没有则为 undefined */
  readonly cast?: {
    readonly skillId: string;
    readonly nameKey: string;
    /** 0..1 */
    readonly progress: number;
    readonly interruptible: boolean;
    /** 还要多久命中（ms）—— 预警文案用 */
    readonly remainingMs: number;
  };
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
  /** 冷却剩余秒数（展示用） */
  readonly cooldownSec: number;
  /** 不占 GCD（UI 上会和普通技能区分显示） */
  readonly offGcd: boolean;
  /** 是否是派生技且当前窗口已开 */
  readonly comboReady: boolean;
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

export interface BattleSnapshotView {
  readonly tick: number;
  readonly status: 'idle' | 'running' | 'victory' | 'defeat';
  readonly phase: number;
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
  /** 玩家受击闪白强度 0..1 */
  readonly playerFlash: number;
  readonly bossFlash: number;
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
  phase: 1,
  enraged: false,
  player: EMPTY_COMBATANT,
  boss: { ...EMPTY_COMBATANT, side: 'enemy' },
  skills: [],
  floatingText: [],
  telegraphing: false,
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
  /** 提示文字的本地化 key */
  readonly key: string;
  /** 剩余的读条时间，秒（保留 1 位） */
  readonly seconds: string;
}

export function telegraphHint(cast: CombatantView['cast']): TelegraphHint | undefined {
  if (!cast) return undefined;
  return {
    key: cast.interruptible ? 'hint.interruptible' : 'hint.dodgeOrGuard',
    seconds: (cast.remainingMs / 1000).toFixed(1),
  };
}

/** 判定窗口的剩余时间是否短到需要高亮（< 0.2s 时闪红）。 */
export function isTightWindow(buff: BuffView): boolean {
  return buff.isDefensive && buff.remainingMs < 200;
}
