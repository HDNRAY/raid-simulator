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
   * 是否处于**眩晕**（完全不能行动）。
   *
   * ⚠️ 由 `viewAdapter` 从"有没有带 `actionLock` 的 buff"算出，渲染层只读。
   *
   * 为什么需要它而不是让玩家看 buff 图标行：图标行的短标签最多 2 个字、
   * 20×20 的方块，而且和其它减益混在一起。"**连续 3 秒按什么都没反应**"
   * 如果只能靠那种线索察觉，玩家会以为游戏卡死了。
   */
  readonly stunned: boolean;
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
   * 按住技（「卸」）的代价是**每秒**扣的，所以写 `3/s` 而不是 `3` ——
   * 后者会被读成"一共 3 点"（需求："防 代价应该显示 2/s"）。
   * ⚠️ 那个数由 `app/viewAdapter.ts` 从 `perLogicTick` 换算好（引擎是按
   * **每逻辑步**扣的），这儿只负责加后缀，不要再乘一次。
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
   * 「卸」是按住技，它的代价是 `holdDrain`（引擎**每逻辑步**扣多少），
   * 所以也走同一个字段。
   *
   * ⚠️ 但技能格上写的是"**每秒**多少"（带 `/s` 后缀）：数值由
   * `app/viewAdapter.ts` 用 `holdDrainPerSecond()` 换好再放进来 ——
   * 渲染层不做单位换算（那会又多一份"一步多长"的真相）。
   */
  readonly cost?: SlotCost;
  /**
   * 不可用的原因（**本地化 key**，不是文案）。取值只可能是 `BLOCK_KEYS`
   * 里的那四个 —— 技能格用它区分「买不起 / 冷却中 / 读条中」三种底色，
   * 状态提示区用它取文案。
   */
  readonly blockedKey?: string;
}

/**
 * 「这一格为什么用不了」的**本地化 key**（`SkillSlotView.blockedKey` 的取值）。
 *
 * ------------------------------------------------------------------
 * 为什么要收成一张表
 * ------------------------------------------------------------------
 * 这个字段有两个消费方，而且**关注点不同**：
 *   - `app/slotViews.ts` 判断"够不够 / 是不是在冷却"，选出该用哪个 key
 *   - `render/skillBar.ts` 靠 `cost` 这一项决定"这一格要不要画成断电的样子"
 *
 * 两边各写一遍字面量 `'block.cost'` 的话，改 key 只会**静默**让
 * 底色回退成"普通的不可用" —— 那种 bug 在截图里看起来像"设计如此"，
 * 没人会去查。收在一处，改名就只需要改这一行。
 *
 * ⚠️ 它是**渲染层的契约**（这个文件零依赖、纯类型 + 纯函数），
 * 与 `ResourceKeyName` 出于同样的理由自持一份声明。
 */
export const BLOCK_KEYS = {
  comboWindow: 'block.comboWindow',
  cost: 'block.cost',
  cooldown: 'block.cooldown',
  casting: 'block.casting',
} as const;

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
   * 实测 `wonByKill` 曾把 Boss 名字写死在文案里，而实际名字由
   * `boss.name` 提供（现在是"傲慢"）—— 两份文案必然漂移。
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
  stunned: false,
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

/**
 * 倒计时"细档"的上界：**10 秒**（`0.1` 秒刻度上的 `100`）。
 *
 * 见 `formatCountdown` 顶部为什么是 10 秒。
 */
const COUNTDOWN_FINE_TENTHS = 100;

