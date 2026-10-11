# 自动发布与版本管理

推送到 `main` 后，GitHub Actions 的 **Release** 工作流自动增加 patch 版本，并在所有验证通过后发布 npm、PyPI 和 GitHub Release。版本唯一来源是 `package.json`；自动同步 `package-lock.json`，Python 构建、Node CLI/API 均读取同一版本。

## 平时迭代

```bash
# 发布机器人会提交版本号；每次开始改动前同步
 git pull --ff-only
# 修改代码并提交
 git add .
 git commit -m 'feat: your change'
 git push origin main
```

例如当前为 `0.1.0`，推送后自动发布 `0.1.1`，再推送则发布 `0.1.2`。无需本地改版本、手动打 tag 或使用发布 token。合并 PR 到 main 同样触发；其他分支和 PR 仅执行 CI。文档修改推送到 main 也会产生 patch 版本。

手动发布 minor/major：进入 [Actions → Release](https://github.com/chao5go/codex-webdesk/actions/workflows/publish.yml)，选择 **Run workflow**，分支 main，`bump` 选择 patch、minor 或 major。首次配置自动化的提交也会触发一次真实发布。

## 流水线顺序

1. 串行处理发布，准备新版本；同一触发提交重跑时复用已经记录的版本。
2. 运行 JavaScript 检查、服务测试、发布恢复测试、浏览器测试和 npm 安装包测试。
3. 构建 Python wheel/sdist，分别验证隔离安装后的服务和会话导出。
4. 保存测试通过的三个安装包和 SHA256SUMS 到 Actions artifacts，保留 30 天。
5. 提交版本与 changelog，原子推送 main 和 `v版本号` tag，并把原安装包备份到同版本 GitHub Release 草稿；测试失败不会推进正式版本。
6. npm、PyPI 独立发布，核对公开源中的产物哈希并验证命令能运行。
7. 两个平台均验证通过后把 GitHub Release 草稿转为正式发布，附带 npm 包、wheel、sdist 和校验文件。

机器人使用 GitHub 自带 `GITHUB_TOKEN`，其版本提交不会再次触发 push 工作流，因此不会无限发布。源码并发更新导致非 fast-forward 时，原子推送失败，不强推；应在最新 main 上重新发布。

## 失败与重跑

打开对应 Actions run，优先选择 **Re-run failed jobs**：保留原安装包，成功平台不会重复上传；PyPI 部分上传成功时只补发缺失文件。**Re-run all jobs** 会按 `Release-Source` 提交记录恢复同一版本和同版本 Release 草稿或正式 Release 中备份的原安装包，不重新加版本号。

npm 返回成功后可能仍等待平台扫描，流水线会等待最多 20 分钟并检查公开版本。扫描中不要重复发布；若超时，先检查 npm 版本/暂存状态，再重跑失败 job。暂存发布需要账户 2FA 批准，普通扫描等待无需批准。

Actions artifacts 保留 30 天；全量重跑从同版本 Release 备份恢复原安装包，不依赖旧 attempt 的 artifacts。如果 Release 或备份资产被删除，应先核对已发布版本，不能重新构建后覆盖旧文件。npm/PyPI 已发布文件不可覆盖；哈希不匹配会明确失败。

## 本地验证与应急发布

```bash
npm ci
npm run check
npm run build
npm test
python3 -m unittest discover -s test -p 'release_test.py'
npm run test:browser
npm run test:package
uv build --out-dir python-dist

# version 替换成 package.json 中的版本
uv run --no-project --with ./python-dist/codex_webdesk-VERSION-py3-none-any.whl python scripts/python-package-smoke.py
uv run --no-project --with ./python-dist/codex_webdesk-VERSION.tar.gz python scripts/python-package-smoke.py
```

源码包携带预构建前端，用户从 sdist 安装不需要 npm；维护者改前端后先构建再打包。

应急手动发布使用 `python3 scripts/publish.py --channel npm` 或 `--channel pypi`，读取本机 `~/.npm_token`、`~/.pypi_token`，认证不会加入 git。不要与正常自动发布同时操作同一版本。

仓库实际权限、Secrets 和维护配置见 [仓库设置说明](repository-settings.md)。
