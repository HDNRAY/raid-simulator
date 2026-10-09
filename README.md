# Raid Simulator

一个**单挑 Boss**的实时战斗数值模拟器。第三人称视角、无位移、全键盘操作、
PixiJS 像素渲染。

> **项目状态：M0 完成，进入 M1。** M0（工程骨架）已完成并通过 87 个单测 +
> CDP 端到端验证（实测 tick 速率 60.0Hz）。当前有一个 tick 驱动的占位画面，
> 真正的战斗逻辑从 M1 开始写。

---

## 这是什么

- **一场战斗 = 一个 Boss。** 每场有**时限**（超时判负）和**狂暴机制**
  （超时后 Boss 伤害翻倍），Boss 有带前摇的技能、阶段转换、可打断的读条。
- **没有位移，但需要"躲"。** Boss 技能在 **hit frame** 一次性判定，
  你按下的闪避/格挡会给自己挂一个 **300ms 的短时无敌/减伤 buff**——
  时机对了就免伤，错了就吃满。**判定窗口就是 buff**，不是另一套系统。
- **技能派生。** 施放技能 A 后开启一个 1.5s 的"派生窗口"，
  技能 B 只有在这个窗口内可用。同样是 buff 存在性判断。
- **玩家和 Boss 数值对等。** 两边跑**同一个引擎、同一套数据模型**，
  区别只有输入来源：玩家是键盘，Boss 是数据驱动的行为数组。
- **全键盘。** 没有 WASD，主键区全部留给技能（`1-6` `Q E R T F G Z X C V`）。

---

## 设计文档

| 文档 | 内容 |
|---|---|
| [数据模型规范](docs/specs/2026-10-09-data-model.md) | `GameEntity` / `Skill` / `Effect` / `Buff` / `Modifier` / `Expr` / `Condition` / `Trigger`，修正树结算算法，14 条验收测试 |
| [架构与 UI 规范](docs/specs/2026-10-09-architecture.md) | 技术选型、分层架构、硬约束、目录结构、测试策略、UI 组件化与设计系统、里程碑、发布流程 |
| [i18n 规范](docs/specs/2026-10-09-i18n.md) | **强制**：引擎持 key、UI 查表；当前仅 zh-CN；lint I1–I3 + 6 个构建期校验码 |
| [M0–M2 实施计划](docs/plans/2026-10-09-m0-m2.md) | 工程骨架 + 纯确定性核心 + 判定层的任务分解、依赖顺序、每步验证命令 |
| [画面示意图](docs/mockups/2026-10-09-battle-scene.png) | 960×540 逻辑分辨率下的战斗界面布局（Boss 144×192） |
| [发布密钥配置](docs/setup-deploy-key.md) | `SSH_DEPLOY_KEY` 配置步骤（当前未配置） |

**新读者建议顺序**：先看画面示意图 → 再看数据模型规范的 §9「熵之钟走查」
（一个完整的被动装备例子）→ 再看架构规范的 §2 分层。

---

## 架构核心：一条硬边界

```
        ┌──────────────────────────────────────────────┐
        │  core/   纯确定性模拟引擎                       │
        │  (state, input, dt) -> (state', events)      │
        │  零依赖 · 无 DOM · 无 Math.random · 可在 Node 跑 │
        └──────────────────────────────────────────────┘
                 ▲                          │
      Action[]   │                          │  Snapshot + Events
                 │                          ▼
        ┌────────────────┐        ┌──────────────────────┐
        │ input/ 键盘     │        │ render/ Pixi 消费者   │
        └────────────────┘        └──────────────────────┘
```

旧版本（已删除，可从 git 历史取回，见文末）失败的原因是**引擎逻辑写在了 React 组件的 `useCallback` 里**，
伤害结算、buff 计时、公式全靠 `useEffect` 监听时间变化来驱动。
新版本用五条**由 lint 强制**的约束把它彻底隔开（见架构规范 §2.1）：

1. `core/` 不许 import `pixi` / DOM / UI
2. `core/` 里不许出现 `Math.random` / `Date.now`
3. `render/` 不许反向依赖 `core/` 内部
4. `core/` 里不许出现异步
5. 状态必须可结构化克隆、可哈希

**验收标准**：`core/` 能在 Node 里跑完一整场战斗并断言结果——不启动浏览器。
只有这个测试通过，才允许开始写 UI。

