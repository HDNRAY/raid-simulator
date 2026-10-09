/** 反向用例：渲染层越界依赖 core 内部模块（违反 C3）。 */
import { DemoSim } from '../core/worker';

export const leaked = DemoSim;
