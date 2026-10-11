# VPS 部署

## 通过 SSH 隧道使用

默认监听本机，不需要开放 VPS 防火墙端口。服务器运行：

```bash
codex-webdesk start --cwd /srv/projects/my-app
```

本地电脑运行：

```bash
ssh -N -L 8080:127.0.0.1:8080 your-user@your-vps
```

打开 `http://127.0.0.1:8080`，输入服务器打印的 Token。关闭 SSH 会断开浏览器连接，后台任务继续运行；重新连接后可刷新页面恢复。

## 常驻服务：systemd 用户服务

先安装打包好的项目，运行 `command -v codex-webdesk` 和 `command -v codex`，填入实际绝对路径。不要以 root 用户运行此工作台。

`~/.config/codex-webdesk/environment`：

```ini
CODEX_WEBDESK_TOKEN=替换为至少32字节随机Token
PATH=/home/your-user/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
```

```bash
chmod 600 ~/.config/codex-webdesk/environment
```

`~/.config/systemd/user/codex-webdesk.service`：

```ini
[Unit]
Description=Codex Webdesk
After=network.target

[Service]
Type=simple
EnvironmentFile=%h/.config/codex-webdesk/environment
ExecStart=/home/your-user/.npm-global/bin/codex-webdesk start --cwd /srv/projects/my-app --workspace-root /srv/projects --codex-bin /home/your-user/.npm-global/bin/codex
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=10
UMask=0077

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now codex-webdesk
journalctl --user -u codex-webdesk -f
```

需要登出后仍运行，可由服务器管理员为该用户启用 linger。不要直接将其他项目的认证文件或已有共享代理配置复制进开源仓库。

## HTTPS 反向代理

例：Caddy，域名 DNS 指向 VPS。服务继续监听 `127.0.0.1:8080`。以域名根路径部署，目前不支持 URL 子路径。

```caddyfile
codex.example.com {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

服务启动参数添加：

```bash
codex-webdesk start --origin https://codex.example.com --secure-cookie --cwd /srv/projects/my-app
```

代理需保留原始 `Host`，禁用 SSE 缓冲，并允许持续响应。Token 保存在环境文件中，网页登录时手动输入，避免包含 Token 的查询链接进入访问日志。可在代理层添加 Basic Auth，应用自身仍需 Token。

## 备份和更新

- Web 记录位于 `--data-dir`，原生会话位于 `--codex-home`；它们包含项目内容和对话，使用权限受控的备份。
- 固定 Token 不在 Web 任务记录中保存。重启服务会清空登录会话。
- 更新前停止服务、备份记录，安装新包再启动。新版本升级记录格式时应先提供迁移方法。
- 历史文件可在服务停止时移出数据目录做归档，避免长期日志增长；不要在任务运行中删除文件。

## 排障

| 现象 | 检查 |
| --- | --- |
| 找不到 CLI | `command -v codex`，确认服务用户 PATH，或传 `--codex-bin` |
| CLI 认证失败 | 在同一用户、同一 `CODEX_HOME` 下运行 CLI 并完成登录 |
| 输出等到结束才出现 | 关闭代理响应缓冲，检查 SSE 是否被代理断开 |
| 403 来源错误 | 代理保留 Host，`--origin` 精确匹配浏览器地址 |
| 429 登录过多 | 等待五分钟；代理后的用户共享后端来源地址，可增加代理层限速 |
| 只读任务无法编辑 | 执行前选择 Workspace write |
| 更新后登录失效 | 服务重启会清空 Cookie 会话，重新输入固定 Token |
