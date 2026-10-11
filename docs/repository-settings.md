# GitHub 仓库设置说明

仓库：[chao5go/codex-webdesk](https://github.com/chao5go/codex-webdesk)。默认分支 `main`，公开仓库。

## 当前已配置

| 设置 | 当前值 | 用途 |
| --- | --- | --- |
| Actions | 已启用，允许所有 Actions | CI 与自动发布 |
| 默认 Workflow permissions | Read repository contents；不允许机器人批准 PR | 普通 CI 默认只读 |
| 发布 build job | `contents: write`、`actions: read` | 写版本/tag、恢复原安装包 |
| GitHub Release job | `contents: write` | 创建 Release 和上传附件 |
| Repository secret `NPM_TOKEN` | 已设置，来源于本机 `~/.npm_token` | npm 发布 |
| Repository secret `PYPI_TOKEN` | 已设置，来源于本机 `~/.pypi_token` | PyPI 发布 |
| Environment `release` | 仅允许 main 分支，无人工 reviewer/wait timer | 两个发布 job 自动执行 |
| 并发组 | `release-main`，不取消运行中的发布 | 防止同一版本并发发布 |
| 发布触发 | push main；手动 Run workflow | 自动 patch / 手动 minor、major |

本机 `~/.github_token` 仅用于配置仓库和 Secrets，不保存为 Actions Secret。工作流使用每个 job 自动生成的 `GITHUB_TOKEN`；npm/PyPI Token 只在对应发布步骤注入。当前发布 Secrets 存储在 Repository 层，release 环境限制发布 job 使用的分支。

## 查看或更换 Secrets

打开 [Settings → Secrets and variables → Actions](https://github.com/chao5go/codex-webdesk/settings/secrets/actions)，更新 `NPM_TOKEN` 或 `PYPI_TOKEN`。更新无需修改源码。

本机使用已授权 GitHub CLI 时，可从标准输入设置，避免将值写进命令行：

```bash
gh secret set NPM_TOKEN --repo chao5go/codex-webdesk < ~/.npm_token
gh secret set PYPI_TOKEN --repo chao5go/codex-webdesk < ~/.pypi_token
```

npm token 需具备 codex-webdesk 包发布权限；PyPI token 需具备该项目上传权限。过期或权限不足时发布 job 会失败，更换后重跑失败 job 即可。

## Environment 与权限

[Settings → Environments → release](https://github.com/chao5go/codex-webdesk/settings/environments)：Deployment branches 只允许 `main`，没有 Required reviewers 或 Wait timer，符合自动发布需求。

[Settings → Actions → General](https://github.com/chao5go/codex-webdesk/settings/actions)：默认保持只读，写权限由发布 workflow 的必要 job 显式申请。无需开启“Allow GitHub Actions to create and approve pull requests”。

当前流程会由机器人直接提交版本到 main。若未来启用禁止直接推送的分支保护或 ruleset，需要同时调整为机器人可更新版本的策略，或改为版本 PR 流程；不能只增加保护而保持现有直接提交流程。

## CI、Release 与安装验证

- [CI](https://github.com/chao5go/codex-webdesk/actions/workflows/ci.yml)：push/PR 检查，不发布包。
- [Release](https://github.com/chao5go/codex-webdesk/actions/workflows/publish.yml)：自动更新版本、测试、打包、发布。
- [GitHub Releases](https://github.com/chao5go/codex-webdesk/releases)：两个公开源发布成功后生成可下载附件。

用户升级：

```bash
uv tool upgrade codex-webdesk
# 或
npm install -g codex-webdesk@latest
codex-webdesk --version
```

包升级后，已运行的服务需正常停止并重新启动，才能加载新代码；用户数据和配置保留。此 Action 发布安装包，不会自动重启你的 VPS 服务。

## 后续维护

更换发布 Token 时更新对应 Repository Secret。增加审批人会使发布等待人工操作；迁移仓库时应同步 package.json/pyproject.toml 的仓库链接、部署分支和平台发布权限。将来可迁移到 npm/PyPI Trusted Publishing，取消长期发布 Token；当前已配置的 Token 流程可以直接使用。
