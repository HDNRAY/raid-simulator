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
import { GCD_MS } from '../core/combat';
import { PALETTE } from '../render/theme';
import type {
  BattleSnapshotView,
  BuffView,
  CombatantView,
  FloatingTextView,
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

  constructor(private readonly skills: ReadonlyMap<string, SkillDef>) {}

  /**
   * 消费引擎事件。**必须在引擎 tick 之后、渲染之前调用一次。**
   */
  consume(events: readonly EventDef[], tick: number): void {
    for (const event of events) {
      switch (event.kind) {
        case 'damage': {
          if (event.amount <= 0) break;
          this.pushFloating(
            `-${event.amount}${event.crit ? '!' : ''}`,
            damageColor(event.amount, event.crit),
            event.targetId === 'verrot' ? 620 : 300,
            event.targetId === 'verrot' ? 200 : 380,
          );
          if (event.targetId === 'player') this.playerFlash = 1;
          else if (event.targetId === 'verrot') this.bossFlash = 1;
          break;
        }
        case 'heal': {
          if (event.amount <= 0) break;
          this.pushFloating(`+${event.amount}`, PALETTE.buff.bright, 300, 380);
          break;
        }
        case 'avoided': {
          this.setStatus(event.reason === 'immune' ? 'hud.hud.immune' : 'hud.dodged', 180);
          this.pushFloating('0', PALETTE.iframe.bright, 300, 360);
          this.playerFlash = 0.6;
          break;
        }
        case 'skillRejected': {
          // 只提示"为什么不能放"，不刷屏
          this.setStatus(`reject.${event.reason}`, 45);
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
        case 'phaseChanged': {
          this.setStatus('event.phaseChange', 240);
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
      if (this.statusLineTtl === 0) this.statusLine = '';
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

  private setStatus(key: string, ttl: number): void {
    this.statusLine = key;
    this.statusLineTtl = ttl;
  }

  /** 构建完整的渲染快照。 */
  build(
    engine: BattleEngine,
    slots: readonly SlotBinding[],
    options: { readonly timeLimitMs?: number; readonly gcdBuffId?: string } = {},
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

    return {
      tick: state.tick,
      status: state.status,
      phase: state.phase,
      ...(remainingMs === undefined ? {} : { remainingMs }),
      enraged: boss.buffs.some((b) => b.id.startsWith('boss-enrage')),
      player,
      boss,
      skills,
      floatingText: this.floating,
      ...(this.statusLine === '' ? {} : { statusLine: this.statusLine }),
      telegraphing: boss.cast !== undefined,
      playerFlash: this.playerFlash,
      bossFlash: this.bossFlash,
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

    // GCD：引擎用 buff 表达，所以 UI 直接读 buff
    const gcdBuff = state.buffs.find((b) => b.defId === (this.gcdBuffId ?? 'gcd'));
    const inGcd = skill.gcd && gcdBuff !== undefined;

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
    const usable = costOk && conditionOk && !inGcd && cooldownRatio <= 0.001 && !casting;

    // 不可用原因用**本地化 key**表达，UI 层负责取文案
    let blockedKey: string | undefined;
    if (!conditionOk) blockedKey = 'block.comboWindow';
    else if (!costOk) blockedKey = 'block.cost';
    else if (inGcd) blockedKey = 'block.gcd';
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
      offGcd: !skill.gcd,
      comboReady: (skill.requires?.length ?? 0) > 0 && conditionOk,
      ...(blockedKey === undefined ? {} : { blockedKey }),
    };
  }

  private gcdBuffId = 'gcd';
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
    castView = {
      skillId: cast.skillId,
      nameKey: skill?.nameKey ?? 'hud.casting',
      progress,
      interruptible: cast.interruptible,
      remainingMs: Math.max(0, nextHit - elapsedMs),
    };
  }

  const buffs: BuffView[] = raw.buffs.map((buff) => {
    const def = engine.buffDef(buff.defId);
    const durationMs = def?.duration ?? 0;
    const remainingMs = Number.isFinite(buff.expiresAtTick)
      ? Math.max(0, (buff.expiresAtTick - tick) * (1000 / 60))
      : Number.POSITIVE_INFINITY;
    return {
      id: buff.defId,
      nameKey: def?.nameKey ?? 'hud.casting',
      icon: def?.icon ?? '',
      polarity: def?.polarity ?? 'neutral',
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
    mp: { current: raw.resources.mp, cap: raw.caps.mp },
    energy: { current: raw.resources.energy, cap: raw.caps.energy },
    fury: { current: raw.resources.fury, cap: raw.caps.fury },
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
    mp: { current: 0, cap: 1 },
    energy: { current: 0, cap: 1 },
    fury: { current: 0, cap: 1 },
    buffs: [],
  };
}

function emptyView(tick: number): BattleSnapshotView {
  return {
    tick,
    status: 'idle',
    phase: 1,
    enraged: false,
    player: emptyCombatant('player'),
    boss: { ...emptyCombatant('verrot'), side: 'enemy' },
    skills: [],
    floatingText: [],
    telegraphing: false,
    playerFlash: 0,
    bossFlash: 0,
  };
}

/** 默认槽位：与 `DEFAULT_BINDINGS` 对应。 */
export const DEFAULT_SLOTS: readonly SlotBinding[] = [
  { index: 0, key: '1', skillId: 'slash' },
  { index: 1, key: '2', skillId: 'heavy' },
  { index: 2, key: '3', skillId: 'rend' },
  { index: 3, key: '4', skillId: 'arc' },
  { index: 4, key: 'q', skillId: 'dodge' },
  { index: 5, key: 'e', skillId: 'guard' },
  { index: 6, key: 'r', skillId: 'haste' },
];

/** GCD 时长再导出，避免渲染层直接 import core/combat。 */
export { GCD_MS };
