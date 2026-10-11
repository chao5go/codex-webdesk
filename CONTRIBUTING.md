# Contributing

欢迎提交问题和改进。请说明复现步骤、Node / Codex CLI 版本、操作系统，以及已移除敏感数据的日志。

```bash
npm ci
npm run build
npm run check
npm test
```

前端改动可运行 `npx playwright install chromium && npm run test:browser`。浏览器测试使用临时目录和模拟 CLI，不调用模型。

- 新工具优先按照 [插件协议](docs/plugins.md) 接入，并使用随附 `examples/plugins/server-info` 模板。
- 保持单端口、低部署负担和可在服务器用户权限下运行。
- 验证真实 CLI 支持的参数，避免用 UI 控件假装支持不存在的功能。
- 不提交 Token、`.codex` 登录文件、真实聊天记录、私人快照或服务器配置。
- 用户输入不得经过 shell 字符串拼接；新增 Markdown/HTML 展示必须经过清洗。
- 修改进程管理或鉴权时添加覆盖真实边界的测试。
- 发布前运行 `npm pack --dry-run`，确认 dist、源码和许可证在包中。
