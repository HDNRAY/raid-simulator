# 肉鸽：每场战斗前的**确认界面**（2026-10-15）

> **这是一份"可以直接开工"的交接文档**（上个会话上下文用尽，方案已冻结）。
> 用户原话：
> > 肉鸽模式 每场战斗开始前 加一个 **确认界面**，显示**玩家详情**、
> > **玩家选择的炁机及其详情**。

## 0. 结论先行（别重新设计）

**做一个小相位 + 一屏两栏 + 一个「开始战斗」按钮**，内容**全部复用**备战屏那两块
详情面板 —— 不要新写一套详情 UI。

```
肉鸽：选角色 → 【新增】确认屏 → 战斗 → 选炁机 → 【新增】确认屏 → 战斗 → …
                    ↑ 每场战斗之前都要经过它
```

⚠️ **不要**把它做成"再选一次角色/炁机"的界面 —— 它是**确认**（只读 + 开始），
玩家在这一屏**不能改**任何东西（要改得回备战/选炁机）。

## 1. 现状（已经查明，不用再找）

| 要找什么 | 在哪 |
|---|---|
| 相位枚举 | `src/app/phaseLogic.ts` 的 `Phase = 'home' \| 'characterSelect' \| 'prepare' \| 'battle' \| 'qijiSelect' \| 'runOver'` |
| 相位 → 屏幕显隐 | `src/app/phaseLogic.ts` 的 `screenVisibilityOf(phase)` |
| 相位切换（唯一入口） | `src/app/phaseFlow.ts` 的 `switchTo(target)`（约 361 行）与 `applyPhase`（约 288 行） |
| 屏幕实例（怎么造/怎么挂） | `src/app/game.ts` + `phaseFlow.ts` 里的 `state.qijiSelect` / `state.runOver`（照它抄） |
| 肉鸽一局的流程 | `src/app/phaseFlow.ts` 约 404 行 `switchTo('qijiSelect')`；`src/app/runSession.ts`（`RunSession`） |
| **两栏内容的现成来源** | `src/app/prepareDetailContext.ts` → `prepareDetailContext(...)` 返回 `DetailContext`（`playerSkillRows` / `qijiById` / …）；模型组装在 `src/ui/prepareDetail.ts`（`detailModelOf`） |
| **现成的详情面板** | `src/ui/prepareDetailPanel.ts`（`PrepareDetailPanel`，`DetailModel` → 画） |

⚠️ **上个会话末尾刚改过详情面板的"两节合并"**（Boss 的招式/被动合成一列，见
`docs/specs/2026-10-14-detail-panel-scroll.md`）—— 复用面板时以**当前**实现为准。

## 2. 要做的事（按顺序）

1. **`Phase` 加一个成员**（建议 `'runConfirm'`），并在 `screenVisibilityOf` 里
   给它一份显隐表（只有新屏可见）
2. **新屏类**（建议 `src/ui/runConfirmScreen.ts`，照 `qijiSelect` / `runOver` 那两个
   屏幕的形状：`setVisible(bool)` + 自己的容器）
   - **左栏**：「**本次出战**」= 玩家（角色名 + 技能表）—— 用 `detailModelOf({kind:'player', …})`
   - **右栏**：「**已选炁机**」= 本局当前的炁机 —— 用 `detailModelOf({kind:'qiji', id})`
   - 两栏都用**已有的 `PrepareDetailPanel`**（它是"造 / 量 / 画"一体的组件）
   - 底部一个按钮：「**开始战斗**」（文案进 i18n，**不要**硬编码）
   - 标题写清是**第几场 / 共几场**（`RunSession` 有 `length` 与当前进度，
     见 `src/app/runSession.ts` 的接口注释）
3. **接进流程**：肉鸽里**每场战斗之前**都 `switchTo('runConfirm')`；
   这一屏的「开始战斗」才真的进 `battle`
   - ⚠️ **所有进战斗的路径都走 `switchTo`**（`phaseFlow.ts` 的注释点名过这件事：
     "任何一条进入战斗的路径都走这里"）—— 别在别处直接 `state.loop = startBattle()`
   - ⚠️ **自由模式（`runSession.active === false`）不受影响**：它已经有备战屏了
4. **输入路由**：确认屏要能**键盘确认**（回车/空格）+ **触屏点按钮**
   - ⚠️ 触屏与键盘**功能必须对等**（AGENTS.md §3b）
   - ⚠️ 键位提示**不许写进 i18n**（§3b）：i18n 只写标签，键名渲染时拼
5. **i18n**：新增文案进 `src/i18n/locales/zh-CN.ts`（标题 / 两栏标题 / 按钮）

## 3. 验收标准

- [ ] 肉鸽第 1 场、第 2 场……**每场之前**都出现确认屏（自由模式**不出现**）
- [ ] 屏上能读到**玩家技能表**与**当前炁机及其说明**
- [ ] 「开始战斗」进战斗；**键盘与触屏都能确认**
- [ ] 这一屏**不能改**任何选择（没有可点的角色/炁机列表）
- [ ] 单测：`phaseLogic` 的"相位 → 显隐"表（新相位只有新屏可见）；
      肉鸽流程里"每场战斗前都经过 `runConfirm`"（走 `RunSession` 的真数据，别手搭）
- [ ] **截图核实**（AGENTS.md §4a：**别走全流程** —— 用 URL 参数/debug API 直接跳到
      那一屏；§3e：裁剪不许用 Pixi `mask`）
- [ ] 四件套全绿：`pnpm run typecheck` → `npx eslint .` → `pnpm run test:run` → `pnpm run build`

## 4. 明确**不要**做的事

- ❌ 不要新写一套"玩家详情 / 炁机详情"的 UI（`prepareDetailPanel` 已经有了）
- ❌ 不要在这一屏里加"换角色 / 换炁机"（它是**确认**）
- ❌ 不要动自由模式与备战屏的现有行为（只在**肉鸽**的开战前插一屏）
- ❌ 不要跳过四件套，也不要自己 `git push`（AGENTS.md §3c：等用户说"推"）
