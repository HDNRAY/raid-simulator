import { describe, expect, it } from 'vitest';
import { buildPlayerKit } from '../../src/data/kit';
import { PLAYER_BASE, playerCapsFor } from '../../src/data/units';
import {
  ALL_QIJI,
  QIJI_BREATH,
  QIJI_FLASH_STRIKE,
  QIJI_JIE_STRIKE,
  QIJI_VITALITY,
} from '../../src/data/qiji';
import { COMBO_WINDOW } from '../../src/data/kits/combo';

/**
 * `buildPlayerKit`（`src/data/kit.ts`）—— **炁机 → 战斗输入**的唯一规范化点。
 *
 * 设计稿 §5.5。这一份测试守三件事：
 *
 *   1. **默认没有炁机 → 逐字等于今天**（单场 / 自由模式 / 黄金重放的路径）
 *   2. **加血上限真的进 `caps.hp`**（W6 的过渡实现 —— 引擎的钳制读的是它）
 *   3. **派生窗口的产出者被正确拆出来**（`comboWindows` 是引擎的输入）
 *
 * ⚠️ **入参就是 `QijiEntity`（定义）本身**（2026-10-13）：上一版这里包了一层
 * `{ def, stacks }`，而那个 `stacks` 两个模式**恒传 1** —— 死值，已删
 * （见 `data/kit.ts` 的作废段）。"一条炁机生效一次"现在的落点是**条数**：
 * 想叠 N 次就往数组里放 N 条定义。
 *
 * ⚠️ 因此上一版那三条"叠 3 层 / 叠 2 层 / 0 层 = 没选"的测试**换成了**
 * "同一份定义传两次"—— 层数那个入口不存在了，不能再装作它在。
 */

/** 把一条炁机包成 `buildPlayerKit` 要的那个数组（测试里反复要用）。 */
function withQiji(def: (typeof ALL_QIJI)[number]): readonly (typeof ALL_QIJI)[number][] {
  return [def];
}

describe('没有炁机时：逐字等于"今天"', () => {
  it('`chosen = []` → caps / base / modifiers / comboWindows 全是默认值', () => {
    const kit = buildPlayerKit('player');
    expect(kit.caps).toEqual(playerCapsFor('player'));
    expect(kit.base).toEqual(PLAYER_BASE);
    expect(kit.modifiers).toEqual([]);
    expect(kit.comboWindows).toEqual([]);
    /** ⚠️ 2026-10-13 加的 `skillTweaks` 同样是空 —— 默认路径逐字不变。 */
    expect(kit.skillTweaks).toEqual([]);
  });

  it('⚠️ 不传 `chosen` 与传空数组**同一个结果**（默认参数不是第二份实现）', () => {
    expect(buildPlayerKit('player')).toEqual(buildPlayerKit('player', []));
  });

  it('按角色取上限：林晚风 150 / 凯丽 120 / 未登记回落 100', () => {
    expect(buildPlayerKit('player').caps.hp).toBe(150);
    expect(buildPlayerKit('kaili').caps.hp).toBe(120);
    expect(buildPlayerKit('daixuan').caps.hp).toBe(100);
  });
});

describe('兜底①「加血上限」：把 `maxHp` 累加进 `caps.hp`（W6 的过渡）', () => {
  it('+30 ⇒ caps.hp 150 → 180', () => {
    const kit = buildPlayerKit('player', withQiji(QIJI_VITALITY));
    expect(kit.caps.hp).toBe(180);
  });

  it('⚠️ 修正条目**也**在 `modifiers` 里（W6 做完后就不用再动数据）', () => {
    /**
     * 这是"效果写成标准 `modifier`"的收益：今天 `caps` 是过渡落点，
     * 而 `modifiers` 里那条**同时**存在 —— W6 把钳制改成读结算值之后，
     * 删掉 caps 那一步即可，内容一个字不用改。
     */
    const kit = buildPlayerKit('player', withQiji(QIJI_VITALITY));
    expect(kit.modifiers).toHaveLength(1);
    expect(kit.modifiers[0]?.stat).toBe('maxHp');
    expect(kit.modifiers[0]?.op).toBe('add');
    expect(kit.modifiers[0]?.value).toBe(30);
  });

  it('⚠️ 不碰别的上限（energy / douqi 原样）', () => {
    const base = playerCapsFor('player');
    const kit = buildPlayerKit('player', withQiji(QIJI_VITALITY));
    expect(kit.caps.energy).toBe(base.energy);
    expect(kit.caps.douqi).toBe(base.douqi);
  });

  it('其它角色同样生效（凯丽 120 → 150）', () => {
    const kit = buildPlayerKit('kaili', withQiji(QIJI_VITALITY));
    expect(kit.caps.hp).toBe(150);
  });

  /**
   * ⚠️ **同一份定义传两次 → 修正也出现两次**（2026-10-13 从"叠 3 层"那条
   * 改过来）。
   *
   * 上一版这里测的是 `stacks: 3` 的展开（"3 层 = 3 条同源条目"）。层数删掉
   * 之后，那个入口不存在了，但**函数的行为没变**：`buildPlayerKit` 是
   * "按条数展开"，去重不是它的职责（两个模式都不会传重复的定义）。
   *
   * 留着这条是因为它钉住一个**真实的风险**：谁要是以为"入参没有层数 ⇒
   * 每条只该生效一次"，然后在这里**顺手加一个按 id 的去重**，那么"同一份
   * 定义出现两次"的展开行为就会**静默改变** —— 而自由模式/肉鸽的"只生效
   * 一次"是由集合（开关 / `chosen`）保证的，不是这一层。
   */
  it('⚠️ 同一份定义出现两次 ⇒ 两份效果（去重不是这一层的职责）', () => {
    const kit = buildPlayerKit('player', [QIJI_VITALITY, QIJI_VITALITY]);
    expect(kit.caps.hp).toBe(150 + 60);
    expect(kit.modifiers).toHaveLength(2);
    for (const modifier of kit.modifiers) {
      expect(modifier.stat).toBe('maxHp');
      expect(modifier.op).toBe('add');
      expect(modifier.value).toBe(30);
    }
  });
});

