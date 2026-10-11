# 发布

版本唯一来源为 `package.json`，Node CLI/API 与 Python 构建均从中读取。修改版本后同步 lockfile：`npm install --package-lock-only --ignore-scripts`。

```bash
npm ci
npm run check
npm test
npm run test:browser
npm run test:package
uv build --out-dir python-dist
uv tool install --force ./python-dist/codex_webdesk-0.1.0-py3-none-any.whl
codex-webdesk --version
```

`scripts/python-package-smoke.py` 可使用安装环境的 Python 对 wheel 或 sdist 安装后的服务执行隔离验证：

```bash
uv run --no-project --with ./python-dist/codex_webdesk-0.1.0-py3-none-any.whl python scripts/python-package-smoke.py
```

源码包包含预构建前端，用户从 sdist 安装不需要 npm。维护者修改前端后必须先运行 `npm run build` 再构建 Python 包。

首次手动发布使用本地认证文件，经环境变量/临时配置传入发布工具，不加入 git。后续 GitHub Actions 的手动发布工作流使用仓库 secrets `NPM_TOKEN` 和 `PYPI_TOKEN`。发布已有版本不可覆盖；先验证两个产物，分别发布，若某个渠道失败，只补发失败渠道。长期可改用两个平台的 Trusted Publishing。

本地发布（读取 `~/.npm_token` 和 `~/.pypi_token`）：

```bash
python3 scripts/publish.py
# 某个渠道已经成功时，只补发另一渠道
python3 scripts/publish.py --channel pypi
```

GitHub Actions 首次使用前需在仓库配置 `NPM_TOKEN`、`PYPI_TOKEN` secrets；SSH 推送权限不包含管理 Actions secrets 的权限。
