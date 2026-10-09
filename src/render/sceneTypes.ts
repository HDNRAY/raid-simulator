/**
 * 渲染层的**共享类型**。
 *
 * 拆出来的原因：`IconStrip` / `SkillBarView` / 顶栏等绘制模块都要
 * `TranslateFn`，如果各自从 `BattleScene.ts` 里 import，就会形成
 * "子模块反向依赖主模块"的环。类型单独一个文件，大家都向下依赖它。
 */

import type { Application } from 'pixi.js';
import type { PixiCtor } from '../ui/primitives';

/**
 * 取词函数。
 *
 * `params` 是插值参数（模板里的 `{name}`）—— 日志条目带 `{amount}`
 * 这类占位符，所以渲染层需要能把参数一起传下去。
 */
export type TranslateFn = (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string;

export interface BattleSceneOptions {
  readonly app: Application;
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
}

export interface BattleSceneOptions {
  readonly app: Application;
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
}
