import { describe, expect, it } from 'vitest';
import { screenVisibilityOf, type Phase, type ScreenKey } from '../../src/app/phaseLogic';

/**
 * **"逐屏扫描"的机器化版本**（`phaseLogic.screenVisibilityOf` 的不变量）。
 *
 * ==================================================================
 * 为什么要有这个文件
 * ==================================================================
 *
 * "两个整屏界面同时可见"是本仓库反复踩到的一类 bug，而且它**在截图里
 * 很难看出来**：漏掉的那一屏通常被上面那屏的不透明底色盖住，只在
 * 边角、半透明面板下、或者某一帧里露出来一点。所以判据不能只靠肉眼看图。
 *
 * 这里的断言等价于"逐屏扫描"这句话：
 *
 *   > 在**每屏相位**下，**不属于该屏**的整屏界面一律 `visible === false`
 *
 * 只不过程序里的"节点"收成了四个**整屏界面根**（`ScreenKey`）——
 * 而它们每一个都是不透明满屏的子树，所以"根隐藏 ⇒ 整棵子树（含
 * `alpha`）都不进渲染"是 Pixi 的既定语义：
 *
 *   - `updateRenderGroupTransforms`：`globalDisplayStatus =
 *     localDisplayStatus & parent.globalDisplayStatus`
 *   - `collectRenderablesMixin`：`globalDisplayStatus < 7` 直接不入构建
 *
 * ⚠️ 于是"整屏界面是一棵子树"这件事本身也是这条不变量的一部分：
 * **边角控件（齿轮 / 返回箭头）必须住在各自界面的 root 里**，不能挂到
 * `app.stage` 上 —— 挂出去它们就不受本表管了（`ScreenChrome` 文件头
 * 记着这条的由来）。
 *
 * ⚠️ 另外两屏（设置面板 / 触屏按钮层）**不在**这张表里：它们是**子模式**，
 * 有自己的唯一写入点（`settingsToggle` / `touchControls.frame`）。本文件的
 * 最后一条断言防的就是"有人把它们也塞进这张表"造成两份真相。
 */

/**
 * 全部相位（列出来而不是从类型遍历：`Phase` 是编译期的，运行期数不出来）。
 *
 * ⚠️ **加一个相位就要在这里加一个**，而且 `Phase` / `ScreenKey` 的类型
 * 会让漏掉的地方**编译不过**（`screenVisibilityOf` 的返回值是
 * `Record<ScreenKey, boolean>`）。这张表是那个编译期检查的**运行期**对照面：
 * 少了它，"6 个相位"与"6 个界面根"就有可能各说各话。
 *
 * P3 加了两个：`qijiSelect`（选炁机）与 `runOver`（一局结束）。
 * 2026-10-15 加了第三个：`runConfirm`（肉鸽每场战斗之前的确认屏）。
 */
const PHASES: readonly Phase[] = [
  'home',
  'characterSelect',
  'prepare',
  'battle',
  'runConfirm',
  'qijiSelect',
  'runOver',
  /** 图鉴（2026-10-20）。 */
  'codex',
];

/** 全部整屏界面根（每个相位恰好点亮一个）。 */
const SCREENS: readonly ScreenKey[] = [
  'home',
  'characterSelect',
  'prepare',
  'battle',
  'runConfirm',
  'qijiSelect',
  'runOver',
  'codex',
];

/**
 * 剥掉注释（保留换行，行号对得上）。
 *
 * ⚠️ 必须剥：下面两条扫描找的是**代码**，而新写的注释里**引用了**
 * 旧写法（"原先写的是 `setVisible(phase === 'home')`"）。不剥就会把
 * 注释当成违规 —— 那会逼着后来的人删掉这段"为什么收成一张表"的记录，
 * 而那条记录正是这个文件存在的理由。
 */
function stripComments(source: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

describe('相位 → 整屏界面：每个相位恰好一屏在场', () => {
  it('每个相位都给出了完整的显隐向量（每个界面一个不落）', () => {
    for (const phase of PHASES) {
      const show = screenVisibilityOf(phase);
      expect(Object.keys(show).sort()).toEqual([...SCREENS].sort());
    }
  });

  it('【逐屏扫描】每个相位下恰有一个整屏界面可见，其余一律 false', () => {
    for (const phase of PHASES) {
      const show = screenVisibilityOf(phase);
      const onStage = SCREENS.filter((screen) => show[screen]);
      /**
       * 0 个 = 黑屏（切过去什么都没有）；
       * 2 个及以上 = 两个整屏界面重叠（本仓库的经典 bug 形状）。
       */
      expect(onStage, `相位 ${phase} 在场的整屏界面`).toHaveLength(1);
      /**
       * 再钉一遍"其余**显式为 false**"：`setVisible(false)` 必须被
       * 显式执行 —— 只写可见的那一个，其余会停在上一屏的状态上。
       */
      for (const screen of SCREENS) {
        if (screen === onStage[0]) continue;
        expect(show[screen], `相位 ${phase} 下 ${screen} 必须为 false`).toBe(false);
      }
    }
  });

  it('每个整屏界面**都**被某个相位点亮（没有永远不显示的孤儿屏）', () => {
    const lit = new Set<ScreenKey>();
    for (const phase of PHASES) {
      for (const screen of SCREENS) if (screenVisibilityOf(phase)[screen]) lit.add(screen);
    }
    expect([...lit].sort()).toEqual([...SCREENS].sort());
  });
});

describe('"谁该可见"只有一处判据（不许在 applyPhase 里再判一次）', () => {
  /**
   * 源码扫描（与 `lintRules.test.ts` 同一种做法）。
   *
   * ⚠️ 防的是**回归**：这条不变量以前是靠纪律维持的，而"顺手再补一句
   * `setVisible(phase === …)`"看起来无害 —— 直到有人加了一个相位、
   * 只改了两处中的一处。那种 bug 的表现是"某一屏切走之后还留着"。
   */
  it('applyPhase 读表，而不是自己写 `phase === …`', async () => {
    const { readFileSync } = await import('node:fs');
    const source = stripComments(readFileSync('src/app/phaseFlow.ts', 'utf8'));

    expect(source).toContain('screenVisibilityOf(phase)');
    /** 第二处判据的两种写法（`setVisible` 与直接写 `root.visible`）。 */
    expect(source).not.toMatch(/setVisible\(\s*phase\s*===/);
    expect(source).not.toMatch(/\.visible\s*=\s*phase\s*===/);
  });

  it('整屏界面根只在 applyPhase 里被写显隐（其余地方不许碰）', async () => {
    const { readFileSync, globSync } = await import('node:fs');
    /**
     * ⚠️ 扫的是"对**整屏界面根**调 `setVisible`"这件事。
     * `state.home` / `state.select` / `state.prepare` / `state.qijiSelect` /
     * `state.runOver` 是 `GameState` 上整屏界面根的唯一入口（见 `flow.ts`）。
     *
     * ⚠️ P3 加了最后两个、2026-10-15 又加了 `runConfirm`：**不补进这条
     * 扫描**的话，新屏的显隐就可能被别处偷偷写一次 —— 而那正是"两个界面
     * 同时可见"的形状（本文件的整个存在理由）。
     */
    const offenders: string[] = [];
    for (const file of globSync('src/app/**/*.ts')) {
      if (file.endsWith('phaseFlow.ts')) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (/state\.(home|select|prepare|runConfirm|qijiSelect|runOver)\?\.setVisible\(/.test(line)) {
          offenders.push(`${file}:${i + 1} → ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders, `整屏界面根的显隐只许 applyPhase 写：\n${offenders.join('\n')}`).toEqual([]);
  });
});
