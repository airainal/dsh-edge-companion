### 安装 / 升级

- 插件（新装或升级）：`dsh plugin add https://github.com/{{REPO}}/releases/download/{{TAG}}/{{TGZ_NAME}}`
- 便携包：下载 `{{ZIP_NAME}}`，解压后按包内《安装教程.docx》操作。
- 升级后需**重启 DSH**（宿主插件与桥接才会生效），并在 `edge://extensions` 里**重新加载扩展**。

### 校验

`SHA256SUMS.txt` 列出本 Release 两个产物的 SHA256，下载后可用
`Get-FileHash <文件> -Algorithm SHA256` 对照。
