import { describe, expect, it } from 'vitest';
import { prepareHintOf } from '../../src/ui/prepareFooter';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { createTranslator } from '../../src/i18n/translator';
import type { LocaleId, TranslateFn } from '../../src/i18n/translator';

/**
 * ==================================================================
 * 备战屏**底部提示行**该写哪一句（2026-10-13 第三轮）
 * ==================================================================
 *
 * 用户两条原话（它们是同一条规则的两面）：
 *
 * > "**触屏底部的提示 显示触屏的版本**"
 * > "**炁机内部无法用方向键选择，所以把人物 炁机 对手的切换换成 tab**"
 *
 * 也就是：键盘那句要跟着 **Tab** 改，而触屏**不能**沿用键盘那句。
 *
 * ⚠️ 为什么这条规则值得单测：截图只能证明"有一行字"，证明不了"触屏上
 * **没有** Enter / Tab" —— 而错了的代价正是玩家按提示去按一个不存在的键。
 *
 * ⚠️ 键名（`Enter` / `Tab`）**不进 i18n**（AGENTS.md §3b）：语言包里是
 * `{confirm}` / `{tab}` 两个占位符，由渲染层拼。所以这一份断言同时也钉住
 * 了"改键不该改文案"那条结构。
 */
/**
 * 这一屏的取词函数（`TranslateFn`）。
 *
 * ⚠️ 两个形状**不一样**，所以这里写一个**有名字的适配器**（AGENTS.md §1：
 * 不许用 `as unknown as` 把类型问题按下去）：
 *
 * ```
 *   TranslateFn.key    = string          ← 这一屏的形状（屏幕不认识语言包）
 *   translator.t.key   = MessageKey      ← 语言包的形状（拼错 key 编译期就报）
 * ```
 *
 * ⚠️ 收窄那一下与 `app/translate.ts` 的 `translateSafe` 是**同一处**写法
 * （仓库既有先例，见那个函数的说明）：把 `string` 交给语言包，代价是
 * "拼错的 key 只有运行时才发现" —— 而那是生产路径本来就接受的口径。
 */
function translateFnOf(locale: LocaleId): TranslateFn {
  const { t } = createTranslator(locale);
  return (key, params) => t(key as Parameters<typeof t>[0], params);
}

const t = translateFnOf('zh-CN');

describe('键盘那一句：跟着 Tab 的改动更新', () => {
  const text = prepareHintOf(t, { developing: false, showKeyHints: true });

  it('⚠️ 提到 **Tab** 是"切换"（跨块）—— 用户这轮换的就是这件事', () => {
    expect(text).toContain('Tab');
    expect(text).toContain('切换');
  });

  it('⚠️ 仍然提到 Enter 是"确定"（旧需求：移动光标 ≠ 确定选择）', () => {
    expect(text).toContain('Enter');
    expect(text).toContain('确定');
  });

  it('⚠️ 不再说"方向键换块"：方向键只被说成**移动光标**', () => {
    expect(text).toContain('方向键移动光标');
    /** 旧文案的两个说法都该消失（它们会把 ↑↓ 读成换块）。 */
    expect(text).not.toContain('方向键选择');
    expect(text).not.toContain('Enter 开始');
  });

  it('键名确实是从渲染层拼上去的（不可能是语言包里的字面量）', () => {
    const raw = zhCN.roster.ui.hintCursor;
    expect(raw).toContain('{confirm}');
    expect(raw).toContain('{tab}');
    expect(raw).not.toContain('Enter');
    expect(raw).not.toContain('Tab');
  });
});

describe('触屏那一句：换一套，而且**不含键盘键名**', () => {
  const text = prepareHintOf(t, { developing: false, showKeyHints: false });

  it('【关键】触屏版本与键盘版本**不是同一句**', () => {
    expect(text).not.toBe(prepareHintOf(t, { developing: false, showKeyHints: true }));
    expect(text).not.toBe(zhCN.roster.ui.hintCursor);
  });

  it('⚠️【关键】没有任何键盘键名（旧版正是这里错）', () => {
    for (const key of ['Enter', 'Tab', 'Shift', '方向键', '←', '→', '↑', '↓']) {
      expect(text, `触屏提示不该出现「${key}」`).not.toContain(key);
    }
  });

  it('说的都是触屏**真有的**操作（点选 / 展开 / 炁机左右半边 / 拖动详情）', () => {
    expect(text).toContain('点卡片');
    expect(text).toContain('点块头');
    expect(text).toContain('右半');
    expect(text).toContain('左半');
    expect(text).toContain('拖动');
  });
});

describe('开发中：反馈优先于操作说明', () => {
  it('两种模式下都换成「开发中」（需求：点了没反应不如提前说）', () => {
    const developing = zhCN.roster.ui.developing;
    expect(prepareHintOf(t, { developing: true, showKeyHints: true })).toBe(developing);
    expect(prepareHintOf(t, { developing: true, showKeyHints: false })).toBe(developing);
  });
});
