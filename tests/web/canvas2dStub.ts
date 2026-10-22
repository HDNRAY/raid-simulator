/**
 * **给 jsdom 一张"能测字"的 2D 画布** —— `tests/web/` 里所有要造 Pixi `Text`
 * 的测试共用这一份。
 *
 * ⚠️ 为什么需要：jsdom 的 `canvas.getContext('2d')` 返回 **null**（没装
 * `canvas` 原生包），而 Pixi 的 `Text` 量字时会读 `ctx.measureText(...)`
 * 与 `ctx.font` ⇒ 直接报 `Cannot set properties of null (setting 'font')` ✗。
 *
 * ⚠️ 为什么抽出来：`gameBoot.test.ts` 与 `richLineRender.test.ts` 都要它，
 * 抄两份必然漂（一处补了 `letterSpacing`、另一处没补，就会一个绿一个红）。
 */

/**
 * **给 jsdom 一张"能测字"的 2D 画布**。
 *
 * ⚠️ jsdom 的 `canvas.getContext('2d')` 返回 **null**（没装 `canvas` 原生包），
 * 而 Pixi 的 `Text` 在**量字**时会读 `ctx.measureText(...)` 与 `ctx.font`
 * ⇒ 直接报 `Cannot set properties of null (setting 'font')` ✗。
 *
 * 这个替身只实现"量字 + 画画用的空方法"：宽度按 `字数 × 字号 × 0.9` 估
 * （测试里只关心**能不能跑完装配**，不关心像素宽度 ✓）。
 */
export function stubCanvas2d(): void {
  /**
   * ⚠️ Pixi 的 `CanvasTextMetrics` 会读**全局** `CanvasRenderingContext2D`
   * 的 `prototype`（判断 `letterSpacing` 支持与否）—— jsdom 里没有这个全局
   * ⇒ `ReferenceError: CanvasRenderingContext2D is not defined` ✗。
   * 所以给它一个"有 prototype"的占位类；真正的实例仍是下面那个替身对象。
   */
  if (!('CanvasRenderingContext2D' in globalThis)) {
    class FakeCtx2D {}
    Object.defineProperty(globalThis, 'CanvasRenderingContext2D', {
      value: FakeCtx2D,
      configurable: true,
    });
  }
  const proto = HTMLCanvasElement.prototype;
  proto.getContext = function getContext(kind: string): unknown {
    if (kind !== '2d') return null;
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      textBaseline: '',
      textAlign: '',
      letterSpacing: '0px',
      measureText: (text: string) => {
        /** ⚠️ 不用 `this`（隐式 any）：`ctx` 在闭包里延后读取，赋值早就完成了 ✓。 */
        const size = Number.parseFloat(/\d+/.exec(ctx.font)?.[0] ?? '12');
        const width = Math.max(1, [...text].length * size * 0.9);
        return {
          width,
          actualBoundingBoxAscent: size * 0.8,
          actualBoundingBoxDescent: size * 0.2,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: width,
          fontBoundingBoxAscent: size * 0.8,
          fontBoundingBoxDescent: size * 0.2,
        };
      },
      save: () => {},
      restore: () => {},
      scale: () => {},
      translate: () => {},
      rotate: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
      strokeText: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      rect: () => {},
      clip: () => {},
      drawImage: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData: () => {},
      setTransform: () => {},
    };
    return ctx;
  } as typeof proto.getContext;
}

