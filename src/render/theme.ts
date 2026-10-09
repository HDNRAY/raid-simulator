/**
 * 设计 token —— **UI 与像素美术的唯一配色真相源**（架构规范 §6.3）。
 *
 * 为什么要有这个文件：如果 UI 颜色和素材颜色各写各的，很快就会出现
 * "UI 是蓝的、精灵是紫的"这种廉价感。所以两边读同一份常量。
 *
 * 每个语义色有 base / dark / bright 三档，正好对应像素画的明暗梯度。
 */

import type { ColorSource } from 'pixi.js';

export interface Shade {
  readonly base: number;
  readonly dark: number;
  readonly bright: number;
}

export const PALETTE = {
  /* ---- 背景 ---- */
  bgTop: 0x0a0c16,
  bgBottom: 0x1e141c,
  ground: 0x1a1418,
  groundLine: 0x3c2a2e,

  /* ---- 面板 ---- */
  panel: 0x11121b,
  panelLine: 0x505266,
  text: 0xf0f0f6,
  textDim: 0x8c8c9e,
  textFaint: 0x585a6c,

  /* ---- 语义色（三档明暗） ---- */
  hp: { base: 0xd23a34, dark: 0x7c1b1f, bright: 0xf0605a },
  /** 缠：短循环资源，绿色（"还能继续打"） */
  energy: { base: 0x5cb460, dark: 0x1f4e29, bright: 0x7cd480 },
  /** 炁：积攒型资源，金色（"攒满了就放大招"） */
  douqi: { base: 0xe4a840, dark: 0x624215, bright: 0xffc860 },
  /** 判定窗口专用：必须最醒目 */
  iframe: { base: 0xff6648, dark: 0x5a0d0b, bright: 0xffb8a0 },
  /** 预警：物理（红） */
  danger: { base: 0xec4c38, dark: 0x460d0f, bright: 0xff9070 },
  /** 预警：法术（紫） */
  magic: { base: 0x9868d6, dark: 0x3c2666, bright: 0xb890f0 },
  /** 派生窗口 */
  proc: { base: 0x5acad8, dark: 0x1c545c, bright: 0x9ae8f0 },
  /** 打断可用 */
  interrupt: { base: 0xf0d060, dark: 0x6a5a18, bright: 0xfff0a0 },

  /* ---- 状态 ---- */
  buff: { base: 0x78c478, dark: 0x284c28, bright: 0xa8e4a8 },
  debuff: { base: 0xca5a5a, dark: 0x461a1a, bright: 0xf08080 },
  neutral: { base: 0x8a8ca0, dark: 0x3a3c48, bright: 0xb8bac8 },

  /* ---- Boss 专用 ---- */
  bossBody: 0x68627c,
  bossBodyDark: 0x464254,
  bossBodyLight: 0x8c86a0,
  bossCloak: 0x4a1c24,
  bossVisor: 0xff5836,
  bossSword: 0xc8ccd8,

  /* ---- 玩家背影 ---- */
  playerCloak: 0x2a3050,
  playerCloakLight: 0x485476,
  playerCloakDark: 0x141828,
} as const;

/**
 * 排版别名 —— **已迁到 `ui/layout.ts` 的 `FONT`**（那里是布局的单一来源）。
 *
 * 这里保留 `TYPE` 作为兼容别名，避免一次性改动过多调用点；
 * 新代码请直接用 `FONT`。
 */
export const TYPE = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
} as const;

/**
 * 字体族。
 *
 * ------------------------------------------------------------------
 * 为什么用楷体
 * ------------------------------------------------------------------
 *
 * 技能图标就是技能名那个字（攻 / 闪 / 防 / 破 / 轰 / 凝）。
 * 这些字需要**一眼可辨**，而楷体的笔画对比强、结构舒展，
 * 在 40px 的小方块里比黑体更容易认 —— 黑体在小字号下容易糊成一团。
 *
 * 字体族顺序：macOS 的 `KaiTi` → Windows 的 `KaiTi`/`STKaiti` →
 * 通用 `cursive` 兜底（Linux 上通常是楷体风格的字体）。
 *
 * ⚠️ canvas 里**没有**"字体文件的子集化"这回事 —— 缺字会静默回退。
 * 所以这里给的是候选链而不是单一字体名。
 */
export const FONT_FAMILY =
  'KaiTi, STKaiti, KaiTi_GB2312, 楷体, Songti SC, serif';

/** 数字与拉丁字母用的等宽字体（数值对齐需要）。 */
export const FONT_FAMILY_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** 常用颜色转换：给 Pixi 的 Text 用（它接受 CSS 字符串）。 */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** 取某个语义色的三档。 */
export function shade(color: Shade): Shade {
  return color;
}

export type PaletteColor = ColorSource;
