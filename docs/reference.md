# 使用与配置参考

[返回首页](../README.md)

## 参数与配置

```bash
codex-webdesk start \
  --host 127.0.0.1 \
  --port 8080 \
  --cwd /srv/projects/my-app \
  --workspace-root /srv/projects \
  --codex-home /home/your-user/.codex
```

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `--host` | `127.0.0.1` | 监听地址 |
| `--port` | `8080` | 服务端口 |
| `--token` | 自动生成 | 访问 Token（至少 16 字符） |
| `--cwd` | 启动目录 | 默认工作目录 |
| `--workspace-root` | 不限制 | 校验工作 / 上下文目录的真实路径范围 |
| `--codex-home` | `$CODEX_HOME` 或 `~/.codex` | CLI 配置、登录和会话目录 |
| `--codex-bin` | `codex` | CLI 可执行文件，也可指定绝对路径 |
| `--data-dir` | `~/.local/share/codex-webdesk` | Web 任务 JSON 目录 |
| `--plugins-dir` | `~/.config/codex-webdesk/plugins` | 扫描本地工具插件 |
| `--disable-plugins` | 无 | 逗号分隔的禁用插件 ID |
| `--config` | 无 | JSON 配置文件 |
| `--origin` | 无 | 反向代理下允许的精确浏览器 Origin |
| `--secure-cookie` | 关闭 | HTTPS 部署时设置 Secure Cookie |

配置键使用 camelCase，参考 [config.example.json](../config.example.json)。优先级：命令行 > `CODEX_WEBDESK_TOKEN` > 配置文件 > 默认值。登录会话有效期 24 小时，重启服务会使登录 Cookie 失效。

## 与原有 Codex history 的关系

任务页的轻量读取器沿用原有 Python 工具的思路：只展示用户与助手文本，优先使用 `response_item`、回退到 `event_msg`，过滤环境上下文，忽略不完整 JSONL 尾行，不跟随符号链接。任务页独立实现为 Node.js 模块；完整“Codex 会话管理”插件迁入原 Python 库与前端，并通过按需子进程适配，不需要运行原 Python HTTP 服务。不导入现有工具里的私人导出快照、密码或部署配置。

“CLI 会话”页选择记录后，会回填模型与项目目录，进入继续会话模式。编辑 Prompt 后执行，会使用 `codex exec resume <ID> -`；点“取消”改为新任务。归档会话只供查看，需要先通过 Codex CLI 取消归档才能继续。Web 历史选中后回填原 Prompt 和参数，再执行会创建新任务。

任务页侧栏提供摘要搜索；完整插件提供对话全文搜索、删除确认和回收站、多会话合并交接以及 HTML/Markdown/JSON 导出。合并只生成文件和命令，不自动调用模型。完整会话页的“在工作台继续”会切换到任务页并回填会话，编辑后再执行。

## 执行与安全边界

后端使用 `spawn`，不拼接 Shell 命令。Prompt 通过 stdin 传给 CLI，任务使用 `--json`；附加目录映射为 `--add-dir`。默认 `read-only`；生成测试和重构预设会选择 `workspace-write`，执行前可调整。非交互模式固定 `--ask-for-approval never`，无法请求人工审批的动作由 CLI 拒绝。面板不提供无沙箱运行。普通目录也可执行（使用 `--skip-git-repo-check`）。

`workspace-root` 限制可选的工作目录和附加目录，**并不等于隔离服务器文件系统**；CLI 本身的沙箱负责读写与网络限制。Codex 登录、配置和模型可用性由服务器现有配置决定，前端模型选项仅为输入示例，可填写自己的模型标识。Temperature / Max Tokens 没有硬塞为未经核实的 CLI 参数。

页面外壳和宿主打包静态资源可公开加载，所有历史、任务、配置、插件 API 及插件页面资源均需登录。登录 Token 链接由浏览器读取后立即移除，再换取 HttpOnly Cookie，SSE URL 不携带 Token；首次请求的查询参数仍可能出现在反向代理访问日志，生产环境可手动输入 Token。失败登录按来源地址限流：5 分钟内 10 次；反向代理后地址共享，应结合代理自己的限速设置。API 不开放 CORS，不信任 `X-Forwarded-For`。

公网访问请使用 HTTPS 反向代理，详见部署指南。不要把未加密的服务直接暴露到公网。持有 Token 的用户能够执行 CLI 任务、读取会话记录，应按服务器访问凭据保管。Markdown 经 DOMPurify 清洗；Raw Terminal 只显示输出，不提供交互输入。

## 验证

```bash
npm run check
npm test
npm run build
npm run test:package
# 可选浏览器闭环验证（使用模拟 CLI，不调用模型，不收费）
npx playwright install chromium
npm run test:browser
```

自动测试覆盖鉴权、Cookie 注销、来源校验、限速、参数校验、单任务锁、SSE 重放、子进程组终止、日志持久化、启动失败、重启恢复和历史读取。浏览器测试覆盖插件切换、自定义工具 API、完整历史全文搜索和 HTML 导出、直接继续、登录、预设、流式输出、终端、XSS 清洗、快捷键、刷新恢复、中断、移动布局与注销。

测试使用模拟 CLI 和临时会话目录；插件集成测试需要 Python 3.10+。不会调用付费模型，也不会修改你的真实会话。当前未做真实模型端到端执行和内存基准测试。

## MVP 限制与路线图

- 一次一个任务，无任务队列、多人隔离和 Web 审批交互。
- 后端 HTTP、进程管理、插件注册与文件存储使用 Node 标准库；完整 history 插件使用 Python 标准库；前端使用原生 JS + esbuild，无 React/Vue 运行时。
- JSON 任务日志原子写入，运行中约每秒落盘，突然断电可能丢失最后约一秒日志。重启后未完成任务标记为 interrupted，不自动重跑。
- 单任务 Raw 保留约 400 万字符、结构化回答约 200 万字符、事件约 8 MB / 20000 条；达到上限会显示截断提示。历史详情最多保留约 200 万字符。任务文件总量不自动清理，运行时会载入 Web 历史；长期使用需自行归档。
- 原生历史列表按需扫描 JSONL，大量会话的索引与分页留待后续优化；不读取 Codex 内部数据库，未来 CLI 存储格式变化可能需要适配。
- 下一步：更多工具插件、队列与多工作区、Codex app-server 审批与交互会话、历史索引和分页、数据清理与性能基准。

CLI 集成参考：[官方非交互模式文档](https://developers.openai.com/codex/noninteractive)。本项目为独立社区工具，与 OpenAI 无隶属关系。

## License

[MIT](../LICENSE)。打包的前端第三方库许可证保留在 `dist/third-party-licenses.txt`。
