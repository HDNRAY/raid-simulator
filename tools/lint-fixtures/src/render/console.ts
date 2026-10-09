/**
 * 白名单用例：console.* 里的开发者日志允许出现中文（I1 的窄例外）。
 */
export function log(): void {
  console.warn('渲染层启动了');
}
