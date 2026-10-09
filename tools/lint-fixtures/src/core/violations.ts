/**
 * 反向用例：core/ 里**故意**违反 C1/C2/C4/C5。
 *
 * 不要"修好"这个文件 —— 它的存在就是为了证明 lint 规则会报错。
 * 由 tests/unit/lintRules.test.ts 断言每条规则都命中。
 */
import { Application } from 'pixi.js';
import { something } from '../render/scaling';
import { t } from '../i18n/translator';

export function bad(): number {
  const r = Math.random();
  const n = Date.now();
  const w = document.title;
  const m = new Map<string, number>();
  const el = window;
  return (
    r + n + w.length + m.size + (el ? 1 : 0) + Application.length + something.length + t.length
  );
}

export async function alsoBad(): Promise<void> {
  await Promise.resolve();
}
