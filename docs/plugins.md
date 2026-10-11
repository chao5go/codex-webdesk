# 工具插件接入指南

工作台提供统一导航、Token 登录、静态页面托管和 API 鉴权。插件可独立维护自己的界面、依赖和后端逻辑。当前协议版本为 `apiVersion: 1`，支持本地页面插件，安装后重启服务生效。

## 内置插件

| ID | 功能 | 依赖 |
| --- | --- | --- |
| `workbench` | Codex 任务、流式输出、中断、历史复用 | Node.js + Codex CLI |
| `codex-history` | 原有会话管理：全文搜索、筛选、全选、HTML/Markdown/JSON 导出、回收站删除、多会话交接 | Python 3.10+ 标准库 |

完整会话管理以独立页面接入，保持原有使用习惯，增加“在工作台继续”。原 Python HTTP 服务不需要启动，不占用第二个端口。Python 适配器仅在请求时运行，复用迁入的 history 库；请求串行处理，保留回收站和运行中会话检查。没有 Python 时，该插件显示“需配置”，任务页的基础 CLI 会话浏览仍可使用。

原 `/home/ubuntu/wood/codex-history` 工具无需修改或移动。新项目的插件实现独立打包，按同一个 `--codex-home` 读取会话；安装到别的服务器也不依赖这个原始绝对路径。

## 添加一个工具页

默认扫描 `~/.config/codex-webdesk/plugins/` 的一级子目录；也可通过 `--plugins-dir` 或 JSON 配置的 `pluginsDir` 指定位置。默认不会扫描项目工作目录中的代码。

```text
plugins/
└── my-tool/
    ├── plugin.json
    ├── server.mjs          # 可选：后端接口
    └── public/
        ├── index.html
        ├── app.js
        └── style.css
```

`plugin.json`：

```json
{
  "apiVersion": 1,
  "id": "my-tool",
  "name": "我的工具",
  "description": "这个工具能帮助我做什么",
  "icon": "◇",
  "order": 30,
  "entry": "index.html",
  "server": "server.mjs"
}
```

- `id`：以小写字母开头，只含小写字母、数字、连字符，最长 48 字符，所有插件唯一。
- `name`：导航名称，必填；`description`、`icon`、`order` 可选。
- `entry`：相对 `public/` 的页面路径，默认 `index.html`。
- `server`：相对插件目录的 Node ESM 文件，静态工具页可以省略。
- 每个插件的页面在独立 iframe 中加载，样式不会影响其他工具。
- 页面引用 JS/CSS 使用相对路径，脚本写在独立文件里。CSP 不允许内联脚本和外部 CDN，第三方资源请一起打包到 `public/`。

重启工作台后，导航自动显示新工具，无需改动工作台的 HTML、路由或构建配置。可以直接将已有静态工具的构建产物复制到 `public/`。

## 后端接口

`server.mjs` 默认导出一个工厂函数（也可 async），返回 `handle` 和可选的 `close`：

```js
export default function createPlugin({ id, dataDir, config, apiBase, HttpError }) {
  return {
    async handle({ req, res, route, url, body, json }) {
      // 浏览器请求 /api/plugins/my-tool/info，这里的 route 是 /info。
      if (req.method === 'GET' && route === '/info') {
        json(res, 200, { title: config.title || '我的工具' });
        return true;
      }
      if (req.method === 'POST' && route === '/save') {
        const payload = await body(req);
        if (typeof payload.title !== 'string') {
          throw new HttpError(400, '请输入标题');
        }
        // 在 dataDir 下存储自己的数据；写入前自行创建目录。
        json(res, 200, { ok: true });
        return true;
      }
      return false;
    },
    async close() {
      // 停止自己创建的定时器、进程、数据库连接等。
    }
  };
}
```

| 工厂参数 | 含义 |
| --- | --- |
| `id` | 插件 ID |
| `pluginDir` | 插件目录绝对路径 |
| `dataDir` | 建议的数据目录：`<服务 dataDir>/plugins/<ID>` |
| `config` | JSON 配置中 `pluginOptions[ID]`，默认空对象 |
| `apiBase` | `/api/plugins/<ID>` |
| `HttpError` | 可抛出的 HTTP 错误类 |

