/**
 * 引擎状态 → 渲染 view-model 的适配器。
 *
 * 这是**唯一**允许同时知道引擎与渲染两侧的文件（它住在 `app/`，
 * 不属于任何一侧）。两边的耦合被限制在这一个文件里，
 * 所以换渲染库或换引擎时改动范围可控。
 *
 * 它还负责把引擎的**事件流**变成渲染需要的东西：
 *   - 飘字（伤害数字）
 *   - 屏幕闪白
 *   - 状态提示（"闪避！"/"被打断"）
 */

import type { BattleEngine } from '../core/combat/battleState';
import type { SkillDef, EventDef } from '../core/types';
import { PALETTE } from '../render/theme';
import { LAYOUT } from '../ui/layout';
import type {
  BattleSnapshotView,
  BuffView,
  CombatantView,
  FloatingTextView,
  ResultView,
  SkillSlotView,
} from '../render/viewModel';

/** 一条槽位绑定（键位 → 技能）。 */
export interface SlotBinding {
  readonly index: number;
  readonly key: string;
  readonly skillId: string;
}

/** 判定窗口类 buff 的 id 前缀（UI 要最醒目地显示它们）。 */
const DEFENSIVE_BUFF_PREFIXES = ['dodge-iframe', 'guard'];

function isDefensiveBuff(buffId: string): boolean {
  return DEFENSIVE_BUFF_PREFIXES.some((p) => buffId.startsWith(p));
}

/**
 * 引擎内部用的标记 buff —— **不在 UI 上显示图标**。
 *
 * 它们不是"玩家应该看到的增益/减益"，而是引擎的状态标记：
 *   - `gcd`：公共冷却，UI 通过技能格变灰表达，不需要图标
 *   - `boss-telegraph`：前摇标记，UI 通过预警条表达
 *   - `combo-window`：派生窗口，UI 通过技能格高亮表达
 *
 * 早期版本没做这个过滤，结果预警条上压着一个被裁掉的图标。
 */
const INTERNAL_BUFF_IDS = new Set(['gcd', 'boss-telegraph-active', 'boss-telegraph']);

/**
 * 该 buff 是否**不应该出现在图标条上**。
 *
 * 两个来源：
 *   1. id 在内部集合里（引擎标记）
 *   2. 内容里显式声明了 `hidden: true`
 *
 * 第二条让内容作者可以自己决定"这个 buff 不需要图标"
 * （公共冷却由按钮变灰表达、Boss 前摇由预警条表达），
 * 不必回头改这个文件。
 */
function isInternalBuff(buffId: string, hidden?: boolean): boolean {
  if (hidden) return true;
  return INTERNAL_BUFF_IDS.has(buffId);
}

/** 拒绝原因 → 本地化 key 后缀。 */
/**
 * 按极性推导兜底色。
 *
 * 内容作者应尽量显式指定 `color` —— 同一极性下的不同 buff
 * （无敌 vs 急速）需要区分。这只是没指定时的保底。
 */
function defaultBuffColor(polarity: string, buffId: string): number {
  if (isDefensiveBuff(buffId)) return POLARITY_COLORS.iframe;
  if (polarity === 'debuff') return POLARITY_COLORS.debuff;
  if (polarity === 'neutral') return POLARITY_COLORS.neutral;
  return POLARITY_COLORS.buff;
}

const POLARITY_COLORS = {
  buff: 0x6cc46c,
  debuff: 0xcc5555,
  neutral: 0x8a8ca0,
  iframe: 0xff7a55,
} as const;

/**
 * buff id → 极简标签的**语言 key**。
 *
 * 这张表的必要性：机制 id 与文案 key 不是同一套命名
 * （例如 `dodge-iframe` 的显示名是 `buffShort.dodgeIframe`）。
 * 没登记时回退到中性占位，不影响玩法。
 */
const SHORT_LABEL_KEYS: Readonly<Record<string, string>> = {
  'dodge-iframe': 'skill.dodge.name',
  guard: 'skill.guard.name',
  focus: 'skill.focus.name',
  sunder: 'debuff.sunder.name',
  'boss-enrage': 'buffShort.enrage',
  'boss-empowered': 'buffShort.empowered',
  'boss-telegraph': 'buffShort.telegraph',
  gcd: 'buffShort.gcd',
};

function shortLabelKeyOf(buffId: string): string {
  return SHORT_LABEL_KEYS[buffId] ?? 'buffShort.telegraph';
}

