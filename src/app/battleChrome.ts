/**
 * **战斗这一屏的边角控件**（齿轮 + 开发模式的"一键过关"）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 它原来内联在 `game.ts` 的 `createChrome` 里（8 行），而 `game.ts` 正好
 * 卡在 AGENTS §3 的 700 行上限 —— 开发模式那颗按钮要加进来时，**没有位置**
 * 了。搬到这儿既是"横向切割"（`game.ts` 的装配流水账不再夹着一段按钮
 * 构造），也让"开发模式才有的东西"集中在一个文件里。
 *
 * ==================================================================
 * ⚠️ 开发模式那颗按钮**只在开发模式构建**
 * ==================================================================
 *
 * `onDevClear` 是 `ScreenChrome` 的"画不画它"的唯一判据：生产里
 * `devMode` 为假 ⇒ 这里**不传** ⇒ 按钮根本不构造、命中测试也没有那一支
 * （不是"画了再藏"，那种一不留神就会露出来 ✗）。
 *
 * 快捷键 `F2` 同理，守卫在 `app/loopWiring` 的键分发里（同一个 `devMode`）。
 */

import type { PixiCtor } from '../ui/primitives';
import { ScreenChrome, battleGearBoxAt } from '../ui/ScreenChrome';
import { DEV_MODE } from './config';
import { readUrlParams } from './urlParams';
import type { TranslateFn } from '../i18n/translator';
/** 战斗循环（只要"能一键过关"这一个能力）。 */
import type { BattleLoop } from './battleLoop';

export interface BattleChromeDeps {
  readonly pixi: PixiCtor;
  /** `F1` 的显示名（键位表反查，不进 i18n）。 */
  readonly f1Label: () => string;
  /**
   * 翻译（只为 `F2` 的键位标签取词）。
   *
   * ⚠️ 类型必须是 `TranslateFn`（**带 `params`**）—— 写成 `(key) => string`
   * 会静默丢掉占位符，界面上直接显示 `{…}` 本身（`lintRules` 有一条扫描
   * 盯着这个形状）。这里虽然只取一个没有参数的键，也照约定的形状写。
   */
  readonly translate: TranslateFn;
  /** 键位提示显隐（唯一 flag 的派生 —— 触屏为假）。 */
  readonly showKeyHints: () => boolean;
  /** 点齿轮（打开设置）。 */
  readonly onGear: () => void;
  /**
   * 取当前战斗循环（可能没有）。
   *
   * ⚠️ 传**取值函数**而不是实例：边角控件造得比战斗循环早。
   */
  readonly battle: () => BattleLoop | undefined;
}

/** 造战斗屏的边角控件。 */
export function createBattleChrome(d: BattleChromeDeps): ScreenChrome {
  /** ⚠️ 判据只有一处：`config.DEV_MODE` 或 `?dev=1`（与图鉴同一行）。 */
  const dev = DEV_MODE || readUrlParams(globalThis.location.search).dev;
  return new ScreenChrome({
    pixi: d.pixi,
    gearAt: battleGearBoxAt,
    f1Label: d.f1Label,
    showKeyHints: d.showKeyHints,
    onGear: d.onGear,
    /** ⚠️ 非开发模式**不传** ⇒ `ScreenChrome` 不构建那颗按钮（见文件头）。 */
    ...(dev
      ? {
          /**
           * ⚠️ 这里是**键位显示名**（`F2`），不是动作文案 —— 与齿轮那颗
           * `f1Label`（`settings.openKey` = `F1`）同一个约定。
           * 曾经写成 `dev.clearKey`（=「过关」）⇒ 按钮上显示的是动作名、
           * 键位提示反而没有 ✗（截图抓到的）。
           */
          f2Label: () => d.translate('settings.clearKey'),
          onDevClear: () => void d.battle()?.devClear(),
        }
      : {}),
  });
}