`handle` 只会收到已通过工作台鉴权和来源校验的请求。处理完成返回 `true`；不匹配的路径返回 `false`，宿主返回 404。`body(req)` 读取 JSON，请求上限 256 KB。`json(res, status, value)` 输出统一 JSON。可直接使用 `res` 下载文件或流式输出。`url` 为原请求 URL 对象。

插件接口只能注册在自己的 `/api/plugins/<ID>/` 下；静态资源只能来自自己的 `public/`。路径穿越、隐藏文件和逃出目录的符号链接会被拒绝。原有 `/api/tasks` 和 `/api/sessions` 由内置插件保留兼容，外部插件不能占用这些路由。

## 前端鉴权和登录失效

浏览器同源请求会自动带工作台的 HttpOnly Cookie，无需读取或保存 Token：

```js
const response = await fetch('/api/plugins/my-tool/info');
if (response.status === 401) {
  parent.postMessage({ type: 'crw:session-expired' }, location.origin);
}
```

写入请求使用 JSON；浏览器会自动携带 Origin。非浏览器客户端仍可使用 Bearer Token。只有原生会话管理的删除、合并和导出接口额外要求从其会话列表取得的 `X-CSRF-Token`，以兼容原工具的确认流程。

## 试用随附示例

仓库附带完整的 [服务器概览插件](../examples/plugins/server-info)，展示前后端接入：

```bash
# 在仓库根目录运行；直接扫描示例目录，不需要复制
npm start -- --plugins-dir ./examples/plugins
```

此时会有三个导航入口：任务工作台、Codex 会话管理、服务器概览。

安装到默认插件目录：

```bash
mkdir -p ~/.config/codex-webdesk/plugins
cp -R examples/plugins/server-info ~/.config/codex-webdesk/plugins/
```

重启服务即可。npm 包也包含 `examples/`，可作为自己的插件模板。源码仓库中的 `npm run test:package` 会验证独立安装后，插件页面、接口、Python 适配和离线导出仍可用。

## 启停和配置

禁用插件同时移除其页面和 API：

```bash
codex-webdesk start --disable-plugins codex-history,server-info
```

配置示例：

```json
{
  "pluginsDir": "/home/your-user/.config/codex-webdesk/plugins",
  "disabledPlugins": ["server-info"],
  "pluginOptions": {
    "codex-history": { "pythonBin": "/usr/bin/python3" },
    "my-tool": { "title": "自己的工具" }
  }
}
```

禁用的外部插件不会加载它的后端模块。启用插件的描述格式错误、ID 冲突、入口不存在或模块初始化失败会阻止启动并显示错误，避免静默丢失工具。服务退出时调用各插件的 `close`；即使某个退出钩子报错，其他插件与 Codex 任务仍会清理。

插件是可信本地代码，与服务共享服务器用户权限和网页登录会话。这是扩展机制，不提供不可信插件沙箱、权限审批、依赖安装或在线插件商店。只安装自己维护或已检查的插件；插件的第三方 Node 依赖由插件自行安装在其目录。

## 会话管理的数据操作

“删除会话”保留原来的确认，并将 JSONL 移入 `<CODEX_HOME>/history-trash/<批次>/`，不删除项目文件。恢复时把回收站文件移回对应的 `sessions/` 或 `archived_sessions/` 路径。运行中会话检测依赖 Linux `/proc`；macOS 上没有同等检测，执行删除前需要自己关闭对应 CLI 会话。

“合并后继续”保留最多 20 段会话的限制，生成权限为 600 的 `history-handoffs/*.md` 和经引用的 `codex` 命令，不执行命令、不调用模型。恢复命令使用 `--codex-bin` 所选可执行文件，默认 `codex`，不依赖原服务器专用的 `codexd` 包装命令。

导出的 HTML 为独立快照，支持离线搜索；不会执行删除或合并接口。会话管理沿用完整 JSONL 扫描方式，每次桥接响应上限 64 MB、超时 60 秒；超大历史需要后续索引和分页优化。