function blockKeyOf(reason: string): string {
  switch (reason) {
    case 'gcd':
      return 'gcd';
    case 'cooldown':
      return 'cooldown';
    case 'cost':
      return 'cost';
    case 'condition':
      return 'condition';
    case 'casting':
      return 'casting';
    case 'locked':
      return 'locked';
    case 'target':
      return 'target';
    default:
      return 'condition';
  }
}

/** 事件的颜色规则（数据模型规范 §12 的 EventDef → 视觉）。 */
function damageColor(amount: number, crit: boolean): number {
  if (crit) return 0xfff0a0;
  return amount >= 500 ? 0xffd080 : 0xf0f0f6;
}

/**
 * 适配器：持有"渲染侧的瞬时状态"（飘字、闪光），
 * 这些不属于引擎状态（它们纯粹是表现）。
 */
export class ViewAdapter {
  private floating: FloatingTextView[] = [];
  private nextFloatingId = 1;
  private playerFlash = 0;
  private bossFlash = 0;
  private statusLine = '';
  private statusLineTtl = 0;

  /** 每个技能上次使用的 tick，用于在引擎不暴露 CD 时估算冷却显示。 */
  private readonly lastUsed = new Map<string, number>();
  private readonly skillNameKeys = new Map<string, string>();
  /** 状态提示的副标题（例如"贯击 · 公共冷却"） */
  private statusDetail = '';
  /** 累计造成的总伤害（结算面板用） */
  private damageDealt = 0;
  /** 累计承受的总伤害 */
  private damageTaken = 0;
  /**
   * 最近一次被拒的「技能 + 原因」与它的 tick。
   *
   * 用途：**不让同一件事重复刷屏**。
   *
   * 输入层已经用"与引擎共用的 GCD 判据"把绝大部分误报消掉了，
   * 但预测毕竟是在动作生效**之前**做的 —— 状态在那一瞬间变化时
   * 仍可能漏一次。这层去重保证即使漏了，玩家也不会看到
   * 同一行提示连续闪动。
   */
  private lastReject: { readonly key: string; readonly tick: number } | undefined;

  constructor(private readonly skills: ReadonlyMap<string, SkillDef>) {
    for (const [id, skill] of skills) this.skillNameKeys.set(id, skill.nameKey);
  }

  /**
   * 消费引擎事件。**必须在引擎 tick 之后、渲染之前调用一次。**
   */
  consume(events: readonly EventDef[], tick: number): void {
    for (const event of events) {
      switch (event.kind) {
        case 'damage': {
          if (event.amount <= 0) break;
          // 飘字落在**被打的人**头上。用 side 判断而不是写死 id ——
          // 换 Boss 时不需要改这里。
          const onBoss = event.targetId !== 'player';
          const baseY = onBoss ? LAYOUT.combatTextY.boss : LAYOUT.combatTextY.player;
          const baseX = onBoss ? 630 : 300;
          this.pushFloating(
            `-${event.amount}${event.crit ? '!' : ''}`,
            damageColor(event.amount, event.crit),
            baseX,
            baseY,
          );
          if (onBoss) {
            this.bossFlash = 1;
            this.damageDealt += event.amount;
          } else {
            this.playerFlash = 1;
            this.damageTaken += event.amount;
          }
          break;
        }
        case 'heal': {
          if (event.amount <= 0) break;
          this.pushFloating(`+${event.amount}`, PALETTE.buff.bright, 300, 380);
          break;
        }
        case 'avoided': {
          this.setStatus(event.reason === 'immune' ? 'hud.immune' : 'hud.dodged', 90);
          this.pushFloating('0', PALETTE.iframe.bright, 300, LAYOUT.combatTextY.player);
          this.playerFlash = 0.6;
          break;
        }
        case 'skillRejected': {
          /**
           * 技能被拒时把「技能名 + 原因」放进状态区。
           *
           * 为什么不写在技能格上：格子只有 44px，七个格子各挂一行
           * 小字会糊成一片。集中一行反而读得更快。
           *
           * 同一个「技能 + 原因」在 1 秒内只提示一次 ——
           * 见 `lastReject` 的说明。
           */
          const key = `${event.skillId}:${event.reason}`;
          const suppressed =
            this.lastReject !== undefined &&
            this.lastReject.key === key &&
            tick - this.lastReject.tick < 60;
          this.lastReject = { key, tick };
          if (suppressed) break;

          const skillName = this.skillNameKeys.get(event.skillId) ?? event.skillId;
          this.setStatus(`block.${blockKeyOf(event.reason)}`, 55, skillName);
          break;
        }
        case 'castInterrupted': {
          this.setStatus('hud.interrupted', 150);
          break;
        }
        case 'enrageStarted': {
          this.setStatus('event.enrage', 300);
          break;
        }
        case 'interruptImmune': {
          /**
           * 打断被霸体挡下 —— 必须给玩家明确反馈。
           *
           * 否则玩家按了「破」、什么都没发生，会以为是 bug。
           */
          this.setStatus('hint.armored', 120);
          break;
        }
        case 'behaviorTriggered': {
          /**
           * Boss 的行为阈值被跨过（例如进入二形态）。
           *
           * 引擎不知道"阶段"是什么 —— 它只知道"某条 onHpBelow 触发了"。
           * 所以这里的提示也只是"形态变化"，具体变成了什么由
           * buff 条上的图标告诉玩家。
           */
          this.setStatus('event.phaseChange', 120);
          break;
        }
        case 'skillUsed': {
          this.lastUsed.set(event.skillId, event.tick);
          break;
        }
        default:
          break;
      }
    }

    // 衰减
    this.playerFlash = Math.max(0, this.playerFlash - 0.08);
    this.bossFlash = Math.max(0, this.bossFlash - 0.12);
    if (this.statusLineTtl > 0) {
      this.statusLineTtl -= 1;
      if (this.statusLineTtl === 0) {
        this.statusLine = '';
        this.statusDetail = '';
      }
    }

    // 飘字上浮与淡出
    this.floating = this.floating
      .map((item) => ({ ...item, y: item.y - 1.1, life: item.life - 0.02 }))
      .filter((item) => item.life > 0);

    void tick;
  }

