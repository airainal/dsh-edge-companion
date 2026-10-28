# DSH Edge Bridge（DSH 宿主插件）

这个插件让 **DeepSeek Harness 启动时自动拉起 Edge 桥接**，同时把 Edge 侧边栏接到客户端
**同一个 Session Controller**（实时流、发送键变停止、Codex 状态同步，不创建第二个 agent）。

- 只要 DSH 开着，Edge 侧边栏就连得上，不需要点任何启动按钮、不需要 `.cmd`、不需要开机自启；
- 桥接进程在 DSH 退出后会继续运行（Edge 侧边栏仍可用），下次 DSH 启动会复用已有实例，不会重复占端口。

## 它做了什么

`index.js` 在 DSH 启动时执行一次：

1. 找到上一级目录的 `bridge\bridge.mjs`（要求保持 `dsh-edge-companion` 文件夹结构完整）；
2. 用 DSH 自带的 Node（`<DSH 安装目录>\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`）以隐藏窗口方式启动它；
3. 注入 `DSHEDGE_CWD`，让侧边栏创建的会话落在 `dsh-edge-companion` 工作区，便于在 DSH 桌面版里继续。

如果桥接已经在跑旧版本，插件会先停掉它再启动当前版本，避免 DSH 重启后仍复用旧 bridge.mjs。

## 安装（推荐用 DSH 的 Plugins 页面，免命令）

1. 保持整个 `dsh-edge-companion` 文件夹在原地（插件通过相对路径找 `bridge\bridge.mjs`）。
2. 打开 DSH → 左侧 **Plugins** → **Add plugin**（或箭头里的 **Install a third-party plugin**）。
3. 输入这个 `dsh-plugin` 文件夹的**绝对路径**，例如：
   `D:\tools\dsh-edge-companion\dsh-plugin`
4. 安装 → 默认会启用；如果 DSH 提示需要重启，重启一次 DSH 即可生效。
5. 验证：打开 `bridge\bridge.log` 应出现新的启动日志；或运行 `bin\edge.cmd status` 看 `connected`。

## 卸载

DSH → Plugins → 找到 **DSH Edge Bridge** → Remove（或关闭开关）。桥接进程可用
`curl -X POST http://127.0.0.1:8766/shutdown` 或任务管理器结束 node 进程。

## 说明

- 这是 Host-only 插件：没有 UI 页面，启动时拉起桥接并接入客户端同一会话。
- 插件通过 `link:` 方式安装在本机 profile 里，**移动或删除这个文件夹会导致插件失效**；
  如果移动了，重新在 Plugins 里安装一次即可。
- 桥接本身的安全边界不变：只监听 `127.0.0.1`、Host 白名单、可选令牌。
