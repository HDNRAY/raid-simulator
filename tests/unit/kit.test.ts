import { describe, expect, it } from 'vitest';
import { buildPlayerKit, type ActiveQiji } from '../../src/data/kit';
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
 */

/** 把一条炁机包成 `ActiveQiji`（测试里反复要用）。 */
function withQiji(def: (typeof ALL_QIJI)[number], stacks = 1): ActiveQiji[] {
  return [{ def, stacks }];
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

  it('叠 3 层 ⇒ +90（上限 3）', () => {
    const kit = buildPlayerKit('player', withQiji(QIJI_VITALITY, 3));
    expect(kit.caps.hp).toBe(240);
  });

  it('⚠️ 修正条目**也**在 `modifiers` 里（W6 做完后就不用再动数据）', () => {
    /**
     * 这是"效果写成标准 `modifier`"的收益：今天 `caps` 是过渡落点，
     * 而 `modifiers` 里那条**同时**存在 —— W6 把钳制改成读结算值之后，
     * 删掉 caps 那一步即可，内容一个字不用改。
     *
     * ⚠️ 层数是**逐份复制**（溯源面板要显示"3 层 = 3 条同源条目"），
     * 不是把 value 乘起来。
     */
    const kit = buildPlayerKit('player', withQiji(QIJI_VITALITY, 3));
    expect(kit.modifiers).toHaveLength(3);
    for (const modifier of kit.modifiers) {
      expect(modifier.stat).toBe('maxHp');
      expect(modifier.op).toBe('add');
      expect(modifier.value).toBe(30);
    }
  });

  it('⚠️ 不碰别的上限（energy / douqi 原样）', () => {
    const base = playerCapsFor('player');
    const kit = buildPlayerKit('player', withQiji(QIJI_VITALITY, 3));
    expect(kit.caps.energy).toBe(base.energy);
    expect(kit.caps.douqi).toBe(base.douqi);
  });

  it('其它角色同样生效（凯丽 120 → 150）', () => {
    const kit = buildPlayerKit('kaili', withQiji(QIJI_VITALITY));
    expect(kit.caps.hp).toBe(150);
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

  it('叠 2 层 ⇒ 两条（+20/秒）', () => {
    const kit = buildPlayerKit('player', withQiji(QIJI_BREATH, 2));
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
    const kit = buildPlayerKit('kaili', [withQiji(QIJI_JIE_STRIKE)[0]!, withQiji(QIJI_FLASH_STRIKE)[0]!]);
    expect(kit.comboWindows.map((w) => w.sourceSkillId).sort()).toEqual(['flash', 'jie']);
  });

  it('⚠️ 同一个源技能选两次也只会开一个窗口（引擎按 `sourceSkillId` 判定）', () => {
    /**
     * 内容上「截炁·生击」`maxStacks = 1`，所以正常选不到两次；但**万一**
     * 叠上了（或将来允许叠），引擎那侧是"一次打断开一次窗"，
     * 两份产出者不会叠加成两个窗口（窗口是 `refresh` + 1 层）。
     */
    const kit = buildPlayerKit('kaili', [
      withQiji(QIJI_JIE_STRIKE)[0]!,
      withQiji(QIJI_JIE_STRIKE)[0]!,
    ]);
    expect(kit.comboWindows.every((w) => w.sourceSkillId === 'jie')).toBe(true);
  });
});

describe('组合：多条炁机一起（这是肉鸽第 3 场之后的常态）', () => {
  it('加血 + 炁回复 + 派生 → 三样各归各处', () => {
    const kit = buildPlayerKit('kaili', [
      ...withQiji(QIJI_VITALITY, 2),
      ...withQiji(QIJI_BREATH, 1),
      ...withQiji(QIJI_JIE_STRIKE, 1),
    ]);
    expect(kit.caps.hp).toBe(120 + 60);
    expect(kit.modifiers.filter((m) => m.stat === 'maxHp')).toHaveLength(2);
    expect(kit.modifiers.filter((m) => m.stat === 'energyRegen')).toHaveLength(1);
    expect(kit.comboWindows).toEqual([{ buffId: COMBO_WINDOW.id, sourceSkillId: 'jie' }]);
  });

  it('`chosen` 的顺序不影响结果（§5.3：所有 op 交换）', () => {
    const a = buildPlayerKit('kaili', [...withQiji(QIJI_VITALITY, 2), ...withQiji(QIJI_BREATH, 1)]);
    const b = buildPlayerKit('kaili', [...withQiji(QIJI_BREATH, 1), ...withQiji(QIJI_VITALITY, 2)]);
    expect(a.caps).toEqual(b.caps);
  });

  it('⚠️ 0 层 = 没选（不会凭空生效）', () => {
    const kit = buildPlayerKit('player', withQiji(QIJI_VITALITY, 0));
    expect(kit.caps.hp).toBe(150);
    expect(kit.modifiers).toEqual([]);
  });
});

describe('纯函数：不改入参', () => {
  it('传入的 `chosen` 数组不被修改', () => {
    const input = withQiji(QIJI_VITALITY, 2);
    const snapshot = JSON.parse(JSON.stringify(input));
    buildPlayerKit('player', input);
    expect(input).toEqual(snapshot);
  });
});