  private pushFloating(text: string, color: number, x: number, y: number): void {
    this.floating.push({
      id: this.nextFloatingId++,
      text,
      color,
      x: x + (this.floating.length % 5) * 18 - 36,
      y,
      life: 1,
    });
    // 上限，避免长时间战斗累积
    if (this.floating.length > 24) this.floating.splice(0, this.floating.length - 24);
  }

  private setStatus(key: string, ttl: number, detailKey?: string): void {
    this.statusLine = key;
    this.statusLineTtl = ttl;
    this.statusDetail = detailKey ?? '';
  }

  /** 构建完整的渲染快照。 */
  build(
    engine: BattleEngine,
    slots: readonly SlotBinding[],
    options: { readonly timeLimitMs?: number } = {},
  ): BattleSnapshotView {
    const state = engine.snapshot;
    const playerRaw = state.combatants.find((c) => c.side === 'ally');
    const bossRaw = state.combatants.find((c) => c.side === 'enemy');
    if (!playerRaw || !bossRaw) return emptyView(state.tick);

    const playerStats = engine.statsOf(playerRaw.id);
    const player = toCombatantView(engine, playerRaw.id, state.tick);
    const boss = toCombatantView(engine, bossRaw.id, state.tick);

    const remainingMs =
      options.timeLimitMs === undefined
        ? undefined
        : Math.max(0, options.timeLimitMs - (state.tick - state.startedAtTick) * (1000 / 60));

    const comboWindowOpen = player.buffs.some(
      (b) => b.id === 'combo-window' && b.remainingMs > 0,
    );

    const skills = slots
      .map((slot) => this.buildSlot(engine, slot, state.tick, playerStats.haste ?? 0, comboWindowOpen))
      .filter((s): s is SkillSlotView => s !== undefined);

    const result =
      state.status === 'running' ? undefined : this.buildResult(engine, state.tick);

    return {
      tick: state.tick,
      status: state.status,
      ...(result === undefined ? {} : { result }),
      ...(remainingMs === undefined ? {} : { remainingMs }),
      enraged: boss.buffs.some((b) => b.id.startsWith('boss-enrage')),
      player,
      boss,
      skills,
      floatingText: this.floating,
      ...(this.statusLine === '' ? {} : { statusLine: this.statusLine }),
      ...(this.statusDetail === '' ? {} : { statusDetail: this.statusDetail }),
      telegraphing: boss.cast !== undefined,
      /**
       * 霸体：由 boss 身上的 `interruptImmune` buff 决定。
       *
       * 与 `castView.interruptible` 读的是同一个 flag —— 两处结论必须
       * 一致，否则会出现"读条说不可打断、但人物没描边"这种自相矛盾。
       */
      armored: boss.buffs.some(
        (b) => engine.buffDef(b.id)?.flags?.interruptImmune === true,
      ),
      playerFlash: this.playerFlash,
      bossFlash: this.bossFlash,
    };
  }

