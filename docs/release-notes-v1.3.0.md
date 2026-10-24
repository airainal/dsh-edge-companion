# DSH Edge Bridge v1.3.0

让 DeepSeek Harness 驱动你真实的、带登录态的 Microsoft Edge。

## 亮点

- **DSH 宿主插件**：DSH 启动时自动拉起桥接，之后只要 DSH 开着，Edge 侧边栏就能用——不需要 `.cmd`、不需要点按钮、不需要开机自启。
- **Edge MV3 扩展**：`chrome.debugger` 直通 CDP，不申请 host 权限；浅色侧边栏 = DSH 会话镜像。
- **会话双向同步**：侧边栏读写真实 DSH 会话（`--session-id` 接力），DSH 桌面版继续同一段对话时消息会回投侧边栏。
- **顺手好用的接口**：ARIA 快照、结构化爬题 + 逐题填答验证（永不提交）、任意 CDP 直通、截图。
- **模型切换 / 会话选择**：圆角浮层下拉、滑动切换动画。

## 安装

1. 下载 `dsh-edge-companion-1.3.0.zip` 并解压到任意目录（保持目录完整）。
2. Edge → `edge://extensions` → 开发人员模式 → 加载解压缩 → 选 `extension`。
3. DSH → Plugins → Add plugin → 粘贴 `dsh-plugin` 的绝对路径 → Install。
4. 完成：打开 Edge 侧边栏即可使用。

详细步骤见压缩包内的 `安装教程.docx`。

## 校验

发布页附带的 `SHA256SUMS.txt` 给出了 zip 的 SHA256；下载后可用 `Get-FileHash` 或 `sha256sum` 校验。

## 兼容性

- Windows 10 / 11
- Microsoft Edge 114+
- DeepSeek Harness（含自带 Node 24）

## License

MIT