/**
 * **战斗中的倒计时秒数** → 显示字符串（`0.2` / `0.5` / `30`）。
 *
 * ==================================================================
 * 规则（**一处**，就住在这里）
 * ==================================================================
 *
 *   - `< 10 秒` → 0.1 秒刻度，**向上取整**：`0.2` / `0.5` / `9.9`
 *   - `≥ 10 秒` → 整秒，**向上取整**：`10` / `30`
 *   - 尾零不显示：`1.0` → `1`、`2.0` → `2`（理由见下）
 *
 * 这三条来自用户报的那一个 bug（原话："闪 和 避 的buff，现在显示的1s？"）
 * —— 它要同时满足三件事，缺一条都不算修好：
 *
 *   1. **「闪」0.2 秒和「避」0.5 秒必须能区分。** 这两个数字是玩家在
 *      判定窗口里唯一能读到的量。按整秒进位（`Math.ceil(ms / 1000)`）
 *      两者都是 `1` —— 一个完全不含信息的数。
 *   2. **窗口在缩短必须看得出来**（`0.5 → 0.4 → 0.3 …`）。只给整秒
 *      的话，0.5 秒的窗口整个生命周期都显示 `1`，玩家学不到"还剩多少"。
 *   3. **长倒计时不能变成噪音。** 举例：一个 30 秒的 buff —— 若一律给一位
 *      小数，它会从 `30.0` 一路 `29.9 → 29.8 → …` 每 0.1 秒跳一次数字。
 *      那不是精度，是抖动。
 *
 * ⚠️ **为什么这条线画在 10 秒**：本作需要 0.1 秒分辨力的量都在 10 秒
 * 以内（判定窗口 0.2 / 0.5 秒、读条 0.3～2.5 秒、冷却 0.6～1.5 秒）；
 * 而 10 秒以上的倒计时，那一位"十分之一秒"每秒要跳 10 次，纯噪声。
 *
 * ⚠️ **为什么向上取整**：倒计时不许在窗口还活着的时候显示 `0`
 * （那会让玩家以为已经好了）。这条口径本仓库早就有（读条 / 时钟都在用
 * `Math.ceil`），这里只是把它从"整秒"细化到"0.1 秒刻度"——
 * 于是 `0.2` 秒的窗口读作 `0.2 → 0.1`，最后一刻之前都不为 0。
 *
 * ⚠️ **为什么尾零不显示**（`2.0` → `2` 而不是 `2.0`）：`displaySeconds`
 * 那一轮定下的口径就是"尾零是噪声"（见 `app/displayTime.ts` 顶部：
 * 修法不是 `toFixed(1)`）。这里沿用同一条 —— 于是长倒计时自然是 `30`
 * 而不是 `30.0`，而 `0.5` 这种真的需要小数的仍然是 `0.5`。
 *
 * ==================================================================
 * ⚠️ 它**不是** `app/displayTime.ts` 的 `displaySeconds`，不能合并
 * ==================================================================
 *
 * 两者都是"毫秒 → 秒的显示"，但**用途与规则都不同**：
 *
 * | | `displaySeconds`（`app/`） | `formatCountdown`（本函数） |
 * |---|---|---|
 * | 用途 | **静态内容值**（设置页的冷却 / 施放、说明里的秒数） | **战斗中的实时剩余量** |
 * | 舍入 | 四舍五入（`Math.round`） | **向上取整**（窗口或读条还活着就不能显示 0） |
 * | 阈值 | **没有**（`12.5` 就该显示 `12.5`） | `≥ 10 秒` 收成整秒（实时量会每帧重画） |
 *
 * 硬合并就会出错：把阈值套到内容值上，设置页会把 `12.5` 秒的说明读成
 * `13` 秒；把四舍五入套到倒计时上，0.2 秒的窗口最后一刻会显示 `0`。
 * 而且**渲染层不许反向 import `app/`**（依赖方向是 `app → render`），
 * 所以它只能在渲染层这一侧 —— 这已经收掉了原先散在三处的三份实现
 * （buff 条的 `Math.ceil(ms/1000)`、两条读条的 `toFixed(1)`、
 * 预警提示的 `toFixed(1)`）。
 *
 * @returns `ms` 的显示文本；`Infinity` / `NaN`（永久 buff 之类）返回 `''`
 *          —— 调用方据此决定不显示。
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  /**
   * ⚠️ 先折到 **0.1 秒刻度上的整数**（`tenths`）再判量级。
   *
   * 用折好的整数值当阈值，`9.999 秒` 不会落进"细档"却显示成 `10.0`
   * —— `tenths` 一到 100 就直接走整秒分支，输出 `10`。
   */
  const tenths = Math.ceil(Math.max(0, ms) / 100);
  /** 整秒档：`tenths/10` 再进位一次，等价于 `Math.ceil(ms / 1000)`。 */
  if (tenths >= COUNTDOWN_FINE_TENTHS) return String(Math.ceil(tenths / 10));
  /**
   * 细档：`tenths / 10` 是"整数 ÷ 10"，其最短十进制表示正好是一位小数
   * （`2 / 10 → "0.2"`），不会带上 `0.19999999999999998` 那种浮点尾数；
   * 而 `20 / 10 → "2"` 自然把尾零省掉。
   */
  return String(tenths / 10);
}

/** 判定窗口的剩余时间是否短到需要高亮（< 0.2s 时闪红）。 */
export function isTightWindow(buff: BuffView): boolean {
  return buff.isDefensive && buff.remainingMs < 200;
}