  /**
   * 构建结算信息。
   *
   * "造成伤害"用**玩家对 Boss 的累计**（逐次命中累加），
   * 而不是"Boss 掉的血" —— 后者在有护盾/治疗时会失真。
   */
  private buildResult(engine: BattleEngine, tick: number): ResultView {
    const state = engine.snapshot;
    const player = state.combatants.find((c) => c.side === 'ally');
    const seconds = (tick - state.startedAtTick) * (1000 / 60) / 1000;
    const victory = state.status === 'victory';

    const reasonKey =
      state.status === 'victory'
        ? 'screen.wonByKill'
        : state.endReason === 'timeout'
          ? 'screen.defeatedByTimeout'
          : state.endReason === 'enrage'
            ? 'screen.defeatedByEnrage'
            : 'screen.defeatedByDeath';

    return {
      victory,
      titleKey: victory ? 'screen.victory' : 'screen.defeat',
      reasonKey,
      seconds: seconds.toFixed(1),
      remainingHp: Math.ceil(player?.resources.hp ?? 0),
      remainingHpCap: Math.ceil(player?.caps.hp ?? 1),
      totalDamage: Math.round(this.damageDealt),
      dps: seconds > 0 ? Math.round(this.damageDealt / seconds) : 0,
    };
  }

  private buildSlot(
    engine: BattleEngine,
    slot: SlotBinding,
    tick: number,
    haste: number,
    comboWindowOpen: boolean,
  ): SkillSlotView | undefined {
    const skill = this.skills.get(slot.skillId);
    if (!skill) return undefined;
    const state = engine.snapshot.combatants.find((c) => c.side === 'ally');
    if (!state) return undefined;

    // 冷却：引擎把"下次可用 tick"存在 cooldowns 里
    const readyAt = state.cooldowns[slot.skillId] ?? 0;
    const totalTicks = Math.max(1, Math.round((skill.cooldown * (1 - haste)) / (1000 / 60)));
    const remainTicks = Math.max(0, readyAt - tick);
    const cooldownRatio = skill.cooldown > 0 ? Math.min(1, remainTicks / totalTicks) : 0;

    // 资源是否够（UI 需要提前变灰，而不是等玩家按了才拒绝）
    let costOk = true;
    for (const cost of skill.cost) {
      const need = typeof cost.value === 'number' ? cost.value : 0;
      const has = (state.resources as Record<string, number>)[cost.resource] ?? 0;
      if (has < need) costOk = false;
    }

    // 前置条件（派生窗口）
    let conditionOk = true;
    for (const cond of skill.requires ?? []) {
      if (cond.kind === 'hasBuff' && cond.buffId === 'combo-window' && !comboWindowOpen) {
        conditionOk = false;
      }
    }

    const casting = state.casts.length > 0;
    const usable = costOk && conditionOk && cooldownRatio <= 0.001 && !casting;

    // 不可用原因用**本地化 key**表达，UI 层负责取文案
    let blockedKey: string | undefined;
    if (!conditionOk) blockedKey = 'block.comboWindow';
    else if (!costOk) blockedKey = 'block.cost';
    else if (cooldownRatio > 0.001) blockedKey = 'block.cooldown';
    else if (casting) blockedKey = 'block.casting';

    return {
      index: slot.index,
      key: slot.key,
      skillId: slot.skillId,
      nameKey: skill.nameKey,
      icon: skill.icon,
      usable,
      cooldownRatio,
      cooldownSec: (remainTicks * (1000 / 60)) / 1000,
      comboReady: (skill.requires?.length ?? 0) > 0 && conditionOk,
      ...(blockedKey === undefined ? {} : { blockedKey }),
    };
  }

}

