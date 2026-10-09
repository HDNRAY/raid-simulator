/**
 * 白名单用例：core/ 里**合规**的写法，不应产生任何 lint 错误。
 *
 * 特别验证：用 core/rng.ts 的种子化 RNG 而不是 Math.random。
 */
import { createRng, nextRandom } from '../../../src/core/rng';

export function roll(seed: number): number {
  const r = nextRandom(createRng(seed));
  return r.value;
}
