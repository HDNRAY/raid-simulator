/**
 * **文案 key 的存在性校验**（i18n 规范 I1 的落点）。
 *
 * ==================================================================
 * 为什么单独一个文件（本轮从 `validate.ts` 切出来）
 * ==================================================================
 *
 * 加"buff 消费机制"的内容校验时，`validate.ts` 到了 **712 行**
 * （AGENTS.md §3 的上限是 700）。按那条纪律（**先拆 util / 横向切割，
 * 不许压注释**），`validateBuff` 那一整块搬到了 `./buffValidation.ts` ——
 * 而它要用这个函数，本函数又只依赖 `ValidationIssue` 这个叶子类型。
 *
 * 所以它搬到这里：`validate.ts`（技能 / 实体）与 `buffValidation.ts`
 * （buff）都能向下依赖它，方向是单向的。
 *
 * ⚠️ `localeKeys` 不给时**跳过**：`core/` 不许 import i18n，`core` 的单测
 * 也拿不到真实语言包 —— 那时不校验存在性是**有意**的（"没有目录可查"
 * 与"目录里查不到"是两件事），而不是漏了。
 */

import type { ValidationIssue } from './validationIssue';

export function validateLocaleKey(
  key: string | undefined,
  path: string,
  localeKeys: ReadonlySet<string> | undefined,
  push: (i: ValidationIssue) => void,
): void {
  if (key === undefined) return;
  if (localeKeys && !localeKeys.has(key)) {
    push({
      severity: 'error',
      code: 'MISSING_LOCALE_KEY',
      path,
      message: `locale key "${key}" does not exist in the catalog`,
    });
  }
}
