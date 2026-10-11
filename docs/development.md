# 开发与运维

给**要改这个仓库的人**看的东西。README 只讲"这个游戏是什么、怎么玩"。

⚠️ **改代码之前先读 [`AGENTS.md`](../AGENTS.md)** —— 那是**强制**约定
（类型断言、单文件行数、触屏对等、i18n、不许自动 push），
违反会被 lint 拦下。

---

## 命令

```bash
pnpm install
pnpm run dev            # 本地开发（http://localhost:5273）
pnpm run typecheck      # tsc --noEmit
pnpm run lint           # eslint .，含架构硬约束与 i18n 规则
pnpm run test:run       # 全部单测
pnpm run test:core      # 只跑纯逻辑，node 环境，不碰浏览器
pnpm run build          # 产出 dist/（base 为 /raid/）
pnpm run shot /tmp/x.png   # 拍一张战斗截图（只拍图、不做断言）
pnpm run bench             # 性能基准
```

## 校验流水线（改完必跑这四条）

```
pnpm run typecheck  →  pnpm run lint  →  pnpm run test:run  →  pnpm run build
```

⚠️ **`build` 不能省，不能只用 `typecheck` 代替。**
仓库里有些素材是 **gitignore** 的（`public/fd2/`），本地有、CI 没有 ——
测试一旦**静态 import** 它们，本地全绿而 CI 必挂
（静态 import 是编译期解析，文件不在就报 `TS2307`）。
已有一条 lint 规则拦这个；素材不在时相关用例走 `skipIf` 显式跳过。

## 怎么验证

**没有端到端脚本** —— 逻辑靠单测、UI 靠截图。

| 要验证的 | 用什么 |
|---|---|
| **逻辑**（结算、触发器、条件、内容、状态机） | **单元测试**。`src/core/` 是零依赖纯 TS，能在 Node 里直接跑 |
| **UI**（布局、位置、重叠、显隐、文案） | **截图**，然后**自己看图**判断 |

⚠️ 截图**只负责拍一张图**，不做断言、不做长流程 —— 别把它发展成新的 e2e。

### 调试参数

| URL 参数 | 作用 |
|---|---|
| `?prepare=skip` | 跳过备战界面直接进战斗 |
| `?prepare=skip&boss=lust` | 指定 Boss 直接开一局 |
| `?noai=1` | Boss 不出招（观察用） |

⚠️ 画布有 letterbox：`clientY = rect.top + 逻辑Y × (rect.width / 960)`。

## lint 的硬约束

**不是风格偏好**：`core/` 里出现 `Math.random`、`import 'pixi.js'`、
`document`、`await`，或者 `src/` 下写死中文，都会**构建失败**。

反向用例在 `tools/lint-fixtures/`，由 `tests/unit/lintRules.test.ts` 断言
规则真的生效（**不实测的 lint 规则等于没写**）。

## 确定性重放

`tests/golden/replay.test.ts` 把**一整场战斗**压缩成一个可提交、可 diff 的常量：

```
固定种子 + 固定玩家策略  →  胜负 / 击杀用时 / 随机数终态 / 双方终局状态
```

它防的是**静默的行为变化** —— 改了一个数值、门禁顺序、AI 优先级或 tick 语义，
重放会立刻暴露。因为引擎没有 `Math.random`（lint 硬约束）、
随机数状态存在 `BattleState` 里，重放是逐位确定的。

⚠️ **`REPLAY_FORMAT_VERSION` 当前是 `2`**。改动引擎的确定性语义时必须 `+1`，
否则旧的重放文件会在新引擎上产生"看起来像 bug"的差异。测试会校验这个数字。

## 分辨率

逻辑分辨率固定 **960×540**（16:9），渲染层按视口自适应缩放。

⚠️ canvas 的**内部缓冲跟着 CSS 尺寸与 DPR 走**（见 `render/scaling.ts`）。
CSS 拉伸会让画面变糊（视网膜屏上等效放大更多），所以 resize 会重建 framebuffer。

`image-rendering: pixelated` 已启用，所以非整数倍缩放是"**锐利但不均匀**"
（1px / 2px 交替），不是糊。细节见架构规范。

## 素材生成的工具

`artgen/` 是一个**独立于游戏代码**的工具目录（不入 `src/`，不参与 lint）：

```bash
python3 artgen/generate.py balance              # 查余额
python3 artgen/generate.py styles               # 拉风格目录
python3 artgen/generate.py estimate --prompt "..." --style rd_plus__classic
python3 artgen/generate.py gen --prompt "..." --style rd_plus__classic
python3 artgen/prepare_frames.py                # 帧 + 掩码 → RGBA，并生成 manifest
python3 artgen/make_index.py                    # 生成素材索引页
```

- key 放 `artgen/.env`（**已 gitignore**），或设环境变量 `RD_API_KEY`
- `estimate` 是**免费试算**，不出图不扣费
- ⚠️ `--negative` 字段**当前无效**（服务方文档说没有模型使用它）——
  想排除什么就改写正向 prompt

## 线上地址与部署

**https://hdnray.github.io/raid/** —— 路径是 `/raid/`，不是仓库同名的
`/raid-simulator/`。所以 `vite.config.ts` 的 `base` 是 `/raid/`。

⚠️ **引用 `public/` 下的素材必须走 `assetUrl()`**（`src/render/assetUrl.ts`）。
硬编码 `/xxx.png` 会解析到**域名根**，线上必然 404 ——
而 dev 下 base 恰好是 `/`，所以这个 bug **在本地看不出来**。

推送 `main` 会触发 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)：
typecheck → lint → test → build → 发布到 GitHub Pages。**任一步不通过则不发布。**

### 发布密钥

推送 `main` 需要 `SSH_DEPLOY_KEY` secret 才能发布到 GitHub Pages。
配置步骤见 [setup-deploy-key.md](setup-deploy-key.md)，约 3 分钟。