/** 从引擎状态构建一个单位的渲染视图。 */
function toCombatantView(engine: BattleEngine, id: string, tick: number): CombatantView {
  const raw = engine.snapshot.combatants.find((c) => c.id === id);
  if (!raw) return emptyCombatant(id);
  const stats = engine.statsOf(id);

  const cast = raw.casts[0];
  let castView: CombatantView['cast'];
  if (cast) {
    const skill = engine.skillOf(cast.skillId);
    const elapsedMs = (tick - cast.startedAtTick) * (1000 / 60);
    const progress = cast.castTimeMs > 0 ? Math.min(1, elapsedMs / cast.castTimeMs) : 0;
    const nextHit =
      skill?.hits.find((h: { at: number }) => h.at > elapsedMs)?.at ?? cast.castTimeMs;
    /**
     * `interruptible` 在这里被**重新解释**为"现在能不能被打断"。
     *
     * 引擎里它是技能自身的静态标记；而**霸体是状态**，会临时推翻它。
     * 视图层给出合并后的结论，UI 才不必同时了解两套规则。
     * （引擎侧真正拦截打断的地方在 `interrupt` effect 里，
     * 同样读 `interruptImmune` —— 两边结论一致。）
     */
    const armored = raw.buffs.some(
      (b) => engine.buffDef(b.defId)?.flags?.interruptImmune === true,
    );
    castView = {
      skillId: cast.skillId,
      nameKey: skill?.nameKey ?? 'hud.casting',
      progress,
      interruptible: cast.interruptible && !armored,
      remainingMs: Math.max(0, nextHit - elapsedMs),
    };
  }

  const buffs: BuffView[] = raw.buffs
    .filter((buff) => !isInternalBuff(buff.defId, engine.buffDef(buff.defId)?.hidden))
    .map((buff) => {
    const def = engine.buffDef(buff.defId);
    const durationMs = def?.duration ?? 0;
    const remainingMs = Number.isFinite(buff.expiresAtTick)
      ? Math.max(0, (buff.expiresAtTick - tick) * (1000 / 60))
      : Number.POSITIVE_INFINITY;
    const polarity = def?.polarity ?? 'neutral';
    return {
      id: buff.defId,
      nameKey: def?.nameKey ?? 'hud.casting',
      icon: def?.icon ?? '',
      polarity,
      // 内容指定了颜色就用它，否则按极性给个兜底色
      color: def?.color ?? defaultBuffColor(polarity, buff.defId),
      shortLabelKey: shortLabelKeyOf(buff.defId),
      stacks: buff.stacks,
      remainingMs,
      durationMs,
      isDefensive: isDefensiveBuff(buff.defId),
    };
  });

  return {
    id,
    nameKey: raw.nameKey,
    side: raw.side,
    alive: raw.alive,
    hp: { current: raw.resources.hp, cap: raw.caps.hp },
    energy: { current: raw.resources.energy, cap: raw.caps.energy },
    douqi: { current: raw.resources.douqi, cap: raw.caps.douqi },
    buffs,
    ...(castView ? { cast: castView } : {}),
  } satisfies CombatantView & { _stats?: typeof stats };
}

function emptyCombatant(id: string): CombatantView {
  return {
    id,
    nameKey: 'hud.level',
    side: 'ally',
    alive: true,
    hp: { current: 0, cap: 1 },
    energy: { current: 0, cap: 1 },
    douqi: { current: 0, cap: 1 },
    buffs: [],
  };
}

function emptyView(tick: number): BattleSnapshotView {
  return {
    tick,
    status: 'idle',
    enraged: false,
    player: emptyCombatant('player'),
    boss: { ...emptyCombatant('verrot'), side: 'enemy' },
    skills: [],
    floatingText: [],
    telegraphing: false,
    armored: false,
    playerFlash: 0,
    bossFlash: 0,
  };
}

/**
 * 默认技能槽：与 `DEFAULT_BINDINGS` 一一对应。
 *
 * 顺序 = 技能栏从左到右的显示顺序 = 循环里的角色顺序
 * （基础 → 强击 → 派生 → 持续 → 终结 → 防御）。
 */
export const DEFAULT_SLOTS: readonly SlotBinding[] = [
  { index: 0, key: '1', skillId: 'attack' },
  { index: 1, key: '2', skillId: 'blast' },
  { index: 2, key: '3', skillId: 'focus' },
  { index: 3, key: '4', skillId: 'break' },
  { index: 4, key: 'q', skillId: 'dodge' },
  { index: 5, key: 'e', skillId: 'guard' },
];

/** GCD 时长再导出，避免渲染层直接 import core/combat。 */