describe('兜底②「炁回复速度」：进 `modifiers`，不碰 caps', () => {
  it('caps 一个字不变（它不是上限类效果）', () => {
    const kit = buildPlayerKit('player', withQiji(QIJI_BREATH));
    expect(kit.caps).toEqual(playerCapsFor('player'));
  });

  it('modifiers 里是 `energyRegen add 10`', () => {
    const kit = buildPlayerKit('player', withQiji(QIJI_BREATH));
    expect(kit.modifiers).toHaveLength(1);
    expect(kit.modifiers[0]?.stat).toBe('energyRegen');
    expect(kit.modifiers[0]?.op).toBe('add');
    expect(kit.modifiers[0]?.value).toBe(10);
  });

  it('同一份定义传两次 ⇒ 两条（+20/秒）', () => {
    const kit = buildPlayerKit('player', [QIJI_BREATH, QIJI_BREATH]);
    expect(kit.modifiers).toHaveLength(2);
  });
});

describe('三条「派生 击」：拆成引擎的 `comboWindows` 输入', () => {
  it('「截」那条 ⇒ `{ buffId: combo-window, sourceSkillId: jie }`', () => {
    const kit = buildPlayerKit('kaili', withQiji(QIJI_JIE_STRIKE));
    expect(kit.comboWindows).toEqual([
      { buffId: COMBO_WINDOW.id, sourceSkillId: 'jie' },
    ]);
  });

  it('「闪」那条带 `viaBuffId`（第二条成功通道）', () => {
    const kit = buildPlayerKit('kaili', withQiji(QIJI_FLASH_STRIKE));
    expect(kit.comboWindows).toEqual([
      { buffId: COMBO_WINDOW.id, sourceSkillId: 'flash', viaBuffId: 'flash-iframe' },
    ]);
  });

  it('⚠️ 没选派生炁机 → `comboWindows` 空（黄金重放的路径）', () => {
    const kit = buildPlayerKit('kaili', withQiji(QIJI_VITALITY));
    expect(kit.comboWindows).toEqual([]);
  });

  it('同时选「截」与「闪」→ 两个产出者（同一个 buff id）', () => {
    const kit = buildPlayerKit('kaili', [QIJI_JIE_STRIKE, QIJI_FLASH_STRIKE]);
    expect(kit.comboWindows.map((w) => w.sourceSkillId).sort()).toEqual(['flash', 'jie']);
  });

  it('⚠️ 同一个源技能给两次也只开一个窗口（引擎按 `sourceSkillId` 判定）', () => {
    /**
     * 内容上「截炁·生击」一局只能选一次（`RunState.chosen` 是 id 集合），
     * 所以正常选不到两次；但**万一**传了重复的定义，引擎那侧是
     * "一次打断开一次窗"，两份产出者不会叠加成两个窗口（窗口是
     * `refresh` + 1 层）。
     */
    const kit = buildPlayerKit('kaili', [QIJI_JIE_STRIKE, QIJI_JIE_STRIKE]);
    expect(kit.comboWindows.every((w) => w.sourceSkillId === 'jie')).toBe(true);
  });
});

describe('组合：多条炁机一起（这是肉鸽第 3 场之后的常态）', () => {
  it('加血 + 炁回复 + 派生 → 三样各归各处', () => {
    const kit = buildPlayerKit('kaili', [QIJI_VITALITY, QIJI_VITALITY, QIJI_BREATH, QIJI_JIE_STRIKE]);
    expect(kit.caps.hp).toBe(120 + 60);
    expect(kit.modifiers.filter((m) => m.stat === 'maxHp')).toHaveLength(2);
    expect(kit.modifiers.filter((m) => m.stat === 'energyRegen')).toHaveLength(1);
    expect(kit.comboWindows).toEqual([{ buffId: COMBO_WINDOW.id, sourceSkillId: 'jie' }]);
  });

  it('`chosen` 的顺序不影响结果（§5.3：所有 op 交换）', () => {
    const a = buildPlayerKit('kaili', [QIJI_VITALITY, QIJI_VITALITY, QIJI_BREATH]);
    const b = buildPlayerKit('kaili', [QIJI_BREATH, QIJI_VITALITY, QIJI_VITALITY]);
    expect(a.caps).toEqual(b.caps);
  });
});

describe('纯函数：不改入参', () => {
  it('传入的 `chosen` 数组不被修改', () => {
    const input = withQiji(QIJI_VITALITY);
    const snapshot = JSON.parse(JSON.stringify(input));
    buildPlayerKit('player', input);
    expect(input).toEqual(snapshot);
  });
});
