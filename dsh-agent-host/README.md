# DSH Agent Host

把 Edge 侧边栏接到 **DeepSeek Harness 桌面端正在运行的那个 Agent**。

它不是一个新 agent：插件在桌面进程内调用 `sessionController`，因此

- 侧边栏发指令 = 在客户端当前会话里发一条普通用户消息；
- 侧边栏看到的回复/思考/工具调用 = 客户端同一会话的实时流；
- 侧边栏「停止」= 客户端同一个停止按钮（`sessionController.cancel`）；
- Codex 模式、权限级别、模型、上下文全部与客户端一致。

桥接优先走这条通道；未连接时才回退到 `dsh --profile headless`。
