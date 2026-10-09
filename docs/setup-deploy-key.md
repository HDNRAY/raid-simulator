# 配置发布密钥（SSH_DEPLOY_KEY）

> 一次性操作，约 3 分钟。做完之后每次 push `main` 就会自动发布到
> <https://hdnray.github.io/raid/>。

## 背景

发布流程（与 `bdgame` / `colorGuess` 一致）：

```
raid-simulator 仓库  ──build──>  dist/  ──cpina action──>  HDNRAY.github.io 仓库的 raid/
```

这条链路的最后一跳需要**写权限**，靠一对 SSH 部署密钥完成：

| 东西 | 放在哪 | 用途 |
|---|---|---|
| **私钥** | `raid-simulator` 仓库的 Actions secret，名字必须是 `SSH_DEPLOY_KEY` | workflow 用它推送到目标仓库 |
| **公钥** | `HDNRAY.github.io` 仓库的 Deploy keys，**必须勾选 Allow write access** | 授权上面那把私钥写入 |

> 现状（2026-10-09 核查）：`raid-simulator` 仓库里**没有** `SSH_DEPLOY_KEY`，
> 所以发布链路目前是断的。push `main` 会构建成功但推送失败。

## 步骤

### 1. 生成一对新密钥（本地执行）

**不要复用** `HDNRAY.github.io` 目录下那对 `id_github_pages_codelinez`
（那是 codelinez 专用的，混用会把两个项目的权限绑在一起）。

```bash
cd ~/.ssh
ssh-keygen -t ed25519 -C "raid-simulator deploy key" \
  -f ~/.ssh/id_raid_simulator_pages -N ""
```

- `-N ""` 表示**空 passphrase**，必须为空：CI 里无法交互输入。
- 生成两个文件：`id_raid_simulator_pages`（私钥）、
  `id_raid_simulator_pages.pub`（公钥）。

### 2. 把公钥加到目标仓库

1. 打开 <https://github.com/HDNRAY/HDNRAY.github.io/settings/keys>
2. **Add deploy key**
3. Title: `raid-simulator (cpina deploy)`
4. Key: 粘贴 `~/.ssh/id_raid_simulator_pages.pub` 的**全部内容**
5. ✅ **勾选 `Allow write access`** ← 不勾就推送失败，这是最常见的错误
6. Add key

### 3. 把私钥加到源仓库

1. 打开 <https://github.com/HDNRAY/raid-simulator/settings/secrets/actions>
2. **New repository secret**
3. Name: **`SSH_DEPLOY_KEY`** ← 必须一字不差（workflow 里读的是这个名字）
4. Secret: 粘贴 `~/.ssh/id_raid_simulator_pages` 的**全部内容**，
   包括开头 `-----BEGIN OPENSSH PRIVATE KEY-----` 和结尾
   `-----END OPENSSH PRIVATE KEY-----`
5. Add secret

### 4. 验证

```bash
# 确认公钥已生效（应输出 success）
ssh -T -i ~/.ssh/id_raid_simulator_pages git@github.com

# 触发一次发布
gh workflow run deploy.yml   # 或者直接 push main
```

然后看 <https://github.com/HDNRAY/raid-simulator/actions>，
`Deploy to GitHub Pages` 的 `Push to github pages` 这一步应该是绿的。
发布成功后 <https://hdnray.github.io/raid/> 会更新。

## 排错

| 现象 | 原因 |
|---|---|
| `Permission denied (publickey)` | 公钥没加到 `HDNRAY.github.io`，或加错了仓库 |
| `remote: Permission denied` / `403` | Deploy key **没勾 Allow write access** |
| `SSH_DEPLOY_KEY not found` / 空密钥 | secret 名字拼错，或加到了 Environment 而不是 Repository secrets |
| 私钥报 `invalid format` | 粘贴时漏了首尾的 `-----BEGIN/END-----` 行，或用了带 passphrase 的密钥 |
| 构建成功但站点没变 | `cpina` 的 `target-directory` 要与 URL 子路径一致（本项目是 `raid`） |

## 安全提醒

- 这把私钥只对 `HDNRAY.github.io` **一个仓库**有写权限，泄漏的影响范围有限。
  这比用个人 access token 安全，也是 bdgame / colorGuess 采用同一方案的原因。
- 本地那两个密钥文件（`~/.ssh/id_raid_simulator_pages*`）**不要提交进任何仓库**。
  生成后可以留在本地备份，也可以删掉——公钥已存在 GitHub，私钥已存在 secret 里，
  本地副本只是为了以后轮换。