---

## 里程碑

| # | 内容 | 状态 |
|---|---|---|
| M0 | 工程骨架：Vite + TS + Pixi + 固定步长循环 | ✅ 完成 |
| M1 | `core/` 确定性模拟（数据模型 + 修正树 + 资源 + CD + 读条 + DoT） | 🚧 进行中 |
| M2 | 判定层（hit frame + 无敌/减伤 + 中断 + 属性溯源重算） | ⬜ |
| M3 | 输入层（键位 + Action 队列 + 按住连发 + 回放录制） | ⬜ |
| M4 | Boss AI 与行为数组（时间轴 + 阶段 + 狂暴 + 打断） | ⬜ |
| M5 | 表现层（战斗场景 + HUD + 飘字 + 预警 + HUD 淡出） | ⬜ |
| M6 | 内容：Boss「Verrot, the Fallen」全套技能与动画 | ⬜ |
| M7 | 打磨（音效 + 粒子 + 设置持久化 + 正式像素素材） | ⬜ |

**M1 + M2 结束时，游戏在 Node 里就已经"可玩"了**——没有画面，但能跑出正确的战斗结果。

---

## 开发



```bash
pnpm install
pnpm run dev            # 本地开发（http://localhost:5273）
pnpm run typecheck      # tsc --noEmit
pnpm run lint           # 含架构硬约束 C1-C5 / I1-I3
pnpm run test:run       # 87 个单测（含 lint 反向用例）
pnpm run test:core      # 只跑纯逻辑，node 环境，不碰浏览器
pnpm run verify:e2e     # CDP 端到端：验证 tick 真的在 60Hz 推进
pnpm run build          # 产出 dist/（base 为 /raid/）
```

**lint 的硬约束不是风格偏好**：`core/` 里出现 `Math.random`、`import 'pixi.js'`、
`document`、`await`、`new Map()`，或者 `src/` 下写死中文，都会**构建失败**。
反向用例在 `tools/lint-fixtures/`，由 `tests/unit/lintRules.test.ts` 断言规则真的生效
（不实测的 lint 规则等于没写）。

推送 `main` 会触发 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)：
typecheck → lint → test → build → 发布到 GitHub Pages。
**测试或 lint 不通过则不会发布。**

### 线上地址（保持不变）

**https://hdnray.github.io/raid/** —— 路径是 `/raid/`，不是仓库同名的
`/raid-simulator/`。新项目的 Vite `base` 必须是 `/raid/`，
路由必须是 **hash 形式**（`#/battle`），页面标题保持 `Code:Raid`。

新项目就绪前（`src/main.ts` 不存在），`deploy.yml` 只做校验、**不发布**，
所以线上会保留 2022 年的旧版本，不会被空产物覆盖。

### 分辨率

逻辑分辨率固定 **960×540**（16:9）。canvas 内部尺寸在生命周期内**永不改变**，
缩放完全交给 CSS，多余区域用黑边填充。默认 `fit` 模式（按
`min(w/960, h/540)` 等比填满），设置里可切 `integer`（整数倍 + 绝对锐利）。
细节见架构规范 §10。

---

## 旧版本

2021 年的初版实现（CRA + React 17 + Redux Toolkit + SCSS）**已从工作区删除**。
它在战斗数值上做得相当完整（四资源、主副属性、读条 + GCD、DoT/HoT、伤害飘字、
槽位键位映射），作为设计参考有很高价值，但因为逻辑与 UI 无法分离而停止维护。

代码没有丢失，**完整保留在 git 历史里**：

```bash
# 看 2022 年那次重构前的完整源码树
git ls-tree -r --name-only 993e2db

# 取任意一个文件
git show 993e2db:src/core/Battle.ts
git show 993e2db:src/types/types.d.ts

# 想整体恢复到某个目录
git archive 993e2db | tar -x -C /tmp/raid-v1
```

注意 `993e2db` 是 v1 的最后一个提交（`init classes`）。
`git log --oneline | tail -1` 是 `1744fdf Initial commit`。

## 发布密钥

推送 `main` 需要 `SSH_DEPLOY_KEY` secret 才能发布到 GitHub Pages。
**当前尚未配置**（2026-10-09 核查）：构建会成功，但推送这一步会失败。
配置步骤见 [docs/setup-deploy-key.md](docs/setup-deploy-key.md)，约 3 分钟。
